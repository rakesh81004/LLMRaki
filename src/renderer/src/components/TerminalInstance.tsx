import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface Props {
  id: string
  cwd: string | null
  active: boolean
  pendingCommand?: string | null
  onCommandConsumed?: () => void
}

export default function TerminalInstance({ id, cwd, active, pendingCommand, onCommandConsumed }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      convertEol: true,
      fontSize: 13,
      fontFamily: 'Menlo, Consolas, monospace',
      theme: {
        background: '#000000',
        foreground: '#dcdcdc'
      }
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()

    termRef.current = term
    fitRef.current = fitAddon

    window.api.terminal.create(id, cwd)

    const offData = window.api.terminal.onData(id, (data) => term.write(data))
    const offExit = window.api.terminal.onExit(id, () => {
      term.write('\r\n[process exited]\r\n')
    })

    term.onData((data) => {
      window.api.terminal.write(id, data)
    })

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit()
        window.api.terminal.resize(id, term.cols, term.rows)
      } catch {
        // ignore transient resize errors during teardown
      }
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      offData()
      offExit()
      resizeObserver.disconnect()
      term.dispose()
      window.api.terminal.kill(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (active) {
      fitRef.current?.fit()
      termRef.current?.focus()
    }
  }, [active])

  useEffect(() => {
    if (pendingCommand && termRef.current) {
      window.api.terminal.write(id, `${pendingCommand}\r`)
      onCommandConsumed?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCommand])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', display: active ? 'block' : 'none', padding: '4px 8px' }}
    />
  )
}
