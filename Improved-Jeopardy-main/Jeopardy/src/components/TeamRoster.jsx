import { useEffect, useState } from 'react'
import { assignStudentTeam, balanceStudentTeams, getGame, listStudents, removeStudent } from '../services/gameApi'
import ConnectionStatus from './ConnectionStatus'

export default function TeamRoster({ gameId, teams }) {
  const [students, setStudents] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [savedTeamIds, setSavedTeamIds] = useState('')
  const teamIds = JSON.stringify(teams.map((team) => team.id).sort())
  const waitingForSave = savedTeamIds !== teamIds
  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const [roster, record] = await Promise.all([listStudents(gameId), getGame(gameId)])
        if (active) { setStudents(roster); setSavedTeamIds(JSON.stringify(record.game.teams.map((team) => team.id).sort())); setError('') }
      } catch (requestError) { if (active) setError(requestError.message) }
    }
    refresh()
    return () => { active = false }
  }, [gameId])
  const manage = async (action) => {
    setBusy(true)
    try { await action(); setStudents(await listStudents(gameId)); setError('') }
    catch (requestError) { setError(requestError.message) }
    finally { setBusy(false) }
  }
  return <section className="editor-section" aria-label="Student team management">
    <ConnectionStatus gameId={gameId} role="host" onRosterUpdate={setStudents} onGameState={(record) => setSavedTeamIds(JSON.stringify(record.game.teams.map((team) => team.id).sort()))} />
    <div className="section-heading"><h2>Student roster ({students.length})</h2><button className="secondary-button" disabled={busy || waitingForSave || !students.length || !teams.length} onClick={() => manage(() => balanceStudentTeams(gameId))}>Assign evenly</button></div>
    {waitingForSave && <p role="status">Waiting for team changes to save…</p>}
    <p>Assign students to teams below. Assign evenly redistributes everyone.</p>
    <p>{teams.map((team) => `${team.name}: ${students.filter((student) => student.teamId === team.id).length}`).join(' · ')}{teams.length ? ' · ' : ''}Unassigned: {students.filter((student) => !teams.some((team) => team.id === student.teamId)).length}</p>
    {error && <p className="login-error" role="alert">{error}</p>}
    {!students.length && <p>No students have joined this game yet.</p>}
    <div className="team-editor">{students.map((student) => <div className="team-row" key={student.id}>
      <span>{student.name}</span>
      <select aria-label={`Team for ${student.name}`} value={teams.some((team) => team.id === student.teamId) ? student.teamId : ''} disabled={busy || waitingForSave} onChange={(event) => manage(() => assignStudentTeam(gameId, student.id, event.target.value || null))}>
        <option value="">Unassigned</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
      </select>
      <button className="remove-button" disabled={busy} onClick={() => manage(() => removeStudent(gameId, student.id))}>Remove student</button>
    </div>)}</div>
  </section>
}
