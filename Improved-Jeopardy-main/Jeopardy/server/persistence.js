import session from 'express-session'
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

export async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error }
}

const writes = new Map()
export function writeJson(file, value) {
  const json = JSON.stringify(value, null, 2)
  const operation = (writes.get(file) || Promise.resolve()).catch(() => {}).then(async () => {
    await mkdir(path.dirname(file), { recursive: true })
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, json, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, file)
    } finally { await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error }) }
  })
  writes.set(file, operation)
  operation.finally(() => { if (writes.get(file) === operation) writes.delete(file) }).catch(() => {})
  return operation
}

export class FileSessionStore extends session.Store {
  constructor(directory) { super(); this.directory = directory }
  file(id) { return path.join(this.directory, `${createHash('sha256').update(id).digest('hex')}.json`) }
  get(id, callback) {
    readJson(this.file(id), null).then(async (saved) => {
      if (saved && saved.expiresAt <= Date.now()) { await this.remove(id); return null }
      return saved?.session || null
    }).then((value) => callback(null, value), callback)
  }
  set(id, value, callback = () => {}) {
    const expiresAt = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : Date.now() + 7 * 86400000
    writeJson(this.file(id), { expiresAt, session: value }).then(() => callback(), callback)
  }
  async remove(id) {
    const file = this.file(id)
    await writes.get(file)?.catch(() => {})
    await unlink(file).catch((error) => { if (error.code !== 'ENOENT') throw error })
  }
  destroy(id, callback = () => {}) { this.remove(id).then(() => callback(), callback) }
  // Keep the stored session's original cookie expiry; polling must not revive an expired login.
  touch(_id, _value, callback = () => {}) { callback() }
}
