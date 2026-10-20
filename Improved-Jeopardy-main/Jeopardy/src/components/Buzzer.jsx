import { useState } from 'react'
import useSockets from '../hooks/useSockets'

export default function Buzzer({ gameId, role, student }) {
  const [buzzer, setBuzzer] = useState(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const { status, buzzerAction } = useSockets(gameId, role, { onBuzzerState: (state) => { setBuzzer(state); setError('') } })
  const act = async (action) => {
    if (pending) return
    setPending(true)
    setError('')
    try { await buzzerAction(role === 'host' ? 'buzzer:control' : 'buzzer:press', { clueId: buzzer?.clueId, roundId: buzzer?.roundId, action }) }
    catch (requestError) { setError(requestError.message) }
    finally { setPending(false) }
  }
  const available = status === 'Connected' && buzzer?.clueId && !pending
  return <section className="buzzer-panel" aria-label="Game buzzer">
    <p role="status">{buzzer?.winner ? `${buzzer.winner.name} (${buzzer.winner.teamName}) buzzed first!` : buzzer?.status === 'open' ? 'Buzzer is open!' : 'Waiting for the host to open the buzzer.'}</p>
    {role === 'host' ? <div className="header-actions">
      <button className="secondary-button" disabled={!available || buzzer?.status === 'open'} onClick={() => act('open')}>Open buzzer</button>
      <button className="secondary-button" disabled={!available} onClick={() => act('reset')}>Reset buzzer</button>
      <button className="secondary-button" disabled={!available || buzzer?.status === 'closed'} onClick={() => act('close')}>Close buzzer</button>
    </div> : <>
      <button className="buzz-button" disabled={!available || buzzer?.status !== 'open' || !student?.teamId} onClick={() => act()}>BUZZ!</button>
      {!student?.teamId && <p>Wait for the host to assign your team.</p>}
    </>}
    {status !== 'Connected' && <p>Live connection: {status}</p>}
    {error && <p className="login-error" role="alert">{error}</p>}
  </section>
}
