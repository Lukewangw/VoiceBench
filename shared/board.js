// Board rules shared by the web app (src/) and the GitHub Actions bot (.github/scripts/).
// Keep this file dependency-free: it runs in the browser and in Node.

export const JOB_LABEL = 'job'
export const PROPOSAL_LABEL = 'proposal'

export const PRIORITIES = [
  { key: 'P0', name: 'Urgent', color: 'e5484d', description: 'Urgent: drop everything' },
  { key: 'P1', name: 'High', color: 'f76b15', description: 'High priority' },
  { key: 'P2', name: 'Medium', color: '3e63dd', description: 'Medium priority' },
  { key: 'P3', name: 'Low', color: '8b8d98', description: 'Low priority, nice to have' },
]
export const DEFAULT_PRIORITY = 'P2'

export const BOARD_LABELS = [
  { name: JOB_LABEL, color: '0f9d8a', description: 'Approved job on the board' },
  { name: PROPOSAL_LABEL, color: 'f5a524', description: 'Proposed job, waiting for an admin to approve it' },
  ...PRIORITIES.map((p) => ({ name: p.key, color: p.color, description: p.description })),
]

const PRIORITY_WORDS = { urgent: 'P0', critical: 'P0', high: 'P1', medium: 'P2', med: 'P2', normal: 'P2', low: 'P3' }

export function priorityName(key) {
  return PRIORITIES.find((p) => p.key === key)?.name ?? ''
}

/** "P1 · High" — the wording used in issue bodies and the issue form. */
export function priorityLabel(key) {
  const name = priorityName(key)
  return name ? `${key} · ${name}` : String(key)
}

/** Read a priority out of free text: "P1", "p1 · High", "high", "urgent". */
export function parsePriority(text) {
  if (text == null) return null
  const s = String(text).trim()
  const m = /\bp\s*([0-3])\b/i.exec(s)
  if (m) return `P${m[1]}`
  for (const word of s.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (PRIORITY_WORDS[word]) return PRIORITY_WORDS[word]
  }
  return null
}

export function labelNames(labels) {
  return (labels ?? []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean)
}

export function hasLabel(labels, name) {
  const want = name.toLowerCase()
  return labelNames(labels).some((n) => n.toLowerCase() === want)
}

/** The highest priority label on an issue, or null. */
export function priorityFromLabels(labels) {
  for (const p of PRIORITIES) if (hasLabel(labels, p.key)) return p.key
  return null
}

export function isPriorityLabel(name) {
  return PRIORITIES.some((p) => p.key.toLowerCase() === String(name).toLowerCase())
}

// ---------------------------------------------------------------------------
// Due dates

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function monthNumber(word) {
  return MONTHS.indexOf(word.slice(0, 3).toLowerCase()) + 1
}

function ymd(y, m, d) {
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCMonth() !== m - 1) return null // e.g. Feb 30
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * Read a due date into "YYYY-MM-DD". Accepts 2026-10-15, 2026/10/15, 10/15, 10/15/2026,
 * Oct 15, Oct/15, October 15 2026, 15 Oct. A missing year means the current year.
 */
export function parseDue(text, today = new Date()) {
  if (text == null) return null
  const s = String(text).trim().replace(/\s+/g, ' ')
  if (!s || /^_?no response_?$/i.test(s) || /^(none|n\/a|tbd|-)$/i.test(s)) return null
  const year = today.getFullYear()
  let m
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(s))) return ymd(+m[1], +m[2], +m[3])
  if ((m = /^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2}|\d{4}))?$/.exec(s))) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : year
    return ymd(y, +m[1], +m[2])
  }
  if ((m = /^([a-z]{3,})\.?[ /-]?(\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?$/i.exec(s))) {
    const month = monthNumber(m[1])
    if (month) return ymd(m[3] ? +m[3] : year, month, +m[2])
  }
  if ((m = /^(\d{1,2})(?:st|nd|rd|th)?[ /-]?([a-z]{3,})\.?(?:,? (\d{4}))?$/i.exec(s))) {
    const month = monthNumber(m[2])
    if (month) return ymd(m[3] ? +m[3] : year, month, +m[1])
  }
  return null
}

// ---------------------------------------------------------------------------
// Issue bodies. The issue form (and the web app) write:
//
//   ### Description
//   <markdown>
//   ### Priority          (only until the bot turns it into a label)
//   P1 · High
//   ### Due date
//   2026-10-20

const FIELDS = {
  description: ['description', 'details', 'summary'],
  priority: ['priority'],
  due: ['due date', 'due', 'deadline'],
}

function fieldFor(heading) {
  const h = heading.trim().toLowerCase().replace(/:$/, '').trim()
  for (const [key, names] of Object.entries(FIELDS)) if (names.includes(h)) return key
  return null
}

function clean(text) {
  const t = text.trim()
  return /^_no response_$/i.test(t) ? '' : t
}

/**
 * Split an issue body into our fields. Only known headings start a field, so a description can use
 * its own "###" headings freely. Text before the first field counts as description.
 */
export function parseBody(body) {
  const parts = { pre: [] }
  let current = 'pre'
  let inFence = false
  for (const line of String(body ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    const heading = inFence ? null : /^#{2,4}\s+(.+?)\s*#*\s*$/.exec(line)
    const key = heading && fieldFor(heading[1])
    if (key && !parts[key]) {
      current = key
      parts[key] = []
      continue
    }
    parts[current].push(line)
  }
  const text = (key) => (parts[key] ? clean(parts[key].join('\n')) : '')
  return {
    description: [text('pre'), text('description')].filter(Boolean).join('\n\n'),
    priority: parsePriority(text('priority')),
    due: parseDue(text('due')),
    hasPriority: Boolean(parts.priority),
  }
}

/** Build an issue body in the same shape as the issue form. */
export function formatBody({ description = '', priority = null, due = null } = {}) {
  const sections = [`### Description\n\n${description.trim() || '_No response_'}`]
  if (priority) sections.push(`### Priority\n\n${priorityLabel(priority)}`)
  sections.push(`### Due date\n\n${due || '_No response_'}`)
  return sections.join('\n\n') + '\n'
}

/** Change some fields of an existing body. Pass priority: null to drop the Priority section. */
export function updateBody(body, patch) {
  const current = parseBody(body)
  return formatBody({
    description: 'description' in patch ? patch.description : current.description,
    priority: 'priority' in patch ? patch.priority : current.hasPriority ? current.priority : null,
    due: 'due' in patch ? patch.due : current.due,
  })
}

// ---------------------------------------------------------------------------
// Slash commands, written as issue comments. The bot applies them; the board shows them as activity.

const COMMANDS = {
  take: ['take', 'pick', 'pickup', 'pick-up', 'claim', 'assign'],
  drop: ['drop', 'unassign', 'release', 'unclaim'],
  done: ['done', 'complete', 'finish', 'finished', 'close'],
  reopen: ['reopen'],
  approve: ['approve', 'accept'],
  reject: ['reject', 'decline'],
  priority: ['priority', 'prio'],
  due: ['due', 'deadline'],
}
const COMMAND_LOOKUP = Object.fromEntries(
  Object.entries(COMMANDS).flatMap(([name, words]) => words.map((word) => [word, name])),
)

/** Lines that start with "/command". Code blocks and quoted lines are ignored. */
export function parseCommands(text) {
  const found = []
  let inFence = false
  for (const line of String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence || /^\s*>/.test(line)) continue
    const m = /^\s*\/([a-z][a-z0-9-]*)(?:\s+(.*))?$/i.exec(line)
    if (!m) continue
    let word = m[1].toLowerCase()
    let arg = (m[2] ?? '').trim()
    if (/^p[0-3]$/.test(word)) {
      arg = word.toUpperCase() // "/p1" is short for "/priority P1"
      word = 'priority'
    }
    if (COMMAND_LOOKUP[word]) found.push({ name: COMMAND_LOOKUP[word], arg })
  }
  return found
}

// When the board changes an issue directly (people with the rights to do so), it still leaves the
// command as a comment so the change shows up in the activity. This hidden note marks such a
// comment: the bot acknowledges it but doesn't apply it again.
export const RECORD_NOTE = '<!-- job board: already applied -->'

export function asRecord(command) {
  return `${command}\n\n${RECORD_NOTE}`
}

export function isRecord(text) {
  return /<!--\s*job board: already applied\s*-->/i.test(String(text ?? ''))
}

/** The comment without its command lines (or hidden notes), i.e. the part people wrote for each other. */
export function stripCommands(text) {
  let inFence = false
  const kept = []
  for (const line of String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')) {
    const fence = /^\s*(```|~~~)/.test(line)
    if (fence) inFence = !inFence
    if (inFence || fence) kept.push(line)
    else if (!parseCommands(line).length && !/^\s*<!--.*-->\s*$/.test(line)) kept.push(line)
  }
  return kept.join('\n').trim()
}

/** True when a comment is nothing but commands; the board shows those as activity, not discussion. */
export function isCommandOnly(text) {
  return parseCommands(text).length > 0 && stripCommands(text) === ''
}

/** "@alice" → "alice" from a command argument, or null. */
export function mentionedUser(arg) {
  return /(?:^|\s)@([a-z0-9](?:[a-z0-9-]{0,38}))\b/i.exec(arg ?? '')?.[1] ?? null
}

// ---------------------------------------------------------------------------

/**
 * Where an issue sits on the board:
 *   proposal  open, not approved yet (the Others tab)
 *   open      approved, nobody on it yet
 *   active    approved, someone picked it up
 *   done      closed as completed
 *   closed    closed any other way (declined, cancelled); hidden from the board
 */
export function boardStatus(issue) {
  const isJob = hasLabel(issue.labels, JOB_LABEL)
  if (issue.state === 'closed') {
    return isJob && issue.state_reason !== 'not_planned' && issue.state_reason !== 'duplicate' ? 'done' : 'closed'
  }
  if (!isJob) return 'proposal'
  return (issue.assignees ?? []).length > 0 ? 'active' : 'open'
}
