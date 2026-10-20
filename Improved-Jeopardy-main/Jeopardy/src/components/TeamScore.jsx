export default function TeamScore({ label, score, tone }) {
  return <article className={`score-card ${tone}`}><span>{label}</span><strong>${score.toLocaleString()}</strong></article>
}
