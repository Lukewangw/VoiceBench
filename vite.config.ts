import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

// The board holds GitHub tokens in the page, so the published build only runs its own code, talks
// only to the GitHub API, and shows images only from GitHub. (The dev server needs inline scripts
// for hot reload, so this is for builds only.)
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://avatars.githubusercontent.com https://github.com https://*.githubusercontent.com",
  "connect-src 'self' https://api.github.com",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-src 'none'",
].join('; ')

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  const [owner = '', name = ''] = (env.VITE_REPO ?? '').split('/')
  const title = env.VITE_TITLE || name || 'Job board'
  // Where GitHub Pages serves the board; link previews need absolute URLs.
  const url = owner && name ? `https://${owner.toLowerCase()}.github.io/${name}/` : './'
  return {
    // Relative asset paths, so the site works under https://<user>.github.io/<repo>/ as is.
    base: './',
    plugins: [
      react(),
      {
        name: 'board-meta',
        transformIndexHtml(html: string) {
          const page = html.replaceAll('%BOARD_TITLE%', escapeHtml(title)).replaceAll('%BOARD_URL%', escapeHtml(url))
          if (command !== 'build') return page
          return page.replace(
            '<meta charset="UTF-8" />',
            `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`,
          )
        },
      },
    ],
  }
})
