import { useEffect, useRef, useState } from 'react'
import { formatSize, readAttachment } from './attachments'
import { BUILT_IN_SKILLS, type Skill } from './skills'
import {
  clearApplications,
  deleteApplication,
  deleteNote,
  loadApplications,
  loadNotes,
  type ApplicationRecord,
  type MemoryNote
} from './memory'
import type { Settings } from './types'

interface Props {
  draft: Settings
  update: (patch: Partial<Settings>) => void
}

const PROFILE_HINT = `For example:
Name: …   Phone: …   Email: …
Total experience: 3 years (React, Node.js)
Current CTC: 5 LPA · Expected CTC: 7 LPA · Notice period: 30 days
Preferred roles: Frontend Developer, React Developer
Preferred locations: Bengaluru, Pune, Remote
Willing to relocate: yes · Work authorisation: India`

export function ProfileSection({ draft, update }: Props): JSX.Element {
  const fileRef = useRef<HTMLInputElement>(null)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const attach = async (file: File): Promise<void> => {
    setReading(true)
    setError(null)
    try {
      const a = await readAttachment(file)
      if (a.kind !== 'text' || !a.text) throw new Error('Attach your résumé as a PDF, Word (.docx) or text file.')
      update({ resume: { name: a.name, size: a.size, text: a.text } })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setReading(false)
    }
  }

  return (
    <div className="field">
      <span className="field-label">My profile</span>
      <span className="field-hint">
        Used when LLMRaki fills in applications and forms for you. It only uses what's here — it never makes up details.
      </span>
      <div className="field-row">
        {draft.resume ? (
          <span className="resume-chip grow" title={`${draft.resume.name} · ${formatSize(draft.resume.size)}`}>
            Résumé: <strong>{draft.resume.name}</strong> · {formatSize(draft.resume.size)}
          </span>
        ) : (
          <span className="field-hint grow">No résumé attached yet.</span>
        )}
        <button type="button" className="ghost-button" onClick={() => fileRef.current?.click()} disabled={reading}>
          {reading ? 'Reading…' : draft.resume ? 'Replace' : 'Attach résumé'}
        </button>
        {draft.resume && (
          <button type="button" className="ghost-button" onClick={() => update({ resume: undefined })}>
            Remove
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".pdf,.docx,.txt,.md"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void attach(file)
            e.target.value = ''
          }}
        />
      </div>
      {error && <span className="setup-error">{error}</span>}
      <textarea
        className="settings-textarea"
        rows={6}
        value={draft.profileText}
        placeholder={PROFILE_HINT}
        onChange={(e) => update({ profileText: e.target.value })}
      />
    </div>
  )
}

const SITE_SUGGESTIONS = ['naukri.com', 'linkedin.com', 'indeed.com']

export function AutoApproveSection({ draft, update }: Props): JSX.Element {
  const [site, setSite] = useState('')
  const sites = draft.autoApproveSites ?? []
  const add = (value: string): void => {
    const clean = value.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
    if (!clean || sites.includes(clean)) return
    update({ autoApproveSites: [...sites, clean] })
    setSite('')
  }
  return (
    <div className="field">
      <span className="field-label">Auto-approve on these sites</span>
      <span className="field-hint">
        In Auto mode, LLMRaki asks before clicks that submit, apply, send, pay or delete. On the sites below it does them
        without asking — so it can, for example, apply to jobs on its own. Password and payment fields are still never
        filled by it.
      </span>
      {sites.length > 0 && (
        <div className="site-chips">
          {sites.map((s) => (
            <span key={s} className="site-chip">
              {s}
              <button className="attach-remove" title={`Ask again on ${s}`} onClick={() => update({ autoApproveSites: sites.filter((x) => x !== s) })}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="field-row">
        <input
          value={site}
          placeholder="e.g. naukri.com"
          onChange={(e) => setSite(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add(site)
          }}
        />
        <button type="button" className="ghost-button" onClick={() => add(site)} disabled={!site.trim()}>
          Add
        </button>
      </div>
      <div className="field-row wrap">
        {SITE_SUGGESTIONS.filter((s) => !sites.includes(s)).map((s) => (
          <button key={s} type="button" className="link-button" onClick={() => add(s)}>
            + {s}
          </button>
        ))}
      </div>
      <label className="toggle">
        <input type="checkbox" checked={draft.groupTabs !== false} onChange={(e) => update({ groupTabs: e.target.checked })} />
        Group the tabs LLMRaki works on (a blue “🤖 LLMRaki” tab group)
      </label>
      <label className="toggle">
        <input type="checkbox" checked={draft.autoContinue !== false} onChange={(e) => update({ autoContinue: e.target.checked })} />
        Continue long tasks automatically (10 seconds after they reach the step limit, up to 5 times)
      </label>
    </div>
  )
}

export function SkillsSection({ draft, update }: Props): JSX.Element {
  const custom = draft.customSkills ?? []
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<Skill | null>(null)
  const [originalName, setOriginalName] = useState<string | null>(null)

  const save = (): void => {
    if (!editing || !editing.name.trim() || !editing.instructions.trim()) return
    const name = editing.name.trim().toLowerCase().replace(/\s+/g, '-')
    const next = custom.filter((s) => s.name !== originalName && s.name !== name)
    update({ customSkills: [...next, { name, description: editing.description.trim(), instructions: editing.instructions.trim() }] })
    setEditing(null)
    setOriginalName(null)
  }

  const builtIns = BUILT_IN_SKILLS.filter((b) => !custom.some((c) => c.name === b.name))
  return (
    <div className="field">
      <div className="field-row">
        <span className="field-label grow">Skills</span>
        {!editing && (
          <button type="button" className="ghost-button" onClick={() => setEditing({ name: '', description: '', instructions: '' })}>
            Add skill
          </button>
        )}
      </div>
      <span className="field-hint">
        Playbooks LLMRaki loads when a task matches — how to apply to jobs, fill in forms, research. Add your own, or
        customise a built-in one (it then replaces the original).
      </span>
      {editing ? (
        <div className="skill-editor">
          <input placeholder="Name, e.g. linkedin-outreach" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          <input
            placeholder="When to use it, e.g. Sending connection requests on LinkedIn"
            value={editing.description}
            onChange={(e) => setEditing({ ...editing, description: e.target.value })}
          />
          <textarea
            className="settings-textarea"
            rows={8}
            placeholder="Step-by-step instructions, as you would explain them to an assistant."
            value={editing.instructions}
            onChange={(e) => setEditing({ ...editing, instructions: e.target.value })}
          />
          <div className="field-row">
            <button className="primary-button small" onClick={save} disabled={!editing.name.trim() || !editing.instructions.trim()}>
              Save skill
            </button>
            <button className="ghost-button small" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <ul className="skill-list">
          {[...builtIns, ...custom].map((s) => (
            <li key={s.name}>
              <div className="field-row">
                <button className="skill-name grow" onClick={() => setOpen(open === s.name ? null : s.name)} title={s.description}>
                  {s.name}
                  <span className="skill-badge">{'builtIn' in s && s.builtIn ? 'built-in' : 'yours'}</span>
                </button>
                <button
                  className="link-button"
                  onClick={() => {
                    setEditing({ name: s.name, description: s.description, instructions: s.instructions })
                    setOriginalName(s.name)
                  }}
                >
                  {'builtIn' in s && s.builtIn ? 'Customise' : 'Edit'}
                </button>
                {!('builtIn' in s && s.builtIn) && (
                  <button className="attach-remove" title="Delete skill" onClick={() => update({ customSkills: custom.filter((c) => c.name !== s.name) })}>
                    ×
                  </button>
                )}
              </div>
              <div className="field-hint">{s.description}</div>
              {open === s.name && <pre className="skill-instructions">{s.instructions}</pre>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function MemorySection(): JSX.Element {
  const [apps, setApps] = useState<ApplicationRecord[]>([])
  const [notes, setNotes] = useState<MemoryNote[]>([])
  const [showAll, setShowAll] = useState(false)
  useEffect(() => {
    void loadApplications().then(setApps)
    void loadNotes().then(setNotes)
  }, [])
  const applied = apps.filter((a) => a.status === 'applied').length
  const shown = showAll ? apps : apps.slice(0, 8)
  return (
    <div className="field">
      <div className="field-row">
        <span className="field-label grow">Memory</span>
        {apps.length > 0 && (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              if (confirm('Clear the whole applications log? LLMRaki may then apply to those jobs again.')) {
                void clearApplications().then(() => setApps([]))
              }
            }}
          >
            Clear log
          </button>
        )}
      </div>
      <span className="field-hint">
        Jobs applied to: <strong>{applied}</strong>
        {apps.length > applied ? ` · ${apps.length - applied} skipped or external` : ''}. LLMRaki checks this before
        applying, so it never applies twice.
      </span>
      {shown.length > 0 && (
        <ul className="memory-list">
          {shown.map((a) => (
            <li key={a.id}>
              <span className={`memory-status ${a.status}`}>{a.status}</span>
              <a href={a.url} target="_blank" rel="noreferrer" className="memory-text" title={a.note ?? a.url}>
                {a.title} — {a.company}
              </a>
              <span className="memory-date">{new Date(a.at).toLocaleDateString([], { day: 'numeric', month: 'short' })}</span>
              <button className="attach-remove" title="Remove from log" onClick={() => void deleteApplication(a.id).then(setApps)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {apps.length > 8 && (
        <button className="link-button" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show fewer' : `Show all ${apps.length}`}
        </button>
      )}
      {notes.length > 0 && (
        <>
          <span className="field-hint">Notes LLMRaki saved:</span>
          <ul className="memory-list">
            {notes.slice(0, 20).map((n) => (
              <li key={n.id}>
                <span className="memory-text" title={n.text}>
                  {n.text}
                </span>
                <button className="attach-remove" title="Forget this" onClick={() => void deleteNote(n.id).then(setNotes)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
