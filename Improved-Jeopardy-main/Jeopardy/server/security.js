export const hostId = (user) => user?.username?.toLowerCase() || user?.id || null
export const safeId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value)

export function securityMiddleware(appUrl) {
  const origins = new Set([new URL(appUrl).origin])
  if (process.env.NODE_ENV !== 'production') origins.add('http://localhost:5173')
  const attempts = new Map()
  return (request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('X-Frame-Options', 'DENY')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'${process.env.NODE_ENV === 'production' ? '' : " 'unsafe-inline'"}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`)
    if (process.env.NODE_ENV === 'production') response.setHeader('Strict-Transport-Security', 'max-age=15552000')
    if (!request.path.startsWith('/api')) return next()
    response.setHeader('Cache-Control', 'no-store')
    if (['POST', 'PUT', 'DELETE'].includes(request.method)) {
      if ((request.headers.origin && !origins.has(request.headers.origin)) || request.headers['sec-fetch-site'] === 'cross-site') return response.status(403).json({ error: 'Cross-site requests are not allowed.' })
      if (Number(request.headers['content-length']) > 0 && !request.is('application/json')) return response.status(415).json({ error: 'Use application/json for request bodies.' })
    }
    const group = request.path === '/api/student/session' && request.method === 'POST' ? 'join' : request.path.startsWith('/api/public/games/') ? 'lookup' : request.path === '/api/auth/login' ? 'login' : 'api'
    const limit = group === 'login' ? 20 : group === 'api' ? 1200 : 120
    const key = `${request.ip}:${group}`
    const now = Date.now()
    if (attempts.size > 10000) for (const [entry, value] of attempts) if (value.until <= now) attempts.delete(entry)
    let entry = attempts.get(key)
    if (!entry || entry.until <= now) { entry = { count: 0, until: now + 60000 }; attempts.set(key, entry) }
    if (++entry.count > limit) { response.setHeader('Retry-After', Math.ceil((entry.until - now) / 1000)); return response.status(429).json({ error: 'Too many requests. Please wait and try again.' }) }
    next()
  }
}

export function validBoard(game) {
  if (!game || typeof game.title !== 'string' || game.title.length > 200 || !Array.isArray(game.teams) || game.teams.length > 50 || !Array.isArray(game.categories) || game.categories.length > 20) return false
  const ids = new Set()
  for (const category of game.categories) {
    if (!category || !safeId(category.id) || ids.has(category.id) || typeof category.title !== 'string' || category.title.length > 200 || !Array.isArray(category.clues) || category.clues.length > 50) return false
    ids.add(category.id)
    for (const clue of category.clues) {
      if (!clue || !safeId(clue.id) || ids.has(clue.id) || typeof clue.question !== 'string' || clue.question.length > 10000 || typeof clue.answer !== 'string' || clue.answer.length > 10000 || !Number.isSafeInteger(clue.value) || clue.value < 1 || clue.value > 1000000) return false
      ids.add(clue.id)
    }
  }
  if (game.finalJeopardy && (typeof game.finalJeopardy !== 'object' || Array.isArray(game.finalJeopardy) || !['category', 'question', 'answer'].every((key) => game.finalJeopardy[key] === undefined || (typeof game.finalJeopardy[key] === 'string' && game.finalJeopardy[key].length <= 10000)))) return false
  return true
}
