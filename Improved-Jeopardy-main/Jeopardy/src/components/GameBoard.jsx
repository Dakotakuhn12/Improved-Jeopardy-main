import ConnectionStatus from './ConnectionStatus'
import ShareGame from './ShareGame'
import { useState } from 'react'
import TeamScore from './TeamScore'
import QuestionCard from './QuestionCard'
import LogoutConfirmation from './Modal'
import FinalJeopardy from './FinalJeopardy'

function Board({ gameId, game, scores, used, selected, showAnswer, onOpenClue, onCloseClue, onRevealAnswer, onScore, onFinish, onEdit, onReset, onLogout, logoutOpen, onCancelLogout, onConfirmLogout, allCluesAnswered, finalJeopardyReady, finalResolved, finalOpen, onBeginFinal, finalWagers, onSetFinalWager, finalRevealed, onRevealFinal, finalOutcomes, onSetFinalOutcome, onResolveFinal, onCloseFinal }) {
  return <main className="game-shell">
    <header className="topbar"><div><p className="eyebrow">LIVE GAME</p><h1>{game.title}</h1></div><div className="header-actions"><button className="secondary-button" onClick={onEdit}>Game editor</button><button className="new-game" onClick={onReset}>Replay game</button><button className="logout-button" onClick={onLogout}>Log out</button></div></header>
    <section className="scoreboard" aria-label="Scoreboard">{game.teams.map((team, index) => <TeamScore key={team.id} label={team.name || `Team ${index + 1}`} score={scores[team.id] || 0} tone={index % 2 ? 'pink' : 'gold'} />)}</section>
    <section className="board" aria-label="Jeopardy game board" style={{ '--columns': game.categories.length }}>{game.categories.map((category) => <div className="category" key={category.id}><div className="category-title">{category.title}</div>{category.clues.map((item) => <button key={item.id} className={`clue ${used.includes(item.id) ? 'used' : ''}`} disabled={used.includes(item.id)} onClick={() => onOpenClue(item.id)}>{used.includes(item.id) ? '' : `$${Number(item.value).toLocaleString()}`}</button>)}</div>)}</section>
    <p className="hint">Select a question, reveal its answer, then award its configured value.</p>
    {allCluesAnswered && finalJeopardyReady && <section className="final-jeopardy-launch"><div><p className="eyebrow">FINAL JEOPARDY</p><h2>{finalResolved ? 'Final Jeopardy is complete' : 'The board is clear'}</h2></div>{!finalResolved && <button className="new-game" onClick={onBeginFinal}>Start Final Jeopardy</button>}</section>}
    <QuestionCard gameId={gameId} selected={selected} showAnswer={showAnswer} teams={game.teams} onClose={onCloseClue} onReveal={onRevealAnswer} onScore={onScore} onFinish={onFinish} />
    <FinalJeopardy open={finalOpen} finalJeopardy={game.finalJeopardy} teams={game.teams} scores={scores} wagers={finalWagers} onWagerChange={onSetFinalWager} revealed={finalRevealed} onReveal={onRevealFinal} outcomes={finalOutcomes} onOutcomeChange={onSetFinalOutcome} onResolve={onResolveFinal} onClose={onCloseFinal} />
    <LogoutConfirmation open={logoutOpen} onCancel={onCancelLogout} onConfirm={onConfirmLogout} />
  </main>
}

export default function GameBoard(props) {
  const [confirmReplay, setConfirmReplay] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const replay = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try { await props.onReplay(); setConfirmReplay(false) }
    catch (requestError) { setError(requestError.message) }
    finally { setBusy(false) }
  }
  return <>
    <ConnectionStatus key={props.gameId} gameId={props.gameId} role="host" />
    <a className="secondary-button" href={`/?hostDisplay=${encodeURIComponent(props.gameId)}`} target="_blank" rel="noopener noreferrer">Open host answer display</a>
    <Board {...props} onReset={() => setConfirmReplay(true)} />
    <ShareGame key={props.roomCode} code={props.roomCode} title={props.game.title} />
    {confirmReplay && <div className="modal-backdrop"><section className="logout-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="replay-title">
      <h2 id="replay-title">Replay this game?</h2>
      <p>This clears scores, used questions, Final Jeopardy progress, and the buzzer. Your board, teams, game code, and joined students stay the same.</p>
      {error && <p className="login-error" role="alert">{error}</p>}
      <div className="logout-actions"><button className="secondary-button" disabled={busy} onClick={() => setConfirmReplay(false)}>Cancel</button><button className="new-game" disabled={busy} onClick={replay}>{busy ? 'Starting replay…' : 'Replay game'}</button></div>
    </section></div>}
  </>
}
