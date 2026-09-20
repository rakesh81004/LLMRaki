# Skill: Verify Every Change Against the Real Running App

## Trigger

Applies to **every** code change in this project, no exceptions — a one-line CSS
tweak and a multi-file feature both go through this. Read this alongside whichever
task-specific skill file applies.

## Why this exists

This is an Electron desktop app. A change that type-checks can still fail to work:
the renderer bundle might not have rebuilt, a stale copy of the app might still be
running, or a change might only "work" in theory because it was never actually
exercised end to end. Saying a task is done without having gone through this loop is
reporting an intention, not a result.

## The procedure, in order

1. **Typecheck first, always.** Run the project's typecheck script
   (`tsc --noEmit` across both the node and web tsconfigs, currently wired as
   `npm run typecheck`). Fix every error before moving on — don't rebuild against
   code that doesn't compile.
2. **Quit the currently running app instance.** A stale process will keep running
   old code, making the next steps misleading.
   ```
   osascript -e 'tell application "LLMRaki" to quit'
   pkill -f "LLMRaki.app"   # in case quit didn't take
   ```
3. **Rebuild and reinstall.** This project's `npm run install:mac` both rebuilds the
   renderer bundle and repackages + installs the `.app` to `/Applications`. This
   step regularly takes over two minutes (native module rebuild for `node-pty`,
   electron-builder packaging) — run it in the background and wait for the
   notification rather than assuming a short timeout means failure.
4. **Relaunch and confirm the right binary is running.**
   ```
   open /Applications/LLMRaki.app
   ps aux | grep -i "LLMRaki.app/Contents/MacOS"
   ```
   Confirm the PID is running from `/Applications/LLMRaki.app`, not a dev binary or
   a leftover process from a previous build.
5. **Only then report the task as done**, and say what you actually verified (PID,
   what you rebuilt) rather than just "should work now."

## Environment gotcha specific to this project

The sandboxed shell has `ELECTRON_RUN_AS_NODE=1` set. Launching Electron directly
under that env var runs it as plain Node with no GUI at all — always launch with:
```
env -u ELECTRON_RUN_AS_NODE open /Applications/LLMRaki.app
```

## What "verified" does NOT mean

- "It compiles" is not verification — TypeScript catches type errors, not logic
  bugs, wrong assumptions about a library's runtime behavior, or wrong CSS.
- For anything visual, if you can read back a screenshot or the user has shown you
  one, actually look at it before claiming a fix landed — several bugs in this
  project (ghost focus boxes, disabled-state fading, background bleed-through) were
  only found by close visual inspection, not by reading the CSS in isolation.
- If you cannot visually verify (no screen access), say so explicitly rather than
  claiming the visual result is correct — state what you verified (compiles,
  rebuilds, process runs) and what you could not (the actual rendered appearance).
