import { useState } from 'react'
import ShareGame from '../components/ShareGame'
import TeamRoster from '../components/TeamRoster'

const id = () => crypto.randomUUID()
const clue = (value = 100) => ({ id: id(), value, question: '', answer: '' })
const category = () => ({ id: id(), title: '', clues: [clue()] })

export default function GameEditor({ game, gameId, games, openGame, newGame, deleteGame, importSheet, error, ready, start, update, modifyCategory, handleLogout, showLogoutConfirm, cancelLogout, handleLogoutConfirm, roomCode }) {
  const addTeam = () => update((current) => {
    let number = 1
    while (current.teams.some((team) => team.name.trim().toLowerCase() === `team ${number}`)) number++
    return { ...current, teams: [...current.teams, { id: id(), name: `Team ${number}` }] }
  })
  const updateTeam = (teamId, name) => update((current) => ({ ...current, teams: current.teams.map((team) => team.id === teamId ? { ...team, name } : team) }))
  const addCategory = () => update((current) => ({ ...current, categories: [...current.categories, category()] }))
  const [sheetUrl, setSheetUrl] = useState('')
  const [cellRange, setCellRange] = useState('')
  const [importing, setImporting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const validTeams = game.teams.every((team) => team.name.trim() && team.name.trim().length <= 50) && new Set(game.teams.map((team) => team.name.trim().toLowerCase())).size === game.teams.length

  const gameOptions = games.some((item) => item.id === gameId)
    ? games
    : [{ id: gameId, title: game.title }, ...games]

  const submitSheetImport = async (event) => {
    event.preventDefault()
    if (!sheetUrl.trim() || importing) return
    setImporting(true)
    try {
      await importSheet(sheetUrl.trim(), cellRange.trim())
      setSheetUrl('')
      setCellRange('')
    } catch {
      // The request error is displayed by the editor.
    } finally { setImporting(false) }
  }

  const confirmDeleteGame = async () => {
    if (deleting) return
    setDeleting(true)
    const deleted = await deleteGame(gameId)
    setDeleting(false)
    if (deleted) setShowDeleteConfirm(false)
  }

  return <main className="builder-shell">
    <header className="topbar">
      <div><p className="eyebrow">GAME EDITOR</p><h1>Edit your board</h1></div>
      <div className="header-actions"><button className="new-game" disabled={!ready} onClick={start}>Start game</button><button className="logout-button" onClick={handleLogout}>Log out</button></div>
    </header>
    <a className="secondary-button" href={`/?hostDisplay=${encodeURIComponent(gameId)}`} target="_blank" rel="noopener noreferrer">Open host answer display</a>
    <ShareGame key={roomCode} code={roomCode} title={game.title} />
    <section className="game-library" aria-label="Saved games">
      <label htmlFor="saved-game-select">Open game
        <select id="saved-game-select" value={gameId} onChange={(event) => openGame(event.target.value)}>
          {gameOptions.map((item) => <option key={item.id} value={item.id}>{item.id === gameId ? game.title : item.title || 'Untitled Game'}</option>)}
        </select>
      </label>
      <button className="secondary-button" type="button" onClick={newGame}>New game</button>
      <button className="remove-button" type="button" onClick={() => setShowDeleteConfirm(true)}>Delete game</button>
    </section>
    <section className="sheet-import" aria-labelledby="sheet-import-title">
      <div><p className="eyebrow">GOOGLE SHEETS</p><h2 id="sheet-import-title">Import a game board</h2><p>Share the sheet with “Anyone with the link.” Use either Category, Question, and Answer columns, or Category followed by repeating Question/Answer pairs. A Final row can include its question, answer, and category. Optionally enter a rectangular cell range such as A1:J7; the first row in that range must contain the headers.</p></div>
      <form onSubmit={submitSheetImport}>
        <label htmlFor="google-sheet-url">Google Sheets link or ID</label>
        <div className="sheet-import-controls"><input id="google-sheet-url" type="text" value={sheetUrl} onChange={(event) => setSheetUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." /><button className="secondary-button" type="submit" disabled={!sheetUrl.trim() || importing}>{importing ? 'Importing…' : 'Import sheet'}</button></div>
        <label htmlFor="google-sheet-range">Cell range (optional)</label>
        <input className="range-input" id="google-sheet-range" type="text" value={cellRange} onChange={(event) => setCellRange(event.target.value)} placeholder="A1:J7" />
      </form>
    </section>
    {error && <p className="login-error" role="alert">{error}</p>}
    <p className="builder-intro">Edit the title, teams, categories, questions, and answers. Point values are assigned automatically, and changes save automatically.</p>
    <label className="title-field">Game title<input value={game.title} onChange={(event) => update((current) => ({ ...current, title: event.target.value }))} /></label>
    <section className="editor-section">
      <div className="section-heading"><h2>Teams</h2><button className="secondary-button" onClick={addTeam}>Add team</button></div>
      <p>Use a different name for each team (1–50 characters). Removing a team unassigns its students and removes its score.</p>
      {!validTeams && <p className="login-error" role="alert">Give every team a unique, nonempty name of at most 50 characters.</p>}
      <div className="team-editor">{game.teams.map((team, index) => <div className="team-row" key={team.id}><input aria-label={`Team ${index + 1}`} value={team.name} onChange={(event) => updateTeam(team.id, event.target.value)} /><button className="remove-button" onClick={() => update((current) => ({ ...current, teams: current.teams.filter((item) => item.id !== team.id) }))}>Remove</button></div>)}</div>
    </section>
    <TeamRoster key={gameId} gameId={gameId} teams={game.teams} />
    <section className="editor-section">
      <div className="section-heading"><h2>Categories and questions</h2><button className="secondary-button" onClick={addCategory}>Add category</button></div>
      <div className="category-editor-list">{game.categories.map((cat, categoryIndex) => <CategoryEditor key={cat.id} cat={cat} index={categoryIndex} modify={modifyCategory} remove={() => update((current) => ({ ...current, categories: current.categories.filter((item) => item.id !== cat.id) }))} />)}</div>
    </section>
    <section className="editor-section final-editor">
      <div className="section-heading"><h2>Final Jeopardy</h2></div>
      <div className="final-editor-fields">
        <label>Category<input value={game.finalJeopardy?.category || ''} onChange={(event) => update((current) => ({ ...current, finalJeopardy: { ...current.finalJeopardy, category: event.target.value } }))} placeholder="Category" /></label>
        <label>Question<textarea value={game.finalJeopardy?.question || ''} onChange={(event) => update((current) => ({ ...current, finalJeopardy: { ...current.finalJeopardy, question: event.target.value } }))} placeholder="Final Jeopardy question" /></label>
        <label>Answer<textarea value={game.finalJeopardy?.answer || ''} onChange={(event) => update((current) => ({ ...current, finalJeopardy: { ...current.finalJeopardy, answer: event.target.value } }))} placeholder="Correct response" /></label>
      </div>
      <p className="builder-intro">This round appears after every board question has been answered. All teams wager up to their current score.</p>
    </section>
    {!ready && <p className="validation-message">Each category needs a title and at least one question with a value and answer before the game can start.</p>}
    {showLogoutConfirm && <div className="modal-backdrop" role="presentation" onMouseDown={cancelLogout}><section className="logout-confirmation" role="dialog" aria-modal="true" aria-label="Confirm sign out" onMouseDown={(event) => event.stopPropagation()}><h2>Sign out of Microsoft?</h2><p>You’ll need to sign in again to access the game.</p><div className="logout-actions"><button className="secondary-button" onClick={cancelLogout}>Cancel</button><button className="logout-button" onClick={handleLogoutConfirm}>Yes, sign out</button></div></section></div>}
    {showDeleteConfirm && <div className="modal-backdrop" role="presentation" onMouseDown={() => !deleting && setShowDeleteConfirm(false)}><section className="logout-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="delete-game-title" onMouseDown={(event) => event.stopPropagation()}><h2 id="delete-game-title">Delete “{game.title || 'Untitled Game'}”?</h2><p>This will permanently delete this game and its saved progress.</p><div className="logout-actions"><button className="secondary-button" type="button" disabled={deleting} onClick={() => setShowDeleteConfirm(false)}>Cancel</button><button className="logout-button" type="button" disabled={deleting} onClick={confirmDeleteGame}>{deleting ? 'Deleting…' : 'Yes, delete game'}</button></div></section></div>}
  </main>
}

function CategoryEditor({ cat, index, modify, remove }) {
  const updateClue = (clueId, field, value) => modify(cat.id, (current) => ({ ...current, clues: current.clues.map((item) => item.id === clueId ? { ...item, [field]: value } : item) }))
  return <article className="category-editor">
    <div className="category-editor-title">
      <input aria-label={`Category ${index + 1} title`} value={cat.title} placeholder={`Category ${index + 1} title`} onChange={(event) => modify(cat.id, (current) => ({ ...current, title: event.target.value }))} />
      <button className="remove-button" onClick={remove}>Remove category</button>
    </div>
    <div className="clue-editor-list">{cat.clues.map((item, questionIndex) => <div className="clue-editor" key={item.id}>
      <label>Point value (fixed)<input type="number" min="1" value={item.value} readOnly aria-label={`Question ${questionIndex + 1} point value`} /></label>
      <label>Question<textarea value={item.question} onChange={(event) => updateClue(item.id, 'question', event.target.value)} placeholder="Question" /></label>
      <label>Answer<textarea value={item.answer} onChange={(event) => updateClue(item.id, 'answer', event.target.value)} placeholder="Correct response" /></label>
      <button className="remove-button" aria-label={`Remove question ${questionIndex + 1}`} onClick={() => modify(cat.id, (current) => ({ ...current, clues: current.clues.filter((clueItem) => clueItem.id !== item.id) }))}>Remove</button>
    </div>)}</div>
    <button className="add-clue" onClick={() => modify(cat.id, (current) => ({ ...current, clues: [...current.clues, clue((current.clues.length + 1) * 100)] }))}>+ Add question</button>
  </article>
}
