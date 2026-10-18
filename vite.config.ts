import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export default defineConfig(({ mode }) => {
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
        transformIndexHtml: (html: string) =>
          html.replaceAll('%BOARD_TITLE%', escapeHtml(title)).replaceAll('%BOARD_URL%', escapeHtml(url)),
      },
    ],
  }
})
