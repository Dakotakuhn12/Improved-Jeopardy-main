import { useState } from 'react'
import ConnectionStatus from '../components/ConnectionStatus'

export default function HostDisplay({ gameId }) {
  const [record, setRecord] = useState(null)
  const [ended, setEnded] = useState(false)
  const [buzzer, setBuzzer] = useState(null)
  const clue = record?.live?.activeClue
  const final = record?.live?.finalOpen ? record.game.finalJeopardy : null
  return <main id="main-content" tabIndex={-1} className="game-shell host-answer-display">
    <header className="topbar"><div><p className="eyebrow">PRIVATE HOST ANSWER DISPLAY</p><h1>{record?.game.title || 'Host answer display'}</h1></div><a className="secondary-button" href="/">Open game controls</a></header>
    <p>Keep this screen on your own device. It shows answers before students see them.</p>
    <ConnectionStatus gameId={gameId} role="host" onHostState={(state) => { setRecord(state); setEnded(false) }} onBuzzerState={setBuzzer} onSessionEnded={() => { setRecord(null); setEnded(true) }} />
    {ended ? <p role="alert">This game or host session ended. Sign in again or open another game.</p> : !record ? <p>Waiting for host authorization and game state. If disconnected, sign in through the game controls, then refresh this display.</p> : <>
      <p className="eyebrow">Game code: {record.code}</p>
      {clue || final ? <section className="editor-section">
        <p className="eyebrow">{final ? 'Final Jeopardy' : `${clue.category} · $${clue.value}`}</p>
        <h2>Question</h2><p className="clue-text">{final ? final.question : clue.question}</p>
        <div className="host-private-answer"><h2>Correct answer — host only</h2><p className="clue-text">{final ? final.answer : clue.answer}</p></div>
        <p>Student answer display: {(final ? record.progress.finalRevealed : record.live.answerRevealed) ? 'Revealed' : 'Hidden'}</p>
      </section> : <section className="editor-section"><h2>{record.live.phase === 'editor' ? 'The game is being edited' : 'Waiting for the next question'}</h2><p>Select a question from the game controls.</p></section>}
      {buzzer?.winner && <p role="status">First buzz: {buzzer.winner.name} ({buzzer.winner.teamName})</p>}
      <section className="scoreboard" aria-label="Scores">{record.game.teams.map((team) => <article className="score-card gold" key={team.id}><span>{team.name}</span><strong>{record.progress.scores[team.id] || 0}</strong></article>)}</section>
    </>}
  </main>
}
