import type { Job } from './model'

/**
 * Whether a job matches what someone typed in the search box. Every word has to appear in the
 * title, description, people or priority; "#12" means job #12 exactly; "@sam" means sam.
 */
export function matchesQuery(job: Job, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const text = [
    job.title,
    job.description,
    job.author.login,
    ...job.assignees.map((a) => a.login),
    job.priority ?? '',
    job.private ? 'private' : '',
  ]
    .join('\n')
    .toLowerCase()
  return words.every((word) => {
    if (/^#\d+$/.test(word)) return word === `#${job.number}`
    return text.includes(word.replace(/^@/, ''))
  })
}
