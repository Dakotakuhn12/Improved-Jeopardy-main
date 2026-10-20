import useSockets from '../hooks/useSockets'

export default function ConnectionStatus({ gameId, role, ...handlers }) {
  const { status, error, lastCheck, checkRoom } = useSockets(gameId, role, handlers)
  return <div className="connection-status" role="status">
    <span>Live connection: {status}</span>
    {role === 'host' && <button className="secondary-button" disabled={status !== 'Connected'} onClick={checkRoom}>Check connection</button>}
    {lastCheck && <span>Room connection verified at {new Date(lastCheck).toLocaleTimeString()}</span>}
    {error && <span>{error}</span>}
  </div>
}
