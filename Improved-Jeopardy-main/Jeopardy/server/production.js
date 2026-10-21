export function checkProduction({ appUrl, redirectUri, tenantId, clientId, clientSecret, built, dataDirectory }) {
  if (process.env.NODE_ENV !== 'production') return
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) throw new Error('Production requires a SESSION_SECRET of at least 32 characters.')
  let origin
  try { origin = new URL(appUrl) } catch { throw new Error('Production requires a valid HTTPS APP_URL.') }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error('Production APP_URL must be an HTTPS origin without a path or credentials.')
  if (redirectUri !== `${origin.origin}/api/auth/callback`) throw new Error('Production MS_ENTRA_REDIRECT_URI must match APP_URL/api/auth/callback.')
  if (!tenantId || !clientId || !clientSecret) throw new Error('Production requires Microsoft Entra tenant, client ID, and client secret.')
  if (!dataDirectory && !process.env.MONGODB_URI) throw new Error('Production requires MONGODB_URI or JEOPARDY_DATA_DIR pointing to persistent storage.')
  if (!built) throw new Error('Production frontend is missing. Run npm run build before starting the API.')
}
