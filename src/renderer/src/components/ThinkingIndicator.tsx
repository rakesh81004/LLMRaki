interface Props {
  label: string
}

export default function ThinkingIndicator({ label }: Props): JSX.Element {
  return (
    <span className="thinking-indicator">
      <span className="thinking-orb-wrap" aria-hidden="true">
        <span className="thinking-orb-glow" />
        <span className="thinking-orb" />
      </span>
      {label}
    </span>
  )
}
