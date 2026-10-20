import { useState } from 'react'

export default function HostGame({ game, onBack }) {
  const [copied, setCopied] = useState(false)

  const copyCode = async () => {
    if (!game?.code) return
    try {
      await navigator.clipboard.writeText(game.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  return <main className="login-shell">
    <section className="login-card" aria-labelledby="host-title" style={{ width: 'min(560px, 100%)' }}>
      <p className="eyebrow">HOST ROOM</p>
      <h1 id="host-title">Game code</h1>
      <p>Share this code with players so they can join the game.</p>
      <div className="title-field" style={{ marginBottom: '20px' }}>
        <input readOnly value={game?.code || ''} style={{ textAlign: 'center', fontSize: '2rem', letterSpacing: '.2em' }} />
      </div>
      <button className="secondary-button" type="button" onClick={copyCode} style={{ width: '100%', marginBottom: '12px' }}>
        {copied ? 'Copied!' : 'Copy code'}
      </button>
      <button className="microsoft-login" type="button" onClick={onBack} style={{ width: '100%' }}>
        Back to dashboard
      </button>
    </section>
  </main>
}
