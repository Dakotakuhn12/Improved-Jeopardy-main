import { useState } from 'react'
import { joinStudentSession } from '../services/gameApi'
import { joinCodeFromLocation } from '../services/sharing'

export default function JoinGame({ onJoined }) {
  const [code, setCode] = useState(() => {
    return joinCodeFromLocation(window.location)
  })
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    const trimmedCode = code.trim()

    if (!trimmedCode) {
      setError('Enter the game code to continue.')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const { record, student } = await joinStudentSession(trimmedCode, name)
      if (onJoined) onJoined({ ...record, student })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsLoading(false)
    }
  }

  return <main id="main-content" tabIndex={-1} className="login-shell">
    <section className="login-card" aria-labelledby="join-title">
      <p className="eyebrow">CLASSROOM JEOPARDY</p>
      <h1 id="join-title">Join a game</h1>
      <p>Enter the code from the host’s Microsoft sign-in session.</p>
      <form onSubmit={handleSubmit}>
        <label className="title-field" style={{ marginBottom: '16px' }}>
          Your name
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={50} required autoComplete="nickname" placeholder="Student name" />
        </label>
        <label className="title-field" style={{ marginBottom: '16px' }}>
          Game code
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="ABCD12"
            maxLength={12}
            autoComplete="off"
          />
        </label>
        {error && <p className="login-error">{error}</p>}
        <button className="microsoft-login" type="submit" disabled={isLoading} style={{ border: 'none', width: '100%' }}>
          {isLoading ? 'Checking code...' : 'Join game'}
        </button>
      </form>
    </section>
  </main>
}
