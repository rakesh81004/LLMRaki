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

## Notes

- The API key never leaves your machine except in direct requests to `api.openai.com`.
- If a model isn't available on your OpenAI plan, requests using it will fail — switch models in Settings.
