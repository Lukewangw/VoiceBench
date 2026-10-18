// Which repository backs the board. GitHub Actions passes VITE_REPO at build time; as a fallback the
// repository is read from a <user>.github.io/<repo>/ address.
function repoFromLocation(): string {
  const user = /^([a-z0-9-]+)\.github\.io$/i.exec(location.hostname)?.[1]
  const repo = location.pathname.split('/').filter(Boolean)[0]
  return user && repo ? `${user}/${repo}` : ''
}

export const REPO = import.meta.env.VITE_REPO?.trim() || repoFromLocation()
export const REPO_NAME = REPO.split('/')[1] ?? ''
export const REPO_URL = `https://github.com/${REPO}`
export const TITLE = import.meta.env.VITE_TITLE?.trim() || REPO_NAME || 'Job board'

// Private (admin-only) jobs live in a private companion repository, so they never reach the public
// repository or the published site. Only admins who can access it see them.
export const PRIVATE_REPO = import.meta.env.VITE_PRIVATE_REPO?.trim() || (REPO ? `${REPO}-private` : '')
export const PRIVATE_REPO_URL = `https://github.com/${PRIVATE_REPO}`

const tokenUrl = (scope: string) =>
  `https://github.com/settings/tokens/new?scopes=${scope}&description=` + encodeURIComponent(`${TITLE} job board`)
/** Enough to propose, pick up and comment on public jobs. */
export const NEW_TOKEN_URL = tokenUrl('public_repo')
/** Also reads private repositories, which admins need for private jobs. */
export const NEW_ADMIN_TOKEN_URL = tokenUrl('repo')
