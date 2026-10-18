import { useEffect, useRef, useState } from 'react'
import { PRIVATE_REPO, REPO, REPO_URL, TITLE } from '../config'
import { timeAgo } from '../lib/format'
import type { Viewer } from '../state'
import { Avatar, GitHubMark, Icon, Logo } from './ui'

interface Props {
  viewer: Viewer | null
  syncedAt: string | null
  live: boolean
  /** Why the last refresh failed, if it did. */
  stale?: string | null
  refreshing: boolean
  onRefresh(): void
  onSignIn(): void
  onSignOut(): void
}

export function Header({ viewer, syncedAt, live, stale, refreshing, onRefresh, onSignIn, onSignOut }: Props) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const status = !syncedAt
    ? 'Loading…'
    : stale
      ? `Couldn't refresh · ${timeAgo(syncedAt)}`
      : live
        ? `Live · ${timeAgo(syncedAt)}`
        : `Updated ${timeAgo(syncedAt)}`

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="brand" href="#/jobs">
          <Logo />
          <span className="brand-text">
            <span className="brand-title">{TITLE}</span>
            <span className="brand-sub">Job board</span>
          </span>
        </a>
        <div className="topbar-right">
          <button
            className={`sync${stale ? ' sync-stale' : ''}`}
            onClick={onRefresh}
            title={stale ? `${stale} Try again` : live ? 'Reading GitHub directly. Refresh now' : 'Refresh'}
          >
            <Icon name="refresh" className={refreshing ? 'spin' : undefined} />
            <span className="sync-text">{status}</span>
          </button>
          {viewer ? (
            <UserMenu viewer={viewer} onSignOut={onSignOut} />
          ) : (
            <button className="btn btn-dark" onClick={onSignIn}>
              <GitHubMark /> Sign in
            </button>
          )}
        </div>
      </div>
    </header>
  )
}

function UserMenu({ viewer, onSignOut }: { viewer: Viewer; onSignOut(): void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  return (
    <div className="menu-wrap" ref={ref}>
      <button className="me" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <Avatar person={viewer} size={28} />
        {viewer.isAdmin && <span className="badge badge-admin">Admin</span>}
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">
            <Avatar person={viewer} size={36} />
            <div>
              <div className="menu-name">@{viewer.login}</div>
              <div className="menu-role">
                {viewer.isAdmin ? 'Admin: can add and approve jobs' : 'Member: can propose and pick up jobs'}
              </div>
            </div>
          </div>
          {viewer.isAdmin && viewer.privateAccess && (
            <div className={`menu-note${viewer.privateAccess === 'yes' ? ' on' : ''}`}>
              <Icon name="lock" size={14} />
              <span>
                {viewer.privateAccess === 'yes'
                  ? 'You can see private jobs.'
                  : viewer.privateAccess === 'needs-scope'
                    ? 'Private jobs are hidden: sign in again with a token that has the repo scope.'
                    : viewer.privateAccess === 'not-private'
                      ? `Private jobs are off: ${PRIVATE_REPO} is public. Make it private on GitHub first.`
                      : `Private jobs are off: ${PRIVATE_REPO} doesn't exist yet or isn't shared with you.`}
              </span>
            </div>
          )}
          <a className="menu-item" role="menuitem" href={REPO_URL} target="_blank" rel="noreferrer">
            <GitHubMark /> {REPO}
            <Icon name="external" size={13} className="menu-trail" />
          </a>
          <button className="menu-item" role="menuitem" onClick={onSignOut}>
            <Icon name="logOut" /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}
