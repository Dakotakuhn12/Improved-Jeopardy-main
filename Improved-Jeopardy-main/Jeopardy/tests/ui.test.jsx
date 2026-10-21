import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import html from '../index.html?raw'
import useDialog from '../src/hooks/useDialog'
import LogoutConfirmation from '../src/components/Modal'
import FinalJeopardy from '../src/components/FinalJeopardy'
import ShareGame from '../src/components/ShareGame'
import Buzzer from '../src/components/Buzzer'
import GameBoard from '../src/components/GameBoard'
import App from '../src/App'
import { saveProgress } from '../src/services/gameApi'

const socketFixture = vi.hoisted(() => ({ handlers: new Map(), emit: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('../src/services/socket', () => ({ createGameSocket: () => ({
  connected: true,
  on: (event, callback) => { socketFixture.handlers.set(event, callback) },
  io: { on: () => {}, removeAllListeners: () => {} },
  connect: () => {}, disconnect: () => {}, removeAllListeners: () => socketFixture.handlers.clear(),
  timeout: () => ({ emitWithAck: socketFixture.emit }),
}) }))

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function DialogHarness({ busy = false }) {
  const [open, setOpen] = useState(false)
  const ref = useDialog(open, () => setOpen(false), busy)
  return <><button onClick={() => setOpen(true)}>Open dialog</button>{open && <section ref={ref} role="dialog" aria-modal="true" aria-label="Test dialog" tabIndex={-1}><button>First action</button><button disabled>Disabled action</button><button onClick={() => setOpen(false)}>Last action</button></section>}</>
}

describe('Keyboard and dialog usability', () => {
  it('moves focus into the dialog, traps Tab in both directions, restores focus and scrolling', () => {
    render(<DialogHarness />)
    const trigger = screen.getByRole('button', { name: 'Open dialog' })
    trigger.focus()
    fireEvent.click(trigger)
    const first = screen.getByRole('button', { name: 'First action' })
    const last = screen.getByRole('button', { name: 'Last action' })
    expect(document.activeElement).toBe(first)
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    trigger.focus()
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(document.body.style.overflow).toBe('')
  })

  it('does not dismiss a busy confirmation with Escape', () => {
    render(<DialogHarness busy />)
    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }))
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('does not reset focus when dialog content rerenders', () => {
    const cancel = vi.fn()
    const { rerender } = render(<LogoutConfirmation open onCancel={cancel} onConfirm={() => {}} />)
    const confirm = screen.getByRole('button', { name: 'Yes, sign out' })
    confirm.focus()
    rerender(<LogoutConfirmation open onCancel={() => cancel()} onConfirm={() => {}} />)
    expect(document.activeElement).toBe(confirm)
    fireEvent.keyDown(confirm, { key: 'Escape' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('keeps Final Jeopardy wagers labelled and validates empty or excessive values', () => {
    const props = { open: true, finalJeopardy: { category: 'Science', question: 'Question', answer: 'Answer' }, teams: [{ id: 'red', name: 'Red' }], scores: { red: 100 }, onWagerChange: vi.fn(), onClose: vi.fn(), onReveal: vi.fn(), outcomes: {} }
    const { rerender } = render(<FinalJeopardy {...props} wagers={{ red: '' }} />)
    expect(screen.getByRole('spinbutton', { name: 'Red wager' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Lock wagers and reveal answer' }).disabled).toBe(true)
    rerender(<FinalJeopardy {...props} wagers={{ red: 150 }} />)
    expect(screen.getByRole('button', { name: 'Lock wagers and reveal answer' }).disabled).toBe(true)
    rerender(<FinalJeopardy {...props} wagers={{ red: 50 }} />)
    expect(screen.getByRole('button', { name: 'Lock wagers and reveal answer' }).disabled).toBe(false)
  })

  it('saves typed wagers as numbers and omits blank or invalid drafts', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ saved: true }) })
    vi.stubGlobal('fetch', fetch)
    await saveProgress('first', { red: 100 }, [], { red: '50', blue: '', green: '-5', gold: 'abc' }, {}, false, false)
    const submitted = JSON.parse(fetch.mock.calls[0][1].body)
    expect(submitted.finalWagers).toEqual({ red: 50 })
  })
})

describe('Sharing feedback and mobile foundations', () => {
  it('opens a new imported game in the editor and keeps the earlier game available', async () => {
    window.localStorage.clear()
    const old = { id: 'old', code: 'OLD001', game: { title: 'Earlier copy', teams: [], categories: [] }, progress: {} }
    const imported = { id: 'imported', code: 'NEW001', game: { title: 'New sheet copy', teams: [], categories: [] }, progress: {} }
    const fetch = vi.fn(async (url, options = {}) => {
      let body = {}
      if (url === '/api/auth/me') body = { authenticated: true }
      else if (url === '/api/student/session') body = { student: null }
      else if (url === '/api/games') body = [{ id: old.id, title: old.game.title }]
      else if (url === '/api/games/old') {
        if (options.method === 'PUT') old.game = JSON.parse(options.body).game
        body = old
      } else if (url === '/api/import/google-sheets') body = imported
      else if (String(url).endsWith('/students')) body = []
      else if (url === '/api/games/imported') body = imported
      return { ok: true, json: async () => body }
    })
    vi.stubGlobal('fetch', fetch)
    render(<App />)
    const title = await screen.findByRole('textbox', { name: 'Game title' })
    fireEvent.change(title, { target: { value: 'Earlier copy edited' } })
    fireEvent.change(screen.getByLabelText('Google Sheets link or ID'), { target: { value: 'https://docs.google.com/spreadsheets/d/testsheet123456789/edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import sheet' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Open game' }).value).toBe('imported'))
    expect(screen.getByRole('textbox', { name: 'Game title' }).value).toBe('New sheet copy')
    expect(old.game.title).toBe('Earlier copy edited')
    expect(screen.getByRole('option', { name: 'Earlier copy edited' })).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Open game' }), { target: { value: 'old' } })
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Game title' }).value).toBe('Earlier copy edited'))
    window.localStorage.clear()
  })

  it('keeps the host board keyboard-scrollable after every clue is used', () => {
    render(<GameBoard gameId="first" roomCode="TEST01" game={{ title: 'Test', teams: [], categories: [{ id: 'science', title: 'Science', clues: [{ id: 'one', value: 100 }] }] }} scores={{}} used={['one']} />)
    const board = screen.getByRole('region', { name: /Jeopardy game board/ })
    expect(board.tabIndex).toBe(0)
    board.focus()
    expect(document.activeElement).toBe(board)
    expect(board.querySelector('button').disabled).toBe(true)
  })

  it('reports successful copying and leaves a selectable link when clipboard permission fails', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Permission denied'))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<ShareGame code="TEST01" title="Test game" />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy join link' }))
    expect(await screen.findByText('Join link copied.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copy join link' }))
    expect(await screen.findByText(/Clipboard access is unavailable/)).toBeTruthy()
    const input = screen.getByRole('textbox', { name: 'Student join link' })
    expect(document.activeElement).toBe(input)
    expect(input.selectionEnd - input.selectionStart).toBe(input.value.length)
  })

  it('sets a scalable phone viewport and safe-area support without disabling zoom', () => {
    expect(html).toContain('width=device-width, initial-scale=1.0, viewport-fit=cover')
    expect(html).not.toMatch(/user-scalable=no|maximum-scale=1/)
    expect(html).toContain('<title>Classroom Jeopardy</title>')
  })

  it('keeps buzzing disabled until connected, assigned, and open, then shows the winner', async () => {
    const { rerender } = render(<Buzzer gameId="first" role="student" student={{ name: 'Alex', teamId: null }} />)
    expect(screen.getByRole('button', { name: 'BUZZ!' }).disabled).toBe(true)
    act(() => {
      socketFixture.handlers.get('session:ready')()
      socketFixture.handlers.get('buzzer:state')({ clueId: 'one', roundId: 'round-one', status: 'open', winner: null })
    })
    expect(screen.getByRole('button', { name: 'BUZZ!' }).disabled).toBe(true)
    rerender(<Buzzer gameId="first" role="student" student={{ name: 'Alex', teamId: 'red' }} />)
    expect(screen.getByRole('button', { name: 'BUZZ!' }).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'BUZZ!' }))
    expect(socketFixture.emit).toHaveBeenCalledWith('buzzer:press', expect.objectContaining({ clueId: 'one', roundId: 'round-one' }))
    await act(async () => {})
    act(() => socketFixture.handlers.get('buzzer:state')({ clueId: 'one', roundId: 'round-one', status: 'locked', winner: { name: 'Alex', teamName: 'Red' } }))
    expect(screen.getByText('Alex (Red) buzzed first!')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'BUZZ!' }).disabled).toBe(true)
  })
})
