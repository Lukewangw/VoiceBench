const DAY = 86_400_000

function localDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function startOfToday(): Date {
  const t = new Date()
  t.setHours(0, 0, 0, 0)
  return t
}

export function daysUntil(ymd: string): number {
  return Math.round((localDate(ymd).getTime() - startOfToday().getTime()) / DAY)
}

export function shortDate(date: Date): string {
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

export const dueShort = (ymd: string) => shortDate(localDate(ymd))
export const dueLong = (ymd: string) =>
  localDate(ymd).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })

export function dueRelative(ymd: string): string {
  const n = daysUntil(ymd)
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n === -1) return '1 day overdue'
  return n > 0 ? `in ${n} days` : `${-n} days overdue`
}

export type DueTone = 'overdue' | 'soon' | 'later'
export function dueTone(ymd: string): DueTone {
  const n = daysUntil(ymd)
  return n < 0 ? 'overdue' : n <= 2 ? 'soon' : 'later'
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < DAY / 1000) return `${Math.floor(s / 3600)}h ago`
  if (s < (7 * DAY) / 1000) return `${Math.floor(s / 86400)}d ago`
  return shortDate(new Date(iso))
}

export const todayYmd = () => {
  const t = new Date()
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}
