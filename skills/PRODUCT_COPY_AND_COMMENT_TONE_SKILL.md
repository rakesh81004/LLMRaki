# Skill: Writing UI Copy and Code Comments That Don't Read as Prompt-Echoes

## Trigger

**Every task**, whenever it produces user-facing text (taglines, dialogs, empty
states, README/package.json descriptions) or code comments — not one specific task
type. Read alongside `VERIFICATION_WORKFLOW_SKILL.md`.

## Why this exists

A real, caught incident: LLMRaki's Welcome screen tagline read "A VS Code style
code editor," and the about dialog said the same thing — both a near-verbatim echo
of how the feature was originally described in a prompt. To a user reading the
shipped UI or the source later, that phrasing is a visible tell that the app was
built prompt-by-prompt rather than designed, even though nothing about it is
actually wrong or broken. The instruction that came out of it: don't let this
happen again, **even when a future request is phrased the same "build X like Y"
way** — the fix is about the output, not about getting the user to ask differently.

## What to avoid

- UI copy that names a competitor product as the reason a feature exists: "A VS
  Code-style editor," "Cursor-style Cmd+K," "like GitLens."
- Code comments that cite another product as the *rationale* for a design instead
  of describing the actual mechanism or behavior: `// Cursor-style Cmd+K: ...`,
  `// real Copilot-style providers avoid ...`.
- Any phrasing that reads as a literal restatement of a feature request rather
  than a description written from the feature's own perspective.

## What's fine to keep

Referencing another tool for genuine **technical accuracy** is not the same
problem — e.g. "Matches VS Code's Source Control ordering" when the surrounding
code is reverse-engineering an exact, real, externally-observable behavior to
reproduce it, or "unlike full VS Code, standalone Monaco has no built-in concept
of X" when explaining a real API difference. The test: is the sentence describing
a *fact* (this is how the other thing behaves, and here's why that matters
technically), or is it describing *motivation* (we built it this way because it's
like that other thing)? The former is fine; the latter is what to rewrite.

## How to rewrite

- Describe the feature on its own terms and merits: "A desktop code editor with a
  built-in AI assistant," not "A VS Code-style editor."
- For a comment about a feature inspired by a familiar tool's behavior, describe
  the *mechanism* being replicated instead of naming the other product as the
  reason: "a floating instruction box for editing code in place," not "Cursor-style
  Cmd+K."
- Do a broader sweep when fixing one instance, rather than fixing only the literal
  example called out — check `package.json`, `README.md`, other dialogs/panels,
  and other comments for the same pattern, since it tends to repeat across a
  session's worth of features built the same way.
