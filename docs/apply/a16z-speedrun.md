# a16z speedrun SR008 application (draft)

Deadline: **1 November 2026, 11:59pm PT.** Status: draft, 15 October 2026. Not submitted. Nothing here is sent by any agent or tool.

Sources for the questions and rules (checked 15 October 2026):

- speedrun FAQ, SR008 window 12 October to 1 November 2026, residency 1 February to 18 April 2027 in San Francisco: https://speedrun.a16z.com/faq
- Apply page: https://speedrun.a16z.com/apply
- What speedrun investors look for (team and bio weigh most, deck of 7 to 10 slides): https://speedrun.substack.com/p/what-we-look-for-in-applications
- The five written questions as reported by a third party (not an a16z page; check the live form): https://hub.causo.ai/guides/how-to-apply-to-a16z-speedrun-2026

Evidence cited in the answers:

- Claude Code docs, "Checkpointing does not track files modified by Bash commands.": https://code.claude.com/docs/en/checkpointing
- Replit agent deleted a production database, July 2025: https://incidentdatabase.ai/cite/1152
- Gemini CLI deleted a user's files, July 2025: https://incidentdatabase.ai/cite/1178 and https://arstechnica.com/information-technology/2025/07/ai-coding-assistants-chase-phantoms-destroy-real-user-data
- Cursor agent deleted PocketOS's production database, April 2026: https://builtin.com/articles/agent-technical-debt
- Stack Overflow 2026 survey, trust in AI: https://survey.stackoverflow.co/2026/ai/data/ai-trust
- Entire's seed and Checkpoints launch: https://entire.io/news/former-github-ceo-thomas-dohmke-raises-60-million-seed-round

Lines marked **[FOUNDER]** need facts only the founder knows. This repo is public, so personal details (age, city, school, phone) go only into the form, never into this file.

Before you start, **[FOUNDER]**:

- The FAQ says students still finding an idea may fit the alpha fellowship better, and asks anyone with an age question to email sr-team@a16z.com. Decide which program fits and email first if age applies.
- The residency is in person in San Francisco, about one day a week, and they expect full time building otherwise. Confirm you can do that from February 2027.
- `docs/legal/README.md` says an adult must sign for money. Check how that affects the SAFE.

---

## Company name

Time Machine

## One line

Your agent can break things. Time Machine proves which version still works and gets you back to it.

## Website

**[FOUNDER]** The site is built but private behind Vercel login, with no domain yet. Either buy the domain and open the site before you submit, or link the GitHub repo, https://github.com/ShadowEsu/Time-Machine (check it is public first).

## Demo video

**[FOUNDER]** Link after recording. Script: `docs/DEMO_SCRIPT.md`.

## Deck

**[FOUNDER]** 7 to 10 slides, large font. Suggested order: the problem (Bash gap quote), the demo verdict screenshot, what is built, who it is for, competition, why you, the plan.

## What are you building?

Coding agents now run for many steps on their own. When one breaks your project, you are left with one question and no good answer: which version last worked?

Time Machine answers it. It saves a point before each agent prompt and before risky shell commands like `rm -rf` and `git reset --hard`. When something breaks, `tm find-good` rebuilds each save point in a separate copy, runs your tests there, and stops at the newest one that passes. `tm recover` then makes a new branch with that version. It saves where you are first. It never touches your folder or your current branch, and it never pushes, merges or deploys.

Every result also lists what was not restored, like database rows and secret values. We store secret key names, never the values.

## Who is it for?

First: solo developers who let Claude Code, Cursor or Codex run on auto approve. They hit this weekly and can install a command line tool in a minute.

Next: small agencies that run agents across many client repos. Research says they pay first. We have not talked to one yet.

Later: people who build with agents but do not use Git or a terminal. They have the most pain. They need the Mac app.

## Why now?

- Agents now edit files and run shell commands for minutes at a time. One bad step can wipe hours of work.
- Built in rewind has a gap. Claude Code's own docs say: "Checkpointing does not track files modified by Bash commands." So `rm`, `mv` and `git reset --hard` run by the agent cannot be rewound there.
- The breaks are public. Replit's agent deleted a production database during a code freeze in July 2025. Gemini CLI deleted a user's files the same month and wrote "I have failed you completely and catastrophically." In April 2026 an agent in Cursor deleted the production database of a SaaS company, PocketOS.
- Developers do not trust agent output unless they can check it. In the Stack Overflow 2026 survey, 48% trust AI when they can easily verify it, and only 7% trust it with important decisions. Time Machine is a way to verify.

## Why you?

**[FOUNDER]** Rewrite in your own voice. The FAQ says they spend most of their time on the team and bio section. Suggested shape:

I build with coding agents every day, and I kept losing versions that worked. I built Unvibe to help people understand the code their AI wrote. Time Machine is the other half: when that code breaks, get back to a version that is proven to work. I built the engine, the command line tool, the hooks, the MCP server and the Mac app screens myself with coding agents, test first.

Bio lines to confirm, each **[FOUNDER]**:

- Student founder studying Electrical Engineering and Computer Science. Name the school on the form only.
- Built Unvibe: 24+ releases, member of Claude for Startups. Do not reuse Unvibe numbers as Time Machine traction.
- SF Hacks 2026: three awards. Mega Hackathon 2026: Gaming Award, solo.
- Taught himself machine learning from Berkeley CS285 and Stanford CS234 lectures, on a MacBook with no GPU.
- Leads Code The Change, a student group with 20+ members.
- LinkedIn URL and any public posts or channels.
- Contact: preston@unvibe.site

## What is working?

The FAQ says traction does not have to be a number. Ours is how fast we are shipping. None of it is published yet.

Built and tested:

- The `tm` command: `init`, `checkpoint`, `timeline`, `diff`, `log`, `open`, `verify`, `find-good`, `recover`, `demo`, `hook install` and `mcp`. Every command has `--json` output and fixed exit codes.
- Claude Code hooks that save before each prompt and before risky shell commands, and check at the end of each turn. Each save point records which agent made it and the prompt it was given, with secrets stripped.
- An MCP server, so any agent that speaks MCP can use the same engine.
- Save points live outside the project with a git bundle, so they survive the project folder being deleted.
- Checks run in a separate Git worktree with a clean environment and a time limit, with the network off when a sandbox is available. If the network rule cannot be met, the verdict says BLOCKED instead of guessing.
- A recovery can be undone, but only while the recovery branch and copy are untouched. Undo never removes a save point.
- `tm demo` breaks and rescues a synthetic project in a few seconds with the real engine.
- Tried on a real open source project, `sindresorhus/slugify`. It found a real bug in our tool (proxy settings dropped, so `npm install` failed). We fixed it with a failing test first.
- Two independent code reviews found 17 bugs. Each was fixed with a failing test first.
- Engine and command line tests: **[FOUNDER]** paste the current count from `pnpm test` on the day you submit.

Built, not yet run as a signed Mac app: the Mac app screens. Onboarding, the History ruler, the Rewind wizard with undo, Compare with now, Settings, an Inspector with the exact commit and check log, a corner card that shows only when a working project breaks, and labels that say which agent made each save point. Signing and notarizing (D08) is the next step.

Not built: users, revenue and a waitlist. No users yet. No revenue. **[FOUNDER]** update with real numbers on the day you submit, for example think aloud sessions done.

Next 30 days: publish to npm, open the site, and run think aloud tests with 5 builders who use coding agents (`docs/OUTREACH.md`).

## Competition (if asked, or in the deck)

- **Claude Code `/rewind` and Cursor checkpoints** cover the agent's own file edits in that one tool. Claude Code's docs say Bash changes are not tracked. Neither checks whether an old version works.
- **Entire** launched in February 2026 with a $60M seed. Its first product, Checkpoints, captures agent sessions next to commits. It is about context and review, not proving which version works. **[FOUNDER]** recheck their product before you submit.
- **Rubrik Agent Rewind** targets large enterprises.
- **git-ai** records which lines an agent wrote. That is attribution, not recovery.

What is different: a verdict, not a list of snapshots. We rebuild each save point in a separate copy and run your own check there. And recovery never touches your folder. Git remembers your code. We remember whether it worked.

## Business model

The command line tool is free. Restores are never paywalled.

Planned, not built: Pro for the Mac app at $9 a month, stepping down to $8 from month 7, $7 from month 13, and a $6 floor (ADR 0002). A team plan comes later.

Planned, not built: an action connector that keeps a record and an honest way back for what agents do in other apps, like email and Slack (ADR 0007). Nothing of it exists yet.

## Company details

- Legal entity: **[FOUNDER]** none formed, as far as this repo shows. The FAQ says you can apply before you incorporate.
- Money raised so far: **[FOUNDER]**
- Also applying to: YC W27 (deadline 2 November 2026).
- Location: **[FOUNDER]** form only.
