interface Props {
  label: string
}

export default function ThinkingIndicator({ label }: Props): JSX.Element {
  return (
    <span className="thinking-indicator">
      {label}
      <span className="thinking-dots">
        <span />
        <span />
        <span />
      </span>
    </span>
  )
}
