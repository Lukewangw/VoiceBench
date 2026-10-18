import { test } from 'node:test'
import assert from 'node:assert/strict'
import triage from '../.github/scripts/triage.js'
import { asRecord, formatBody, parseBody } from '../shared/board.js'

const ADMIN = 'lead'
const MEMBER = 'sam'
const BOT = { login: 'github-actions[bot]', type: 'Bot' }

/** A small in-memory stand-in for the parts of Octokit the bot uses. */
function fakeGitHub(issue, { assignable = [ADMIN, MEMBER, 'bob'], events = [] } = {}) {
  const state = {
    issue: { state: 'open', state_reason: null, assignees: [], labels: [], body: '', user: { login: ADMIN }, ...issue },
    repoLabels: ['bug'],
    comments: [], // what people wrote on the issue
    replies: [], // what the bot wrote back
    reactions: [], // the bot's reactions, in order
    clock: Date.now(),
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
        async createForIssueComment({ comment_id, content }) {
          const c = state.comments.find((x) => x.id === comment_id)
          c.reactionList.push({ content, user: BOT })
          c.reactions[content] = (c.reactions[content] ?? 0) + 1
          state.reactions.push(content)
          return { data: {} }
        },
        listForIssueComment: async ({ comment_id }) => ({
          data: state.comments.find((x) => x.id === comment_id).reactionList,
        }),
      },
      issues: {
        get: async () => ({ data: copy() }),
        listEvents: async () => ({ data: events }),
        listComments: async ({ since }) => ({
          data: structuredClone(state.comments.filter((c) => !since || c.created_at >= since)),
        }),
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
          state.replies.push(body)
          return { data: {} }
        },
      },
    },
  }
  return { github, state }
}

const quiet = { info() {} }
const repo = { owner: 'o', repo: 'r' }
const labels = (state) => state.issue.labels.map((l) => l.name).sort()

async function opened({ github, state }) {
  await triage({ github, core: quiet, context: { eventName: 'issues', repo, payload: { action: 'opened', issue: state.issue } } })
}

let nextId = 1
/** Someone writes a comment on the issue; unless `silent`, its event runs the bot. */
async function say(gh, login, body, { silent = false, minutesAgo = 0, user } = {}) {
  const comment = {
    id: nextId++,
    body,
    user: user ?? { login, type: 'User' },
    created_at: new Date(gh.state.clock++ - minutesAgo * 60_000).toISOString(),
    reactions: { '+1': 0, confused: 0 },
    reactionList: [],
  }
  gh.state.comments.push(comment)
  if (!silent) {
    const payload = { action: 'created', issue: gh.state.issue, comment: structuredClone(comment) }
    await triage({ github: gh.github, core: quiet, context: { eventName: 'issue_comment', repo, payload } })
  }
  return comment
}

const proposal = () => ({ number: 7, user: { login: MEMBER }, labels: [{ name: 'proposal' }, { name: 'P2' }] })
const job = () => ({ number: 8, user: { login: ADMIN }, labels: [{ name: 'job' }, { name: 'P1' }] })

test('an admin issue from the form goes straight to Jobs and its priority becomes a label', async () => {
  const gh = fakeGitHub({
    number: 1,
    user: { login: ADMIN },
    labels: [{ name: 'proposal' }],
    body: formatBody({ description: 'Label 200 clips', priority: 'P1', due: '2026-10-20' }),
  })
  await opened(gh)
  assert.deepEqual(labels(gh.state), ['P1', 'job'])
  assert.ok(gh.state.repoLabels.includes('job') && gh.state.repoLabels.includes('P3'), 'creates the board labels')
  const body = parseBody(gh.state.issue.body)
  assert.equal(body.hasPriority, false)
  assert.equal(body.due, '2026-10-20')
  assert.equal(body.description, 'Label 200 clips')
})

test("anyone else's issue lands in Others", async () => {
  const gh = fakeGitHub({ number: 2, user: { login: MEMBER }, body: formatBody({ description: 'x', priority: 'P0' }) })
  await opened(gh)
  assert.deepEqual(labels(gh.state), ['P0', 'proposal'])
})

test('a non-admin cannot sneak a job label in, and a missing priority defaults to P2', async () => {
  const gh = fakeGitHub({ number: 3, user: { login: MEMBER }, labels: [{ name: 'job' }], body: 'free text' })
  await opened(gh)
  assert.deepEqual(labels(gh.state), ['P2', 'proposal'])
  assert.equal(gh.state.issue.body, 'free text', 'leaves a body without a Priority section alone')
})

test('an admin approving before the bot files the issue is kept', async () => {
  const events = [{ event: 'labeled', label: { name: 'job' }, actor: { login: ADMIN } }]
  const gh = fakeGitHub({ number: 4, user: { login: MEMBER }, labels: [{ name: 'job' }, { name: 'P1' }], body: 'x' }, { events })
  await opened(gh)
  assert.deepEqual(labels(gh.state), ['P1', 'job'])
})

test('an issue whose "opened" run was skipped gets filed by its next event', async () => {
  const gh = fakeGitHub({ number: 5, user: { login: MEMBER }, body: formatBody({ description: 'x', priority: 'P1' }) })
  await say(gh, 'bob', 'Nice idea!')
  assert.deepEqual(labels(gh.state), ['P1', 'proposal'])
})

test('only admins approve, and approving moves a proposal to Jobs', async () => {
  const gh = fakeGitHub(proposal())
  await say(gh, MEMBER, '/approve')
  assert.deepEqual(labels(gh.state), ['P2', 'proposal'])
  assert.deepEqual(gh.state.reactions, ['confused'])
  assert.match(gh.state.replies[0], /@sam .*only admins can approve/s)

  await say(gh, ADMIN, '/approve')
  assert.deepEqual(labels(gh.state), ['P2', 'job'])
  assert.equal(gh.state.reactions.at(-1), '+1')
})

test('proposals cannot be picked up', async () => {
  const gh = fakeGitHub(proposal())
  await say(gh, MEMBER, '/take')
  assert.deepEqual(gh.state.issue.assignees, [])
  assert.match(gh.state.replies[0], /still a proposal/)
})

test('take, done, reopen, drop', async () => {
  const gh = fakeGitHub(job())
  const { state } = gh

  await say(gh, 'bob', '/done')
  assert.equal(state.issue.state, 'open')
  assert.match(state.replies.at(-1), /only the people on this job/)

  await say(gh, MEMBER, 'On it!\n/take')
  assert.deepEqual(state.issue.assignees, [{ login: MEMBER }])
  await say(gh, MEMBER, '/take')
  assert.deepEqual(state.issue.assignees, [{ login: MEMBER }], 'taking twice is harmless')

  await say(gh, MEMBER, '/done')
  assert.equal(state.issue.state, 'closed')
  assert.equal(state.issue.state_reason, 'completed')

  await say(gh, MEMBER, '/take')
  assert.equal(state.reactions.at(-1), '+1', 'already on a closed job: nothing to complain about')

  await say(gh, MEMBER, '/reopen')
  assert.equal(state.issue.state, 'open')

  await say(gh, MEMBER, '/drop')
  assert.deepEqual(state.issue.assignees, [])
  assert.equal(state.reactions.filter((r) => r === 'confused').length, 1)
})

test('quick successive commands apply in the order they were written', async () => {
  const gh = fakeGitHub(job())
  // Both comments exist before any bot run gets going; the run for the second one handles both.
  await say(gh, MEMBER, '/take', { silent: true })
  const drop = await say(gh, MEMBER, '/drop', { silent: true })
  const payload = { action: 'created', issue: gh.state.issue, comment: structuredClone(drop) }
  await triage({ github: gh.github, core: quiet, context: { eventName: 'issue_comment', repo, payload } })
  assert.deepEqual(gh.state.issue.assignees, [], 'ends up dropped, not taken')
  assert.deepEqual(gh.state.reactions, ['+1', '+1'])

  // The later run for the first comment finds nothing left to do.
  const take = gh.state.comments[0]
  await triage({
    github: gh.github,
    core: quiet,
    context: { eventName: 'issue_comment', repo, payload: { action: 'created', issue: gh.state.issue, comment: take } },
  })
  assert.deepEqual(gh.state.issue.assignees, [])
  assert.equal(gh.state.reactions.length, 2, 'answered comments are not run again')
})

test('commands older than the pending window are left alone', async () => {
  const gh = fakeGitHub(job())
  await say(gh, MEMBER, '/take', { silent: true, minutesAgo: 60 * 24 })
  await say(gh, 'bob', '/take')
  assert.deepEqual(gh.state.issue.assignees, [{ login: 'bob' }])
})

test('records of changes the board already made are acknowledged, never replayed', async () => {
  const gh = fakeGitHub(job())
  // An admin picked it up and then cancelled it on the board; the /take record is processed late.
  gh.state.issue.state = 'closed'
  gh.state.issue.state_reason = 'not_planned'
  await say(gh, ADMIN, asRecord('/take'))
  await say(gh, ADMIN, asRecord('/reject'))
  assert.deepEqual(gh.state.issue.assignees, [], 'the record did not assign anyone')
  assert.deepEqual(gh.state.reactions, ['+1', '+1'])
  assert.deepEqual(gh.state.replies, [], 'no false "already closed" complaint')
})

test('records from people without the rights get a 😕', async () => {
  const gh = fakeGitHub(proposal())
  await say(gh, 'bob', asRecord('/approve'))
  await say(gh, MEMBER, asRecord('/due 2026-11-01'))
  await say(gh, MEMBER, asRecord('/approve'))
  assert.deepEqual(gh.state.reactions, ['confused', '+1', 'confused'])
  assert.deepEqual(labels(gh.state), ['P2', 'proposal'])
})

test('admins can assign others; members cannot', async () => {
  const gh = fakeGitHub(job())
  await say(gh, MEMBER, '/assign @bob')
  assert.deepEqual(gh.state.issue.assignees, [])
  await say(gh, ADMIN, '/assign @bob')
  assert.deepEqual(gh.state.issue.assignees, [{ login: 'bob' }])
  await say(gh, ADMIN, '/assign @stranger')
  assert.match(gh.state.replies.at(-1), /would not let me assign @stranger/)
  await say(gh, ADMIN, '/drop @bob')
  assert.deepEqual(gh.state.issue.assignees, [])
})

test('reject closes as not planned; approve brings it back', async () => {
  const gh = fakeGitHub(proposal())
  await say(gh, ADMIN, '/reject not this quarter')
  assert.equal(gh.state.issue.state, 'closed')
  assert.equal(gh.state.issue.state_reason, 'not_planned')
  await say(gh, ADMIN, '/approve')
  assert.equal(gh.state.issue.state, 'open')
  assert.deepEqual(labels(gh.state), ['P2', 'job'])
})

test('priority and due date: admins always, authors only while proposing', async () => {
  const gh = fakeGitHub(proposal())
  await say(gh, MEMBER, '/priority P1\n/due Oct 30')
  assert.deepEqual(labels(gh.state), ['P1', 'proposal'])
  assert.equal(parseBody(gh.state.issue.body).due, `${new Date().getFullYear()}-10-30`)

  await say(gh, 'bob', '/p0')
  assert.deepEqual(labels(gh.state), ['P1', 'proposal'], 'not the author, not an admin')

  await say(gh, ADMIN, '/approve')
  await say(gh, MEMBER, '/p3')
  assert.deepEqual(labels(gh.state), ['P1', 'job'], 'author lost the right after approval')

  await say(gh, ADMIN, '/p0\n/due none')
  assert.deepEqual(labels(gh.state), ['P0', 'job'])
  assert.equal(parseBody(gh.state.issue.body).due, null)

  await say(gh, ADMIN, '/due someday')
  assert.match(gh.state.replies.at(-1), /could not read that date/)
})

test('ignores bots and plain comments', async () => {
  const gh = fakeGitHub(job())
  await say(gh, BOT.login, '/done', { user: BOT })
  await say(gh, MEMBER, 'looks good to me')
  assert.equal(gh.state.issue.state, 'open')
  assert.deepEqual(gh.state.reactions, [])
})

test('adding a priority label by hand removes the old one', async () => {
  const gh = fakeGitHub({ number: 9, user: { login: ADMIN }, labels: [{ name: 'job' }, { name: 'P2' }, { name: 'P0' }] })
  await triage({
    github: gh.github,
    core: quiet,
    context: { eventName: 'issues', repo, payload: { action: 'labeled', issue: gh.state.issue, label: { name: 'P0' } } },
  })
  assert.deepEqual(labels(gh.state), ['P0', 'job'])
})
