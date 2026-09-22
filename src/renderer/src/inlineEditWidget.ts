import type { editor } from 'monaco-editor'

interface InlineEditWidgetOptions {
  anchorLine: number
  onSubmit: (instruction: string) => Promise<void>
}

// Only one instruction box per editor at a time — pressing Cmd+K again while one is already open
// (e.g. an accidental double-press) closes the stale one instead of stacking a second on top.
const activeWidgetCloseByEditor = new WeakMap<editor.IStandaloneCodeEditor, () => void>()

// A floating instruction box for editing code in place, implemented as a real Monaco content
// widget so it scrolls and repositions with the editor instead of living in some
// absolutely-positioned div that drifts out of sync.
export function openInlineEditWidget(
  editorInstance: editor.IStandaloneCodeEditor,
  monaco: typeof import('monaco-editor'),
  options: InlineEditWidgetOptions
): void {
  activeWidgetCloseByEditor.get(editorInstance)?.()

  const domNode = document.createElement('div')
  domNode.className = 'inline-ai-edit-widget'

  const input = document.createElement('input')
  input.type = 'text'
  input.placeholder = 'Ask AI to edit this code…'
  input.className = 'inline-ai-edit-input'

  const status = document.createElement('div')
  status.className = 'inline-ai-edit-status'
  status.textContent = 'Enter to submit · Esc to cancel'

  domNode.appendChild(input)
  domNode.appendChild(status)

  const widgetId = `inline-ai-edit-widget-${Date.now()}`
  let disposed = false

  const widget: editor.IContentWidget = {
    getId: () => widgetId,
    getDomNode: () => domNode,
    getPosition: () => ({
      position: { lineNumber: options.anchorLine, column: 1 },
      preference: [
        monaco.editor.ContentWidgetPositionPreference.ABOVE,
        monaco.editor.ContentWidgetPositionPreference.BELOW
      ]
    }),
    // Without this, Monaco clips a content widget to the editor's own viewport — and a widget
    // anchored to line 1 has nowhere to go for its ABOVE placement, since there's no line above
    // line 1. allowEditorOverflow renders it in Monaco's overflow-guard layer instead, which can
    // extend past the editor's bounds and remains genuinely visible (and therefore focusable).
    allowEditorOverflow: true
  }

  function remove(): void {
    if (disposed) return
    disposed = true
    document.removeEventListener('keydown', handleKey, true)
    editorInstance.removeContentWidget(widget)
    editorInstance.focus()
    if (activeWidgetCloseByEditor.get(editorInstance) === remove) {
      activeWidgetCloseByEditor.delete(editorInstance)
    }
  }
  activeWidgetCloseByEditor.set(editorInstance, remove)

  // Monaco treats focus inside any of its own content widgets as still "belonging" to the
  // editor for keybinding purposes, so its own capture-phase handler (bound above wherever this
  // widget sits in the DOM) claims Enter/Escape before a plain `input.addEventListener('keydown',
  // ...)` on our own element would ever see them — those two keys never reached it in testing,
  // even though ordinary character keys did. Listening on `document` in the capture phase runs
  // ahead of that interception instead of behind it.
  function handleKey(e: KeyboardEvent): void {
    if (document.activeElement !== input) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      remove()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      const instruction = input.value.trim()
      if (!instruction || input.disabled) return
      input.disabled = true
      status.textContent = 'Generating…'
      domNode.classList.add('generating')
      options
        .onSubmit(instruction)
        .then(() => {
          if (!disposed) remove()
        })
        .catch((err) => {
          if (disposed) return
          input.disabled = false
          domNode.classList.remove('generating')
          status.textContent = err instanceof Error ? err.message : 'AI edit failed.'
          status.classList.add('error')
        })
    }
  }
  document.addEventListener('keydown', handleKey, true)

  editorInstance.addContentWidget(widget)
  // addContentWidget() only schedules the DOM insertion — the node isn't attached to the document
  // yet on this tick, so focus() here would silently no-op. Worse, Monaco appears to reassert
  // focus on its own textarea itself once or twice more right after a command runs (observed via
  // testing: a single deferred focus() call landed inconsistently), so rather than race a single
  // rAF against however many times Monaco reclaims it, keep reclaiming focus for the widget's
  // first moment on screen and stop once it's had a real chance to settle.
  let focusAttempts = 0
  function tryFocus(): void {
    if (disposed) return
    input.focus()
    focusAttempts += 1
    if (document.activeElement !== input && focusAttempts < 10) {
      requestAnimationFrame(tryFocus)
    }
  }
  requestAnimationFrame(tryFocus)
}
