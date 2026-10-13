---
name: code-colddm
title: CODE COLDDM
trigger: CODE COLDDM
mode: auto
description: Find fresh LinkedIn hiring managers (Engineering Managers, Heads of Engineering, startup CTOs, Technical Project Managers) in Bengaluru and Chennai who can hire Rakesh S P and are likely to reply to a cold DM. Screen them with evidence, present a ranked list, and optionally send connection invites with a fixed note.
media:
  - media/Rakesh S P - SDE - Resume.pdf
---

# CODE COLDDM: LinkedIn Hiring-Manager Finder

This skill works with any LLM that can control a real, logged-in browser: it needs to navigate, read page text, run JavaScript, click and type.
It has two phases:

- **Phase A (Find):** fully read-only. It finds, screens, ranks and presents people.
- **Phase B (Invite):** it sends connection requests with a note, **only after the user explicitly asks** in chat.

---

## 0. Ground rules (read first)

1. **Use the user's own logged-in browser session.** Never log in, never handle passwords, and never solve CAPTCHAs. If LinkedIn shows a login wall, a CAPTCHA or a "unusual activity" warning, **stop and tell the user**.
2. **Phase A is read-only.** Do not click Connect, Follow or Message, and do not react, during Phase A.
3. **Pacing.** Behave like a human. Aim for about **50 page loads per run** (search pages plus profile pages) and never go above about **70**. Wait 2–3 s after each navigation before reading.
4. **Only state facts you actually saw on the page.** If a number is hidden, write "not shown" and never guess. Never invent a profile URL.
5. **Don't pad.** If fewer than 10 people pass, list fewer, say how many are missing and why, and offer clearly-labelled backups.
6. **Don't navigate away from a page where the user is typing** (for example a chat or a draft). Open a new tab for the work, tell the user, and close it when you're done.

---

## 1. Candidate profile (who we pitch)

Rakesh S P is a Frontend Engineer with about 9 months of production experience. He is an immediate joiner, based in Bengaluru and open to Chennai.

- **Invictus Data (client: Viome, a US health e-commerce company), Jan–Sep 2026.**
  - Built with React, Next.js App Router, TypeScript and Strapi CMS.
  - Integrated the Shopify Storefront API (REST and GraphQL).
  - Ran Statsig A/B tests.
  - Raised Lighthouse scores from 60 to 90+.
  - Fixed WCAG accessibility issues.
  - Cut landing-page build time from 3 days to 4 hours.
- **Nexus (part-time), Aug–Sep 2026.** Built a Next.js + TypeScript landing page.
- **ICANIO Technologies, Node.js intern.** Built JWT/RBAC APIs with Express and MongoDB.
- **Skills:** React, Next.js, TypeScript, JavaScript, Tailwind, Zustand, Node.js, Express, REST, GraphQL, MySQL, MongoDB, Prisma, Strapi, GenAI/LLM/RAG/MCP, CI/CD, GTM/GA, SEO.
- **Projects:**
  - LLMRaki, an Electron + React AI coding agent.
  - AI Stampede Detection with YOLOv8, which won 1st prize.
  - DSA Animator / NodeSimulator.
- **Target roles:** Frontend, Full-stack, SDE-1, React/Next.js, and AI/ML engineer roles at 0–2 years of experience. **No QA or tester roles.**
- **Links:** LinkedIn https://www.linkedin.com/in/rakesh-sp-37863b253/ and portfolio https://rakesh-sp-portfolio.netlify.app/

If the user attaches a newer resume, read it and use that instead.

---

## 2. Selection rules (the filter)

A person **qualifies** only if all 7 rules pass.

| # | Rule | How to check | Pass condition |
|---|---|---|---|
| 1 | **Can hire** | Headline and current title | Engineering Manager, Sr/Principal EM, Head/Director/VP of Engineering, CTO or tech Co-founder at a small company, or a Technical Project Manager who leads devs. **Reject:** recruiters, HR, pure ICs (SDE, Staff Engineer), product managers, and anyone with an **#OpenToWork** badge, since they are job-hunting themselves. |
| 2 | **Not a giant company** | Company name; company page employee count if unsure | About 20–3,000 employees: product startups, funded scale-ups, mid-size SaaS, e-commerce, fintech or healthtech. **Reject:** TCS, Infosys, Wipro, HCL, Tech Mahindra, Cognizant, Accenture, Capgemini, IBM, Deloitte, EY, KPMG, PwC, LTIMindtree, Altimetrik, Google, Microsoft, Amazon, Meta, Apple, Oracle, Salesforce, Adobe, Atlassian, Walmart, Flipkart, Swiggy, Zomato, Freshworks, athenahealth, Docusign, GM and similar. |
| 3 | **Location** | Profile location line | Bengaluru or Chennai (Greater Chennai Area counts). |
| 4 | **Small network** | Profile top card and the activity-page "Followers" number | **Best:** exact connections shown (under 500), e.g. "329 connections". **OK:** "500+ connections" **and** followers under about 1,000. **Soft fail:** followers 1,000–2,000. **Hard fail:** followers over 2,000. |
| 5 | **Active** | `/recent-activity/all/` (and `/reactions/` or `/comments/` if posts are old) | Posted, reposted, commented or reacted within about the **last 30 days**. Write down the age (e.g. "3w") and what it was. |
| 6 | **Tech match** | Headline, posts, hiring posts, company product | Team uses React, Next.js, Node, TypeScript or JavaScript, or does AI/LLM/CV work, or is in e-commerce/D2C (a Shopify/Viome match). |
| 7 | **Fresh** | Sent-invitations list, the profile button, and the history file | Not a 1st-degree connection, no **Pending** invite, and not suggested in an earlier run. |

### Bonus signals (rank higher)

- They posted or reposted a **hiring post** for their own team, especially for 0–5 years or full-stack/frontend roles.
- The company recently raised funding (seed, Series A or Series B).
- Their team recently hired someone with Rakesh's stack. You can see this when they like a "I joined X as a Node/React engineer" post.
- A **Message** button on a 3rd-degree profile, which means you can DM them without connecting first.
- Shared background: Tamil Nadu, GCE Tirunelveli, health e-commerce, Shopify or Strapi.

### Relaxation ladder (only when the pool is too thin)

1. First, accept a **soft fail on rule 4** (followers 1,000–2,000) **if** the person is actively hiring or posted within the last 7 days. Mark it with ⚠️.
2. Next, list people who miss exactly one rule as **Backups** (for example, network under 500 but inactive, or a good fit at a large company). Mark them clearly.
3. Never relax rule 1 (can hire) or rule 7 (fresh).

---

## 3. Research method (step by step)

### Step 1: Load history
Read the history file `colddm-tracker` (memory or a local file). It holds:

- everyone already suggested
- everyone screened and rejected in past runs

Exclude all of them.

### Step 2: Get pending invites (read-only)
Open `https://www.linkedin.com/mynetwork/invitation-manager/sent/`. The list is paginated with a **"Load more"** button, so click it until every page is loaded. Then collect profile slugs with this JS:

```js
[...new Set([...document.querySelectorAll('main a')]
  .map(a => a.href.split('?')[0])
  .filter(h => h.includes('/in/')))].join('\n')
```

### Step 3: Build a candidate pool with people search
Use URL filters. These are the geo IDs:

- **Bengaluru** `105214831`
- **Chennai** `106888327`

The network filter `S` = 2nd degree and `O` = 3rd+. Leaving out `F` drops your 1st-degree connections automatically.

```
https://www.linkedin.com/search/results/people/?keywords=<KEYWORDS>&geoUrn=%5B%22<GEO>%22%5D&network=%5B%22S%22%2C%22O%22%5D
```

**Keyword sets that worked best**, from most to least productive:

| Keywords | Why |
|---|---|
| `head of engineering startup`, `head of engineering react` | Surfaces small-company engineering heads |
| `CTO co-founder react node`, `CTO co-founder react` | Startup CTOs who hire directly |
| `engineering manager e-commerce D2C`, `engineering manager healthtech` | Domain match with Viome; more mid-size companies |
| `engineering manager product startup` with `network=["O"]` only | 3rd+ results surface smaller, less "famous" profiles |
| `engineering manager SaaS`, `engineering manager startup` + `&page=2` | Page 2+ has fewer big-company names |
| `technical project manager react node` | TPMs who lead dev teams |

**Avoid** generic `engineering manager react` on page 1. It is dominated by Microsoft, Atlassian, Rippling and similar companies.

Content search with `authorJobTitle` / `datePosted` filters was **unreliable**: it gave few or no results, or returned recruiters. Use it only as a last resort.

**Search-result extractor.** It gives one line per person: slug, name, headline. The `/in/` links inside a card also include mutual connections, so walk up the DOM to the card and dedupe by its text:

```js
await new Promise(r => setTimeout(r, 2500));
const seen = new Set(), out = [];
[...document.querySelectorAll('main a[href*="/in/"]')].forEach(a => {
  let c = a;
  for (let i = 0; i < 10 && c.parentElement; i++) {
    c = c.parentElement;
    if (/• (2nd|3rd)/.test(c.innerText)) break;
  }
  const t = c.innerText.replace(/\s+/g, ' ').replace(/ • (2nd|3rd\+?)/, '');
  const k = t.slice(0, 25);
  if (seen.has(k) || t.length < 45) return;   // skip duplicates & name-only rows
  seen.add(k);
  out.push(a.href.split('?')[0].split('/in/')[1].slice(0, 40) + '|' + t.slice(0, 80));
});
out.join('\n');
```

Keep output lines short. Many browser tools truncate tool output at about 1,000 characters.

### Step 4: Pre-filter from the search results (no page loads)
Drop these straight from the search list:

- big-company names (rule 2)
- recruiters, HR and ICs (rule 1)
- anyone in the pending list or history (rule 7)
- anyone whose card shows "Pending"

Keep about 25–30 names.

### Step 5: Screen cheaply with the activity page (one page load per person)
`https://www.linkedin.com/in/<slug>/recent-activity/all/` shows **follower count and last activity together**, so it is the cheapest screen.

```js
await new Promise(r => setTimeout(r, 2500));
const t = (document.querySelector('main') || document.body).innerText.replace(/\s+/g, ' ');
const i = t.indexOf('Followers');
t.slice(0, 120) + ' ## ' + t.slice(i, i + 450);
```

Read **"Followers N"** and the age of the first feed item (`3w`, `1mo`, `1yr`).

- **Followers over 2,000** → reject.
- **Last item older than about 30 days** → check `/recent-activity/reactions/` once. A recent "likes this" counts as active. If that is also old, reject or mark as a backup.

### Step 6: Confirm finalists on the profile page (one page load each)
`https://www.linkedin.com/in/<slug>/`

```js
await new Promise(r => setTimeout(r, 2500));
const t = (document.querySelector('main') || document.body).innerText.replace(/\s+/g, ' ');
const g = re => (t.match(re) || [''])[0];
[t.slice(0, 300), g(/[\d,]+\+? followers/), g(/[\d,]+\+? connections/)].join(' ## ');
```

Check four things here:

- **Exact connections:** e.g. "489 connections". The count may not be shown at all, so write "not shown".
- **Company and location.**
- **Degree badge:** reject if it says `1st`.
- **Open To Work:** reject or downgrade if the photo has a `#OPENTOWORK` frame.

If the role is vague (e.g. "Engineering at Stitch"), open `/details/experience/` to see past titles.

### Step 7: Gather proof for each finalist
For each finalist, record the following.

**Evidence to note:**

- the hiring post text: role, level, stack
- the funding post
- a recent hire in Rakesh's stack, seen through their reactions
- their team size if they stated it (e.g. "20-member engineering team")

**Lessons from past runs:**

- Hiring posts often ask for 3–6+ years. Still include the person, but mention it.
- An inactive person with a tiny network (e.g. 329 connections, last active 9 months ago) is a **backup**, not a pick.

### Step 8: Rank and group
Score each qualified person:

```
+3  posted/reposted a hiring post for own team in last 30 days
+2  exact connections < 500   (or followers < 700)
+2  active in last 14 days
+2  strong stack match (React/Next/Node/TS or AI/LLM, or e-commerce)
+1  funded startup / small team (they hire directly)
+1  Message button available on 3rd-degree profile
+1  shared background (Tamil Nadu, GCE Tirunelveli, e-commerce/Shopify)
-2  followers 1,000–2,000 (soft fail)
-2  hiring post asks 3+ yrs only
```

Fill the groups like this:

- **Very strong ×2:** the top 2 scores from either city.
- **Bengaluru ×4** and **Chennai ×4:** the next best in each city.
- **Backups:** people who miss exactly one rule, each labelled with that rule.

### Step 9: Save history
Append to `colddm-tracker`:

- every **suggested** person: name, company, URL, date
- a line listing every **screened-and-rejected** name, so future runs skip them

---

## 4. Output format (copy-paste friendly)

**Start with one honest status line.** Example: "7 of 10 passed all rules; 3 Bengaluru slots unfilled because most active EMs there had >2k followers or were inactive. Added 2 labelled backups. Opened ~60 pages."

**Then the summary table:**

| # | Group | Name | Title @ Company | City | Connections / Followers | Last active | LinkedIn |
|---|---|---|---|---|---|---|---|

- Mark soft fails with ⚠️.
- Show exact connection numbers in **bold** when they are under 500.
- Use real URLs only.

**Then one block per person, in simple English:**

```
**N. Name — Company (City)**
- Can hire you: <role + team/company size + any hiring post, with details>
- Likely to reply: <exact followers/connections + last activity age + what it was>
- Skill match: <which of Rakesh's skills match, and where you saw it>
- Proof: <post / job / funding / reaction you saw, with age>
- Hook: <one line on what to mention in the DM>
```

**End with:**

- what was saved to history
- one line offering to draft personalised notes **or** send invites (Phase B)

---

## 5. Phase B: Send invitations (only when the user says so)

Only start when the user explicitly asks in chat, e.g. "send invitations with this note". Before starting, tell the user which people you will send to.

### Note templates
Pick the template by the person's pronouns or gender. If you're unsure, use the profile pronouns (He/Him, She/Her), then the photo and name. If it's still unclear, ask the user.

**Male:**
> Hi Sir, I'm Rakesh S P, a 2026 CSE graduate with 9 months of experience as a software engineer. I'm currently seeking some direction at an important stage of my career, and I would genuinely value connecting with experienced professionals like you for guidance. Looking forward to connecting.

**Female:**
> Hi Mam, I'm Rakesh S P, a 2026 CSE graduate with 9 months of experience as a software engineer. I'm currently seeking some direction at an important stage of my career, and I would genuinely value connecting with experienced professionals like you for guidance. Looking forward to connecting.

Each note is 292 characters, under LinkedIn's 300-character limit.

### Click flow (repeat for each person)

1. Open the profile in a **separate tab**.
2. Find the Connect button:
   - **2nd degree:** a blue **Connect** button sits in the top card.
   - **3rd degree:** the top card shows Follow/Message instead, so click the **"…" (More)** button and choose **Connect** from the menu.
   - If the button says **Pending** or **Message** only, with no Connect anywhere, skip the person and report it.
3. A dialog "Add a note to your invitation?" appears. Click **Add a note**, not "Send without a note".
4. Type the note and check the counter (it should read about 292/300).
5. Click **Send**.
6. Confirm the toast **"Invitation sent to <Name>."** and that the button now reads **Pending**. Take a screenshot or zoom to check.
7. Move on to the next person. Close the tab at the end.

Always take a fresh screenshot before each click, because button positions shift between profiles (the headline length changes the layout).

### Report back
Give a table of names with ✅ Sent / ⏭ Skipped (reason). Flag anyone you now think can't hire, for example an **#OpenToWork** frame you noticed on their profile.

---

## 6. Known LinkedIn quirks (learned the hard way)

- **"500+ connections"** hides the real number. Use the **Followers** count as the proxy instead.
- Some profiles show **no connection count at all**. Report this as "not shown".
- `get_page_text`-style tools sometimes fail on search pages. Fall back to `document.querySelector('main').innerText` via JS.
- Multi-step browser batches can fail when a page loads slowly. If that happens, retry with fewer steps per batch, or one navigation at a time.
- Slugs truncated in extractor output (e.g. cut at 28 characters) cause a "Page doesn't exist" error. Print slugs up to 40 characters.
- The `/recent-activity/all/` feed shows **posts and reposts first**. Reactions live on `/recent-activity/reactions/`, so a person can look inactive there while still liking posts weekly.
- Big-company managers dominate page 1 of generic searches. Use startup-flavoured keywords, 3rd+ network or page 2+ to reach smaller companies.
