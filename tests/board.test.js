import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  asRecord,
  boardStatus,
  failedIds,
  formatBody,
  isCommandOnly,
  isRecord,
  mentionedUser,
  parseBody,
  quoteSafely,
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
  assert.deepEqual(parseBody(moved), {
    description: 'Write docs',
    priority: null,
    due: '2026-12-24',
    hasPriority: false,
  })

  const cleared = updateBody(moved, { due: null })
  assert.equal(parseBody(cleared).due, null)
  assert.ok(cleared.includes('### Due date\n\n_No response_'))
})

test('parseDue reads notes after a date, day-first dates and Chinese dates', () => {
  assert.equal(parseDue('Oct 31 (hard deadline)', today), '2026-10-31')
  assert.equal(parseDue('10/31 - soft', today), '2026-10-31')
  assert.equal(parseDue('Oct 31, if we can', today), '2026-10-31')
  assert.equal(parseDue('2026-10-31 (soft, can slip a week)', today), '2026-10-31')
  assert.equal(parseDue('31/10/2026', today), '2026-10-31')
  assert.equal(parseDue('10月31日', today), '2026-10-31')
  assert.equal(parseDue('2027年1月5号', today), '2027-01-05')
  assert.equal(parseDue('Jan 15, 2027 (after the holidays)', today), '2027-01-15')
  assert.equal(parseDue('Oct 31, 2027 (hard deadline)', today), '2027-10-31')
  assert.equal(parseDue('end of October', today), null)
  assert.equal(parseDue('13/13', today), null)
})

// The issue form's output for a job, with some text people commonly add.
const formBody = (due, extra = '') =>
  `### Description\n\nCollect 200 samples.\n\n### Priority\n\nP1 · High\n\n### Due date\n\n${due}\n${extra}`

test('filing (dropping the Priority answer) keeps everything else as written', () => {
  for (const due of ['end of October', '31/10/2026', 'Oct 31 (hard deadline)', '2026-10-31 (soft, can slip a week)']) {
    const filed = updateBody(formBody(due), { priority: null })
    assert.equal(filed, `### Description\n\nCollect 200 samples.\n\n### Due date\n\n${due}\n`)
  }
  // An answer that isn't a date still shows on the board, as part of the description.
  assert.deepEqual(parseBody(formBody('end of October')), {
    description: 'Collect 200 samples.\n\n### Due date\n\nend of October',
    priority: 'P1',
    due: null,
    hasPriority: true,
  })
})

test('a description can have its own Deadline or Priority sub-headings', () => {
  const body = [
    '### Description',
    '',
    'Collect 200 samples.',
    '',
    '### Deadline',
    '',
    'Hard stop: the paper deadline.',
    '',
    '## Priority',
    '',
    'Matters more than the demo.',
    '',
    '### Priority',
    '',
    'P1 · High',
    '',
    '### Due date',
    '',
    '2026-10-30',
    '',
  ].join('\n')
  const parsed = parseBody(body)
  assert.equal(parsed.due, '2026-10-30')
  assert.equal(parsed.priority, 'P1')
  assert.equal(
    parsed.description,
    'Collect 200 samples.\n\n### Deadline\n\nHard stop: the paper deadline.\n\n## Priority\n\nMatters more than the demo.',
  )
  const filed = updateBody(body, { priority: null })
  assert.ok(filed.includes('Hard stop: the paper deadline.') && filed.includes('Matters more than the demo.'))
  // Filed: the label holds the priority now; the description and due date read the same.
  assert.deepEqual(parseBody(filed), { ...parsed, priority: null, hasPriority: false })
})

test('changing the due date touches only the answer', () => {
  const notes = '\n## Update\n\nVendor confirmed the 30th.\n'
  const body = updateBody(formBody('2026-10-30', notes), { priority: null })
  const moved = updateBody(body, { due: '2026-11-05' })
  assert.equal(moved, body.replace('2026-10-30', '2026-11-05'))
  assert.equal(parseBody(moved).description, 'Collect 200 samples.\n\n## Update\n\nVendor confirmed the 30th.')

  // An answer that couldn't be read stays, under the new date.
  const vague = updateBody(updateBody(formBody('end of October'), { priority: null }), { due: '2026-10-31' })
  assert.equal(vague, '### Description\n\nCollect 200 samples.\n\n### Due date\n\n2026-10-31\n\nend of October\n')
  assert.equal(parseBody(vague).due, '2026-10-31')

  // A body without a Due date section gets one; clearing a date that isn't there changes nothing.
  assert.equal(updateBody('Just fix it', { due: '2026-11-01' }), 'Just fix it\n\n### Due date\n\n2026-11-01\n')
  assert.equal(updateBody('Just fix it', { due: null }), 'Just fix it')
})

test('editing the description keeps the answers as written', () => {
  const body = updateBody(formBody('Oct 31 (hard deadline)', '\nLater note.\n'), { priority: null })
  assert.equal(parseBody(body).description, 'Collect 200 samples.\n\nLater note.')
  const edited = updateBody(body, { description: 'Collect 300 samples.\n\nLater note.' })
  assert.equal(
    edited,
    '### Description\n\nCollect 300 samples.\n\nLater note.\n\n### Due date\n\nOct 31 (hard deadline)\n',
  )
  // Before filing, the author's edit keeps the Priority answer in step.
  const unfiled = updateBody(formBody('2026-10-30'), { description: 'More', priority: 'P0' })
  assert.deepEqual(parseBody(unfiled), { description: 'More', priority: 'P0', due: '2026-10-30', hasPriority: true })
  assert.equal(parseBody(updateBody('Fix it\n\n### Due date\n\n2026-10-30', { priority: 'P3' })).priority, 'P3')
})

test("a description's own Priority section is never taken for the field", () => {
  const body =
    '### Description\n\nShip it.\n\n## Priority\n\nHigh for the demo, low for the paper.\n\n### Due date\n\n2026-10-30\n'
  assert.equal(parseBody(body).hasPriority, false)
  assert.equal(parseBody(body).description, 'Ship it.\n\n## Priority\n\nHigh for the demo, low for the paper.')
  assert.equal(updateBody(body, { priority: null }), body)
  for (const answer of ['None', 'TBD', '### Must have', '']) {
    const other = `Plan\n\n### Priority\n\n${answer}\n`
    assert.equal(parseBody(other).hasPriority, false, answer)
    assert.equal(updateBody(other, { priority: null }), other, answer)
  }
})

test('reading headings takes linear time, whatever the issue text', () => {
  const evil = '## a' + ' '.repeat(50_000) + 'b'
  const started = Date.now()
  parseBody(Array(20).fill(evil).join('\n'))
  parseBody('### Due date\n\nOct 31' + ', x'.repeat(100_000))
  parseBody(
    Array(5)
      .fill('### Priority\n\nP1' + ' '.repeat(64_000) + '.')
      .join('\n'),
  )
  assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`)
})

test('saving an edit leaves unchanged answers as written', () => {
  const body = updateBody(formBody('Oct 31 (hard deadline)'), { priority: null })
  assert.ok(
    updateBody(body, { description: 'Collect 300.', due: '2026-10-31' }).includes('Due date\n\nOct 31 (hard deadline)'),
  )
  const tbd = updateBody(formBody('TBD'), { priority: null })
  assert.ok(updateBody(tbd, { description: 'x', due: null }).includes('Due date\n\nTBD'))
  // Before filing: the same priority stays as the author wrote it.
  assert.ok(updateBody(formBody('TBD').replace('P1 · High', 'High'), { priority: 'P1' }).includes('Priority\n\nHigh\n'))
})

test('editing a job whose due date is unreadable keeps one Due date section', () => {
  const body = updateBody(formBody('end of October'), { priority: null })
  const edited = updateBody(body, { description: parseBody(body).description + '\n\nMore.', due: null })
  assert.equal(edited.match(/### Due date/g).length, 1)
  const dated = updateBody(edited, { due: '2026-10-31' })
  assert.equal(dated.match(/### Due date/g).length, 1)
  assert.equal(parseBody(dated).due, '2026-10-31')
  assert.ok(dated.includes('end of October') && dated.includes('More.'))
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

test('only the mark that ends a bot reply says which command failed', () => {
  assert.deepEqual(
    failedIds("@sam I couldn't do that:\n- `/approve`: admins only.\n\n<!-- job board: failed 42 -->"),
    [42],
  )
  assert.deepEqual(failedIds('<!-- job board: failed 7 --> and then more text'), [])
  assert.equal(quoteSafely('/priority <!-- job board: failed 7 -->'), '/priority  job board: failed 7 ')
})
