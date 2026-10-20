import { useEffect, useRef, useState } from 'react'
import { createGameSocket } from '../services/socket'

export default function useSockets(gameId, role, handlers = {}) {
  const handlersRef = useRef(handlers)
  useEffect(() => { handlersRef.current = handlers }, [handlers])
  const socketRef = useRef(null)
  const [state, setState] = useState({ status: 'Connecting', error: '', lastCheck: null })
  useEffect(() => {
    const socket = createGameSocket(gameId, role)
    socketRef.current = socket
    socket.on('session:ready', () => setState((current) => ({ ...current, status: 'Connected', error: '' })))
    socket.on('disconnect', (reason) => setState((current) => ({ ...current, status: reason === 'io server disconnect' ? 'Session ended' : 'Reconnecting' })))
    socket.io.on('reconnect_attempt', () => setState((current) => ({ ...current, status: 'Reconnecting' })))
    socket.on('connect_error', (error) => setState((current) => ({ ...current, status: 'Disconnected', error: error.message })))
    socket.on('session:expired', ({ message }) => setState((current) => ({ ...current, status: 'Session ended', error: message })))
    socket.on('room:checked', ({ checkedAt }) => setState((current) => ({ ...current, lastCheck: checkedAt })))
    socket.on('game:state', (record) => handlersRef.current.onGameState?.(record))
    socket.on('host:state', (record) => handlersRef.current.onHostState?.(record))
    socket.on('buzzer:state', (buzzer) => handlersRef.current.onBuzzerState?.(buzzer))
    socket.on('student:updated', (student) => handlersRef.current.onStudentUpdate?.(student))
    socket.on('roster:updated', (roster) => handlersRef.current.onRosterUpdate?.(roster))
    socket.on('disconnect', (reason) => { if (reason === 'io server disconnect') handlersRef.current.onSessionEnded?.() })
    socket.connect()
    return () => { socket.removeAllListeners(); socket.io.removeAllListeners(); socket.disconnect(); socketRef.current = null }
  }, [gameId, role])
  const checkRoom = () => {
    socketRef.current?.timeout(5000).emit('room:check', (error, result) => {
      if (error || !result?.ok) setState((current) => ({ ...current, error: result?.error || 'Connection check timed out.' }))
    })
  }
  const buzzerAction = async (event, payload) => {
    if (!socketRef.current?.connected) throw new Error('Wait for the live connection before buzzing.')
    const result = await socketRef.current.timeout(5000).emitWithAck(event, payload)
    if (!result?.ok) throw new Error(result?.error || 'Buzzer request failed.')
    return result
  }
  return { ...state, checkRoom, buzzerAction }
}
