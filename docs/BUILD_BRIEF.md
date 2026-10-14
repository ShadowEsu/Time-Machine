# Time Machine build brief

Status: planning. **Nothing is implemented yet.** Every feature below is planned unless a later version of this file marks it as implemented. Last updated 14 October 2026.

## 1. What Time Machine is

A checkpoint and recovery platform for digital projects.

**Core promise:** understand what changed, recover a working state, and safely move forward.

Git already keeps code history. A commit alone is not a complete backup of an application. Time Machine uses Git history and adds the context around it: captured files, selected configuration, dependencies, the environment definition, deployment references, and test results.

**What we never promise:** universal undo. Reverting code does not reverse database changes, payments, emails, deployments, or any other external action. Recovery is specific to each integration, and the product always says what it cannot restore.

## 2. What a checkpoint is

Every checkpoint answers five questions:

| Question | Example |
|---|---|
| What was captured? | Commit `a1b2c3d`, 4 untracked files, `package-lock.json` digest, Node 24.9, Dockerfile digest |
| What references were recorded? | Git commit and branch, remote URL, deployment ID if supplied |
| What can actually be restored? | Code, captured files, allowlisted config, environment definition |
| What is missing or needs manual recovery? | Database state, secret values, external services, uncaptured files |
| Was it verified to work? | `npm test` ran in a recreated environment: PASS, FAIL, INCOMPLETE, BLOCKED, or ERROR |

A checkpoint with no verification result is shown as **unverified**, never as working.

## 3. The user experience (long term)

1. Connect a project and choose what to capture.
2. Create scheduled checkpoints, plus checkpoints before important changes (an agent run, a deploy, a migration).
3. Browse a timeline and compare states.
4. Open an earlier state in a separate branch or isolated environment.
5. Test whether it works.
6. Recover selected components, or prepare a supported rollback.
7. Keep an audit trail of the recovery.

## 4. The MVP

**Scope:** a GitHub repository, plus backed-up project files, plus explicitly selected configuration, plus a reproducible environment definition, plus one verification command.

**The one experience to demonstrate:**

> This project broke after several changes. Find a recorded working checkpoint, recreate it separately, verify it, and prepare a recovery branch.

### Planned commands

| Command | What it does |
|---|---|
| `tm init` | Writes `timemachine.yml`: which files to capture, which config keys to allow, the environment definition, the verification command |
| `tm checkpoint [-m note]` | Records a checkpoint: Git references, captured files, config, dependency digests, environment digest, and a list of what is missing |
| `tm hook install` | Adds a Git hook and an agent hook (for example Claude Code) so checkpoints happen before risky changes |
| `tm timeline` | Lists checkpoints with time, note, commit, and verification status |
| `tm diff <a> <b>` | Compares two checkpoints: commits, files, config keys, dependencies, environment |
| `tm open <cp>` | Recreates a checkpoint in a separate Git worktree and isolated environment. Never touches the current working copy |
| `tm verify <cp>` | Runs the verification command inside that environment and records the result |
| `tm find-good` | Walks back through checkpoints and verifies them until it finds the most recent one that passes |
| `tm recover <cp>` | Creates a local recovery branch from a verified checkpoint, restores selected components, and prints the manual steps that remain. Never pushes, merges, or deploys |
| `tm log` | Shows the append-only audit trail of checkpoints, opens, verifications, and recoveries |

### Requirements (P0)

| ID | Requirement |
|---|---|
| C01 | Project manifest (`timemachine.yml`) validated with a schema |
| C02 | Checkpoint records Git commit, branch, remote, and dirty state |
| C03 | Captures explicitly selected untracked files into a local content-addressed store |
| C04 | Captures only allowlisted config. Secret values are never stored, only key names |
| C05 | Records dependency lockfile digests, runtime versions, and the environment definition digest |
| C06 | Every checkpoint has a coverage report: captured, restorable, missing, manual |
| C07 | Checkpoints are immutable once written, with an integrity check |
| C08 | Timeline and diff between any two checkpoints |
| C09 | `open` recreates the state in a separate worktree and environment, leaving the working copy untouched |
| C10 | `verify` runs the declared command with a time limit and records the verdict |
| C11 | `find-good` locates the newest passing checkpoint |
| C12 | `recover` creates a local recovery branch and a written recovery report |
| C13 | Append-only audit log of every action |
| C14 | Human output plus JSON output for agents and CI |

### Verdicts

| Verdict | Exit code | Meaning |
|---|---|---|
| PASS | 0 | The verification command succeeded in the recreated state |
| FAIL | 1 | The state was recreated and the command failed |
| INCOMPLETE | 2 | The state could not be fully recreated (missing file, missing secret, unavailable dependency) |
| BLOCKED | 3 | A policy refused the action (for example network use during verification) |
| ERROR | 4 | Time Machine or the environment itself failed |

### Out of scope for the MVP

Hosted dashboard, accounts, billing, team sharing, database snapshots, deployment rollback, cloud storage sync, scheduled background service, non-Git projects, and business-automation replay. Business-automation replay (turning failed purchase-to-access webhooks into replayable tests) moves to a later specialized capability. The earlier spec for it is kept in `.private/research/00-business-plan.md`.

### Acceptance tests (P0)

| ID | Test |
|---|---|
| V01 | `open` never modifies the current working copy or the current branch |
| V02 | A checkpoint taken with uncommitted changes restores those changes exactly |
| V03 | Secret values in `.env` style files never appear in the store, logs, or reports |
| V04 | A missing captured file makes the checkpoint INCOMPLETE, not PASS |
| V05 | A tampered checkpoint is rejected by the integrity check |
| V06 | `verify` reports FAIL for a broken state and PASS for a working state |
| V07 | `find-good` returns the newest passing checkpoint in the demo history |
| V08 | `recover` creates a local branch, never pushes, and lists manual steps |
| V09 | A verification command that exceeds its time limit ends as ERROR with a clear message |
| V10 | Network use during verification is BLOCKED when the policy says off |
| V11 | The audit log records every checkpoint, open, verify, and recover |
| V12 | Human and JSON output agree on every result |

### The demo project

A small TypeScript web app with a working test suite. Its history:

1. Checkpoint 1: working.
2. Checkpoint 2: working, with a captured `.env.example` and config.
3. An agent refactors a module. Tests still pass.
4. The agent "fixes" a lint error and breaks a function. Tests fail.
5. Someone changes a config value and adds a dependency. Still broken.

The demo runs `tm find-good`, which skips the broken states and finds checkpoint 3. Then `tm open`, `tm verify` (PASS), and `tm recover`, which creates `tm/recover/cp-0003`. The recovery report ends with: "Code, captured files, and config restored on a local branch. Not restored: database, deployed version, secret values. Review and merge when ready."

## 5. Engineering plan

**Proposed stack** (each choice gets a short ADR in `docs/adr/`):

- TypeScript strict on Node 24 LTS (verify the current LTS line at kickoff). pnpm. Zod for schemas. Vitest for tests.
- Git through the `git` command line, not a reimplementation. `git worktree` for separate checkouts.
- Local store in `.timemachine/` (gitignored): content-addressed blobs plus one JSON manifest per checkpoint.
- Environment: start with a Dockerfile or `devcontainer.json`, run through Docker. A "host" mode without a container is allowed, but it is labeled as weaker isolation in every report. Decide in ADR-001.
- Verification network policy: off by default during verification, on during the environment build. Decide the mechanism in ADR-002.

**First ten working days:**

| Day | Work |
|---|---|
| 1 | Demo project and its broken history; write V01 to V12 as failing tests |
| 2 | Manifest schema, checkpoint schema, threat model (secrets, working copy safety) |
| 3 to 4 | `init` and `checkpoint`: Git references, captured files, config allowlist, coverage report |
| 5 | `timeline` and `diff` |
| 6 to 7 | `open` with worktree plus environment, and `verify` with verdicts |
| 8 | `find-good` and `recover` with the recovery report |
| 9 | Audit log, JSON output, integrity checks, secret tests |
| 10 | Someone else runs the demo from a clean machine; record every point of confusion |

## 6. Market position

**Closest competitors:**

- **Entire.** Founded by former GitHub CEO Thomas Dohmke, $60M seed (February 2026). Its open source Checkpoints CLI records agent session context alongside commits on a separate branch, with rewind and resume. It focuses on capturing why code changed.
- **In-tool checkpoints:** Claude Code rewind, Cursor, Replit (which also snapshots connected databases), Kiro, and other IDE agents. These are limited to their own tool, and some expire.
- **Small open source tools** such as Agent Rollback (an MCP server that snapshots the workspace).
- **Git itself,** plus CI and platform rollbacks such as Vercel instant rollback.

**Where Time Machine can win:** a checkpoint you know works. Others save states. Time Machine recreates a state separately, runs your verification, tells you honestly what it could not restore, and hands you a reviewed recovery branch. It works across agents and tools, with no lock-in.

**Positioning lines to test:**

- "Every checkpoint, verified."
- "Go back to the last version that actually worked."
- "Your agent broke it. Time Machine finds the last working state, proves it, and hands you a recovery branch."

## 7. Website plan

The design system from the research still applies. The story changes.

- **Stack:** Next.js on Vercel, scroll-beat-kit for the pinned story decks, Motion for small animation.
- **Type:** Inter Display, Inter, and Geist Mono.
- **Brand:** "Monolith", black on white. Color appears only with verdicts.
- **Hero:** "Time Machine" huge in black. One line: "Go back to what worked." Two buttons.

| Deck | Beats |
|---|---|
| 1. The break | It worked on Monday. An agent made six commits. Now nothing runs. Which change did it? |
| 2. The timeline | Every change has a checkpoint. Code, files, config, environment. Each one says what it can and cannot restore. Rewind. |
| 3. The proof | Open it separately, your project untouched. Verify: FAIL, FAIL, PASS. Recover to a branch you review. An audit trail of everything. |

Supporting pages: Product, How it works (including "what we cannot undo"), Docs, Changelog, Security, Company story, and an `/agents` page with a `SKILL.md`.

## 8. Open decisions

1. **The name.** Apple's Time Machine is backup and restore software, and Apple holds "TIME MACHINE" as a software trademark. This product is now also backup and restore, so the risk is higher than before. Get a trademark attorney's opinion before any public launch, domain purchase, or logo work. "Time Machine" stays a working name until then.
2. **Environment format:** Dockerfile, `devcontainer.json`, or both.
3. **Where checkpoints live:** local only for the MVP. Later, a separate Git ref, a separate remote, or a hosted store.
4. **Open source license** for the CLI.

## 9. Research status

- **Still valid** in `.private/research/` (local only): the website design research, the repo and skills research, and the sales, pricing, legal, and fundraising research.
- **Out of date:** the market research was written for the payments replay idea. It needs a new pass on the checkpoint and recovery market before pricing or fundraising.
