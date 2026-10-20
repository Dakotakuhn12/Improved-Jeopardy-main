import { useRef, useState } from 'react'
import GameJoinQRCode from './QRCode'
import { buildJoinUrl } from '../services/sharing'

export default function ShareGame({ code, title }) {
  const inputRef = useRef(null)
  const [message, setMessage] = useState('')
  let url = ''
  let error = ''
  try { if (code) url = buildJoinUrl(import.meta.env.VITE_APP_URL || window.location.origin, code) }
  catch (urlError) { error = urlError.message }
  const copy = async (value, label) => {
    try {
      await navigator.clipboard.writeText(value)
      setMessage(`${label} copied.`)
    } catch {
      inputRef.current?.focus()
      inputRef.current?.select()
      setMessage('Clipboard access is unavailable. Select and copy the join link below, or copy the displayed game code.')
    }
  }
  const share = async () => {
    try { await navigator.share({ title: title || 'Classroom Jeopardy', text: `Join our Jeopardy game. Code: ${code}`, url }); setMessage('Share completed.') }
    catch (shareError) { if (shareError.name !== 'AbortError') setMessage('Sharing was unavailable. Copy the join link instead.') }
  }
  return <section className="share-game editor-section" aria-label="Share game with students">
    <div><p className="eyebrow">STUDENT INVITATION</p><h2>Share this game</h2><p>Game code: <strong>{code || 'Generating…'}</strong></p></div>
    {url && <GameJoinQRCode url={url} code={code} />}
    <label className="title-field">Student join link<input ref={inputRef} value={url} readOnly aria-label="Student join link" onFocus={(event) => event.target.select()} /></label>
    <div className="header-actions">
      <button className="secondary-button" disabled={!url} onClick={() => copy(url, 'Join link')}>Copy join link</button>
      <button className="secondary-button" disabled={!code} onClick={() => copy(code, 'Game code')}>Copy code</button>
      {typeof navigator.share === 'function' && <button className="secondary-button" disabled={!url} onClick={share}>Share…</button>}
    </div>
    {url && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) && <p>This address works on this computer. For other devices, use your deployed app URL.</p>}
    {error && <p className="login-error" role="alert">{error}</p>}
    <p role="status">{message}</p>
  </section>
}
