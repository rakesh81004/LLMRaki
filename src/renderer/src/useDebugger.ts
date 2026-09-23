import { useCallback, useEffect, useRef, useState } from 'react'
import type { DebugCallFrame, DebugOutputEvent, DebugVariable } from './types'

export interface DebugOutputLine extends DebugOutputEvent {
  id: number
}

export type DebugStatus = 'idle' | 'starting' | 'running' | 'paused' | 'terminated'

export interface DebugState {
  status: DebugStatus
  entryPath: string | null
  callFrames: DebugCallFrame[]
  activeFrameIndex: number
  output: DebugOutputLine[]
}

const INITIAL_STATE: DebugState = {
  status: 'idle',
  entryPath: null,
  callFrames: [],
  activeFrameIndex: 0,
  output: []
}

export interface UseDebuggerResult {
  breakpoints: Record<string, number[]>
  toggleBreakpoint: (path: string, line: number) => void
  state: DebugState
  start: (entryPath: string) => void
  stop: () => void
  continue_: () => void
  stepOver: () => void
  stepInto: () => void
  stepOut: () => void
  setActiveFrameIndex: (index: number) => void
  getProperties: (objectId: string) => Promise<DebugVariable[]>
  evaluate: (expression: string) => Promise<string>
  pausedLocation: { path: string; line: number } | null
}

// Real breakpoint/step/variable debugging state for Node.js scripts, backed by the V8 inspector
// session in the main process (see src/main/ipc/nodeDebugger.ts). This hook owns the breakpoint
// set (shared across every open editor) and the live session's paused/running state.
export function useDebuggerSession(): UseDebuggerResult {
  const [breakpoints, setBreakpoints] = useState<Record<string, number[]>>({})
  const [state, setState] = useState<DebugState>(INITIAL_STATE)
  const sessionIdRef = useRef<string | null>(null)
  const unsubscribersRef = useRef<(() => void)[]>([])
  const outputIdRef = useRef(0)
  const breakpointsRef = useRef(breakpoints)
  breakpointsRef.current = breakpoints

  const teardownListeners = useCallback(() => {
    unsubscribersRef.current.forEach((fn) => fn())
    unsubscribersRef.current = []
  }, [])

  useEffect(() => teardownListeners, [teardownListeners])

  const appendOutput = useCallback((line: DebugOutputEvent) => {
    outputIdRef.current += 1
    const id = outputIdRef.current
    setState((s) => ({ ...s, output: [...s.output, { ...line, id }] }))
  }, [])

  const start = useCallback(
    (entryPath: string) => {
      teardownListeners()
      const sessionId = `dbg-${Date.now()}-${Math.random().toString(36).slice(2)}`
      sessionIdRef.current = sessionId
      outputIdRef.current = 0
      setState({ ...INITIAL_STATE, status: 'starting', entryPath })

      unsubscribersRef.current.push(
        window.api.debug.onPaused(sessionId, (event) => {
          setState((s) => ({ ...s, status: 'paused', callFrames: event.callFrames, activeFrameIndex: 0 }))
        }),
        window.api.debug.onResumed(sessionId, () => {
          setState((s) => ({ ...s, status: 'running', callFrames: [], activeFrameIndex: 0 }))
        }),
        window.api.debug.onOutput(sessionId, appendOutput),
        window.api.debug.onTerminated(sessionId, (event) => {
          appendOutput({ stream: 'stderr', text: `\nProgram exited with code ${event.code ?? 0}\n` })
          setState((s) => ({ ...s, status: 'terminated', callFrames: [] }))
          sessionIdRef.current = null
        }),
        window.api.debug.onError(sessionId, (message) => {
          appendOutput({ stream: 'stderr', text: `\nDebugger error: ${message}\n` })
        })
      )

      const breakpointGroups = Object.entries(breakpointsRef.current).map(([path, lines]) => ({
        path,
        lines
      }))
      window.api.debug
        .start(sessionId, entryPath, breakpointGroups)
        .then(() => {
          setState((s) => (s.status === 'starting' ? { ...s, status: 'running' } : s))
        })
        .catch((err: unknown) => {
          appendOutput({
            stream: 'stderr',
            text: `Failed to start debugger: ${err instanceof Error ? err.message : String(err)}\n`
          })
          setState((s) => ({ ...s, status: 'terminated' }))
        })
    },
    [appendOutput, teardownListeners]
  )

  const stop = useCallback(() => {
    const sessionId = sessionIdRef.current
    if (sessionId) void window.api.debug.stop(sessionId)
    sessionIdRef.current = null
    setState((s) => ({ ...s, status: 'idle', callFrames: [] }))
  }, [])

  const toggleBreakpoint = useCallback((path: string, line: number) => {
    setBreakpoints((prev) => {
      const lines = prev[path] ?? []
      const exists = lines.includes(line)
      const nextLines = exists ? lines.filter((l) => l !== line) : [...lines, line].sort((a, b) => a - b)
      const next = { ...prev }
      if (nextLines.length === 0) delete next[path]
      else next[path] = nextLines

      const sessionId = sessionIdRef.current
      if (sessionId) {
        if (exists) void window.api.debug.removeBreakpoint(sessionId, path, line)
        else void window.api.debug.setBreakpoint(sessionId, path, line)
      }
      return next
    })
  }, [])

  const continue_ = useCallback(() => {
    const sessionId = sessionIdRef.current
    if (sessionId) void window.api.debug.continue(sessionId)
  }, [])
  const stepOver = useCallback(() => {
    const sessionId = sessionIdRef.current
    if (sessionId) void window.api.debug.stepOver(sessionId)
  }, [])
  const stepInto = useCallback(() => {
    const sessionId = sessionIdRef.current
    if (sessionId) void window.api.debug.stepInto(sessionId)
  }, [])
  const stepOut = useCallback(() => {
    const sessionId = sessionIdRef.current
    if (sessionId) void window.api.debug.stepOut(sessionId)
  }, [])

  const setActiveFrameIndex = useCallback((index: number) => {
    setState((s) => ({ ...s, activeFrameIndex: index }))
  }, [])

  const getProperties = useCallback(async (objectId: string): Promise<DebugVariable[]> => {
    const sessionId = sessionIdRef.current
    if (!sessionId) return []
    return window.api.debug.getProperties(sessionId, objectId)
  }, [])

  const evaluate = useCallback(
    async (expression: string): Promise<string> => {
      const sessionId = sessionIdRef.current
      const frame = state.callFrames[state.activeFrameIndex]
      if (!sessionId || !frame) return 'Not paused'
      const result = (await window.api.debug.evaluate(sessionId, frame.callFrameId, expression)) as {
        result?: { value?: unknown; description?: string }
        exceptionDetails?: { text: string }
      }
      if (result.exceptionDetails) return `Uncaught: ${result.exceptionDetails.text}`
      const value = result.result
      if (!value) return 'undefined'
      return value.value !== undefined ? JSON.stringify(value.value) : (value.description ?? 'undefined')
    },
    [state.callFrames, state.activeFrameIndex]
  )

  const activeFrame = state.callFrames[state.activeFrameIndex]
  const pausedLocation =
    state.status === 'paused' && activeFrame ? { path: activeFrame.path, line: activeFrame.line } : null

  return {
    breakpoints,
    toggleBreakpoint,
    state,
    start,
    stop,
    continue_,
    stepOver,
    stepInto,
    stepOut,
    setActiveFrameIndex,
    getProperties,
    evaluate,
    pausedLocation
  }
}
