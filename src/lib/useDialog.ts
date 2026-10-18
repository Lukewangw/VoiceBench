import { useEffect, useRef, type RefObject } from 'react'

// Dialogs that are open right now, innermost last. Only the top one answers Escape and Tab, so a
// form opened from the job drawer closes on its own.
const stack: HTMLElement[] = []

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Makes `ref` behave like a modal dialog: focus moves in (to `initialFocus`, or the dialog itself,
 * which needs tabIndex={-1}), Tab and Shift+Tab stay inside, Escape closes it, and focus goes back
 * to where it was once it closes.
 */
export function useDialog(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  initialFocus?: RefObject<HTMLElement | null>,
) {
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    stack.push(dialog)
    ;(initialFocus?.current ?? dialog).focus()

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== dialog) return
      if (e.key === 'Escape') {
        e.preventDefault()
        close.current()
      } else if (e.key === 'Tab') {
        const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
        if (!items.length) return e.preventDefault()
        const first = items[0]
        const last = items[items.length - 1]
        const inside = dialog.contains(document.activeElement)
        if (e.shiftKey && (!inside || document.activeElement === first || document.activeElement === dialog)) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      stack.splice(stack.indexOf(dialog), 1)
      if (returnTo?.isConnected) returnTo.focus()
    }
  }, [ref, initialFocus])
}
