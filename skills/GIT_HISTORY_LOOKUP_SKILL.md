# Skill: Checking Git History Before Answering

## Purpose

Some questions can't be answered correctly by only looking at the current working tree — the answer lives in the past: an earlier commit, a previous version of a file, another branch. This skill defines exactly when a coding assistant should go look at git history, exactly which commands it is allowed to use to do that, and the one rule that must never be broken: **looking at old code must never change anything.**

This skill is READ-ONLY by design. It answers questions by inspecting history. It never checks out, resets, merges, or otherwise mutates the repository as a side effect of investigating it.

---

## 1. When to trigger this skill

Trigger a history lookup when the user's message implies the answer depends on **something that existed before now**, not just the current files. Treat this as intent-matching, not exact string-matching — the user will phrase this many different ways.

**Explicit trigger phrases** (non-exhaustive — match the intent, not just these exact words):
- "did we do this before?" / "have we already done this?" / "haven't we already implemented this?"
- "check whether we've done that before"
- "check the repo" / "check the repo history" / "check the git history"
- "look at earlier commits" / "check previous commits" / "check older commits"
- "was this changed earlier?" / "when did this change?" / "who changed this and why?"
- "what did this file used to look like?" / "show me the old version of this"
- "check other branches" / "does another branch already have this?"
- "did this exist in a previous version?"
- "is this a regression?" / "did this used to work?"

**Implicit triggers** — no history keyword, but the question can only be answered by history:
- Asking about the reason/intent behind existing code ("why is this written this way") when the current code and comments don't explain it — commit messages often do.
- Investigating a bug that "used to work" — bisecting requires history.
- Asking to restore, reference, or compare against a previous implementation.
- Asking whether a feature/fix already exists somewhere in the codebase's past or on another branch before implementing it from scratch (avoids duplicate work).

**Do not trigger** when the user is asking about the current state of files only ("what does this function do", "fix this bug in the current code") — use normal file-reading tools for that. History lookup is for questions that are inherently about *time* or *other branches*, not a replacement for reading the current file.

---

## 2. The one hard rule

> **Never mutate the repository while investigating history. Read, don't touch.**

Concretely, this means:
- Never leave the working tree, the index (staging area), or `HEAD` in a different state than they were before the lookup started.
- Never check out an old commit or another branch to "look around" — even if you intend to switch back afterward. A checkout is a mutation the instant it happens (dirty-file conflicts, stash side effects, detached HEAD confusion), and it's also unnecessary — every read-only command below can inspect any commit or branch without moving `HEAD` at all.
- Never run a command from this skill that writes, even if the write seems harmless or "reversible" (e.g. `git stash`, `git merge --no-commit`, `git reset --soft`). If a command's own documentation describes it as "moves/updates/applies/writes/removes" anything, it does not belong in a history-lookup step.
- If you are ever unsure whether a git command is read-only, do not run it. Use one of the commands in the allowlist below instead, or ask the user.

Before starting a lookup, it's good practice to confirm the repo isn't already mid-operation (mid-rebase, mid-merge, detached HEAD from something else) via a plain `git status`, so you don't mistake pre-existing state for something you caused.

---

## 3. Allowed commands (the only ones this skill uses)

All of these inspect history or other branches/commits **without touching the working tree, the index, or `HEAD`**:

| Goal | Command |
|---|---|
| See commit history on the current branch | `git log --oneline -n <N>` |
| See commit history for one file specifically | `git log --oneline -- <path>` |
| See the full message + diff of one commit | `git show <hash>` |
| See a file exactly as it was in a specific commit, without checking anything out | `git show <hash>:<path>` |
| See what changed between two points | `git diff <hashA> <hashB> -- <path>` |
| See who last touched each line and in which commit | `git blame -- <path>` |
| List all local branches | `git branch --list` |
| List all remote-tracking branches too | `git branch -a` |
| See a file as it exists on another branch, without switching to it | `git show <branch-name>:<path>` |
| See commits that exist on one branch but not another | `git log <branchB>..<branchA> --oneline` |
| Search commit messages for a keyword | `git log --all --oneline --grep="<term>"` |
| Search history for when a piece of code was added/removed | `git log -p -S"<exact string>" -- <path>` (use sparingly — see performance note below) |
| Find the commit that introduced a bug (read-only investigation) | `git bisect` is **not** in this skill — it mutates `HEAD` at every step. If a true bisection is needed, ask the user first; it's a different, heavier operation than a lookup. |

**Never in this skill:** `checkout`, `switch`, `restore`, `reset`, `merge`, `rebase`, `cherry-pick`, `revert`, `stash` (any subcommand), `clean`, `branch -d/-D`, `push`, `pull`, `fetch --prune`, `commit`, `add`, `apply`, `am`, `config` (write forms). If a task actually requires one of these (e.g. the user explicitly asks to restore an old version into the working tree), that is a **code change**, not a history lookup — treat it under normal edit-mode rules (make the change as a real, visible edit the user can review/undo), not silently as part of "just checking."

### Performance note
`-S"<string>"` and `-p` (patch output) can be slow on large repositories or long histories. Scope every history search to a specific file or directory with `-- <path>` whenever possible, and cap commit counts with `-n <N>` (start small, e.g. 20-50, and widen only if needed) rather than scanning the entire history by default.

---

## 4. Procedure

1. **Recognize the trigger.** Confirm the question is genuinely about history/other branches (Section 1), not just the current file.
2. **Establish current state (read-only).** `git status` and `git branch --list` — know what branch you're on and that the tree is clean before you start, so you can tell your own commands apart from pre-existing state.
3. **Scope the search.** Prefer the narrowest search that could answer the question:
   - Same branch, most recent history first — start here by default.
   - Same repo, other branches — only if the user mentioned "other branches"/"another branch", or the current branch's history doesn't answer it and it's reasonable the work happened elsewhere.
   - Don't search `--all` broadly by default; broaden scope only when a narrower search comes up empty and broadening is a reasonable next step.
4. **Run read-only commands from the allowlist** (Section 3) to gather the specific commits/diffs/file versions relevant to the question.
5. **Answer using what you found**, citing the evidence precisely:
   - Cite commits as `<shorthash> — "<commit message>" (<relative date>)`.
   - Cite historical code the same way the codebase already cites current code, plus the commit it came from, e.g. `` `relative/path/to/file.ext@<shorthash>:LINE` `` — so the user can tell at a glance this is a **historical** reference, not the current file.
   - If quoting an excerpt of historical file content, mark it clearly as being from that commit (e.g. a heading like "As of `<shorthash>`") so it's never confused with the current version of the file.
   - If you searched and found nothing, say so plainly ("No prior commit on this branch touches `<path>` for `<term>`") rather than guessing.
6. **Leave no trace.** After finishing, `git status` should show the exact same state as before you started (same branch, same dirty/clean status). If it doesn't, something in your process was not read-only — stop and tell the user rather than trying to "fix" it yourself with another mutating command.

---

## 5. Worked examples

**"Did we already add rate-limit handling for this API before?"**
→ `git log --oneline --all --grep="rate limit"` and/or `git log -p -S"429" -- src/api/client.ts`, scoped narrowly, then report the relevant commit(s) with hash + message + a short excerpt from `git show <hash>` — no checkout needed.

**"What did this function look like before the refactor?"**
→ `git log --oneline -- path/to/file.ts` to find the commit before the refactor, then `git show <hash>:path/to/file.ts` to read that exact version — the working tree never moves.

**"Does the `feature/x` branch already have this fix?"**
→ `git show feature/x:path/to/file.ts` to read that branch's version of the file directly, or `git log main..feature/x --oneline -- path/to/file.ts` to see what commits differ — again, no checkout, no merge, `HEAD` never moves.

**"Can you restore the old version of this file into my working copy?"**
→ This is *not* a lookup anymore — it's a real edit. Read the old version with `git show <hash>:<path>` (read-only), then apply it as an explicit, visible file write the user can see and undo, under normal edit-mode rules — don't silently `git checkout <hash> -- <path>` as if it were part of "just looking."

---

## 6. Summary for the model

- Trigger on questions about the past or about other branches — not on ordinary "what does the current code do" questions.
- Only ever use commands that read; never one that writes, moves `HEAD`, touches the index, or touches the working tree.
- Prefer `git show <ref>:<path>` over any form of checkout — it gives you file content from any commit or branch with zero side effects.
- Scope searches narrowly (by path, by commit count) before broadening.
- Cite what you find with commit hash + message + date, and mark historical code as historical.
- If a request turns out to require an actual change (restoring/reverting into the working tree), stop treating it as a lookup and make the change explicitly and visibly instead.
