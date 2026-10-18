import { useRef, useState } from 'react'
import { DEFAULT_PRIORITY, PRIORITIES, priorityLabel, type PriorityKey } from '../../shared/board.js'
import { PRIVATE_REPO, PRIVATE_REPO_URL, REPO_URL } from '../config'
import { dueRelative, todayYmd } from '../lib/format'
import { useDialog } from '../lib/useDialog'
import type { Job } from '../lib/model'
import { errorText, type JobInput, type Viewer } from '../state'
import { GitHubMark, Icon, Spinner } from './ui'

interface Props {
  job?: Job
  viewer: Viewer | null
  /** False when only the title and description may change (e.g. an approved job edited by its author). */
  canEditDetails: boolean
  onSubmit(input: JobInput): Promise<void>
  onClose(): void
  onSignIn(): void
}

export function JobForm({ job, viewer, canEditDetails, onSubmit, onClose, onSignIn }: Props) {
  const [title, setTitle] = useState(job?.title ?? '')
  const [description, setDescription] = useState(job?.description ?? '')
  const [priority, setPriority] = useState<PriorityKey>(job?.priority ?? DEFAULT_PRIORITY)
  const [due, setDue] = useState(job?.due ?? '')
  const [isPrivate, setIsPrivate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  const dialogRef = useRef<HTMLDivElement>(null)
  useDialog(dialogRef, onClose, { initialFocus: titleRef })

  const editing = !!job
  const isAdmin = !!viewer?.isAdmin
  const canPrivate = isAdmin && viewer?.privateAccess === 'yes'
  const heading = editing ? (job.private ? 'Edit private job' : 'Edit job') : isAdmin ? 'New job' : 'Propose a job'
  const valid = title.trim().length > 0

  const submit = async () => {
    if (!valid || saving) return
    // Without a sign-in a new public job can be filed on GitHub instead; an edit or a private job can't.
    if (!viewer) return editing || isPrivate ? setError('Sign in again to save this.') : openOnGitHub()
    setSaving(true)
    setError(null)
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        priority,
        due: due || null,
        private: isPrivate,
      })
    } catch (e) {
      setError(errorText(e))
      setSaving(false)
    }
  }

  // Without signing in, the same form is filled in on GitHub instead.
  const openOnGitHub = () => {
    const q = new URLSearchParams({
      template: 'job.yml',
      title: title.trim(),
      description: description.trim(),
      priority: priorityLabel(priority),
    })
    if (due) q.set('due', due)
    window.open(`${REPO_URL}/issues/new?${q}`, '_blank', 'noopener')
    onClose()
  }

  return (
    <div className="modal-layer">
      <div className="modal-backdrop" onClick={onClose} />
      <div ref={dialogRef} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="form-title">
        <form
          className="modal-form"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          // Like the Save button: the browser checks the fields first (a half-typed date, say).
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && e.currentTarget.requestSubmit()}
        >
          <div className="modal-head">
            <h2 id="form-title">{heading}</h2>
            <button type="button" className="icon-btn" onClick={onClose} title="Close">
              <Icon name="x" />
            </button>
          </div>
          {!editing && (
            <p className="modal-sub">
              {!isAdmin
                ? 'It goes to Others first. Once an admin approves it, it shows up in Jobs.'
                : isPrivate
                  ? 'Only admins will see it. It is kept in the private repository, never on the public board.'
                  : 'Goes straight onto the board, ready to be picked up.'}
            </p>
          )}

          <label className="field">
            <span className="field-label">Title</span>
            <input
              ref={titleRef}
              className="input input-lg"
              value={title}
              maxLength={200}
              placeholder="A short summary people can scan"
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>

          <label className="field">
            <span className="field-label">
              Description <span className="muted">· optional, Markdown works</span>
            </span>
            <textarea
              className="input"
              rows={5}
              value={description}
              placeholder="What needs to be done? What does done look like? Links, files, context…"
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          <div className="field-row">
            <div className="field">
              <span className="field-label">Priority</span>
              <div className="seg" role="radiogroup" aria-label="Priority">
                {PRIORITIES.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    role="radio"
                    aria-checked={priority === p.key}
                    disabled={!canEditDetails}
                    className={`seg-opt pill-${p.key.toLowerCase()}${priority === p.key ? ' selected' : ''}`}
                    onClick={() => setPriority(p.key as PriorityKey)}
                  >
                    <b>{p.key}</b> {p.name}
                  </button>
                ))}
              </div>
            </div>
            <label className="field field-due">
              <span className="field-label">Due date {due && <span className="muted">· {dueRelative(due)}</span>}</span>
              <span className="due-input">
                <input
                  type="date"
                  className="input"
                  value={due}
                  min={editing ? undefined : todayYmd()}
                  disabled={!canEditDetails}
                  onChange={(e) => setDue(e.target.value)}
                />
                {due && canEditDetails && (
                  <button type="button" className="link-btn" onClick={() => setDue('')}>
                    Clear
                  </button>
                )}
              </span>
            </label>
          </div>

          {!editing && isAdmin && (
            <div className="field">
              <span className="field-label">Who can see it</span>
              <div className="vis" role="radiogroup" aria-label="Who can see it">
                <button
                  type="button"
                  role="radio"
                  aria-checked={!isPrivate}
                  className={`vis-opt${!isPrivate ? ' selected' : ''}`}
                  onClick={() => setIsPrivate(false)}
                >
                  <Icon name="users" />
                  <span>
                    <b>Everyone</b>
                    <small>On the public board</small>
                  </span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={isPrivate}
                  disabled={!canPrivate}
                  className={`vis-opt vis-private${isPrivate ? ' selected' : ''}`}
                  onClick={() => setIsPrivate(true)}
                >
                  <Icon name="lock" />
                  <span>
                    <b>Admins only</b>
                    <small>Private job</small>
                  </span>
                </button>
              </div>
              {!canPrivate && viewer?.privateAccess && (
                <p className="vis-hint">
                  {viewer?.privateAccess === 'needs-scope' ? (
                    <>
                      Private jobs need a token that can read private repositories.{' '}
                      <button type="button" className="link-btn" onClick={onSignIn}>
                        Sign in again with the repo scope
                      </button>
                    </>
                  ) : viewer?.privateAccess === 'not-private' ? (
                    <>
                      Private jobs are kept in {PRIVATE_REPO}, which is public right now.{' '}
                      <a href={`${PRIVATE_REPO_URL}/settings`} target="_blank" rel="noreferrer">
                        Make it private
                      </a>{' '}
                      (Settings → Danger Zone), then reload.
                    </>
                  ) : (
                    <>
                      Private jobs are kept in{' '}
                      <a href={PRIVATE_REPO_URL} target="_blank" rel="noreferrer">
                        {PRIVATE_REPO}
                      </a>
                      , which doesn't exist yet or isn't shared with you.
                    </>
                  )}
                </p>
              )}
            </div>
          )}

          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}

          <div className="modal-foot">
            {viewer ? (
              <span className="hint">⌘/Ctrl + Enter to {editing ? 'save' : 'submit'}</span>
            ) : (
              <button type="button" className="link-btn" onClick={onSignIn}>
                Sign in to post it from here
              </button>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              {viewer ? (
                <button type="submit" className="btn btn-primary" disabled={!valid || saving}>
                  {saving ? <Spinner /> : <Icon name={editing ? 'check' : isPrivate ? 'lock' : 'plus'} />}{' '}
                  {editing ? 'Save' : isPrivate ? 'Add private job' : isAdmin ? 'Add job' : 'Submit proposal'}
                </button>
              ) : (
                <button type="submit" className="btn btn-dark" disabled={!valid}>
                  <GitHubMark /> Continue on GitHub
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
