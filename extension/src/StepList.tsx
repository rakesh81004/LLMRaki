import type { AgentStep } from './types'

interface Props {
  steps: AgentStep[]
  // choice: index of the button pressed (Allow = 0, Deny = 1 for an approval).
  onAnswer: (stepId: string, choice: number) => void
  onUndo: (step: AgentStep) => void
}

const STATUS_TEXT: Record<AgentStep['status'], string> = {
  running: 'Working…',
  awaiting: 'Needs your OK',
  done: 'Done',
  denied: 'Declined',
  failed: 'Failed',
  undone: 'Undone'
}

export default function StepList({ steps, onAnswer, onUndo }: Props): JSX.Element {
  return (
    <ol className="steps">
      {steps.map((step) =>
        step.kind === 'message' ? (
          // A message the user sent mid-task, shown where in the run LLMRaki picked it up.
          <li key={step.id} className="step user-note">
            <span className="user-note-label">You, during the task</span>
            <div className="user-note-text">{step.label}</div>
            <span className="user-note-status">Read by LLMRaki</span>
          </li>
        ) : (
        <li key={step.id} className={`step ${step.status}`}>
          <div className="step-main">
            <span className="step-dot" />
            <span className="step-label" title={step.label}>
              {step.label}
            </span>
            {step.status === 'done' && step.undo ? (
              <button className="link-button" onClick={() => onUndo(step)}>
                Undo
              </button>
            ) : (
              <span className="step-status">
                {step.choices && step.status === 'awaiting' ? 'Your call' : step.kind === 'memory' && step.status === 'denied' ? 'Skipped' : STATUS_TEXT[step.status]}
              </span>
            )}
          </div>
          {step.detail && step.kind !== 'read' && <div className="step-detail">{step.detail}</div>}
          {step.error && <div className="step-error">{step.error}</div>}
          {step.status === 'awaiting' && (
            <div className="step-actions">
              {(step.choices ?? ['Allow', 'Deny']).map((label, i) => (
                <button
                  key={label}
                  className={i === 0 ? 'primary-button small' : 'ghost-button small'}
                  onClick={() => onAnswer(step.id, i)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </li>
        )
      )}
    </ol>
  )
}
