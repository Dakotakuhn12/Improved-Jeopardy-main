import session from 'express-session'
import { createHash } from 'node:crypto'
import { MongoClient } from 'mongodb'

// One API process serializes game mutations. Each state snapshot is replaced
// atomically; database failures must never fall back to empty local files.
export async function connectMongo(uri, name = 'jeopardy') {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 })
  try {
    await client.connect()
    const db = client.db(name)
    await db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
    return new MongoPersistence(client, db)
  } catch (error) { await client.close(); throw error }
}

export class MongoPersistence {
  constructor(client, db) { this.client = client; this.db = db }
  async read(key, fallback) {
    const saved = await this.db.collection('state').findOne({ _id: key })
    return saved ? JSON.parse(saved.json) : fallback
  }
  async write(key, value) {
    // JSON preserves the existing on-disk format and arbitrary team/score keys.
    const json = JSON.stringify(value)
    if (Buffer.byteLength(json) > 15 * 1024 * 1024) throw new Error('Saved library exceeds the 15 MB snapshot limit. Export/archive unused games before adding more.')
    await this.db.collection('state').replaceOne({ _id: key }, { _id: key, json }, { upsert: true })
  }
  async ready() { await this.db.command({ ping: 1 }) }
  async close() { await this.client.close() }
  sessions() { return new MongoSessionStore(this.db.collection('sessions')) }
}

export class MongoSessionStore extends session.Store {
  constructor(collection) { super(); this.collection = collection }
  key(id) { return createHash('sha256').update(id).digest('hex') }
  get(id, callback) {
    this.collection.findOne({ _id: this.key(id) }).then(async (saved) => {
      if (!saved) return null
      // TTL deletion is asynchronous; enforce expiry during every read too.
      if (saved.expiresAt.getTime() <= Date.now()) { await this.collection.deleteOne({ _id: this.key(id) }); return null }
      return JSON.parse(saved.json)
    }).then((value) => callback(null, value), callback)
  }
  set(id, value, callback = () => {}) {
    const expiresAt = value.cookie?.expires ? new Date(value.cookie.expires) : new Date(Date.now() + 7 * 86400000)
    this.collection.replaceOne({ _id: this.key(id) }, { _id: this.key(id), expiresAt, json: JSON.stringify(value) }, { upsert: true }).then(() => callback(), callback)
  }
  destroy(id, callback = () => {}) { this.collection.deleteOne({ _id: this.key(id) }).then(() => callback(), callback) }
  touch(_id, _value, callback = () => {}) { callback() }
}
