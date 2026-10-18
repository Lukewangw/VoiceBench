import { useEffect, useState, type ReactNode } from 'react'
import { priorityName, type PriorityKey } from '../../shared/board.js'
import { dueRelative, dueShort, dueTone } from '../lib/format'
import type { Person } from '../lib/model'

// Stroke icons drawn on a 24px grid (shapes after Lucide, ISC license).
const ICONS: Record<string, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  check: <path d="M20 6 9 17l-5-5" />,
  external: <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />,
  link: (
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  ),
  refresh: <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8M21 3v5h-5" />,
  calendar: <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />,
  users: (
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  ),
  userPlus: <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6" />,
  userMinus: <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 11h-6" />,
  arrowRight: <path d="M5 12h14M12 5l7 7-7 7" />,
  undo: <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />,
  logOut: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  lightbulb: (
    <path d="M9 18h6M10 22h4M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" />
  ),
  pencil: <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />,
  ban: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m4.9 4.9 14.2 14.2" />
    </>
  ),
  inbox: (
    <path d="M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  ),
  circleCheck: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  message: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  lock: (
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  flag: <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
}

export type IconName = keyof typeof ICONS

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  )
}

export function GitHubMark({ size = 16 }: { size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo">
      <defs>
        <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2dd4bf" />
          <stop offset="1" stopColor="#0f9d8a" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#logo-g)" />
      <path d="M9.5 16.5l4.2 4.2 8.8-9.4" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden="true" />
}

const sized = (url: string, px: number) =>
  url.startsWith('https://avatars.githubusercontent.com/') ? `${url}${url.includes('?') ? '&' : '?'}s=${px}` : url

export function Avatar({ person, size = 24, className = '' }: { person: Person; size?: number; className?: string }) {
  return (
    <img
      className={`avatar ${className}`}
      src={sized(person.avatarUrl, size * 2)}
      width={size}
      height={size}
      alt=""
      title={person.login}
      loading="lazy"
    />
  )
}

export function AvatarStack({ people, size = 24, max = 3, me }: { people: Person[]; size?: number; max?: number; me?: string }) {
  if (!people.length) {
    return <span className="avatar-empty" style={{ width: size, height: size }} title="Nobody yet. Pick it up!" />
  }
  const isMe = (p: Person) => !!me && p.login.toLowerCase() === me.toLowerCase()
  // You first, so you're never hidden behind "+2".
  const shown = [...people].sort((a, b) => Number(isMe(b)) - Number(isMe(a))).slice(0, max)
  return (
    <span className="avatar-stack" title={people.map((p) => (isMe(p) ? `${p.login} (you)` : p.login)).join(', ')}>
      {shown.map((p) => (
        <Avatar key={p.login} person={p} size={size} className={isMe(p) ? 'avatar-me' : ''} />
      ))}
      {people.length > max && <span className="avatar-more">+{people.length - max}</span>}
    </span>
  )
}

export function PriorityPill({ priority, long = false }: { priority: PriorityKey | null; long?: boolean }) {
  if (!priority) return <span className="pill pill-none">—</span>
  return (
    <span className={`pill pill-${priority.toLowerCase()}`} title={priorityName(priority)}>
      {priority}
      {long && <span className="pill-name">{priorityName(priority)}</span>}
    </span>
  )
}

export function DueDate({ due, muted = false }: { due: string | null; muted?: boolean }) {
  if (!due) return <span className="due due-none">No date</span>
  const tone = muted ? 'later' : dueTone(due)
  return (
    <span className={`due due-${tone}`} title={dueRelative(due)}>
      {dueShort(due)}
    </span>
  )
}

// The Markdown renderer (marked + DOMPurify) is only needed inside a job, so it loads on its own,
// after the board is up. Until then the text shows as plain text.
type MarkdownModule = typeof import('../lib/markdown')
let markdown: MarkdownModule | null = null
let loading: Promise<MarkdownModule> | null = null
export function loadMarkdown() {
  return (loading ??= import('../lib/markdown').then((m) => (markdown = m)))
}

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const [html, setHtml] = useState(() => markdown?.renderMarkdown(text) ?? null)
  useEffect(() => {
    let live = true
    if (markdown) setHtml(markdown.renderMarkdown(text))
    else void loadMarkdown().then((m) => live && setHtml(m.renderMarkdown(text)))
    return () => {
      live = false
    }
  }, [text])
  if (html === null) return <div className={`markdown markdown-plain ${className}`}>{text}</div>
  return <div className={`markdown ${className}`} dangerouslySetInnerHTML={{ __html: html }} />
}
