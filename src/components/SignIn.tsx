import { useRef, useState } from 'react'
import { NEW_ADMIN_TOKEN_URL, NEW_TOKEN_URL, REPO, REPO_URL } from '../config'
import { useDialog } from '../lib/useDialog'
import { errorText, type Viewer } from '../state'
import { GitHubMark, Icon, Spinner } from './ui'

interface Props {
  onSignIn(token: string, remember: boolean): Promise<Viewer>
  onClose(): void
  /** Start from the current choice, so a session-only sign-in doesn't silently become permanent. */
  defaultRemember?: boolean
}

export function SignIn({ onSignIn, onClose, defaultRemember = true }: Props) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [remember, setRemember] = useState(defaultRemember)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialog(dialogRef, onClose, inputRef)

  const submit = async () => {
    if (!token.trim()) return
    setBusy(true)
    setError(null)
    try {
      await onSignIn(token, remember)
      onClose()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <div className="modal-layer">
      <div className="modal-backdrop" onClick={onClose} />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal modal-narrow"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signin-title"
      >
        <form
          className="modal-form"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="modal-head">
            <h2 id="signin-title">
              <GitHubMark size={18} /> Connect GitHub
            </h2>
            <button type="button" className="icon-btn" onClick={onClose} title="Close">
              <Icon name="x" />
            </button>
          </div>
          <p className="modal-sub">
            Anyone can look. To pick up jobs, propose new ones or comment from this page, connect your GitHub account
            once with a token.
          </p>

          <ol className="steps">
            <li>
              <span className="step-num">1</span>
              <div>
                <div className="step-title">Create a token on GitHub</div>
                <div className="step-text">
                  The <code>public_repo</code> scope is already ticked. Pick an expiry, then click{' '}
                  <em>Generate token</em>.
                </div>
                <div className="step-links">
                  <a
                    className="btn btn-outline btn-sm"
                    href={NEW_TOKEN_URL}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setTimeout(() => inputRef.current?.focus(), 300)}
                  >
                    <GitHubMark /> Create token <Icon name="external" size={13} />
                  </a>
                  <a
                    className="link-btn"
                    href={NEW_ADMIN_TOKEN_URL}
                    target="_blank"
                    rel="noreferrer"
                    title="The repo scope also reads private repositories, which private jobs need"
                    onClick={() => setTimeout(() => inputRef.current?.focus(), 300)}
                  >
                    <Icon name="lock" size={13} /> Admin? Create one that also sees private jobs
                  </a>
                </div>
              </div>
            </li>
            <li>
              <span className="step-num">2</span>
              <div className="step-grow">
                <div className="step-title">Paste it here</div>
                <input
                  ref={inputRef}
                  className="input mono"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="ghp_…"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </div>
            </li>
          </ol>

          <label className="remember">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>
              Stay signed in on this device
              <small>Untick on a shared computer to keep the token only for this browser session.</small>
            </span>
          </label>

          {error && <div className="form-error">{error}</div>}

          <div className="privacy">
            <Icon name="lock" size={14} />
            <span>
              The token stays in this browser and is only sent to api.github.com. Admins are the people with write
              access to{' '}
              <a href={REPO_URL} target="_blank" rel="noreferrer">
                {REPO}
              </a>
              .
            </span>
          </div>

          <div className="modal-foot">
            <a className="link-btn" href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer">
              Rather not? Use GitHub directly
            </a>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy || !token.trim()}>
                {busy ? <Spinner /> : <Icon name="check" />} Connect
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
