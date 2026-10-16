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
export const NEW_TOKEN_URL =
  'https://github.com/settings/tokens/new?scopes=public_repo&description=' + encodeURIComponent(`${TITLE} job board`)
