# Skill: Deep Monaco Editor Integration

## Trigger

Anything touching the Monaco editor directly, beyond just displaying a file:
decorations, a custom theme, breadcrumbs/symbol outline, `DiffEditor`, or diagnosing
why the editor shows wrong colors, wrong diagnostics, or wrong content.

## CSS variables don't reach into Monaco — it has its own theme system

Setting `--bg-editor: #000000` in app CSS has zero effect on the actual Monaco
canvas. Monaco renders through its own `monaco.editor.defineTheme()` system,
independent of the surrounding page's CSS, and `vs-dark`'s baked-in
`editor.background` (`#1e1e1e`) wins regardless of what the app's stylesheet says.
Fix: define a real custom theme —
```ts
monaco.editor.defineTheme('llmraki-dark', {
  base: 'vs-dark', inherit: true, rules: [],
  colors: { 'editor.background': '#000000', /* ... */ }
})
monaco.editor.setTheme('llmraki-dark')
```
— and pass `theme="llmraki-dark"` to every `<Editor>`/`<DiffEditor>` instance. Both
the global `setTheme` call *and* each component's `theme` prop need updating; one
without the other leaves some editors on the old theme.

## Real symbol breadcrumbs come from the TS worker, not a hand-parsed AST

Monaco's bundled TypeScript language service worker exposes `getNavigationTree`,
which returns a real, nested outline (interfaces, functions, methods, and often
anonymous callbacks) for the current file — this is what a breadcrumb bar's symbol
trail should be built from, not a hand-rolled regex/AST walk:
```ts
const workerGetter = await monaco.languages.typescript.getTypeScriptWorker() // or getJavaScriptWorker for .js/.jsx
const client = await workerGetter(model.uri)
const tree = await client.getNavigationTree(model.uri.toString())
```
Walk `tree.childItems`, matching each item's `spans` against the cursor's character
offset (`model.getOffsetAt(position)`), descending into `childItems` at each match to
build the breadcrumb trail. The label fidelity for anonymous functions (e.g. exactly
how a callback passed to `.map()` gets named) is whatever the TS navigation bar
generator produces — don't try to out-guess it with custom naming heuristics.

## Decorations: two different mechanisms for two different jobs

- **Injected text** (`options.after: { content, inlineClassName, cursorStops }`) —
  for a single fixed annotation at one position, like inline git-blame text at the
  end of the current line. Set `cursorStops: monaco.editor.InjectedTextCursorStops.None`
  so it doesn't interfere with normal cursor navigation.
- **Gutter/overview-ruler decorations** (`linesDecorationsClassName`,
  `overviewRuler: { color, position }`) — for per-line markers spanning a range,
  like a hand-rolled diff gutter. Prefer `DiffEditor` over this when a full diff
  view is the actual goal (see `GIT_FEATURE_BUILDING_SKILL.md`); reach for manual
  decorations only for single-purpose annotations `DiffEditor` can't express.

Both are updated via `editorInstance.deltaDecorations(oldIds, newDecorations)`,
which returns new ids to pass in next time — keep those ids in a ref, and reset the
ref to `[]` whenever the underlying file/tab changes (stale ids from a disposed
editor instance are harmless to pass in, but resetting avoids confusion).

## An anonymous in-memory model breaks language-service accuracy

If an `<Editor>`/`<DiffEditor>` isn't given an explicit `path`/`modelPath` matching
the real file's extension, Monaco creates an anonymous model, and the TypeScript
worker can misjudge the file's nature — producing real-looking but spurious
diagnostic squiggles on code that a properly-resolved project (real VS Code) shows
no errors for. Always pass a path. When two models need to coexist for the same
logical file (e.g. a diff's "original" and "modified" sides), give them distinct
URIs via a scheme prefix rather than a suffix, so the real extension stays at the
end of the *modified* side's URI: `diff-baseline://<realPath>` not `<realPath>~base`.

## A decoration with a collapsed (zero-width) range is silently skipped

Any decoration whose range starts and ends at the same position (e.g.
`new monaco.Range(line, col, line, col)` — the standard shape for a single-point
annotation like inline blame text or a glyph-margin dot) is treated as "collapsed,"
and Monaco's renderer drops it entirely **unless** `options.showIfCollapsed: true`
is set. The call still succeeds and returns a normal-looking decoration id — there
is no error, no warning, nothing to grep for. This produced a real bug (inline git
blame text never appearing) that took extensive live inspection to trace, because
every layer *looked* correct: the IPC data was right, `deltaDecorations` was
called, the id came back valid. Whenever a decoration exists (confirmed via
`model.getLineDecorations(line)`) but never paints, check this first.

## A decoration change from outside Monaco's own event loop may need a forced render

`deltaDecorations` genuinely registering a decoration on the model doesn't
guarantee Monaco schedules a repaint for it, if the change was triggered by
something Monaco didn't itself observe (a React state update reacting to an IPC
event, not a keystroke or scroll it was already tracking). If a decoration exists
on the model with the right options and still doesn't render even with
`showIfCollapsed: true` set, call `editorInstance.render(true)` immediately after
the `deltaDecorations` call — these two issues can present identically from the
outside (decoration registered, options correct, nothing on screen) but come from
unrelated root causes; verifying the model state first via `getLineDecorations` is
what tells you which fix actually applies. See
`REAL_DEBUGGER_IMPLEMENTATION_SKILL.md` for the full incident this was found in.

## Disabling semantic validation without a real project context

Without a real `tsconfig`/`node_modules` to resolve against, every import and JSX
tag will otherwise show false-positive errors. Disable via
`typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSuggestionDiagnostics: true })`
(and the same for `javascriptDefaults`) — this suppresses type-resolution errors
while still keeping real syntax error detection. If spurious errors still appear
despite this being set, suspect the anonymous-model issue above before suspecting
the diagnostics options themselves.
