import { dismissToast, useToasts } from '../toast'
import { Icon } from './ui'

export function Toasts() {
  const toasts = useToasts()
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismissToast(t.id)}>
          <Icon name={t.kind === 'error' ? 'x' : t.kind === 'info' ? 'clock' : 'check'} size={15} />
          <span>{t.text}</span>
        </button>
      ))}
    </div>
  )
}
