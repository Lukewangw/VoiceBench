// End-to-end tests: the built site in a real browser, against a fake api.github.com whose events
// run the real board bot (.github/scripts/triage.js), so members' and admins' flows go through the
// same code as production. Run with `npm run e2e`; screenshots land in e2e/.output/.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { build } from 'vite'
import { createBot } from '../.github/scripts/triage.js'
import { isRecord, parseBody } from '../shared/board.js'
import * as fx from './fixture.js'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const SITE = join(HERE, '.dist')
const OUT = join(HERE, '.output')
const BASE = 'http://board.test/'
const REPO = fx.REPO
const PRIVATE_REPO = fx.PRIVATE_REPO
const TOKENS = { 'admin-token': 'lead', 'member-token': 'sam', 'admin-repo-token': 'lead' }
const SCOPES = { 'admin-token': 'public_repo', 'member-token': 'public_repo', 'admin-repo-token': 'repo' }
const ADMINS = new Set(['lead'])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
}

async function main() {
  process.env.VITE_REPO = REPO
  await build({ logLevel: 'warn', build: { outDir: SITE, emptyOutDir: true } })
  mkdirSync(OUT, { recursive: true })
  const data = JSON.stringify(fx.snapshot())

  const S = {
    issues: structuredClone(fx.issues),
    comments: structuredClone(fx.comments),
    repoLabels: ['job', 'proposal', 'P0', 'P1', 'P2', 'P3'].map((name) => ({ name })),
    events: [],
    nextIssue: 100,
    nextComment: 5000,
    botRuns: [],
  }
  // The private companion repository: only admins whose token has the repo scope can reach it.
  const P = { issues: [], comments: [], next: 1, calls: [], isPrivate: true }
  const issue = (n) => S.issues.find((i) => i.number === Number(n))
  const labels = (n) =>
    issue(n)
      .labels.map((l) => l.name)
      .sort()
  const now = () => new Date().toISOString()
  const fail = (status, message) => Object.assign(new Error(message ?? `HTTP ${status}`), { status })
  const assignable = (i, login) =>
    ADMINS.has(login) || S.comments.some((c) => c.issue_number === i.number && c.user.login === login)

  // Octokit-shaped access with GITHUB_TOKEN powers, for the bot.
  const github = {
    paginate: async (fn, params) => (await fn(params)).data,
    rest: {
      repos: {
        async getCollaboratorPermissionLevel({ username }) {
          if (!ADMINS.has(username)) throw fail(404)
          return { data: { permission: 'admin', role_name: 'admin' } }
        },
      },
      reactions: {
        async createForIssueComment({ comment_id, content }) {
          const c = S.comments.find((x) => x.id === comment_id)
          c.reactions = { ...(c.reactions ?? {}), [content]: ((c.reactions ?? {})[content] ?? 0) + 1 }
          ;(c.reactionList ??= []).push({ content, user: { login: 'github-actions[bot]', type: 'Bot' } })
          return { data: {} }
        },
        listForIssueComment: async ({ comment_id }) => ({
          data: S.comments.find((x) => x.id === comment_id).reactionList ?? [],
        }),
      },
      issues: {
        get: async ({ issue_number }) => ({ data: structuredClone(issue(issue_number)) }),
        listEvents: async ({ issue_number }) => ({ data: S.events.filter((e) => e.issue === issue_number) }),
        listComments: async ({ issue_number, since }) => ({
          data: structuredClone(
            S.comments.filter((c) => c.issue_number === issue_number && (!since || c.created_at >= since)),
          ),
        }),
        listLabelsForRepo: async () => ({ data: S.repoLabels }),
        async createLabel({ name }) {
          S.repoLabels.push({ name })
          return { data: { name } }
        },
        async addLabels({ issue_number, labels: names }) {
          const i = issue(issue_number)
          for (const name of names) if (!i.labels.some((l) => l.name === name)) i.labels.push({ name })
          return { data: i.labels }
        },
        async removeLabel({ issue_number, name }) {
          const i = issue(issue_number)
          const before = i.labels.length
          i.labels = i.labels.filter((l) => l.name !== name)
          if (before === i.labels.length) throw fail(404)
          return { data: i.labels }
        },
        async update({ issue_number, ...patch }) {
          const i = issue(issue_number)
          applyPatch(i, patch)
          return { data: structuredClone(i) }
        },
        async addAssignees({ issue_number, assignees }) {
          const i = issue(issue_number)
          for (const login of assignees)
            if (assignable(i, login) && !i.assignees.some((a) => a.login === login)) i.assignees.push(fx.user(login))
          return { data: structuredClone(i) }
        },
        async removeAssignees({ issue_number, assignees }) {
          const i = issue(issue_number)
          i.assignees = i.assignees.filter((a) => !assignees.includes(a.login))
          return { data: structuredClone(i) }
        },
        async createComment({ issue_number, body }) {
          const c = addComment(
            issue_number,
            { login: 'github-actions[bot]', avatar_url: fx.user('eli').avatar_url, html_url: '', type: 'Bot' },
            body,
          )
          return { data: c }
        },
      },
    },
  }

  function applyPatch(i, patch) {
    for (const key of ['title', 'body', 'state', 'state_reason']) if (key in patch) i[key] = patch[key]
    if (patch.state === 'open') {
      i.state_reason = 'reopened'
      i.closed_at = null
    }
    if (patch.state === 'closed') i.closed_at = now()
    if (patch.labels) i.labels = patch.labels.map((name) => ({ name }))
    i.updated_at = now()
  }

  function addComment(n, user, body) {
    const c = {
      id: ++S.nextComment,
      issue_number: Number(n),
      body,
      user,
      created_at: now(),
      updated_at: now(),
      html_url: `https://github.com/${REPO}/issues/${n}#c`,
      reactions: { '+1': 0, confused: 0 },
    }
    S.comments.push(c)
    return c
  }

  // Simulate Actions: run the bot a moment after an event; runs for one issue queue up, like the
  // workflow's per-issue concurrency group.
  const lanes = new Map()
  function fireBot(number, run) {
    const prev = lanes.get(number) ?? Promise.resolve()
    const job = prev
      .then(() => sleep(700))
      .then(() =>
        run(createBot({ github, core: { info() {} }, owner: REPO.split('/')[0], repo: REPO.split('/')[1], number })),
      )
      .catch((e) => console.error('BOT ERROR', e))
    lanes.set(number, job)
    S.botRuns.push(job)
  }

  function respond(route, status, body, headers = {}) {
    return route.fulfill({
      status,
      contentType: 'application/json',
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'Authorization, Content-Type, Accept',
        'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'access-control-expose-headers': 'Link, X-OAuth-Scopes, X-RateLimit-Remaining, X-RateLimit-Reset',
        ...headers,
      },
      body: body === undefined ? '' : JSON.stringify(body),
    })
  }

  async function fakeGitHub(route) {
    const req = route.request()
    const method = req.method()
    if (method === 'OPTIONS') return respond(route, 204)
    const url = new URL(req.url())
    const path = url.pathname
    const token = (req.headers()['authorization'] ?? '').replace('Bearer ', '')
    const who = TOKENS[token]
    const admin = ADMINS.has(who)
    const body = req.postData() ? JSON.parse(req.postData()) : {}
    const base = `/repos/${REPO}`
    let m

    if (path === '/user')
      return who
        ? respond(route, 200, fx.user(who), { 'x-oauth-scopes': SCOPES[token] })
        : respond(route, 401, { message: 'Bad credentials' })

    const pbase = `/repos/${PRIVATE_REPO}`
    if (path === pbase || path.startsWith(pbase + '/')) {
      P.calls.push({ who: who ?? null, method, path })
      if (!admin || SCOPES[token] !== 'repo') return respond(route, 404, { message: 'Not Found' })
      const pissue = (n) => P.issues.find((i) => i.number === Number(n))
      if (path === pbase)
        return respond(route, 200, {
          full_name: PRIVATE_REPO,
          private: P.isPrivate,
          permissions: { admin: true, push: true, pull: true },
        })
      if (path === `${pbase}/issues` && method === 'GET')
        return respond(
          route,
          200,
          [...P.issues].sort((a, b) => b.number - a.number),
        )
      if (path === `${pbase}/issues` && method === 'POST') {
        const i = {
          number: P.next++,
          title: body.title,
          body: body.body,
          state: 'open',
          state_reason: null,
          labels: (body.labels ?? []).map((name) => ({ name })),
          user: fx.user(who),
          assignees: [],
          comments: 0,
          created_at: now(),
          updated_at: now(),
          closed_at: null,
          html_url: `https://github.com/${PRIVATE_REPO}/issues/${P.next - 1}`,
        }
        P.issues.push(i)
        return respond(route, 201, i)
      }
      if ((m = path.match(new RegExp(`^${pbase}/issues/(\\d+)$`)))) {
        const i = pissue(m[1])
        if (method === 'PATCH') applyPatch(i, body)
        return respond(route, 200, i)
      }
      if ((m = path.match(new RegExp(`^${pbase}/issues/(\\d+)/comments$`)))) {
        const n = Number(m[1])
        if (method === 'GET')
          return respond(
            route,
            200,
            P.comments.filter((c) => c.issue_number === n),
          )
        const c = {
          id: ++S.nextComment,
          issue_number: n,
          body: body.body,
          user: fx.user(who),
          created_at: now(),
          updated_at: now(),
          html_url: '',
          reactions: { '+1': 0, confused: 0 },
        }
        P.comments.push(c)
        return respond(route, 201, c)
      }
      if ((m = path.match(new RegExp(`^${pbase}/issues/(\\d+)/assignees$`)))) {
        const i = pissue(m[1])
        if (method === 'POST')
          for (const login of body.assignees)
            if (!i.assignees.some((a) => a.login === login)) i.assignees.push(fx.user(login))
        if (method === 'DELETE') i.assignees = i.assignees.filter((a) => !body.assignees.includes(a.login))
        return respond(route, method === 'POST' ? 201 : 200, i)
      }
      return respond(route, 404, { message: `fake: no private route for ${method} ${path}` })
    }
    if (path === base)
      return respond(route, 200, {
        full_name: REPO,
        permissions: { admin, maintain: admin, push: admin, triage: admin, pull: true },
      })
    if (path === `${base}/issues` && method === 'GET') {
      // Like GitHub, lists take a few seconds to include new issues.
      const visible = S.issues.filter((i) => !i.listedAfter || Date.now() >= i.listedAfter)
      return respond(
        route,
        200,
        [...visible].sort((a, b) => b.number - a.number),
      )
    }
    if (path === `${base}/issues` && method === 'POST') {
      if (!who) return respond(route, 401, { message: 'Requires authentication' })
      const i = {
        number: S.nextIssue++,
        title: body.title,
        body: body.body,
        state: 'open',
        state_reason: null,
        labels: admin && body.labels ? body.labels.map((name) => ({ name })) : [],
        user: fx.user(who),
        assignees: [],
        comments: 0,
        created_at: now(),
        updated_at: now(),
        closed_at: null,
        html_url: `https://github.com/${REPO}/issues/${S.nextIssue - 1}`,
      }
      i.listedAfter = Date.now() + 4000
      S.issues.push(i)
      for (const l of i.labels)
        S.events.push({ issue: i.number, event: 'labeled', label: { name: l.name }, actor: { login: who } })
      fireBot(i.number, (bot) => bot.fileNewIssue())
      return respond(route, 201, i)
    }
    if ((m = path.match(new RegExp(`^${base}/issues/(\\d+)$`)))) {
      const i = issue(m[1])
      if (!i) return respond(route, 404, { message: 'Not Found' })
      if (method === 'GET') return respond(route, 200, i)
      if (method === 'PATCH') {
        const isAuthor = i.user.login === who
        const touchesAdminFields = 'labels' in body || 'state' in body
        if (!admin && !(isAuthor && !touchesAdminFields))
          return respond(route, 403, { message: 'Must have admin rights to Repository.' })
        const before = new Set(i.labels.map((l) => l.name))
        applyPatch(i, body)
        for (const l of i.labels) {
          if (before.has(l.name)) continue
          S.events.push({ issue: i.number, event: 'labeled', label: { name: l.name }, actor: { login: who } })
          fireBot(i.number, (bot) => bot.keepOnePriority(l.name))
        }
        return respond(route, 200, i)
      }
    }
    if ((m = path.match(new RegExp(`^${base}/issues/(\\d+)/comments$`)))) {
      const i = issue(m[1])
      if (method === 'GET')
        return respond(
          route,
          200,
          S.comments.filter((c) => c.issue_number === i.number),
        )
      if (method === 'POST') {
        const c = addComment(i.number, fx.user(who), body.body)
        fireBot(i.number, (bot) => bot.runCommands(c))
        return respond(route, 201, c)
      }
    }
    if ((m = path.match(new RegExp(`^${base}/issues/(\\d+)/assignees$`)))) {
      const i = issue(m[1])
      if (admin) {
        if (method === 'POST')
          for (const login of body.assignees)
            if (!i.assignees.some((a) => a.login === login)) i.assignees.push(fx.user(login))
        if (method === 'DELETE') i.assignees = i.assignees.filter((a) => !body.assignees.includes(a.login))
      }
      return respond(route, method === 'POST' ? 201 : 200, i)
    }
    return respond(route, 404, { message: `fake: no route for ${method} ${path}` })
  }

  const browser = await chromium.launch()
  const problems = []
  async function newPage() {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 })
    // The site itself, straight from the build (plus the sample data.json).
    await ctx.route(BASE + '**', (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === '/data.json') return route.fulfill({ status: 200, contentType: 'application/json', body: data })
      try {
        const file = join(SITE, path === '/' ? 'index.html' : path)
        return route.fulfill({
          status: 200,
          contentType: TYPES[extname(file)] ?? 'application/octet-stream',
          body: readFileSync(file),
        })
      } catch {
        return route.fulfill({ status: 404, body: 'not found' })
      }
    })
    await ctx.route('https://api.github.com/**', fakeGitHub)
    const p = await ctx.newPage()
    p.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
    p.on('console', (msg) => msg.type() === 'error' && problems.push('console: ' + msg.text()))
    return p
  }
  async function until(check, what, ms = 25000) {
    const start = Date.now()
    while (Date.now() - start < ms) {
      if (await check()) return
      await sleep(250)
    }
    throw new Error('timed out waiting for: ' + what)
  }
  const step = (s) => console.log('  ✓', s)

  // ---------------- Member ----------------
  console.log('Member flow (@sam, no write access)')
  let p = await newPage()
  await p.goto(BASE + '#/jobs')
  await p.waitForSelector('.row-title')
  assert.equal(await p.locator('.page-head .btn-primary').count(), 0, 'members get no New job button on Jobs')
  await p.click('header >> text=Sign in')
  await p.fill('.modal input[type=password]', 'member-token')
  await p.click('.modal button:has-text("Connect")')
  await p.waitForSelector('.toast:has-text("Signed in as @sam")')
  assert.equal(await p.locator('.badge-admin').count(), 0)
  step('signed in as a member')

  await p.goto(BASE + '#/others')
  await p.click('.page-head >> text=Propose a job')
  await p.fill('.modal input.input-lg', 'Record a demo video')
  await p.fill('.modal textarea', 'Two minutes, show the **leaderboard**.')
  await p.click('.seg-opt:has-text("P1")')
  await p.fill('.modal input[type=date]', '2026-10-30')
  await p.click('.modal button:has-text("Submit proposal")')
  await p.waitForURL(/#\/others\/100$/)
  await p.waitForSelector('.drawer .status-chip:has-text("Waiting for approval")')
  await p.waitForSelector('.drawer .markdown strong:has-text("leaderboard")')
  await until(() => labels(100).join() === 'P1,proposal', 'bot to file the proposal')
  assert.equal(parseBody(issue(100).body).hasPriority, false)
  assert.equal(parseBody(issue(100).body).due, '2026-10-30')
  step('proposal created; bot labelled it proposal + P1 and moved priority into a label')

  await p.goto(BASE + '#/jobs/2')
  await p.click('.drawer-foot button:has-text("Pick up")')
  await p.waitForSelector('.drawer .status-chip:has-text("Picking up")')
  await until(() => issue(2).assignees.some((a) => a.login === 'sam'), 'bot to assign sam')
  await p.waitForSelector('.drawer-foot button:has-text("Mark done")', { timeout: 20000 })
  await p.waitForSelector('.toast:has-text("You\'re on it")')
  step('picked up job #2 through /take; the bot assigned them and the page caught up')

  await p.fill('.composer textarea', 'Starting today, will share the consent form tomorrow.')
  await p.click('.composer button:has-text("Comment")')
  await p.waitForSelector('.comment:has-text("Starting today")')
  step('commented')

  await p.keyboard.press('Escape')
  await p.waitForSelector('.row-mine:has-text("Collect 200 accented-English samples")')
  await p.screenshot({ path: OUT + '/13-mine.png' })
  step('the job you picked up is highlighted in the list')
  await p.goto(BASE + '#/jobs/2')
  await p.click('.drawer-foot button:has-text("Mark done")')
  await until(() => issue(2).state === 'closed' && issue(2).state_reason === 'completed', 'bot to close #2')
  await p.waitForSelector('.drawer .status-chip:has-text("Done")', { timeout: 20000 })
  await p.keyboard.press('Escape')
  await p.waitForSelector('.tab:has-text("Done") .tab-count:text("63")')
  step('marked done; Done tab shows 63')

  await p.goto(BASE + '#/jobs/3')
  await p.waitForSelector('.drawer .comment:has-text("normalization section")')
  const mixed = await p.locator('.drawer .comment:has-text("normalization section")').innerText()
  assert.ok(!mixed.includes('/take'), 'command line hidden from the comment text')
  await p.waitForSelector('.drawer .event:has-text("chen picked this up")')
  step('a comment with a command shows its text plus an activity line')
  await p.screenshot({ path: OUT + '/11-member-drawer.png' })

  // ---------------- Admin ----------------
  console.log('Admin flow (@lead, owner)')
  p = await newPage()
  await p.goto(BASE + '#/others')
  await p.click('header >> text=Sign in')
  await p.fill('.modal input[type=password]', 'admin-token')
  await p.click('.modal button:has-text("Connect")')
  await p.waitForSelector('.badge-admin')
  step('signed in as an admin')

  const row = p.locator('.row', { hasText: 'Record a demo video' })
  await row.locator('button:has-text("Approve")').click()
  await p.waitForSelector('.toast:has-text("Approved")')
  await until(() => labels(100).join() === 'P1,job', 'approval to land')
  await until(
    () =>
      S.comments.some(
        (c) => c.issue_number === 100 && isRecord(c.body) && c.body.startsWith('/approve') && c.user.login === 'lead',
      ),
    'the /approve record',
  )
  await p.goto(BASE + '#/jobs')
  await p.waitForSelector('.row:has-text("Record a demo video")')
  step('approved from the Others list; it moved to Jobs with an /approve record')

  await p.click('.page-head >> text=New job')
  await p.fill('.modal input.input-lg', 'Prepare camera-ready figures')
  await p.click('.seg-opt:has-text("P0")')
  await p.click('.modal button:has-text("Add job")')
  await p.waitForURL(/#\/jobs\/101$/)
  assert.equal(labels(101).join(), 'P0,job')
  await p.keyboard.press('Escape')
  await p.click('header .sync')
  await p.waitForSelector('.toast:has-text("Up to date")')
  assert.equal(
    await p.locator('.row:has-text("Prepare camera-ready figures")').count(),
    1,
    'a refresh before GitHub lists it keeps the new job',
  )
  step('refreshing right after creating keeps the new job (GitHub lists lag a few seconds)')
  const first = await p.locator('.row .row-title').first().innerText()
  assert.ok(
    ['Prepare camera-ready figures', 'Fix WER computation for long-form audio'].includes(first),
    'P0 jobs on top',
  )
  step('created a job directly (job + P0, top of the list)')

  await p.goto(BASE + '#/jobs/101')
  await p.click('.drawer .link-btn:has-text("Edit")')
  await p.waitForSelector('.modal')
  await p.keyboard.press('Escape')
  await p.waitForSelector('.modal', { state: 'detached' })
  assert.equal(await p.locator('.drawer').count(), 1, 'Escape closed only the form on top')
  step('Escape closes the topmost dialog only')
  await p.click('.prio-opt:has-text("P2")')
  await until(() => labels(101).join() === 'P2,job', 'priority change')
  await p.locator('.drawer .date-input').fill('2026-11-20')
  await until(() => parseBody(issue(101).body).due === '2026-11-20', 'due date change')
  await p.waitForSelector('.drawer .event:has-text("set the due date to Nov 20")')
  step('changed priority and due date from the drawer')

  await p.goto(BASE + '#/others/8')
  await p.click('.drawer-foot button:has-text("Decline")')
  await p.fill('#decline-reason', 'Not this quarter')
  await p.click('.decline button:has-text("Decline")')
  await until(() => issue(8).state === 'closed' && issue(8).state_reason === 'not_planned', 'decline')
  await until(
    () =>
      S.comments.some((c) => c.issue_number === 8 && isRecord(c.body) && c.body.startsWith('/reject Not this quarter')),
    'the /reject record',
  )
  await p.goto(BASE + '#/others')
  await p.waitForSelector('.tab:has-text("Others") .tab-count:text("1")')
  step('declined a proposal with a reason')
  await p.screenshot({ path: OUT + '/12-admin-others.png' })

  await p.goto(BASE + '#/jobs/4')
  await p.click('.drawer-foot button:has-text("Pick up")')
  await p.waitForSelector('.drawer-foot button:has-text("Drop")')
  await p.click('.drawer-foot button:has-text("Drop")')
  await p.waitForSelector('.drawer-foot button:has-text("Pick up")')
  await Promise.all(S.botRuns)
  await sleep(1500)
  await Promise.all(S.botRuns)
  assert.deepEqual(issue(4).assignees, [], 'quick pick up + drop by an admin ends dropped')
  step('quick pick up then drop: the bot did not replay the records')

  // ---------------- Safety & accessibility ----------------
  console.log('Safety and accessibility')
  const a11y = await newPage()
  const cspViolations = []
  a11y.on('console', (msg) => /Content Security Policy|Refused to/.test(msg.text()) && cspViolations.push(msg.text()))
  await a11y.goto(BASE + '#/jobs')
  await a11y.waitForSelector('.row-title')
  const notebooksRow = a11y.locator('.row:has-text("Clean up old notebooks") .row-link')
  await notebooksRow.focus()
  await a11y.keyboard.press('Enter')
  await a11y.waitForSelector('.drawer .comment:has-text("paste your token")')
  const drawer = a11y.locator('.drawer .comment:has-text("paste your token")')
  assert.equal(
    await drawer
      .locator(
        'input[type=password], input:not([type=checkbox]), button, form, textarea, [style], [class*=btn], #decline-reason',
      )
      .count(),
    0,
    'no fake controls, styles, classes or ids from comments',
  )
  assert.equal(await a11y.locator('.drawer .comment img[onerror]').count(), 0)
  assert.equal(await a11y.locator('.drawer .comment a[href^="javascript:"]').count(), 0)
  assert.equal(
    await a11y.locator('.drawer .comment input[type=checkbox][disabled]').count(),
    1,
    'task lists still render, read-only',
  )
  assert.equal(await a11y.evaluate(() => window.__pwned === true), false)
  step('hostile HTML in a comment is stripped: no token field, overlay, fake buttons, scripts or js: links')

  for (let i = 0; i < 25; i++) await a11y.keyboard.press('Tab')
  assert.ok(await a11y.evaluate(() => !!document.activeElement?.closest('.drawer')), 'Tab stays inside the drawer')
  for (let i = 0; i < 7; i++) await a11y.keyboard.press('Shift+Tab')
  assert.ok(await a11y.evaluate(() => !!document.activeElement?.closest('.drawer')), 'Shift+Tab too')
  await a11y.keyboard.press('Escape')
  await a11y.waitForSelector('.drawer', { state: 'detached' })
  assert.ok(
    await a11y.evaluate(
      () =>
        document.activeElement?.classList.contains('row-link') &&
        document.activeElement.closest('.row')?.textContent.includes('Clean up old notebooks'),
    ),
    'focus back on the row',
  )
  step('drawer keeps keyboard focus inside and hands it back to the row on Escape')

  await a11y.goto(BASE + '#/others')
  await a11y.click('.page-head >> text=Propose a job')
  await a11y.waitForSelector('.modal')
  assert.ok(
    await a11y.evaluate(() => document.activeElement?.matches('.modal input.input-lg')),
    'form opens with the title focused',
  )
  await a11y.keyboard.press('Escape')
  await a11y.waitForSelector('.modal', { state: 'detached' })
  console.log('    CSP reports:', JSON.stringify(cspViolations))
  assert.ok(
    cspViolations.every((v) => v.includes('evil.example')),
    'only the hostile tracking pixel was blocked',
  )
  assert.ok(cspViolations.length > 0, 'the tracking pixel from the comment was blocked')
  step("forms take focus and close on Escape; the CSP blocked only the comment's tracking pixel")

  // ---------------- Search, shortcuts, paging ----------------
  console.log('Search, shortcuts and long lists')
  const s1 = await newPage()
  await s1.goto(BASE + '#/jobs')
  await s1.waitForSelector('.row-title')
  await s1.keyboard.press('/')
  assert.ok(await s1.evaluate(() => document.activeElement?.matches('.search input')), '/ focuses search')
  await s1.keyboard.type('collect')
  await s1.waitForFunction(() => document.querySelectorAll('.row .row-title').length === 1)
  assert.match(await s1.locator('.row-title').first().innerText(), /Collect 200 accented-English samples/)
  await s1.fill('.search input', '@alice')
  await s1.waitForFunction(
    () =>
      [...document.querySelectorAll('.row .row-title')].map((e) => e.textContent).join('|') ===
      'Fix WER computation for long-form audio',
  )
  await s1.fill('.search input', '#4')
  await s1.waitForFunction(() => document.querySelectorAll('.row .row-title').length === 1)
  assert.match(await s1.locator('.row-title').first().innerText(), /leaderboard/)
  await s1.fill('.search input', 'zzzz nothing')
  await s1.waitForSelector('.empty-title:has-text("Nothing here matches")')
  await s1.click('.empty button:has-text("Clear search")')
  await s1.waitForFunction(() => document.querySelectorAll('.row .row-title').length > 3)
  step('search filters by words, @person and #number, with a clear empty state')

  await s1.locator('body').click({ position: { x: 5, y: 400 } })
  await s1.keyboard.press('n')
  await s1.waitForSelector('.modal h2:has-text("Propose a job")')
  assert.match(s1.url(), /#\/others$/, 'n takes members to Others to propose')
  await s1.keyboard.press('Escape')
  step('n opens the propose form for members (on Others)')

  await s1.goto(BASE + '#/done')
  await s1.waitForSelector('.row-title')
  assert.equal(await s1.locator('.row').count(), 50)
  await s1.click('.more-row')
  await s1.waitForFunction(() => document.querySelectorAll('.row').length > 50)
  assert.equal(await s1.locator('.more-row').count(), 0)
  step('long lists show 50 rows at a time with "Show more"')

  // ---------------- Private jobs ----------------
  console.log('Private jobs (admin only)')
  const PRIVATE_TITLE = 'Negotiate the dataset license fee'
  await p.goto(BASE + '#/jobs')
  await p.click('.me')
  await p.waitForSelector('.menu-note:has-text("sign in again with a token that has the repo scope")')
  await p.click('.me')
  await p.click('.page-head >> text=New job')
  assert.equal(await p.locator('.vis-opt:has-text("Admins only")').isDisabled(), true)
  await p.waitForSelector('.vis-hint:has-text("Sign in again with the repo scope")')
  await p.keyboard.press('Escape')
  step('admin with a public_repo token: private option is off and says why')

  // The companion repository was created public by mistake: private jobs must stay off.
  P.isPrivate = false
  const admin2 = await newPage()
  await admin2.goto(BASE + '#/jobs')
  await admin2.click('header >> text=Sign in')
  await admin2.fill('.modal input[type=password]', 'admin-repo-token')
  await admin2.click('.modal button:has-text("Connect")')
  await admin2.waitForSelector('.badge-admin')
  await admin2.click('.me')
  await admin2.waitForSelector('.menu-note:has-text("is public. Make it private on GitHub first")')
  await admin2.click('.me')
  await admin2.click('.page-head >> text=New job')
  assert.equal(await admin2.locator('.vis-opt:has-text("Admins only")').isDisabled(), true)
  await admin2.waitForSelector('.vis-hint:has-text("which is public right now")')
  await admin2.keyboard.press('Escape')
  assert.deepEqual(
    P.calls.filter((c) => c.path.endsWith('/issues')),
    [],
    'nothing read from or written to a public "private" repo',
  )
  step('a public companion repo keeps private jobs off, with a pointer to fix it')

  P.isPrivate = true
  await admin2.reload()
  await admin2.waitForSelector('.badge-admin')
  await admin2.click('.me')
  await admin2.waitForSelector('.menu-note.on:has-text("You can see private jobs")')
  await admin2.click('.me')
  await admin2.click('.page-head >> text=New job')
  await admin2.fill('.modal input.input-lg', PRIVATE_TITLE)
  await admin2.fill('.modal textarea', 'Budget is in the grant doc; do not share outside the admins.')
  await admin2.click('.vis-opt:has-text("Admins only")')
  await admin2.waitForSelector('.modal-sub:has-text("Only admins will see it")')
  await admin2.screenshot({ path: OUT + '/14-private-form.png' })
  await admin2.click('.modal button:has-text("Add private job")')
  await admin2.waitForURL(/#\/jobs\/p1$/)
  assert.equal(P.issues.length, 1)
  assert.deepEqual(P.issues[0].labels.map((l) => l.name).sort(), ['P2', 'job'])
  assert.ok(!S.issues.some((i) => i.title === PRIVATE_TITLE), 'never written to the public repo')
  await admin2.waitForSelector('.drawer .status-chip:has-text("Private · admins only")')
  await admin2.click('.drawer-foot button:has-text("Pick up")')
  await until(() => P.issues[0].assignees.some((a) => a.login === 'lead'), 'private pick up')
  await until(() => P.comments.some((c) => c.issue_number === 1 && isRecord(c.body)), 'private /take record')
  await admin2.keyboard.press('Escape')
  await admin2.waitForSelector(`.row:has-text("${PRIVATE_TITLE}") .lock`)
  await admin2.screenshot({ path: OUT + '/15-private-list.png' })
  step('admin added a private job: kept in the private repo, shown with a lock, picked up directly')

  const member = await newPage()
  await member.goto(BASE + '#/jobs')
  await member.click('header >> text=Sign in')
  await member.fill('.modal input[type=password]', 'member-token')
  await member.click('.modal button:has-text("Connect")')
  await member.waitForSelector('.toast:has-text("Signed in as @sam")')
  await member.waitForSelector('.row-title')
  assert.equal(await member.locator(`.row:has-text("${PRIVATE_TITLE}")`).count(), 0)
  await member.goto(BASE + '#/jobs/p1')
  await member.waitForSelector('.toast:has-text("private jobs need an admin sign-in")')
  assert.deepEqual(
    P.calls.filter((c) => c.who === 'sam' || c.who === null),
    [],
    'members and visitors never even ask for private data',
  )
  step('members never load private jobs, not even from a direct link')

  await admin2.click('.me')
  await admin2.click('.menu-item:has-text("Sign out")')
  await admin2.waitForSelector('.toast:has-text("Signed out")')
  await sleep(300)
  assert.equal(await admin2.locator(`.row:has-text("${PRIVATE_TITLE}")`).count(), 0)
  step('signing out hides private jobs right away')

  await Promise.all(S.botRuns)
  const confused = S.comments.filter((c) => c.reactions?.confused && c.id > 5000)
  assert.deepEqual(confused, [], 'the bot accepted every command the board sent')
  await browser.close()

  // Expected noise: 404s the board handles (e.g. members probing nothing private) and the hostile
  // tracking pixel the CSP blocks.
  const unexpected = problems.filter((x) => !/Failed to load resource/.test(x) && !x.includes('evil.example'))
  assert.deepEqual(unexpected, [], 'no errors in the page')
  console.log(`No page errors. The bot ran ${S.botRuns.length} times. ALL FLOWS PASSED`)
}

main().catch((e) => {
  console.error('FAILED:', e)
  process.exit(1)
})
