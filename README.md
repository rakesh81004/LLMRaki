# LLMRaki

A desktop code editor with a built-in AI chat assistant, built with Electron + React + Monaco. Runs on macOS and Windows from the same codebase.

## Features

- File explorer: open a folder, browse and lazy-load its tree
- Monaco editor with tabs, syntax highlighting, and Cmd/Ctrl+S to save
- AI chat panel powered by the OpenAI Chat Completions API (streaming), with an option to include the currently open file as context
- Settings panel to store your OpenAI API key (encrypted at rest via Electron's `safeStorage`, using your OS keychain) and pick a model

## Screenshots

![Screenshot 1](https://drive.google.com/thumbnail?id=1EzA3xyCWtnzzAQlTsgkyzxB-BkxmM11S&sz=w1600)

![Screenshot 2](https://drive.google.com/thumbnail?id=1FexSyeuuP6sgnRFiW5lep5d-AKxjU2FC&sz=w1600)

![Screenshot 3](https://drive.google.com/thumbnail?id=1UGZ7UMcjpCef_QxgeWvISzBii6RgxCYa&sz=w1600)

## Getting started

```bash
npm install
npm run dev
```

This opens the app in development mode with hot reload.

1. Click the gear icon (Settings) in the activity bar and paste your OpenAI API key.
2. Click the files icon (Explorer) and open a folder to start browsing/editing code.
3. Click the chat icon to open the AI panel and start chatting — check "Include file as context" to send the currently open file along with your message.

## Building installers

```bash
npm run build:mac   # produces a .dmg / .zip in dist/
npm run build:win   # produces an NSIS installer in dist/ (run on Windows, or cross-build from macOS with Wine)
```

## Browser extension

`extension/` holds a Chrome extension (also works in Edge and other Chromium browsers) that brings LLMRaki's chat into a browser side panel. It runs on its own — the desktop app doesn't need to be open — and talks to OpenAI, Gemini, or a local Ollama model.

- Streaming chat with Markdown rendering, saved chat history, and a Stop button
- **Attach page**: sends your selected text, or the page's visible text if nothing is selected, along with the message. Off by default and resets after each message; the browser asks for permission the first time
- Open it with the toolbar icon or `Ctrl+Shift+L` (`Cmd+Shift+L` on macOS)
- **Automations**: repeatable tasks kept in `automations/<name>/` — an `AUTOMATION.md` (instructions, trigger word, mode) plus a `media/` folder of files used on every run, such as a résumé. They're bundled into the extension at build time; type the trigger word (e.g. `CODE COLDDM`) or press Run in Settings, and LLMRaki attaches the instructions and media automatically. When an automation needs your decision, LLMRaki asks it in the panel with one button per answer (plus a sound and a notification) and carries on after you answer. An `autoApprove` site list lets its send/submit clicks run without a prompt each time, but only after you've answered. Its trackers are kept as memory files you can view in Settings → Memory. See `automations/INDEX.md`. `media/` folders are git-ignored so personal files are never pushed
- **Attach files** with the paperclip, by dragging them onto the panel, or by pasting an image: PDF, Word (.docx), text, Markdown, CSV, JSON, HTML and code files are read as text; PNG, JPG, WebP and GIF images are sent for the model to look at. Up to 6 files per message
- Three modes, switched below the message box:
  - **Ask** — chat only; the page is never changed
  - **Edit** — reads the page and fills in text fields, dropdowns, checkboxes and rich text editors directly, each with an Undo button. Every click waits for you to allow it
  - **Auto** — fills in fields and clicks on its own, but still waits for you before any click that submits a form or sends, pays, buys, deletes or posts
- In Edit and Auto, LLMRaki can also open a website or switch to one of your open tabs, so you can start from the New Tab page or another Chrome page it can't change. Auto does this on its own; Edit asks first. Websites open in the current tab only when it's a Chrome page — otherwise in a new tab, so your page is kept
- When applying to jobs, each application that goes through gets its own chime (one note higher each time, with a short fanfare for the last) and its own notification — "Applied: Company — Role" and "Applied 3/10" — so you can count them as they happen
- In every mode, password and payment-card fields are never filled in by the assistant, and it asks you for missing details instead of making them up

```bash
npm run build:ext   # builds the extension into dist-extension/
npm run dev:ext     # rebuilds on every change
```

To install it: open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the `dist-extension` folder. After rebuilding, click the reload icon on the extension's card.

The extension uses Gemini by default. The first time it opens, it walks you through getting a free API key from [Google AI Studio](https://aistudio.google.com/apikey) and checks the key before saving it. Free tiers have rate limits, so Groq and Mistral (both free, both support page actions) can be added as backups: when the main provider hits its limit, requests carry on with the next provider that has a key — mid-task too — and LLMRaki only waits when all of them are limited. Keys come from [Google AI Studio](https://aistudio.google.com/apikey), the [Groq console](https://console.groq.com/keys) and the [Mistral console](https://console.mistral.ai/api-keys). OpenAI and Ollama can be picked in Settings instead. API keys are kept in the browser profile's extension storage, separate from the desktop app. To use Ollama from the extension, Ollama must accept requests from extensions: set the environment variable `OLLAMA_ORIGINS=chrome-extension://*` and restart Ollama.

## Notes

- The API key never leaves your machine except in direct requests to `api.openai.com`.
- If a model isn't available on your OpenAI plan, requests using it will fail — switch models in Settings.
