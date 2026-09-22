import * as monaco from 'monaco-editor'
import { languageForFile } from './utils/language'

// Gives Monaco's bundled TypeScript language service real project awareness — without this,
// every file is checked in isolation against the default lib only, so autocomplete for an
// imported symbol from another project file, or from a dependency in node_modules, never
// resolves. This loads (1) the project's own tsconfig.json compiler options, (2) every project
// source file as a background Monaco model so the TS "program" spans the whole project instead
// of just whichever file happens to be open, and (3) each direct dependency's own .d.ts as an
// extra lib, so `import { x } from 'some-package'` actually autocompletes.

const SOURCE_EXTENSIONS = new Set(['ts', 'tsx', 'js', 'jsx'])
const MAX_PROJECT_FILES = 400
const MAX_FILE_BYTES = 200 * 1024
const MAX_DEPENDENCIES = 60
const READ_BATCH_SIZE = 20

const { ScriptTarget, ModuleKind, JsxEmit, ModuleResolutionKind } = monaco.languages.typescript

const TARGET_MAP: Record<string, number> = {
  es3: ScriptTarget.ES3,
  es5: ScriptTarget.ES5,
  es6: ScriptTarget.ES2015,
  es2015: ScriptTarget.ES2015,
  es2016: ScriptTarget.ES2016,
  es2017: ScriptTarget.ES2017,
  es2018: ScriptTarget.ES2018,
  es2019: ScriptTarget.ES2019,
  es2020: ScriptTarget.ES2020,
  esnext: ScriptTarget.ESNext,
  latest: ScriptTarget.Latest
}
const MODULE_MAP: Record<string, number> = {
  none: ModuleKind.None,
  commonjs: ModuleKind.CommonJS,
  amd: ModuleKind.AMD,
  umd: ModuleKind.UMD,
  system: ModuleKind.System,
  es6: ModuleKind.ES2015,
  es2015: ModuleKind.ES2015,
  esnext: ModuleKind.ESNext
}
const JSX_MAP: Record<string, number> = {
  preserve: JsxEmit.Preserve,
  react: JsxEmit.React,
  'react-native': JsxEmit.ReactNative,
  'react-jsx': JsxEmit.ReactJSX,
  'react-jsxdev': JsxEmit.ReactJSXDev
}
const MODULE_RESOLUTION_MAP: Record<string, number> = {
  node: ModuleResolutionKind.NodeJs,
  node10: ModuleResolutionKind.NodeJs,
  classic: ModuleResolutionKind.Classic
}

const DEFAULT_COMPILER_OPTIONS: monaco.languages.typescript.CompilerOptions = {
  target: ScriptTarget.ESNext,
  module: ModuleKind.ESNext,
  moduleResolution: ModuleResolutionKind.NodeJs,
  jsx: JsxEmit.ReactJSX,
  allowNonTsExtensions: true,
  allowJs: true,
  esModuleInterop: true,
  skipLibCheck: true,
  resolveJsonModule: true,
  noEmit: true
}

// Strips `//` and `/* */` comments and trailing commas — tsconfig.json is JSONC, not strict
// JSON, and a real project's config almost always has at least one comment in it.
function parseJsonc(raw: string): Record<string, unknown> {
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/,(\s*[}\]])/g, '$1')
  return JSON.parse(stripped)
}

function mapCompilerOptions(raw: Record<string, unknown>): monaco.languages.typescript.CompilerOptions {
  const opts: monaco.languages.typescript.CompilerOptions = { ...DEFAULT_COMPILER_OPTIONS }
  if (typeof raw.target === 'string') opts.target = TARGET_MAP[raw.target.toLowerCase()] ?? opts.target
  if (typeof raw.module === 'string') opts.module = MODULE_MAP[raw.module.toLowerCase()] ?? opts.module
  if (typeof raw.jsx === 'string') opts.jsx = JSX_MAP[raw.jsx.toLowerCase()] ?? opts.jsx
  if (typeof raw.moduleResolution === 'string') {
    opts.moduleResolution = MODULE_RESOLUTION_MAP[raw.moduleResolution.toLowerCase()] ?? ModuleResolutionKind.NodeJs
  }
  if (typeof raw.baseUrl === 'string') opts.baseUrl = raw.baseUrl
  if (raw.paths && typeof raw.paths === 'object') {
    opts.paths = raw.paths as monaco.languages.typescript.CompilerOptions['paths']
  }
  for (const key of [
    'allowJs',
    'checkJs',
    'esModuleInterop',
    'allowSyntheticDefaultImports',
    'strict',
    'resolveJsonModule',
    'experimentalDecorators',
    'emitDecoratorMetadata',
    'downlevelIteration',
    'useDefineForClassFields',
    'isolatedModules'
  ] as const) {
    if (typeof raw[key] === 'boolean') (opts as Record<string, unknown>)[key] = raw[key]
  }
  opts.allowNonTsExtensions = true
  opts.skipLibCheck = true
  opts.noEmit = true
  return opts
}

async function applyTsConfig(rootFolder: string): Promise<void> {
  let raw: string
  try {
    raw = await window.api.fs.readFile(`${rootFolder}/tsconfig.json`)
  } catch {
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions(DEFAULT_COMPILER_OPTIONS)
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions(DEFAULT_COMPILER_OPTIONS)
    return
  }
  let json: Record<string, unknown>
  try {
    json = parseJsonc(raw)
  } catch {
    return
  }
  const compilerOptions = mapCompilerOptions((json.compilerOptions as Record<string, unknown>) ?? {})
  if (typeof compilerOptions.baseUrl === 'string') {
    compilerOptions.baseUrl = `${rootFolder}/${compilerOptions.baseUrl}`.replace(/\/\.\//, '/')
  }
  monaco.languages.typescript.typescriptDefaults.setCompilerOptions(compilerOptions)
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions(compilerOptions)
}

async function loadSourceFiles(rootFolder: string, token: number, currentTokenRef: { current: number }): Promise<void> {
  let files: string[]
  try {
    files = await window.api.search.listFiles(rootFolder)
  } catch {
    return
  }
  const sourceFiles = files
    .filter((f) => SOURCE_EXTENSIONS.has(f.split('.').pop()?.toLowerCase() ?? ''))
    .slice(0, MAX_PROJECT_FILES)

  for (let i = 0; i < sourceFiles.length; i += READ_BATCH_SIZE) {
    if (token !== currentTokenRef.current) return
    const batch = sourceFiles.slice(i, i + READ_BATCH_SIZE)
    await Promise.all(
      batch.map(async (filePath) => {
        const uri = monaco.Uri.file(filePath)
        if (monaco.editor.getModel(uri)) return
        let content: string
        try {
          content = await window.api.fs.readFile(filePath)
        } catch {
          return
        }
        if (content.length > MAX_FILE_BYTES) return
        if (token !== currentTokenRef.current) return
        if (monaco.editor.getModel(uri)) return
        try {
          monaco.editor.createModel(content, languageForFile(filePath), uri)
        } catch {
          // a real editor tab may have created it in the meantime — fine either way
        }
      })
    )
  }
}

async function resolveDependencyDts(rootFolder: string, dep: string): Promise<string | null> {
  try {
    const pkgRaw = await window.api.fs.readFile(`${rootFolder}/node_modules/${dep}/package.json`)
    const pkgJson = JSON.parse(pkgRaw) as { types?: string; typings?: string }
    const typesField = pkgJson.types ?? pkgJson.typings
    if (typesField) {
      return `${rootFolder}/node_modules/${dep}/${typesField}`.replace(/\/\.\//, '/')
    }
  } catch {
    // fall through to @types
  }
  try {
    const scoped = dep.startsWith('@') ? dep.slice(1).replace('/', '__') : dep
    const path = `${rootFolder}/node_modules/@types/${scoped}/index.d.ts`
    await window.api.fs.readFile(path)
    return path
  } catch {
    return null
  }
}

async function loadDependencyTypes(rootFolder: string, token: number, currentTokenRef: { current: number }): Promise<void> {
  let pkgRaw: string
  try {
    pkgRaw = await window.api.fs.readFile(`${rootFolder}/package.json`)
  } catch {
    return
  }
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
  try {
    pkg = JSON.parse(pkgRaw)
  } catch {
    return
  }
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).slice(0, MAX_DEPENDENCIES)

  await Promise.all(
    deps.map(async (dep) => {
      const dtsPath = await resolveDependencyDts(rootFolder, dep)
      if (!dtsPath || token !== currentTokenRef.current) return
      let content: string
      try {
        content = await window.api.fs.readFile(dtsPath)
      } catch {
        return
      }
      if (content.length > MAX_FILE_BYTES * 2 || token !== currentTokenRef.current) return
      const libUri = `file:///node_modules/${dep}/index.d.ts`
      monaco.languages.typescript.typescriptDefaults.addExtraLib(content, libUri)
      monaco.languages.typescript.javascriptDefaults.addExtraLib(content, libUri)
    })
  )
}

let loadToken = 0
const tokenRef = { current: 0 }

// Called whenever the open project folder changes. Deliberately does not dispose previously
// loaded models/extra libs — tabs from a prior project can still be open (folder switches don't
// close them), and disposing their backing models out from under a live editor would break them.
// The small amount of extra memory this leaves behind across project switches within one long
// session is an acceptable trade for never breaking an already-open tab.
export async function loadProjectContext(rootFolder: string | null): Promise<void> {
  loadToken += 1
  tokenRef.current = loadToken
  const token = loadToken
  if (!rootFolder) return
  await Promise.all([
    applyTsConfig(rootFolder),
    loadSourceFiles(rootFolder, token, tokenRef),
    loadDependencyTypes(rootFolder, token, tokenRef)
  ])
}
