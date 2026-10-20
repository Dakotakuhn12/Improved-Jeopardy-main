const { spawn } = require('node:child_process')
const path = require('node:path')
const { existsSync } = require('node:fs')

const root = path.resolve(__dirname, '..')
const vite = path.join(root, 'Jeopardy', 'node_modules', 'vite', 'bin', 'vite.js')
if (!existsSync(vite)) {
  console.error('Frontend dependencies are missing. Run npm run setup, then npm run dev.')
  process.exit(1)
}

const children = [
  spawn(process.execPath, ['--watch', 'Jeopardy/server/index.js'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, APP_URL: process.env.APP_URL || 'http://localhost:5173' },
  }),
  spawn(process.execPath, [vite, '--port', '5173', '--strictPort'], {
    cwd: path.join(root, 'Jeopardy'),
    stdio: 'inherit',
  }),
]

let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill()
  process.exitCode = code
}
for (const child of children) {
  child.on('error', (error) => { console.error(error.message); stop(1) })
  child.on('exit', (code) => stop(code || 0))
}
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
