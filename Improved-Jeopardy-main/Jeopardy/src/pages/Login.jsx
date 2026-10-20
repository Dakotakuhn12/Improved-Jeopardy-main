export default function Login({ error, onJoin }) {
  return <main className="login-shell">
    <section className="login-card" aria-labelledby="login-title">
      <p className="eyebrow">CLASSROOM JEOPARDY</p>
      <h1 id="login-title">Welcome</h1>
      <p>Sign in with your school Outlook or Microsoft account to open the game board.</p>
      {error && <p className="login-error">{error}</p>}
      <a className="microsoft-login" href="/api/auth/login">Continue with Outlook</a>
      <button className="secondary-button" type="button" onClick={onJoin} style={{ marginTop: '16px', width: '100%' }}>Join with a game code</button>
    </section>
  </main>
}
