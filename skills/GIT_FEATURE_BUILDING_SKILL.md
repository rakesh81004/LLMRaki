# Skill: Building Git-Powered Editor UI

## Trigger

Building or fixing a UI feature backed by git — Source Control panel, diff viewer,
blame annotations, commit graph, file status list ordering. Distinct from
`GIT_HISTORY_LOOKUP_SKILL.md`, which is about *consulting* history to answer a
question, not building a feature.

## Reuse Monaco's real `DiffEditor`, don't hand-roll diff rendering

Monaco ships a full `DiffEditor` (`import { DiffEditor } from '@monaco-editor/react'`)
that computes and renders a real inline or side-by-side diff, including the overview
ruler (scrollbar) markers, and can still be fully editable on the "modified" side.
A hand-rolled version using `editor.deltaDecorations()` to paint gutter bars for
added/modified/deleted line ranges is real, working code — it was built and
shipped once in this project — but it's strictly worse than the built-in component:
more code, only gutter-bar fidelity (no actual inline red/green text blocks), and no
free overview-ruler integration. If the requirement is "look like a real diff view,"
reach for `DiffEditor` first; only hand-roll decorations for something `DiffEditor`
genuinely can't express (e.g. a single fixed-line inline annotation like blame text).

To get a `DiffEditor`'s editable "modified" pane: `diffEditorInstance.getModifiedEditor()`
returns a normal `IStandaloneCodeEditor` — wire cursor/content/save listeners on
*that*, exactly like a plain `Editor` instance.

**Model path gotcha**: always pass explicit `modifiedModelPath`/`originalModelPath`
(or `path` on a plain `Editor`) matching the real file's extension. Without one,
Monaco creates an anonymous in-memory model, and the TypeScript language service can
misdetect the file's nature and throw spurious "cannot find name" squiggles on
completely valid code that a real project context (e.g. VS Code with full project
resolution) never shows. When two models represent the same file (e.g. a live
working-tree buffer and its git-index baseline for diffing), give them distinct URIs
via a scheme prefix (`diff-baseline://<realPath>`) — this keeps the *real* file's
own extension intact at the end of its URI while still avoiding a collision.

## Matching an existing tool's file ordering — verify against real output, not intuition

`git status --porcelain` returns paths in git's raw tree order, which is **plain
lexicographic full-path comparison** — this genuinely interleaves a subfolder's
files with its parent's siblings (e.g. `components/EditorArea.tsx` sorts between
`App.tsx` and `index.css`, because `c` < `i`). VS Code's Source Control panel does
**not** show that raw order — it groups files directly in a folder before any files
in that folder's subdirectories (files-before-subfolders, alphabetical within each
group), which only coincidentally looks similar to git's own order for simple cases.

When asked to "match how VS Code shows it," don't guess a sort — get the actual
reference output (a screenshot, or run the same command yourself) and hand-derive
the exact comparator, then check it against **every** entry, not just the first few.
The comparator that reproduces VS Code's behavior:

```ts
function compareGitPaths(a: string, b: string): number {
  const aParts = a.split('/')
  const bParts = b.split('/')
  const len = Math.min(aParts.length, bParts.length)
  for (let i = 0; i < len; i++) {
    const aIsLast = i === aParts.length - 1
    const bIsLast = i === bParts.length - 1
    if (aIsLast !== bIsLast) return aIsLast ? -1 : 1   // a direct file beats a path going deeper
    if (aParts[i] !== bParts[i]) return aParts[i] < bParts[i] ? -1 : 1
  }
  return aParts.length - bParts.length
}
```

## `git blame --line-porcelain` for per-line authorship

Plain `--porcelain` only repeats a commit's full header on the *first* line of each
contiguous run from that commit — `--line-porcelain` repeats it for every line,
trading some output size for trivial parsing (one block per output line, no need to
track "last seen commit for reuse"). Detect uncommitted lines by an all-zero hash
(`/^0+$/`) and label them distinctly ("Uncommitted changes") rather than showing a
fake author/date.

## Nested repos and path conventions

This app's `findGitRoot()` searches one level of subdirectories if the opened folder
itself isn't a repo (handles "user opened the parent of the actual project"
layouts) — the opposite direction from git's own upward search. Once resolved,
**every** git IPC call in this codebase takes that resolved `gitRoot` as `cwd` and
expects paths **relative to it**, not the original opened folder. When adding a new
git-backed call, follow that same convention rather than re-deriving relative paths
differently in a new spot.
