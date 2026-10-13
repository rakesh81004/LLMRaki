---
name: job-auto-apply
title: CODE APPLY
trigger: CODE APPLY
mode: auto
version: 1.3
description: Find fresh, well-matched jobs on Naukri.com and LinkedIn (Easy Apply) from Rakesh's resume, get his approval on a shortlist with the filled answers, apply with verified, complete answers, then find 3 LinkedIn referral contacts per company. Use for "apply N jobs on Naukri/LinkedIn", "Easy Apply on LinkedIn", "auto-apply based on my resume", or "find referrals for the companies I applied to".
media:
  - media/Rakesh S P - SDE - Resume.pdf
---

> **Platforms covered**
> - **Part A — Naukri** (Sections 1–10). Questions arrive one at a time in a chatbot, and the last answer submits the application.
> - **Part B — LinkedIn Easy Apply** (Section 15). A multi-step form with a **Review** step before **Submit**, so answers can be filled, shown to the user and then submitted.
> - **Shared:** fact sheet (Section 1.1), golden rules (Section 0), referrals (Section 11), report (Section 12), pitfalls (Section 13), run order (Section 14).

> **Changelog**
> - v1.3: Added Part B, LinkedIn Easy Apply (search for new openings, "Actively reviewing applicants" filter, fill-review-approve-submit flow, verification, hiring-team referrals).
> - v1.2: Added the candidate's CTC (current 4 LPA, expected 6 LPA), CTC answer formats, and a salary-below-expectation flag.
> - v1.1: Added the strict "no incomplete application" rule and verification sweeps.

# Naukri Auto-Apply + LinkedIn Referral Finder

Instructions for an LLM agent with browser control (for example Claude in Chrome: navigate, javascript_exec, click, type, screenshot, find, get_page_text).

This version adds a strict **"no incomplete application" rule** (Section 7). Version 1.0 caused this Naukri error:

> "Oops! Your application was not accepted due to incomplete information. Please answer all mandatory questions when reapplying."

---

## 0. Golden rules (read first, never break)

| # | Rule | Why |
|---|------|-----|
| G1 | **Never close the questionnaire drawer (✕), navigate away, or start another job while a questionnaire is open.** Answer every question until Naukri shows `Applied to "<title>"`. | Closing the drawer midway makes Naukri reject the application as incomplete. This is the root cause of the "Oops" error. |
| G2 | **Before the first Apply click, decide whether you can answer every likely question.** If you can't, ask the user before clicking Apply, not halfway through. | Prevents the half-filled state behind G1. |
| G3 | **Verify after every application** (Section 8) and run a **final sweep** over all applied jobs (Section 10). Never report "applied" without proof. | The user must be able to trust the count. |
| G4 | **Never type passwords and never create accounts** on company career portals, even if the user gives credentials. Skip those jobs and list them for the user. | Security policy. Credentials must be entered by the human. |
| G5 | **Never bypass CAPTCHA or recaptcha-protected APIs** (for example Naukri's `/jobapi/v3/search` returns `406 recaptcha required`). Use normal page navigation only. | Platform rules. |
| G6 | **Get explicit user approval of the shortlist** before submitting anything. Submitting an application cannot be undone. | Every submission is irreversible. |
| G7 | **Answers must be truthful to the resume.** Apply the user's stated experience policy only to skills that are on the resume. For skills not on the resume (for example Go, Flutter, Bootstrap, PostgreSQL), ask the user. | Avoids misrepresentation that fails in interviews. |
| G8 | Don't apply to a job already applied to (page shows `Applied`). | Avoids duplicates. |
| G9 | Close every tab the agent opened when finished. Leave the user's own tabs alone. | User asked for cleanup. |

---

## 1. Inputs to collect

1. **Resume** (PDF) → extract with `pdftotext -layout resume.pdf -`.
2. **Naukri profile.** The user must already be logged in to naukri.com in the browser. Don't log in for them.
3. **User preferences** (ask once if not given):
   - Number of jobs (N).
   - Preferred locations, and whether relocation is OK.
   - Experience policy (for example "if asked years in a tech, answer 1 year, not 0").
   - Whether to include staffing agencies or consultancies.
   - Current or expected CTC and notice period. **Never guess CTC.** For Rakesh: current **4 LPA**, expected **6 LPA**, immediate joiner.

### 1.1 Build the candidate fact sheet (from the resume only)

Fill this table before applying. Every answer comes from here.

| Field | Example value |
|---|---|
| Name | Rakesh S P |
| Total experience | ~1 year (9 months full-time + internship) |
| Core skills (eligible for the "1 year" policy) | React.js, Next.js, TypeScript, JavaScript, HTML5, CSS3, Tailwind, Node.js, Express, REST, GraphQL, MySQL, MongoDB, Prisma, Strapi, Shopify API, Git, CI/CD, GTM/GA |
| Skills NOT on resume (must ask the user) | Go, Flutter, React Native, Bootstrap, PostgreSQL, .NET, C#, Angular, PHP, production Python |
| Graduation year | 2026 (B.E. CSE, CGPA 8.74) |
| Notice period | Immediate joiner |
| Coding platforms | GeeksforGeeks (college rank 8), 400+ DSA problems |
| Solo projects | LLMRaki (AI coding agent), DSA Animator / NodeSimulator, portfolio site |
| Reason for switch | "Looking for a long-term full-time frontend role with more ownership and growth. Available to join immediately." |
| Relocation / onsite / in-person interview | Per user preference (default Yes, if the user approved) |
| Current CTC | **4 LPA** (₹4,00,000 per annum) |
| Expected CTC | **6 LPA** (₹6,00,000 per annum) |

---

## 2. Search for jobs

### 2.1 URL patterns (these work without the API)

```
https://www.naukri.com/<keyword-slug>-jobs?experience=<yrs>&jobAge=<days>
https://www.naukri.com/<keyword-slug>-jobs-in-<city>?experience=1&jobAge=7
https://www.naukri.com/<keyword-slug>-jobs-<page>?experience=1&jobAge=3      (page 2 = "-2")
https://www.naukri.com/<keyword-slug>-jobs?experience=1&jobAge=7&wfhType=2   (remote)
```

- `jobAge=3` = last 3 days (preferred), `jobAge=7` = last week (fallback).
- `experience=1` = the candidate's years.
- **Use one city per URL.** Multi-city slugs (`...-in-bangalore-chennai-hyderabad`) return very few results.
- Keyword slugs to rotate: `react-js-developer`, `react-developer`, `frontend-developer`, `next-js`, `next-js-developer`, `mern-stack-developer`, `full-stack-developer`, `javascript-developer`, `node-js-developer`, `web-developer`, `ui-developer-react`.
- Cities: candidate's city first (for example `bangalore`), then nearby or home-state cities (`chennai`, `hyderabad`), then remote, then others only if the user allows relocation.

### 2.2 Extract results (run after each navigation; the page renders on the client, so wait ~3 s)

Save results to `localStorage` so they survive navigation, and keep tool output short (tool outputs truncate at ~1,000 characters).

```js
await new Promise(r => setTimeout(r, 3000));
const m = JSON.parse(localStorage.getItem('__cj') || '{}');
[...document.querySelectorAll('.srp-jobtuple-wrapper')].forEach(e => {
  const a  = e.querySelector('a.title');
  const id = a?.href.match(/(\d{12})$/)?.[1];
  const x  = [a?.innerText.slice(0,32),
              e.querySelector('.comp-name')?.innerText.slice(0,18),
              e.querySelector('.expwdth')?.innerText.replace(' Yrs',''),
              e.querySelector('.locWdth')?.innerText.slice(0,14)].join('|');
  // freshness: job id starts with DDMMYY → keep only this month (e.g. "1026" = Oct 2026)
  if (id && /^\d\d1026/.test(id) && /\|[0-2]-/.test(x) && !/intern/i.test(x)) m[id] = x;
});
localStorage.setItem('__cj', JSON.stringify(m));
Object.keys(m).length
```

To read the results, print them in slices (`.slice(0,15)`, `.slice(15,30)` and so on) so the output isn't truncated.

### 2.3 Filtering rules

- **Freshness / recruiter actively reviewing:**
  1. The Job ID's first 6 digits are the original post date `DDMMYY`. Keep the current month only. Old IDs (for example `161025…` = Oct 2025) are reposts and are usually inactive.
  2. On the job page, `Posted:` should be "Just now / Few hours ago / Today / 1–6 days ago".
  3. Prefer jobs with "Early Applicant" in the Job match score.
- **Experience band:** minimum experience ≤ candidate years + 1 (for example 0–2, 0–3, 1–3, 1–4). Flag 2–5 as a stretch.
- **Title relevance:** keep React, Frontend, Full Stack, MERN, Next.js, Node, Web, JavaScript and Software Engineer roles. Drop roles centered on Python, .NET, SAP, Salesforce, QA, Data, PHP, WordPress, Angular, Java, Senior or Lead unless the user wants them.
- **Exclude** anything already applied.

---

## 3. Check the apply type (required before shortlisting)

Open each candidate job page and read the button:

```js
await new Promise(r => setTimeout(r, 2500));
const t = document.body.innerText;
const b = [...document.querySelectorAll('button')].map(b => b.innerText.trim()).find(x => /^Appl/.test(x));
const post = (t.match(/Posted:[^\n]*/) || [''])[0];
const ks = [...document.querySelectorAll('[class*=key-skill] a, [class*=chip]')].map(x => x.innerText).slice(0,6).join(',');
document.title.slice(0,55) + '|' + b + '|' + post + '|' + ks
```

| Button text | Meaning | Action |
|---|---|---|
| `Apply` | Naukri Easy Apply | Eligible |
| `Apply on company site` | External portal (usually needs login) | **Skip.** List it separately for the user (G4). |
| `Applied` (span) | Already applied | Skip |

Short job URL trick: `https://www.naukri.com/job-listings-x-<12-digit-id>` opens the job. If the title looks wrong (a recruiter may reuse an ID), use the full slug URL from the search result.

Expect most fresh frontend roles to be "company site". Scan about 3× N candidates to find N Easy Apply jobs.

---

## 4. Shortlist + approval (gate)

Send the user one message containing:

1. A table: `# | Role | Company | Location | Exp | Posted`, split into "Preferred locations" and "Needs relocation".
2. Flags: stretch experience (2–5 yrs), staffing agencies, tech mismatches you can predict from key skills (for example "Go", "Flutter", ".NET" in key skills means a question about it is likely).
3. **The answer policy** you will use (copy from Section 1.1).
4. Known blockers: skills not on the resume, or a listed salary below the expected CTC. **Ask about these now (G2).**
   - Salary check: if the listing shows a salary whose upper end is below 6 LPA (for example "2–3 Lacs P.A."), flag it. The user may still apply but should know it's below the expected CTC.

Then ask with choices, for example:
- Apply to all N
- Only preferred locations
- Drop agencies and stretch roles
- Let me pick

Don't submit anything until the user picks.

> **Pre-answer predictable questions.** If a job's key skills include tech not on the resume, ask the user before starting that application, for example: "Coxvi will likely ask years of Go and PostgreSQL. Answer 0 honestly, or skip?" Batch these into the same approval message.

---

## 5. Apply loop (per job)

### 5.1 Open the questionnaire

```js
// navigate to the job first, then:
await new Promise(r => setTimeout(r, 2500));
setTimeout(() => [...document.querySelectorAll('button')]
  .find(b => b.innerText.trim() === 'Apply').click(), 100);
'ok'
```

Use `setTimeout` for the click. A direct apply can navigate to `/myapply/saveApply`, which kills the running script and makes the tool call fail.

Then wait 4–5 s and read the state:

```js
(document.body.innerText.match(/Applied to[^\n]*|Oops[^\n]*/) || [''])[0]
 + ' || ' + (document.querySelector('[class*=chatbot]')?.innerText || '').slice(-300)
```

| Result | Meaning | Next |
|---|---|---|
| `Applied to "<title>"` | Applied directly, no questions | Go to Section 8 (verify) |
| Chatbot text with a question | Questionnaire open | Go to Section 6 and answer **all** questions |
| `Oops! ... incomplete information` | A previous attempt was abandoned | Re-open the job and redo Section 5 fully |
| Nothing | Page still loading | Wait 3 s and re-read; take a screenshot |

### 5.2 Window setup

Resize the browser to at least 1400×900 so the right-side drawer is fully visible. Take a screenshot to learn coordinates; positions vary by screen size.

---

## 6. Answering the chatbot questionnaire

The drawer opens on the right. The question types are:

| Type | How to detect | How to answer |
|---|---|---|
| Free text | "Type message here..." input box | Click the input, type the answer, click **Save** (bottom of drawer) |
| Radio (Yes/No, options) | Round radio buttons | Click the option, then **Save** |
| Chips (multi-option tags) | Pill buttons, sometimes "Load more" | Click the closest chip. It may auto-advance. |
| "Skip this question" | Present on optional questions only | Prefer answering. Skip only if the answer is unknown and the question is optional. |

### 6.1 Answer mapping

| Question pattern | Answer |
|---|---|
| "How many years of experience do you have in X?" (X on resume) | `1` (or the user's policy). Use a plain number; some bots re-ask if they get text. |
| Same, X **not** on resume | **Ask the user before starting this job.** If the user chose honest answers: `0`. If the bot re-asks, send a bare number. |
| "Total experience / in Development / in Web Development" | `1` |
| Graduation completion year | `2026` |
| Willing to relocate / travel to <place> / onsite / in-person interview | `Yes` (only if the user approved relocation) |
| Notice period | `Immediate` / `0 days` |
| Active on coding platforms? | `Yes - GeeksforGeeks (ranked 8th in college), 400+ DSA problems solved` |
| Projects developed alone | `3+ (LLMRaki AI coding agent, DSA Animator, portfolio site)` |
| Reason for switch | Fact-sheet text |
| Type of consulting / domain chips | Closest truthful chip (for example `IT / Technology`) |
| Full-stack / backend capability | `Yes` if Node/Express is on the resume |
| Current CTC | Number-only field: `4` (or `400000` if the field wants rupees). Text field: `4 LPA` |
| Expected CTC | Number-only field: `6` (or `600000` if the field wants rupees). Text field: `6 LPA` |
| CTC asked as a range or dropdown (for example "4-6 Lacs") | Pick the option that contains the value: current → bucket containing 4 LPA; expected → bucket containing 6 LPA |
| "Is the offered CTC of X acceptable?" | `Yes` if X ≥ 6 LPA. If X < 6 LPA, **ask the user before applying** |
| Monthly salary asked | Current ≈ `33,333`/month, expected = `50,000`/month |
| Negotiable? | `Yes, slightly negotiable` |
| Anything else unknown | **STOP before applying. Ask the user.** |

### 6.2 Loop until done

```
repeat:
  screenshot → read latest question
  answer it (text or radio) → click Save
  wait 2–3 s
until the page shows  Applied to "<title>"   (drawer closes and the green check appears)
```

The input box moves down as the conversation grows. **Take a screenshot before every click** to get its current position. Typing into the wrong spot leaves the answer empty and the bot just waits.

### 6.3 What to do if blocked mid-questionnaire

This should be rare if G2 is followed. If an unexpected question appears that only the user can answer:

1. **Don't close the drawer.** Leave the tab open on that question.
2. Ask the user immediately with the exact question text and suggested options.
3. When they answer, type it into the same open drawer and continue.
4. If the drawer was closed by accident or by a page error, the application is **not submitted**. Re-open the job and redo the whole questionnaire, then verify.

---

## 7. Root cause of the "Oops … incomplete information" error and how to prevent it

**What happened in v1.0:**
1. The agent opened a questionnaire, saw a question it wanted to confirm (for example "Flutter and React Native?"), and **clicked ✕ to pause**. Naukri treated this as an incomplete submission.
2. A batched tool call failed halfway through a questionnaire, leaving it unanswered.

**Prevention checklist:**
- [ ] Predict questions from key skills, the JD and the location before clicking Apply (G2).
- [ ] Never click ✕ on the drawer.
- [ ] Don't batch the "answer + Save" steps of a questionnaire with navigation to another job. Finish, verify, then move on.
- [ ] After every application, check that the page shows `Applied to "<title>"`. If it shows `Oops`, redo that job immediately.
- [ ] Run the final sweep (Section 10) before reporting.

---

## 8. Per-application verification (required)

After the last Save, wait 3 s and run:

```js
(document.body.innerText.match(/Applied to[^\n]*|Oops[^\n]*/) || [''])[0]
```

- `Applied to "<title>"` → record as **APPLIED**, with the job ID and the answers given.
- `Oops…` or empty → **NOT APPLIED**. Redo now (Section 5), at most 2 retries, then report it to the user.

Keep a running log:

```
| # | Job ID | Role | Company | Status | Questions & answers given |
```

---

## 9. External / company-site jobs

- Don't sign in or create accounts (G4).
- If a company page allows applying **without login** and asks only for fields in the fact sheet, it can be filled. Ask the user before the final **Submit** click.
- If it needs a login, a resume upload, or unknown fields → list it under "Needs you" with its link.

---

## 10. Final verification sweep (before reporting)

Re-open every job you applied to and confirm the `Applied` badge:

```js
// localStorage helper, used after each navigation
(async () => {
  await new Promise(r => setTimeout(r, 2500));
  const s = [...document.querySelectorAll('button, span')]
    .filter(e => e.children.length === 0)
    .map(e => e.innerText.trim())
    .find(x => /^(Applied|Apply|Apply on company site)$/.test(x)) || '?';
  return document.title.split(' - ').slice(0,3).join(' - ').slice(0,55) + ' => ' + s;
})()
```

- `=> Applied` means confirmed.
- `=> Apply` means the application did not go through. Redo it, then re-verify.
- Batch 5 jobs per tool call. Large batches can fail in the extension.

Report "X of N confirmed applied" only after this sweep.

---

## 11. LinkedIn referral finder (3 people per company)

The user must already be logged in to LinkedIn.

### 11.1 Search URL

```
https://www.linkedin.com/search/results/people/?keywords=<Company Name>
https://www.linkedin.com/search/results/people/?keywords=<Company> recruiter
https://www.linkedin.com/search/results/people/?keywords=<Company> engineer <City>
```

### 11.2 Extractor (filters to people whose card mentions the company)

Don't return `location.href` in tool output. URLs with query strings get blocked. Return pathnames only.

```js
// store once
localStorage.setItem('__ex', `(k)=>{const s=new Set();
const uniq=el=>new Set([...el.querySelectorAll('a[href*="/in/"]')].map(a=>new URL(a.href).pathname)).size;
return [...document.querySelectorAll('main a[href*="/in/"]')].map(a=>{
  const p=new URL(a.href).pathname; if(s.has(p))return null;
  let c=a; while(c.parentElement&&uniq(c.parentElement)<=1)c=c.parentElement;   // climb to this person's card only
  const raw=c.innerText; if(!new RegExp(k,'i').test(raw))return null; s.add(p);
  const deg=(raw.match(/(1st|2nd|3rd\\+?)/)||[''])[0];
  const mut=(raw.match(/[^\\n]*mutual connection[^\\n]*/)||[''])[0].slice(0,45);
  const l=raw.split('\\n').map(x=>x.trim()).filter(x=>x&&!/^\\u2022|degree|^Message|^Follow|^Connect|^View|mutual|^Current:|^Past:/.test(x));
  return [l[0],deg,l[1],l[2],mut].join(' | ').slice(0,160)+' '+p;}).filter(Boolean).join('\\n')}`);
// use after each search page loads (wait 3 s)
eval(localStorage.getItem('__ex'))('tekskills')   // regex of the company name
```

### 11.3 Rank people by likelihood of helping

1. **2nd-degree connections** (they share mutual connections, so a warm intro is possible).
2. **Same college alumni** (for example Government College of Engineering, Tirunelveli) or same home state.
3. **At small companies: founder, CEO, CTO or IT manager.** They can fast-track directly.
4. **At staffing agencies or large firms: recruiters and talent acquisition.** They control the pipeline.
5. **Engineers on the same stack** (React or Full Stack) in the job's city. They make credible referrers.
6. Prefer active profiles (recent role, "Hiring" or "Open to" banners).
7. Avoid unrelated functions (finance, KYC, design interns) unless nothing else exists. Say so when that's the case.

If no employees are found, say so and suggest the recruiter contact on the Naukri job page.

### 11.4 Output format

```
| Company (job #s) | Who to message (name — role, degree) with links |
```
Mark the top pick per company with ⭐. Link format: `https://www.linkedin.com/in/<slug>/`.

Don't send connection requests or messages unless the user explicitly approves each one.

---

## 12. Final report to the user (template)

1. **Result line:** "X of N applied and confirmed on Naukri (final sweep passed)."
2. **Applied table:** # | Role | Company | Location | Notable answers.
3. **Needs you:** company-site or login jobs with links; anything not applied, with the reason.
4. **Answers given that differ from the default policy** (honest 0s and so on).
5. **Referral table** (Section 11.4).
6. **Cleanup:** "Closed the tabs I opened; your own tabs are untouched."
7. **Security note** if the user shared a password in chat: recommend changing it.

---

## 13. Technical pitfalls and fixes

| Pitfall | Fix |
|---|---|
| Tool output truncates at ~1,000 chars | Store data in `localStorage`; print in slices; keep each row short |
| JS run fails when the page navigates (apply redirect) | Click with `setTimeout(...,100)`, return immediately, read the state in a separate call |
| `get_page_text` sometimes fails on Naukri | Use `javascript_exec` with `document.body.innerText` |
| Naukri search API → `406 recaptcha required` | Don't bypass. Use page navigation. |
| Job page HTML fetched with `fetch()` is an empty shell | Pages render on the client. You must navigate the tab. |
| Drawer coordinates change | Screenshot before each click; resize the window to at least 1400×900 |
| "Applied" not found in `button` elements | It's a `<span>`. Search leaf `button, span` elements. |
| Large `browser_batch` fails in the extension | Keep batches to about 5 navigate+check pairs |
| Recruiter reuses or edits a job ID (title changes) | Open the full-slug URL from the search result to confirm |
| LinkedIn extractor returns the same headline for everyone | Climb only to the element containing exactly one profile link (see `uniq`) |
| JS output blocked for "cookie/query string data" | Don't return `location.href` or full URLs. Return `URL.pathname` only. |

---

## 14. Minimal run order (checklist)

**Platform choice:** if the user names one platform, run only that one. If they say "both", split N between Naukri and LinkedIn, deduplicate by company + role, and give one combined report.

**LinkedIn:** follow Section 15.10 instead of steps 3–7 below.

1. [ ] Read the resume and build the fact sheet (Section 1.1). Ask for missing preferences (CTC, relocation, policy).
2. [ ] Open a **new tab** (don't disturb the user's tab).
3. [ ] Search (Section 2) and collect about 3× N fresh candidates.
4. [ ] Check the apply type (Section 3) and keep Easy Apply only.
5. [ ] Predict blockers, then send the shortlist, answer policy and questions for approval (Section 4).
6. [ ] For each approved job: open, answer **all** questions, verify (Sections 5, 6, 8). Never close a drawer.
7. [ ] Final sweep (Section 10). Redo any failures.
8. [ ] LinkedIn referrals (Section 11).
9. [ ] Close the agent's tabs and send the final report (Section 12).

---

# PART B — LinkedIn Easy Apply

## 15. LinkedIn Easy Apply workflow

> All golden rules in Section 0 still apply: no passwords, no account creation, no CAPTCHA bypass, approval before submitting, truthful answers, verification, tab cleanup.
> The user must already be **logged in to LinkedIn** in the browser. If the page shows a login wall, stop and ask the user to log in themselves.
> LinkedIn changes its CSS class names often. **Find elements by visible text or aria-label** (for example the `find` tool: "Easy Apply button", "Next button", "Submit application button"), not by hard-coded class names. The selectors below are best-effort; fall back to `find` plus a screenshot.

### 15.1 Key difference from Naukri (why the flow is better here)

| | Naukri | LinkedIn Easy Apply |
|---|---|---|
| Question format | Chatbot, one question at a time | Multi-page modal form (Contact → Resume → Questions → **Review**) |
| When the application is submitted | Instantly, on the last answer | Only when **"Submit application"** is clicked |
| Can you fill first and approve later? | No | **Yes.** Fill every page, stop at Review, show the user, then submit. |
| Leaving midway | Application rejected as incomplete | LinkedIn asks "Save this application?". **Save** keeps a draft, Discard deletes it. |

So on LinkedIn, follow the user's preferred flow exactly: **fill each job up to the Review page → collect all filled data → one approval notification → submit all approved → verify → close tabs.**

### 15.2 Search for newly created openings

URL template:

```
https://www.linkedin.com/jobs/search/?keywords=<kw>&location=<loc>&f_AL=true&f_TPR=<age>&f_E=<level>&sortBy=DD
```

| Param | Value | Meaning |
|---|---|---|
| `keywords` | `react developer`, `frontend developer`, `next.js`, `mern stack`, `full stack developer react node`, `javascript developer` | Rotate these |
| `location` | `Bengaluru, Karnataka, India`, `Chennai`, `Hyderabad`, `India` | One per search |
| `f_AL=true` | Easy Apply only | **Always on** |
| `f_TPR` | `r86400` = past 24 h (preferred), `r259200` = 3 days, `r604800` = 1 week | Freshness |
| `f_E` | `1` internship, `2` entry level, `3` associate (use `2,3` for ~1 yr) | Experience level |
| `f_WT` | `1` onsite, `2` remote, `3` hybrid (optional) | Work type |
| `sortBy=DD` | Most recent first | Newest openings on top |
| `start` | `0`, `25`, `50` … | Pagination (25 per page) |

Example:
```
https://www.linkedin.com/jobs/search/?keywords=react%20developer&location=Bengaluru%2C%20Karnataka%2C%20India&f_AL=true&f_TPR=r86400&f_E=2%2C3&sortBy=DD
```

### 15.3 Extract job cards (store in localStorage; don't print full URLs)

```js
await new Promise(r => setTimeout(r, 3500));
// scroll the results list so lazy cards load
const list = document.querySelector('.jobs-search-results-list, .scaffold-layout__list');
for (let i = 0; i < 6; i++) { list?.scrollBy(0, 800); await new Promise(r => setTimeout(r, 600)); }
const m = JSON.parse(localStorage.getItem('__li') || '{}');
document.querySelectorAll('li[data-occludable-job-id], [data-job-id]').forEach(li => {
  const id = li.getAttribute('data-occludable-job-id') || li.getAttribute('data-job-id');
  const t = li.innerText.split('\n').map(x => x.trim()).filter(Boolean);
  if (!id || !t.length) return;
  const txt = t.join(' | ');
  m[id] = {
    title: t[0].slice(0, 45),
    company: (t[1] || '').slice(0, 25),
    loc: (t[2] || '').slice(0, 25),
    active: /Actively reviewing/i.test(txt),
    applied: /\bApplied\b/i.test(txt),
    promoted: /Promoted/i.test(txt),
    age: (txt.match(/\d+\s+(minute|hour|day|week)s?\s+ago|Just now/i) || [''])[0]
  };
});
localStorage.setItem('__li', JSON.stringify(m));
Object.keys(m).length
```

Print results compactly in slices:
```js
Object.entries(JSON.parse(localStorage.getItem('__li')))
  .filter(([k,v]) => !v.applied)
  .map(([k,v]) => [k, v.title, v.company, v.loc, v.age, v.active ? 'ACTIVE' : ''].join('|'))
  .slice(0, 20).join('\n')
```

Job page: `https://www.linkedin.com/jobs/view/<id>/`

### 15.4 Filtering ("recruiter actively reviewing" and freshness)

Keep a job only if **all** of these hold:

1. The **Easy Apply** button is present on the job page. "Apply" with an external-link icon means a company site; skip it (Section 9).
2. Posted **≤ 3 days ago** (prefer ≤ 24 h). On the job page, read the top line, for example "Bengaluru · 5 hours ago · 37 applicants".
3. **Strong signal:** the badge **"Actively reviewing applicants"** or "Responses managed off LinkedIn" / "Hiring team active". Rank jobs with "Actively reviewing applicants" first.
4. Not already "Applied", and not reposted (a "Reposted X days ago" label counts as weaker freshness).
5. Experience and title relevance rules from Section 2.3. Read the "About the job" text for years required.
6. Applicant count: prefer < 100 applicants (higher response odds). Flag "Over 100 applicants".
7. Skip "Promoted" jobs that are old or irrelevant. Promoted only means paid placement.

Job page reader:
```js
await new Promise(r => setTimeout(r, 3000));
const top = document.querySelector('.job-details-jobs-unified-top-card__container--two-pane, .jobs-unified-top-card, main');
const txt = top?.innerText || '';
const easy = [...document.querySelectorAll('button')].some(b => /Easy Apply/i.test(b.innerText));
const applied = /Applied \d|Application submitted|\bApplied\b/i.test(txt);
[document.title.slice(0, 60),
 easy ? 'EASY' : 'EXTERNAL',
 applied ? 'APPLIED' : '',
 (txt.match(/[^\n]*ago[^\n]*/i) || [''])[0].slice(0, 80),
 /Actively reviewing/i.test(document.body.innerText) ? 'ACTIVE' : ''].join(' | ')
```

### 15.5 Fill each application up to Review (don't submit yet)

For each shortlisted job:

1. Navigate to `https://www.linkedin.com/jobs/view/<id>/`, wait 3 s.
2. Click **Easy Apply** (use `find` → "Easy Apply button", then click the ref). A modal opens.
3. **Loop over the modal pages:**
   - Screenshot the modal and read every field on the current page.
   - Fill each field from the fact sheet (Section 1.1) and the answer table (15.6).
   - Click **Next** (or **Review** on the last questions page).
   - If LinkedIn shows a red error ("Please enter a valid answer", "Enter a whole number between 0 and 99"), fix that field and retry. **Never move past a page with errors.**
4. Stop on the **Review your application** page. **Don't click "Submit application".**
5. Read and record every filled field (the Review page lists them all):
   ```js
   (document.querySelector('[role="dialog"]')?.innerText || '').slice(0, 1500)
   ```
6. Close the modal with ✕, then choose **Save** in the "Save this application?" prompt. This keeps the draft so nothing is lost. **Never choose Discard.**
   - Alternative (if the user prefers speed and has pre-approved the answer policy): keep each job open in its own tab at the Review page, at most 10 tabs at once.
7. Log: `job id | role | company | each question → answer | resume chosen | flags`.

**Mandatory-field rule (same spirit as Naukri G1):** every field marked required (`*`, or "Required" in its aria-label) must be filled before Next. If a required field needs an answer you don't have (unknown skill, a document you don't have, portfolio link not in the fact sheet), **leave the draft saved and put the question in the approval notification.** Don't guess.

### 15.6 LinkedIn field → answer mapping

| Field / question (typical wording) | Type | Answer |
|---|---|---|
| First / Last name, Email, Phone country code, Mobile | Prefilled text/select | Keep the profile values. If empty, use the resume. Check the phone is `+91 9043297664` |
| City / Location | Typeahead | `Bengaluru, Karnataka, India`. Type it, wait, then pick from the dropdown |
| Resume | Radio list of uploaded resumes | Pick the newest "Rakesh S P – SDE – Resume". **If none is uploaded, or LinkedIn requires a new upload → notify the user** |
| Cover letter (optional) | Upload/text | Skip if optional. If required → notify the user |
| "How many years of work experience do you have with X?" (X on resume) | Number | `1` |
| Same, X **not** on resume | Number | Ask the user (honest default `0`). Note: many forms reject 0 as "not qualified" but it's still valid |
| "Are you comfortable commuting to / relocating to <city>?" | Yes/No | `Yes` (if the user allows relocation) |
| "Are you legally authorized to work in India?" | Yes/No | `Yes` |
| "Will you require visa sponsorship?" | Yes/No | `No` (for India roles) |
| Notice period | Text/number/select | `0` / `Immediate` / `Immediately available` |
| Current CTC | Number/text | `400000` if it asks for rupees, `4` if it asks for LPA, else `4 LPA` |
| Expected CTC | Number/text | `600000` / `6` / `6 LPA` |
| Highest education / Bachelor's completed? | Select/Yes-No | `Bachelor's Degree` / `Yes` (B.E. CSE, 2026, CGPA 8.74) |
| Graduation year | Number | `2026` |
| LinkedIn profile URL | Text | `https://www.linkedin.com/in/rakesh-sp-37863b253` |
| Portfolio / website | Text | `https://rakesh-sp-portfolio.netlify.app` |
| GitHub | Text | `https://github.com/rakesh81004` |
| "Rate your proficiency in React" (1–10) | Number | Use the fact sheet. Suggested: React 7, JavaScript 7, TypeScript 6, Node 5. **Confirm the scale with the user once** |
| Gender, race, disability, veteran status (voluntary self-ID) | Select | Choose **"Prefer not to say" / "I don't wish to answer"** unless the user specifies |
| "Why do you want to join us?" / summary | Textarea | 2–3 truthful lines from the resume plus the company name. **Show it in the approval notification** |
| Follow company checkbox (Review page) | Checkbox | **Uncheck** (privacy-preserving default) unless the user wants to follow |
| Anything unknown | — | Leave it, save the draft, add it to the notification |

**Number fields:** LinkedIn validates "whole number". Never type "1 year" in a numeric box; type `1`.

### 15.7 Approval notification (one message for all jobs)

Send to the user (SendUserMessage or a push notification if available), then ask with options:

```
LinkedIn Easy Apply — N applications filled, waiting for your approval

| # | Role | Company | Location | Posted | Signal | Applicants |
|---|------|---------|----------|--------|--------|------------|
| 1 | Frontend Developer | Acme | Bengaluru | 6 h ago | Actively reviewing | 24 |
...

Filled answers (same for all unless noted):
- Years in React/JS/TS/Node/Next.js: 1 · Notice: Immediate · Current CTC 4 LPA · Expected 6 LPA
- Relocate/commute: Yes · Work authorization: Yes · Sponsorship: No
- Resume: "Rakesh S P – SDE – Resume" (uploaded <date>)
Job-specific answers:
- #3 Acme: "Years with Go?" → 0 (honest)
- #7 Beta: "Why us?" → "<2-line text>"
Needs you:
- #9 Gamma requires a cover letter upload
```

Options: **Submit all** / **Submit all except flagged** / **Let me pick** / **Edit an answer**.

### 15.8 Submit and verify

For each approved job:

1. Open `https://www.linkedin.com/jobs/view/<id>/` → click **Easy Apply** (or **Continue applying** for a saved draft). The modal reopens with saved answers.
2. Click **Next** through the pages without changing anything. Re-check that every field still matches the approved data.
3. On **Review**, uncheck "Follow <company>" (unless the user wants it) → click **Submit application**.
4. **Verify (required):** wait 3 s and confirm one of these:
   - A modal saying "Your application was sent to <Company>" / "Application submitted".
   - Or, after reloading the job page, the top card shows "Applied X minutes ago" / "Application submitted".
   ```js
   /Your application was sent|Application submitted|Applied \d+ (second|minute)s? ago/i.test(document.body.innerText)
   ```
5. Click **Done** / ✕ to close the confirmation.
6. If verification fails → reopen and retry once. Then mark it NOT APPLIED and report it.
7. Close that job's tab if it was opened separately.

**Final sweep:** re-open every submitted job ID and check for "Applied" on the top card, in batches of 5. Also cross-check `https://www.linkedin.com/my-items/saved-jobs/?cardType=APPLIED` (My jobs → Applied).

### 15.9 LinkedIn-specific referral boost

On each LinkedIn job page, look for **"Meet the hiring team"**. The job poster or hiring manager listed there is the **#1 referral or contact pick** (⭐), ahead of Section 11's ranking. Then add 2 more people using Section 11 (2nd-degree, alumni, same-stack engineers, recruiters).

```js
const sec = [...document.querySelectorAll('section, div')].find(e => /Meet the hiring team/i.test(e.innerText) && e.innerText.length < 800);
sec ? [...sec.querySelectorAll('a[href*="/in/"]')].map(a => a.innerText.trim().split('\n')[0] + ' ' + new URL(a.href).pathname).join('\n') : 'none'
```

Don't send messages or connection requests without the user's explicit per-message approval.

### 15.10 LinkedIn run order (checklist)

1. [ ] Confirm the user is logged in to LinkedIn and a resume is uploaded in Easy Apply settings (if not → notify).
2. [ ] Build or reuse the fact sheet (Section 1.1), including CTC 4 / 6 LPA.
3. [ ] Open a **new tab**. Search with `f_AL=true&f_TPR=r86400&sortBy=DD` (widen to `r259200` if fewer than N found).
4. [ ] Extract cards (15.3). Rank "Actively reviewing applicants" first. Filter (15.4).
5. [ ] For each: fill up to **Review** (15.5–15.6), **Save** the draft, log the answers.
6. [ ] Send **one** approval notification with all filled data (15.7). Wait.
7. [ ] Submit approved jobs, verifying each (15.8).
8. [ ] Final sweep, then collect the hiring team plus 2 referral contacts per company (15.9 + Section 11).
9. [ ] Close all tabs the agent opened. Final report (Section 12), with a "Platform" column.

### 15.11 LinkedIn pitfalls

| Pitfall | Fix |
|---|---|
| Class names change | Use `find` by visible text / aria-label plus screenshots |
| Results list lazy-loads | Scroll the left list container before extracting |
| Typeahead city field doesn't accept typed text | Type, wait 1 s, press ArrowDown + Enter, or click the suggestion |
| "Enter a whole number" error | Numeric fields take digits only |
| Modal closed accidentally | Choose **Save** in the prompt; resume via "Continue applying" |
| Too many applications too fast | LinkedIn may rate-limit Easy Apply. Pace at about 1 submission per 30–60 s and stop if a limit or warning appears; tell the user |
| Security check / CAPTCHA / "verify you're human" | **Stop.** Ask the user to complete it (G5) |
| External "Apply" (no Easy Apply) | Skip; list under "Needs you" (Section 9) |
| Output blocked for query strings | Return pathnames / job IDs only, never full URLs with `?` |
