import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

// Without this, any uncaught render error anywhere in the tree unmounts the entire app to a
// blank window — no tabs, no sidebar, nothing — with only a stack trace in the devtools console
// to explain why. Catching it here at least keeps the failure visible and recoverable.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled render error', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 24,
          background: '#000',
          color: '#dcdcdc',
          fontFamily: 'monospace',
          textAlign: 'center'
        }}
      >
        <div style={{ fontSize: 16 }}>Something went wrong.</div>
        <div style={{ color: '#888', fontSize: 12, maxWidth: 560 }}>{this.state.error.message}</div>
        <button onClick={() => this.setState({ error: null })}>Try to recover</button>
        <button onClick={() => window.location.reload()}>Reload</button>
      </div>
    )
  }
}
