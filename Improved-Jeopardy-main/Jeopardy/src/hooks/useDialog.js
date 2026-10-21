import { useEffect, useRef } from 'react'

let locks = 0
let previousOverflow = ''
const focusable = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'

export default function useDialog(open, onClose, busy = false) {
  const dialogRef = useRef(null)
  const optionsRef = useRef({ onClose, busy })
  useEffect(() => { optionsRef.current = { onClose, busy } }, [onClose, busy])
  useEffect(() => {
    if (!open || !dialogRef.current) return
    const dialog = dialogRef.current
    const previousFocus = document.activeElement
    if (locks++ === 0) { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden' }
    const isTop = () => [...document.querySelectorAll('[aria-modal="true"]')].at(-1) === dialog
    const first = () => dialog.querySelector(focusable) || dialog
    first().focus()
    const keydown = (event) => {
      if (!isTop()) return
      if (event.key === 'Escape' && !optionsRef.current.busy) { event.preventDefault(); optionsRef.current.onClose?.(); return }
      if (event.key !== 'Tab') return
      const items = [...dialog.querySelectorAll(focusable)]
      if (!items.length) { event.preventDefault(); dialog.focus(); return }
      const index = items.indexOf(document.activeElement)
      if (event.shiftKey && index <= 0) { event.preventDefault(); items.at(-1).focus() }
      else if (!event.shiftKey && (index === items.length - 1 || index === -1)) { event.preventDefault(); items[0].focus() }
    }
    const focusin = (event) => { if (isTop() && !dialog.contains(event.target)) first().focus() }
    document.addEventListener('keydown', keydown)
    document.addEventListener('focusin', focusin)
    return () => {
      document.removeEventListener('keydown', keydown)
      document.removeEventListener('focusin', focusin)
      if (--locks === 0) document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [open])
  return dialogRef
}
