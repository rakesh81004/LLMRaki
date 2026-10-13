# Automations

Automations are repeatable browser tasks for LLMRaki's Chrome extension. Each one lives in its own
folder and is bundled into the extension at build time (`npm run build:ext`).

```
automations/
  <name>/
    AUTOMATION.md   instructions, with a small header (see below)
    media/          files the automation always needs — a résumé, a template, images
```

Run an automation by typing its trigger word in a message (for example `CODE COLDDM`) or with
**Run** in the extension's Settings → Automations. LLMRaki then switches to the automation's mode
and attaches `AUTOMATION.md` and every file in `media/` to the message, so the instructions and files
are read on every run.

## AUTOMATION.md header

```yaml
---
name: code-colddm            # folder name, lowercase with dashes
title: CODE COLDDM           # shown in the extension
trigger: CODE COLDDM         # typing this in a message runs the automation
mode: auto                   # ask | edit | auto — the mode it runs in
description: One sentence on what it does and when to use it.
media:                       # files from this folder attached on every run
  - media/My Resume.pdf
---
```

Media can be PDF, Word (.docx), text/Markdown/CSV/JSON, or images. **`media/` folders are
git-ignored** — they often hold personal files like a résumé — so they stay on this machine and in
the built extension, but are never pushed.

## Automations here

| Trigger | Folder | What it does |
|---|---|---|
| `CODE COLDDM` | `code-colddm/` | Finds fresh LinkedIn hiring managers in Bengaluru and Chennai who can hire Rakesh and are likely to reply to a cold DM; ranks them with evidence; sends invites only when asked. Media: résumé. |
| `CODE APPLY` | `job-auto-apply/` | Finds fresh, well-matched jobs on Naukri and LinkedIn Easy Apply from the résumé, gets approval on a shortlist with the filled answers, applies with verified complete answers, then finds 3 LinkedIn referral contacts per company (v1.3). Media: résumé. |

Automations can also be created inside the extension (Settings → Automations → Add automation);
those are stored in the browser rather than in this folder.
