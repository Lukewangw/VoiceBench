import { useLayoutEffect, useRef, type RefObject } from 'react'

// Dialogs that are open right now, innermost last. Only the top one answers Escape and Tab, and
// everything else (the page and any dialog underneath) is inert until it closes.
const stack: HTMLElement[] = []

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Whether any dialog (job drawer, form, sign-in) is open. */
export const isDialogOpen = () => stack.length > 0

// A dialog's layer is its parent: the wrapper that also holds its backdrop.
const layerOf = (dialog: HTMLElement) => dialog.parentElement ?? dialog

function updateInert() {
  document.querySelector('.shell')?.toggleAttribute('inert', stack.length > 0)
  stack.forEach((dialog, i) => layerOf(dialog).toggleAttribute('inert', i < stack.length - 1))
}

/**
 * Makes `ref` behave like a modal dialog: focus moves in (to `initialFocus`, or the dialog itself,
 * which needs tabIndex={-1}), Tab and Shift+Tab stay inside, Escape closes it, everything behind
 * it is inert, and focus goes back to where it was once it closes.
 */
export function useDialog(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  initialFocus?: RefObject<HTMLElement | null>,
) {
  const close = useRef(onClose)
  close.current = onClose

  // A layout effect runs before the browser can move focus away from content that just became
  // inert, so the element that opened the dialog is still the active one here.
  useLayoutEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    stack.push(dialog)
    updateInert()
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
      updateInert()
      if (returnTo?.isConnected) returnTo.focus()
    }
  }, [ref, initialFocus])
}
