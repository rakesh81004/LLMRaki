interface Props {
  text: string
  indices: number[]
}

export default function HighlightedText({ text, indices }: Props): JSX.Element {
  if (indices.length === 0) return <>{text}</>
  const marked = new Set(indices)
  return (
    <>
      {text.split('').map((char, i) =>
        marked.has(i) ? (
          <span key={i} className="match-highlight">
            {char}
          </span>
        ) : (
          char
        )
      )}
    </>
  )
}
