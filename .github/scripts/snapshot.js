// Saves every issue and comment of this repository to a JSON file that ships with the site, so the
// board loads instantly for everyone without spending GitHub API rate limit.

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const user = (u) => u && { login: u.login, avatar_url: u.avatar_url, html_url: u.html_url, type: u.type }

export default async function snapshot({ github, context, core, outFile }) {
  const { owner, repo } = context.repo
  const [issues, comments] = await Promise.all([
    github.paginate(github.rest.issues.listForRepo, { owner, repo, state: 'all', per_page: 100 }),
    github.paginate(github.rest.issues.listCommentsForRepo, { owner, repo, per_page: 100 }),
  ])

  const real = issues.filter((i) => !i.pull_request)
  const numbers = new Set(real.map((i) => i.number))
  const data = {
    version: 1,
    repo: `${owner}/${repo}`,
    generatedAt: new Date().toISOString(),
    issues: real.map((i) => ({
      number: i.number,
      title: i.title,
      body: i.body ?? '',
      state: i.state,
      state_reason: i.state_reason ?? null,
      labels: i.labels.map((l) => (typeof l === 'string' ? { name: l } : { name: l.name, color: l.color })),
      user: user(i.user),
      assignees: (i.assignees ?? []).map(user),
      comments: i.comments,
      created_at: i.created_at,
      updated_at: i.updated_at,
      closed_at: i.closed_at,
      html_url: i.html_url,
    })),
    comments: comments
      .map((c) => ({
        id: c.id,
        issue_number: Number(c.issue_url.split('/').pop()),
        body: c.body ?? '',
        user: user(c.user),
        created_at: c.created_at,
        updated_at: c.updated_at,
        html_url: c.html_url,
        reactions: c.reactions ? { '+1': c.reactions['+1'], confused: c.reactions.confused } : undefined,
      }))
      .filter((c) => numbers.has(c.issue_number)),
  }

  await mkdir(dirname(outFile), { recursive: true })
  await writeFile(outFile, JSON.stringify(data))
  core.info(`Wrote ${outFile}: ${data.issues.length} issues, ${data.comments.length} comments`)
}
