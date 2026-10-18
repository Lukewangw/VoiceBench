import { useEffect, useRef, useState } from 'react'
import { shortDate, timeAgo } from '../lib/format'
import { isOn, type Job } from '../lib/model'
import type { Viewer } from '../state'
import { AvatarStack, DateCell, DueDate, Icon, PriorityPill, Spinner } from './ui'

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

// Quick filters on Jobs: what nobody has picked up yet, and what you're on.
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'free', label: 'Up for grabs' },
  { key: 'mine', label: 'Mine' },
] as const
type Filter = (typeof FILTERS)[number]['key']

function applyFilter(jobs: Job[], filter: Filter, login: string | undefined) {
  if (filter === 'free') return jobs.filter((j) => j.status === 'open')
  if (filter === 'mine') return jobs.filter((j) => isOn(j, login))
  return jobs
}

interface ListProps {
  tab: Tab
  jobs: Job[]
  /** Declined proposals (Others) or cancelled jobs (Done), shown folded away under the list. */
  closed: Job[]
  /** How many jobs each tab has for the current search. */
  counts: Record<Tab, number>
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
  closed,
  counts,
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
  const [chosen, setFilter] = useState<Filter>('all')
  // Filters are for Jobs only, and Mine needs to know who you are.
  const filter: Filter = tab !== 'jobs' || (chosen === 'mine' && !viewer) ? 'all' : chosen
  const shown = applyFilter(jobs, filter, viewer?.login)
  useEffect(() => setLimit(PAGE), [tab, query, filter])
  const hidden = shown.length - limit

  // An approved proposal leaves Others, and its button with it; keyboard focus goes to the row
  // that takes its place (or the tabs, if it was the last one).
  const refocus = useRef<{ key: string; index: number } | null>(null)
  useEffect(() => {
    const r = refocus.current
    if (!r || shown.some((j) => j.key === r.key)) return
    refocus.current = null
    if (document.activeElement && document.activeElement !== document.body) return
    const rows = document.querySelectorAll<HTMLElement>('.list .row-link')
    ;(rows[Math.min(r.index, rows.length - 1)] ?? document.querySelector<HTMLElement>('.tab.active'))?.focus()
  }, [shown])
  const approve = async (job: Job, index: number) => {
    refocus.current = { key: job.key, index }
    await onApprove(job)
    // Still listed (it didn't go through): nothing to move.
    window.setTimeout(() => refocus.current?.key === job.key && (refocus.current = null), 2000)
  }

  return (
    <>
      {tab === 'others' && !query && <OthersIntro viewer={viewer} />}
      {tab === 'jobs' && jobs.length > 0 && (
        <div className="filters" role="group" aria-label="Show">
          {FILTERS.filter((f) => f.key !== 'mine' || viewer).map((f) => (
            <button
              key={f.key}
              type="button"
              className="filter"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              <span className="filter-count">{applyFilter(jobs, f.key, viewer?.login).length}</span>
            </button>
          ))}
        </div>
      )}
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
              {(() => {
                const elsewhere = TABS.filter((t) => t.key !== tab && counts[t.key] > 0)
                if (closed.length) return `${closed.length} ${tab === 'others' ? 'declined' : 'cancelled'} below.`
                if (!elsewhere.length) return 'Try another word, a name, or a number like #12.'
                return (
                  <>
                    Found in{' '}
                    {elsewhere.map((t, i) => (
                      <span key={t.key}>
                        {i > 0 && ' and '}
                        <a href={`#/${t.key}`}>
                          {t.label} ({counts[t.key]})
                        </a>
                      </span>
                    ))}
                    .
                  </>
                )
              })()}
            </div>
            <button className="btn btn-outline" onClick={onClearQuery}>
              <Icon name="x" size={15} /> Clear search
            </button>
          </div>
        ) : !jobs.length ? (
          <Empty tab={tab} viewer={viewer} onNew={onNew} />
        ) : !shown.length ? (
          <FilterEmpty filter={filter} onFilter={setFilter} />
        ) : (
          <ul className="list">
            {shown.slice(0, limit).map((job, index) => (
              <Row
                key={job.key}
                tab={tab}
                job={job}
                viewer={viewer}
                pending={pending[job.key]}
                onApprove={(j) => approve(j, index)}
              />
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
      {closed.length > 0 && (
        <details className="closed-section" open={!!query}>
          <summary>
            {tab === 'others' ? 'Declined' : 'Cancelled'} <span className="tab-count">{closed.length}</span>
          </summary>
          <div className="card">
            <ul className="list">
              {closed.map((job) => (
                <Row
                  key={job.key}
                  tab={tab}
                  job={job}
                  viewer={viewer}
                  pending={pending[job.key]}
                  onApprove={onApprove}
                />
              ))}
            </ul>
          </div>
        </details>
      )}
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
  const names = job.assignees.map((a) => a.login).join(', ')
  const closed = job.status === 'closed'
  const meta =
    tab === 'others'
      ? `Proposed by ${job.author.login} · ${timeAgo(job.createdAt)}`
      : closed
        ? names && `Was with ${names}`
        : done
          ? names
            ? `Done by ${names}`
            : 'Done'
          : names && `Picked up by ${names}`
  const closedAt = job.closedAt ? shortDate(new Date(job.closedAt)) : ''

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
        // Quick approval is for open proposals; a declined one is approved (after all) from its page.
        job.status === 'proposal' &&
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
      {closed ? (
        <DateCell label={job.isJob ? 'Cancelled' : 'Declined'} date={closedAt} tone="none" />
      ) : done ? (
        <DateCell label="Done" date={closedAt} />
      ) : (
        <DueDate due={job.due} createdAt={job.createdAt} />
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

function FilterEmpty({ filter, onFilter }: { filter: Filter; onFilter(filter: Filter): void }) {
  const mine = filter === 'mine'
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={mine ? 'inbox' : 'circleCheck'} size={22} />
      </span>
      <div className="empty-title">{mine ? "You're not on any job yet" : 'Everything is picked up'}</div>
      <div className="empty-text">
        {mine ? 'Pick one up and it shows up here.' : 'Every job has someone on it. New ones show up here.'}
      </div>
      <button className="btn btn-outline" onClick={() => onFilter(mine ? 'free' : 'all')}>
        {mine ? 'See what is up for grabs' : 'Show all jobs'}
      </button>
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
