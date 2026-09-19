import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  }
}

loader.config({ monaco })

monaco.editor.defineTheme('llmraki-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#000000',
    'editorGutter.background': '#000000',
    'minimap.background': '#000000',
    'editor.lineHighlightBackground': '#0a0a0a',
    'editorWidget.background': '#0a0a0a',
    'editorHoverWidget.background': '#0a0a0a',
    'editorSuggestWidget.background': '#0a0a0a'
  }
})

monaco.editor.setTheme('llmraki-dark')

// No real TS project context here (no node_modules/tsconfig resolution), so disable semantic validation — otherwise every import and JSX tag shows false-positive errors.
const tsCompilerOptions = {
  jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
  target: monaco.languages.typescript.ScriptTarget.ESNext,
  module: monaco.languages.typescript.ModuleKind.ESNext,
  moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
  allowNonTsExtensions: true,
  allowJs: true,
  esModuleInterop: true,
  skipLibCheck: true,
  noEmit: true
}
monaco.languages.typescript.typescriptDefaults.setCompilerOptions(tsCompilerOptions)
monaco.languages.typescript.javascriptDefaults.setCompilerOptions(tsCompilerOptions)

const diagnosticsOptions = {
  noSemanticValidation: true,
  noSuggestionDiagnostics: true
}
monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(diagnosticsOptions)
monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(diagnosticsOptions)
