# Time Machine

**Save points for your code, with proof of which ones still work.**

When a coding agent or a late night change breaks your project, Time Machine finds the newest save point that still passes your check. It rebuilds that version in a separate copy, proves it works, and makes a recovery branch. It never touches your folder or your current branch, and it never pushes, merges or deploys.

Git remembers your code. Time Machine remembers whether it worked.

> **Status: early.** The engine, the `tm` command, Claude Code hooks and the MCP server work and are tested. They are **not on npm yet**. The Mac app is **in development**. Anything marked Planned is not built.

## See it in a few seconds

```text
$ tm demo
Built a demo project, Marigold Tips, in /tmp/tm-demo-xYg9f5/marigold-tips
  cp-0001   Initial tip calculator
  cp-0002   Added split bill
  cp-0003   Added dark mode
  cp-0004   Agent: fixed lint warnings    <- an agent's lint fix broke it here
  cp-0005   Changed currency
  cp-0006   Added a dependency

$ tm find-good
  cp-0006   FAIL       The check failed with exit code 1.
  cp-0005   FAIL       The check failed with exit code 1.
  cp-0004   FAIL       The check failed with exit code 1.
  cp-0003   PASS       The check passed.
PASS  cp-0003 is the newest version that works.

$ tm recover cp-0003
Recovery ready for cp-0003. Nothing was pushed, merged or deployed. Your folder and branch were not touched.
  Branch          tm/recover/cp-0003
  Saved first     cp-0007, your state before this recovery
  Last check      PASS
Not restored
  Secret values in .env: PORT, STRIPE_SECRET_KEY
  Databases, deployed versions and external services are not captured
```

That is real output, shortened. `tm demo` builds a small synthetic app, breaks it the way an agent might, and rescues it with the real engine. The `.env` key in it is fake.

## Quick start

**From source, today.** Needs Node 22 or newer, pnpm and Git.

```sh
git clone https://github.com/ShadowEsu/Time-Machine.git
cd Time-Machine
pnpm install
pnpm build
node packages/cli/dist/tm.js demo
```

To use it on your own project, make `tm` point at the build, then run it in your project folder:

```sh
alias tm="node /path/to/Time-Machine/packages/cli/dist/tm.js"
tm init                          # writes timemachine.yml with a guessed check, like npm test
tm checkpoint -m "first save point"
tm verify                        # runs the check on the newest save point
tm hook install                  # optional: Claude Code hooks
```

**From npm, once published.** The package is `timetm` and the command is `tm`. This does not work yet:

```sh
npx timetm init
```

## Built and planned

| | What | Status |
|---|---|---|
| `tm` command | `init`, `checkpoint`, `timeline`, `diff`, `log`, `open`, `verify`, `find-good`, `recover`, `demo`, `hook install`, `mcp` | Built, tested |
| Claude Code hooks | Save before each prompt and before risky shell commands (`rm -rf`, `git reset --hard`, `git clean -f`, `DROP TABLE` and similar). Check at the end of each turn, and tell Claude if a working state just broke | Built, tested |
| MCP server | 7 tools for any agent that speaks MCP: checkpoint, timeline, diff, verify, find_good, recover, log | Built, tested |
| Store | Save points live in `~/.timemachine` (or `$TM_HOME`) with a git bundle, so they survive the project folder being deleted | Built, tested |
| Tests | 250 automated tests, passing in CI on macOS and Linux with Node 22 and 24 (2 run only on Linux). Also run on a real project, `sindresorhus/slugify` | Built |
| npm package | `timetm`, command `tm` | Not published yet |
| Mac app | Notebook history, Rewind dial with undo, Compare, agent channels, overlays, opt-in Ask and read-only Vercel deploy links. Native macOS smoke exercised real-engine recovery and the non-focusing corner card | Built from source; not signed or shipped |
| Website | Static site in `site/` with a waitlist, personal referral links and anonymous funnel counts. Public at https://time-machine-site.vercel.app | Live; waitlist saves once Supabase is set up |
| Action connector | Record and reverse, where honest, what agents do in Gmail, Slack, Notion, Calendar and Stripe through Claude and ChatGPT | Planned (v2), see ADR 0007 |
| Pro pricing | "The Ladder": $9 a month, $8 from month 7, $7 from month 13, $6 floor. The CLI is free. Restores are never paywalled | Planned, see ADR 0002 |

## Commands

| Command | What it does |
|---|---|
| `tm init` | Writes `timemachine.yml` with a guessed check |
| `tm checkpoint -m "note"` | Saves code (including uncommitted changes), files not in Git yet, config key names, lockfile and environment digests |
| `tm timeline` | Lists save points and their verdicts |
| `tm diff cp-0002 cp-0004` | Compares code, files, config keys, dependencies and environment |
| `tm open cp-0003` | Rebuilds a save point in a separate folder |
| `tm verify cp-0003` | Runs your check there and records a verdict |
| `tm find-good` | Walks back until a save point passes |
| `tm recover cp-0003` | Saves your current state first, then makes branch `tm/recover/cp-0003` and a recovery copy |
| `tm log` | Shows the append-only audit log |
| `tm demo` | Builds a small broken project and rescues it |
| `tm hook install` | Adds the Claude Code hooks to `.claude/settings.json` |
| `tm mcp` | Runs the MCP server on stdio. Add it with `claude mcp add timemachine -- tm mcp` |

Every command takes `--json`. Human and JSON output come from the same result, so they never disagree.

## Verdicts

| Verdict | Exit code | Meaning |
|---|---|---|
| PASS | 0 | The check passed |
| FAIL | 1 | The check failed |
| INCOMPLETE | 2 | Something saved is missing, or setup failed, so it was not checked |
| BLOCKED | 3 | The check cannot run yet, for example no check is set up or no sandbox for `network: deny` |
| ERROR | 4 | The check crashed, timed out, or the save point failed its integrity check |

Usage errors exit 64. A save point with no verdict is shown as not checked, never as working.

## What it does not do

Time Machine is not universal undo. It does not restore databases, deployed versions, emails, payments or anything outside your project. It never stores secret values, only key names and a fingerprint, so you set those again by hand. Every save point and every recovery says what was not restored.

Checks run in **host mode**: a separate Git worktree on your machine with a clean environment and a time limit. That is weaker isolation than a container, and every verdict says so. With `network: deny`, the check runs with the network off through a sandbox (`sandbox-exec` on macOS, `bwrap` or `unshare` on Linux). If no sandbox is available, the check does not run and the verdict is BLOCKED.

Save points and verdicts are signed with a key in `~/.timemachine`. That catches accidental edits and edits by tools that do not read the key. It is not tamper proof against someone who can read that key.

## The Mac app (in development)

On a Mac, from the repo root: `pnpm app`. To see it in any browser with demo data, run `pnpm --filter @timetm/desktop preview:build` and open `apps/desktop/preview/dist/index.html`. A banner says it is a preview. Details: `apps/desktop/README.md`.

## The website

`site/` is a static site with no build step: plain HTML, CSS and JavaScript, self hosted fonts, and two small Vercel functions in `site/api/`. More pages are in progress.

Preview it locally:

```sh
python3 -m http.server 8080 --directory site
```

Then open http://localhost:8080. The waitlist form needs the Vercel function, so it will not save from this preview. To run the function too, use `vercel dev` inside `site/` (needs the Vercel CLI and a login).

## Waitlist setup (for the founder)

The form posts to `/api/waitlist`, which writes to Supabase. Until the settings exist, the form says the waitlist opens soon and asks people to email the founder. It never fakes a signup.

Step by step, with the SQL to paste and the queries to read signups and the funnel: `docs/launch/SUPABASE_SETUP.md`. Check it at `/api/health`, which should say `"waitlist":true`. What is stored: `site/privacy.html` and `supabase/README.md`. The decision: `docs/adr/0006-waitlist-backend.md`.

## Run the tests

```sh
pnpm typecheck
pnpm test
```

The acceptance tests V01 to V14 run on a synthetic project. Every bug fix starts with a failing test.

## Docs

| File | What it is |
|---|---|
| `docs/GUIDE.md` | The user guide |
| `docs/BUILD_BRIEF.md` | Scope and requirements, the source of truth |
| `docs/PLAN.md` | Milestones, dates and founder tasks |
| `docs/adr/` | Decisions, from the name (0001) to the action connector (0007) |
| `docs/DEMO_SCRIPT.md` | The 60 second demo video |
| `docs/OUTREACH.md` | Finding and testing with the first 5 builders |
| `docs/apply/` | Drafts for a16z speedrun and YC W27 |
| `docs/legal/` | Terms and Privacy drafts, not in effect |
| `design/` | App and website design, experience rules |

## Who builds it

Preston Susanto, a student founder who builds with coding agents. He also built Unvibe. Questions and bug reports: preston@unvibe.site.

Time Machine is not affiliated with Apple Inc.
