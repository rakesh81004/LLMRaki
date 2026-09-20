# Skill: Designing the AI Agent Chat Loop UX

## Trigger

Changing how the chat/agent loop itself behaves or presents its work — progress
indicators while it's searching/reading, permission prompts for risky commands,
streaming behavior, rate-limit handling, tool-call budgets, or the agent describing
work instead of doing it.

## Progress display: show the current step, not the whole history

An agent doing multi-step tool use (searching, reading files) naturally accumulates
a long list of steps. Rendering that list fully expanded *while still running* reads
as noise — the user wants to know **what it's doing right now**, and only wants the
full history on demand.

Pattern: keep the full step list in state (for later inspection), but render it
inside a native `<details>/<summary>` that is **not** forced open. While actively
running, the summary shows only the *latest* step's text (replacing itself as new
steps arrive — key the element on the step count so a CSS entrance animation
replays per step, since React re-rendering the same element's text content does not
by itself replay a CSS animation). Once finished, the summary switches to a static
aggregate ("Explored N files, M searches"). The user can still click to expand and
see everything — that's what `<details>` already gives you for free; don't fight it
by controlling `open` via React state tied to streaming status.

## Tool-call budgets need headroom for real multi-file tasks

A low per-turn tool-call cap (e.g. 12) is enough for a single-file question but not
for "edit these five files," which needs a read + write (+ possibly a search) per
file. Hitting the cap mid-task and silently stopping produces a dangerous failure
mode: the model may claim files were edited when the call that would have written
them never actually ran. Two independent fixes are both needed:
- Raise the cap for modes that write files (this project uses 40 for edit/auto vs.
  12 for read-only ask).
- Make the cutoff message to the model explicit that the call **did not execute** —
  otherwise the model has no signal that it should stop claiming success for
  not-yet-written files.

## "Describing" vs. "doing" is a recurring failure mode for coding agents

A model asked to edit code will sometimes present a full rewritten file as a
markdown code block ("here's the clean implementation") without calling the actual
write tool, then list the remaining files under "next steps" — treating the whole
response as a *recommendation* rather than completed work. The fix lives in the
system instructions, not the UI: state explicitly that a code block in the reply is
never a substitute for calling the write tool, and that fixing one file as a
"demonstration" while deferring the rest under "next steps" counts as an unfinished
task, not a completed one.

## Prefer direct file writes over git-based reverts for undoing the agent's own edits

When a user asks the agent to undo *its own* prior edits, a broad `git checkout --
<dir>` or `git reset` will also discard the *user's* own unrelated uncommitted work
in the same tree — it doesn't distinguish "the AI's changes" from "everything
uncommitted." Instruct the agent to prefer reverting via the tool it used to make
the edit (rewrite the file back to the content it saw before editing, which the UI
already has on hand for an undo button) and reserve git-based reverts for when the
user explicitly names git.

## Terminal command permission gating should be narrow

A shell-command tool available to an agent needs *some* gate, but gating every
command creates constant interruptions for genuinely safe operations (builds,
tests, local git commit/branch/checkout, file moves). The rule that worked well
here: gate only three categories — package installs, anything that pushes/publishes
outside the project (`git push`, `npm publish`, `docker push`), and direct
third-party network calls (`curl`, `wget`, `ssh`, `scp`). Everything else, including
mutating local git operations, runs automatically. `sudo` is worth gating
defensively even if not explicitly requested — flag that choice to the user rather
than silently deciding it for them.

## Rate limits: retry with the server's own guidance, and show the wait

When a provider returns a 429 with a `retryDelay`, parse and honor that value rather
than guessing a backoff, and surface a live countdown in the UI so a stalled-looking
chat doesn't read as broken. Cap total retry rounds so a persistently rate-limited
session fails visibly instead of hanging forever.
