// Filenames matched exactly (case-insensitive) before falling back to extension —
// covers well-known files that have no useful extension of their own.
const SPECIAL_FILES: Record<string, { label: string; color: string }> = {
  dockerfile: { label: 'DK', color: '#0db7ed' },
  makefile: { label: 'MK', color: '#8a8a8a' },
  license: { label: 'LIC', color: '#cbcb41' },
  'license.md': { label: 'LIC', color: '#cbcb41' },
  '.gitignore': { label: 'GIT', color: '#f14e32' },
  '.gitattributes': { label: 'GIT', color: '#f14e32' },
  '.env': { label: 'ENV', color: '#8dd6f9' },
  '.npmrc': { label: 'NPM', color: '#cb3837' },
  '.prettierrc': { label: 'PR', color: '#c596c7' },
  '.eslintrc': { label: 'ES', color: '#4b32c3' },
  'package.json': { label: '{}', color: '#cb3837' },
  'package-lock.json': { label: '{}', color: '#cb3837' }
}

const TYPES: Record<string, { label: string; color: string }> = {
  ts: { label: 'TS', color: '#3178c6' },
  tsx: { label: 'TS', color: '#3178c6' },
  js: { label: 'JS', color: '#f0db4f' },
  jsx: { label: 'JS', color: '#f0db4f' },
  mjs: { label: 'JS', color: '#f0db4f' },
  cjs: { label: 'JS', color: '#f0db4f' },
  json: { label: '{}', color: '#f0a020' },
  jsonc: { label: '{}', color: '#f0a020' },
  css: { label: '#', color: '#42a5f5' },
  scss: { label: '#', color: '#c66494' },
  less: { label: '#', color: '#1d365d' },
  html: { label: '<>', color: '#e34c26' },
  xml: { label: '<>', color: '#e34c26' },
  md: { label: 'M↓', color: '#8a8a8a' },
  mdx: { label: 'M↓', color: '#8a8a8a' },
  py: { label: 'PY', color: '#3572a5' },
  rb: { label: 'RB', color: '#cc342d' },
  go: { label: 'GO', color: '#00add8' },
  rs: { label: 'RS', color: '#dea584' },
  java: { label: 'J', color: '#b07219' },
  kt: { label: 'KT', color: '#a97bff' },
  swift: { label: 'SW', color: '#f05138' },
  c: { label: 'C', color: '#a8b9cc' },
  h: { label: 'C', color: '#a8b9cc' },
  cpp: { label: 'C++', color: '#f34b7d' },
  hpp: { label: 'C++', color: '#f34b7d' },
  cs: { label: 'C#', color: '#178600' },
  sh: { label: 'SH', color: '#89e051' },
  bash: { label: 'SH', color: '#89e051' },
  zsh: { label: 'SH', color: '#89e051' },
  yml: { label: 'Y', color: '#cb171e' },
  yaml: { label: 'Y', color: '#cb171e' },
  toml: { label: 'TML', color: '#9c4221' },
  ini: { label: 'INI', color: '#8a8a8a' },
  conf: { label: 'CFG', color: '#8a8a8a' },
  env: { label: 'ENV', color: '#8dd6f9' },
  lock: { label: 'LCK', color: '#8a8a8a' },
  vue: { label: 'V', color: '#41b883' },
  svelte: { label: 'SV', color: '#ff3e00' },
  astro: { label: 'AS', color: '#ff5a03' },
  graphql: { label: 'GQL', color: '#e535ab' },
  gql: { label: 'GQL', color: '#e535ab' },
  sql: { label: 'SQL', color: '#dad8d8' },
  dart: { label: 'DA', color: '#00b4ab' },
  lua: { label: 'LUA', color: '#000080' },
  php: { label: 'PHP', color: '#787cb5' },
  svg: { label: '◇', color: '#ffb13b' },
  png: { label: '▨', color: '#8a8a8a' },
  jpg: { label: '▨', color: '#8a8a8a' },
  jpeg: { label: '▨', color: '#8a8a8a' },
  gif: { label: '▨', color: '#8a8a8a' },
  ico: { label: '▨', color: '#8a8a8a' },
  webp: { label: '▨', color: '#8a8a8a' },
  txt: { label: 'TXT', color: '#8a8a8a' },
  log: { label: 'LOG', color: '#8a8a8a' },
  gitignore: { label: 'GIT', color: '#f14e32' },
  tsbuildinfo: { label: 'BI', color: '#8a8a8a' }
}

const DEFAULT = { label: '•', color: '#8a8a8a' }

interface Props {
  fileName: string
}

export default function FileTypeBadge({ fileName }: Props): JSX.Element {
  const lowerName = fileName.toLowerCase()
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  const { label, color } = SPECIAL_FILES[lowerName] ?? TYPES[ext] ?? DEFAULT
  return (
    <span
      className="file-type-badge"
      style={{ color, borderColor: `${color}55`, background: `${color}1a` }}
    >
      {label}
    </span>
  )
}
