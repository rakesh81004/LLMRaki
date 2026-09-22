import * as monaco from 'monaco-editor'

// Monaco has no built-in concept of "switch to a different open file" — by its own
// documentation, "Go to Definition" targeting a resource other than the currently attached model
// does nothing unless a handler is registered here. This is that handler; it's set once by
// App.tsx (which has access to the tab-opening logic) and reused for the lifetime of the app.
type OpenHandler = (absolutePath: string, line: number, column: number) => void

let currentHandler: OpenHandler | null = null

export function setDefinitionOpenHandler(handler: OpenHandler | null): void {
  currentHandler = handler
}

function isPosition(v: monaco.IRange | monaco.IPosition): v is monaco.IPosition {
  return typeof (v as monaco.IPosition).lineNumber === 'number'
}

monaco.editor.registerEditorOpener({
  openCodeEditor(_source, resource, selectionOrPosition) {
    if (!currentHandler || resource.scheme !== 'file') return false
    let line = 1
    let column = 1
    if (selectionOrPosition) {
      if (isPosition(selectionOrPosition)) {
        line = selectionOrPosition.lineNumber
        column = selectionOrPosition.column
      } else {
        line = selectionOrPosition.startLineNumber
        column = selectionOrPosition.startColumn
      }
    }
    currentHandler(resource.fsPath, line, column)
    return true
  }
})
