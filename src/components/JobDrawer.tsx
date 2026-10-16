import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  PRIORITIES,
  mentionedUser,
  parseDue,
  parsePriority,
  priorityLabel,
  type Command,
  type PriorityKey,
} from '../../shared/board.js'
import { dueLong, dueRelative, dueShort, dueTone, shortDate, timeAgo } from '../lib/format'
import { isOn, sameLogin, type Job, type Note } from '../lib/model'
import { errorText, type Board, type Viewer } from '../state'
import { toast } from '../toast'
import type { Tab } from './JobList'
import { Avatar, GitHubMark, Icon, Markdown, PriorityPill, Spinner, type IconName } from './ui'

interface Props {
  job: Job
  tab: Tab
  notes: Note[]
  viewer: Viewer | null
  pending?: string
  actions: Board['actions']
  loadNotes(n: number): Promise<void>
  onClose(): void
  onEdit(job: Job): void
  onSignIn(): void
}

const STATUS: Record<Job['status'], { label: string; tone: string; icon: IconName }> = {
  proposal: { label: 'Waiting for approval', tone: 'amber', icon: 'clock' },
  open: { label: 'Up for grabs', tone: 'accent', icon: 'flag' },
  active: { label: 'In progress', tone: 'blue', icon: 'users' },
  done: { label: 'Done', tone: 'green', icon: 'circleCheck' },
  closed: { label: 'Declined', tone: 'gray', icon: 'ban' },
}

export function JobDrawer({ job, tab, notes, viewer, pending, actions, loadNotes, onClose, onEdit, onSignIn }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [declining, setDeclining] = useState(false)
  const panelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    panelRef.current?.focus()
    void loadNotes(job.number)
    setDeclining(false)
  }, [job.number, loadNotes])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.modal') && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const run = async (key: string, fn: () => Promise<unknown>) => {
    if (!viewer) return onSignIn()
    setBusy(key)
    try {
      await fn()
      return true
    } catch (e) {
      toast(errorText(e), 'error')
      return false
    } finally {
      setBusy(null)
    }
  }

  const mine = isOn(job, viewer?.login)
  const isAuthor = !!viewer && sameLogin(viewer.login, job.author.login)
  const editable = actions.canEditDetails(job)
  const isJob = job.status === 'open' || job.status === 'active'
  const status = STATUS[job.status]
  const link = `${location.origin}${location.pathname}#/${tab}/${job.number}`

  const button = (key: string, label: string, icon: IconName, fn: () => Promise<unknown>, kind = 'btn-outline') => (
    <button className={`btn ${kind}`} disabled={!!busy || !!pending} onClick={() => run(key, fn)}>
      {busy === key ? <Spinner /> : <Icon name={icon} />} {label}
    </button>
  )

  let primary: ReactNode = null
  if (!viewer) {
    primary = isJob ? (
      <button className="btn btn-primary" onClick={onSignIn}>
        <Icon name="userPlus" /> Pick up
      </button>
    ) : null
  } else if (job.status === 'proposal') {
    primary = viewer.isAdmin ? (
      <>
        {button('approve', 'Approve', 'check', () => actions.approve(job), 'btn-primary')}
        <button className="btn btn-outline" disabled={!!busy} onClick={() => setDeclining(true)}>
          <Icon name="x" /> Decline
        </button>
      </>
    ) : (
      <span className="foot-note">
        <Icon name="clock" /> {isAuthor ? 'Your proposal is waiting for an admin.' : 'Waiting for an admin to approve.'}
      </span>
    )
  } else if (isJob) {
    primary = mine ? (
      <>
        {button('done', 'Mark done', 'check', () => actions.done(job), 'btn-primary')}
        {button('drop', 'Drop', 'userMinus', () => actions.drop(job))}
      </>
    ) : (
      button('take', job.assignees.length ? 'Join in' : 'Pick up', 'userPlus', () => actions.take(job), 'btn-primary')
    )
  } else if (job.status === 'done' && (viewer.isAdmin || mine)) {
    primary = button('reopen', 'Reopen', 'undo', () => actions.reopen(job))
  } else if (job.status === 'closed' && viewer.isAdmin) {
    primary = button('approve', 'Approve after all', 'check', () => actions.approve(job))
  }

  return (
    <div className="drawer-layer">
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" tabIndex={-1} ref={panelRef}>
        <div className="drawer-head">
          <span className="crumb">
            {tab === 'others' ? 'Others' : tab === 'done' ? 'Done' : 'Jobs'} <span className="crumb-sep">/</span> #{job.number}
          </span>
          <div className="drawer-tools">
            <button
              className="icon-btn"
              title="Copy link"
              onClick={() => navigator.clipboard?.writeText(link).then(() => toast('Link copied', 'info', 1800))}
            >
              <Icon name="link" />
            </button>
            <a className="icon-btn" href={job.url} target="_blank" rel="noreferrer" title="Open on GitHub">
              <GitHubMark />
            </a>
            <button className="icon-btn" onClick={onClose} title="Close">
              <Icon name="x" />
            </button>
          </div>
        </div>

        <div className="drawer-body">
          <h2 className="drawer-title" id="drawer-title">
            {job.title}
          </h2>
          <div className="status-line">
            <span className={`status-chip tone-${status.tone}`}>
              <Icon name={status.icon} size={14} />
              {job.status === 'closed' && job.labels.includes('job') ? 'Cancelled' : status.label}
              {job.status === 'done' && job.closedAt && <span className="status-sub">· {shortDate(new Date(job.closedAt))}</span>}
            </span>
            {pending && (
              <span className="status-chip tone-gray">
                <Spinner size={12} /> {pending}
              </span>
            )}
          </div>

          <dl className="props">
            <dt>
              <Icon name="flag" size={14} /> Priority
            </dt>
            <dd>
              {editable && job.status !== 'closed' ? (
                <div className="prio-picker" role="radiogroup" aria-label="Priority">
                  {PRIORITIES.map((p) => (
                    <button
                      key={p.key}
                      role="radio"
                      aria-checked={job.priority === p.key}
                      className={`prio-opt pill-${p.key.toLowerCase()}${job.priority === p.key ? ' selected' : ''}`}
                      disabled={!!busy || !!pending}
                      title={p.name}
                      onClick={() => run('prio', () => actions.setPriority(job, p.key as PriorityKey))}
                    >
                      {p.key}
                      <span className="prio-opt-name">{p.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <PriorityPill priority={job.priority} long />
              )}
            </dd>

            <dt>
              <Icon name="calendar" size={14} /> Due
            </dt>
            <dd>
              <DueField job={job} editable={editable && job.status !== 'closed'} disabled={!!busy} onChange={(due) => run('due', () => actions.setDue(job, due))} />
            </dd>

            <dt>
              <Icon name="users" size={14} /> People
            </dt>
            <dd>
              {job.assignees.length ? (
                <span className="people">
                  {job.assignees.map((a) => (
                    <a key={a.login} className="person" href={a.url} target="_blank" rel="noreferrer">
                      <Avatar person={a} size={22} />
                      {a.login}
                    </a>
                  ))}
                </span>
              ) : (
                <span className="muted">{job.status === 'proposal' ? 'Can be picked up once approved' : 'Nobody yet'}</span>
              )}
            </dd>

            <dt>
              <Icon name="pencil" size={14} /> {job.status === 'proposal' ? 'Proposed' : 'Posted'}
            </dt>
            <dd>
              <span className="people">
                <a className="person" href={job.author.url} target="_blank" rel="noreferrer">
                  <Avatar person={job.author} size={22} />
                  {job.author.login}
                </a>
                <span className="muted">· {shortDate(new Date(job.createdAt))}</span>
              </span>
            </dd>
          </dl>

          <div className="section-head">
            <h3 className="section-title">Description</h3>
            {(editable || (isAuthor && job.status !== 'closed')) && (
              <button className="link-btn" onClick={() => onEdit(job)}>
                <Icon name="pencil" size={13} /> Edit
              </button>
            )}
          </div>
          {job.description ? <Markdown text={job.description} /> : <p className="muted">No description yet.</p>}

          {declining && (
            <DeclineForm
              verb={job.status === 'proposal' ? 'Decline' : 'Cancel job'}
              busy={busy === 'decline'}
              onCancel={() => setDeclining(false)}
              onDecline={async (reason) => {
                if (await run('decline', () => actions.decline(job, reason))) setDeclining(false)
              }}
            />
          )}

          <h3 className="section-title">Activity</h3>
          <Activity job={job} notes={notes} />
          <Composer job={job} viewer={viewer} actions={actions} onSignIn={onSignIn} />

          {viewer?.isAdmin && isJob && (
            <div className="danger-zone">
              <button className="link-btn link-danger" disabled={!!busy} onClick={() => setDeclining(true)}>
                <Icon name="ban" size={13} /> Cancel this job
              </button>
            </div>
          )}
        </div>

        {primary && <div className="drawer-foot">{primary}</div>}
      </aside>
    </div>
  )
}

function DueField({ job, editable, disabled, onChange }: { job: Job; editable: boolean; disabled: boolean; onChange(due: string | null): void }) {
  const tone = job.due && job.status !== 'done' ? dueTone(job.due) : 'later'
  const text = job.due ? (
    <span className={`due-text due-${tone}`}>
      {dueLong(job.due)}
      {job.status !== 'done' && <span className="muted"> · {dueRelative(job.due)}</span>}
    </span>
  ) : (
    <span className="muted">No due date</span>
  )
  if (!editable) return text
  return (
    <span className="due-edit">
      <input
        type="date"
        className="date-input"
        value={job.due ?? ''}
        disabled={disabled}
        aria-label="Due date"
        onChange={(e) => onChange(e.target.value || null)}
      />
      {job.due && <span className={`due-hint due-${tone}`}>{job.status !== 'done' ? dueRelative(job.due) : ''}</span>}
      {job.due && (
        <button className="link-btn" disabled={disabled} onClick={() => onChange(null)}>
          Clear
        </button>
      )}
    </span>
  )
}

function DeclineForm({ verb, busy, onCancel, onDecline }: { verb: string; busy: boolean; onCancel(): void; onDecline(reason: string): void }) {
  const [reason, setReason] = useState('')
  return (
    <div className="decline">
      <label className="field-label" htmlFor="decline-reason">
        Reason <span className="muted">(optional, posted as a comment)</span>
      </label>
      <input
        id="decline-reason"
        className="input"
        autoFocus
        value={reason}
        placeholder={verb === 'Decline' ? 'e.g. Out of scope for this release' : 'e.g. No longer needed'}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onDecline(reason)}
      />
      <div className="decline-actions">
        <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
          Back
        </button>
        <button className="btn btn-danger btn-sm" onClick={() => onDecline(reason)} disabled={busy}>
          {busy ? <Spinner size={12} /> : <Icon name="x" size={14} />} {verb}
        </button>
      </div>
    </div>
  )
}

function describe(c: Command): string {
  const who = mentionedUser(c.arg)
  switch (c.name) {
    case 'take':
      return who ? `assigned @${who}` : 'picked this up'
    case 'drop':
      return who ? `took @${who} off this` : 'dropped this'
    case 'done':
      return 'marked this done'
    case 'reopen':
      return 'reopened this'
    case 'approve':
      return 'approved this'
    case 'reject':
      return c.arg ? `declined this: “${c.arg}”` : 'declined this'
    case 'priority': {
      const p = parsePriority(c.arg)
      return p ? `set priority to ${priorityLabel(p)}` : 'changed the priority'
    }
    case 'due': {
      const d = parseDue(c.arg)
      return d ? `set the due date to ${dueShort(d)}` : 'cleared the due date'
    }
  }
}

function Activity({ job, notes }: { job: Job; notes: Note[] }) {
  const sorted = [...notes].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return (
    <ol className="timeline">
      <li className="event">
        <Avatar person={job.author} size={18} />
        <span>
          <strong>{job.author.login}</strong> {job.status === 'proposal' ? 'proposed this' : 'posted this'}
        </span>
        <time className="event-time" dateTime={job.createdAt}>
          {timeAgo(job.createdAt)}
        </time>
      </li>
      {sorted.flatMap((n) => [
        n.text && (
          <li key={`c${n.id}`} className={`comment${n.author.isBot ? ' comment-bot' : ''}`}>
            <div className="comment-head">
              <Avatar person={n.author} size={20} />
              <strong>{n.author.isBot ? 'Board bot' : n.author.login}</strong>
              <time className="event-time" dateTime={n.createdAt}>
                {timeAgo(n.createdAt)}
              </time>
            </div>
            <Markdown text={n.text} className="comment-body" />
          </li>
        ),
        n.commands.length > 0 && (
          <li key={`e${n.id}`} className={`event${n.failed ? ' failed' : ''}`}>
            <Avatar person={n.author} size={18} />
            <span>
              <strong>{n.author.login}</strong> {n.commands.map(describe).join(', ')}
              {n.failed && <span className="muted"> (didn't go through)</span>}
            </span>
            <time className="event-time" dateTime={n.createdAt}>
              {timeAgo(n.createdAt)}
            </time>
          </li>
        ),
      ])}
    </ol>
  )
}

function Composer({ job, viewer, actions, onSignIn }: { job: Job; viewer: Viewer | null; actions: Board['actions']; onSignIn(): void }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  useEffect(() => setText(''), [job.number])

  if (!viewer) {
    return (
      <button className="composer-signin" onClick={onSignIn}>
        <Icon name="message" /> Sign in to comment
      </button>
    )
  }
  const send = async () => {
    if (!text.trim()) return
    setSending(true)
    try {
      await actions.comment(job, text.trim())
      setText('')
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setSending(false)
    }
  }
  return (
    <div className="composer">
      <Avatar person={viewer} size={28} />
      <div className="composer-box">
        <textarea
          className="input"
          rows={2}
          placeholder="Write a comment…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && send()}
        />
        <div className="composer-foot">
          <span className="hint">Markdown works · ⌘/Ctrl + Enter to send</span>
          <button className="btn btn-sm btn-outline" disabled={sending || !text.trim()} onClick={send}>
            {sending ? <Spinner size={12} /> : <Icon name="message" size={14} />} Comment
          </button>
        </div>
      </div>
    </div>
  )
}
