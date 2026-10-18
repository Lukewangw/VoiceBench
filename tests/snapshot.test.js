import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import snapshot from '../.github/scripts/snapshot.js'

test('snapshot keeps issues and their comments, drops pull requests', async () => {
  const person = { login: 'sam', avatar_url: 'https://a/sam', html_url: 'https://gh/sam', type: 'User', id: 1 }
  const issues = [
    {
      number: 1,
      title: 'Job',
      body: null,
      state: 'open',
      labels: ['job', { name: 'P1', color: 'f00', id: 3 }],
      user: person,
      assignees: [person],
      comments: 1,
      created_at: 'c',
      updated_at: 'u',
      closed_at: null,
      html_url: 'h1',
    },
    { number: 2, title: 'PR', state: 'open', labels: [], user: person, pull_request: {}, comments: 1 },
  ]
  const comments = [
    {
      id: 10,
      issue_url: 'https://api.github.com/repos/o/r/issues/1',
      body: '/take',
      user: person,
      created_at: 'c',
      updated_at: 'u',
      html_url: 'hc',
      reactions: { '+1': 1, confused: 0, heart: 2 },
    },
    { id: 11, issue_url: 'https://api.github.com/repos/o/r/issues/2', body: 'on the PR', user: person },
  ]
  const github = {
    paginate: async (fn) => fn(),
    rest: { issues: { listForRepo: () => issues, listCommentsForRepo: () => comments } },
  }
  const outFile = join(await mkdtemp(join(tmpdir(), 'snap-')), 'dist', 'data.json')
  await snapshot({ github, context: { repo: { owner: 'o', repo: 'r' } }, core: { info() {} }, outFile })
  const data = JSON.parse(await readFile(outFile, 'utf8'))
  assert.equal(data.repo, 'o/r')
  assert.deepEqual(
    data.issues.map((i) => i.number),
    [1],
  )
  assert.deepEqual(data.issues[0].labels, [{ name: 'job' }, { name: 'P1', color: 'f00' }])
  assert.equal(data.issues[0].body, '')
  assert.deepEqual(
    data.comments.map((c) => [c.id, c.issue_number]),
    [[10, 1]],
  )
  assert.deepEqual(data.comments[0].reactions, { '+1': 1, confused: 0 })
  assert.equal(data.comments[0].user.id, undefined)
})
