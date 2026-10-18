import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_PRIORITY,
  JOB_LABEL,
  PROPOSAL_LABEL,
  asRecord,
  formatBody,
  isPriorityLabel,
  labelNames,
  parseBody,
  priorityFromLabels,
  priorityName,
  updateBody,
  type PriorityKey,
} from '../shared/board.js'
import { PRIVATE_REPO, REPO } from './config'
import { createClient, GitHubError, type RawComment, type RawIssue, type RawUser, type Snapshot } from './lib/github'
import {
  isOn,
  jobKey,
  sameLogin,
  toJob,
  toNote,
  withFailures,
  toPerson,
  type Job,
  type Note,
  type Person,
  type Source,
} from './lib/model'
import { sessionStore, storage } from './lib/storage'
import { toast } from './toast'

const TOKEN_KEY = `job-board:${REPO}:token`
const VIEWER_KEY = `job-board:${REPO}:viewer`
const PUBLIC: Source = { repo: REPO, private: false }
const PRIVATE: Source = { repo: PRIVATE_REPO, private: true }
const sourceOf = (job: Job): Source => (job.private ? PRIVATE : PUBLIC)

export const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.')

// ---------------------------------------------------------------------------
// Signing in: a GitHub token, kept in this browser only.

/**
 * Whether an admin can use private jobs: "yes"; "needs-scope" when the token can't read private
 * repositories at all; "no-access" when the private repository is missing or not shared with them;
 * "not-private" when that repository exists but is public, so nothing in it would be private.
 */
export type PrivateAccess = 'yes' | 'needs-scope' | 'no-access' | 'not-private'

export interface Viewer extends Person {
  isAdmin: boolean
  privateAccess?: PrivateAccess
}

export interface Auth {
  token: string | null
  viewer: Viewer | null
  /** False when the current token is kept for this browser session only. */
  remembered: boolean
  /** `remember: false` keeps the token only until the tab closes. */
  signIn(token: string, remember?: boolean): Promise<Viewer>
  signOut(): void
  /** GitHub stopped accepting the token: sign out and say so (once). */
  expire(): void
}

async function whoIs(token: string): Promise<Viewer> {
  const api = createClient(token)
  const { data: user, headers } = await api.request<RawUser>('GET', '/user')
  // Classic tokens list their scopes; fine-grained and app tokens send no list (or an empty one),
  // in which case GitHub itself will refuse anything the token can't do.
  const scopes = headers.get('x-oauth-scopes')?.trim() || null
  if (scopes !== null && !/(^|[\s,])(public_repo|repo)(?=[\s,]|$)/.test(scopes)) {
    throw new GitHubError('That token can only read. Create one with the "public_repo" scope ticked.', 403)
  }
  const repo = await api.get<{ permissions?: Record<string, boolean> }>(`/repos/${REPO}`)
  const can = repo.permissions ?? {}
  const viewer: Viewer = { ...toPerson(user), isAdmin: Boolean(can.admin || can.maintain || can.push) }
  if (viewer.isAdmin && PRIVATE_REPO) {
    try {
      const companion = await api.get<{ private?: boolean }>(`/repos/${PRIVATE_REPO}`)
      viewer.privateAccess = companion.private === true ? 'yes' : 'not-private'
    } catch {
      const canReadPrivate = scopes === null || /(^|[\s,])repo(?=[\s,]|$)/.test(scopes)
      viewer.privateAccess = canReadPrivate ? 'no-access' : 'needs-scope'
    }
  }
  return viewer
}

// The token is kept in localStorage when someone chose to stay signed in, otherwise in
// sessionStorage, which the browser drops when the tab closes.
const tokenStore = () => (storage.get(TOKEN_KEY) ? storage : sessionStore.get(TOKEN_KEY) ? sessionStore : null)

function savedViewer(): Viewer | null {
  const store = tokenStore()
  if (!store) return null
  try {
    return JSON.parse(store.get(VIEWER_KEY) ?? 'null') as Viewer | null
  } catch {
    return null
  }
}

export function useAuth(): Auth {
  const [token, setToken] = useState(() => tokenStore()?.get(TOKEN_KEY) ?? null)
  const [viewer, setViewer] = useState<Viewer | null>(savedViewer)
  const checked = useRef<string | null>(null)
  const current = useRef(token)
  current.current = token

  const signOut = useCallback(() => {
    checked.current = null
    current.current = null
    for (const store of [storage, sessionStore]) {
      store.remove(TOKEN_KEY)
      store.remove(VIEWER_KEY)
    }
    setToken(null)
    setViewer(null)
  }, [])

  const expire = useCallback(() => {
    if (!current.current) return
    signOut()
    toast('GitHub no longer accepts your token (it may have expired). Sign in again to make changes.', 'info', 8000)
  }, [signOut])

  // A saved token may have expired, or admin rights may have changed since last time. The answer
  // only counts if that token is still the one in use (nobody signed in or out meanwhile).
  useEffect(() => {
    if (!token || checked.current === token) return
    checked.current = token
    whoIs(token)
      .then((v) => {
        if (checked.current !== token) return
        setViewer(v)
        tokenStore()?.set(VIEWER_KEY, JSON.stringify(v))
      })
      .catch((e) => {
        if (checked.current !== token) return
        if (e instanceof GitHubError && e.status === 401) expire()
      })
  }, [token, expire])

  // Signing in or out in another tab of the board applies here too (sessions kept for one tab
  // only are that tab's own).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== TOKEN_KEY) return
      const next = tokenStore()?.get(TOKEN_KEY) ?? null
      if (next === current.current) return
      checked.current = null
      current.current = next
      setToken(next)
      setViewer(savedViewer())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const signIn = useCallback(async (raw: string, remember = true) => {
    // Pasted tokens often bring spaces or invisible characters along (from chat apps and docs).
    const t = raw.replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, '')
    if (!/^[\x21-\x7e]+$/.test(t))
      throw new GitHubError("That doesn't look like a GitHub token. Copy it again from GitHub.", 0)
    const v = await whoIs(t)
    checked.current = t
    current.current = t
    for (const store of [storage, sessionStore]) {
      store.remove(TOKEN_KEY)
      store.remove(VIEWER_KEY)
    }
    const store = remember ? storage : sessionStore
    store.set(TOKEN_KEY, t)
    store.set(VIEWER_KEY, JSON.stringify(v))
    setToken(t)
    setViewer(v)
    return v
  }, [])

  // Session-only sign-ins stay session-only when someone signs in again from inside the board.
  const remembered = tokenStore() !== sessionStore
  return { token, viewer, remembered, signIn, signOut, expire }
}

// ---------------------------------------------------------------------------
// Board data. Everyone first gets the snapshot the site was published with (instant, no rate
// limit). Signed-in people then read GitHub directly, so their own changes show up right away.
// Admins who can see the private repository also get the private jobs, which are never part of
// the published snapshot.

export interface JobInput {
  title: string
  description: string
  priority: PriorityKey
  due: string | null
  /** New jobs only: keep it in the private repository, visible to admins only. */
  private?: boolean
}

export interface Board {
  jobs: Job[]
  /** Comments per job key. */
  notes: Record<string, Note[]>
  loading: boolean
  error: string | null
  live: boolean
  syncedAt: string | null
  /** Jobs waiting for the board bot (by key), with what we're waiting for. */
  pending: Record<string, string>
  refresh(manual?: boolean): Promise<void>
  loadNotes(job: Job): Promise<void>
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

/** How long a job this browser wrote outranks an issue list that doesn't have the change yet. */
const WRITE_SETTLE_MS = 30_000

const byKey = (jobs: Job[]) => Object.fromEntries(jobs.map((j) => [j.key, j])) as Record<string, Job>
const without = <T>(map: Record<string, T>, key: string) => {
  const next = { ...map }
  delete next[key]
  return next
}
const issuesOf = (raw: RawIssue[], source: Source) => raw.filter((i) => !i.pull_request).map((i) => toJob(i, source))
// Private job keys start with "p" (see jobKey).
const privateOnly = <T>(m: Record<string, T>) =>
  Object.fromEntries(Object.entries(m).filter(([k]) => k.startsWith('p')))
const publicOnly = <T>(m: Record<string, T>) =>
  Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith('p')))

export function useBoard(auth: Auth): Board {
  const { token, viewer, expire } = auth
  const seesPrivate = !!viewer?.isAdmin && viewer.privateAccess === 'yes'
  const api = useMemo(() => createClient(token), [token])
  const [jobMap, setJobMap] = useState<Record<string, Job>>({})
  const [notes, setNotes] = useState<Record<string, Note[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<'snapshot' | 'github' | null>(null)
  const [syncedAt, setSyncedAt] = useState<string | null>(null)
  const [pending, setPending] = useState<Record<string, string>>({})

  // While the bot works on someone's command, keep showing the expected result on top of real data.
  const overlays = useRef(new Map<string, (job: Job) => Job>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const lastSync = useRef(0)
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  // Bumped whenever who is signed in, or what they may see, changes. Requests still on their way
  // for the previous session are dropped when they land, and its pending work is called off.
  const generation = useRef(0)
  const privateOk = useRef(seesPrivate)
  const currentApi = useRef(api)
  useLayoutEffect(() => {
    currentApi.current = api
  }, [api])
  useLayoutEffect(() => {
    privateOk.current = seesPrivate
    if (generation.current++ === 0) return
    timers.current.forEach(clearTimeout)
    timers.current.clear()
    overlays.current.clear()
    setPending({})
  }, [token, seesPrivate])

  // Jobs this browser just changed. GitHub's issue lists take a few seconds to catch up with a
  // write, so a refresh in that window could briefly undo it on screen; the written copy wins
  // until the list has it.
  const written = useRef(new Map<string, { job: Job; at: number }>())

  const withOverlay = (job: Job) => overlays.current.get(job.key)?.(job) ?? job
  const putIssue = useCallback((raw: RawIssue, where: Source) => {
    // An admin's action can land after they signed out: private jobs only ever show while allowed.
    if (where.private && !privateOk.current) return
    const job = toJob(raw, where)
    written.current.set(job.key, { job, at: Date.now() })
    setJobMap((m) => ({ ...m, [job.key]: withOverlay(job) }))
  }, [])
  /** A freshly loaded set of jobs, minus anything older than what this browser just wrote. */
  const settle = (loaded: Record<string, Job>) => {
    const now = Date.now()
    for (const [key, { job, at }] of written.current) {
      if (now - at > WRITE_SETTLE_MS) written.current.delete(key)
      else if (!loaded[key] || loaded[key].updatedAt < job.updatedAt) loaded[key] = withOverlay(job)
    }
    return loaded
  }
  const putNote = useCallback((job: Job, raw: RawComment) => {
    if (job.private && !privateOk.current) return
    const note = toNote({ ...raw, issue_number: job.number })
    setNotes((m) => ({ ...m, [job.key]: withFailures([...(m[job.key] ?? []).filter((n) => n.id !== note.id), note]) }))
  }, [])

  // Loaders take the generation their caller started in, so a stale caller's load is dropped too.
  const loadSnapshot = useCallback(async (gen = generation.current) => {
    const snap = await fetchSnapshot()
    if (!snap) return false
    if (gen !== generation.current) return true // signed in or out meanwhile: that load takes over
    let jobs: Record<string, Job>
    const grouped: Record<string, Note[]> = {}
    try {
      jobs = byKey(issuesOf(snap.issues, PUBLIC).map(withOverlay))
      for (const c of snap.comments ?? []) (grouped[jobKey(c.issue_number ?? 0)] ??= []).push(toNote(c))
      for (const key of Object.keys(grouped)) grouped[key] = withFailures(grouped[key])
    } catch {
      return false // a damaged snapshot: read GitHub directly instead
    }
    // The snapshot only has public jobs: keep private ones an admin loaded (while they may see them).
    const keepPrivate = <T>(m: Record<string, T>) => (privateOk.current ? privateOnly(m) : {})
    setJobMap((m) => settle({ ...jobs, ...keepPrivate(m) }))
    setNotes((m) => ({ ...grouped, ...keepPrivate(m) }))
    setSource('snapshot')
    setSyncedAt(snap.generatedAt)
    return true
  }, [])

  const loadFromGitHub = useCallback(
    async (gen = generation.current) => {
      // Every open issue, and the most recently updated closed ones (Done shows the newest first).
      const listIssues = async (repo: string) => {
        const [open, closed] = await Promise.all([
          api.paginate<RawIssue>(`/repos/${repo}/issues?state=open&per_page=100`, 50),
          api.paginate<RawIssue>(`/repos/${repo}/issues?state=closed&sort=updated&direction=desc&per_page=100`, 10),
        ])
        return [...open, ...closed]
      }
      const publicJobs = issuesOf(await listIssues(REPO), PUBLIC)
      let privateJobs: Job[] | null = []
      let privateFailed: unknown = null
      if (seesPrivate) {
        try {
          privateJobs = issuesOf(await listIssues(PRIVATE_REPO), PRIVATE)
        } catch (e) {
          privateJobs = null // keep the private jobs we had rather than blanking them on a hiccup
          privateFailed = e
        }
      }
      if (gen !== generation.current) return // signed in or out meanwhile
      setJobMap((m) =>
        settle({
          ...byKey(publicJobs.map(withOverlay)),
          ...(privateJobs ? byKey(privateJobs.map(withOverlay)) : privateOnly(m)),
        }),
      )
      setSource('github')
      setSyncedAt(new Date().toISOString())
      // The public jobs are fresh; the private ones aren't, and that's worth saying (it also keeps a
      // link to a private job open instead of calling it missing).
      if (privateFailed) throw privateFailed
    },
    [api, seesPrivate],
  )

  const refresh = useCallback(
    async (manual = false) => {
      const gen = generation.current
      lastSync.current = Date.now()
      try {
        if (token) await loadFromGitHub(gen)
        else if (!(await loadSnapshot(gen))) await loadFromGitHub(gen)
        if (gen !== generation.current) return
        setError(null)
        if (manual) toast('Up to date', 'info', 1800)
      } catch (e) {
        if (gen !== generation.current) return
        if (token && e instanceof GitHubError && e.status === 401) return expire()
        if (manual) toast(errorText(e), 'error')
        setError((prev) => prev ?? errorText(e))
      }
    },
    [token, loadFromGitHub, loadSnapshot, expire],
  )

  // First load, and again whenever someone signs in or out.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const gen = generation.current
      lastSync.current = Date.now()
      // Someone else (or nobody) is signed in now: private jobs go away until access is confirmed.
      written.current.clear()
      setJobMap((m) => publicOnly(m))
      setNotes((m) => publicOnly(m))
      const hadSnapshot = await loadSnapshot(gen)
      if (cancelled) return
      try {
        if (token || !hadSnapshot) await loadFromGitHub(gen)
        if (!cancelled) setError(null)
      } catch (e) {
        if (cancelled) return
        if (token && e instanceof GitHubError && e.status === 401) return expire()
        // With the snapshot on screen this is a hiccup (the header says so), otherwise a dead end.
        if (hadSnapshot) toast(errorText(e), 'error')
        setError(errorText(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, loadSnapshot, loadFromGitHub, expire])

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
    async (job: Job) => {
      if (!token && source === 'snapshot') return
      const gen = generation.current
      try {
        const raw = await api.paginateLast<RawComment>(`/repos/${job.repo}/issues/${job.number}/comments?per_page=100`)
        if (gen !== generation.current || (job.private && !privateOk.current)) return
        setNotes((m) => ({ ...m, [job.key]: withFailures(raw.map((c) => toNote({ ...c, issue_number: job.number }))) }))
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
    (job: Job, label: string, expect: (job: Job) => Job, isDone: (job: Job) => boolean, success: string) => {
      // Its action started before a sign-out (or a sign-in as someone else): nothing to wait for.
      if (api !== currentApi.current) return
      const { key } = job
      clearTimeout(timers.current.get(key))
      overlays.current.set(key, expect)
      setPending((p) => ({ ...p, [key]: label }))
      setJobMap((m) => (m[key] ? { ...m, [key]: expect(m[key]) } : m))
      const started = Date.now()
      const finish = () => {
        overlays.current.delete(key)
        timers.current.delete(key)
        setPending((p) => without(p, key))
      }
      const poll = async () => {
        let real: RawIssue | null = null
        try {
          real = await api.get<RawIssue>(`/repos/${job.repo}/issues/${job.number}`)
        } catch {
          // try again next round
        }
        if (api !== currentApi.current) return // signed out (or in as someone else) meanwhile
        if (real && isDone(toJob(real, sourceOf(job)))) {
          finish()
          putIssue(real, sourceOf(job))
          toast(success)
        } else if (Date.now() - started > 150_000) {
          finish()
          if (real) putIssue(real, sourceOf(job))
          toast(
            'The board bot has not caught up yet. Refresh in a minute, or check the Actions tab on GitHub.',
            'info',
            8000,
          )
        } else {
          timers.current.set(key, setTimeout(poll, 4000))
        }
      }
      timers.current.set(key, setTimeout(poll, 6000))
    },
    [api, putIssue],
  )

  const actions = useMemo(
    () => makeActions({ api, viewer, putIssue, putNote, waitForBot }),
    [api, viewer, putIssue, putNote, waitForBot],
  )

  const jobs = useMemo(() => Object.values(jobMap), [jobMap])
  return {
    jobs,
    notes,
    loading,
    error,
    live: source === 'github' && !!token,
    syncedAt,
    pending,
    refresh,
    loadNotes,
    actions,
  }
}

// ---------------------------------------------------------------------------
// Changes. People with write access (admins) change issues directly, then leave the command as a
// "record" comment so it shows in the activity; the bot only acknowledges records. Everyone else
// posts the command and the bot applies it within a minute. Private jobs are admin-only, so they
// always take the direct path.

interface ActionDeps {
  api: ReturnType<typeof createClient>
  viewer: Viewer | null
  putIssue(raw: RawIssue, where: Source): void
  putNote(job: Job, raw: RawComment): void
  waitForBot(job: Job, label: string, expect: (j: Job) => Job, isDone: (j: Job) => boolean, success: string): void
}

function makeActions({ api, viewer, putIssue, putNote, waitForBot }: ActionDeps) {
  const me = () => {
    if (!viewer) throw new Error('Sign in first.')
    return viewer
  }
  const path = (job: Job) => `/repos/${job.repo}/issues/${job.number}`
  const postComment = async (job: Job, body: string) =>
    putNote(job, await api.post<RawComment>(`${path(job)}/comments`, { body }))
  /** For the bot to apply. */
  const command = (job: Job, text: string) => postComment(job, text)
  /** Already applied by the board; kept for the activity feed. */
  const record = (job: Job, text: string) => postComment(job, asRecord(text))
  const update = async (job: Job, patch: object) => putIssue(await api.patch<RawIssue>(path(job), patch), sourceOf(job))
  /**
   * Adds and removes labels one at a time instead of rewriting the whole set from our copy, which
   * can be a minute old: a change someone else made meanwhile (an approval, a priority) stays.
   */
  const unlabel = async (job: Job, name: string) => {
    try {
      await api.del(`${path(job)}/labels/${encodeURIComponent(name)}`)
    } catch (e) {
      if (!(e instanceof GitHubError && e.status === 404)) throw e // already gone
    }
  }
  const relabel = async (
    job: Job,
    {
      add = [],
      remove = [],
      patch,
      priority,
    }: { add?: string[]; remove?: string[]; patch?: object; priority?: PriorityKey },
  ) => {
    // A new priority replaces the ones GitHub has now (our copy can be a minute old), and only those:
    // one someone else sets while this runs stays, rather than both changes undoing each other.
    const replaced = priority
      ? labelNames((await api.get<RawIssue>(path(job))).labels).filter(
          (l) => isPriorityLabel(l) && l.toUpperCase() !== priority,
        )
      : []
    if (patch) await api.patch(path(job), patch)
    if (add.length) await api.post(`${path(job)}/labels`, { labels: add })
    for (const name of [...remove, ...replaced]) await unlabel(job, name)
    const raw = await api.get<RawIssue>(path(job))
    putIssue(raw, sourceOf(job))
    return raw
  }
  const dueCommand = (due: string | null) => (due ? `/due ${due}` : '/due none')

  return {
    canEditDetails(job: Job) {
      return !!viewer && (viewer.isAdmin || (sameLogin(job.author.login, viewer.login) && job.status === 'proposal'))
    },

    /** Creates a job (admins) or a proposal (everyone else). Returns the new job's key. */
    async create(input: JobInput): Promise<string> {
      const v = me()
      const title = input.title.trim()
      if (input.private) {
        if (!v.isAdmin || v.privateAccess !== 'yes')
          throw new Error('Only admins with access to the private repository can add private jobs.')
        const raw = await api.post<RawIssue>(`/repos/${PRIVATE_REPO}/issues`, {
          title,
          body: formatBody({ description: input.description, due: input.due }),
          labels: [JOB_LABEL, input.priority],
        })
        putIssue(raw, PRIVATE)
        toast('Private job added. Only admins can see it.')
        return jobKey(raw.number, true)
      }
      const raw = v.isAdmin
        ? await api.post<RawIssue>(`/repos/${REPO}/issues`, {
            title,
            body: formatBody({ description: input.description, due: input.due }),
            labels: [JOB_LABEL, input.priority],
          })
        : // Labels from people without write access are ignored by GitHub; the bot files it instead.
          await api.post<RawIssue>(`/repos/${REPO}/issues`, { title, body: formatBody(input) })
      putIssue(raw, PUBLIC)
      toast(v.isAdmin ? 'Job added' : 'Proposal sent. An admin will take a look.')
      return jobKey(raw.number)
    },

    async approve(job: Job) {
      me()
      const raw = await relabel(job, {
        add: [JOB_LABEL],
        remove: [PROPOSAL_LABEL],
        patch: job.status === 'closed' ? { state: 'open' } : undefined,
      })
      // Approved jobs always have a priority; one set meanwhile by someone else stays.
      if (!labelNames(raw.labels).some(isPriorityLabel)) await relabel(job, { add: [job.priority ?? DEFAULT_PRIORITY] })
      await record(job, '/approve')
      toast('Approved. It is on the board now.')
    },

    async decline(job: Job, reason = '') {
      me()
      const why = reason.replace(/\s+/g, ' ').trim()
      await update(job, { state: 'closed', state_reason: 'not_planned' })
      await record(job, why ? `/reject ${why}` : '/reject')
      toast(job.status === 'proposal' ? 'Proposal declined' : 'Job cancelled')
    },

    async take(job: Job) {
      const v = me()
      if (v.isAdmin) {
        putIssue(await api.post<RawIssue>(`${path(job)}/assignees`, { assignees: [v.login] }), sourceOf(job))
        await record(job, '/take')
        toast("You're on it")
        return
      }
      await command(job, '/take')
      const self: Person = { login: v.login, avatarUrl: v.avatarUrl, url: v.url, isBot: false }
      waitForBot(
        job,
        'Picking up…',
        (j) => (isOn(j, v.login) ? j : { ...j, assignees: [...j.assignees, self], status: 'active' }),
        (j) => isOn(j, v.login),
        "You're on it",
      )
    },

    async drop(job: Job) {
      const v = me()
      if (v.isAdmin) {
        putIssue(await api.del<RawIssue>(`${path(job)}/assignees`, { assignees: [v.login] }), sourceOf(job))
        await record(job, '/drop')
        toast('Dropped. It is up for grabs again.')
        return
      }
      await command(job, '/drop')
      waitForBot(
        job,
        'Dropping…',
        (j) => {
          const assignees = j.assignees.filter((a) => !sameLogin(a.login, v.login))
          return { ...j, assignees, status: j.status === 'active' && !assignees.length ? 'open' : j.status }
        },
        (j) => !isOn(j, v.login),
        'Dropped. It is up for grabs again.',
      )
    },

    async done(job: Job) {
      const v = me()
      if (v.isAdmin) {
        await update(job, { state: 'closed', state_reason: 'completed' })
        await record(job, '/done')
        toast('Marked done 🎉')
        return
      }
      await command(job, '/done')
      waitForBot(
        job,
        'Marking done…',
        (j) => ({ ...j, status: 'done', closedAt: j.closedAt ?? new Date().toISOString() }),
        (j) => j.status === 'done',
        'Marked done 🎉',
      )
    },

    async reopen(job: Job) {
      const v = me()
      if (v.isAdmin) {
        await update(job, { state: 'open' })
        await record(job, '/reopen')
        toast('Reopened')
        return
      }
      await command(job, '/reopen')
      waitForBot(
        job,
        'Reopening…',
        (j) => ({ ...j, status: j.assignees.length ? 'active' : 'open', closedAt: null }),
        (j) => j.status !== 'done' && j.status !== 'closed',
        'Reopened',
      )
    },

    async setPriority(job: Job, key: PriorityKey) {
      const v = me()
      if (job.priority === key) return
      if (v.isAdmin) {
        await relabel(job, { add: [key], priority: key })
        await record(job, `/priority ${key}`)
        toast(`Priority set to ${key} · ${priorityName(key)}`)
        return
      }
      await command(job, `/priority ${key}`)
      waitForBot(
        job,
        'Updating…',
        (j) => ({ ...j, priority: key }),
        (j) => j.priority === key,
        'Priority updated',
      )
    },

    async setDue(job: Job, due: string | null) {
      me()
      if (job.due === due) return
      // Admins and the author of a proposal can both edit the issue text directly.
      await update(job, { body: updateBody(job.body, { due }) })
      await record(job, dueCommand(due))
      toast(due ? 'Due date updated' : 'Due date cleared')
    },

    async edit(job: Job, input: JobInput) {
      const v = me()
      const fields = { description: input.description, due: input.due }
      // Until the bot files a proposal (it then has a priority label), its Priority answer is the
      // priority, so it changes along with the rest.
      const unfiled = !priorityFromLabels(job.labels) && parseBody(job.body).hasPriority
      const body = updateBody(job.body, unfiled ? { ...fields, priority: input.priority } : fields)
      const priorityChanged = input.priority !== job.priority
      await update(job, { title: input.title.trim(), body })
      if (priorityChanged && v.isAdmin) await relabel(job, { add: [input.priority], priority: input.priority })

      if (input.due !== job.due) await record(job, dueCommand(input.due))
      if (priorityChanged && v.isAdmin) await record(job, `/priority ${input.priority}`)
      if (priorityChanged && !v.isAdmin) {
        await command(job, `/priority ${input.priority}`)
        waitForBot(
          job,
          'Updating…',
          (j) => ({ ...j, priority: input.priority }),
          (j) => j.priority === input.priority,
          'Saved',
        )
      } else {
        toast('Saved')
      }
    },

    async comment(job: Job, text: string) {
      me()
      await postComment(job, text)
    },
  }
}
