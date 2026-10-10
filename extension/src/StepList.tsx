import type { AgentStep } from './types'

interface Props {
  steps: AgentStep[]
  onAnswer: (stepId: string, allowed: boolean) => void
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
      {steps.map((step) => (
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
              <span className="step-status">{STATUS_TEXT[step.status]}</span>
            )}
          </div>
          {step.detail && step.kind !== 'read' && <div className="step-detail">{step.detail}</div>}
          {step.error && <div className="step-error">{step.error}</div>}
          {step.status === 'awaiting' && (
            <div className="step-actions">
              <button className="primary-button small" onClick={() => onAnswer(step.id, true)}>
                Allow
              </button>
              <button className="ghost-button small" onClick={() => onAnswer(step.id, false)}>
                Deny
              </button>
            </div>
          )}
        </li>
      ))}
    </ol>
  )
}
