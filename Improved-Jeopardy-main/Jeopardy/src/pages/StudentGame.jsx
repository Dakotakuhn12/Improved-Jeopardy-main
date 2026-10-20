import { useState } from 'react'
import ConnectionStatus from '../components/ConnectionStatus'
import Buzzer from '../components/Buzzer'

export default function StudentGame({ game: initialGame, onBack, onExpired }) {
  const [game, setGame] = useState(initialGame)
  const [error, setError] = useState('')
  const [leaving, setLeaving] = useState(false)

  const leave = async () => {
    setLeaving(true)
    try { await onBack() } catch (requestError) { setError(requestError.message); setLeaving(false) }
  }
  return <main className="game-shell">
    <header className="topbar">
      <div>
        <p className="eyebrow">LIVE GAME</p>
        <h1>{game?.game?.title || 'Classroom Jeopardy'}</h1>
        <p>Your team: {game.game.teams.find((team) => team.id === game.student?.teamId)?.name || 'Waiting for the host to assign a team'}</p>
        <p>Joined as {game.student?.name} · Game {game.code}</p>
      </div>
      <button className="secondary-button" onClick={leave} disabled={leaving}>{leaving ? 'Leaving…' : 'Leave game'}</button>
    </header>
    <ConnectionStatus key={game.id} gameId={game.id} role="student" onGameState={(record) => setGame((current) => ({ ...record, student: current.student }))} onStudentUpdate={(student) => setGame((current) => ({ ...current, student }))} onSessionEnded={onExpired} />
    {game.live?.phase === 'editor' && <p className="hint">The host is preparing the game.</p>}
    <Buzzer key={game.id} gameId={game.id} role="student" student={game.student} />
    {game.live?.activeClue && <section className="editor-section" aria-label="Current question">
      <p className="eyebrow">{game.live.activeClue.category} · ${game.live.activeClue.value}</p>
      <h2>{game.live.answerRevealed ? 'Answer' : 'Current question'}</h2>
      <p className="clue-text">{game.live.answerRevealed ? game.live.activeClue.answer : game.live.activeClue.question}</p>
    </section>}
    {game.live?.finalOpen && <section className="editor-section" aria-label="Final Jeopardy">
      <h2>Final Jeopardy</h2><p>{game.game.finalJeopardy?.category}</p>
      <p className="clue-text">{game.progress.finalRevealed ? game.game.finalJeopardy?.answer : game.game.finalJeopardy?.question}</p>
    </section>}
    {error && <p className="login-error" role="alert">{error}</p>}

    <section className="scoreboard" aria-label="Scoreboard">
      {(game?.game?.teams || []).map((team, index) => (
        <article key={team.id} className={`score-card ${index % 2 ? 'pink' : 'gold'}`}>
          <span>{team.name || `Team ${index + 1}`}</span>
          {team.id === game.student?.teamId && <span>Your team</span>}
          <strong>{String(game.progress?.scores?.[team.id] || 0)}</strong>
        </article>
      ))}
    </section>

    {game?.game?.categories?.length ? <section className="board" aria-label="Jeopardy game board" style={{ '--columns': game.game.categories.length }}>
      {game.game.categories.map((cat) => (
        <div className="category" key={cat.id}>
          <div className="category-title">{cat.title}</div>
          {cat.clues.map((item) => (
            <button key={item.id} className="clue" disabled>{game.progress?.usedClues?.includes(item.id) ? '' : `$${Number(item.value).toLocaleString()}`}</button>
          ))}
        </div>
      ))}
    </section> : <p className="hint">This game is loading…</p>}
  </main>
}
