# Efficient File Search + Chat UI Presentation for LLM Apps

Extracted from building LLMRaki (a VS Code–style editor with a built-in AI chat).
These are the patterns that actually mattered — not theory, things that fixed real
bugs or noticeably improved the experience.

---

## Part 1 — Efficient File Search

The core problem: an LLM answering questions about a codebase needs *some* files'
content in its context window, but you can't dump the whole repo in — it's too
slow, too expensive, and buries the model in irrelevant text. You need a cheap,
local way to find "probably relevant" files before any LLM call happens.

### 1.1 Two search modes, not one

Build **two** distinct search functions, not one:

| | Purpose | Returns |
|---|---|---|
| `search_files` | "What's out there?" — broad discovery | Many results (10–20), short snippets only |
| `read_file` | "Show me this specific thing" | One file, full content |

If you only have "search returns full content," you either return too much (every
match's entire file — huge token cost) or too little (can't actually read
anything). Splitting the two lets an LLM agent search cheaply, decide what's
worth a closer look, then read only those 1–3 files in full.

### 1.2 The scoring function (fast, local, no LLM call)

This is the workhorse — a pure keyword-matching scorer that runs in plain
Node/JS, no embeddings, no vector DB, no network call. For a single developer's
project (thousands of files, not millions), this is fast enough to run on every
keystroke-triggered search and genuinely "good enough."

```ts
const STOPWORDS = new Set(['the','is','are','how','what','when','where','why',
  'which','who','with','from','this','that','does','for','and','of','in','on',
  'explain','about','show','tell','please'])

function extractKeywords(query: string): string[] {
  const words = query.toLowerCase().match(/[a-z0-9_]+/g) ?? []
  return [...new Set(words.filter(w => w.length >= 3 && !STOPWORDS.has(w)))].slice(0, 12)
}

async function findMatchingFiles(root: string, query: string, maxResults: number) {
  const keywords = extractKeywords(query)
  if (keywords.length === 0) return []

  const files = await walkProjectFiles(root) // skip node_modules, .git, dist, etc.
  const candidates = []

  for (const file of files) {
    if (isBinaryExtension(file)) continue

    // Filename matches are worth more than content matches — a file literally
    // named "auth.ts" is almost certainly more relevant to "auth" than a file
    // that merely mentions the word once in a comment.
    let score = 0
    const lowerPath = file.toLowerCase()
    for (const kw of keywords) if (lowerPath.includes(kw)) score += 5

    const stat = await fs.stat(file)
    if (stat.size > MAX_FILE_SIZE) continue // don't read huge files just to score them

    const content = await fs.readFile(file, 'utf-8')
    const lowerContent = content.toLowerCase()
    for (const kw of keywords) {
      const occurrences = lowerContent.split(kw).length - 1
      score += Math.min(occurrences, 5) // cap so one huge file doesn't dominate purely by size
    }

    if (score > 0) candidates.push({ path: file, score, content })
  }

  candidates.sort((a, b) => b.score - a.score)
  return candidates.slice(0, maxResults)
}
```

Key details that matter in practice:
- **Cap per-keyword content-match contribution** (`Math.min(occurrences, 5)`) — otherwise a
  1000-line config file that happens to repeat a common word wins by sheer size, not relevance.
- **Weight filename matches higher than content matches.**
- **Skip files above a size threshold** before reading them at all (e.g. 2MB) — don't pay the
  I/O cost of reading a lockfile just to score it.
- **Hard-exclude binary extensions** (`png`, `jpg`, `lock`, `woff`, etc.) up front.
- **Ignore directories once, at the walk level** (`node_modules`, `.git`, `dist`, `out`,
  `.next`, `.cache`) — don't even descend into them.

### 1.3 Give the LLM real line numbers — don't make it count

This was the single highest-value fix we made. If you hand a model raw file
content and ask it to cite a line number, it will guess (badly). The fix: number
every line yourself before it ever reaches the model.

```ts
function withLineNumbers(content: string): string {
  return content.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n')
}
```

Feed `withLineNumbers(fileContent)` into your `read_file` tool result and into any
pre-injected file context. Then instruct the model explicitly:

> "Each file has its lines prefixed with `N: ` (real line numbers) — never guess
> or count them yourself. When quoting code, strip that prefix so the shown code
> is clean, but mark the first line of any real excerpt with a hidden
> `LOC_START:N` marker so the UI can number it correctly."

Your UI then parses that `LOC_START:N` marker, strips it, strips any leaked `N: `
prefixes the model echoed back, and uses `N` as the starting line for its own
gutter — instead of always rendering "line 1" for every snippet regardless of
where it actually came from in the file.

### 1.4 For an agentic loop: give the model tools, not one big context dump

Two competing approaches:

1. **Pre-injection (RAG-lite)**: run the scorer above once, stuff the top N files into the
   prompt, send one request. Simple, fast, works with any model (no function-calling needed).
2. **Agentic tools**: give the model `search_files`, `read_file`, `list_directory` as
   callable functions and let it decide what to look at, iterating across multiple turns.

Pre-injection is a good default for models without reliable tool-calling. But agentic
tools produce meaningfully better answers for open-ended questions ("how does X work
in this codebase?") because the model can follow leads — search, notice a promising
file, read it, notice it imports something else, search for *that*. A single
pre-injected batch can't adapt like that.

If you build the agentic version, the loop shape is:

```ts
async function runAgentLoop(messages, tools) {
  let contents = toModelFormat(messages)
  let data = await callModel(contents, tools)

  for (;;) {
    const functionCalls = extractFunctionCalls(data)
    if (functionCalls.length === 0) {
      return extractFinalText(data) // model is done, no more tool calls requested
    }

    contents.push({ role: 'model', parts: data.parts })
    const results = []
    for (const call of functionCalls) {
      const result = await executeTool(call.name, call.args) // your search/read/list
      results.push({ functionResponse: { name: call.name, response: { result } } })
    }
    contents.push({ role: 'user', parts: results })

    data = await callModel(contents, tools) // loop again with the new context
  }
}
```

Cap the total tool-call count (e.g. 12) so a confused model can't loop forever —
but when the cap is hit, tell it explicitly ("tool limit reached — answer with what
you have") rather than just cutting it off silently.

### 1.5 Fuzzy matching for a "Quick Open" / Cmd+P style file picker

This is a different problem from content search — the user is typing partial,
possibly out-of-order characters of a filename they already know
(`fexp` → `FileExplorer.tsx`). Subsequence matching, not substring matching:

```ts
function fuzzyMatch(text: string, query: string) {
  if (!query) return { indices: [], score: 0 }
  const t = text.toLowerCase(), q = query.toLowerCase()
  const indices: number[] = []
  let cursor = 0, score = 0, consecutive = 0

  for (const ch of q) {
    const foundAt = t.indexOf(ch, cursor)
    if (foundAt === -1) return null // query char not found in order — no match
    if (foundAt === cursor) { consecutive++; score += consecutive * 3 } // reward contiguous runs
    else consecutive = 0
    indices.push(foundAt)
    cursor = foundAt + 1
  }
  score += Math.max(0, 15 - indices[0]) // reward early matches (start of filename > deep in path)
  return { indices, score }
}
```

Return the matched `indices` alongside the score — you'll want them to highlight
exactly which characters matched in the UI (see Part 2.3).

---

## Part 2 — Presenting Results in the Chat UI

Finding the right files is half the problem. The other half is making the process
and the results legible to the user in real time.

### 2.1 Show live progress, not a static spinner

The single biggest perceived-quality jump: while the agent loop is
searching/reading, stream each tool call's label to the UI as it happens and
show the *current* one, not a generic "thinking...":

```
Thinking          →  (before anything happens)
Searched for "strapi" (5 matches)   →  (as each tool call resolves)
Read src/lib/cms.ts
Searched for "webhook" (2 matches)
```

Implementation: emit a progress event from your backend on every tool
execution, append to an array on the in-flight message, and render the *last*
entry as a live status line with an animated indicator (three pulsing dots is
enough — CSS `animation-delay` staggered across three `<span>`s). After
completion, keep the full list available in a collapsed `<details>` — "Explored
4 files, 5 searches" — so the user can audit exactly what was searched without
it cluttering the default view.

### 2.2 Render real Markdown, not a text blob

Don't just dump the raw string into a `<div>`. Use a Markdown renderer
(`react-markdown` + `remark-gfm` for tables/strikethrough is enough) so headers,
lists, bold, and tables actually render. One easy-to-miss CSS bug: if your chat
bubble uses `white-space: pre-wrap` (needed for *plain-text* user messages), that
same rule applied to *Markdown-rendered* content double-spaces everything —
the raw `\n\n` in the source AND the `<p>` margins both add a gap. Scope
`white-space: normal` to the Markdown container specifically.

### 2.3 Highlight matched characters in search results

For the Quick Open picker (2.1.5 above), render each character and wrap the
matched-index ones in a styled span:

```tsx
function HighlightedText({ text, indices }: { text: string; indices: number[] }) {
  const marked = new Set(indices)
  return <>{text.split('').map((ch, i) =>
    marked.has(i) ? <span key={i} className="match-highlight">{ch}</span> : ch
  )}</>
}
```

Pair with a small colored file-type badge per extension (a 2–3 letter label in a
colored rounded box — `TS` blue, `JSON` orange, `MD` grey, etc.) instead of one
generic file icon. Cheap to build (a lookup table), and it's what makes a file
list look "real" instead of placeholder-y.

### 2.4 Make file citations clickable

If your model cites files as `` `path/to/file.ts:42` `` in backticks (ask it to,
explicitly, in your system prompt), you can intercept inline-code rendering in
your Markdown renderer and turn matches into buttons instead of plain text:

```tsx
const FILE_REF_REGEX = /^([\w@][\w\-./]*\.[a-zA-Z][a-zA-Z0-9]{0,9})(?::(\d+))?$/

// inside your markdown renderer's `code` component override:
const match = !hasLanguageClass && text.match(FILE_REF_REGEX)
if (match) {
  const [, relPath, lineStr] = match
  return <button onClick={() => openFile(resolvePath(root, relPath), Number(lineStr))}>
    📄 {text}
  </button>
}
```

The regex requires a letter-led extension (`[a-zA-Z][a-zA-Z0-9]{0,9}`) specifically so
it doesn't false-positive on version numbers like `1.2.3`.

**Make the click handler resilient.** The model won't always cite the exact
root-relative path — it might drop a subfolder prefix. Don't just fail silently;
fall back to searching your file list for a path that *ends with* the cited
suffix, or matches by basename, before giving up with a visible error. Silent
failure ("I clicked it and nothing happened") is the worst outcome — a wrong
match or a clear "couldn't find that file" beats doing nothing.

### 2.5 Syntax-highlight code blocks properly

If you're building an Electron/desktop app and already bundle Monaco (VS Code's
editor component) for the main editor, reuse its tokenizer instead of pulling in
a separate highlighting library — you get pixel-identical colors between "viewing
the file" and "code shown in chat," for free:

```ts
const html = await monaco.editor.colorize(code, monacoLanguageId, { tabSize: 2 })
// render html via dangerouslySetInnerHTML inside your <code> element
```

Two gotchas:
- Call `monaco.editor.setTheme(...)` once at app startup (not lazily on first
  editor mount) — otherwise the theme's color CSS classes aren't registered yet
  the first time a chat response tries to colorize code before any real editor
  tab has ever been opened.
- `colorize` is async — render plain text as a fallback while it resolves, then
  swap in the highlighted HTML.

### 2.6 Turn off "fake" diagnostics if you can't back them up

If your code viewer runs a real language server (TypeScript, ESLint, etc.) with
full project context (`node_modules`, `tsconfig.json`, path aliases all
resolved), red squiggly error indicators are genuinely useful. If it *doesn't*
have that context — no real module resolution — disable semantic validation
entirely. Otherwise every unresolved import and every JSX tag (which needs an
explicit `jsx` compiler option to even parse) shows up as a false "error,"
training users to ignore the indicator entirely. A feature that's wrong most of
the time is worse than no feature.

### 2.7 Transparency: show what was actually used

Whenever you inject file content into a prompt (pre-injection or agent-read),
render small removable chips under the user's message showing which files were
included — clickable to jump straight to that file. This does double duty: it
builds trust (the user can verify the model actually saw the right code) and
gives you a debugging tool for free when an answer looks wrong.

### 2.8 Handle empty / blocked responses gracefully

Don't treat "model returned no text" as a single failure mode. Inspect the
actual response metadata:

- `finishReason: 'SAFETY'` or `'RECITATION'`, or a `promptFeedback.blockReason` →
  genuinely blocked. Retrying won't help; show the real reason.
- Anything else (often `MAX_TOKENS` after a long tool-calling conversation, or a
  one-off empty turn) → **retry once automatically** with an explicit nudge:
  *"You returned nothing — give your final answer now, summarizing what you
  found."* This alone resolves the large majority of empty-response cases after
  a long agentic search, since the model just needs an unambiguous prompt to
  wrap up rather than continue exploring.
- Only surface an error to the user after that one retry also comes back empty
  — and include the `finishReason` in the message so it's an actual diagnostic,
  not "something went wrong."

### 2.9 Model/provider fallback belongs on *every* call, not just the first

If you support multiple models with automatic fallback (e.g. free-tier rate
limits), don't just pick a working model once at the start of a conversation and
assume it stays available. In a multi-turn agentic loop, a model can get
rate-limited *mid-conversation* after several tool-calling round trips. Route
**every** call in the loop through the same fallback-across-candidates logic,
and remember (for that single request) which candidates already failed, so you
don't waste an attempt re-trying a bucket you just emptied.

---

## Summary checklist

- [ ] Two-tier search: cheap broad `search_files`, expensive targeted `read_file`
- [ ] Score by filename match (weighted higher) + capped content match count
- [ ] Skip binary extensions and oversized files before reading them
- [ ] Number every line of injected file content — never make the model count
- [ ] `LOC_START:N` (or similar) convention so cited excerpts show real line numbers
- [ ] Live per-step progress indicator during agentic search, collapsible full log after
- [ ] Real Markdown rendering, with `white-space` scoped correctly
- [ ] Fuzzy subsequence matching + highlighted characters for Quick Open
- [ ] Clickable file citations with a resilient fallback resolver
- [ ] Reuse your editor's real tokenizer for chat code blocks if you have one
- [ ] Don't show error squiggles you can't actually back with real project context
- [ ] Show which files were used as context, as clickable chips
- [ ] Distinguish blocked responses from empty-and-retryable ones
- [ ] Model/provider fallback on every call in a loop, not just the first
