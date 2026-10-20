import { Server } from 'socket.io'
import { randomUUID } from 'node:crypto'
import { hostId, safeId } from './security.js'

export function publicGameState(record) {
  const live = record.live || { phase: 'editor', activeClueId: null, answerRevealed: false, finalOpen: false }
  let activeClue = null
  const categories = record.game.categories.map((category) => ({ ...category, clues: category.clues.map(({ answer, ...clue }) => {
    if (clue.id === live.activeClueId) activeClue = { ...clue, category: category.title, ...(live.answerRevealed ? { answer } : {}) }
    return clue
  }) }))
  const { answer: finalAnswer, ...finalQuestion } = record.game.finalJeopardy || {}
  return { id: record.id, code: record.code, updatedAt: record.updatedAt,
    game: { ...record.game, categories, finalJeopardy: { ...finalQuestion, ...(record.progress.finalRevealed ? { answer: finalAnswer } : {}) } },
    progress: record.progress, live: { ...live, activeClue },
  }
}

export function hostDisplayState(record) {
  const snapshot = publicGameState(record)
  if (snapshot.live.activeClue) {
    const clue = record.game.categories.flatMap((category) => category.clues).find((item) => item.id === snapshot.live.activeClue.id)
    snapshot.live.activeClue = { ...snapshot.live.activeClue, answer: clue.answer }
  }
  snapshot.game.finalJeopardy = record.game.finalJeopardy || null
  return snapshot
}

export function attachRealtime(httpServer, { sessionMiddleware, readStore, students, appUrl, getRoster, savedBuzzers = {}, saveBuzzers }) {
  const origins = new Set([new URL(appUrl).origin])
  if (process.env.NODE_ENV !== 'production') origins.add('http://localhost:5173')
  const io = new Server(httpServer, {
    maxHttpBufferSize: 16 * 1024,
    allowRequest: (request, done) => done(null, !request.headers.origin || origins.has(request.headers.origin)),
  })
  io.engine.use(sessionMiddleware)
  const sessionConnections = new Map()
  const buzzers = new Map(Object.entries(savedBuzzers))
  const buzzerState = (record) => {
    const live = record.live || {}
    const clueId = live.phase === 'playing' && !live.answerRevealed && !live.finalOpen && !record.progress.usedClues.includes(live.activeClueId) ? live.activeClueId || null : null
    let state = buzzers.get(record.id)
    if (!state || state.clueId !== clueId) {
      state = { clueId, roundId: randomUUID(), status: 'closed', winner: null }
      buzzers.set(record.id, state)
    }
    return state
  }
  io.syncBuzzer = async (record) => {
    const state = buzzerState(record)
    await saveBuzzers(Object.fromEntries(buzzers))
    io.to(`game:${record.id}`).emit('buzzer:state', state)
  }
  const identity = async (socket, reload = false) => {
    const request = socket.request
    if (reload) await new Promise((resolve, reject) => request.session.reload((error) => error ? reject(error) : resolve()))
    const { role, gameId } = socket.handshake.auth || {}
    if (!safeId(gameId)) throw new Error('Choose a valid game.')
    const record = (await readStore()).games[gameId]
    if (!record) throw new Error('This game is no longer available.')
    if (role === 'host' && hostId(request.session.user) && record.ownerId === hostId(request.session.user)) return { role, gameId }
    const student = students.get(request.session.student?.id)
    if (role !== 'student' || !student || (student.expiresAt && student.expiresAt <= Date.now()) || student.gameId !== gameId) throw new Error('Join this game before connecting.')
    return { role, gameId, studentId: student.id, teamId: record.game.teams.some((team) => team.id === student.teamId) ? student.teamId : null }
  }
  io.use(async (socket, next) => {
    try {
      socket.data.identity = await identity(socket)
      const key = socket.request.sessionID
      const count = sessionConnections.get(key) || 0
      if (count >= 15) throw new Error('Too many connections for this session. Close unused game tabs.')
      sessionConnections.set(key, count + 1)
      socket.once('disconnect', () => {
        const remaining = (sessionConnections.get(key) || 1) - 1
        if (remaining) sessionConnections.set(key, remaining); else sessionConnections.delete(key)
      })
      next()
    }
    catch (error) { next(new Error(error.message)) }
  })
  io.on('connection', async (socket) => {
    const member = socket.data.identity
    const room = `game:${member.gameId}`
    await socket.join([room, `session:${socket.request.sessionID}`, ...(member.studentId ? [`student:${member.studentId}`] : [`host:${member.gameId}`])])
    socket.use(async (_packet, next) => {
      const now = Date.now()
      if (!socket.data.rate || socket.data.rate.until < now) socket.data.rate = { count: 0, until: now + 10000 }
      if (++socket.data.rate.count > 100) {
        const ack = _packet.at(-1)
        if (typeof ack === 'function') ack({ ok: false, error: 'Too many socket messages. Please wait.' })
        return
      }
      try {
        const current = await identity(socket, true)
        if (current.studentId !== member.studentId || current.role !== member.role) throw new Error('Session changed.')
        socket.data.identity = current
        next()
      } catch {
        socket.emit('session:expired', { message: 'Your game session ended. Please rejoin.' })
        socket.disconnect(true)
      }
    })
    const sessionCheck = setInterval(async () => {
      try { await identity(socket, true) } catch { socket.disconnect(true) }
    }, 30000)
    sessionCheck.unref()
    socket.once('disconnect', () => clearInterval(sessionCheck))
    socket.emit('session:ready', member)
    const record = (await readStore()).games[member.gameId]
    if (record) socket.emit('game:state', publicGameState(record))
    if (record && member.role === 'host') socket.emit('host:state', hostDisplayState(record))
    if (record) socket.emit('buzzer:state', buzzerState(record))
    if (record && member.role === 'host') socket.emit('roster:updated', getRoster(record))
    if (record && member.studentId) socket.emit('student:updated', getRoster(record).find((student) => student.id === member.studentId))
    socket.on('session:check', (ack) => {
      if (typeof ack === 'function') ack({ ok: true, ...socket.data.identity })
    })
    const handleBuzzer = async (payload, ack, control) => {
      const reply = (result) => { if (typeof ack === 'function') ack(result) }
      try {
        const current = socket.data.identity
        if ((control && current.role !== 'host') || (!control && current.role !== 'student')) return reply({ ok: false, error: 'This buzzer action is not allowed.' })
        const latest = (await readStore()).games[current.gameId]
        if (!latest) return reply({ ok: false, error: 'Game not found.' })
        const state = buzzerState(latest)
        if (!state.clueId || payload?.clueId !== state.clueId || payload?.roundId !== state.roundId) return reply({ ok: false, error: 'This buzzer round has ended. Wait for the next question.' })
        if (control) {
          if (!['open', 'reset', 'close'].includes(payload.action)) return reply({ ok: false, error: 'Invalid buzzer action.' })
          buzzers.set(current.gameId, { ...state, roundId: randomUUID(), status: payload.action === 'close' ? 'closed' : 'open', winner: null })
        } else {
          const student = students.get(current.studentId)
          const team = latest.game.teams.find((item) => item.id === student?.teamId)
          if (!student || !team) return reply({ ok: false, error: 'The host must assign you to a team before buzzing.' })
          if (state.status !== 'open') return reply({ ok: false, error: state.winner ? 'Another student buzzed first.' : 'The buzzer is closed.' })
          // No await between checking and locking: exactly one accepted winner.
          buzzers.set(current.gameId, { ...state, status: 'locked', winner: { studentId: student.id, name: student.name, teamId: team.id, teamName: team.name } })
        }
        await io.syncBuzzer(latest)
        reply({ ok: true, state: buzzers.get(current.gameId) })
      } catch { reply({ ok: false, error: 'Could not update the buzzer. Please try again.' }) }
    }
    socket.on('buzzer:press', (payload, ack) => handleBuzzer(payload, ack, false))
    socket.on('buzzer:control', (payload, ack) => handleBuzzer(payload, ack, true))
    // Verify room isolation without changing gameplay.
    socket.on('room:check', (ack) => {
      if (socket.data.identity.role !== 'host') {
        if (typeof ack === 'function') ack({ ok: false, error: 'Only the host can check the game room.' })
        return
      }
      io.to(room).emit('room:checked', { gameId: member.gameId, checkedAt: Date.now() })
      if (typeof ack === 'function') ack({ ok: true })
    })
  })
  return io
}
