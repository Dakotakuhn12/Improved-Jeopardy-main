import QRCode from 'react-qr-code'
import { buildJoinUrl } from '../services/sharing'

export default function GameJoinQRCode({ code, url: joinUrl }) {
  const baseUrl = import.meta.env.VITE_APP_URL || window.location.origin

  if (!code) {
    return (
      <div className="qr-code-shell qr-code-empty" aria-label="Game join QR code unavailable">
        <span>Generating QR...</span>
      </div>
    )
  }

  return (
    <div className="qr-code-shell" aria-label="Game join QR code">
      <QRCode value={joinUrl || buildJoinUrl(baseUrl, code)} size={150} bgColor="#ffffff" fgColor="#0d163d" />
      <p className="qr-code-label">Scan to join</p>
    </div>
  )
}
