# Skill: UI Theming and Mode-Based Color

## Trigger

"Change the color/theme," a button/pill/bubble "looks faded/washed out/wrong,"
requests to make one UI mode (e.g. Ask/Edit/Auto) visually distinct, or any bug
report shaped like "the color changed when it shouldn't have" / "the color didn't
change when it should have."

## The architecture this app uses

A small set of CSS custom properties on `:root` define the base palette
(`--bg-editor`, `--accent`, `--accent-bright`, `--glow-rgb`, `--text-primary`, etc.).
RGB-triplet variables (`--glow-rgb: 122, 162, 247`) exist specifically so they can be
plugged into `rgba(var(--glow-rgb), <alpha>)` for translucent variants — a plain hex
variable can't do that.

Mode-specific color comes from a **scoped override block**: a data attribute on a
container (`.chat-panel[data-mode='ask']`) sets `--mode-color` and
`--mode-glow-rgb` for everything inside it. Every mode-aware element reads
`var(--mode-color, <fallback>)` rather than hardcoding a color, so changing modes
recolors the whole subtree from one place.

## Rules learned the hard way

1. **A "current" indicator that reads a live variable will keep changing forever —
   including for things that already happened.** The chat message bubble bug: it
   read `--mode-glow-rgb` directly, so switching from Edit to Ask mode repainted
   *already-sent* Edit-mode messages green. The fix is to **snapshot** the value at
   the moment of the action (store `mode` on the message itself) and set a
   **per-instance CSS variable** (`style={{ '--msg-mode-rgb': MODE_RGB[msg.mode] }}`)
   that the CSS prefers over the live one: `rgba(var(--msg-mode-rgb, var(--mode-glow-rgb, var(--fallback))), alpha)`.
   When you fix this, check every existing fallback chain for a *second* live
   variable further down the chain — a fix that only adds the snapshot variable to
   the front but leaves a live one as a fallback will still leak for any record that
   predates the fix (no snapshot stored yet).

2. **A generic global rule can silently double up with a component-specific one.**
   A blue `textarea:focus { box-shadow: ... }` rule meant as a generic input
   affordance also fired on the chat composer's textarea, which already had its own
   mode-colored focus treatment on the parent card — the result looked like two
   overlapping borders in different colors. When a component has its own focus/hover
   treatment, explicitly override the generic rule for that specific selector
   (`.chat-input-area textarea:focus { box-shadow: none; }`) rather than assuming
   the global rule won't apply.

3. **`:disabled` styling defaults to looking "off" — check whether that's actually
   wanted.** Twice in this project, a `:disabled` state was given a flat neutral
   grey/reduced-opacity treatment by default, and both times the actual requirement
   was "keep full color/opacity even when disabled, just make it non-interactive."
   Don't assume disabled == dimmed; ask what disabled should look like when it's a
   prominent, frequently-empty-state element (like a send button that's disabled
   whenever the input is empty).

4. **Translucent color on top of a busy background image can look "off" or
   "invisible."** Buttons/pills placed over a background image need an *opaque*
   backing (`var(--bg-input)` or similar), not a low-alpha tint — a 10%-alpha active
   state blended into a busy image reads as "not selected" even when it is.

5. **Flexbox overflow can look like a z-index/color bug but isn't one.** A flex
   child with default `flex-shrink: 1` doesn't clip children wider than its shrunk
   width — they visually spill into a sibling's space and whichever element is later
   in DOM order paints over the other. If two elements appear to be "merging" or
   "overlapping" as a container narrows, check `flex-wrap`/`flex-shrink`/`overflow`
   before assuming it's a color or stacking-context issue.

6. **The browser's default focus rectangle is square and ignores your border-radius.**
   A stray box behind a pill/icon button on click is almost always this, not a
   missing/broken style. Fix once, globally: `button:focus { outline: none; }` +
   `button:focus-visible { outline: 2px solid ...; }` (keeps keyboard accessibility,
   removes the mouse-click artifact).

7. **A CSS class used in many places needs a *base* rule, not just scoped overrides.**
   `.close-btn` had a scoped rule only for one usage (`.editor-tab .close-btn`) and a
   near-invisible override for another — every other place it was used had zero
   styling and fell back to native OS button chrome, which looks exactly like
   "broken/old UI." When a shared class is reused across many components, verify it
   has a sensible unstyled-by-default base rule, and grep for every usage before
   concluding a single scoped fix covers it.

## Process for a theming task

1. Find the CSS variable(s) that should drive the color — don't hardcode a new
   color if an existing variable already represents that concept.
2. Grep for every current usage of the element/class you're changing — a partial
   fix that misses one of several usages reproduces bug #7 above.
3. Consider whether the value needs to be **live** (reflects the current global
   state) or a **snapshot** (fixed at the time something happened) — this is the
   single most common source of "it changed when it shouldn't" bugs in this
   codebase.
4. Check `:disabled`, `:hover`, and `:focus`/`:focus-visible` states explicitly,
   don't just style the base state.
