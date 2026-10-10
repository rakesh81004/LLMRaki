const common = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

export function PlusIcon(): JSX.Element {
  return (
    <svg {...common}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  )
}

export function HistoryIcon(): JSX.Element {
  return (
    <svg {...common}>
      <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" />
      <path d="M2.5 2.5v2.2h2.2" />
      <path d="M8 5.2V8l2 1.4" />
    </svg>
  )
}

export function PaperclipIcon(): JSX.Element {
  return (
    <svg {...common}>
      <path d="M13.2 7.6 8 12.8a3.2 3.2 0 0 1-4.5-4.5l5.6-5.6a2.1 2.1 0 0 1 3 3L6.5 11.3a1.1 1.1 0 0 1-1.5-1.5l5-5" />
    </svg>
  )
}

export function FileIcon(): JSX.Element {
  return (
    <svg {...common} width={14} height={14}>
      <path d="M9.5 1.8H4.6a1 1 0 0 0-1 1v10.4a1 1 0 0 0 1 1h6.8a1 1 0 0 0 1-1V4.7L9.5 1.8Z" />
      <path d="M9.5 1.8v2.9h2.9" />
    </svg>
  )
}

export function SettingsIcon(): JSX.Element {
  return (
    <svg {...common}>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" />
    </svg>
  )
}
