const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { createHmac, randomBytes } = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { MongoMemoryServer } = require('mongodb-memory-server')

async function main() {
  const root = path.resolve(__dirname, '..')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jeopardy-mongo-'))
  const sheetFile = path.join(directory, 'sheet.csv')
  const sheetCalls = path.join(directory, 'sheet-calls')
  await fs.writeFile(sheetFile, 'Category,Question,Answer,Value\nScience,Original question,Original answer,100')
  await fs.writeFile(sheetCalls, '')
  let mongod, storage, child
  const sockets = []
  const port = 29000 + Math.floor(Math.random() * 2000)
  const base = `http://127.0.0.1:${port}`
  const origin = 'https://classroom.example'
  const secret = randomBytes(48).toString('hex')
  const signed = (id) => 'jeopardy.sid=' + encodeURIComponent('s:' + id + '.' + createHmac('sha256', secret).update(id).digest('base64').replace(/=+$/, ''))
  const stop = async () => {
    if (child && child.exitCode === null) await new Promise((resolve) => { child.once('exit', resolve); child.kill() })
  }
  const request = (route, method = 'GET', body, cookie = signed('teacher')) => fetch(base + route, { method, headers: { Cookie: cookie, Origin: origin, 'X-Forwarded-Proto': 'https', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  try {
    mongod = await MongoMemoryServer.create()
    const { connectMongo } = await import(pathToFileURL(path.join(root, 'Jeopardy/server/mongo-persistence.js')).href)
    storage = await connectMongo(mongod.getUri(), 'test')
    const sessions = storage.sessions()
    const set = (id, value) => new Promise((resolve, reject) => sessions.set(id, value, (error) => error ? reject(error) : resolve()))
    const get = (id) => new Promise((resolve, reject) => sessions.get(id, (error, value) => error ? reject(error) : resolve(value)))
    for (const id of ['teacher', 'other']) await set(id, { cookie: { expires: new Date(Date.now() + 3600000), originalMaxAge: 3600000, secure: true, httpOnly: true, path: '/' }, user: { id, name: id } })
    await set('expired', { cookie: { expires: new Date(Date.now() - 1000) } })
    assert.equal(await get('expired'), null)
    await set('removed', { cookie: {}, user: { id: 'removed' } })
    await new Promise((resolve, reject) => sessions.destroy('removed', (error) => error ? reject(error) : resolve()))
    assert.equal(await get('removed'), null)
    assert.ok((await storage.db.collection('sessions').indexes()).some((index) => index.expireAfterSeconds === 0))
    await storage.write('roundtrip', { score: { '$team.with.dots': 100 } })
    assert.deepEqual(await storage.read('roundtrip'), { score: { '$team.with.dots': 100 } })
    await assert.rejects(storage.write('roundtrip', 'x'.repeat(16 * 1024 * 1024)), /snapshot limit/)
    assert.deepEqual(await storage.read('roundtrip'), { score: { '$team.with.dots': 100 } })
    console.log('PASS: Real MongoDB session expiry/logout/TTL, arbitrary keys, and failed-write retention')

    const start = async (generation, withoutDatabase = false) => {
      const env = { ...process.env, NODE_ENV: 'production', RENDER: 'true', PORT: String(port), HOST: '127.0.0.1', APP_URL: origin, SESSION_SECRET: secret,
        MS_ENTRA_TENANT_ID: '00000000-0000-0000-0000-000000000001', MS_ENTRA_CLIENT_ID: '00000000-0000-0000-0000-000000000002', MS_ENTRA_CLIENT_SECRET: 'test-only', MS_ENTRA_REDIRECT_URI: `${origin}/api/auth/callback`, TRUST_PROXY: '1',
        MONGODB_URI: withoutDatabase ? '' : mongod.getUri(), MONGODB_DATABASE: 'test', JEOPARDY_DATA_DIR: path.join(directory, generation) }
      // Only this test process substitutes Google responses; exercise real
      // production routes and MongoDB without a public spreadsheet dependency.
      const bootstrap = `
        const fs = require('node:fs/promises');
        const originalFetch = global.fetch;
        global.fetch = async (url, options) => {
          if (!String(url).startsWith('https://docs.google.com/spreadsheets/')) return originalFetch(url, options);
          await fs.appendFile(process.env.TEST_SHEET_CALLS, 'fetch\\n');
          if (String(url).includes('/export?')) return new Response(await fs.readFile(process.env.TEST_SHEET_FILE, 'utf8'));
          return new Response('<title>Snapshot test - Google Sheets</title>');
        };
        import('./Jeopardy/server/index.js').catch(() => { process.exitCode = 1 });
      `
      child = spawn(process.execPath, ['-e', bootstrap], { cwd: root, env: { ...env, TEST_SHEET_FILE: sheetFile, TEST_SHEET_CALLS: sheetCalls }, stdio: 'ignore' })
      if (withoutDatabase) {
        const code = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Missing database startup check timed out')), 10000)
          child.once('exit', (value) => { clearTimeout(timer); resolve(value) })
        })
        assert.notEqual(code, 0)
        return
      }
      for (let attempt = 0; attempt < 300; attempt++) {
        try { if ((await fetch(base + '/api/ready')).ok) return } catch { /* Wait for startup. */ }
        if (child.exitCode !== null) throw new Error('Mongo-backed API exited during startup')
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      throw new Error('Mongo-backed API readiness timed out')
    }
    await start('missing-database', true)
    console.log('PASS: Render refuses startup without MongoDB rather than using ephemeral files')
    await start('first-deploy')
    const created = await request('/api/games', 'POST')
    assert.equal(created.status, 201)
    const record = await created.json()
    const game = { title: 'Database snapshot', teams: [{ id: 'red', name: 'Red' }], categories: [{ id: 'science', title: 'Science', clues: [{ id: 'one', value: 100, question: 'Saved question', answer: 'Private answer' }] }] }
    assert.equal((await request(`/api/games/${record.id}`, 'PUT', { game })).status, 200)
    assert.equal((await request(`/api/games/${record.id}`, 'GET', undefined, signed('other'))).status, 403)
    const importBody = { sheetUrl: 'https://docs.google.com/spreadsheets/d/testsheet123456789/edit' }
    assert.equal((await request('/api/import/google-sheets', 'POST', importBody, '')).status, 401)
    const firstImport = await request('/api/import/google-sheets', 'POST', importBody)
    assert.equal(firstImport.status, 201)
    const firstSnapshot = await firstImport.json()
    assert.notEqual(firstSnapshot.id, record.id)
    assert.equal(firstSnapshot.ownerId, 'teacher')
    assert.equal(firstSnapshot.game.categories[0].clues[0].answer, 'Original answer')
    const callsBeforeEdit = await fs.readFile(sheetCalls, 'utf8')
    await fs.writeFile(sheetFile, 'Category,Question,Answer,Value\nScience,Changed question,Changed answer,200')
    const reopened = await (await request(`/api/games/${firstSnapshot.id}`)).json()
    assert.deepEqual(reopened.game, firstSnapshot.game)
    reopened.game.categories[0].clues[0].question = 'Edited in app'
    reopened.game.categories[0].clues[0].answer = 'Edited answer'
    assert.equal((await request(`/api/games/${firstSnapshot.id}`, 'PUT', { game: reopened.game })).status, 200)
    assert.equal(await fs.readFile(sheetCalls, 'utf8'), callsBeforeEdit)
    assert.equal((await request(`/api/games/${firstSnapshot.id}`, 'GET', undefined, signed('other'))).status, 403)
    assert.deepEqual(await (await request('/api/games', 'GET', undefined, signed('other'))).json(), [])
    // Even older clients using the selected-game URL must create a separate copy.
    const secondImport = await request(`/api/games/${firstSnapshot.id}/import/google-sheets`, 'POST', importBody)
    assert.equal(secondImport.status, 201)
    const secondSnapshot = await secondImport.json()
    assert.notEqual(secondSnapshot.id, firstSnapshot.id)
    assert.notEqual(secondSnapshot.code, firstSnapshot.code)
    assert.equal(secondSnapshot.game.categories[0].clues[0].answer, 'Changed answer')
    assert.deepEqual((await (await request(`/api/games/${firstSnapshot.id}`)).json()).game, reopened.game)
    assert.deepEqual((await (await request(`/api/games/${record.id}`)).json()).game, game)
    const countBeforeFailure = (await (await request('/api/games')).json()).length
    await fs.writeFile(sheetFile, 'Category,Question,Answer\nScience,Missing answer,')
    assert.equal((await request('/api/import/google-sheets', 'POST', importBody)).status, 400)
    assert.equal((await (await request('/api/games')).json()).length, countBeforeFailure)
    console.log('PASS: Sheet imports create owned MongoDB snapshots; app edits and sheet changes stay independent; re-imports preserve older games; failed imports leave no empty game')
    const join = await request('/api/student/session', 'POST', { name: 'Alex', code: record.code }, '')
    assert.equal(join.status, 200)
    assert.match(join.headers.get('set-cookie'), /; Secure/)
    const studentCookie = join.headers.get('set-cookie').split(';')[0]
    const { student } = await join.json()
    assert.equal((await request(`/api/games/${record.id}/students/${student.id}`, 'PUT', { teamId: 'red' })).status, 200)
    assert.equal((await request(`/api/games/${record.id}/progress`, 'PUT', { scores: { red: 200 }, usedClues: [] })).status, 200)
    const { io } = require('../Jeopardy/node_modules/socket.io-client')
    const socket = io(base, { autoConnect: false, forceNew: true, transports: ['websocket'], reconnection: false, auth: { gameId: record.id, role: 'student' }, extraHeaders: { Cookie: studentCookie, Origin: origin, 'X-Forwarded-Proto': 'https' } })
    sockets.push(socket)
    const connected = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Mongo session WebSocket handshake timed out')), 5000)
      socket.once('session:ready', (state) => { clearTimeout(timer); resolve(state) })
      socket.once('connect_error', (error) => { clearTimeout(timer); reject(error) })
    })
    socket.connect()
    assert.equal((await connected).studentId, student.id)
    socket.disconnect()
    // Seed saved buzzer state through the same adapter, then replace the entire
    // local data directory on restart to simulate an ephemeral Render redeploy.
    await storage.write('buzzers.json', { [record.id]: { status: 'closed', clueId: null, roundId: 'saved-round', winner: null } })
    assert.deepEqual(await fs.readdir(path.join(directory, 'first-deploy')), [])
    await stop()
    await start('fresh-deploy')
    const restored = await (await request(`/api/games/${record.id}`)).json()
    assert.equal(restored.ownerId, 'teacher')
    assert.deepEqual(restored.game, game)
    assert.equal(restored.progress.scores.red, 200)
    assert.deepEqual((await (await request(`/api/games/${firstSnapshot.id}`)).json()).game, reopened.game)
    assert.deepEqual((await (await request(`/api/games/${secondSnapshot.id}`)).json()).game, secondSnapshot.game)
    const resumed = await (await request('/api/student/session', 'GET', undefined, studentCookie)).json()
    assert.equal(resumed.student.id, student.id)
    assert.equal(resumed.student.teamId, 'red')
    assert.equal(resumed.record.game.categories[0].clues[0].answer, undefined)
    assert.equal((await storage.read('buzzers.json'))[record.id].roundId, 'saved-round')
    assert.deepEqual(await fs.readdir(path.join(directory, 'fresh-deploy')), [])
    assert.equal((await request('/api/auth/logout', 'POST')).status, 204)
    assert.equal((await request(`/api/games/${record.id}`)).status, 401)
    console.log('PASS: Production MongoDB game ownership, secure sessions, WebSockets, teams, scores, buzzer storage, private answers, logout, and restart with a completely fresh filesystem')
    await mongod.stop()
    assert.equal((await fetch(base + '/api/ready')).status, 503)
    await assert.rejects(storage.read('games.json', { games: {} }))
    console.log('PASS: Database outage fails readiness and never silently falls back to empty file storage')
  } finally {
    sockets.forEach((socket) => socket.disconnect())
    await stop()
    await storage?.close()
    await mongod?.stop()
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('jeopardy-mongo-')) throw new Error('Unsafe test cleanup path')
    await fs.rm(directory, { recursive: true, force: true })
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
