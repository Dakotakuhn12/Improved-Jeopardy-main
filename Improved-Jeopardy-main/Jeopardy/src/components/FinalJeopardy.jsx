import useDialog from '../hooks/useDialog'

export default function FinalJeopardy({ open, finalJeopardy, teams, scores, wagers, onWagerChange, revealed, onReveal, outcomes, onOutcomeChange, onResolve, onClose }) {
  const dialogRef = useDialog(open, onClose)
  if (!open) return null

  const wagersAreValid = teams.every((team) => {
    const wager = Number(wagers[team.id])
    return wagers[team.id] !== undefined && String(wagers[team.id]).trim() !== '' && Number.isInteger(wager) && wager >= 0 && wager <= Math.max(0, Number(scores[team.id]) || 0)
  })
  const outcomesAreSet = teams.length > 0 && teams.every((team) => typeof outcomes[team.id] === 'boolean')

  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section ref={dialogRef} tabIndex={-1} className="clue-modal final-jeopardy-modal" role="dialog" aria-modal="true" aria-labelledby="final-jeopardy-heading" onMouseDown={(event) => event.stopPropagation()}>
      <button className="close" onClick={onClose} aria-label="Close Final Jeopardy">×</button>
      <p className="modal-category">FINAL JEOPARDY · {finalJeopardy.category}</p>
      <h2 id="final-jeopardy-heading">{finalJeopardy.question}</h2>
      {!revealed ? <>
        <p>Each team wagers up to its current score before the answer is revealed.</p>
        <div className="final-wagers">{teams.map((team) => <label key={team.id}>{team.name || 'Unnamed team'} <span>Current score: ${Number(scores[team.id] || 0).toLocaleString()}</span><input type="number" min="0" max={Math.max(0, Number(scores[team.id]) || 0)} step="1" value={wagers[team.id] ?? ''} onChange={(event) => onWagerChange(team.id, event.target.value)} aria-label={`${team.name || 'Team'} wager`} /></label>)}</div>
        <button className="reveal" disabled={!wagersAreValid} onClick={onReveal}>Lock wagers and reveal answer</button>
      </> : <>
        <div className="final-answer"><p className="eyebrow">ANSWER</p><p>{finalJeopardy.answer}</p></div>
        <p>Mark whether each team answered correctly. Correct teams gain their wager; other teams lose it.</p>
        <div className="final-outcomes">{teams.map((team) => <div className="final-outcome-row" key={team.id}><strong>{team.name || 'Unnamed team'} · ${Number(wagers[team.id] || 0).toLocaleString()} wager</strong><div><button className={outcomes[team.id] === true ? 'is-selected' : ''} onClick={() => onOutcomeChange(team.id, true)}>Correct</button><button className={outcomes[team.id] === false ? 'is-selected' : ''} onClick={() => onOutcomeChange(team.id, false)}>Incorrect</button></div></div>)}</div>
        <button className="reveal" disabled={!outcomesAreSet} onClick={onResolve}>Apply Final Jeopardy scores</button>
      </>}
    </section>
  </div>
}
