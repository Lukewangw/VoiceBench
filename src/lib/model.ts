import {
  JOB_LABEL,
  boardStatus,
  failedIds,
  failureReasons,
  hasLabel,
  isCommandOnly,
  labelNames,
  parseBody,
  parseCommands,
  priorityFromLabels,
  stripCommands,
  type BoardStatus,
  type Command,
  type PriorityKey,
} from '../../shared/board.js'
import type { RawComment, RawIssue, RawUser } from './github'

export interface Person {
  login: string
  avatarUrl: string
  url: string
  isBot: boolean
}

/** Which repository an issue came from. */
export interface Source {
  repo: string
  private: boolean
}

export interface Job {
  /** Unique across both repositories: "12" for public issue #12, "p3" for private issue #3. */
  key: string
  repo: string
  private: boolean
  number: number
  title: string
  body: string
  description: string
  priority: PriorityKey | null
  due: string | null
  status: BoardStatus
  /** Approved as a job (vs. a proposal), whatever state it is in now. */
  isJob: boolean
  author: Person
  assignees: Person[]
  labels: string[]
  createdAt: string
  updatedAt: string
  closedAt: string | null
  url: string
}

export interface Note {
  id: number
  issue: number
  author: Person
  body: string
  /** The body without command lines. */
  text: string
  createdAt: string
  url: string
  commands: Command[]
  commandOnly: boolean
  /** The command didn't go through (the bot said so, or reacted 😕 without a 👍). */
  failed: boolean
  /** Why not, from the bot's answer. */
  failedBecause?: string
  /** A bot answer about a command in this list: shown with that command instead of on its own. */
  answers?: number
}

export function toPerson(u: RawUser | null | undefined): Person {
  const login = u?.login ?? 'ghost'
  return {
    login,
    avatarUrl: u?.avatar_url ?? `https://github.com/${login}.png?size=64`,
    url: u?.html_url ?? `https://github.com/${login}`,
    isBot: u?.type === 'Bot' || login.endsWith('[bot]'),
  }
}

export const jobKey = (number: number, isPrivate = false) => (isPrivate ? `p${number}` : String(number))

export function toJob(raw: RawIssue, source: Source): Job {
  const fields = parseBody(raw.body)
  // Only admins can see the private repository, so everything in it counts as an approved job.
  const labels = source.private ? [...raw.labels, JOB_LABEL] : raw.labels
  return {
    key: jobKey(raw.number, source.private),
    repo: source.repo,
    private: source.private,
    number: raw.number,
    title: raw.title,
    body: raw.body ?? '',
    description: fields.description,
    priority: priorityFromLabels(raw.labels) ?? fields.priority,
    due: fields.due,
    status: boardStatus({ ...raw, labels }),
    isJob: hasLabel(labels, JOB_LABEL),
    author: toPerson(raw.user),
    assignees: (raw.assignees ?? []).map(toPerson),
    labels: labelNames(raw.labels),
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    closedAt: raw.closed_at,
    url: raw.html_url,
  }
}

/**
 * Marks the commands that didn't go through: the bot names them in its reply (anyone can add a
 * 👍 or 😕, so reaction counts alone can't tell).
 */
export function withFailures(notes: Note[]): Note[] {
  const answer = new Map<number, Note>()
  for (const n of notes) if (n.author.isBot) for (const id of failedIds(n.body)) answer.set(id, n)
  if (!answer.size) return notes
  const ids = new Set(notes.map((n) => n.id))
  return notes.map((n) => {
    const reply = answer.get(n.id)
    if (reply) return { ...n, failed: true, failedBecause: failureReasons(reply.body).join('; ') || undefined }
    const about = n.author.isBot ? failedIds(n.body).find((id) => ids.has(id)) : undefined
    return about === undefined ? n : { ...n, answers: about }
  })
}

export function toNote(raw: RawComment): Note {
  const body = raw.body ?? ''
  return {
    id: raw.id,
    issue: raw.issue_number ?? Number(raw.issue_url?.split('/').pop()),
    author: toPerson(raw.user),
    body,
    text: stripCommands(body),
    createdAt: raw.created_at,
    url: raw.html_url,
    commands: parseCommands(body),
    commandOnly: isCommandOnly(body),
    // Settled by withFailures from the bot's replies; a 😕 with no 👍 is the fallback for old ones.
    failed: (raw.reactions?.confused ?? 0) > 0 && !((raw.reactions?.['+1'] ?? 0) > 0),
  }
}

export const sameLogin = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
export const isOn = (job: Job, login: string | undefined) =>
  !!login && job.assignees.some((a) => sameLogin(a.login, login))

const RANK: Record<PriorityKey, number> = { P0: 0, P1: 1, P2: 2, P3: 3 }

/** Priority first, then the nearest due date, then oldest first. */
export function byPriority(a: Job, b: Job): number {
  const pa = a.priority ? RANK[a.priority] : 9
  const pb = b.priority ? RANK[b.priority] : 9
  if (pa !== pb) return pa - pb
  if (a.due !== b.due) return !a.due ? 1 : !b.due ? -1 : a.due < b.due ? -1 : 1
  return a.number - b.number
}

export const byRecentlyClosed = (a: Job, b: Job) => (b.closedAt ?? '').localeCompare(a.closedAt ?? '')
