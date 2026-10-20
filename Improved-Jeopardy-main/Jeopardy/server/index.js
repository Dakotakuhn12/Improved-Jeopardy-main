import express from 'express'
import { createServer } from 'node:http'
import { attachRealtime, publicGameState, hostDisplayState } from './realtime.js'
import { FileSessionStore, readJson, writeJson } from './persistence.js'
import { hostId, safeId, securityMiddleware, validBoard } from './security.js'
import session from 'express-session'
import { ConfidentialClientApplication } from '@azure/msal-node'
import dotenv from 'dotenv'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes, randomUUID, randomInt, timingSafeEqual } from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const dataDir = process.env.JEOPARDY_DATA_DIR ? path.resolve(process.env.JEOPARDY_DATA_DIR) : path.join(rootDir, 'data')
const dataFile = path.join(dataDir, 'games.json')
const envPath = path.resolve(rootDir, '..', '.env')
dotenv.config({ path: envPath })

// The original credentials file used `label: value` lines. Keep accepting it
// while also supporting conventional KEY=value variables documented in .env.example.
function legacyCredentials() {
  try {
    return Object.fromEntries(readFileSync(envPath, 'utf8').split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^\s*([^:]+):\s*(.+?)\s*$/)
      return match ? [[match[1].trim().toLowerCase(), match[2]]] : []
    }))
  } catch { return {} }
}

const legacy = legacyCredentials()
const tenantId = process.env.MS_ENTRA_TENANT_ID || legacy.tennant || legacy.tenant
const clientId = process.env.MS_ENTRA_CLIENT_ID || legacy['app(client)']
const clientSecret = process.env.MS_ENTRA_CLIENT_SECRET || legacy.secret
const port = Number(process.env.PORT) || 3001
const appUrl = (process.env.APP_URL || `http://localhost:${port}`).replace(/\/$/, '')
const redirectUri = process.env.MS_ENTRA_REDIRECT_URI || `${appUrl}/api/auth/callback`
await mkdir(dataDir, { recursive: true })
const secretFile = path.join(dataDir, 'session-secret')
if (!process.env.SESSION_SECRET && !existsSync(secretFile)) await writeFile(secretFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 })
const sessionSecret = process.env.SESSION_SECRET || (await readFile(secretFile, 'utf8')).trim()
if (process.env.NODE_ENV === 'production' && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) throw new Error('Production requires a SESSION_SECRET of at least 32 characters.')
const authConfigured = Boolean(tenantId && clientId && clientSecret)
const msalClient = authConfigured ? new ConfidentialClientApplication({
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    clientSecret,
  },
}) : null
const app = express()

app.disable('x-powered-by')
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false)
app.use(securityMiddleware(appUrl))
app.use(express.json({ limit: '1mb' }))
const sessionMiddleware = session({
  name: 'jeopardy.sid',
  secret: sessionSecret,
  store: new FileSessionStore(path.join(dataDir, 'sessions')),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' },
})
app.use(sessionMiddleware)

// Prevent concurrent configuration/progress requests from overwriting each other.
let mutationQueue = Promise.resolve()
app.use('/api', (request, response, next) => {
  if (!['POST', 'PUT', 'DELETE'].includes(request.method)) return next()
  const previous = mutationQueue
  let release
  mutationQueue = new Promise((resolve) => { release = resolve })
  response.once('finish', release)
  response.once('close', release)
  previous.then(() => { if (!response.destroyed) next(); else release() })
})

let legacyOwnerPromise
function migrateLegacyGames(user) {
  if (!legacyOwnerPromise) legacyOwnerPromise = (async () => {
    const ownershipFile = path.join(dataDir, 'legacy-owner.json')
    const saved = await readJson(ownershipFile, null)
    const ownerId = saved?.ownerId || hostId(user)
    if (!saved) await writeJson(ownershipFile, { ownerId })
    const store = await readStore()
    let changed = false
    for (const record of Object.values(store.games)) if (!record.ownerId) { record.ownerId = ownerId; changed = true }
    if (changed) await writeStore(store)
    return ownerId
  })().catch((error) => { legacyOwnerPromise = undefined; throw error })
  return legacyOwnerPromise
}

app.use('/api/games/:gameId', requireHost, async (request, response, next) => {
  try {
    if (!safeId(request.params.gameId)) return response.status(400).json({ error: 'Invalid game ID.' })
    const store = await readStore()
    const record = Object.hasOwn(store.games, request.params.gameId) ? store.games[request.params.gameId] : null
    if (!record) return response.status(404).json({ error: 'Game not found.' })
    if (!record.ownerId) {
      const ownerId = await migrateLegacyGames(request.session.user)
      if (ownerId !== hostId(request.session.user)) return response.status(403).json({ error: 'Only the original host can claim older saved games.' })
      record.ownerId = ownerId
    }
    if (record.ownerId !== hostId(request.session.user)) return response.status(403).json({ error: 'Only the game owner can manage this game.' })
    next()
  } catch (error) { next(error) }
})

const createGame = () => ({ title: 'Classroom Jeopardy', teams: [], categories: [] })
const initialProgress = (game) => ({ scores: Object.fromEntries(game.teams.map((team) => [team.id, 0])), usedClues: [], finalWagers: {}, finalOutcomes: {}, finalRevealed: false, finalResolved: false })

const saveSession = (request) => new Promise((resolve, reject) => request.session.save((error) => error ? reject(error) : resolve()))

async function readStore() {
  await mkdir(dataDir, { recursive: true })
  return readJson(dataFile, { games: {} })
}

async function writeStore(store) {
  await mkdir(dataDir, { recursive: true })
  await writeJson(dataFile, store)
  for (const record of Object.values(store.games)) await publishGame(record)
}

function validGame(game) {
  return validBoard(game)
}

function teamError(teams) {
  const ids = new Set()
  const names = new Set()
  for (const team of teams) {
    if (!team || !safeId(team.id) || ids.has(team.id)) return 'Each team needs a unique, valid ID.'
    if (typeof team.name !== 'string' || !team.name.trim() || team.name.trim().length > 50) return 'Team names must contain 1 to 50 characters.'
    const name = team.name.trim().toLowerCase()
    if (names.has(name)) return 'Each team needs a different name.'
    ids.add(team.id)
    names.add(name)
  }
  return null
}

function teamProgress(game, progress) {
  const keep = (values = {}) => Object.fromEntries(game.teams.filter((team) => Object.hasOwn(values, team.id)).map((team) => [team.id, values[team.id]]))
  return { ...progress, scores: Object.fromEntries(game.teams.map((team) => [team.id, Number(progress.scores?.[team.id]) || 0])), finalWagers: keep(progress.finalWagers), finalOutcomes: keep(progress.finalOutcomes) }
}

function requireHost(request, response, next) {
  if (!hostId(request.session.user)) return response.status(401).json({ error: 'Sign in as a host to manage this game.' })
  next()
}

function generateGameCode(store) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const makeCode = () => Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('')

  let code = ''
  do {
    code = makeCode()
  } while (Object.values(store.games).some((record) => record.code && record.code.toUpperCase() === code))

  return code
}

async function getOrCreateGame(gameId) {
  const store = await readStore()
  if (!store.games[gameId]) {
    const game = createGame()
    store.games[gameId] = { id: gameId, game, progress: initialProgress(game), code: generateGameCode(store), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    await writeStore(store)
  }

  const record = store.games[gameId]
  if (!record.code) {
    record.code = generateGameCode(store)
    record.updatedAt = new Date().toISOString()
    await writeStore(store)
  }

  return { store, record }
}

function newGameRecord(store, ownerId) {
  const gameId = randomUUID()
  const game = { ...createGame(), title: 'Untitled Game' }
  const now = new Date().toISOString()
  return { id: gameId, ownerId, game, progress: initialProgress(game), code: generateGameCode(store), createdAt: now, updatedAt: now }
}

function parseCsv(text) {
  const rows = []
  let row = []
  let value = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { value += '"'; index += 1 } else if (character === '"') quoted = false
      else value += character
    } else if (character === '"') quoted = true
    else if (character === ',') { row.push(value); value = '' }
    else if (character === '\n') { row.push(value); rows.push(row); row = []; value = '' }
    else if (character !== '\r') value += character
  }

  if (value || row.length) { row.push(value); rows.push(row) }
  return rows.filter((current) => current.some((cell) => cell.trim()))
}

function columnName(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '')
}

function badSheetRequest(message) {
  const error = new Error(message)
  error.status = 400
  return error
}

function googleSheetDetails(value) {
  const input = String(value || '').trim()
  if (input.length > 2048) throw badSheetRequest('The Google Sheets URL is too long.')
  const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  const sheetId = match?.[1] || (/^[a-zA-Z0-9_-]{20,}$/.test(input) ? input : '')
  if (!sheetId) throw badSheetRequest('Paste a valid Google Sheets link or spreadsheet ID.')

  let gid = '0'
  try {
    const parsed = new URL(input)
    gid = parsed.searchParams.get('gid') || parsed.hash.match(/gid=(\d+)/)?.[1] || gid
  } catch { /* A spreadsheet ID does not need URL parsing. */ }
  return { sheetId, gid }
}

async function boundedSheetText(response, limit = 2000000) {
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > limit) throw badSheetRequest('The spreadsheet response is too large to import.')
    text += decoder.decode(chunk, { stream: true })
  }
  return text + decoder.decode()
}

function cellRangeBounds(value) {
  if (!String(value || '').trim()) return null
  const match = String(value).trim().match(/^\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/i)
  if (!match) throw badSheetRequest('Enter a rectangular cell range such as A1:J7.')
  const columnNumber = (letters) => [...letters.toUpperCase()].reduce((number, letter) => number * 26 + letter.charCodeAt(0) - 64, 0)
  const bounds = { startColumn: columnNumber(match[1]) - 1, startRow: Number(match[2]) - 1, endColumn: columnNumber(match[3]) - 1, endRow: Number(match[4]) - 1 }
  if (bounds.startRow < 0 || bounds.startColumn < 0 || bounds.startRow > bounds.endRow || bounds.startColumn > bounds.endColumn) {
    throw badSheetRequest('The cell range must start at the top-left and end at the bottom-right, for example A1:J7.')
  }
  return bounds
}

async function googleSheetTitle(sheetId, fallback) {
  try {
    const response = await fetch(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/edit`, { signal: AbortSignal.timeout(10000) })
    if (!response.ok) return fallback
    const html = await boundedSheetText(response)
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/\s*-\s*Google Sheets\s*$/i, '').trim()
    return title || fallback
  } catch { return fallback }
}

function gameFromSheet(csv, title, range) {
  let sheetRows = parseCsv(csv)
  const bounds = cellRangeBounds(range)
  if (bounds) {
    sheetRows = sheetRows.slice(bounds.startRow, bounds.endRow + 1).map((row) => {
      const selected = row.slice(bounds.startColumn, bounds.endColumn + 1)
      while (selected.length < bounds.endColumn - bounds.startColumn + 1) selected.push('')
      return selected
    })
  }
  const [headers, ...rows] = sheetRows
  if (!headers?.length) throw badSheetRequest('The sheet is empty.')

  // Wide board layout: Category in column A, then alternating Question/Answer
  // pairs. Each subsequent row is a category and can contain several clues.
  const normalizedHeaders = headers.map(columnName)
  if (normalizedHeaders[0] === 'category' && normalizedHeaders[1] === 'question' && normalizedHeaders[2] === 'answer'
    && normalizedHeaders[3] === 'question' && normalizedHeaders[4] === 'answer') {
    const categories = new Map()
    let finalJeopardy = null
    rows.forEach((row) => {
      const label = row[0]?.trim()
      if (!label) return

      // The final row stores its category in column D and its clue in B/C.
      if (label.toLowerCase() === 'final') {
        const question = row[1]?.trim()
        const answer = row[2]?.trim()
        if (question || answer) {
          if (!question || !answer) throw badSheetRequest('The final round needs both a question and an answer.')
          finalJeopardy = { category: row[3]?.trim() || 'Final', question, answer }
        }
        return
      }

      if (!categories.has(label)) categories.set(label, { id: randomUUID(), title: label, clues: [] })
      const category = categories.get(label)
      for (let questionColumn = 1; questionColumn < headers.length; questionColumn += 2) {
        const question = row[questionColumn]?.trim()
        const answer = row[questionColumn + 1]?.trim()
        if (!question && !answer) continue
        if (!question || !answer) throw badSheetRequest(`Every question in “${label}” needs both a question and an answer.`)
        category.clues.push({ id: randomUUID(), value: (category.clues.length + 1) * 100, question, answer })
      }
    })
    if (!categories.size) throw badSheetRequest('No questions were found in the sheet.')
    return { title, teams: [], categories: [...categories.values()], ...(finalJeopardy ? { finalJeopardy } : {}) }
  }

  const columns = Object.fromEntries(headers.map((header, index) => [columnName(header), index]))
  const categoryColumn = columns.category ?? columns.cat
  const questionColumn = columns.question ?? columns.clue
  const answerColumn = columns.answer ?? columns.response
  const valueColumn = columns.value ?? columns.points ?? columns.pointvalue
  if ([categoryColumn, questionColumn, answerColumn].some((column) => column === undefined)) {
    throw badSheetRequest('The first row must include Category, Question, and Answer columns. Value is optional.')
  }

  const categories = new Map()
  rows.forEach((row) => {
    const categoryTitle = row[categoryColumn]?.trim()
    const question = row[questionColumn]?.trim()
    const answer = row[answerColumn]?.trim()
    if (!categoryTitle && !question && !answer) return
    if (!categoryTitle || !question || !answer) throw badSheetRequest('Every imported row needs a category, question, and answer.')

    if (!categories.has(categoryTitle)) categories.set(categoryTitle, { id: randomUUID(), title: categoryTitle, clues: [] })
    const category = categories.get(categoryTitle)
    const suppliedValue = Number(row[valueColumn])
    category.clues.push({
      id: randomUUID(),
      value: Number.isFinite(suppliedValue) && suppliedValue > 0 ? suppliedValue : (category.clues.length + 1) * 100,
      question,
      answer,
    })
  })

  if (!categories.size) throw badSheetRequest('No questions were found in the sheet.')
  return { title, teams: [], categories: [...categories.values()] }
}

app.get('/api/health', (_request, response) => response.json({ status: 'ok' }))

// Student membership is held in the signed session, independently of host login.
const membershipFile = path.join(dataDir, 'students.json')
const studentMemberships = new Map(Object.entries(await readJson(membershipFile, {})))
const buzzerFile = path.join(dataDir, 'buzzers.json')
const savedBuzzers = await readJson(buzzerFile, {})
const httpServer = createServer(app)
const io = attachRealtime(httpServer, { sessionMiddleware, readStore, students: studentMemberships, appUrl, getRoster: (record) => rosterFor(record), savedBuzzers, saveBuzzers: (states) => writeJson(buzzerFile, states) })
const publishedGames = new Map()
async function publishGame(record, force = false) {
  const version = JSON.stringify(record)
  if (!force && publishedGames.get(record.id) === version) return
  publishedGames.set(record.id, version)
  io.to(`game:${record.id}`).emit('game:state', publicGameState(record))
  io.to(`host:${record.id}`).emit('host:state', hostDisplayState(record))
  await io.syncBuzzer(record)
}
async function publishMembership(gameId) {
  await writeJson(membershipFile, Object.fromEntries(studentMemberships))
  const record = (await readStore()).games[gameId]
  if (!record) return
  const roster = rosterFor(record)
  io.to(`host:${gameId}`).emit('roster:updated', roster)
  for (const student of roster) io.to(`student:${student.id}`).emit('student:updated', student)
}
const rosterFor = (record) => [...studentMemberships.values()].filter((student) => student.gameId === record.id && (!student.expiresAt || student.expiresAt > Date.now())).map((student) => ({ ...student, teamId: record.game.teams.some((team) => team.id === student.teamId) ? student.teamId : null }))

app.use('/api/games/:gameId/students', (request, response, next) => {
  if (!request.session.user) return response.status(401).json({ error: 'Sign in as a host to manage students.' })
  next()
})
app.get('/api/games/:gameId/students', async (request, response, next) => {
  try {
    const record = (await readStore()).games[request.params.gameId]
    if (!record) return response.status(404).json({ error: 'Game not found.' })
    response.json(rosterFor(record))
  } catch (error) { next(error) }
})
app.put('/api/games/:gameId/students/:studentId', async (request, response, next) => {
  try {
    const record = (await readStore()).games[request.params.gameId]
    const student = studentMemberships.get(request.params.studentId)
    if (!record || student?.gameId !== record.id) return response.status(404).json({ error: 'Student not found in this game.' })
    const teamId = request.body?.teamId
    if (teamId !== null && !record.game.teams.some((team) => team.id === teamId)) return response.status(400).json({ error: 'Choose a team in this game.' })
    student.teamId = teamId
    await publishMembership(record.id)
    response.json(student)
  } catch (error) { next(error) }
})
app.delete('/api/games/:gameId/students/:studentId', async (request, response, next) => {
  try {
  const student = studentMemberships.get(request.params.studentId)
  if (student?.gameId !== request.params.gameId) return response.status(404).json({ error: 'Student not found in this game.' })
  studentMemberships.delete(student.id)
  io.in(`student:${student.id}`).disconnectSockets(true)
  await publishMembership(request.params.gameId)
  response.json({ removed: true })
  } catch (error) { next(error) }
})
app.post('/api/games/:gameId/students/balance', async (request, response, next) => {
  try {
    const record = (await readStore()).games[request.params.gameId]
    if (!record) return response.status(404).json({ error: 'Game not found.' })
    if (!record.game.teams.length) return response.status(400).json({ error: 'Add a team before assigning students.' })
    rosterFor(record).forEach((student, index) => { studentMemberships.get(student.id).teamId = record.game.teams[index % record.game.teams.length].id })
    await publishMembership(record.id)
    response.json(rosterFor(record))
  } catch (error) { next(error) }
})

function studentRecord(record) {
  return publicGameState(record)
}

app.post('/api/student/session', async (request, response, next) => {
  try {
    const name = typeof request.body?.name === 'string' ? request.body.name.trim() : ''
    const code = typeof request.body?.code === 'string' ? request.body.code.trim().toUpperCase() : ''
    if (!name || name.length > 50) return response.status(400).json({ error: 'Enter a student name of 1 to 50 characters.' })
    if (!code) return response.status(400).json({ error: 'Enter a game code.' })
    const store = await readStore()
    const record = Object.values(store.games).find((game) => game.code?.toUpperCase() === code)
    if (!record) return response.status(404).json({ error: 'No game was found for that code.' })
    const previous = request.session.student
    if (previous?.id && previous.gameId !== record.id) {
      studentMemberships.delete(previous.id)
      io.in(`student:${previous.id}`).disconnectSockets(true)
    }
    request.session.student = {
      id: previous?.gameId === record.id && studentMemberships.has(previous.id) ? previous.id : randomUUID(),
      name, gameId: record.id,
    }
    request.session.student.teamId = studentMemberships.get(request.session.student.id)?.teamId || null
    studentMemberships.set(request.session.student.id, { ...request.session.student, expiresAt: Date.now() + 7 * 86400000 })
    request.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000
    await saveSession(request)
    if (previous?.gameId && previous.gameId !== record.id) await publishMembership(previous.gameId)
    await publishMembership(record.id)
    response.json({ student: request.session.student, record: studentRecord(record) })
  } catch (error) { next(error) }
})

app.get('/api/student/session', async (request, response, next) => {
  try {
    const student = studentMemberships.get(request.session.student?.id)
    if (!student || (student.expiresAt && student.expiresAt <= Date.now())) return response.json({ student: null, record: null })
    const store = await readStore()
    const record = store.games[student.gameId]
    if (!record) {
      delete request.session.student
      await saveSession(request)
      return response.json({ student: null, record: null })
    }
    response.json({ student: rosterFor(record).find((member) => member.id === student.id), record: studentRecord(record) })
  } catch (error) { next(error) }
})

app.delete('/api/student/session', async (request, response, next) => {
  try {
    const gameId = request.session.student?.gameId
    studentMemberships.delete(request.session.student?.id)
    io.in(`session:${request.sessionID}`).disconnectSockets(true)
    delete request.session.student
    await saveSession(request)
    if (gameId) await publishMembership(gameId)
    response.json({ left: true })
  } catch (error) { next(error) }
})

app.get('/api/auth/me', (request, response) => {
  if (!authConfigured) return response.status(503).json({ error: 'Microsoft authentication has not been configured on the server.' })
  response.json({ authenticated: Boolean(request.session.user), user: request.session.user || null })
})

app.get('/api/auth/login', async (request, response, next) => {
  if (!msalClient) return response.status(503).send('Microsoft authentication has not been configured on the server.')
  try {
    const state = randomBytes(24).toString('hex')
    request.session.oauthState = state
    await saveSession(request)
    const authorizationUrl = await msalClient.getAuthCodeUrl({
      scopes: ['openid', 'profile', 'email'],
      redirectUri,
      state,
    })
    response.redirect(authorizationUrl)
  } catch (error) { next(error) }
})

app.get('/api/auth/callback', async (request, response, next) => {
  if (!msalClient) return response.status(503).send('Microsoft authentication has not been configured on the server.')
  try {
    const returnedState = typeof request.query.state === 'string' ? request.query.state : ''
    const expectedState = request.session.oauthState || ''
    const stateIsValid = /^[a-f0-9]{48}$/.test(returnedState) && /^[a-f0-9]{48}$/.test(expectedState) && timingSafeEqual(Buffer.from(returnedState), Buffer.from(expectedState))
    if (!stateIsValid || typeof request.query.code !== 'string') return response.status(400).send('The Microsoft sign-in response was invalid or expired. Please try again.')

    const tokenResponse = await msalClient.acquireTokenByCode({
      code: request.query.code,
      scopes: ['openid', 'profile', 'email'],
      redirectUri,
    })
    request.session.regenerate((sessionError) => {
      if (sessionError) return next(sessionError)
      request.session.user = {
        id: tokenResponse.account?.homeAccountId || tokenResponse.account?.username,
        name: tokenResponse.account?.name || tokenResponse.account?.username || 'Microsoft user',
        username: tokenResponse.account?.username || null,
      }
      saveSession(request).then(() => response.redirect(appUrl)).catch(next)
    })
  } catch (error) { next(error) }
})

app.post('/api/auth/logout', (request, response, next) => {
  io.in(`session:${request.sessionID}`).disconnectSockets(true)
  request.session.destroy((error) => {
    if (error) return next(error)
    response.clearCookie('jeopardy.sid')
    response.status(204).end()
  })
})

app.get('/api/public/games/:code', async (request, response, next) => {
  try {
    const code = String(request.params.code || '').trim().toUpperCase()
    const store = await readStore()
    if (!code) return response.status(400).json({ error: 'A game code is required.' })

    const record = Object.values(store.games).find((item) => String(item.code || '').toUpperCase() === code)
    if (!record) return response.status(404).json({ error: 'No game was found for that code.' })

    response.json(publicGameState(record))
  } catch (error) { next(error) }
})

app.post('/api/public/games', requireHost, async (request, response, next) => {
  try {
    const store = await readStore()
    const record = newGameRecord(store, hostId(request.session.user))
    store.games[record.id] = record
    await writeStore(store)
    response.status(201).json(record)
  } catch (error) { next(error) }
})

app.post('/api/games/:gameId/import/google-sheets', requireHost, async (request, response, next) => {
  try {
    const { sheetUrl, cellRange } = request.body || {}
    const { sheetId, gid } = googleSheetDetails(sheetUrl)
    const exportUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=csv&gid=${encodeURIComponent(gid)}`
    const sheetResponse = await fetch(exportUrl, { signal: AbortSignal.timeout(10000) })
    if (!sheetResponse.ok) throw new Error('Google could not open that sheet. Set sharing to “Anyone with the link” and try again.')

    const { store, record } = await getOrCreateGame(request.params.gameId)
    const sheetTitle = await googleSheetTitle(sheetId, record.game.title)
    const sheetText = await boundedSheetText(sheetResponse)
    const imported = gameFromSheet(sheetText, sheetTitle, cellRange)
    if (!validGame(imported)) throw badSheetRequest('The spreadsheet exceeds the allowed board size or contains invalid values.')
    record.game = imported
    record.progress = initialProgress(record.game)
    record.updatedAt = new Date().toISOString()
    await writeStore(store)
    response.json(record)
  } catch (error) {
    if (error.status === 400) return response.status(400).json({ error: error.message })
    if (error instanceof TypeError) return response.status(400).json({ error: 'Unable to retrieve that Google Sheet.' })
    next(error)
  }
})

app.get('/api/games/:gameId/host-display', requireHost, async (request, response, next) => {
  try {
    const record = (await readStore()).games[request.params.gameId]
    if (!record) return response.status(404).json({ error: 'Game not found.' })
    response.json(hostDisplayState(record))
  } catch (error) { next(error) }
})

app.get('/api/games', requireHost, async (request, response, next) => {
  try {
    const store = await readStore()
    const games = Object.values(store.games)
      .filter((record) => !record.ownerId || record.ownerId === hostId(request.session.user))
      .map(({ id, game, createdAt, updatedAt }) => ({ id, title: game.title, createdAt, updatedAt }))
      .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt))
    response.json(games)
  } catch (error) { next(error) }
})

app.post('/api/games', requireHost, async (request, response, next) => {
  try {
    const store = await readStore()
    const record = newGameRecord(store, hostId(request.session.user))
    store.games[record.id] = record
    await writeStore(store)
    response.status(201).json(record)
  } catch (error) { next(error) }
})

app.get('/api/games/:gameId', requireHost, async (request, response, next) => {
  try { const { record } = await getOrCreateGame(request.params.gameId); response.json(record) } catch (error) { next(error) }
})

app.delete('/api/games/:gameId', requireHost, async (request, response, next) => {
  try {
    const store = await readStore()
    if (!store.games[request.params.gameId]) return response.status(404).json({ error: 'That game could not be found.' })
    delete store.games[request.params.gameId]
    await writeStore(store)
    for (const student of studentMemberships.values()) if (student.gameId === request.params.gameId) studentMemberships.delete(student.id)
    await writeJson(membershipFile, Object.fromEntries(studentMemberships))
    publishedGames.delete(request.params.gameId)
    io.in(`game:${request.params.gameId}`).disconnectSockets(true)
    response.json({ deleted: true })
  } catch (error) { next(error) }
})

app.put('/api/games/:gameId', requireHost, async (request, response, next) => {
  try {
    if (!validGame(request.body?.game)) return response.status(400).json({ error: 'A game title, teams array, and categories array are required.' })
    const invalidTeam = teamError(request.body.game.teams)
    if (invalidTeam) return response.status(400).json({ error: invalidTeam })
    const { store, record } = await getOrCreateGame(request.params.gameId)
    record.game = { ...request.body.game, teams: request.body.game.teams.map((team) => ({ ...team, name: team.name.trim() })) }
    record.progress = teamProgress(record.game, record.progress)
    if (record.live?.activeClueId && !record.game.categories.some((category) => category.clues.some((clue) => clue.id === record.live.activeClueId))) record.live = { ...record.live, activeClueId: null, answerRevealed: false }
    record.updatedAt = new Date().toISOString()
    await writeStore(store)
    for (const student of studentMemberships.values()) {
      if (student.gameId === record.id && !record.game.teams.some((team) => team.id === student.teamId)) student.teamId = null
    }
    await publishMembership(record.id)
    response.json(record)
  } catch (error) { next(error) }
})

app.put('/api/games/:gameId/progress', requireHost, async (request, response, next) => {
  try {
    const { scores, usedClues, finalWagers = {}, finalOutcomes = {}, finalRevealed = false, finalResolved = false } = request.body || {}
    const numericMap = (value) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length <= 50 && Object.values(value).every((number) => Number.isSafeInteger(number) && Math.abs(number) <= 1000000000)
    if (!numericMap(scores) || !numericMap(finalWagers) || !finalOutcomes || typeof finalOutcomes !== 'object' || Array.isArray(finalOutcomes) || !Object.values(finalOutcomes).every((value) => typeof value === 'boolean') || typeof finalRevealed !== 'boolean' || typeof finalResolved !== 'boolean' || !Array.isArray(usedClues) || usedClues.length > 1000 || !usedClues.every(safeId)) return response.status(400).json({ error: 'Invalid game progress.' })
    const { store, record } = await getOrCreateGame(request.params.gameId)
    record.progress = teamProgress(record.game, { scores, usedClues, finalWagers, finalOutcomes, finalRevealed, finalResolved })
    if (record.live?.activeClueId && usedClues.includes(record.live.activeClueId)) record.live = { ...record.live, activeClueId: null, answerRevealed: false }
    record.updatedAt = new Date().toISOString()
    await writeStore(store)
    response.json(record.progress)
  } catch (error) { next(error) }
})

app.put('/api/games/:gameId/live', requireHost, async (request, response, next) => {
  try {
    const { phase, activeClueId = null, answerRevealed = false, finalOpen = false } = request.body || {}
    if (!['editor', 'playing'].includes(phase) || typeof answerRevealed !== 'boolean' || typeof finalOpen !== 'boolean') return response.status(400).json({ error: 'Invalid live game state.' })
    const store = await readStore()
    const record = store.games[request.params.gameId]
    if (!record) return response.status(404).json({ error: 'Game not found.' })
    if (activeClueId !== null && (!record.game.categories.some((category) => category.clues.some((clue) => clue.id === activeClueId)) || record.progress.usedClues.includes(activeClueId))) return response.status(400).json({ error: 'Choose an unused clue in this game.' })
    record.live = { phase, activeClueId: phase === 'playing' && !finalOpen ? activeClueId : null, answerRevealed: phase === 'playing' && Boolean(activeClueId) && answerRevealed, finalOpen: phase === 'playing' && finalOpen }
    record.updatedAt = new Date().toISOString()
    await writeStore(store)
    response.json(publicGameState(record))
  } catch (error) { next(error) }
})

app.post(['/api/games/:gameId/reset', '/api/games/:gameId/replay'], requireHost, async (request, response, next) => {
  try {
    const store = await readStore()
    const record = store.games[request.params.gameId]
    if (!record) return response.status(404).json({ error: 'Game not found.' })
    record.progress = initialProgress(record.game)
    record.live = { phase: 'playing', activeClueId: null, answerRevealed: false, finalOpen: false }
    if (request.path.endsWith('/replay')) record.replayCount = (record.replayCount || 0) + 1
    record.updatedAt = new Date().toISOString()
    await writeStore(store)
    response.json(request.path.endsWith('/replay') ? record : record.progress)
  } catch (error) { next(error) }
})

app.use('/api', (_request, response) => response.status(404).json({ error: 'API route not found.' }))

if (existsSync(path.join(rootDir, 'dist'))) {
  app.use(express.static(path.join(rootDir, 'dist')))
  app.get('/{*splat}', (_request, response) => response.sendFile(path.join(rootDir, 'dist', 'index.html')))
} else {
  app.get('/', (_request, response) => response.type('html').send(
    '<h1>Jeopardy API is running</h1><p>For development, run <code>npm run dev</code> from the project folder and <a href="http://localhost:5173">open the app on port 5173</a>.</p><p>To serve the app here, run <code>npm run build</code> and restart the server.</p>',
  ))
}

app.use((error, _request, response, next) => {
  void next
  console.error('Request failed:', error.name, error.status || 500)
  const status = error.status === 400 || error.status === 413 ? error.status : 500
  response.status(status).json({ error: status === 400 ? 'Invalid JSON request.' : status === 413 ? 'Request body is too large.' : 'The server could not complete that request.' })
})

httpServer.listen(port, () => {
  console.log(`Jeopardy API listening on http://localhost:${port}`)
  if (!authConfigured) console.warn('Microsoft authentication is disabled: add the MS_ENTRA_* variables described in .env.')
  if (!process.env.SESSION_SECRET) console.warn('Using the saved local session secret in the data directory. Set SESSION_SECRET for deployment.')
})
