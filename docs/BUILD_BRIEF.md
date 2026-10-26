# Time Machine build brief

Status (22 October 2026): **Implemented and tested:** C01 to C15 in host mode (C15 for Claude Code), `tm demo`, `tm mcp`, `tm ui` (the web app, Phase B W01 to W07), `tm license` and acceptance tests V01 to V14. **Still planned:** Git hooks, the container isolation adapter, the dependency cache, store thinning, npm publishing, and opening checkout. **Retired:** the Electron Mac app (ADR 0012). Everything else in this file is planned unless marked implemented here.

Name: **Time Machine** (founder decision, see `docs/adr/0001-name.md`). npm package `timetm`, command `tm`.

## 1. What it is

A checkpoint and recovery platform for digital projects, starting with projects that AI coding agents (Claude Code, Cursor, Codex, Gemini CLI, Lovable, Replit) or people have broken.

**Core promise:** understand what changed, recover a working state, and safely move forward.

**Pitch lines** (from the round 3 research, all honest about limits):

- Developers: "Git remembers your code. We remember whether it worked."
- Vision and investors: "Save points for everything you build, with proof of which ones still work."
- App and short videos: "From 'it worked yesterday' to 'here it is, working.'"
- Hero tagline: "Back to what worked."

Git already keeps code history. A commit alone is not a complete backup of an application. Time Machine uses Git history and adds context around it: captured files, selected configuration, dependencies, the environment definition, and verification results.

**What we never promise:** universal undo. Reverting code does not reverse database changes, payments, emails, deployments, or other external actions. Every result says what was not restored.

## 2. What a checkpoint is

Every checkpoint answers five questions:

| Question | Example |
|---|---|
| What was captured? | Commit `a1b2c3d`, 4 untracked files, lockfile digest, Node 24, Dockerfile digest |
| What references were recorded? | Git commit and branch, remote URL, the agent and prompt that triggered it |
| What can be restored? | Code, captured files, allowlisted config, environment definition |
| What is missing or manual? | Database state, secret values, external services, files over the size limit |
| Was it verified? | `npm test` in a rebuilt copy: PASS, FAIL, INCOMPLETE, BLOCKED, or ERROR |

A checkpoint with no verification result is shown as unverified, never as working.

## 3. Two ways to use it, one engine

| Surface | For | What it looks like |
|---|---|---|
| **npm CLI** (`tm` command, scoped package) | Developers and coding agents | `tm checkpoint`, `tm find-good`, `tm recover`, JSON output, agent hooks, MCP server |
| **Web app** (`tm ui`, runs on your computer, opens in your browser) | Non-technical builders and anyone who prefers buttons | Big buttons (Save now, Check it works, Rewind), a history screen, a status bar with one plain sentence, settings with the license |

Both call the same engine, so they can never disagree.

**Plain labels in the app:**

| Engine | App |
|---|---|
| checkpoint | Save point |
| timeline | History |
| diff | Compare |
| open | Try this version |
| verify | Check it works |
| find-good | Find the last working version |
| recover | Use this version |
| PASS / FAIL / INCOMPLETE / BLOCKED / ERROR | Works / Broken / Couldn't check / Needs something / Check crashed |

**The status bar** (built): the top of every project screen says, in one sentence, whether the newest save point passed, failed or was never checked, and offers the single next action. It is never green without a real PASS. Overlays over other apps and a global hotkey were part of the retired Mac app (ADR 0012).

**One-click rewind:** rebuild the old version in a safe copy, check it, and show "10:42 works." Then **Use this version** makes a local branch, saves the broken state first so the rewind can be undone, and never pushes or deletes anything.

## 4. The MVP

**Scope:** a GitHub repository, plus captured project files, plus explicitly selected configuration, plus an environment definition, plus one verification command.

**The one experience to demonstrate:**

> This project broke after several changes. Find a recorded working checkpoint, recreate it separately, verify it, and prepare a recovery branch.

### Phase A: engine and CLI (build first)

| Command | What it does |
|---|---|
| `tm init` | Writes `timemachine.yml`: captured files, config allowlist, environment, verify command (prefilled, for example `npm test`, `npm run build`, or "home page loads") |
| `tm checkpoint [-m note]` | Records a checkpoint and its coverage report |
| `tm hook install` | Wires Git and agent hooks so checkpoints happen before agent turns and before destructive commands |
| `tm timeline` | Lists checkpoints with verdicts |
| `tm diff <a> <b>` | Compares code, files, config keys, dependencies, environment |
| `tm open <cp>` | Rebuilds a checkpoint in a separate worktree. Never touches the working copy |
| `tm verify <cp>` | Runs the verify command and records the verdict and isolation mode |
| `tm find-good` | Walks back and verifies until it finds the newest PASS |
| `tm recover <cp>` | Makes a local recovery branch and a recovery report. Never pushes, merges, or deploys |
| `tm log` | Shows the append-only audit trail |
| `tm mcp` | Exposes the same actions to agents over MCP |

| ID | Requirement |
|---|---|
| C01 | Project manifest validated with a schema |
| C02 | Records Git commit, branch, remote, dirty state; pins each checkpoint under `refs/tm/<id>` so `git gc` cannot prune it |
| C03 | Captures selected untracked files into a content-addressed store **outside the project**, so an agent's `rm -rf` cannot destroy the checkpoints too |
| C04 | Captures only allowlisted config. Secret values are never stored, only key names and a keyed fingerprint to detect change |
| C05 | Records lockfile digests, runtime versions, environment definition digest |
| C06 | Coverage report on every checkpoint: captured, restorable, missing, manual |
| C07 | Immutable checkpoints with integrity checks |
| C08 | Timeline and diff |
| C09 | `open` rebuilds in a separate worktree. Default isolation is host mode (worktree plus cached dependencies). Docker or Apple `container` is used when present and labeled as stronger isolation |
| C10 | `verify` with time limit, clean environment, network blocked by policy, verdict plus isolation mode recorded |
| C11 | `find-good` finds the newest passing checkpoint |
| C12 | `recover` creates a local branch, saves the broken state first, writes a recovery report |
| C13 | Append-only audit log |
| C14 | Human and JSON output that always agree |
| C15 | Agent hooks for Claude Code first (prompt submit, before destructive shell commands, after each turn), with background verify that flags PASS turning into FAIL |

### Phase B: the web app (built; `tm ui`)

| ID | Requirement | Status |
|---|---|---|
| W01 | Onboarding in three steps: add a project by path, choose the check, connect the hooks | Built |
| W02 | Project list and History screen with big buttons and verdict badges | Built |
| W03 | Save point detail with plain language "what's saved / what's not saved" | Built |
| W04 | Rewind wizard: find the last working version, try it, use it, undo | Built |
| W05 | Compare screen | Built |
| W06 | Local server on `127.0.0.1` with a per-launch token, Host and Origin checks, a Zod schema on every call, live updates when the CLI or a hook saves | Built |
| W07 | Settings: storage used and cleanup, isolation mode, agent connections, theme, the one-time license | Built |

The retired Mac app items (menu bar dot, overlay cards, global hotkey, signing and notarization) are recorded in ADR 0012.

Later: plain English summaries (templates first, then on-device model, then opt-in cloud), screenshots of the app per save point, Cursor, Codex, and Gemini hook kits, VS Code extension, cloud sync, team sharing.

### Acceptance tests (Phase A)

| ID | Test |
|---|---|
| V01 | `open`, `verify`, and `find-good` never modify the working copy or current branch |
| V02 | Uncommitted changes restore exactly |
| V03 | Secret values never appear in the store, logs, or reports |
| V04 | A missing captured file gives INCOMPLETE, not PASS |
| V05 | A tampered checkpoint is rejected |
| V06 | `verify` gives FAIL for a broken state and PASS for a working one |
| V07 | `find-good` returns the newest passing checkpoint in the demo history |
| V08 | `recover` creates a local branch, never pushes, lists manual steps |
| V09 | A timeout ends as ERROR with a clear message |
| V10 | Network use during verify is BLOCKED when the policy is off |
| V11 | The audit log records every action |
| V12 | Human and JSON output agree |
| V13 | Deleting the project folder does not delete its checkpoints |
| V14 | A host mode PASS is always labeled as host mode |

### Out of scope until the founder changes it

Hosted dashboard, accounts, subscriptions, cloud storage, team sharing, database snapshots, deployment rollback, Mac App Store, and business-automation replay. The one-time web app purchase (ADR 0013) is the only billing. Business-automation replay is a later specialized capability; its earlier spec is in `.private/research/00-business-plan.md`.

### The demo

A small TypeScript web app with tests. Checkpoints 1 to 3 work. An agent then "fixes" a lint error and breaks a function, someone changes a config value, and a dependency gets added. `tm find-good` skips the broken states and lands on checkpoint 3. `tm open` and `tm verify` give PASS. `tm recover` creates `tm/recover/cp-0003`. The report ends: "Restored: code, captured files, config. Not restored: database, deployed version, secret values."

## 5. Engineering plan

- TypeScript strict, Node 24 LTS for development, `engines >= 22`. ESM only. pnpm workspace. Zod. Vitest. Git through the `git` command line.
- **Layout:**

  ```
  packages/core        engine, no Electron imports
  packages/cli         tm command, hooks entry point, MCP server
  plugins/time-machine Claude Code plugin
  apps/web             the web app renderer and server, served by tm ui (Phase B)
  fixtures/            synthetic demo histories only
  docs/adr/
  ```

- **Store:** `~/.timemachine` (or `$TM_HOME`) for the CLI and the web app. Content-addressed SHA-256 blobs, compressed, one immutable JSON manifest per checkpoint, append-only audit file. Size budget with thinning; pinned and newest-PASS checkpoints are never thinned.
- **Isolation:** host mode by default (git worktree, captured files, lockfile install with a dependency cache, clean environment, timeout). The network is blocked during verify using Anthropic's open source sandbox runtime (`srt`, a research preview, so the engine keeps its own fail-closed logic). Docker, OrbStack, or Apple `container` is used when detected.
- **Web app:** the renderer in `apps/web` talks to a local HTTP server inside the CLI over `POST /api/call` and a streamed `GET /api/events`. No Electron, no native shell (ADR 0012).
- **Distribution:** npm package `timetm` (command `tm`) with trusted publishing and provenance. The bare names `tm`, `timemachine`, and `time-machine` are taken by other people. The web app ships inside the same package; `tm ui` opens it. No DMG, no signing.

**ADRs to write before code:** name, store location, default isolation, network blocking method, desktop framework.

**Build order** (about 20 hours a week):

| Phase | Weeks |
|---|---|
| Engine plus CLI: checkpoint, timeline, diff, log, store, secret scanner | 2 to 3 |
| open, verify, find-good, recover (the demo works end to end) | 2 |
| Network blocking plus Docker adapter | 1 |
| Claude Code hooks, MCP server, npm publish | 1 to 1.5 |
| Web app: History, Save now, Check it works, Rewind wizard, Compare, Settings | 4 (done) |
| Web app: local server, token, live updates, license | 1 (done) |

CLI MVP is about 7 to 9 weeks. The desktop app is about 8 to 10 more.

## 6. Market position

- **Pain is real and public:** Replit's agent deleted a production database (July 2025). A Cursor agent wiped a company database and its backups in 9 seconds (April 2026). Many Claude Code reports exist of `git reset --hard` and `git checkout -- .` destroying uncommitted work, including from its own checkpointing.
- **Built-in rewinds are partial:** Claude Code rewind misses Bash changes and expires after about 30 days; Cursor and Kiro miss shell and manual edits; Lovable restores code but not data; Replit is the most complete but only inside Replit.
- **Entire** ($60M seed, Felicis) removed its rewind command and moved toward provenance and review. OpenAI's Codex also removed its undo after data-loss reports.
- **Small open source "undo for agents" tools** (Zerostel, Turnal, takeback, turnback, undoai) appeared in recent weeks with little traction. Plain undo is a commodity.
- **The open lane:** nobody combines a rebuilt verification, an automatic "last known good", and an honest report of what could not be restored, across agents.
- **Verdict from research:** go, narrowly. Scored about 5 out of 10, strong on pain and feasibility and weak on willingness to pay and competition. Base case about $350K ARR at month 36.
- **Who:** agencies managing many client repos pay first. Indie developers who run agents on auto-approve are the first users. Vibe coders have the most pain, but their code often lives inside hosted builders, so the app starts with local or GitHub-synced projects.

**Pricing (ADR 0013, founder decision 22 October 2026):**

| Plan | Price |
|---|---|
| CLI, hooks, MCP | Free and open source (MIT) |
| Web app | Free for up to 3 projects at a time; $50 once lifts the limit. Any number of your own computers and projects, updates while we ship them, key verified offline. Sign in on the site with the checkout email to see the key again |
| Team | Later, if agencies ask |

The open source CLI can always restore. Checkout is not open until an adult signer and a Stripe account exist (`docs/launch/CHECKOUT_SETUP.md`).

## 7. Website plan

Unchanged design system: Next.js on Vercel, scroll-beat-kit decks, Inter Display, Inter, Geist Mono, black on white, color only for verdicts.

| Deck | Beats |
|---|---|
| 1. The break | It worked at 10:42. The agent took 47 steps. Now nothing runs. |
| 2. The history | Every step left a save point, with what it can and cannot restore. Rewind. |
| 3. The proof | Rebuilt in a safe copy: Broken, Broken, Works. Use this version on a new branch. The report says what it could not bring back. |

Add a side-by-side of what built-in rewind covers versus what we cover. Pages: Product, How it works (including "what we cannot undo"), Download, Docs, Changelog, Security, Company story, and `/agents` with the plugin and MCP setup.

## 8. Launch plan (summary)

1. Hand-onboard 10 to 20 people who were burned by an agent in the last 90 days.
2. Do a private beta in batches of 25.
3. Post on Show HN once 10 strangers in a row install it without help.
4. Launch the app on Product Hunt 2 to 4 weeks later.
5. Use these channels: Claude Code plugin marketplace, cursor.directory, r/ClaudeCode, r/vibecoding (with moderator approval), Lovable Discord, and short daily demo clips.

Full scripts and targets are in `.private/research/13-pricing-launch-naming.md`.

## 9. Open decisions

1. **The name.** Decided: Time Machine, with npm package `timetm` and command `tm` (ADR 0001). The Apple trademark risk is accepted by the founder and recorded there.
2. **Apple Developer Program.** No longer needed: the Mac app is retired (ADR 0012).
3. **Open source license** for the engine and CLI.
4. **Pricing.** Decided: $50 one time for the web app (ADR 0013). The Ladder (ADR 0002) is superseded.
5. **Deadlines:** a16z speedrun SR008 closes 1 November 2026; YC W27 closes 2 November 2026 at 8pm PT. Dated milestones are in `docs/PLAN.md`.
6. **Who signs for money.** An adult seller of record, or a company with an adult officer, must be in place before checkout opens. See `docs/legal/README.md`.
7. **Engine decisions** recorded: store location (ADR 0003), isolation and network (ADR 0004), exit codes (ADR 0005).

## 10. Rewind everything: the roadmap

The "Now" row is built. The rest is planned.

| When | Capability |
|---|---|
| Now (MVP) | Code, uncommitted work, chosen files, config key changes, dependency and environment definitions, safe copy check, find last working, recover to a branch, honest report, small local backup, Claude Code hooks, MCP, audit log, the web app, plain folder projects with a copy-only recovery (ADR 0014), auto save while the app is open, run notes |
| Next (6 to 12 months) | One timeline across Claude Code, Cursor, Codex and Gemini; Lovable, Replit and Bolt through GitHub sync; environment fingerprint and "works on my machine" diff; test evidence and flaky test notes; local SQLite and Docker Postgres snapshots before risky commands; Vercel deploy references; "What broke?"; ML save points and "rewind to the best run"; agent rules regressions; morning report for overnight agents |
| Later | Team sharing, an off-machine encrypted copy, guided Neon or Supabase branch recovery, game projects, verified research badges |
| Never | Unsend emails or payments, undo a deploy people saw, reverse production database writes, restore secret values, promise identical GPU results, replace a full disk backup |

Big new findings that change the plan:

- Pinned `refs/tm/*` commits live inside the project's `.git`, so an `rm -rf` of the project deletes them too. Each checkpoint also writes a small `git bundle` into the external store. Needs an ADR.
- Node's `fs.copyFile` clone flag does not make APFS clones on macOS. Use `/bin/cp -c`.
- Cursor can run Claude Code hooks from `.claude/settings.json`, so one hook kit may cover both.
- 64% of developers now use non-local environments as their main setup (Docker 2025), so the CLI must also run in cloud dev environments, CI and agent sandboxes.

## 11. Design

- App design spec: `design/APP_DESIGN_SPEC.md` (principles, the Rewind "Time View", AI features, every screen, overlays, visual system, copy, accessibility, roadmap).
- Website spec: `design/WEBSITE_SPEC.md` (12 beat scroll film, hero, sections, other pages, motion, copy deck, asset list).
- Clickable concepts: `design/concepts/app-rewind.html` and `design/concepts/site-story.html`. Simulated data only.
- Experience principles: `design/EXPERIENCE.md` (psychology, habit loop, aha moment, metrics, what we never do, two experiences on one engine, ethical attention rules).
- Legal drafts: `docs/legal/` (Terms, Privacy). Not in effect until a lawyer reviews them.

## 12. Research

All reports are in `.private/research/` (local only, because this repo is public):

- `10` competitors (checkpoint and rollback)
- `11` market, pain evidence, sizing, stress test
- `12` app, overlay, npm, storage, hooks, isolation
- `13` pricing, distribution, launch scripts, B2B, naming, fundraising
- `20` 31 big problems, top 10, pitches, capability map, ML, killer demos
- `21` rewind everything: environments, tests, cross tool timeline, ML, databases, mini backup
- `03` website design and `04` repos and skills are still valid
- `01` and `02` were written for the earlier payments idea; their legal and fundraising sections still apply
