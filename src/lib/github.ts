// Minimal GitHub REST client for the browser. api.github.com allows cross-origin requests.

const API = 'https://api.github.com'

export interface RawUser {
  login: string
  avatar_url: string
  html_url: string
  type?: string
}

export interface RawIssue {
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed'
  state_reason: string | null
  labels: ({ name: string; color?: string } | string)[]
  user: RawUser | null
  assignees: RawUser[] | null
  comments: number
  created_at: string
  updated_at: string
  closed_at: string | null
  html_url: string
  pull_request?: unknown
}

export interface RawComment {
  id: number
  issue_number?: number
  issue_url?: string
  body: string | null
  user: RawUser | null
  created_at: string
  updated_at: string
  html_url: string
  reactions?: { '+1'?: number; confused?: number }
}

export interface Snapshot {
  version: number
  repo: string
  generatedAt: string
  issues: RawIssue[]
  comments: RawComment[]
}

export class GitHubError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function toError(res: Response): Promise<GitHubError> {
  let message = ''
  try {
    message = ((await res.json()) as { message?: string }).message ?? ''
  } catch {
    // not JSON
  }
  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000
    const when = reset ? new Date(reset).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'a while'
    return new GitHubError(`GitHub's rate limit is used up until ${when}. Signing in raises it.`, res.status)
  }
  if (res.status === 401) return new GitHubError('GitHub did not accept the token. It may have expired.', 401)
  if (res.status === 403) {
    return new GitHubError(
      message ? `GitHub refused: ${message}` : 'GitHub refused. Is the public_repo scope on your token?',
      403,
    )
  }
  if (res.status === 404) return new GitHubError("GitHub couldn't find that, or your token can't reach it.", 404)
  if (res.status === 422)
    return new GitHubError(message ? `GitHub rejected it: ${message}` : 'GitHub rejected the request.', 422)
  return new GitHubError(message || `GitHub error ${res.status}`, res.status)
}

export type Client = ReturnType<typeof createClient>

export function createClient(token: string | null) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<{ data: T; headers: Headers }> {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
    if (token) headers.Authorization = `Bearer ${token}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    let res: Response
    try {
      res = await fetch(path.startsWith('https://') ? path : API + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        // Revalidate instead of trusting the browser cache, so changes show up right away.
        cache: 'no-cache',
      })
    } catch (error) {
      // A header the browser won't send (a token with characters no token has) is not a network problem.
      if (error instanceof TypeError && /header|ByteString|ISO-8859-1/i.test(error.message))
        throw new GitHubError('That token has characters GitHub tokens never have. Copy it again from GitHub.', 0)
      throw new GitHubError("Couldn't reach GitHub. Check your connection.", 0)
    }
    if (!res.ok) throw await toError(res)
    const data = (res.status === 204 ? undefined : await res.json()) as T
    return { data, headers: res.headers }
  }

  return {
    request,
    get: async <T>(path: string) => (await request<T>('GET', path)).data,
    post: async <T>(path: string, body: unknown) => (await request<T>('POST', path, body)).data,
    patch: async <T>(path: string, body: unknown) => (await request<T>('PATCH', path, body)).data,
    del: async <T>(path: string, body?: unknown) => (await request<T>('DELETE', path, body)).data,
    async paginate<T>(path: string, maxPages = 20): Promise<T[]> {
      const all: T[] = []
      let next: string | null = path
      for (let page = 0; next && page < maxPages; page++) {
        const { data, headers }: { data: T[]; headers: Headers } = await request<T[]>('GET', next)
        all.push(...data)
        next = /<([^>]+)>;\s*rel="next"/.exec(headers.get('link') ?? '')?.[1] ?? null
      }
      return all
    },
    /** The last `maxPages` pages of a list: GitHub lists comments oldest first, and the newest matter most. */
    async paginateLast<T>(path: string, maxPages = 5): Promise<T[]> {
      const { data, headers } = await request<T[]>('GET', path)
      const lastUrl = /<([^>]+)>;\s*rel="last"/.exec(headers.get('link') ?? '')?.[1]
      const last = lastUrl ? Number(new URL(lastUrl).searchParams.get('page')) || 1 : 1
      const first = Math.max(1, last - maxPages + 1)
      const urls: string[] = []
      for (let page = Math.max(2, first); page <= last; page++) {
        const url = new URL(lastUrl!)
        url.searchParams.set('page', String(page))
        urls.push(url.toString())
      }
      const rest = await Promise.all(urls.map(async (url) => (await request<T[]>('GET', url)).data))
      return [...(first === 1 ? data : []), ...rest.flat()]
    },
  }
}
