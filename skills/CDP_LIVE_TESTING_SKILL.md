# Skill: Verifying a Feature by Actually Driving the Running App (Chrome DevTools Protocol)

## Trigger

Any time "it typechecks and rebuilds" isn't enough evidence a feature works — real
UI interaction (clicks, keystrokes, focus, decorations, IPC round trips), a bug
report you can't reproduce by reading code, or any claim you're about to make about
runtime behavior you haven't actually watched happen. This is the escalation past
`VERIFICATION_WORKFLOW_SKILL.md`'s rebuild-and-relaunch loop, for when you need to
prove the app *does the right thing*, not just that it *starts*.

## Why this exists

Electron apps have no accessible screenshot pipeline in this environment, and
"reading the code carefully" repeatedly failed to explain real bugs this session —
a Monaco decoration that silently doesn't render, a keydown that never reaches a
listener, a debugger that pauses at the wrong line. Every one of those was only
diagnosable by actually running the code and inspecting live state. Static analysis
is where you form a hypothesis; this is how you test it.

## The setup

1. Launch the packaged app with a remote debugging port open:
   ```
   env -u ELECTRON_RUN_AS_NODE open -a /Applications/LLMRaki.app --args \
     --remote-debugging-port=9333 '--remote-allow-origins=*'
   ```
   (quote the origins flag — an unquoted `*` gets glob-expanded by the shell).
2. Get the renderer's WebSocket debugger URL:
   ```
   curl -s http://localhost:9333/json | python3 -c \
     "import sys,json; print(json.load(sys.stdin)[0]['webSocketDebuggerUrl'])"
   ```
3. Drive it from Python via the `websocket-client` package (`pip3 install --quiet
   websocket-client` once per machine). Keep a small reusable helper script in the
   scratchpad — **recreate it if missing**, the scratchpad directory has been
   observed to get cleared between turns mid-session:
   ```python
   import json, urllib.request
   import websocket

   PORT = 9333
   def get_ws_url():
       data = json.loads(urllib.request.urlopen(f"http://localhost:{PORT}/json").read())
       return data[0]["webSocketDebuggerUrl"]

   _ws = None
   _id = [1]
   def send(method, params=None):
       global _ws
       if _ws is None:
           _ws = websocket.create_connection(get_ws_url())
       _id[0] += 1
       msg_id = _id[0]
       _ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
       while True:
           resp = json.loads(_ws.recv())
           if resp.get("id") == msg_id:
               return resp

   def eval_js(expr):
       return send("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
   ```
4. Run arbitrary JS in the page with `eval_js("...")` — click DOM elements,
   inspect component state that's been assigned to `window.__something` for
   inspection, call `window.api.*` (the preload bridge) directly to invoke IPC
   without going through UI at all.

## Real keyboard and mouse input, not just `.click()`

`element.click()` only exercises a click *handler* — it says nothing about focus,
real event propagation, or Monaco's own input handling (which listens for real
DOM events, not synthetic `.click()` calls in all cases). For anything involving
keyboard shortcuts, gutter clicks, or focus transitions, dispatch real input
events via CDP's `Input` domain instead:
```python
send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1})
send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1})

send("Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13})
send("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13})

send("Input.insertText", {"text": "hello world"})  # for typing text into a focused input/textarea
```

**Gotcha: the CDP `key` parameter is the real DOM `KeyboardEvent.key` value, not a
human name.** Passing `"Return"` (what a person might call the key) instead of the
correct `"Enter"` produces an event whose `e.key` comes through as an empty string
in the page — the listener fires, but `if (e.key === 'Enter')` never matches, and
the resulting "nothing happened" looks exactly like a real app bug. When a test
doesn't behave as expected, check this before assuming the app is broken — verify
with `console.log(e.key)` inside the actual handler if there's any doubt.

## Capturing console output

`Runtime.evaluate`'s return value only gives you the *last* expression's result —
for tracing what happens *during* a longer interaction (a debounced call, an async
IPC round trip), listen for console messages over a wall-clock window instead:
```python
send("Runtime.enable")
send("Console.enable")
# then recv() in a loop for `duration` seconds, filtering msg.method == "Runtime.consoleAPICalled"
```
Run this **before** triggering the interaction, in the background, with a duration
that comfortably covers everything you're about to do — a capture window that ends
before the action you're testing completes will show nothing, and reads exactly
like a failure. If a console-based check comes back empty, prefer a **persistent
global** (`window.__probe = {...}`, checked with a plain `eval_js` afterward,
unaffected by timing) over trusting an empty capture as a negative result.

## Known environment gotchas that produce false negatives

- **Background-window rendering throttle.** A newly-launched or backgrounded
  Electron window can render at a literal 5×5px with zero visible content until
  it's actually foregrounded — `osascript -e 'tell application "LLMRaki" to
  activate'` before checking anything render-dependent (view lines, decorations,
  layout-derived coordinates). Re-run the activate + a short sleep if an early
  check in a long script comes back looking empty; real time may have passed
  since the last activation.
- **Stale state across repeated test iterations.** Widgets, decorations, or
  breakpoints from a *previous* test run in the same app session persist unless
  the app is restarted — a "not working" result can just be a stale leftover from
  an earlier iteration confusing the current check (e.g. three stacked popups
  from three earlier Cmd+K presses, none ever dismissed). When a result looks
  wrong and you can't immediately explain it, fully quit and relaunch before
  continuing to debug, rather than layering more test steps onto contaminated
  state.
- **Duplicate-name tree items.** Clicking a DOM element found by matching visible
  text (e.g. a folder named `src` that appears at two different nesting depths)
  can hit the *first* match instead of the one you meant. Prefer indexing into
  `querySelectorAll(...)` results by position (found via a full listing first)
  over `.find(el => el.textContent === name)` when duplicates are possible.
- **`window.confirm()` blocks the entire renderer**, including the CDP
  `Runtime.evaluate` call that's waiting on a promise across it — a script that
  can trigger a native confirm dialog (e.g. closing a dirty tab) will appear to
  hang. Avoid interactions that could raise one during automated testing, or be
  ready for the call to sit until the background task notices it finished, or
  time out.

## When a result contradicts an earlier one, suspect the test before the app

Several apparent regressions this session turned out to be test artifacts, not
code regressions: a "second occurrence didn't work" that was actually a
transient rate-limit from the earlier call, a "focus didn't land" that was really
a wrong CSS class check timing, a "still broken" that was really a leftover
widget from the previous iteration. Before concluding a fix regressed, do one
fully clean run (quit, relaunch, single isolated action, immediate check) rather
than layering more assumptions onto an already-contaminated multi-step script.
