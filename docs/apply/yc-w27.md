# YC W27 application (draft)

Deadline: **2 November 2026, 8pm PT.** Decisions by 11 December. Batch January to March 2027 in San Francisco. Status: draft, 15 October 2026. Not submitted. Nothing here is sent by any agent or tool.

Sources for the questions and dates (checked 15 October 2026):

- YC apply page, W27 deadline and decision date: https://www.ycombinator.com/apply
- YC's own guide to the questions: https://www.ycombinator.com/howtoapply
- Dropbox's original application, for the older form of the questions: https://www.ycombinator.com/apply/dropbox
- Question list as reported by a third party (not a YC page; check the live form): https://ycinsight.com/apply

Evidence cited in the answers:

- Claude Code docs, "Checkpointing does not track files modified by Bash commands.": https://code.claude.com/docs/en/checkpointing
- Replit agent deleted a production database, July 2025: https://incidentdatabase.ai/cite/1152
- Gemini CLI deleted a user's files, July 2025: https://incidentdatabase.ai/cite/1178 and https://arstechnica.com/information-technology/2025/07/ai-coding-assistants-chase-phantoms-destroy-real-user-data
- Cursor agent deleted PocketOS's production database, April 2026: https://builtin.com/articles/agent-technical-debt
- Stack Overflow 2026 survey, trust in AI: https://survey.stackoverflow.co/2026/ai/data/ai-trust
- Entire's seed and Checkpoints launch: https://entire.io/news/former-github-ceo-thomas-dohmke-raises-60-million-seed-round

Lines marked **[FOUNDER]** need facts only the founder knows. This repo is public, so personal details (age, city, school, phone) go only into the form, never into this file.

Before you start, **[FOUNDER]**: check YC's rules for founder age and who can sign the investment documents. `docs/legal/README.md` says an adult must sign for money. If you are a student, YC's Early Decision page lets you apply now for a later batch: https://www.ycombinator.com/early-decision

YC reads fast. Keep every answer plain.

---

## Company

**Company name**

Time Machine

**Describe what your company does in 50 characters or less**

Proves which version of your code still works

(45 characters.)

**Company URL**

**[FOUNDER]** No domain yet. The site is private behind Vercel login. Buy the domain and open the site, or link the GitHub repo.

**Demo video**

**[FOUNDER]** Link after recording. Script: `docs/DEMO_SCRIPT.md`.

**Product link and how to try it**

https://github.com/ShadowEsu/Time-Machine (**[FOUNDER]** check it is public). No login. `pnpm install && pnpm build && node packages/cli/dist/tm.js demo` breaks and rescues a synthetic project in a few seconds. Once on npm: `npx timetm demo`.

**What is your company going to make?**

Your agent can break things. Time Machine proves which version still passes your tests and gets you back to it.

It saves a point before each agent prompt and before risky shell commands. When something breaks, it rebuilds each save point in a separate copy, runs your tests there, and finds the newest one that passes. Then it makes a new branch with that version. It saves where you are first, never touches your folder or current branch, and never pushes, merges or deploys. Every result lists what it could not bring back, like database rows and secret values.

Today: a free command line tool (`tm`), Claude Code hooks, and an MCP server so any agent that speaks MCP can use the same engine. Built: a web app (`tm ui`) for people who do not use a terminal; it runs on their computer and opens in the browser. Planned, not built: the same record and way back for agent actions in other apps, like email (ADR 0007).

**Where do you live now, and where would the company be based after YC?**

**[FOUNDER]** Fill in on the form.

## Progress

**How far along are you?**

The engine and command line tool are built and tested, not yet published.

- `tm init`, `checkpoint`, `timeline`, `diff`, `log`, `open`, `verify`, `find-good`, `recover`, `demo`, `hook install` and `mcp`, all with `--json` and fixed exit codes.
- Claude Code hooks that save before each prompt and before risky commands (`rm -rf`, `git reset --hard`, `git clean -f`, `DROP TABLE` and similar), and check at the end of each turn. Each save point records the agent and its prompt, with secrets stripped.
- An MCP server for any agent that speaks MCP.
- Save points stored outside the project with a git bundle, so they survive the folder being deleted.
- Checks run in a separate worktree, with the network off when a sandbox is available. If that rule cannot be met, the verdict is BLOCKED, not a guess.
- A recovery can be undone while its branch and copy are untouched. Undo never removes a save point.
- Tried on a real open source project, `sindresorhus/slugify`.
- Test count: **[FOUNDER]** paste the current number from `pnpm test` on submit day.

Web app: built (onboarding, History ruler, Rewind wizard with undo, Compare with now, Settings, Inspector, agent labels on save points, the one-time license). It is served by the CLI on the user's computer, so nothing needs signing.

**How long have each of you been working on this? How much of that has been full time?**

The repo started on 13 October 2026. **[FOUNDER]** add earlier research time and your weekly hours next to school.

**What tech stack are you using? Include AI models and AI coding tools you use.**

TypeScript in strict mode on Node 22 and newer, pnpm, Zod for every outside input, Vitest, and Git through its command line. The web app is the same engine behind a local token-guarded server. The site is static on Vercel. Code is written with Claude Code, test first. **[FOUNDER]** list the models and tools you actually use.

**Are people using your product?**

No. It is not published yet. **[FOUNDER]** update on the day you submit.

**Do you have revenue?**

No.

## Idea

**Why did you pick this idea to work on? Do you have domain expertise? How do you know people need it?**

I build with coding agents every day, and I kept losing versions that worked. I built Unvibe to help people understand the code their AI wrote. Time Machine is the other half: when that code breaks, get back to a version that passed your check. **[FOUNDER]** rewrite in your own words.

How we know people need it:

- The gap is documented. Claude Code's docs say: "Checkpointing does not track files modified by Bash commands." The agent's own rewind cannot undo an `rm` or `git reset --hard` it ran.
- Public breaks. Replit's agent deleted a production database in July 2025. Gemini CLI deleted a user's files the same month and wrote "I have failed you completely and catastrophically." In April 2026 an agent in Cursor deleted PocketOS's production database.
- Trust. In the Stack Overflow 2026 survey, 48% of developers trust AI when they can easily verify it, and only 7% trust it with important decisions. We make the result easy to verify.

What we have not done yet: talk to users. Next is think aloud tests with 5 builders (`docs/OUTREACH.md`). **[FOUNDER]** add what you learn before submitting.

**What's new about what you're making? What substitutes do people use?**

Today people use Git commits, the agent's own rewind, or nothing. Git has only what you committed. Rewind skips the shell. Neither tells you if an old version works.

We give a verdict, proved in a separate copy, plus a recovery that never touches your folder. Git remembers your code. We remember whether it worked.

**Who are your competitors? What do you understand that they don't?**

- **Claude Code `/rewind` and Cursor checkpoints** cover their own file edits in their own tool. They do not check whether the old version works.
- **Entire** launched in February 2026 with a $60M seed. Its Checkpoints product captures agent sessions next to commits, for context and review. **[FOUNDER]** recheck before submitting.
- **Rubrik Agent Rewind** is for large enterprises.
- **git-ai** records which lines an agent wrote. That is attribution, not recovery.

What we understand: people do not want a list of snapshots. They want to know which one works, and they want to be told plainly what could not come back.

**How do or will you make money? How much could you make?**

The command line tool is free. Restores are never paywalled.

Price: the web app costs $50 once, with no free plan (ADR 0013). Checkout opens once the seller of record is set. A team plan for agencies comes after that.

The math, not a forecast: one Pro user pays $72 to $108 a year. 10,000 paying users is about $0.7M to $1.1M a year. The larger market is the planned action connector for agent actions in other apps (ADR 0007). Nothing of it is built.

**Which category best applies?**

Developer tools. **[FOUNDER]** confirm.

## Equity

**Have you formed any legal entity yet?**

**[FOUNDER]** No, as far as this repo shows.

**Have you taken any investment yet?**

**[FOUNDER]**

**Are you currently fundraising?**

Also applying to a16z speedrun (deadline 1 November 2026). **[FOUNDER]** add anything else.

## Curious

**What convinced you to apply? How did you hear about YC?**

**[FOUNDER]** Your own words.

## Founders

**Founder name and contact**

Preston Susanto, solo founder. preston@unvibe.site

**Are you looking for a cofounder?**

**[FOUNDER]**

**Who writes code, or does other technical work on your product? Was any of it done by a non-founder?**

I do, with coding agents. I set the scope, write the rules, review each change and run the tests. Claude Code writes much of the code. Every bug fix starts with a failing test. Two independent code reviews found 17 bugs, and each was fixed with a failing test first. No one outside the company has worked on it. **[FOUNDER]** confirm wording.

**Something impressive you have built or achieved**

Each line **[FOUNDER]** to confirm:

- Built Unvibe, with 24+ releases. Member of Claude for Startups.
- SF Hacks 2026: three awards. Mega Hackathon 2026: Gaming Award, solo.
- Taught himself machine learning from Berkeley CS285 and Stanford CS234 lectures, on a MacBook with no GPU.
- Leads Code The Change, a student group with 20+ members.

Do not reuse Unvibe numbers as Time Machine traction.

**Tell us about a time you most successfully hacked some non-computer system to your advantage**

**[FOUNDER]** Only you can write this. A true, specific story beats a polished one.

## Founder video (1 minute)

**[FOUNDER]** Record after the demo video. Say who you are, the pitch line, why you are building it, and what is built. Speak to the camera yourself. Do not read this file.
