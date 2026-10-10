import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const outDir = resolve(__dirname, '../dist-extension')

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

// The browser extension is a separate bundle from the Electron app: it shares the repo's
// React/Vite toolchain but builds to its own folder, which is what gets loaded into Chrome.
export default defineConfig({
  root: __dirname,
  base: './',
  publicDir: resolve(__dirname, 'public'),
  plugins: [react(), buildStamp()],
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'sidepanel.html')
    }
  }
})
