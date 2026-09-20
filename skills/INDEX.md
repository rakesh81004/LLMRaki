# Skill Files Index

This folder holds task-type-specific skill docs written from real incidents building
LLMRaki. **Read only the file(s) matching the task type you've been given — not the
whole folder.** Each file is self-contained and detailed; there's no need to read a
file whose trigger doesn't match your current task.

Every task, regardless of type, is also subject to `VERIFICATION_WORKFLOW_SKILL.md` —
read that one in addition to whichever task-specific file(s) below apply.

| Task type / trigger phrases | File(s) to read |
|---|---|
| "change the color/theme", mode-based coloring (ask/edit/auto), buttons look wrong/faded/washed out, focus rings, translucent backgrounds bleeding through, disabled-state styling | `UI_THEMING_AND_MODE_COLOR_SKILL.md` |
| "make an icon/logo", "use this background image", anything involving a `.png`/`.svg`/`.icns` asset, clipboard image pastes | `ASSET_CREATION_PIPELINE_SKILL.md` |
| "add a new [feature] that needs main-process access" (filesystem, git, shell, native APIs) — any time the renderer needs a capability it doesn't have yet | `ELECTRON_IPC_FEATURE_SKILL.md` |
| Building git-powered UI (Source Control panel, diff viewers, blame, commit graph, file status ordering) — as opposed to *consulting* git history for context | `GIT_FEATURE_BUILDING_SKILL.md` |
| "when I do X in [panel/component A], [panel/component B] should reflect it" — anything about one part of the UI not noticing another part's change | `UI_STATE_SYNC_SKILL.md` |
| Designing or fixing the AI chat/agent loop itself — progress indicators, permission prompts, streaming UX, rate-limit handling, tool-call budgets | `AI_AGENT_CHAT_UX_SKILL.md` |
| Anything touching the Monaco code editor directly — decorations, diff view, breadcrumbs/symbol outline, custom themes, `DiffEditor` vs `Editor` | `MONACO_EDITOR_INTEGRATION_SKILL.md` |
| Needing git history/blame/log *as context* to answer a question or make a decision (not building a UI feature) | `GIT_HISTORY_LOOKUP_SKILL.md` |
| Building/tuning the AI's own file-search or how search/read results are shown in chat | `EFFICIENT_FILE_SEARCH_AND_CHAT_UI.md` |
| **Every task**, after making a code change | `VERIFICATION_WORKFLOW_SKILL.md` |

If a task spans more than one row, read all the matching files — they're written to
compose (e.g. "add a git blame feature" is `ELECTRON_IPC_FEATURE_SKILL.md` +
`GIT_FEATURE_BUILDING_SKILL.md` + `MONACO_EDITOR_INTEGRATION_SKILL.md` +
`VERIFICATION_WORKFLOW_SKILL.md`).
