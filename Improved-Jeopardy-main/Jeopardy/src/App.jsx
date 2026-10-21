import HostDisplay from './pages/HostDisplay'
import { canResumeSharedGame } from './services/sharing'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createGame, deleteGame as deleteSavedGame, getGame, importGoogleSheet, listGames, resetProgress, saveGame, saveProgress } from './services/gameApi'
import Login from './pages/Login'
import JoinGame from './pages/JoinGame'
import StudentGame from './pages/StudentGame'
import GameEditor from './pages/GameEditor'
import GameBoard from './components/GameBoard'
import './index.css'
import './mobile.css'
import { getStudentSession, leaveStudentSession, saveLiveState, replayGame } from './services/gameApi'

function GameApp() {
  const [auth, setAuth] = useState(null)
  const [authError, setAuthError] = useState('')
  const [game, setGame] = useState(null)
  const [gameId, setGameId] = useState(null)
  const [games, setGames] = useState([])
  const [editing, setEditing] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [showAnswer, setShowAnswer] = useState(false)
  const [used, setUsed] = useState([])
  const [scores, setScores] = useState({})
  const [loaded, setLoaded] = useState(false)
  const [finalWagers, setFinalWagers] = useState({})
  const [finalOutcomes, setFinalOutcomes] = useState({})
  const [finalRevealed, setFinalRevealed] = useState(false)
  const [finalResolved, setFinalResolved] = useState(false)
  const [finalOpen, setFinalOpen] = useState(false)
  const [error, setError] = useState('')
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [joinMode, setJoinMode] = useState(() => {
    if (typeof window === 'undefined') return false
    const params = new URLSearchParams(window.location.search)
    const hashQuery = window.location.hash.includes('?') ? window.location.hash.split('?')[1] : ''
    const hashParams = new URLSearchParams(hashQuery)
    return params.get('join') === '1' || hashParams.get('join') === '1' || !!params.get('code') || !!hashParams.get('code')
  })
  const [guestGame, setGuestGame] = useState(null)
  const [checkingStudent, setCheckingStudent] = useState(true)
  const [roomCode, setRoomCode] = useState('')
  const [replaying, setReplaying] = useState(false)
  const pendingSaves = useRef(Promise.resolve())

  useEffect(() => {
    let active = true
    getStudentSession().then(({ record, student }) => {
      if (active && record && student && canResumeSharedGame(window.location, record)) setGuestGame({ ...record, student })
    }).catch(() => {}).finally(() => { if (active) setCheckingStudent(false) })
    return () => { active = false }
  }, [])

  const leaveStudent = async () => {
    await leaveStudentSession()
    setGuestGame(null)
    setJoinMode(true)
  }

  const applyProgress = (progress) => {
    setScores(progress.scores || {})
    setUsed(progress.usedClues || [])
    setFinalWagers(progress.finalWagers || {})
    setFinalOutcomes(progress.finalOutcomes || {})
    setFinalRevealed(Boolean(progress.finalRevealed))
    setFinalResolved(Boolean(progress.finalResolved))
  }

  const readJoinCodeFromUrl = () => {
    if (typeof window === 'undefined') return ''
    const params = new URLSearchParams(window.location.search)
    const hashQuery = window.location.hash.includes('?') ? window.location.hash.split('?')[1] : ''
    const hashParams = new URLSearchParams(hashQuery)
    return params.get('code')?.trim().toUpperCase() || hashParams.get('code')?.trim().toUpperCase() || ''
  }

  useEffect(() => {
    let active = true
    fetch('/api/auth/me').then(async (response) => {
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Unable to check your sign-in status.')
      if (active) setAuth(body.authenticated)
    }).catch((requestError) => {
      if (active) { setAuth(false); setAuthError(requestError.message) }
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    const loadGames = async () => {
      try {
        let savedGames = await listGames()
        const rememberedId = window.localStorage.getItem('jeopardy.activeGameId')
        const selected = savedGames.find((item) => item.id === rememberedId)
          || savedGames.find((item) => item.id === 'default')
          || savedGames[0]
        const record = selected ? await getGame(selected.id) : await createGame()
        if (!active) return
        if (!savedGames.length) savedGames = [{ id: record.id, title: record.game.title, createdAt: record.createdAt, updatedAt: record.updatedAt }]
        setGames(savedGames)
        setGameId(record.id)
        setGame(record.game)
        applyProgress(record.progress)
        setEditing(record.live?.phase !== 'playing')
        setSelectedId(record.live?.activeClueId || null)
        setShowAnswer(Boolean(record.live?.answerRevealed))
        setFinalOpen(Boolean(record.live?.finalOpen))
        setRoomCode(record.code || '')
        setLoaded(true)
      } catch (requestError) {
        if (active) setError(requestError.message)
      }
    }
    if (auth) loadGames()
    return () => { active = false }
  }, [auth])

  useEffect(() => {
    if (gameId) window.localStorage.setItem('jeopardy.activeGameId', gameId)
  }, [gameId])

  useEffect(() => {
    if (replaying || joinMode || !auth || guestGame || !loaded || !game || !gameId) return undefined
    const timer = setTimeout(() => {
      pendingSaves.current = pendingSaves.current.catch(() => {}).then(() => saveGame(gameId, game)
        .then(async (record) => {
          await saveProgress(gameId, scores, used, finalWagers, finalOutcomes, finalRevealed, finalResolved)
          await saveLiveState(gameId, { phase: editing ? 'editor' : 'playing', activeClueId: selectedId, answerRevealed: showAnswer, finalOpen })
          setError('')
          return record
        })
        .then((record) => setGames((current) => current.map((item) => item.id === record.id ? { ...item, title: record.game.title, updatedAt: record.updatedAt } : item)))
        .catch((requestError) => setError(requestError.message)))
    }, 500)
    return () => clearTimeout(timer)
  }, [game, gameId, scores, used, finalWagers, finalOutcomes, finalRevealed, finalResolved, loaded, auth, guestGame, editing, selectedId, showAnswer, finalOpen, replaying, joinMode])

  const openGame = async (nextGameId) => {
    try {
      const record = await getGame(nextGameId)
      setGameId(record.id)
      setGame(record.game)
      applyProgress(record.progress)
      setEditing(record.live?.phase !== 'playing')
      setRoomCode(record.code || '')
      setSelectedId(record.live?.activeClueId || null)
      setShowAnswer(Boolean(record.live?.answerRevealed))
      setFinalOpen(Boolean(record.live?.finalOpen))
      setError('')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  const newGame = async () => {
    try {
      const record = await createGame()
      setEditing(true)
      setGames((current) => [{ id: record.id, title: record.game.title, createdAt: record.createdAt, updatedAt: record.updatedAt }, ...current])
      setGameId(record.id)
      setGame(record.game)
      applyProgress(record.progress)
      setRoomCode(record.code || '')
      setSelectedId(null)
      setShowAnswer(false)
      setFinalOpen(false)
      setError('')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  const deleteGame = async (deletedGameId) => {
    try {
      await deleteSavedGame(deletedGameId)
      const remainingGames = await listGames()
      setGames(remainingGames)
      setError('')
      if (deletedGameId === gameId) {
        if (remainingGames.length) await openGame(remainingGames[0].id)
        else await newGame()
      }
      return true
    } catch (requestError) {
      setError(requestError.message)
      return false
    }
  }

  const importSheet = async (sheetUrl, cellRange) => {
    try {
      // Preserve the current draft even if import finishes before autosave's delay.
      await pendingSaves.current
      const saved = await saveGame(gameId, game)
      const record = await importGoogleSheet(sheetUrl, cellRange)
      setGames((current) => [{ id: record.id, title: record.game.title, createdAt: record.createdAt, updatedAt: record.updatedAt }, ...current.map((item) => item.id === saved.id ? { ...item, title: saved.game.title, updatedAt: saved.updatedAt } : item)])
      setGameId(record.id)
      setEditing(true)
      setGame(record.game)
      applyProgress(record.progress)
      setRoomCode(record.code || '')
      setSelectedId(null)
      setShowAnswer(false)
      setFinalOpen(false)
      setError('')
    } catch (requestError) {
      setError(requestError.message)
      throw requestError
    }
  }

  const selected = useMemo(() => (game?.categories ?? []).flatMap((cat) => cat.clues.map((item) => ({ cat, item }))).find(({ item }) => item.id === selectedId), [game, selectedId])

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
      setAuth(false)
      setAuthError('')
      setError('')
      setShowLogoutConfirm(false)
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  const confirmLogout = () => setShowLogoutConfirm(true)
  const cancelLogout = () => setShowLogoutConfirm(false)

  if (checkingStudent) return <main id="main-content" tabIndex={-1} className="status-shell"><p>Checking student session…</p></main>
  if (guestGame) return <StudentGame game={guestGame} onBack={leaveStudent} onExpired={() => { setGuestGame(null); setJoinMode(true) }} />
  if (auth === null) return <main id="main-content" tabIndex={-1} className="status-shell"><p>Checking sign-in…</p></main>
  if (joinMode || readJoinCodeFromUrl()) return <JoinGame onJoined={(record) => { setGuestGame(record); setJoinMode(false) }} />
  if (!auth) return <Login error={authError} onJoin={() => setJoinMode(true)} />
  if (error && !loaded) return <main id="main-content" tabIndex={-1} className="status-shell"><h1>Could not connect to the game server</h1><p>{error}</p><p>Start the backend with <code>npm run server</code>, then refresh this page.</p></main>
  if (!game) return <main id="main-content" tabIndex={-1} className="status-shell"><p>Loading game…</p></main>

  const ready = game.teams.length > 0 && game.teams.every((team) => team.name.trim() && team.name.trim().length <= 50) && new Set(game.teams.map((team) => team.name.trim().toLowerCase())).size === game.teams.length && game.categories.length > 0 && game.categories.every((cat) => cat.title.trim() && cat.clues.length && cat.clues.every((item) => item.question.trim() && item.answer.trim() && Number(item.value) > 0))
  const update = (fn) => {
    const next = fn(game)
    setGame(next)
    if (next.teams !== game.teams) {
      const keep = (values) => Object.fromEntries(next.teams.filter((team) => Object.hasOwn(values, team.id)).map((team) => [team.id, values[team.id]]))
      setScores((current) => Object.fromEntries(next.teams.map((team) => [team.id, current[team.id] || 0])))
      setFinalWagers(keep)
      setFinalOutcomes(keep)
    }
  }
  const modifyCategory = (categoryId, fn) => update((current) => ({ ...current, categories: current.categories.map((cat) => cat.id === categoryId ? fn(cat) : cat) }))
  const close = () => { setSelectedId(null); setShowAnswer(false) }
  const reset = async () => {
    close()
    try {
      const progress = await resetProgress(gameId)
      applyProgress(progress)
      setFinalOpen(false)
    } catch (requestError) { setError(requestError.message) }
  }
  const replay = async () => {
    setReplaying(true)
    try {
      await pendingSaves.current
      const record = await replayGame(gameId)
      applyProgress(record.progress)
      setSelectedId(null)
      setShowAnswer(false)
      setFinalOpen(false)
      setEditing(false)
      setError('')
    } finally { setReplaying(false) }
  }
  const start = () => { if (ready) { reset(); setEditing(false) } }
  const score = (teamId) => { setScores((current) => ({ ...current, [teamId]: (current[teamId] || 0) + Number(selected.item.value) })); setUsed((current) => [...new Set([...current, selectedId])]); close() }
  const finish = () => { setUsed((current) => [...new Set([...current, selectedId])]); close() }
  const totalClues = game.categories.reduce((total, category) => total + category.clues.length, 0)
  const allCluesAnswered = totalClues > 0 && used.length >= totalClues
  const finalJeopardyReady = game.finalJeopardy?.category?.trim() && game.finalJeopardy?.question?.trim() && game.finalJeopardy?.answer?.trim()
  const beginFinalJeopardy = () => {
    if (!Object.keys(finalWagers).length) setFinalWagers(Object.fromEntries(game.teams.map((team) => [team.id, Math.max(0, Number(scores[team.id]) || 0)])))
    setFinalOpen(true)
  }
  const resolveFinalJeopardy = () => {
    setScores((current) => Object.fromEntries(game.teams.map((team) => {
      const wager = Math.max(0, Number(finalWagers[team.id]) || 0)
      return [team.id, (Number(current[team.id]) || 0) + (finalOutcomes[team.id] ? wager : -wager)]
    })))
    setFinalResolved(true)
    setFinalOpen(false)
  }

  if (editing) return <GameEditor game={game} gameId={gameId} games={games} openGame={openGame} newGame={newGame} deleteGame={deleteGame} importSheet={importSheet} error={error} ready={ready} start={start} update={update} modifyCategory={modifyCategory} handleLogout={confirmLogout} showLogoutConfirm={showLogoutConfirm} cancelLogout={cancelLogout} handleLogoutConfirm={handleLogout} roomCode={roomCode} />
  return <GameBoard roomCode={roomCode} onReplay={replay} gameId={gameId} game={game} scores={scores} used={used} selected={selected} showAnswer={showAnswer} onOpenClue={(clueId) => { setSelectedId(clueId); setShowAnswer(false) }} onCloseClue={close} onRevealAnswer={() => setShowAnswer(true)} onScore={score} onFinish={finish} onEdit={() => setEditing(true)} onReset={reset} onLogout={confirmLogout} logoutOpen={showLogoutConfirm} onCancelLogout={cancelLogout} onConfirmLogout={handleLogout} allCluesAnswered={allCluesAnswered} finalJeopardyReady={Boolean(finalJeopardyReady)} finalResolved={finalResolved} finalOpen={finalOpen} onBeginFinal={beginFinalJeopardy} finalWagers={finalWagers} onSetFinalWager={(teamId, wager) => setFinalWagers((current) => ({ ...current, [teamId]: wager }))} finalRevealed={finalRevealed} onRevealFinal={() => setFinalRevealed(true)} finalOutcomes={finalOutcomes} onSetFinalOutcome={(teamId, correct) => setFinalOutcomes((current) => ({ ...current, [teamId]: correct }))} onResolveFinal={resolveFinalJeopardy} onCloseFinal={() => setFinalOpen(false)} />
}

/* Editor implementation moved to pages/GameEditor.jsx.
function Builder({ game, gameId, games, openGame, newGame, importSheet, error, ready, start, update, modifyCategory, handleLogout, showLogoutConfirm, cancelLogout, handleLogoutConfirm, roomCode }) {
  const addTeam = () => update((current) => ({ ...current, teams: [...current.teams, { id: id(), name: `Team ${current.teams.length + 1}` }] }))
  const updateTeam = (teamId, name) => update((current) => ({ ...current, teams: current.teams.map((team) => team.id === teamId ? { ...team, name } : team) }))
  const addCategory = () => update((current) => ({ ...current, categories: [...current.categories, category()] }))
  const [sheetUrl, setSheetUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const copyCode = async () => {
    if (!roomCode) return
    try {
      await navigator.clipboard.writeText(roomCode)
    } catch {
      // no-op for browsers without clipboard support
    }
  }

  const gameOptions = games.some((item) => item.id === gameId)
    ? games
    : [{ id: gameId, title: game.title }, ...games]

  const submitSheetImport = async (event) => {
    event.preventDefault()
    if (!sheetUrl.trim() || importing) return
    setImporting(true)
    try {
      await importSheet(sheetUrl.trim())
      setSheetUrl('')
    } catch {
      // The request error is displayed by the editor.
    } finally {
      setImporting(false)
    }
  }

  return <main id="main-content" tabIndex={-1} className="builder-shell">
    <header className="topbar">
      <div><p className="eyebrow">GAME EDITOR</p><h1>Edit your board</h1></div>
      <div className="header-actions"><button className="new-game" disabled={!ready} onClick={start}>Start game</button><button className="logout-button" onClick={handleLogout}>Log out</button></div>
    </header>
    <div className="host-code-panel">
      <div className="host-code-info"><p className="eyebrow">HOST CODE</p><h2>{roomCode || 'Generating...'}</h2></div>
      <div className="host-code-actions"><GameJoinQRCode code={roomCode} /><button className="secondary-button" type="button" onClick={copyCode} disabled={!roomCode}>Copy code</button></div>
    </div>
    <section className="game-library" aria-label="Saved games">
      <label htmlFor="saved-game-select">Open game
        <select id="saved-game-select" value={gameId} onChange={(event) => openGame(event.target.value)}>
          {gameOptions.map((item) => <option key={item.id} value={item.id}>{item.id === gameId ? game.title : item.title || 'Untitled Game'}</option>)}
        </select>
      </label>
      <button className="secondary-button" type="button" onClick={newGame}>New game</button>
    </section>
    <section className="sheet-import" aria-labelledby="sheet-import-title">
      <div><p className="eyebrow">GOOGLE SHEETS</p><h2 id="sheet-import-title">Import a game board</h2><p>Share the sheet with “Anyone with the link.” Use either Category, Question, and Answer columns, or Category followed by repeating Question/Answer pairs. A Final row can include its question, answer, and category.</p></div>
      <form onSubmit={submitSheetImport}>
        <label htmlFor="google-sheet-url">Google Sheets link or ID</label>
        <div className="sheet-import-controls"><input id="google-sheet-url" type="text" value={sheetUrl} onChange={(event) => setSheetUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." /><button className="secondary-button" type="submit" disabled={!sheetUrl.trim() || importing}>{importing ? 'Importing…' : 'Import sheet'}</button></div>
      </form>
    </section>
    {error && <p className="login-error" role="alert">{error}</p>}
    <p className="builder-intro">Edit the title, teams, categories, questions, and answers. Point values are assigned automatically, and changes save automatically.</p>
    <label className="title-field">Game title<input value={game.title} onChange={(event) => update((current) => ({ ...current, title: event.target.value }))} /></label>
    <section className="editor-section">
      <div className="section-heading"><h2>Teams</h2><button className="secondary-button" onClick={addTeam}>Add team</button></div>
      <div className="team-editor">{game.teams.map((team, index) => <div className="team-row" key={team.id}><input aria-label={`Team ${index + 1}`} value={team.name} onChange={(event) => updateTeam(team.id, event.target.value)} /><button className="remove-button" onClick={() => update((current) => ({ ...current, teams: current.teams.filter((item) => item.id !== team.id) }))}>Remove</button></div>)}</div>
    </section>
    <section className="editor-section">
      <div className="section-heading"><h2>Categories and questions</h2><button className="secondary-button" onClick={addCategory}>Add category</button></div>
      <div className="category-editor-list">{game.categories.map((cat, categoryIndex) => <CategoryEditor key={cat.id} cat={cat} index={categoryIndex} modify={modifyCategory} remove={() => update((current) => ({ ...current, categories: current.categories.filter((item) => item.id !== cat.id) }))} />)}</div>
    </section>
    {!ready && <p className="validation-message">Each category needs a title and at least one question with a value and answer before the game can start.</p>}
    {showLogoutConfirm && <div className="modal-backdrop" role="presentation" onMouseDown={cancelLogout}><section className="logout-confirmation" role="dialog" aria-modal="true" aria-label="Confirm sign out" onMouseDown={(event) => event.stopPropagation()}><h2>Sign out of Microsoft?</h2><p>You’ll need to sign in again to access the game.</p><div className="logout-actions"><button className="secondary-button" onClick={cancelLogout}>Cancel</button><button className="logout-button" onClick={handleLogoutConfirm}>Yes, sign out</button></div></section></div>}
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
*/

export default App

function App() {
  const hostGameId = new URLSearchParams(window.location.search).get('hostDisplay')
  return <><a className="skip-link" href="#main-content">Skip to content</a>{hostGameId ? <HostDisplay key={hostGameId} gameId={hostGameId} /> : <GameApp />}</>
}
