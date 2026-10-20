export default function LogoutConfirmation({ open, onCancel, onConfirm }) {
  if (!open) return null

  return <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
    <section className="logout-confirmation" role="dialog" aria-modal="true" aria-label="Confirm sign out" onMouseDown={(event) => event.stopPropagation()}>
      <h2>Sign out of Microsoft?</h2><p>You’ll need to sign in again to access the game.</p>
      <div className="logout-actions"><button className="secondary-button" onClick={onCancel}>Cancel</button><button className="logout-button" onClick={onConfirm}>Yes, sign out</button></div>
    </section>
  </div>
}
