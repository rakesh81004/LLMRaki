// Chrome keeps running an unpacked extension's old manifest and background script until it is
// reloaded, even after the files on disk are rebuilt. Each build stamps an id into both the
// manifest (as loaded by Chrome) and build.json (read fresh from disk), so the panel can tell
// when a newer build is waiting and restart the extension to pick it up.

function loadedBuild(): string | null {
  const name = chrome.runtime.getManifest().version_name ?? ''
  return name.match(/\(build (.+)\)/)?.[1] ?? null
}

export async function builtOnDisk(): Promise<string | null> {
  try {
    const response = await fetch(chrome.runtime.getURL('build.json'), { cache: 'no-store' })
    if (!response.ok) return null
    return ((await response.json()) as { build?: string }).build ?? null
  } catch {
    return null
  }
}

export async function updateWaiting(): Promise<boolean> {
  const disk = await builtOnDisk()
  return !!disk && disk !== loadedBuild()
}

export function restartExtension(): void {
  chrome.runtime.reload()
}

export function versionLabel(): string {
  const manifest = chrome.runtime.getManifest()
  const build = loadedBuild()
  return build ? `LLMRaki ${manifest.version} · built ${new Date(build).toLocaleString()}` : `LLMRaki ${manifest.version}`
}
