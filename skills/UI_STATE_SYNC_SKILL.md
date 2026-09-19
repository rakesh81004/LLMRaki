# Skill: Reveal / Sync Active State Across UI Panels

## What this skill is for

Use this whenever the user reports a bug shaped like:

> "When I do X in panel A, panel B should show/update/highlight Y — but it doesn't."

Examples: opening a file from a global search box doesn't highlight it in the file
tree; renaming a file in the explorer doesn't update its open tab title; running an
action in one panel doesn't refresh a status indicator in another. These are all
**cross-panel state sync** bugs, not missing-feature requests — the fix is almost
always smaller than it first looks, because the shared state usually already exists.

## Procedure

1. **Find the shared state, don't invent new state.**
   Grep for the piece of state panel B already uses to know "what's active" (e.g.
   `activePath`, `selectedId`, `currentX`). In almost every non-trivial app, this
   state already exists and is already passed as a prop into panel B — the bug is
   that panel A's action doesn't update it, or panel B doesn't fully react to it.

2. **Trace the action's call path in panel A.**
   Find the exact handler/callback the user's action invokes (e.g. `onOpenFile`,
   `onSelect`). Read what it currently does. Usually it updates *some* state but not
   all of it (e.g. it opens a file but never switches the sidebar to the view that
   would show the tree).

3. **Check whether panel B already has reactive logic for that state.**
   Before adding new logic, read panel B's existing code for effects/handlers keyed
   off the shared state. Often 80% of the desired behavior (e.g. auto-expanding
   parent folders when a descendant path becomes selected) is already implemented —
   the remaining gap is narrow and specific.

4. **Enumerate the concrete gaps, not a vague "it should work."**
   Typical gaps in this class of bug:
   - The view/tab that would show the change isn't switched into focus.
   - The target row/item exists and is marked "selected" via CSS class, but is
     scrolled out of view — nothing calls `scrollIntoView()`.
   - The state update only fires on one code path (e.g. clicking in the tree) but
     not on the other entry point the user actually used (e.g. a search box).

5. **Fix with the smallest targeted addition.**
   - Wire the missing state update into the neglected entry point (e.g. also call
     `setSidebarView('explorer')` alongside `openFileByPath()`).
   - Add a `ref` + a `useEffect` that fires `scrollIntoView({ block: 'nearest' })`
     when `isSelected` flips true, scoped to just the item component — not a new
     global scroll-management system.
   - Do not rebuild the existing auto-expand/highlight mechanism if it already
     works; only patch the specific missing link.

6. **Verify like any other change**: typecheck, rebuild, reinstall, relaunch, and
   mentally re-walk the exact user scenario end to end (not just "does it compile").

## Worked example from this project

**Symptom:** "When I open a file by searching in the top-center box, it should show
as active in the left folder tree so I can locate it."

**Investigation:**
- Shared state: `activePath` in `App.tsx`, already passed to `FileExplorer` as
  `selectedPath`, already threaded down into every `TreeItem`.
- `TreeItem.tsx` already had a `useEffect` that auto-expands a directory if
  `selectedPath` is a descendant of it — the "show as active" mechanism already
  existed and worked when navigating via the tree itself.
- Gap #1: `TopSearchBar`'s `onOpenFile` only called `openFileByPath()`; it never
  set `sidebarView` to `'explorer'`, so if the user was on Search/Source
  Control/Settings, the tree wasn't even visible to show the highlight.
- Gap #2: even when the explorer was visible and the ancestor folders auto-expanded,
  nothing scrolled the newly-revealed row into view in a long tree.

**Fix (two small, targeted diffs, no new architecture):**
- In `App.tsx`, wrapped the search bar's `onOpenFile` to also call
  `setSidebarView('explorer')` before opening the file.
- In `TreeItem.tsx`, added a `rowRef` and a `useEffect` keyed on
  `selectedPath === entry.path` that calls `rowRef.current?.scrollIntoView({ block:
  'nearest' })`.

Total new code: ~10 lines, because the hard part (state plumbing, auto-expand) was
already there — the skill is finding that out *before* writing new state management.

## Anti-patterns to avoid

- Don't add a second, parallel "selected" state just for the new entry point —
  reuse the one panel B already reads.
- Don't rebuild auto-expand/tree-walk logic if a scan of the existing component
  shows it's already implemented.
- Don't scroll/reveal at the container level with manual offset math when a plain
  `element.scrollIntoView({ block: 'nearest' })` on the specific row does the job.
