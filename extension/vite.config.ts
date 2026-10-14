import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const outDir = resolve(__dirname, '../dist-extension')
const automationsDir = resolve(__dirname, '../automations')

// Stamps each build with an id, in both the manifest (which Chrome only re-reads on a reload) and
// build.json (which the panel reads fresh from disk). When they differ, the panel knows Chrome is
// still running an older build and restarts the extension so the new one takes effect.
function buildStamp(): Plugin {
  return {
    name: 'llmraki-build-stamp',
    apply: 'build',
    closeBundle() {
      const build = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
      const manifestPath = resolve(outDir, 'manifest.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      manifest.version_name = `${manifest.version} (build ${build})`
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
      writeFileSync(resolve(outDir, 'build.json'), JSON.stringify({ build }) + '\n')
    }
  }
}

// Reads the small header at the top of an AUTOMATION.md: `key: value` lines and a `media:` list.
function parseHeader(text: string): { header: Record<string, string>; media: string[] } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const header: Record<string, string> = {}
  const media: string[] = []
  if (!match) return { header, media }
  let inMedia = false
  for (const line of match[1].split(/\r?\n/)) {
    const item = line.match(/^\s+-\s+(.+)$/)
    if (inMedia && item) {
      media.push(item[1].trim().replace(/^["']|["']$/g, ''))
      continue
    }
    const pair = line.match(/^([A-Za-z_]+):\s*(.*)$/)
    if (!pair) continue
    inMedia = pair[1] === 'media'
    if (!inMedia) header[pair[1]] = pair[2].trim().replace(/^["']|["']$/g, '')
  }
  return { header, media }
}

// Bundles every automations/<name>/ folder (AUTOMATION.md + its media files) into the extension and
// writes automations/index.json, which the panel reads to list and run them.
function bundleAutomations(): Plugin {
  return {
    name: 'llmraki-automations',
    apply: 'build',
    closeBundle() {
      const index: unknown[] = []
      if (existsSync(automationsDir)) {
        for (const folder of readdirSync(automationsDir)) {
          const source = resolve(automationsDir, folder)
          const mdPath = resolve(source, 'AUTOMATION.md')
          if (!statSync(source).isDirectory() || !existsSync(mdPath)) continue
          const text = readFileSync(mdPath, 'utf8')
          const { header, media } = parseHeader(text)
          const target = resolve(outDir, 'automations', folder)
          mkdirSync(target, { recursive: true })
          copyFileSync(mdPath, resolve(target, 'AUTOMATION.md'))
          const bundledMedia: { name: string; path: string }[] = []
          for (const rel of media) {
            const from = resolve(source, rel)
            if (!existsSync(from)) {
              this.warn(`automation "${folder}": media file not found: ${rel}`)
              continue
            }
            const to = resolve(target, rel)
            mkdirSync(dirname(to), { recursive: true })
            copyFileSync(from, to)
            bundledMedia.push({ name: rel.split('/').pop() ?? rel, path: `automations/${folder}/${rel}` })
          }
          index.push({
            name: header.name || folder,
            title: header.title || header.name || folder,
            trigger: header.trigger || '',
            mode: ['ask', 'edit', 'auto'].includes(header.mode) ? header.mode : 'auto',
            description: header.description || '',
            // e.g. "autoApprove: linkedin.com, naukri.com"
            autoApprove: (header.autoApprove || '').split(',').map((s) => s.trim()).filter(Boolean),
            instructions: `automations/${folder}/AUTOMATION.md`,
            media: bundledMedia
          })
        }
      }
      mkdirSync(resolve(outDir, 'automations'), { recursive: true })
      writeFileSync(resolve(outDir, 'automations', 'index.json'), JSON.stringify(index, null, 2) + '\n')
    }
  }
}

// The browser extension is a separate bundle from the Electron app: it shares the repo's
// React/Vite toolchain but builds to its own folder, which is what gets loaded into Chrome.
export default defineConfig({
  root: __dirname,
  base: './',
  publicDir: resolve(__dirname, 'public'),
  plugins: [react(), buildStamp(), bundleAutomations()],
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'sidepanel.html')
    }
  }
})
