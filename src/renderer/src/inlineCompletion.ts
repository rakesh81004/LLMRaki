import * as monaco from 'monaco-editor'

const MAX_CONTEXT_CHARS = 4000
const DEBOUNCE_MS = 400

// Monaco has no built-in debounce for inline completions — it (re)calls provideInlineCompletions
// on essentially every relevant keystroke, cancelling the token of any request it no longer needs.
// Waiting inside the provider and bailing out early if the token cancels first avoids firing a
// network request per keystroke while still reacting quickly once typing pauses.
function waitUnlessCancelled(ms: number, token: monaco.CancellationToken): Promise<boolean> {
  return new Promise((resolve) => {
    if (token.isCancellationRequested) {
      resolve(false)
      return
    }
    const timer = setTimeout(() => resolve(true), ms)
    token.onCancellationRequested(() => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}

monaco.languages.registerInlineCompletionsProvider(
  '*',
  {
    async provideInlineCompletions(model, position, _context, token) {
      const proceed = await waitUnlessCancelled(DEBOUNCE_MS, token)
      if (!proceed || token.isCancellationRequested) return { items: [] }

      const fullText = model.getValue()
      const offset = model.getOffsetAt(position)
      const prefix = fullText.slice(Math.max(0, offset - MAX_CONTEXT_CHARS), offset)
      const suffix = fullText.slice(offset, offset + MAX_CONTEXT_CHARS)
      if (!prefix.trim()) return { items: [] }

      const text = await window.api.inlineAi.complete({
        prefix,
        suffix,
        language: model.getLanguageId()
      })
      if (token.isCancellationRequested || !text) return { items: [] }

      return {
        items: [
          {
            insertText: text,
            range: new monaco.Range(
              position.lineNumber,
              position.column,
              position.lineNumber,
              position.column
            )
          }
        ]
      }
    },
    freeInlineCompletions() {}
  }
)
