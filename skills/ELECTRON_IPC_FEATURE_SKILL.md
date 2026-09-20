# Skill: Adding a New Main-Process Capability (IPC Feature)

## Trigger

Any time the renderer needs something only the main process can do — filesystem
access beyond what's exposed, running a git/shell command, watching for external
changes, reading a native API. If the task requires new capability, not just new UI
on top of existing `window.api.*` calls, this is the skill.

## The four-layer pattern this codebase always follows

Every capability crosses exactly four layers, in this order:

1. **Main process handler** (`src/main/ipc/<domain>.ts`) — a function like
   `registerXHandlers()` called once from `src/main/index.ts`, registering one or
   more `ipcMain.handle('domain:action', async (_e, ...args) => { ... })` calls.
   Keep the domain files focused (`git.ts`, `fs.ts`, `chatHistory.ts`,
   `fsWatch.ts` — one concern per file).
2. **Preload bridge** (`src/preload/index.ts`) — a matching method inside the
   relevant namespace object (`git: { ... }`, `fs: { ... }`) that calls
   `ipcRenderer.invoke('domain:action', ...)`. This is the *only* place
   `ipcRenderer` should be touched from — the renderer never imports Electron
   directly.
3. **Renderer type mirror** (`src/renderer/src/types.ts`) — this project
   duplicates result-shape interfaces between `preload/index.ts` and
   `renderer/src/types.ts` rather than sharing an import between them. Follow the
   existing convention: define the interface in both places with the same shape.
4. **Consumer** — the component or App-level state that actually calls
   `window.api.domain.action(...)`.

Missing any one layer is the most common way a "it doesn't do anything" bug happens
— e.g. wiring the main handler and preload bridge but forgetting to actually call
the new method from the component, or adding it to preload's runtime object but
forgetting the exported TypeScript interface (compiles, but the type is wrong).

## Push events from main to renderer (not just request/response)

For anything that happens asynchronously from the main process's own initiative
(a background command finishing, a filesystem watcher firing), don't poll — push:

```ts
// main process, whenever the event happens:
for (const win of BrowserWindow.getAllWindows()) {
  win.webContents.send('domain:eventName', payload)
}
```
```ts
// preload:
onEventName: (cb: (payload: T) => void) => {
  const listener = (_e: Electron.IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on('domain:eventName', listener)
  return () => ipcRenderer.removeListener('domain:eventName', listener)
}
```

The returned unsubscribe function has a TypeScript trap: `ipcRenderer.removeListener`
returns `IpcRenderer` (not `void`), so `return () => off()` fails to typecheck as a
`useEffect` cleanup (`Destructor` must return void). Wrap it in a block body:
`return () => { off() }`.

## Watching for external changes without polling

Node's `fs.watch(dir, { recursive: true })` works natively on macOS (FSEvents-backed)
with **no extra dependency** — this app is macOS-only, so this is the right tool
over pulling in `chokidar`. Debounce the callback (a few hundred ms) before firing
the renderer event; a single file save can trigger a burst of raw fs events. Filter
out noisy directories (`node_modules`, `.git`, `dist`, `build`, etc.) before even
debouncing, both for signal quality and to avoid needless work.

## `git show <ref>` for content, not just diffs

`git show <hash>` alone prints a *commit's diff* (like `git log -p` for one commit).
To get a specific **file's raw content at a ref** — the actual blob, for feeding
into a diff tool or an editor — use `git show <ref>:<path>` (note the colon), e.g.
`git show HEAD:src/foo.ts` or `git show :src/foo.ts` (no ref before the colon = the
index/staged version). These are different git operations; reach for the right one
rather than parsing a unified diff back into raw content.

## Verification

After wiring a new capability end to end, this is still just "new code" until it's
been through the full rebuild/reinstall/relaunch cycle — see
`VERIFICATION_WORKFLOW_SKILL.md`. Typecheck alone will not catch a forgotten
`registerXHandlers()` call in `main/index.ts` (the handler compiles fine standalone;
it just silently never gets registered).
