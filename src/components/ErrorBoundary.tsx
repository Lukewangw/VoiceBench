import { Component, type ErrorInfo, type ReactNode } from 'react'
import { REPO_URL } from '../config'
import { Icon } from './ui'

/** If rendering ever breaks, show a way out instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('The board crashed while rendering', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="page">
        <div className="card">
          <div className="empty">
            <span className="empty-icon tone-red">
              <Icon name="ban" size={22} />
            </span>
            <h1 className="empty-title">Something went wrong</h1>
            <div className="empty-text">
              The board hit an unexpected error. Reloading usually fixes it, and nothing on GitHub was lost.
            </div>
            <div className="empty-actions">
              <button className="btn btn-primary" onClick={() => location.reload()}>
                <Icon name="refresh" /> Reload
              </button>
              <a className="btn btn-outline" href={`${REPO_URL}/issues`}>
                Open the issues on GitHub
              </a>
            </div>
          </div>
        </div>
      </main>
    )
  }
}
