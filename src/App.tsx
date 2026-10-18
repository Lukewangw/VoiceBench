import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Header } from './components/Header'
import { JobDrawer } from './components/JobDrawer'
import { JobForm } from './components/JobForm'
import { JobList, Tabs, type Tab } from './components/JobList'
import { SignIn } from './components/SignIn'
import { Toasts } from './components/Toasts'
import { Icon, loadMarkdown } from './components/ui'
import { REPO, REPO_URL, TITLE } from './config'
import { byPriority, byRecentlyClosed, type Job } from './lib/model'
import { matchesQuery } from './lib/search'
import { isDialogOpen } from './lib/useDialog'
import { errorText, useAuth, useBoard, type JobInput } from './state'
import { toast } from './toast'

// Routes live in the hash so links work on GitHub Pages: #/jobs, #/others/12, #/jobs/p3 (private), #/done
interface Route {
  tab: Tab
  /** A job key: "12", or "p3" for a private job. */
  job: string | null
}

function readRoute(): Route {
  const [tab, key] = location.hash.replace(/^#\/?/, '').split('/')
  return {
    tab: tab === 'others' || tab === 'done' ? tab : 'jobs',
    job: /^p?[1-9]\d*$/.test(key ?? '') ? key : null,
  }
}

function useRoute() {
  const [route, setRoute] = useState(readRoute)
  useEffect(() => {
    const onChange = () => setRoute(readRoute())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const go = useCallback((tab: Tab, job: string | null = null) => {
    location.hash = `/${tab}${job ? `/${job}` : ''}`
  }, [])
  // Swaps the address without a new history entry, so Back still leaves the page as expected.
  const replace = useCallback((tab: Tab) => {
    history.replaceState(history.state, '', `#/${tab}`)
    setRoute(readRoute())
  }, [])
  return [route, go, replace] as const
}

export function App() {
  const auth = useAuth()
  const board = useBoard(auth)
  const [route, go, replace] = useRoute()
  const [form, setForm] = useState<{ job?: Job } | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const { viewer } = auth

  // Signed out (here, in another tab, or because GitHub stopped taking the token) or signed in as
  // someone else: a job being written or edited belongs to the old session (it may be private).
  // A new token for the same account (say, one that can see private jobs) keeps it.
  const signedInAs = auth.token ? (viewer?.login.toLowerCase() ?? null) : null
  const formOwner = useRef(signedInAs)
  useEffect(() => {
    if (formOwner.current && signedInAs !== formOwner.current) setForm(null)
    formOwner.current = signedInAs
  }, [signedInAs])

  const lists = useMemo(() => {
    const shown = board.jobs.filter((j) => matchesQuery(j, query))
    return {
      jobs: shown.filter((j) => j.status === 'open' || j.status === 'active').sort(byPriority),
      others: shown.filter((j) => j.status === 'proposal').sort(byPriority),
      done: shown.filter((j) => j.status === 'done').sort(byRecentlyClosed),
      // Declined proposals and cancelled jobs, folded away under Others and Done.
      declined: shown.filter((j) => j.status === 'closed' && !j.isJob).sort(byRecentlyClosed),
      cancelled: shown.filter((j) => j.status === 'closed' && j.isJob).sort(byRecentlyClosed),
    }
  }, [board.jobs, query])
  const counts = { jobs: lists.jobs.length, others: lists.others.length, done: lists.done.length }
  const waitingProposals = useMemo(() => board.jobs.filter((j) => j.status === 'proposal').length, [board.jobs])
  const selected = route.job ? (board.jobs.find((j) => j.key === route.job) ?? null) : null

  useEffect(() => {
    // Only once the board has loaded: if loading failed, the job may well exist (and opens on retry).
    if (route.job && !board.loading && !board.error && !selected) {
      toast(
        `Couldn't find that job${route.job.startsWith('p') ? ' (private jobs need an admin sign-in)' : ''}.`,
        'error',
      )
      replace(route.tab)
    }
  }, [route.job, route.tab, board.loading, board.error, selected, replace])

  useEffect(() => {
    document.title = selected ? `${selected.title} · ${TITLE}` : `${TITLE} · Job board`
  }, [selected])

  const closeDrawer = useCallback(() => go(route.tab), [go, route.tab])
  const openSignIn = useCallback(() => setSigningIn(true), [])
  const closeForm = useCallback(() => setForm(null), [])
  const closeSignIn = useCallback(() => setSigningIn(false), [])

  const submitForm = async (input: JobInput) => {
    if (form?.job) {
      await board.actions.edit(form.job, input)
      setForm(null)
    } else {
      const key = await board.actions.create(input)
      setForm(null)
      go(viewer?.isAdmin ? 'jobs' : 'others', key)
    }
  }

  const approve = async (job: Job) => {
    try {
      await board.actions.approve(job)
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  const refresh = async () => {
    setRefreshing(true)
    await board.refresh(true)
    setRefreshing(false)
  }

  // Everyone can add something from Jobs and Others: admins a job, everyone else a proposal.
  const showNew = route.tab !== 'done'
  const openNew = useCallback(() => {
    // Members add jobs as proposals, which live under Others.
    if (!viewer?.isAdmin && route.tab !== 'others') go('others')
    setForm({})
  }, [viewer?.isAdmin, route.tab, go])

  // Keyboard: "/" searches, "n" adds a job (or proposes one). Ignored while typing or in a dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
      const target = e.target instanceof HTMLElement ? e.target : null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (isDialogOpen()) return
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key === 'n') {
        e.preventDefault()
        openNew()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [openNew])

  // Fetch the Markdown renderer in the background once the board is up, so opening a job is instant.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((fn: () => void) => window.setTimeout(fn, 1200))
    idle(() => void loadMarkdown())
  }, [])

  return (
    <>
      <div className="shell">
        <Header
          viewer={viewer}
          syncedAt={board.syncedAt}
          live={board.live}
          stale={board.jobs.length ? board.error : null}
          refreshing={refreshing}
          onRefresh={refresh}
          onSignIn={openSignIn}
          onSignOut={() => {
            auth.signOut()
            toast('Signed out', 'info')
          }}
        />

        <main className="page">
          <h1 className="sr-only">{TITLE} job board</h1>
          {!REPO ? (
            <Problem title="This board doesn't know its repository" text="Build it with VITE_REPO=owner/name set." />
          ) : (
            <>
              <div className="page-head">
                <Tabs tab={route.tab} counts={counts} />
                <label className="search">
                  <Icon name="search" />
                  <input
                    ref={searchRef}
                    type="search"
                    value={query}
                    placeholder="Search"
                    aria-label="Search jobs by title, person or #number"
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setQuery('')
                        e.currentTarget.blur()
                      }
                    }}
                  />
                  {!query && <kbd className="search-key">/</kbd>}
                </label>
                {showNew && (
                  <button className="btn btn-primary" onClick={openNew} title="Keyboard: n">
                    <Icon name="plus" /> {viewer?.isAdmin ? 'New job' : 'Propose a job'}
                  </button>
                )}
              </div>
              {board.error && !board.jobs.length && !board.loading ? (
                <Problem title="Couldn't load the board" text={board.error} onRetry={refresh} />
              ) : (
                <JobList
                  tab={route.tab}
                  jobs={lists[route.tab]}
                  closed={route.tab === 'others' ? lists.declined : route.tab === 'done' ? lists.cancelled : []}
                  counts={counts}
                  othersCount={waitingProposals}
                  query={query}
                  onClearQuery={() => setQuery('')}
                  loading={board.loading}
                  viewer={viewer}
                  pending={board.pending}
                  onNew={openNew}
                  onApprove={approve}
                />
              )}
            </>
          )}
          <footer className="foot">
            Runs on GitHub Issues ·{' '}
            <a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer">
              {REPO}
            </a>
          </footer>
        </main>
      </div>

      {selected && (
        <JobDrawer
          key={selected.key}
          job={selected}
          tab={route.tab}
          notes={board.notes[selected.key] ?? []}
          viewer={viewer}
          pending={board.pending[selected.key]}
          actions={board.actions}
          loadNotes={board.loadNotes}
          onClose={closeDrawer}
          onEdit={(job) => setForm({ job })}
          onSignIn={openSignIn}
        />
      )}
      {form && (
        <JobForm
          job={form.job}
          viewer={viewer}
          canEditDetails={!form.job || board.actions.canEditDetails(form.job)}
          onSubmit={submitForm}
          onClose={closeForm}
          onSignIn={openSignIn}
        />
      )}
      {signingIn && (
        <SignIn
          onSignIn={async (token, remember) => {
            const v = await auth.signIn(token, remember)
            toast(`Signed in as @${v.login}${v.isAdmin ? ' · admin' : ''}`)
            return v
          }}
          onClose={closeSignIn}
          defaultRemember={auth.remembered}
        />
      )}
      <Toasts />
    </>
  )
}

function Problem({ title, text, onRetry }: { title: string; text: string; onRetry?: () => void }) {
  return (
    <div className="card">
      <div className="empty">
        <span className="empty-icon tone-red">
          <Icon name="ban" size={22} />
        </span>
        <div className="empty-title">{title}</div>
        <div className="empty-text">{text}</div>
        <div className="empty-actions">
          {onRetry && (
            <button className="btn btn-primary" onClick={onRetry}>
              <Icon name="refresh" /> Try again
            </button>
          )}
          {REPO && (
            <a className="btn btn-outline" href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer">
              Open on GitHub <Icon name="external" size={13} />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
