import { useEffect, useRef, useState } from 'react'
import { NEW_TOKEN_URL, REPO, REPO_URL } from '../config'
import { errorText, type Viewer } from '../state'
import { GitHubMark, Icon, Spinner } from './ui'

interface Props {
  onSignIn(token: string): Promise<Viewer>
  onClose(): void
}

export function SignIn({ onSignIn, onClose }: Props) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async () => {
    if (!token.trim()) return
    setBusy(true)
    setError(null)
    try {
      await onSignIn(token)
      onClose()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <div className="modal-layer">
      <div className="modal-backdrop" onClick={onClose} />
      <form
        className="modal modal-narrow"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signin-title"
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
          Anyone can look. To pick up jobs, propose new ones or comment from this page, connect your GitHub account once
          with a token.
        </p>

        <ol className="steps">
          <li>
            <span className="step-num">1</span>
            <div>
              <div className="step-title">Create a token on GitHub</div>
              <div className="step-text">
                The <code>public_repo</code> scope is already ticked. Pick an expiry, then click <em>Generate token</em>.
              </div>
              <a
                className="btn btn-outline btn-sm"
                href={NEW_TOKEN_URL}
                target="_blank"
                rel="noreferrer"
                onClick={() => setTimeout(() => inputRef.current?.focus(), 300)}
              >
                <GitHubMark /> Create token <Icon name="external" size={13} />
              </a>
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

        {error && <div className="form-error">{error}</div>}

        <div className="privacy">
          <Icon name="lock" size={14} />
          <span>
            The token stays in this browser and is only sent to api.github.com. Admins are the people with write access
            to <a href={REPO_URL} target="_blank" rel="noreferrer">{REPO}</a>.
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
  )
}
