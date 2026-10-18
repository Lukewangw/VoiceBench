import { useEffect, useState } from 'react'
import { shortDate, timeAgo } from '../lib/format'
import { isOn, type Job } from '../lib/model'
import type { Viewer } from '../state'
import { AvatarStack, DueDate, Icon, PriorityPill, Spinner } from './ui'

export type Tab = 'jobs' | 'others' | 'done'
export const TABS: { key: Tab; label: string }[] = [
  { key: 'jobs', label: 'Jobs' },
  { key: 'others', label: 'Others' },
  { key: 'done', label: 'Done' },
]

export function Tabs({ tab, counts }: { tab: Tab; counts: Record<Tab, number> }) {
  return (
    <nav className="tabs" aria-label="Board sections">
      {TABS.map((t) => (
        <a
          key={t.key}
          className={`tab${tab === t.key ? ' active' : ''}`}
          href={`#/${t.key}`}
          aria-current={tab === t.key ? 'page' : undefined}
        >
          {t.label}
          <span className={`tab-count${t.key === 'others' && counts.others > 0 ? ' attention' : ''}`}>
            {counts[t.key]}
          </span>
        </a>
      ))}
    </nav>
  )
}

/** Long lists (Done, mostly) show this many rows at a time. */
const PAGE = 50

interface ListProps {
  tab: Tab
  jobs: Job[]
  othersCount: number
  query: string
  onClearQuery(): void
  loading: boolean
  viewer: Viewer | null
  pending: Record<string, string>
  onNew(): void
  onApprove(job: Job): Promise<void>
}

export function JobList({
  tab,
  jobs,
  othersCount,
  query,
  onClearQuery,
  loading,
  viewer,
  pending,
  onNew,
  onApprove,
}: ListProps) {
  const [limit, setLimit] = useState(PAGE)
  useEffect(() => setLimit(PAGE), [tab, query])
  const hidden = jobs.length - limit

  return (
    <>
      {tab === 'others' && !query && <OthersIntro viewer={viewer} />}
      <div className="card">
        {loading && !jobs.length ? (
          <Skeleton />
        ) : !jobs.length && query ? (
          <div className="empty">
            <span className="empty-icon">
              <Icon name="search" size={22} />
            </span>
            <div className="empty-title">Nothing here matches “{query}”</div>
            <div className="empty-text">
              Try another word, a name, or a number like #12. Other tabs may have matches.
            </div>
            <button className="btn btn-outline" onClick={onClearQuery}>
              <Icon name="x" size={15} /> Clear search
            </button>
          </div>
        ) : !jobs.length ? (
          <Empty tab={tab} viewer={viewer} onNew={onNew} />
        ) : (
          <ul className="list">
            {jobs.slice(0, limit).map((job) => (
              <Row key={job.key} tab={tab} job={job} viewer={viewer} pending={pending[job.key]} onApprove={onApprove} />
            ))}
          </ul>
        )}
        {hidden > 0 && (
          <button className="more-row" onClick={() => setLimit((n) => n + PAGE)}>
            Show {Math.min(PAGE, hidden)} more <span className="muted">· {hidden} not shown</span>
          </button>
        )}
        {tab === 'jobs' && !loading && !query && (
          <a className="others-row" href="#/others">
            <Icon name="lightbulb" />
            <span className="others-row-title">Others</span>
            <span className="others-row-text">
              {othersCount === 0
                ? 'Have an idea? Anyone can propose a job here.'
                : `${othersCount} proposal${othersCount === 1 ? '' : 's'} waiting for an admin`}
            </span>
            <Icon name="arrowRight" className="others-row-arrow" />
          </a>
        )}
      </div>
    </>
  )
}

function Row({
  tab,
  job,
  viewer,
  pending,
  onApprove,
}: {
  tab: Tab
  job: Job
  viewer: Viewer | null
  pending?: string
  onApprove(job: Job): Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const done = tab === 'done'
  const mine = tab === 'jobs' && isOn(job, viewer?.login)
  const meta =
    tab === 'others'
      ? `Proposed by ${job.author.login} · ${timeAgo(job.createdAt)}`
      : done
        ? job.assignees.length
          ? `Done by ${job.assignees.map((a) => a.login).join(', ')}`
          : 'Done'
        : null

  return (
    <li className={`row row-${job.status}${mine ? ' row-mine' : ''}`}>
      <a className="row-link" href={`#/${tab}/${job.key}`}>
        <span className="sr-only">
          Open {job.title}
          {mine && " (you're on it)"}
        </span>
      </a>
      <PriorityPill priority={job.priority} />
      <div className="row-main">
        <span className="row-title">
          {job.private && (
            <span className="lock" title="Private: only admins can see this">
              <Icon name="lock" size={13} />
            </span>
          )}
          {job.title}
        </span>
        {meta && <span className="row-meta">{meta}</span>}
      </div>
      {pending ? (
        <span className="row-pending">
          <Spinner size={12} /> <span className="row-pending-text">{pending}</span>
        </span>
      ) : (
        tab === 'others' &&
        viewer?.isAdmin && (
          <button
            className="btn btn-sm btn-approve row-action"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onApprove(job)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? <Spinner size={12} /> : <Icon name="check" size={14} />}
            <span className="row-action-text">Approve</span>
          </button>
        )
      )}
      <AvatarStack people={tab === 'others' ? [job.author] : job.assignees} me={viewer?.login} />
      {done ? (
        <span className="due due-later">{job.closedAt ? shortDate(new Date(job.closedAt)) : ''}</span>
      ) : (
        <DueDate due={job.due} />
      )}
    </li>
  )
}

function OthersIntro({ viewer }: { viewer: Viewer | null }) {
  return (
    <div className="banner">
      <span className="banner-icon">
        <Icon name="lightbulb" size={18} />
      </span>
      <div className="banner-text">
        {viewer?.isAdmin ? (
          <>
            <strong>Proposals from the team.</strong> Approve one to move it into Jobs, or open it to decline.
          </>
        ) : (
          <>
            <strong>Anyone can suggest a job here.</strong> An admin reviews each one; approved ones move into Jobs.
          </>
        )}
      </div>
    </div>
  )
}

function Empty({ tab, viewer, onNew }: { tab: Tab; viewer: Viewer | null; onNew(): void }) {
  const copy = {
    jobs: {
      title: 'Nothing on the board yet',
      text: viewer?.isAdmin
        ? 'Add the first job and the team can start picking things up.'
        : 'When admins add jobs, they show up here.',
    },
    others: { title: 'No proposals right now', text: 'Got an idea for something the team should do? Propose it.' },
    done: { title: 'Nothing finished yet', text: 'Jobs marked done show up here.' },
  }[tab]
  const canAct = tab === 'others' || (tab === 'jobs' && viewer?.isAdmin)
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={tab === 'done' ? 'circleCheck' : tab === 'others' ? 'lightbulb' : 'inbox'} size={22} />
      </span>
      <div className="empty-title">{copy.title}</div>
      <div className="empty-text">{copy.text}</div>
      {canAct && (
        <button className="btn btn-primary" onClick={onNew}>
          <Icon name="plus" size={15} /> {viewer?.isAdmin ? 'New job' : 'Propose a job'}
        </button>
      )}
    </div>
  )
}

function Skeleton() {
  return (
    <ul className="list" aria-busy="true" aria-label="Loading">
      {[62, 48, 70, 40].map((w, i) => (
        <li key={i} className="row skeleton">
          <span className="sk sk-pill" />
          <span className="sk sk-line" style={{ width: `${w}%` }} />
          <span className="sk sk-dot" />
          <span className="sk sk-date" />
        </li>
      ))}
    </ul>
  )
}
