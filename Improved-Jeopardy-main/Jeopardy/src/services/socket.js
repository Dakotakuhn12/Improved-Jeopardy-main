import { io } from 'socket.io-client'

export const createGameSocket = (gameId, role) => io({
  autoConnect: false,
  withCredentials: true,
  auth: { gameId, role },
  reconnection: true,
  reconnectionDelay: 500,
  reconnectionDelayMax: 5000,
})
