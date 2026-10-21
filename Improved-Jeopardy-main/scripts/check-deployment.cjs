const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { randomBytes, createHmac } = require('node:crypto')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '..')
async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jeopardy-deploy-'))
  const port = 24000 + Math.floor(Math.random() * 5000)
  const secret = randomBytes(48).toString('hex')
  const origin = 'https://classroom.example'
  const local = `http://127.0.0.1:${port}`
  const hostId = 'deployment-host'
  const sessionId = 'deployment-host-session'
  const cookie = 'jeopardy.sid=' + encodeURIComponent('s:' + sessionId + '.' + createHmac('sha256', secret).update(sessionId).digest('base64').replace(/=+$/, ''))
  const { FileSessionStore } = await import(pathToFileURL(path.join(root, 'Jeopardy/server/persistence.js')).href)
  const sessions = new FileSessionStore(path.join(directory, 'sessions'))
  await new Promise((resolve, reject) => sessions.set(sessionId, { cookie: { expires: new Date(Date.now() + 3600000).toISOString(), originalMaxAge: 3600000, secure: true, httpOnly: true, sameSite: 'lax', path: '/' }, user: { id: hostId, name: 'Deployment fixture' } }, (error) => error ? reject(error) : resolve()))
  const env = { ...process.env, NODE_ENV: 'production', PORT: String(port), HOST: '127.0.0.1', APP_URL: origin, SESSION_SECRET: secret,
    MS_ENTRA_TENANT_ID: '00000000-0000-0000-0000-000000000001', MS_ENTRA_CLIENT_ID: '00000000-0000-0000-0000-000000000002', MS_ENTRA_CLIENT_SECRET: 'deployment-test-only-not-real', MS_ENTRA_REDIRECT_URI: `${origin}/api/auth/callback`, JEOPARDY_DATA_DIR: directory, TRUST_PROXY: '1' }
  let child
  const sockets = []
  const start = async () => {
    child = spawn(process.execPath, ['Jeopardy/server/index.js'], { cwd: root, env, stdio: 'ignore' })
    for (let attempt = 0; attempt < 80; attempt++) {
      try { if ((await fetch(local + '/api/ready')).ok) return } catch { /* Wait for startup. */ }
      if (child.exitCode !== null) throw new Error('Production test server exited during startup')
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('Production server readiness timed out')
  }
  const stop = async () => {
    if (child && child.exitCode === null) await new Promise((resolve) => { child.once('exit', resolve); child.kill() })
  }
  const request = (route, method = 'GET', body, sid = cookie) => fetch(local + route, { method, headers: { Cookie: sid, Origin: origin, 'X-Forwarded-Proto': 'https', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  try {
    await start()
    const page = await request('/')
    assert.equal(page.status, 200)
    const html = await page.text()
    assert.ok(html.includes('id="root"'))
    assert.ok(!html.includes('/src/main.jsx'))
    const asset = html.match(/src="([^\"]+\.js)"/)[1]
    assert.equal((await request(asset)).status, 200)
    assert.ok((await request('/?hostDisplay=test')).headers.get('content-type').includes('text/html'))
    assert.equal((await request('/api/missing')).status, 404)
    assert.equal((await request('/.env')).headers.get('content-type')?.includes('text/html'), true)
    assert.equal(page.headers.get('strict-transport-security'), 'max-age=15552000')
    assert.ok(!page.headers.get('content-security-policy').split('style-src')[0].includes('unsafe-inline'))
    console.log('PASS: Production serves compiled HTML/assets, SPA routes, JSON API errors, and production security headers')
    const created = await request('/api/games', 'POST')
    assert.equal(created.status, 201)
    const game = await created.json()
    const joined = await request('/api/student/session', 'POST', { name: 'Deployment student', code: game.code }, '')
    assert.equal(joined.status, 200)
    assert.match(joined.headers.get('set-cookie'), /; Secure/i)
    assert.match(joined.headers.get('set-cookie'), /HttpOnly/i)
    const studentCookie = joined.headers.get('set-cookie').split(';')[0]
    const identity = (await joined.json()).student.id
    assert.equal((await request(`/api/games/${game.id}/host-display`, 'GET', undefined, studentCookie)).status, 401)
    const { io } = require('../Jeopardy/node_modules/socket.io-client')
    const socket = io(local, { autoConnect: false, forceNew: true, transports: ['websocket'], reconnection: false, auth: { gameId: game.id, role: 'student' }, extraHeaders: { Cookie: studentCookie, Origin: origin, 'X-Forwarded-Proto': 'https' } })
    sockets.push(socket)
    const connected = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Production WebSocket handshake timed out')), 5000)
      socket.once('session:ready', (state) => { clearTimeout(timer); resolve(state) })
      socket.once('connect_error', (error) => { clearTimeout(timer); reject(error) })
    })
    socket.connect()
    assert.equal((await connected).studentId, identity)
    assert.equal(socket.io.engine.transport.name, 'websocket')
    socket.disconnect()
    console.log('PASS: Production proxy headers support secure student cookies and authenticated WebSockets; student host access stays denied')
    await stop()
    await start()
    const restored = await (await request('/api/student/session', 'GET', undefined, studentCookie)).json()
    assert.equal(restored.student.id, identity)
    assert.equal(restored.record.id, game.id)
    assert.equal((await request(`/api/games/${game.id}/host-display`)).status, 200)
    console.log('PASS: Production restart preserves games and host/student sessions in the mounted data directory')
    const { checkProduction } = await import(pathToFileURL(path.join(root, 'Jeopardy/server/production.js')).href)
    const savedMode = process.env.NODE_ENV
    const savedSecret = process.env.SESSION_SECRET
    process.env.NODE_ENV = 'production'
    process.env.SESSION_SECRET = secret
    const valid = { appUrl: origin, redirectUri: `${origin}/api/auth/callback`, tenantId: 'tenant', clientId: 'client', clientSecret: 'secret', built: true, dataDirectory: directory }
    try {
      assert.throws(() => checkProduction({ ...valid, appUrl: 'http://localhost:3001' }), /HTTPS/)
      assert.throws(() => checkProduction({ ...valid, redirectUri: 'https://wrong.example/callback' }), /REDIRECT/)
      assert.throws(() => checkProduction({ ...valid, clientSecret: '' }), /Entra/)
      assert.throws(() => checkProduction({ ...valid, built: false }), /frontend/)
      assert.throws(() => checkProduction({ ...valid, dataDirectory: '' }), /DATA_DIR/)
    } finally {
      if (savedMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedMode
      if (savedSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = savedSecret
    }
    console.log('PASS: Production rejects insecure origins, mismatched callbacks, missing auth, missing build, and missing storage configuration')
    console.log('Local production smoke tests passed. Actual public HTTPS, Microsoft sign-in, and Docker still require deployment verification.')
  } finally {
    sockets.forEach((socket) => socket.disconnect())
    await stop()
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('jeopardy-deploy-')) throw new Error('Refusing cleanup outside the temporary deployment test directory')
    await fs.rm(directory, { recursive: true, force: true })
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
