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

/** Answers that mean "no date" (or no answer at all). */
const NO_ANSWER = /^(_?no response_?|none|n\/a|tbd|-)$/i

function readDate(s, year) {
  let m
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/.exec(s))) return ymd(+m[1], +m[2], +m[3])
  if ((m = /^(?:(\d{4}) ?年 ?)?(\d{1,2}) ?月 ?(\d{1,2}) ?[日号]?$/.exec(s)))
    return ymd(m[1] ? +m[1] : year, +m[2], +m[3])
  if ((m = /^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2}|\d{4}))?$/.exec(s))) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : year
    // Month first (10/15), unless the first number can't be a month (31/10 is day first).
    return +m[1] > 12 ? ymd(y, +m[2], +m[1]) : ymd(y, +m[1], +m[2])
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

/**
 * Read a due date into "YYYY-MM-DD". Accepts 2026-10-15, 2026/10/15, 10/15, 10/15/2026, 31/10,
 * Oct 15, Oct/15, October 15 2026, 15 Oct and 10月15日, also with a note after the date
 * ("Oct 15 (hard deadline)"). A missing year means the current year.
 */
export function parseDue(text, today = new Date()) {
  if (text == null) return null
  // A date comes first, so a long answer is cut short before any work on it (issue text is untrusted).
  const s = String(text).trim().slice(0, 200).replace(/\s+/g, ' ')
  if (!s || NO_ANSWER.test(s)) return null
  const year = today.getFullYear()
  const whole = readDate(s, year)
  if (whole) return whole
  // A note after the date ("Jan 15, 2027 (after the holidays)"): the longest part before one that reads as a date.
  const cuts = [...s.matchAll(/ ?[(（[]| [-–—] |[,;，；] /g)].map((m) => m.index).reverse()
  for (const at of cuts) {
    const date = readDate(s.slice(0, at), year)
    if (date) return date
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
//
// People edit bodies by hand too, so reading is forgiving and changes are surgical: a change
// rewrites the one answer it is about and keeps every other line as it was written.

const FIELDS = {
  description: ['description', 'details', 'summary'],
  priority: ['priority'],
  due: ['due date', 'due', 'deadline'],
}
const HEADINGS = { description: '### Description', priority: '### Priority', due: '### Due date' }
const EMPTY = '_No response_'
const READ = { priority: (line) => parsePriority(line), due: (line) => parseDue(line) }
// The form's answer to "Priority" ("P1 · High"), or just "P1" or "High". Only that counts as the
// field, so a description's own "Priority" section is never taken for it (or removed by the bot).
const PRIORITY_ANSWER = /^(p[0-3]( *[·:\-–—]? *(urgent|high|medium|low))?|urgent|critical|high|medium|med|normal|low)$/i
// Answers are a few characters long; checking the length first keeps a crafted line from costing time.
const readsAsPriority = (line) => line.length <= 40 && PRIORITY_ANSWER.test(line)

/** A level 2–4 heading's text, or null. Issue text is untrusted, so no backtracking regex here. */
function headingText(line) {
  const start = /^#{2,4}[ \t]/.exec(line)?.[0].length
  if (!start) return null
  let end = line.length
  while (end > start && ' \t#'.includes(line[end - 1])) end--
  return line.slice(start, end).trim()
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
 * Finds the fields. The form writes Description, Priority and Due date in that order, and a
 * description can have sub-headings of its own (even one called "Deadline"). So the first
 * Description heading is the description, and the last Priority and Due date headings whose first
 * line reads as an answer are those fields. A field's section runs to the next field heading.
 */
function layout(body) {
  const lines = String(body ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
  const found = { description: [], priority: [], due: [] }
  let inFence = false
  lines.forEach((line, at) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    else if (!inFence) {
      const key = fieldFor(headingText(line) ?? '')
      if (key) found[key].push(at)
    }
  })
  const nextLine = (at) => {
    for (let i = at + 1; i < lines.length; i++) if (lines[i].trim()) return lines[i].trim()
    return undefined
  }
  const isDue = (at) => {
    const next = nextLine(at)
    return next === undefined || next.startsWith('#') || NO_ANSWER.test(next) || parseDue(next) !== null
  }
  const isPriority = (at) => readsAsPriority(nextLine(at) ?? '')
  const heads = {
    description: found.description[0],
    priority: found.priority.filter(isPriority).at(-1),
    due: found.due.filter(isDue).at(-1),
  }
  const starts = Object.values(heads)
    .filter((at) => at !== undefined)
    .sort((a, b) => a - b)
  const section = (at) =>
    at === undefined ? null : { head: at, from: at + 1, to: starts.find((s) => s > at) ?? lines.length }
  return {
    lines,
    first: starts[0] ?? lines.length,
    description: section(heads.description),
    priority: section(heads.priority),
    due: section(heads.due),
    // Where a new due date goes when no Due date section reads as one (e.g. "end of October").
    lastDueHeading: found.due.at(-1),
  }
}

/** The line with a field's answer: the section's first line, if it reads as one (or as "none"). */
function answerAt(lines, section, read) {
  if (!section) return -1
  for (let i = section.from; i < section.to; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const answers = read === READ.priority ? readsAsPriority(line) : read(line) !== null
    return answers || NO_ANSWER.test(line) ? i : -1
  }
  return -1
}

/**
 * Split an issue body into our fields. Everything that isn't a field heading or an answer is
 * description, in the order it was written, so nothing people wrote is hidden.
 */
export function parseBody(body) {
  const { lines, first, ...sections } = layout(body)
  const parts = [[0, first]]
  if (sections.description) parts.push([sections.description.from, sections.description.to])
  const answers = { priority: null, due: null }
  for (const key of ['priority', 'due']) {
    const section = sections[key]
    if (!section) continue
    const at = answerAt(lines, section, READ[key])
    if (at >= 0) answers[key] = READ[key](lines[at])
    parts.push([at >= 0 ? at + 1 : section.from, section.to])
  }
  return {
    description: parts
      .sort((a, b) => a[0] - b[0])
      .map(([from, to]) => clean(lines.slice(from, to).join('\n')))
      .filter(Boolean)
      .join('\n\n'),
    priority: answers.priority,
    due: answers.due,
    hasPriority: Boolean(sections.priority),
  }
}

/** Build an issue body in the same shape as the issue form. */
export function formatBody({ description = '', priority = null, due = null } = {}) {
  const sections = [`### Description\n\n${description.trim() || EMPTY}`]
  if (priority) sections.push(`### Priority\n\n${priorityLabel(priority)}`)
  sections.push(`### Due date\n\n${due || EMPTY}`)
  return sections.join('\n\n') + '\n'
}

// The description someone edits is everything parseBody calls description, so a new one replaces
// all of that; the Priority and Due date answers stay exactly as written.
function withDescription(body, description) {
  const { lines, priority, due } = layout(body)
  const answer = (section, read) => {
    const at = answerAt(lines, section, read)
    return at < 0 ? EMPTY : lines[at].trim()
  }
  const sections = [`${HEADINGS.description}\n\n${description.trim() || EMPTY}`]
  if (priority) sections.push(`${HEADINGS.priority}\n\n${answer(priority, READ.priority)}`)
  if (due) sections.push(`${HEADINGS.due}\n\n${answer(due, READ.due)}`)
  return sections.join('\n\n') + '\n'
}

// Puts a new answer into a field, adding the field if the body has none. An old answer that
// couldn't be read stays below the new one, as part of the description.
function withAnswer(body, key, value) {
  const found = layout(body)
  const { lines } = found
  const section = found[key]
  if (section) {
    const at = answerAt(lines, section, READ[key])
    if (at >= 0) lines[at] = value
    else lines.splice(section.from, 0, '', value)
  } else if (key === 'due' && found.lastDueHeading !== undefined) {
    lines.splice(found.lastDueHeading + 1, 0, '', value)
  } else if (key === 'priority' && found.due) {
    lines.splice(found.due.head, 0, HEADINGS.priority, '', value, '')
  } else {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
    lines.push(...(lines.length ? [''] : []), HEADINGS[key], '', value, '')
  }
  return lines.join('\n')
}

// Drops the Priority heading and its answer; any other text in that section stays.
function withoutPriority(body) {
  const { lines, priority } = layout(body)
  if (!priority) return String(body ?? '')
  const at = answerAt(lines, priority, READ.priority)
  let end = at >= 0 ? at + 1 : priority.from
  while (end < priority.to && !lines[end].trim()) end++
  lines.splice(priority.head, end - priority.head)
  return lines.join('\n')
}

/**
 * Change some fields of an existing body, keeping everything else as written. Pass priority: null
 * to drop the Priority section.
 */
export function updateBody(body, patch) {
  let next = String(body ?? '')
  if ('description' in patch) next = withDescription(next, patch.description ?? '')
  // An answer that already says the same stays as written ("Oct 31 (hard deadline)").
  if ('priority' in patch && (!patch.priority || parseBody(next).priority !== patch.priority))
    next = patch.priority ? withAnswer(next, 'priority', priorityLabel(patch.priority)) : withoutPriority(next)
  const due = 'due' in patch ? patch.due || null : undefined
  if (due !== undefined && parseBody(next).due !== due && (due || layout(next).due))
    next = withAnswer(next, 'due', due || EMPTY)
  return next
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

// When the bot can't carry out a command it says why in a reply marked with the command's comment
// id, so the board can tell which commands didn't go through (reactions can't: anyone can react).
export function failedNote(commentId) {
  return `<!-- job board: failed ${commentId} -->`
}

/** The comment id a reply marks as not carried out (the mark ends the reply), as a list. */
export function failedIds(text) {
  const m = /<!-- job board: failed (\d+) -->\s*$/.exec(String(text ?? ''))
  return m ? [Number(m[1])] : []
}

/** Text the bot repeats back, with nothing in it that could pass for one of its hidden marks. */
export function quoteSafely(text) {
  return String(text ?? '').replace(/<!--|-->/g, '')
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
