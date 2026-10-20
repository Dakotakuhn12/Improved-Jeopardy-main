import Buzzer from './Buzzer'

export default function QuestionCard({ gameId, selected, showAnswer, teams, onClose, onReveal, onScore, onFinish }) {
  if (!selected) return null

  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="clue-modal" role="dialog" aria-modal="true" aria-label="Selected question" onMouseDown={(event) => event.stopPropagation()}>
      <button className="close" onClick={onClose} aria-label="Close question">×</button>
      <p className="modal-category">{selected.cat.title} · ${Number(selected.item.value).toLocaleString()}</p>
      <p className="clue-text">{showAnswer ? selected.item.answer : selected.item.question}</p>
      <Buzzer key={gameId} gameId={gameId} role="host" />
      {showAnswer
        ? <div className="scoring"><p>Who got it right?</p><div>{teams.map((team) => <button className="team-score" key={team.id} onClick={() => onScore(team.id)}>+ {team.name || 'Unnamed team'}</button>)}</div><button className="no-one" onClick={onFinish}>No correct answer</button></div>
        : <button className="reveal" onClick={onReveal}>Reveal answer</button>}
    </section>
  </div>
}
