import * as prettier from 'prettier/standalone'
import babelPlugin from 'prettier/plugins/babel'
import estreePlugin from 'prettier/plugins/estree'
import typescriptPlugin from 'prettier/plugins/typescript'
import postcssPlugin from 'prettier/plugins/postcss'
import htmlPlugin from 'prettier/plugins/html'
import markdownPlugin from 'prettier/plugins/markdown'
import yamlPlugin from 'prettier/plugins/yaml'

// Real Prettier, running its browser/standalone build entirely in the renderer — no child
// process, no relying on a global `prettier` CLI being installed on the user's machine.
const EXT_TO_PARSER: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'babel',
  jsx: 'babel',
  mjs: 'babel',
  cjs: 'babel',
  json: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  md: 'markdown',
  markdown: 'markdown',
  yml: 'yaml',
  yaml: 'yaml'
}

const PLUGINS = [babelPlugin, estreePlugin, typescriptPlugin, postcssPlugin, htmlPlugin, markdownPlugin, yamlPlugin]

function extensionOf(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? ''
}

export function canFormat(fileName: string): boolean {
  return extensionOf(fileName) in EXT_TO_PARSER
}

// Returns the formatted text, or null if the file type isn't supported or Prettier couldn't
// parse it (e.g. the buffer currently has a syntax error mid-edit) — callers should leave the
// document untouched in that case rather than surface a hard failure.
export async function formatCode(fileName: string, content: string): Promise<string | null> {
  const parser = EXT_TO_PARSER[extensionOf(fileName)]
  if (!parser) return null
  try {
    return await prettier.format(content, { parser, plugins: PLUGINS })
  } catch {
    return null
  }
}
