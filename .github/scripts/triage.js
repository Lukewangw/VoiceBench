// The board bot. Runs on issue and comment events (see .github/workflows/board.yml) and:
//   - files new issues: admins' go straight to Jobs, everyone else's land in Others as proposals
//   - turns the "Priority" answer of a new issue into a P0-P3 label
//   - runs slash commands from comments: /take /drop /done /reopen /approve /reject /priority /due
//
// "Admin" means anyone with write access to the repository (the owner and collaborators).

import {
  BOARD_LABELS,
  DEFAULT_PRIORITY,
  JOB_LABEL,
  PROPOSAL_LABEL,
  PRIORITIES,
  boardStatus,
  hasLabel,
  isPriorityLabel,
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

  const bot = createBot({ github, core, ...context.repo, number: issue.number })
  if (eventName === 'issues' && payload.action === 'opened') await bot.fileNewIssue()
  else if (eventName === 'issues' && payload.action === 'labeled') await bot.keepOnePriority(payload.label?.name)
  else if (eventName === 'issue_comment' && payload.action === 'created') await bot.runCommands(payload.comment)
}

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
      if (!names.some((n) => n.toLowerCase() === name.toLowerCase())) continue
      try {
        await github.rest.issues.removeLabel({ ...ref, name })
      } catch (error) {
        if (error.status !== 404) throw error
      }
    }
  }

  const isAssigned = (issue, login) =>
    (issue.assignees ?? []).some((a) => a.login.toLowerCase() === login.toLowerCase())

  // An admin may approve a proposal before this bot gets to file it; don't undo that.
  async function approvedByAdmin() {
    const events = await github.paginate(github.rest.issues.listEvents, { ...ref, per_page: 100 })
    for (const e of events) {
      if (e.event === 'labeled' && e.label?.name?.toLowerCase() === JOB_LABEL && (await isAdmin(e.actor?.login))) return true
    }
    return false
  }

  return {
    async fileNewIssue() {
      const issue = await getIssue()
      const admin = await isAdmin(issue.user.login)
      const fields = parseBody(issue.body)
      const add = []
      const remove = []

      if (admin || (hasLabel(issue.labels, JOB_LABEL) && (await approvedByAdmin()))) {
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
      if (fields.hasPriority) await github.rest.issues.update({ ...ref, body: updateBody(issue.body, { priority: null }) })
      core.info(`#${number}: filed as ${admin ? 'job' : 'proposal'}; added [${add}] removed [${remove}]`)
    },

    async keepOnePriority(added) {
      if (!added || !isPriorityLabel(added)) return
      const issue = await getIssue()
      const others = PRIORITIES.map((p) => p.key).filter((key) => key.toLowerCase() !== added.toLowerCase())
      await removeLabels(issue, others)
    },

    async runCommands(comment) {
      if (!comment || comment.user?.type === 'Bot') return
      const commands = parseCommands(comment.body)
      if (!commands.length) return

      const actor = comment.user.login
      const admin = await isAdmin(actor)
      let issue = await getIssue()
      const isAuthor = issue.user.login.toLowerCase() === actor.toLowerCase()
      const canEditDetails = () => admin || (isAuthor && boardStatus(issue) === 'proposal')
      const problems = []

      const handlers = {
        async take(arg) {
          const who = mentionedUser(arg) ?? actor
          if (who.toLowerCase() !== actor.toLowerCase() && !admin) return 'only admins can assign other people.'
          if (issue.state === 'closed') return 'this job is already closed.'
          if (boardStatus(issue) === 'proposal') return 'this is still a proposal; an admin has to approve it first.'
          if (isAssigned(issue, who)) return null
          if ((issue.assignees ?? []).length >= 10) return 'this job already has 10 people on it (the GitHub limit).'
          issue = (await github.rest.issues.addAssignees({ ...ref, assignees: [who] })).data
          if (!isAssigned(issue, who)) return `GitHub would not let me assign @${who}.`
          return null
        },
        async drop(arg) {
          const who = mentionedUser(arg) ?? actor
          if (who.toLowerCase() !== actor.toLowerCase() && !admin) return 'only admins can take other people off a job.'
          if (!isAssigned(issue, who)) return null
          issue = (await github.rest.issues.removeAssignees({ ...ref, assignees: [who] })).data
          return null
        },
        async done() {
          if (issue.state === 'closed') return null
          if (boardStatus(issue) === 'proposal') return 'a proposal cannot be marked done; it needs to be approved first.'
          if (!admin && !isAssigned(issue, actor)) return 'only the people on this job (or an admin) can mark it done. Use `/take` first.'
          issue = (await github.rest.issues.update({ ...ref, state: 'closed', state_reason: 'completed' })).data
          return null
        },
        async reopen() {
          if (issue.state === 'open') return null
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
            await removeLabels(issue, PRIORITIES.map((p) => p.key).filter((k) => k !== key))
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

      for (const command of commands) {
        const problem = await handlers[command.name](command.arg)
        if (problem) problems.push(`- \`/${command.name}${command.arg ? ' ' + command.arg : ''}\`: ${problem}`)
      }

      await github.rest.reactions.createForIssueComment({
        owner,
        repo,
        comment_id: comment.id,
        content: problems.length ? 'confused' : '+1',
      })
      if (problems.length) {
        await github.rest.issues.createComment({ ...ref, body: `@${actor} I couldn't do that:\n${problems.join('\n')}` })
      }
      core.info(
        `#${number}: @${actor}${admin ? ' (admin)' : ''} ran ${commands.map((c) => '/' + c.name).join(' ')}` +
          (problems.length ? ` with ${problems.length} problem(s)` : '') +
          `; now ${boardStatus(issue)}, priority ${priorityLabel(priorityFromLabels(issue.labels) ?? DEFAULT_PRIORITY)}`,
      )
    },
  }
}
