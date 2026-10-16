import { useSyncExternalStore } from 'react'

export interface Toast {
  id: number
  kind: 'success' | 'error' | 'info'
  text: string
}

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function toast(text: string, kind: Toast['kind'] = 'success', ms = kind === 'error' ? 6000 : 3500) {
  const id = nextId++
  toasts = [...toasts.slice(-2), { id, kind, text }]
  emit()
  setTimeout(() => dismissToast(id), ms)
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => toasts,
  )
}
