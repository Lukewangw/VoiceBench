import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  const title = env.VITE_TITLE || env.VITE_REPO?.split('/')[1] || 'Job board'
  return {
    // Relative asset paths, so the site works under https://<user>.github.io/<repo>/ as is.
    base: './',
    plugins: [
      react(),
      { name: 'board-title', transformIndexHtml: (html: string) => html.replaceAll('%BOARD_TITLE%', escapeHtml(title)) },
    ],
  }
})
