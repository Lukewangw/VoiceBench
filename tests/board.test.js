import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  asRecord,
  boardStatus,
  formatBody,
  isCommandOnly,
  isRecord,
  mentionedUser,
  parseBody,
  parseCommands,
  parseDue,
  parsePriority,
  priorityFromLabels,
  stripCommands,
  updateBody,
} from '../shared/board.js'

const today = new Date(2026, 9, 16) // Oct 16 2026

test('parseDue reads the formats people actually type', () => {
  assert.equal(parseDue('2026-10-15', today), '2026-10-15')
  assert.equal(parseDue('2026/1/5', today), '2026-01-05')
  assert.equal(parseDue('10/15', today), '2026-10-15')
  assert.equal(parseDue('10/15/27', today), '2027-10-15')
  assert.equal(parseDue('Oct/15', today), '2026-10-15')
  assert.equal(parseDue('Oct 15', today), '2026-10-15')
  assert.equal(parseDue('October 15, 2027', today), '2027-10-15')
  assert.equal(parseDue('15 Oct', today), '2026-10-15')
  assert.equal(parseDue('Nov 3rd', today), '2026-11-03')
  assert.equal(parseDue('_No response_', today), null)
  assert.equal(parseDue('none', today), null)
  assert.equal(parseDue('2026-02-30', today), null)
  assert.equal(parseDue('next week', today), null)
  assert.equal(parseDue('', today), null)
})

test('parsePriority understands keys and words', () => {
  assert.equal(parsePriority('P1 · High'), 'P1')
  assert.equal(parsePriority('p0'), 'P0')
  assert.equal(parsePriority('urgent'), 'P0')
  assert.equal(parsePriority('Low'), 'P3')
  assert.equal(parsePriority('whenever'), null)
  assert.equal(parsePriority(null), null)
})

test('priorityFromLabels picks the highest priority label', () => {
  assert.equal(priorityFromLabels([{ name: 'job' }, { name: 'P2' }, { name: 'p1' }]), 'P1')
  assert.equal(priorityFromLabels(['job']), null)
})

test('parseBody reads issue-form output', () => {
  const body = [
    '### Description',
    '',
    'Collect 50 more samples.',
    '',
    '### Notes inside the description',
    'still description',
    '',
    '### Priority',
    '',
    'P1 · High',
    '',
    '### Due date',
    '',
    '2026-10-20',
  ].join('\n')
  const parsed = parseBody(body)
  assert.equal(parsed.description, 'Collect 50 more samples.\n\n### Notes inside the description\nstill description')
  assert.equal(parsed.priority, 'P1')
  assert.equal(parsed.due, '2026-10-20')
  assert.equal(parsed.hasPriority, true)
})

test('parseBody treats a free-form body as the description', () => {
  const parsed = parseBody('Just fix it\r\n\r\nplease')
  assert.deepEqual(parsed, { description: 'Just fix it\n\nplease', priority: null, due: null, hasPriority: false })
})

test('parseBody handles empty form answers and code fences', () => {
  const body = '### Description\n\n```\n### Due date\n```\n\n### Due date\n\n_No response_\n'
  const parsed = parseBody(body)
  assert.equal(parsed.description, '```\n### Due date\n```')
  assert.equal(parsed.due, null)
})

test('formatBody and updateBody round-trip', () => {
  const body = formatBody({ description: 'Write docs', priority: 'P2', due: '2026-11-01' })
  assert.deepEqual(parseBody(body), { description: 'Write docs', priority: 'P2', due: '2026-11-01', hasPriority: true })

  const noPriority = updateBody(body, { priority: null })
  assert.ok(!noPriority.includes('### Priority'))
  assert.equal(parseBody(noPriority).due, '2026-11-01')

  const moved = updateBody(noPriority, { due: '2026-12-24' })
  assert.deepEqual(parseBody(moved), { description: 'Write docs', priority: null, due: '2026-12-24', hasPriority: false })

  const cleared = updateBody(moved, { due: null })
  assert.equal(parseBody(cleared).due, null)
  assert.ok(cleared.includes('### Due date\n\n_No response_'))
})

test('parseCommands finds commands and aliases', () => {
  assert.deepEqual(parseCommands('/take'), [{ name: 'take', arg: '' }])
  assert.deepEqual(parseCommands('I can do it\n/pick up'), [{ name: 'take', arg: 'up' }])
  assert.deepEqual(parseCommands('/approve\n/p0'), [
    { name: 'approve', arg: '' },
    { name: 'priority', arg: 'P0' },
  ])
  assert.deepEqual(parseCommands('/reject out of scope for now'), [{ name: 'reject', arg: 'out of scope for now' }])
  assert.deepEqual(parseCommands('/due Oct 20'), [{ name: 'due', arg: 'Oct 20' }])
  assert.deepEqual(parseCommands('/assign @bob'), [{ name: 'take', arg: '@bob' }])
  assert.deepEqual(parseCommands('see /home/user/x\n> /take\n```\n/done\n```\n/unknown'), [])
  assert.deepEqual(parseCommands('/done/'), [])
})

test('isCommandOnly separates activity from discussion', () => {
  assert.equal(isCommandOnly('/take'), true)
  assert.equal(isCommandOnly('/approve\n\n/priority P1'), true)
  assert.equal(isCommandOnly('/take\nI will start tomorrow'), false)
  assert.equal(isCommandOnly(''), false)
})

test('stripCommands keeps the human part of a comment', () => {
  assert.equal(stripCommands('I can write the normalization section.\n/take'), 'I can write the normalization section.')
  assert.equal(stripCommands('/approve\n/p1'), '')
  assert.equal(stripCommands('run this:\n```\n/done\n```'), 'run this:\n```\n/done\n```')
  assert.equal(stripCommands('see /home/x'), 'see /home/x')
})

test('records: a command the board already applied, hidden note included', () => {
  const text = asRecord('/reject out of scope')
  assert.equal(isRecord(text), true)
  assert.equal(isRecord('/reject out of scope'), false)
  assert.deepEqual(parseCommands(text), [{ name: 'reject', arg: 'out of scope' }])
  assert.equal(stripCommands(text), '')
  assert.equal(isCommandOnly(text), true)
})

test('mentionedUser', () => {
  assert.equal(mentionedUser('@bob-smith'), 'bob-smith')
  assert.equal(mentionedUser('for @Alice please'), 'Alice')
  assert.equal(mentionedUser('up'), null)
})

test('boardStatus', () => {
  const job = { state: 'open', labels: [{ name: 'job' }], assignees: [] }
  assert.equal(boardStatus(job), 'open')
  assert.equal(boardStatus({ ...job, assignees: [{ login: 'a' }] }), 'active')
  assert.equal(boardStatus({ ...job, labels: [{ name: 'proposal' }] }), 'proposal')
  assert.equal(boardStatus({ ...job, labels: [] }), 'proposal')
  assert.equal(boardStatus({ ...job, labels: ['job', 'proposal'] }), 'open')
  assert.equal(boardStatus({ ...job, state: 'closed', state_reason: 'completed' }), 'done')
  assert.equal(boardStatus({ ...job, state: 'closed', state_reason: null }), 'done')
  assert.equal(boardStatus({ ...job, state: 'closed', state_reason: 'not_planned' }), 'closed')
  assert.equal(boardStatus({ state: 'closed', state_reason: 'completed', labels: ['proposal'] }), 'closed')
})
