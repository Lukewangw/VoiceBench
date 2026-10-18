// The board bot. Runs on issue and comment events (see .github/workflows/board.yml) and:
//   - files new issues: admins' go straight to Jobs, everyone else's land in Others as proposals
//   - turns the "Priority" answer of a new issue into a P0-P3 label
//   - runs slash commands from comments: /take /drop /done /reopen /approve /reject /priority /due
//
// "Admin" means anyone with write access to the repository (the owner and collaborators).
// Runs for the same issue never overlap (the workflow queues them), so the bot can work through an
// issue's pending commands in the order people wrote them.

import {
  BOARD_LABELS,
  DEFAULT_PRIORITY,
  JOB_LABEL,
  PROPOSAL_LABEL,
  PRIORITIES,
  boardStatus,
  hasLabel,
  isPriorityLabel,
  isRecord,
  labelNames,
  mentionedUser,
  parseBody,
  parseCommands,
  parseDue,
  parsePriority,
  priorityFromLabels,
  priorityLabel,
  updateBody,
} from '../../shared/board.js'

export default async function triage({ github, context, core }) {
  const { eventName, payload } = context
  const issue = payload.issue
  if (!issue || issue.pull_request) return
  if (eventName === 'issues' && ['deleted', 'transferred'].includes(payload.action)) return

  const bot = createBot({ github, core, ...context.repo, number: issue.number })
  if (eventName === 'issues' && payload.action === 'opened') await bot.fileNewIssue()
  else {
    // A burst of events can skip an issue's "opened" run; any later event files it instead.
    await bot.fileIfUnfiled()
    if (eventName === 'issues' && payload.action === 'labeled') await bot.keepOnePriority(payload.label?.name)
  }
  // A queued run is dropped when a newer one for the same issue arrives, so every run works through
  // all of the issue's pending commands, whatever event brought it here.
  const live = eventName === 'issue_comment' && ['created', 'edited'].includes(payload.action)
  await bot.runCommands(live ? payload.comment : null)
}

// Commands older than this are left alone, so a stray old comment never gets replayed by surprise.
const PENDING_WINDOW_MS = 6 * 60 * 60 * 1000

const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase()
const isBot = (user) => user?.type === 'Bot' || /\[bot\]$/i.test(user?.login ?? '')

export function createBot({ github, core, owner, repo, number }) {
  const ref = { owner, repo, issue_number: number }
  const admins = new Map()
  let labelsReady = false

  async function isAdmin(login) {
    if (!login) return false
    if (!admins.has(login)) {
      let ok = false
      try {
        const { data } = await github.rest.repos.getCollaboratorPermissionLevel({ owner, repo, username: login })
        ok = ['admin', 'maintain', 'write'].includes(data.role_name) || ['admin', 'write'].includes(data.permission)
      } catch (error) {
        if (error.status !== 404) throw error
      }
      admins.set(login, ok)
    }
    return admins.get(login)
  }

  async function getIssue() {
    return (await github.rest.issues.get(ref)).data
  }

  async function ensureLabels() {
    if (labelsReady) return
    const existing = await github.paginate(github.rest.issues.listLabelsForRepo, { owner, repo, per_page: 100 })
    const have = new Set(existing.map((l) => l.name.toLowerCase()))
    for (const label of BOARD_LABELS) {
      if (have.has(label.name.toLowerCase())) continue
      try {
        await github.rest.issues.createLabel({ owner, repo, ...label })
      } catch (error) {
        if (error.status !== 422) throw error // 422: someone else just created it
      }
    }
    labelsReady = true
  }

  async function addLabels(names) {
    if (!names.length) return
    await ensureLabels()
    await github.rest.issues.addLabels({ ...ref, labels: names })
  }

  async function removeLabels(issue, names) {
    for (const name of labelNames(issue.labels)) {
      if (!names.some((n) => same(n, name))) continue
      try {
        await github.rest.issues.removeLabel({ ...ref, name })
      } catch (error) {
        if (error.status !== 404) throw error
      }
    }
  }

  const isAssigned = (issue, login) => (issue.assignees ?? []).some((a) => same(a.login, login))

  async function react(comment, content) {
    try {
      await github.rest.reactions.createForIssueComment({ owner, repo, comment_id: comment.id, content })
    } catch (error) {
      if (error.status !== 404) throw error // deleted meanwhile
    }
  }

  async function getComment(id) {
    try {
      return (await github.rest.issues.getComment({ owner, repo, comment_id: id })).data
    } catch (error) {
      if (error.status === 404) return null // deleted
      throw error
    }
  }

  // Answered means the bot already reacted with 👍 or 😕.
  async function answered(comment) {
    const counts = comment.reactions ?? {}
    if (!(counts['+1'] > 0 || counts.confused > 0)) return false
    const reactions = await github.paginate(github.rest.reactions.listForIssueComment, {
      owner,
      repo,
      comment_id: comment.id,
      per_page: 100,
    })
    return reactions.some((r) => isBot(r.user) && (r.content === '+1' || r.content === 'confused'))
  }

  // An admin may approve a proposal before this bot gets to file it; don't undo that.
  async function approvedByAdmin() {
    const events = await github.paginate(github.rest.issues.listEvents, { ...ref, per_page: 100 })
    for (const e of events) {
      if (e.event === 'labeled' && same(e.label?.name, JOB_LABEL) && (await isAdmin(e.actor?.login))) return true
    }
    return false
  }

  async function fileNewIssue() {
    const issue = await getIssue()
    const fields = parseBody(issue.body)
    const asJob = (await isAdmin(issue.user.login)) || (hasLabel(issue.labels, JOB_LABEL) && (await approvedByAdmin()))
    const add = []
    const remove = []

    if (asJob) {
      if (!hasLabel(issue.labels, JOB_LABEL)) add.push(JOB_LABEL)
      if (hasLabel(issue.labels, PROPOSAL_LABEL)) remove.push(PROPOSAL_LABEL)
    } else {
      if (!hasLabel(issue.labels, PROPOSAL_LABEL)) add.push(PROPOSAL_LABEL)
      if (hasLabel(issue.labels, JOB_LABEL)) remove.push(JOB_LABEL)
    }
    if (!priorityFromLabels(issue.labels)) add.push(fields.priority ?? DEFAULT_PRIORITY)

    await addLabels(add)
    await removeLabels(issue, remove)
    // The label is the source of truth from now on, so drop the form answer to avoid two versions.
    if (fields.hasPriority)
      await github.rest.issues.update({ ...ref, body: updateBody(issue.body, { priority: null }) })
    core.info(`#${number}: filed as ${asJob ? 'job' : 'proposal'}; added [${add}] removed [${remove}]`)
  }

  async function fileIfUnfiled() {
    const issue = await getIssue()
    if (issue.state !== 'open') return
    const unlabelled = !hasLabel(issue.labels, JOB_LABEL) && !hasLabel(issue.labels, PROPOSAL_LABEL)
    // The form labels new issues "proposal" itself, so a Priority answer without a priority label
    // is the other sign that filing never happened.
    if (unlabelled || (!priorityFromLabels(issue.labels) && parseBody(issue.body).hasPriority)) await fileNewIssue()
  }

  async function keepOnePriority(added) {
    if (!added || !isPriorityLabel(added)) return
    const issue = await getIssue()
    // Runs can start late: if a newer change already replaced this label, that one stays.
    if (!hasLabel(issue.labels, added)) return
    await removeLabels(
      issue,
      PRIORITIES.map((p) => p.key).filter((key) => !same(key, added)),
    )
  }

  /**
   * Works through every unanswered command comment on the issue, oldest first. `trigger` is the
   * comment that started this run, if any: lists can lag a few seconds behind a new comment.
   */
  async function runCommands(trigger) {
    const cutoff = Date.now() - PENDING_WINDOW_MS
    const since = new Date(cutoff).toISOString()
    const recent = await github.paginate(github.rest.issues.listComments, { ...ref, since, per_page: 100 })
    const byId = new Map(recent.map((c) => [c.id, c]))
    if (trigger && !isBot(trigger.user) && !byId.has(trigger.id)) byId.set(trigger.id, trigger)
    const queue = [...byId.values()]
      // `since` goes by the last edit, so an old comment edited today shows up too; it stays old.
      .filter((c) => Date.parse(c.created_at) >= cutoff && !isBot(c.user) && parseCommands(c.body).length > 0)
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id)

    let issue = await getIssue()
    for (const pending of queue) {
      if (await answered(pending)) continue
      // As it is now: it may have been edited, or deleted (then there's nothing to do).
      const comment = await getComment(pending.id)
      if (comment && !(await answered(comment))) issue = await handle(comment, issue)
    }
  }

  /** Applies one comment's commands and answers it with a reaction. Returns the updated issue. */
  async function handle(comment, current) {
    let issue = current
    const commands = parseCommands(comment.body)
    const actor = comment.user.login
    const admin = await isAdmin(actor)
    const isAuthor = same(issue.user.login, actor)
    const ran = commands.map((c) => '/' + c.name).join(' ')

    if (isRecord(comment.body)) {
      // The board already made this change itself; only confirm the person was allowed to.
      const ok = admin || (isAuthor && commands.every((c) => c.name === 'due'))
      await react(comment, ok ? '+1' : 'confused')
      core.info(`#${number}: @${actor} recorded ${ran}${ok ? '' : ' without the rights to'}`)
      return issue
    }

    const canEditDetails = () => admin || (isAuthor && boardStatus(issue) === 'proposal')
    const handlers = {
      async take(arg) {
        const who = mentionedUser(arg) ?? actor
        if (!same(who, actor) && !admin) return 'only admins can assign other people.'
        if (isAssigned(issue, who)) return null
        if (issue.state === 'closed') return 'this job is already closed.'
        if (boardStatus(issue) === 'proposal') return 'this is still a proposal; an admin has to approve it first.'
        if ((issue.assignees ?? []).length >= 10) return 'this job already has 10 people on it (the GitHub limit).'
        issue = (await github.rest.issues.addAssignees({ ...ref, assignees: [who] })).data
        if (!isAssigned(issue, who)) return `GitHub would not let me assign @${who}.`
        return null
      },
      async drop(arg) {
        const who = mentionedUser(arg) ?? actor
        if (!same(who, actor) && !admin) return 'only admins can take other people off a job.'
        if (!isAssigned(issue, who)) return null
        issue = (await github.rest.issues.removeAssignees({ ...ref, assignees: [who] })).data
        return null
      },
      async done() {
        if (issue.state === 'closed') return null
        if (boardStatus(issue) === 'proposal') return 'a proposal cannot be marked done; it needs to be approved first.'
        if (!admin && !isAssigned(issue, actor))
          return 'only the people on this job (or an admin) can mark it done. Use `/take` first.'
        issue = (await github.rest.issues.update({ ...ref, state: 'closed', state_reason: 'completed' })).data
        return null
      },
      async reopen() {
        if (issue.state === 'open') return null
        if (!admin && boardStatus(issue) !== 'done') return 'only admins can reopen a cancelled or declined job.'
        if (!admin && !isAssigned(issue, actor)) return 'only admins (or the people who worked on it) can reopen this.'
        issue = (await github.rest.issues.update({ ...ref, state: 'open' })).data
        return null
      },
      async approve() {
        if (!admin) return 'only admins can approve proposals.'
        if (issue.state === 'closed' && boardStatus(issue) === 'closed') {
          issue = (await github.rest.issues.update({ ...ref, state: 'open' })).data
        }
        if (!hasLabel(issue.labels, JOB_LABEL)) await addLabels([JOB_LABEL])
        await removeLabels(issue, [PROPOSAL_LABEL])
        issue = await getIssue()
        return null
      },
      async reject() {
        if (!admin) return 'only admins can decline proposals.'
        if (issue.state === 'closed') return null
        issue = (await github.rest.issues.update({ ...ref, state: 'closed', state_reason: 'not_planned' })).data
        return null
      },
      async priority(arg) {
        const key = parsePriority(arg)
        if (!key) return 'use `/priority P0` (urgent) through `/priority P3` (low).'
        if (!canEditDetails()) return 'only admins can change the priority.'
        if (priorityFromLabels(issue.labels) !== key || labelNames(issue.labels).filter(isPriorityLabel).length > 1) {
          await removeLabels(
            issue,
            PRIORITIES.map((p) => p.key).filter((k) => k !== key),
          )
          await addLabels([key])
          issue = await getIssue()
        }
        return null
      },
      async due(arg) {
        if (!canEditDetails()) return 'only admins can change the due date.'
        const clear = /^(|none|clear|remove|-)$/i.test(arg.trim())
        const due = clear ? null : parseDue(arg)
        if (!clear && !due) return 'I could not read that date. Try `/due 2026-10-20`.'
        if (parseBody(issue.body).due !== due) {
          issue = (await github.rest.issues.update({ ...ref, body: updateBody(issue.body, { due }) })).data
        }
        return null
      },
    }

    const problems = []
    for (const command of commands) {
      const problem = await handlers[command.name](command.arg)
      if (problem) problems.push(`- \`/${command.name}${command.arg ? ' ' + command.arg : ''}\`: ${problem}`)
    }
    await react(comment, problems.length ? 'confused' : '+1')
    if (problems.length) {
      await github.rest.issues.createComment({ ...ref, body: `@${actor} I couldn't do that:\n${problems.join('\n')}` })
    }
    core.info(
      `#${number}: @${actor}${admin ? ' (admin)' : ''} ran ${ran}` +
        (problems.length ? ` with ${problems.length} problem(s)` : '') +
        `; now ${boardStatus(issue)}, priority ${priorityLabel(priorityFromLabels(issue.labels) ?? DEFAULT_PRIORITY)}`,
    )
    return issue
  }

  return { fileNewIssue, fileIfUnfiled, keepOnePriority, runCommands }
}
