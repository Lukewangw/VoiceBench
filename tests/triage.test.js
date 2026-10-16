import { test } from 'node:test'
import assert from 'node:assert/strict'
import triage from '../.github/scripts/triage.js'
import { formatBody, parseBody } from '../shared/board.js'

const ADMIN = 'lead'
const MEMBER = 'sam'

/** A tiny in-memory stand-in for the parts of Octokit the bot uses. */
function fakeGitHub(issue, { assignable = [ADMIN, MEMBER, 'bob'], events = [] } = {}) {
  const state = {
    issue: { state: 'open', state_reason: null, assignees: [], labels: [], body: '', ...issue },
    repoLabels: ['bug'],
    comments: [],
    reactions: [],
  }
  const fail = (status) => Object.assign(new Error(`HTTP ${status}`), { status })
  const copy = () => structuredClone(state.issue)
  const github = {
    paginate: async (fn, params) => (await fn(params)).data,
    rest: {
      repos: {
        async getCollaboratorPermissionLevel({ username }) {
          if (username !== ADMIN) throw fail(404)
          return { data: { permission: 'admin', role_name: 'admin' } }
        },
      },
      reactions: {
        async createForIssueComment({ content }) {
          state.reactions.push(content)
          return { data: {} }
        },
      },
      issues: {
        get: async () => ({ data: copy() }),
        listEvents: async () => ({ data: events }),
        listLabelsForRepo: async () => ({ data: state.repoLabels.map((name) => ({ name })) }),
        async createLabel({ name }) {
          state.repoLabels.push(name)
          return { data: { name } }
        },
        async addLabels({ labels }) {
          for (const name of labels) {
            if (!state.issue.labels.some((l) => l.name === name)) state.issue.labels.push({ name })
          }
          return { data: state.issue.labels }
        },
        async removeLabel({ name }) {
          const before = state.issue.labels.length
          state.issue.labels = state.issue.labels.filter((l) => l.name !== name)
          if (state.issue.labels.length === before) throw fail(404)
          return { data: state.issue.labels }
        },
        async update(patch) {
          for (const key of ['state', 'state_reason', 'body', 'title']) if (key in patch) state.issue[key] = patch[key]
          if (patch.state === 'open') state.issue.state_reason = 'reopened'
          return { data: copy() }
        },
        async addAssignees({ assignees }) {
          for (const login of assignees) {
            if (assignable.includes(login) && !state.issue.assignees.some((a) => a.login === login)) {
              state.issue.assignees.push({ login })
            }
          }
          return { data: copy() }
        },
        async removeAssignees({ assignees }) {
          state.issue.assignees = state.issue.assignees.filter((a) => !assignees.includes(a.login))
          return { data: copy() }
        },
        async createComment({ body }) {
          state.comments.push(body)
          return { data: {} }
        },
      },
    },
  }
  return { github, state }
}

const quiet = { info() {} }
const labels = (state) => state.issue.labels.map((l) => l.name).sort()

async function opened(github, issue) {
  await triage({ github, core: quiet, context: { eventName: 'issues', repo: { owner: 'o', repo: 'r' }, payload: { action: 'opened', issue } } })
}

let nextComment = 1
async function comment(github, issue, login, body, type = 'User') {
  const payload = { action: 'created', issue, comment: { id: nextComment++, body, user: { login, type } } }
  await triage({ github, core: quiet, context: { eventName: 'issue_comment', repo: { owner: 'o', repo: 'r' }, payload } })
}

const proposal = () => ({ number: 7, user: { login: MEMBER }, labels: [{ name: 'proposal' }, { name: 'P2' }] })
const job = () => ({ number: 8, user: { login: ADMIN }, labels: [{ name: 'job' }, { name: 'P1' }] })

test('an admin issue from the form goes straight to Jobs and its priority becomes a label', async () => {
  const issue = {
    number: 1,
    user: { login: ADMIN },
    labels: [{ name: 'proposal' }],
    body: formatBody({ description: 'Label 200 clips', priority: 'P1', due: '2026-10-20' }),
  }
  const { github, state } = fakeGitHub(issue)
  await opened(github, issue)
  assert.deepEqual(labels(state), ['P1', 'job'])
  assert.ok(state.repoLabels.includes('job') && state.repoLabels.includes('P3'), 'creates the board labels')
  const body = parseBody(state.issue.body)
  assert.equal(body.hasPriority, false)
  assert.equal(body.due, '2026-10-20')
  assert.equal(body.description, 'Label 200 clips')
})

test("anyone else's issue lands in Others", async () => {
  const issue = { number: 2, user: { login: MEMBER }, labels: [], body: formatBody({ description: 'x', priority: 'P0' }) }
  const { github, state } = fakeGitHub(issue)
  await opened(github, issue)
  assert.deepEqual(labels(state), ['P0', 'proposal'])
})

test('a non-admin cannot sneak a job label in, and a missing priority defaults to P2', async () => {
  const issue = { number: 3, user: { login: MEMBER }, labels: [{ name: 'job' }], body: 'free text' }
  const { github, state } = fakeGitHub(issue)
  await opened(github, issue)
  assert.deepEqual(labels(state), ['P2', 'proposal'])
  assert.equal(state.issue.body, 'free text', 'leaves a body without a Priority section alone')
})

test('an admin approving before the bot files the issue is kept', async () => {
  const issue = { number: 4, user: { login: MEMBER }, labels: [{ name: 'job' }, { name: 'P1' }], body: 'x' }
  const events = [{ event: 'labeled', label: { name: 'job' }, actor: { login: ADMIN } }]
  const { github, state } = fakeGitHub(issue, { events })
  await opened(github, issue)
  assert.deepEqual(labels(state), ['P1', 'job'])
})

test('only admins approve, and approving moves a proposal to Jobs', async () => {
  const issue = proposal()
  const { github, state } = fakeGitHub(issue)
  await comment(github, issue, MEMBER, '/approve')
  assert.deepEqual(labels(state), ['P2', 'proposal'])
  assert.deepEqual(state.reactions, ['confused'])
  assert.match(state.comments[0], /@sam .*only admins can approve/s)

  await comment(github, issue, ADMIN, '/approve')
  assert.deepEqual(labels(state), ['P2', 'job'])
  assert.equal(state.reactions.at(-1), '+1')
})

test('proposals cannot be picked up', async () => {
  const issue = proposal()
  const { github, state } = fakeGitHub(issue)
  await comment(github, issue, MEMBER, '/take')
  assert.deepEqual(state.issue.assignees, [])
  assert.match(state.comments[0], /still a proposal/)
})

test('take, done, reopen, drop', async () => {
  const issue = job()
  const { github, state } = fakeGitHub(issue)

  await comment(github, issue, 'bob', '/done')
  assert.equal(state.issue.state, 'open')
  assert.match(state.comments.at(-1), /only the people on this job/)

  await comment(github, issue, MEMBER, 'On it!\n/take')
  assert.deepEqual(state.issue.assignees, [{ login: MEMBER }])
  await comment(github, issue, MEMBER, '/take')
  assert.deepEqual(state.issue.assignees, [{ login: MEMBER }], 'taking twice is harmless')

  await comment(github, issue, MEMBER, '/done')
  assert.equal(state.issue.state, 'closed')
  assert.equal(state.issue.state_reason, 'completed')

  await comment(github, issue, MEMBER, '/reopen')
  assert.equal(state.issue.state, 'open')

  await comment(github, issue, MEMBER, '/drop')
  assert.deepEqual(state.issue.assignees, [])
  assert.equal(state.reactions.filter((r) => r === 'confused').length, 1)
})

test('admins can assign others; members cannot', async () => {
  const issue = job()
  const { github, state } = fakeGitHub(issue)
  await comment(github, issue, MEMBER, '/assign @bob')
  assert.deepEqual(state.issue.assignees, [])
  await comment(github, issue, ADMIN, '/assign @bob')
  assert.deepEqual(state.issue.assignees, [{ login: 'bob' }])
  await comment(github, issue, ADMIN, '/assign @stranger')
  assert.match(state.comments.at(-1), /would not let me assign @stranger/)
  await comment(github, issue, ADMIN, '/drop @bob')
  assert.deepEqual(state.issue.assignees, [])
})

test('reject closes as not planned; approve brings it back', async () => {
  const issue = proposal()
  const { github, state } = fakeGitHub(issue)
  await comment(github, issue, ADMIN, '/reject not this quarter')
  assert.equal(state.issue.state, 'closed')
  assert.equal(state.issue.state_reason, 'not_planned')
  await comment(github, issue, ADMIN, '/approve')
  assert.equal(state.issue.state, 'open')
  assert.deepEqual(labels(state), ['P2', 'job'])
})

test('priority and due date: admins always, authors only while proposing', async () => {
  const issue = proposal()
  const { github, state } = fakeGitHub(issue)
  await comment(github, issue, MEMBER, '/priority P1\n/due Oct 30')
  assert.deepEqual(labels(state), ['P1', 'proposal'])
  assert.equal(parseBody(state.issue.body).due, `${new Date().getFullYear()}-10-30`)

  await comment(github, issue, 'bob', '/p0')
  assert.deepEqual(labels(state), ['P1', 'proposal'], 'not the author, not an admin')

  await comment(github, issue, ADMIN, '/approve')
  await comment(github, issue, MEMBER, '/p3')
  assert.deepEqual(labels(state), ['P1', 'job'], 'author lost the right after approval')

  await comment(github, issue, ADMIN, '/p0\n/due none')
  assert.deepEqual(labels(state), ['P0', 'job'])
  assert.equal(parseBody(state.issue.body).due, null)

  await comment(github, issue, ADMIN, '/due someday')
  assert.match(state.comments.at(-1), /could not read that date/)
})

test('ignores bots and plain comments', async () => {
  const issue = job()
  const { github, state } = fakeGitHub(issue)
  await comment(github, issue, 'github-actions[bot]', '/done', 'Bot')
  await comment(github, issue, MEMBER, 'looks good to me')
  assert.equal(state.issue.state, 'open')
  assert.deepEqual(state.reactions, [])
})

test('adding a priority label by hand removes the old one', async () => {
  const issue = { number: 9, user: { login: ADMIN }, labels: [{ name: 'job' }, { name: 'P2' }, { name: 'P0' }] }
  const { github, state } = fakeGitHub(issue)
  await triage({
    github,
    core: quiet,
    context: { eventName: 'issues', repo: { owner: 'o', repo: 'r' }, payload: { action: 'labeled', issue, label: { name: 'P0' } } },
  })
  assert.deepEqual(labels(state), ['P0', 'job'])
})
