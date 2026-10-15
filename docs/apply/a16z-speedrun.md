# a16z speedrun application (draft)

Deadline: **1 November 2026.** Status: draft, 15 October 2026. Not submitted.

Lines marked **[CONFIRM]** need the founder to check or fill in. This repo is public, so personal details (age, city, school, phone) go only into the form, never into this file.

Before you start: **[CONFIRM]** read speedrun's eligibility rules for founder age and company formation. `docs/legal/README.md` says an adult must sign for money, so check whether that changes how you apply.

The form's exact questions change between cohorts. These answers cover the usual ones. Cut to fit each box.

---

## Company name

Time Machine

## One line

Save points for your code, with proof of which ones still work.

## Website

**[CONFIRM]** The site is built and deployed on Vercel, but it is private behind Vercel login and there is no domain yet. Either buy the domain and open the site before you submit, or link the GitHub repo, https://github.com/ShadowEsu/Time-Machine.

## Demo video

**[CONFIRM]** Link after recording. Script: `docs/DEMO_SCRIPT.md`.

## What are you building?

Coding agents now run for many steps on their own. When one breaks your project, you are left asking a simple question with no good answer: which version last worked?

Time Machine answers it. It saves a point before each agent prompt and before risky shell commands like `rm -rf` and `git reset --hard`. When something breaks, `tm find-good` rebuilds each save point in a separate copy, runs your tests there, and stops at the newest one that passes. `tm recover` then makes a new branch with that version. It never touches your folder or your current branch, and it never pushes, merges or deploys.

Every save point and every recovery says what was not captured, like database rows and secret values. We never store secret values, only their names.

Today it is a free command line tool, Claude Code hooks, and an MCP server so any agent can use it. A Mac app with big buttons for people who do not use a terminal is in development.

## Why now?

- Agents now edit files and run shell commands for minutes at a time, often on auto approve. One bad step can wipe hours of work.
- The breaks are public. Replit's agent deleted a production database in July 2025. Gemini CLI deleted a user's project and then wrote "I have failed you completely and catastrophically" (AI Incident Database). Cursor's forum has threads about agents wiping folders.
- Developers do not trust agent output. In the Stack Overflow 2026 survey, about 7% trust AI with important decisions, and that rises to 48% when the output is easy to check (InfoWorld). We make it easy to check.
- Built in rewind is partial. Claude Code's checkpoints do not track files changed by shell commands. Cursor's checkpoints miss shell and manual edits.

## Who is the user?

First: solo developers and indie hackers who let Claude Code, Cursor or Codex run on auto approve. They feel the pain weekly and can install a command line tool in a minute.

Next: agencies that manage many client repos with agents. Our research says they are most likely to pay first. **[CONFIRM]** We have not talked to any agency yet.

Later: people who build with agents but do not use Git or a terminal. They have the most pain and need the Mac app.

## What is built today?

All of this works and is tested. None of it is published yet.

- The `tm` command: `init`, `checkpoint`, `timeline`, `diff`, `log`, `open`, `verify`, `find-good`, `recover`, `demo`, `hook install` and `mcp`. Every command has `--json` output and fixed exit codes.
- Claude Code hooks that save before each prompt and before risky shell commands, and check at the end of each turn. If a working state just broke, the agent is told which save point last worked.
- An MCP server with 7 tools (checkpoint, timeline, diff, verify, find_good, recover, log).
- Save points live outside the project in `~/.timemachine`, with a git bundle, so they survive the project folder being deleted.
- Checks run in a separate Git worktree with a clean environment and a time limit. With the network policy set to deny, the check runs with the network off through a sandbox. If no sandbox is available, the check does not run and the verdict says BLOCKED.
- 54 automated tests for the engine and command line tool, passing on macOS and Linux CI with Node 22 and 24.
- `tm demo` builds a small broken project and rescues it in a few seconds with the real engine.

In development: the Mac app (a browser preview with demo data exists) and the public website with a waitlist.

## Traction

None yet. No users, no revenue, no waitlist signups. The npm name `timetm` is free today. We have not claimed or published it yet.

What we do have:

- A run on a real open source project, `sindresorhus/slugify`. It found a real bug in our tool: the clean environment dropped proxy settings, so `npm install` failed. We fixed it with a failing test first. Now its test suite passes in 22 seconds with the check offline, and `find-good` finds the last working version.
- Two independent code reviews found 17 bugs. All are fixed, each with a failing test first.

Plan for the next 30 days: publish to npm, open the site, and do think aloud tests with 5 builders who use coding agents (`docs/OUTREACH.md`). **[CONFIRM]** update this section with real numbers on the day you submit.

## Competition

- **Claude Code `/rewind` and Cursor checkpoints** cover only the agent's own file edits in that one tool. They skip shell commands, so `rm -rf` and `git reset --hard` are not covered. They do not check whether an old version works.
- **Entire** raised a $60M seed in February 2026 for agent checkpoints. It is a well funded team aimed at provenance and review across a company. **[CONFIRM]** recheck their current product before you submit.
- **Rubrik Agent Rewind** targets large enterprises with existing Rubrik contracts.
- **git-ai** records which lines an agent wrote. That is attribution, not recovery. We can read its notes later instead of building our own.
- **Small open source "undo for agents" tools** appeared this year. Plain undo is becoming a commodity.

## What is different?

Two things together.

1. **Proof of which version works.** Not a list of snapshots, a verdict. We rebuild each save point in a separate copy and run your own check there, with the network off when a sandbox is available. Git remembers your code. We remember whether it worked.
2. **Recovery that never touches your folder.** Recover saves where you are first, then makes a new branch and a separate copy. Nothing is overwritten, pushed or deleted.

And we are honest about the rest. Every result lists what was not restored. We never promise universal undo.

## Business model

The command line tool is free. Restores are never paywalled.

Planned, not built: Time Machine Pro for the Mac app at $9 a month. The price steps down the longer you stay: $8 from month 7, $7 from month 13, and a $6 floor. We call it The Ladder. A team plan comes later.

## Founder

Preston Susanto, solo founder. **[CONFIRM]** each line below. Source: the founder's own about page.

- Student founder studying Electrical Engineering and Computer Science. **[CONFIRM]** name the school on the form only.
- Taught himself machine learning from Berkeley CS285 and Stanford CS234 lectures, on a MacBook with no GPU and no cloud budget. **[CONFIRM]**
- Built Unvibe, which explains code to people who build with AI. 24+ releases, member of Claude for Startups. **[CONFIRM]** Do not reuse Unvibe numbers as Time Machine traction.
- SF Hacks 2026: three awards. Mega Hackathon 2026: Gaming Award, solo. **[CONFIRM]**
- Leads Code The Change, a student group with 20+ members. **[CONFIRM]**
- Speaks English, Indonesian and Mandarin. **[CONFIRM]**
- Contact: preston@unvibe.site

## Why are you the right person?

I build with coding agents every day, and I kept losing versions that worked. I built Unvibe to help people understand what their AI wrote. Time Machine is the other half: when the code breaks, get back to a version that is proven to work. I built the engine, the command line tool, the hooks and the MCP server myself with coding agents, test first, with 54 tests and two outside reviews. **[CONFIRM]** the wording, and how you want to describe the share of code written by agents.

## How far along / how long have you worked on it?

The repo started on 13 October 2026. The engine, command line tool, hooks and MCP server were built and tested since then. **[CONFIRM]** add any earlier research time.

## Fundraising so far

**[CONFIRM]** None.

## Anything else?

The product thesis is also how we build it: every bug fix starts with a failing test. A tool that tells you what works has to be right about what works, so a false "works" is the worst bug we could ship.
