export function buildJoinUrl(base, code) {
  const normalized = String(code || '').trim().toUpperCase()
  if (!/^[A-Z0-9]{4,12}$/.test(normalized)) throw new Error('A valid game code is required to share this game.')
  const url = new URL(base)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP or HTTPS app URL without login credentials.')
  url.search = ''
  url.hash = ''
  url.searchParams.set('join', '1')
  url.searchParams.set('code', normalized)
  return url.toString()
}

export function joinCodeFromLocation(location) {
  const params = new URLSearchParams(location.search)
  const hashParams = new URLSearchParams((location.hash || '').split('?')[1] || '')
  return (params.get('code') || hashParams.get('code') || '').trim().toUpperCase()
}

export function canResumeSharedGame(location, record) {
  const requested = joinCodeFromLocation(location)
  return !requested || requested === record.code?.toUpperCase()
}
