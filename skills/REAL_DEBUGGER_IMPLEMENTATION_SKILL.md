# Skill: Real Breakpoint Debugging via the V8 Inspector Protocol

## Trigger

Adding or touching genuine step-through debugging (breakpoints, call stack,
variable inspection, stepping) for JavaScript/Node code — as opposed to a "Run"
feature that just shells out to `node file.js`. Also relevant if extending
debugging to another runtime later (Python via `debugpy`, etc.) — the surrounding
IPC/UI architecture here transfers even though the wire protocol wouldn't.

## Talk to V8's inspector directly — no Debug Adapter Protocol needed for Node

Node's own debugging protocol is a subset of the Chrome DevTools Protocol (the same
protocol family used for `CDP_LIVE_TESTING_SKILL.md`), exposed over a plain
WebSocket. There's no need to implement or bundle a separate Debug Adapter Protocol
translation layer for Node — spawn the target with `--inspect-brk=0` (port 0 picks
a free port), parse the WebSocket URL Node prints to stderr
(`Debugger listening on (ws://\S+)`), and speak `Runtime`/`Debugger` domain
JSON-RPC directly:
```
node --inspect-brk=0 entry.js
```
Then: `Runtime.enable`, `Debugger.enable`, `Debugger.setBreakpointByUrl({url: 'file://' + absPath, lineNumber: line - 1})`
(0-indexed), `Runtime.runIfWaitingForDebugger`, and listen for `Debugger.paused`
events to get the real call stack.

## `--inspect-brk`'s initial halt is a *second*, separate pause — resume past it explicitly

`--inspect-brk` always halts on the very first statement of the entry script,
before any user breakpoint could possibly be hit, so a debugger can attach and set
breakpoints before anything runs. This is **not** just "waiting for
`Runtime.runIfWaitingForDebugger`" — V8 reports it as a genuine `Debugger.paused`
event, with `reason: "Break on start"`. If you naively treat every `Debugger.paused`
as "stopped at a real breakpoint," the very first thing the user sees is the
debugger paused on line 1, having done nothing — call `Debugger.resume` immediately
when `reason === "Break on start"` and never surface it to the UI; only pauses
after that point reflect an actual user breakpoint or exception.

## Building a real call stack and variable tree from the raw protocol

- Track `Debugger.scriptParsed` events (`scriptId` → `url`) so a `Debugger.paused`
  event's `callFrames[].location.scriptId` can be turned back into a real file
  path (`fileUrlToPath`, stripping the `file://` prefix).
- Each call frame's `scopeChain` gives you `{type, name, object: {objectId}}` per
  scope (local, closure, etc. — filter out `global`, nobody wants to browse
  Node's global object). Fetch a scope's variables lazily, only when the user
  expands it, via `Runtime.getProperties({objectId, ownProperties: true})` — don't
  eagerly resolve every scope on every pause, most won't be looked at.
- Expanding a nested object variable is the same call again, recursively, with
  *its* `objectId`.
- **Not every property has a `value`.** An accessor property (getter/setter-only,
  or an uninitialized `const` still in its temporal dead zone) comes back from
  `Runtime.getProperties` with `get`/`set` descriptors instead of a `value` field.
  Treat `value` as optional in your types and UI — code that assumes
  `variable.value.type` always exists will throw the first time the user expands
  a scope containing one of these, and if nothing in the app catches render
  errors, that one throw blanks the entire UI (see the error-boundary note below).
- Expression evaluation in the paused frame: `Debugger.evaluateOnCallFrame({callFrameId, expression})`.

## Every render error needs somewhere to land

A single uncaught error in a component that only renders when a debug session is
paused (a rarely-exercised code path, easy to miss in a quick pass) can unmount the
*entire* React tree, not just that component — this genuinely happened during this
feature's own testing, from the missing-`value` case above. If the app has no
top-level `ErrorBoundary`, add one before shipping any feature with new,
lightly-tested rendering paths; it turns "blank white screen, no clue why" into a
visible, recoverable error with the actual message.

## Monaco decorations added from *outside* Monaco's own event loop may need a forced render

Breakpoint glyphs and the paused-line highlight are ordinary
`editorInstance.deltaDecorations(...)` calls, but they're triggered by a React
state update reacting to an IPC event — not from Monaco's own input, scroll, or
edit handling. `deltaDecorations` genuinely registers the decoration on the model
(verify with `model.getLineDecorations(line)` — the class name is really there),
but Monaco doesn't always schedule a repaint for a change it didn't itself observe
originating from its own event loop. If a decoration is registered but never
visually appears despite the model confirming it exists, call
`editorInstance.render(true)` immediately after `deltaDecorations` — this was the
actual fix here, found only by instrumenting Monaco's own bundled source
(`node_modules/monaco-editor/esm/...`) to trace exactly where a registered
decoration request was getting dropped before paint. (Also check
`showIfCollapsed: true` per `MONACO_EDITOR_INTEGRATION_SKILL.md`'s decoration
gotchas — the two issues can look identical from the outside but are unrelated
root causes; verify which one is real by confirming the decoration exists on the
model before reaching for either fix.)

## Scope this kind of feature honestly

Real breakpoint debugging via a language's native inspector protocol only applies
to that language, un-transpiled — for Node this means plain `.js`/`.mjs`. A `.ts`
file run through a transpiler (`tsx`, `ts-node`) would need source-map resolution
to map breakpoints from original to generated positions, which is real, separate
work — don't silently claim TypeScript debugging works when only the JavaScript
path was actually built and tested. Say exactly what's covered in the UI copy, not
an inflated version of it (this is also a `VERIFICATION_WORKFLOW_SKILL.md` /
no-overclaiming concern, not just a coding one).
