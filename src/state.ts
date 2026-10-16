import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_PRIORITY,
  JOB_LABEL,
  PROPOSAL_LABEL,
  formatBody,
  isPriorityLabel,
  parseBody,
  priorityName,
  updateBody,
  type PriorityKey,
} from '../shared/board.js'
import { REPO } from './config'
import { createClient, GitHubError, type RawComment, type RawIssue, type RawUser, type Snapshot } from './lib/github'
import { isOn, sameLogin, toJob, toNote, toPerson, type Job, type Note, type Person } from './lib/model'
import { storage } from './lib/storage'
import { toast } from './toast'

const TOKEN_KEY = `job-board:${REPO}:token`
const VIEWER_KEY = `job-board:${REPO}:viewer`
const ISSUES = `/repos/${REPO}/issues`

export const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.')

// ---------------------------------------------------------------------------
// Signing in: a GitHub token, kept in this browser only.

export interface Viewer extends Person {
  isAdmin: boolean
}

export interface Auth {
  token: string | null
  viewer: Viewer | null
  signIn(token: string): Promise<Viewer>
  signOut(): void
}

async function whoIs(token: string): Promise<Viewer> {
  const api = createClient(token)
  const { data: user, headers } = await api.request<RawUser>('GET', '/user')
  const scopes = headers.get('x-oauth-scopes') // null for fine-grained tokens
  if (scopes !== null && !/(^|[\s,])(public_repo|repo)(?=[\s,]|$)/.test(scopes)) {
    throw new GitHubError('That token can only read. Create one with the "public_repo" scope ticked.', 403)
  }
  const repo = await api.get<{ permissions?: Record<string, boolean> }>(`/repos/${REPO}`)
  const can = repo.permissions ?? {}
  return { ...toPerson(user), isAdmin: Boolean(can.admin || can.maintain || can.push) }
}

function savedViewer(): Viewer | null {
  if (!storage.get(TOKEN_KEY)) return null
  try {
    return JSON.parse(storage.get(VIEWER_KEY) ?? 'null') as Viewer | null
  } catch {
    return null
  }
}

export function useAuth(): Auth {
  const [token, setToken] = useState(() => storage.get(TOKEN_KEY))
  const [viewer, setViewer] = useState<Viewer | null>(savedViewer)
  const checked = useRef<string | null>(null)

  const signOut = useCallback(() => {
    storage.remove(TOKEN_KEY)
    storage.remove(VIEWER_KEY)
    setToken(null)
    setViewer(null)
  }, [])

  // A saved token may have expired, or admin rights may have changed since last time.
  useEffect(() => {
    if (!token || checked.current === token) return
    checked.current = token
    whoIs(token)
      .then((v) => {
        setViewer(v)
        storage.set(VIEWER_KEY, JSON.stringify(v))
      })
      .catch((e) => {
        if (e instanceof GitHubError && e.status === 401) {
          signOut()
          toast('Your GitHub token expired. Sign in again to make changes.', 'info')
        }
      })
  }, [token, signOut])

  const signIn = useCallback(async (raw: string) => {
    const t = raw.trim()
    const v = await whoIs(t)
    checked.current = t
    storage.set(TOKEN_KEY, t)
    storage.set(VIEWER_KEY, JSON.stringify(v))
    setToken(t)
    setViewer(v)
    return v
  }, [])

  return { token, viewer, signIn, signOut }
}

// ---------------------------------------------------------------------------
// Board data. Everyone first gets the snapshot the site was published with (instant, no rate
// limit). Signed-in people then read GitHub directly, so their own changes show up right away.

export interface JobInput {
  title: string
  description: string
  priority: PriorityKey
  due: string | null
}

export interface Board {
  jobs: Job[]
  notes: Record<number, Note[]>
  loading: boolean
  error: string | null
  live: boolean
  syncedAt: string | null
  /** Jobs waiting for the board bot, with what we're waiting for. */
  pending: Record<number, string>
  refresh(manual?: boolean): Promise<void>
  loadNotes(number: number): Promise<void>
  actions: ReturnType<typeof makeActions>
}

async function fetchSnapshot(): Promise<Snapshot | null> {
  try {
    const res = await fetch(`./data.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as Snapshot
    return Array.isArray(data.issues) ? data : null
  } catch {
    return null
  }
}

const byNumber = (jobs: Job[]) => Object.fromEntries(jobs.map((j) => [j.number, j])) as Record<number, Job>
const without = <T,>(map: Record<number, T>, key: number) => {
  const next = { ...map }
  delete next[key]
  return next
}

export function useBoard(auth: Auth): Board {
  const { token, viewer } = auth
  const api = useMemo(() => createClient(token), [token])
  const [jobMap, setJobMap] = useState<Record<number, Job>>({})
  const [notes, setNotes] = useState<Record<number, Note[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<'snapshot' | 'github' | null>(null)
  const [syncedAt, setSyncedAt] = useState<string | null>(null)
  const [pending, setPending] = useState<Record<number, string>>({})

  // While the bot works on someone's command, keep showing the expected result on top of real data.
  const overlays = useRef(new Map<number, (job: Job) => Job>())
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const lastSync = useRef(0)
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const withOverlay = (job: Job) => overlays.current.get(job.number)?.(job) ?? job
  const setJobs = useCallback((jobs: Job[]) => setJobMap(byNumber(jobs.map(withOverlay))), [])
  const putIssue = useCallback((raw: RawIssue) => setJobMap((m) => ({ ...m, [raw.number]: withOverlay(toJob(raw)) })), [])
  const putNote = useCallback((issue: number, raw: RawComment) => {
    const note = toNote({ ...raw, issue_number: issue })
    setNotes((m) => ({ ...m, [issue]: [...(m[issue] ?? []).filter((n) => n.id !== note.id), note] }))
  }, [])

  const loadSnapshot = useCallback(async () => {
    const snap = await fetchSnapshot()
    if (!snap) return false
    setJobs(snap.issues.filter((i) => !i.pull_request).map(toJob))
    const grouped: Record<number, Note[]> = {}
    for (const c of snap.comments) (grouped[c.issue_number ?? 0] ??= []).push(toNote(c))
    setNotes(grouped)
    setSource('snapshot')
    setSyncedAt(snap.generatedAt)
    return true
  }, [setJobs])

  const loadFromGitHub = useCallback(async () => {
    const raw = await api.paginate<RawIssue>(`${ISSUES}?state=all&per_page=100`)
    setJobs(raw.filter((i) => !i.pull_request).map(toJob))
    setSource('github')
    setSyncedAt(new Date().toISOString())
  }, [api, setJobs])

  const refresh = useCallback(
    async (manual = false) => {
      lastSync.current = Date.now()
      try {
        if (token) await loadFromGitHub()
        else if (!(await loadSnapshot())) await loadFromGitHub()
        setError(null)
        if (manual) toast('Up to date', 'info', 1800)
      } catch (e) {
        if (manual) toast(errorText(e), 'error')
        setError((prev) => prev ?? errorText(e))
      }
    },
    [token, loadFromGitHub, loadSnapshot],
  )

  // First load, and again whenever someone signs in or out.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      lastSync.current = Date.now()
      const hadSnapshot = await loadSnapshot()
      if (cancelled) return
      try {
        if (token || !hadSnapshot) await loadFromGitHub()
        setError(null)
      } catch (e) {
        if (hadSnapshot) toast(errorText(e), 'error')
        else setError(errorText(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, loadSnapshot, loadFromGitHub])

  // Stay fresh: every minute while the tab is visible, and when coming back to the tab.
  useEffect(() => {
    const tick = () => document.visibilityState === 'visible' && refresh()
    const id = setInterval(tick, 60_000)
    const onFocus = () => Date.now() - lastSync.current > 20_000 && tick()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  const loadNotes = useCallback(
    async (number: number) => {
      if (!token && source === 'snapshot') return
      try {
        const raw = await api.paginate<RawComment>(`${ISSUES}/${number}/comments?per_page=100`, 5)
        setNotes((m) => ({ ...m, [number]: raw.map((c) => toNote({ ...c, issue_number: number })) }))
      } catch {
        // keep whatever we already have
      }
    },
    [api, token, source],
  )

  /**
   * People without write access act through slash-command comments that the bot applies within
   * a minute. Show the expected result now, poll GitHub until it's real, then let go.
   */
  const waitForBot = useCallback(
    (number: number, label: string, expect: (job: Job) => Job, isDone: (job: Job) => boolean, success: string) => {
      clearTimeout(timers.current.get(number))
      overlays.current.set(number, expect)
      setPending((p) => ({ ...p, [number]: label }))
      setJobMap((m) => (m[number] ? { ...m, [number]: expect(m[number]) } : m))
      const started = Date.now()
      const finish = () => {
        overlays.current.delete(number)
        timers.current.delete(number)
        setPending((p) => without(p, number))
      }
      const poll = async () => {
        let real: RawIssue | null = null
        try {
          real = await api.get<RawIssue>(`${ISSUES}/${number}`)
        } catch {
          // try again next round
        }
        if (real && isDone(toJob(real))) {
          finish()
          putIssue(real)
          toast(success)
        } else if (Date.now() - started > 150_000) {
          finish()
          if (real) putIssue(real)
          toast('The board bot has not caught up yet. Refresh in a minute, or check the Actions tab on GitHub.', 'info', 8000)
        } else {
          timers.current.set(number, setTimeout(poll, 4000))
        }
      }
      timers.current.set(number, setTimeout(poll, 6000))
    },
    [api, putIssue],
  )

  const actions = useMemo(
    () => makeActions({ api, viewer, putIssue, putNote, waitForBot }),
    [api, viewer, putIssue, putNote, waitForBot],
  )

  const jobs = useMemo(() => Object.values(jobMap), [jobMap])
  return { jobs, notes, loading, error, live: source === 'github' && !!token, syncedAt, pending, refresh, loadNotes, actions }
}

// ---------------------------------------------------------------------------
// Changes. Admins (write access) change issues directly and leave a command comment as the record.
// Everyone else leaves the command comment and the bot applies it. Either way the comment is posted
// first, so the bot can still apply it if the direct change fails.

interface ActionDeps {
  api: ReturnType<typeof createClient>
  viewer: Viewer | null
  putIssue(raw: RawIssue): void
  putNote(issue: number, raw: RawComment): void
  waitForBot(number: number, label: string, expect: (j: Job) => Job, isDone: (j: Job) => boolean, success: string): void
}

function makeActions({ api, viewer, putIssue, putNote, waitForBot }: ActionDeps) {
  const me = () => {
    if (!viewer) throw new Error('Sign in first.')
    return viewer
  }
  const path = (n: number) => `${ISSUES}/${n}`
  const command = async (n: number, text: string) => putNote(n, await api.post<RawComment>(`${path(n)}/comments`, { body: text }))
  const update = async (n: number, patch: object) => putIssue(await api.patch<RawIssue>(path(n), patch))
  const priorityLabels = (job: Job, key: PriorityKey) => [...job.labels.filter((l) => !isPriorityLabel(l)), key]

  return {
    canEditDetails(job: Job) {
      return !!viewer && (viewer.isAdmin || (sameLogin(job.author.login, viewer.login) && job.status === 'proposal'))
    },

    async create(input: JobInput): Promise<number> {
      const { isAdmin } = me()
      const title = input.title.trim()
      const raw = isAdmin
        ? await api.post<RawIssue>(ISSUES, {
            title,
            body: formatBody({ description: input.description, due: input.due }),
            labels: [JOB_LABEL, input.priority],
          })
        : // Labels from people without write access are ignored by GitHub; the bot files it instead.
          await api.post<RawIssue>(ISSUES, { title, body: formatBody(input) })
      putIssue(raw)
      toast(isAdmin ? 'Job added' : 'Proposal sent. An admin will take a look.')
      return raw.number
    },

    async approve(job: Job) {
      me()
      await command(job.number, '/approve')
      const labels = job.labels.filter((l) => l.toLowerCase() !== PROPOSAL_LABEL).concat(JOB_LABEL)
      if (!labels.some(isPriorityLabel)) labels.push(job.priority ?? DEFAULT_PRIORITY)
      await update(job.number, { labels, ...(job.status === 'closed' ? { state: 'open' } : {}) })
      toast('Approved. It is on the board now.')
    },

    async decline(job: Job, reason = '') {
      me()
      const why = reason.replace(/\s+/g, ' ').trim()
      await command(job.number, why ? `/reject ${why}` : '/reject')
      await update(job.number, { state: 'closed', state_reason: 'not_planned' })
      toast(job.status === 'proposal' ? 'Proposal declined' : 'Job cancelled')
    },

    async take(job: Job) {
      const v = me()
      await command(job.number, '/take')
      if (v.isAdmin) {
        putIssue(await api.post<RawIssue>(`${path(job.number)}/assignees`, { assignees: [v.login] }))
        toast("You're on it")
      } else {
        const self: Person = { login: v.login, avatarUrl: v.avatarUrl, url: v.url, isBot: false }
        waitForBot(
          job.number,
          'Picking up…',
          (j) => (isOn(j, v.login) ? j : { ...j, assignees: [...j.assignees, self], status: 'active' }),
          (j) => isOn(j, v.login),
          "You're on it",
        )
      }
    },

    async drop(job: Job) {
      const v = me()
      await command(job.number, '/drop')
      if (v.isAdmin) {
        putIssue(await api.del<RawIssue>(`${path(job.number)}/assignees`, { assignees: [v.login] }))
        toast('Dropped. It is up for grabs again.')
      } else {
        waitForBot(
          job.number,
          'Dropping…',
          (j) => {
            const assignees = j.assignees.filter((a) => !sameLogin(a.login, v.login))
            return { ...j, assignees, status: j.status === 'active' && !assignees.length ? 'open' : j.status }
          },
          (j) => !isOn(j, v.login),
          'Dropped. It is up for grabs again.',
        )
      }
    },

    async done(job: Job) {
      const v = me()
      await command(job.number, '/done')
      if (v.isAdmin) {
        await update(job.number, { state: 'closed', state_reason: 'completed' })
        toast('Marked done 🎉')
      } else {
        waitForBot(
          job.number,
          'Marking done…',
          (j) => ({ ...j, status: 'done', closedAt: j.closedAt ?? new Date().toISOString() }),
          (j) => j.status === 'done',
          'Marked done 🎉',
        )
      }
    },

    async reopen(job: Job) {
      const v = me()
      await command(job.number, '/reopen')
      if (v.isAdmin) {
        await update(job.number, { state: 'open' })
        toast('Reopened')
      } else {
        waitForBot(
          job.number,
          'Reopening…',
          (j) => ({ ...j, status: j.assignees.length ? 'active' : 'open', closedAt: null }),
          (j) => j.status !== 'done' && j.status !== 'closed',
          'Reopened',
        )
      }
    },

    async setPriority(job: Job, key: PriorityKey) {
      const v = me()
      if (job.priority === key) return
      await command(job.number, `/priority ${key}`)
      if (v.isAdmin) {
        await update(job.number, { labels: priorityLabels(job, key) })
        toast(`Priority set to ${key} · ${priorityName(key)}`)
      } else {
        waitForBot(job.number, 'Updating…', (j) => ({ ...j, priority: key }), (j) => j.priority === key, 'Priority updated')
      }
    },

    async setDue(job: Job, due: string | null) {
      me()
      if (job.due === due) return
      await command(job.number, due ? `/due ${due}` : '/due none')
      await update(job.number, { body: updateBody(job.body, { due }) })
      toast(due ? 'Due date updated' : 'Due date cleared')
    },

    async edit(job: Job, input: JobInput) {
      const v = me()
      const fields = { description: input.description, due: input.due }
      // A body that still has its Priority answer (the bot hasn't filed it yet) keeps it in step.
      const body = updateBody(job.body, parseBody(job.body).hasPriority ? { ...fields, priority: input.priority } : fields)
      const patch: Record<string, unknown> = { title: input.title.trim(), body }
      if (input.due !== job.due) await command(job.number, input.due ? `/due ${input.due}` : '/due none')
      const priorityChanged = input.priority !== job.priority
      if (priorityChanged) {
        await command(job.number, `/priority ${input.priority}`)
        if (v.isAdmin) patch.labels = priorityLabels(job, input.priority)
        else waitForBot(job.number, 'Updating…', (j) => ({ ...j, priority: input.priority }), (j) => j.priority === input.priority, 'Saved')
      }
      await update(job.number, patch)
      if (!priorityChanged || v.isAdmin) toast('Saved')
    },

    async comment(job: Job, text: string) {
      me()
      await command(job.number, text)
    },
  }
}
