import { useEffect, useRef, useState } from 'react'
import { DEFAULT_PRIORITY, PRIORITIES, priorityLabel, type PriorityKey } from '../../shared/board.js'
import { REPO_URL } from '../config'
import { dueRelative, todayYmd } from '../lib/format'
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
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const editing = !!job
  const isAdmin = !!viewer?.isAdmin
  const heading = editing ? 'Edit job' : isAdmin ? 'New job' : 'Propose a job'
  const valid = title.trim().length > 0

  const submit = async () => {
    if (!valid || saving) return
    if (!viewer) return openOnGitHub()
    setSaving(true)
    setError(null)
    try {
      await onSubmit({ title: title.trim(), description: description.trim(), priority, due: due || null })
    } catch (e) {
      setError(errorText(e))
      setSaving(false)
    }
  }

  // Without signing in, the same form is filled in on GitHub instead.
  const openOnGitHub = () => {
    const q = new URLSearchParams({ template: 'job.yml', title: title.trim(), description: description.trim(), priority: priorityLabel(priority) })
    if (due) q.set('due', due)
    window.open(`${REPO_URL}/issues/new?${q}`, '_blank', 'noopener')
    onClose()
  }

  return (
    <div className="modal-layer">
      <div className="modal-backdrop" onClick={onClose} />
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="form-title"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && void submit()}
      >
        <div className="modal-head">
          <h2 id="form-title">{heading}</h2>
          <button type="button" className="icon-btn" onClick={onClose} title="Close">
            <Icon name="x" />
          </button>
        </div>
        {!editing && (
          <p className="modal-sub">
            {isAdmin
              ? 'Goes straight onto the board, ready to be picked up.'
              : 'It goes to Others first. Once an admin approves it, it shows up in Jobs.'}
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
            <span className="field-label">
              Due date{' '}
              {due && <span className="muted">· {dueRelative(due)}</span>}
            </span>
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

        {error && <div className="form-error">{error}</div>}

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
                {saving ? <Spinner /> : <Icon name={editing ? 'check' : 'plus'} />}{' '}
                {editing ? 'Save' : isAdmin ? 'Add job' : 'Submit proposal'}
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
  )
}
