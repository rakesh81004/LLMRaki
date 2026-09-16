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

// Point @monaco-editor/react at the locally bundled monaco-editor package
// instead of its default behaviour of fetching from a CDN (which our CSP blocks).
loader.config({ monaco })

// Force the theme's token-color CSS to be registered immediately, so
// monaco.editor.colorize() (used to syntax-highlight code blocks in AI chat
// responses) renders correctly even before any real editor tab is opened.
monaco.editor.setTheme('vs-dark')

// LLMRaki has no real project context for TS/JS files — no node_modules, no
// tsconfig.json resolution, no path aliases. Left at Monaco's defaults, the
// TypeScript language service treats every unresolved import and every JSX
// tag (JSX isn't parseable without an explicit `jsx` compiler option) as an
// error, which floods any real-world file with false-positive red squiggles
// that don't reflect an actual problem in the code. Configure `jsx` so JSX
// itself parses correctly (keeping real syntax errors like mismatched
// brackets meaningful), and disable semantic validation entirely, since
// "cannot find module" for every import is not a genuine diagnostic here.
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
