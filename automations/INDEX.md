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
autoApprove: linkedin.com    # optional: sites where, once you've answered its question, its
                             # send/submit clicks run without a prompt for each one
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
| `CODE COLDDM` | `code-colddm/` | Finds fresh LinkedIn hiring managers in Bengaluru and Chennai who can hire Rakesh and are likely to reply; ranks them with evidence; asks one approval question, then sends connection invites with the note to everyone approved. Keeps its history in the `colddm-tracker` memory file. Auto-approves on linkedin.com after the answer. Media: résumé. |
| `CODE APPLY` | `job-auto-apply/` | Finds fresh, well-matched jobs on Naukri and LinkedIn Easy Apply from the résumé, gets approval on a shortlist with the filled answers, applies with verified complete answers, then finds 3 LinkedIn referral contacts per company (v1.3). Media: résumé. |

## How a run goes

- **Questions** — when the instructions say to ask (an approval, a multiple-choice question), LLMRaki
  shows the question with a button per answer, plays a sound and sends a notification. You can also
  type a reply instead. The run carries straight on after your answer.
- **Auto-approve** — the sites in `autoApprove` only skip the per-click prompt once you've answered
  the automation's question, and only in that chat. Before that, and in other chats, a click that
  sends or submits still asks first.
- **Follow-ups** — replying in the same chat keeps running under the automation, without attaching
  its files again. A new chat starts fresh.
- **Trackers** — a history file the instructions mention (such as `colddm-tracker`) is kept as a
  memory file in the extension. You can view and delete it in Settings → Memory.

Automations can also be created inside the extension (Settings → Automations → Add automation);
those are stored in the browser rather than in this folder.
