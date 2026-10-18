import { useLayoutEffect, useRef, type RefObject } from 'react'

// Dialogs that are open right now, bottom to top. Only the top one answers Escape and Tab, and
// everything else (the page and any dialog under it) is inert until it closes.
interface Layer {
  dialog: HTMLElement
  level: number
  /** Where focus goes when this dialog closes. */
  returnTo: HTMLElement | null
}
const stack: Layer[] = []

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
  stack.forEach((layer, i) => layerOf(layer.dialog).toggleAttribute('inert', i < stack.length - 1))
}

const canFocus = (el: HTMLElement | null): el is HTMLElement => !!el?.isConnected && !el.closest('[inert]')

export interface DialogOptions {
  /** What gets focus when the dialog opens; otherwise the dialog itself, which needs tabIndex={-1}. */
  initialFocus?: RefObject<HTMLElement | null>
  /**
   * Higher levels are drawn on top: the job drawer is 0, forms and sign-in are 1. A drawer that
   * opens while a form is up (Back to a job's address) goes under the form, where it is drawn.
   */
  level?: number
}

/**
 * Makes `ref` behave like a modal dialog: focus moves in, Tab and Shift+Tab stay inside, Escape
 * closes it, everything behind it is inert, and focus goes back to where it was once it closes.
 */
export function useDialog(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  { initialFocus, level = 1 }: DialogOptions = {},
) {
  const close = useRef(onClose)
  close.current = onClose

  // A layout effect runs before the browser can move focus away from content that just became
  // inert, so the element that opened the dialog is still the active one here.
  useLayoutEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const layer: Layer = {
      dialog,
      level,
      returnTo: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    }
    let at = stack.length
    while (at > 0 && stack[at - 1].level > level) at--
    if (at < stack.length) {
      // Opening under another dialog: as if this one had been open first, so the one above now
      // returns here, and this one returns to where that one would have.
      layer.returnTo = stack[at].returnTo
      stack[at].returnTo = dialog
    }
    stack.splice(at, 0, layer)
    updateInert()
    if (stack[stack.length - 1] === layer) (initialFocus?.current ?? dialog).focus()

    const onKey = (e: KeyboardEvent) => {
      // Handled already: closing the top dialog makes this one the top before its listener runs.
      if (e.defaultPrevented || stack[stack.length - 1] !== layer) return
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
      const i = stack.indexOf(layer)
      const wasTop = i === stack.length - 1
      stack.splice(i, 1)
      // Dialogs above this one that would have returned into it return where it would have.
      for (const above of stack.slice(i)) {
        if (above.returnTo && dialog.contains(above.returnTo)) above.returnTo = layer.returnTo
      }
      updateInert()
      if (!wasTop) return
      if (canFocus(layer.returnTo)) layer.returnTo.focus()
      else stack[stack.length - 1]?.dialog.focus()
    }
  }, [ref, initialFocus, level])
}
