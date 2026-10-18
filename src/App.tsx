import { useCallback, useEffect, useMemo, useState } from 'react'
import { Header } from './components/Header'
import { JobDrawer } from './components/JobDrawer'
import { JobForm } from './components/JobForm'
import { JobList, Tabs, type Tab } from './components/JobList'
import { SignIn } from './components/SignIn'
import { Toasts } from './components/Toasts'
import { Icon } from './components/ui'
import { REPO, REPO_URL, TITLE } from './config'
import { byPriority, byRecentlyClosed, type Job } from './lib/model'
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
  return [route, go] as const
}

export function App() {
  const auth = useAuth()
  const board = useBoard(auth)
  const [route, go] = useRoute()
  const [form, setForm] = useState<{ job?: Job } | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const { viewer } = auth

  const lists = useMemo(
    () => ({
      jobs: board.jobs.filter((j) => j.status === 'open' || j.status === 'active').sort(byPriority),
      others: board.jobs.filter((j) => j.status === 'proposal').sort(byPriority),
      done: board.jobs.filter((j) => j.status === 'done').sort(byRecentlyClosed),
    }),
    [board.jobs],
  )
  const counts = { jobs: lists.jobs.length, others: lists.others.length, done: lists.done.length }
  const selected = route.job ? (board.jobs.find((j) => j.key === route.job) ?? null) : null

  useEffect(() => {
    if (route.job && !board.loading && !selected) {
      toast(`Couldn't find that job${route.job.startsWith('p') ? ' (private jobs need an admin sign-in)' : ''}.`, 'error')
      go(route.tab)
    }
  }, [route.job, route.tab, board.loading, selected, go])

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

  const showNew = route.tab !== 'done' && (viewer?.isAdmin || route.tab === 'others')

  return (
    <>
      <Header
        viewer={viewer}
        syncedAt={board.syncedAt}
        live={board.live}
        refreshing={refreshing}
        onRefresh={refresh}
        onSignIn={openSignIn}
        onSignOut={() => {
          auth.signOut()
          toast('Signed out', 'info')
        }}
      />

      <main className="page">
        {!REPO ? (
          <Problem title="This board doesn't know its repository" text="Build it with VITE_REPO=owner/name set." />
        ) : (
          <>
            <div className="page-head">
              <Tabs tab={route.tab} counts={counts} />
              {showNew && (
                <button className="btn btn-primary" onClick={() => setForm({})}>
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
                othersCount={counts.others}
                loading={board.loading}
                viewer={viewer}
                pending={board.pending}
                onNew={() => setForm({})}
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
          onSignIn={async (token) => {
            const v = await auth.signIn(token)
            toast(`Signed in as @${v.login}${v.isAdmin ? ' · admin' : ''}`)
            return v
          }}
          onClose={closeSignIn}
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
