// Skills: task playbooks the agent loads only when a task needs one. The system prompt lists each
// skill's name and when to use it; the full instructions arrive through the use_skill tool, so a
// run only pays for the playbooks it actually uses. Users can add their own in Settings.

export interface Skill {
  name: string
  description: string
  instructions: string
  builtIn?: boolean
}

export const BUILT_IN_SKILLS: Skill[] = [
  {
    name: 'job-applications',
    builtIn: true,
    description:
      'Finding and applying to jobs on job sites (Naukri, LinkedIn, Indeed, company career pages) based on the user’s résumé and preferences — e.g. “apply to 10 fresh frontend jobs”.',
    instructions: `# Applying to jobs

## Before you start
1. Call read_profile. Use the résumé and the profile notes (roles, locations, experience, salary, notice period) to decide which jobs fit and to answer application questions. If there is no résumé or profile, ask the user to add one in Settings → My profile, then stop.
2. Call list_applications so you never apply to the same job twice. “N more jobs” means N jobs that are not already in the log.
3. Work out the target: the number of applications, the role(s) and location(s) — from the user's message first, then the profile. Unless the user says otherwise, use the profile's roles and locations.

## Finding fresh jobs
- "Fresh" or "new" means posted recently: prefer jobs from the last 1–3 days, newest first.
- Naukri: open a search such as https://www.naukri.com/frontend-developer-jobs-in-bengaluru?k=frontend%20developer&l=bengaluru&jobAge=1 (jobAge = days since posting: 1, 3, 7). If the URL filter doesn't take, use the "Freshness" filter on the results page, and sort by date if offered. Recommended jobs (naukri.com/mnjuser/recommendedjobs) are also a good source.
- LinkedIn: https://www.linkedin.com/jobs/search/?keywords=frontend%20developer&location=Bengaluru&f_TPR=r86400&f_AL=true (f_TPR=r86400 = past 24 hours, f_AL=true = Easy Apply only).
- Results pages often load more jobs as you scroll: use scroll_page, then read_page again.

## Choosing a job
Apply only when the job fits the résumé: the role matches, the required experience is within about a year of the user's, and the location (or remote) fits the profile. Skip and move on when:
- the page says the user already applied ("Applied", "Already applied"),
- the only option is applying on an external company site ("Apply on company site") — note it in your summary as a link the user can apply to themselves, but don't count it,
- it asks for things you can't truthfully answer from the résumé or profile.

## Applying
1. Open the job (click it, or open_url with its link). Read the page.
2. Click the site's own apply button ("Apply", "Easy Apply"). Naukri may then show a chat-style questionnaire: answer each question from the profile and résumé (fill_field, then press_key Enter or click Save/Next), until it confirms.
3. Multi-step forms (LinkedIn Easy Apply): fill each step, click Next/Review, then Submit. Untick "follow company" boxes unless the profile says otherwise.
4. Never invent answers. If a required answer isn't in the profile or résumé (e.g. current CTC is missing), skip that job and list the question in your summary so the user can add it to their profile.
5. Confirm it went through (a success message, or the button now says "Applied"). Then call log_application with the title, company, link and status "applied".
   If it did NOT go through — an error after submitting ("something went wrong", "try again later"), a form that keeps rejecting your answers, an Apply button that does nothing, a page that won't load — call log_application with status "failed" and the exact reason in note. LLMRaki then has you retry once, and if that fails too it asks the user. If the problem is a required answer missing from the profile, set retryable to false and name the missing question in note, so the user is asked straight away.
6. Calling log_application closes the job's tab by itself if it was opened for this job, and brings you back to the results list — no need to close it yourself. If the job opened in the same tab instead, use go_back to return to the results. Then continue with the next job.

## Stopping
- Stop when the target number is reached, when results run out, or when the site shows a daily application limit or a CAPTCHA (tell the user — never try to get around a CAPTCHA).
- Finish with a list of jobs applied to (title — company), jobs skipped and why, and external-site jobs the user may want to apply to themselves.`
  },
  {
    name: 'form-filling',
    builtIn: true,
    description: 'Filling in forms, sign-ups and applications with the user’s own details.',
    instructions: `# Filling in forms
1. Call read_profile for the user's details. Use only what the user told you, what is in the profile or résumé, or what is already on the page.
2. Read the whole form first, then fill every field you can in one turn (several fill_field calls at once).
3. Dropdowns: pass the option's visible text. Checkboxes and radios: "true"/"false". Dates: match the format the field shows.
4. Leave password and payment fields for the user, and say so.
5. If a required field can't be answered truthfully, stop and ask the user — don't guess.
6. Before submitting, read the page again and check for validation errors (red text, "required"). Fix them, then submit.
7. Afterwards, confirm the success message and summarise what was submitted.`
  },
  {
    name: 'web-research',
    builtIn: true,
    description: 'Researching or comparing things across several pages or sites — prices, products, options, facts.',
    instructions: `# Researching across pages
1. Decide what you need to find and where (search engine, specific sites). Use open_url for searches, e.g. https://www.google.com/search?q=...
2. Open the most relevant results one at a time; read each, note the facts that matter, then close_tab or go_back.
3. Prefer primary sources (the company's own site, official docs) over aggregators.
4. Use remember to keep notes when the research is long, so nothing is lost.
5. Finish with a clear answer or comparison table, with a link for each source.`
  }
]

export function allSkills(custom: Skill[] = []): Skill[] {
  const names = new Set(custom.map((s) => s.name))
  // A custom skill with a built-in's name replaces it, so users can adjust a built-in playbook.
  return [...BUILT_IN_SKILLS.filter((s) => !names.has(s.name)), ...custom]
}

export function skillIndex(skills: Skill[]): string {
  return skills.map((s) => `- ${s.name}: ${s.description}`).join('\n')
}
