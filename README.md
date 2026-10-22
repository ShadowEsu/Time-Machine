# Time Machine

[![CI](https://github.com/ShadowEsu/Time-Machine/actions/workflows/ci.yml/badge.svg)](https://github.com/ShadowEsu/Time-Machine/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Your AI agent broke it. Get back the version that passed your tests.

Time Machine saves your project before Claude Code acts. It runs your own tests on each save point in a separate copy, then brings back the newest one that passes, on a new branch. Your folder and current branch are never touched. Nothing is pushed, merged or deployed.

Website and waitlist: **https://time-machine-site.vercel.app**

> **Status: early.** The `tm` CLI, the web app (`tm ui`), the Claude Code hooks and the MCP server work from source. **Not on npm yet** (build below). The web app costs $50 once and needs a license key to open; checkout is not open yet.

## 30 seconds: watch it rescue a broken project

```text
$ tm demo
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
Not restored
  Secret values in .env: PORT, STRIPE_SECRET_KEY
  Databases, deployed versions and external services are not captured
```

Real output, shortened. `tm demo` builds a small synthetic app, breaks it the way an agent might, and rescues it with the real engine. It ends with the next step: `cd` into your own project, run `tm init`, then add the Claude Code plugin below.

## Install

Needs Node 22 or newer and Git.

Not on npm yet, so install from source:

```sh
git clone https://github.com/ShadowEsu/Time-Machine.git && cd Time-Machine
pnpm install && pnpm build
npm install -g ./packages/cli
tm demo
```

No pnpm? Run `npm install -g pnpm` first. The global `tm` points at this folder, so keep the folder.

## Claude Code plugin

With `tm` installed (see above), add Time Machine to Claude Code from this repo, with no account:

```text
/plugin marketplace add ShadowEsu/Time-Machine
/plugin install time-machine@time-machine
```

The plugin brings the Claude Code hooks, the MCP server and a `/time-machine:setup` skill that runs `tm init` with you. Its hooks run in every Claude Code session, but they act only in projects where you ran `tm init` on this computer. A `timemachine.yml` that came with a cloned repo is not enough: `tm init` approves the project's check (`verify.setup`, `verify.command` and `verify.network`) and records that approval in your Time Machine store, outside the project. `tm init --no-approve` writes or keeps the file without approving it, so you can read the guessed check first. Everywhere else, and when `tm` is not on your PATH, the hooks do nothing.

What you see in Claude Code: before a risky shell command such as `git reset --hard`, when Time Machine saved first, Claude Code shows you one line, for example "Time Machine saved cp-0007 before git reset --hard." It shows nothing when nothing changed since the last save point, and nothing on prompts or at the end of a turn. Hooks from `tm hook install` show the same line.

Not sure what is missing? `tm status` says whether the project has a `timemachine.yml` and whether this computer approved its check. `/time-machine:setup` runs it for you. If `tm init` finds no test command, it says so, and approves nothing until you set `verify.command`.

If the check changes after you approved it, for example after a `git pull` that edits the command or turns the network from `deny` to `allow`, the hooks stop. On your next prompt Claude Code shows you, once: "Time Machine: the check in timemachine.yml changed; run tm init to approve it." Running `tm init` again keeps your file as it is and approves the new check. The MCP tools `verify` and `find_good` need the same approval. Until then their descriptions name no command; after it, they show the command as quoted data (at most 200 characters), marked as data and not instructions.

The hooks and the MCP server go through `scripts/tm-hook` in the plugin. It runs `tm` only after checking that the `tm` on your PATH is Time Machine: the first line of `tm --help` must read "tm: save points for your project, checked with your own tests." Another program named `tm` never sees your prompts.

If a project also has hooks from `tm hook install`, the plugin steps aside there, so nothing saves twice.

Without `tm` on your PATH, Claude Code lists the `timemachine` MCP server as failed to connect. That is harmless.

## Open the web app

```sh
tm ui
```

This opens Time Machine in your browser. The server binds to `127.0.0.1` on your computer, not a cloud service. Add a Git project by its full local folder path, or choose **Try the demo** to exercise the real engine on synthetic data. Save, check, compare and recover use the same engine and store as the CLI. No project upload is needed.

Keep the terminal running. Ctrl+C stops the server. `tm ui --no-open` prints the address without opening a browser, and `tm ui --port 4388` chooses a port. Open the complete address printed for this run; it includes a private session key. Do not share it or expose the port through a tunnel. To open the browser, `tm ui` passes that address to your system's launcher (`open` or `xdg-open`), so other accounts on the same computer could see it in a process list for the moment the launcher runs. On a shared computer, use `tm ui --no-open` and paste the address yourself.

The web app is the only app. There is no Mac app, no installer and no account. Browser shortcuts work while the page is focused.

**Price.** The web app costs $50, paid once. There is no free plan and no subscription. The key works on any number of your own computers and projects, with updates while we ship them, and is verified offline. The first time you open `tm ui` it asks for the key; `tm license <key>` also saves it. Sign in on the website with your checkout email to see your key again. The `tm` command line tool is open source (MIT) and stays that way. Checkout is not open yet (ADR 0013).

## Your own project in four commands

```sh
cd my-app                      # any Git repo
tm init                        # guesses the check (npm test) and the install step (npm ci)
tm checkpoint -m "works"       # or let the Claude Code hooks save for you: tm hook install
# ...an agent breaks something...
tm find-good                   # checks save points newest first, each in a fresh copy
tm recover cp-0001             # new branch tm/recover/cp-0001 plus a recovery copy
```

Timed on 17 Oct 2026 on a real repo, `sindresorhus/slugify`, with the packed `timetm` package, from a clean folder with a fresh home and an empty npm cache: `init` to a verified recovery branch in **54 to 82 s** over two runs. Almost all of it is `npm install` inside the fresh copies, so it depends on your network. Script: `scripts/time-first-run.sh`.

## Safety limits

- **Not universal undo.** Databases, deployed versions, emails, payments and anything outside your project are not captured. Every result says what was not restored.
- **Secret values from config files like `.env` are never stored**, only key names and a fingerprint. You set them again by hand. Other files are skipped when their name or content matches a secret pattern; a secret that matches none, or one already committed to Git, is saved like any code.
- **Checks run in host mode:** a separate Git worktree with a clean environment and a time limit. That is weaker isolation than a container. With `network: deny` a sandbox turns the network off (`sandbox-exec` on macOS, `bwrap` or `unshare` on Linux); without a sandbox the verdict is BLOCKED.
- **A passing check means your tests passed,** not that the app is correct. A save point never checked is shown as not checked, never as working.

## Built and planned

| | What | Status |
|---|---|---|
| `tm` command | `init`, `checkpoint`, `timeline`, `diff`, `log`, `open`, `verify`, `find-good`, `recover`, `demo`, `hook install`, `mcp` | Built, tested |
| Web app | `tm ui`: onboarding, history, checks, comparison, rewind with undo, agents, storage, settings, opt-in Ask and read-only Vercel deploy links, live CLI and hook updates | Built from source |
| Claude Code hooks | Save before each prompt and before risky shell commands (`rm -rf`, `git reset --hard`, `git clean -f`, `DROP TABLE` and similar). Check at the end of each turn, and tell Claude if a working state just broke | Built, tested |
| MCP server | 7 tools for any agent that speaks MCP: checkpoint, timeline, diff, verify, find_good, recover, log | Built, tested |
| Store | Save points live in `~/.timemachine` (or `$TM_HOME`) with a git bundle, so they survive the project folder being deleted | Built, tested |
| Tests | 365 automated tests, passing in CI on macOS and Linux with Node 22 and 24 (2 run only on Linux). Also run on a real project, `sindresorhus/slugify` | Built |
| npm package | `timetm`, command `tm` | Not published yet |
| Website | Static site in `site/` with a waitlist, personal referral links and anonymous funnel counts. Public at https://time-machine-site.vercel.app | Live; waitlist saves once Supabase is set up |
| Action connector | Record and reverse, where honest, what agents do in Gmail, Slack, Notion, Calendar and Stripe through Claude and ChatGPT | Planned (v2), see ADR 0007 |
| Web app license | $50 once, no free plan: the web app needs a key to open. Updates while we ship them, key verified offline, sign in on the site to see it again. The CLI, hooks and MCP stay open source | Built (`tm license`, site checkout, sign-in); checkout not open yet, see ADR 0013 |

## Commands

| Command | What it does |
|---|---|
| `tm init [--no-approve]` | Writes `timemachine.yml` with a guessed check and install step, and approves its check for the Claude Code plugin. `--no-approve` only writes the file |
| `tm status` | Says whether this project is set up and its check approved on this computer. Changes nothing |
| `tm ui [--no-open] [--port N]` | Opens the web app in your browser; files and engine stay on your computer |
| `tm license [key] [--remove]` | Shows, saves or forgets the one-time web app license on this computer |
| `tm checkpoint -m "note"` | Saves code (including uncommitted changes), files not in Git yet, lockfiles and version pins such as `.nvmrc` even when `.gitignore` skips them, environment file digests, config key names, and runtime versions |
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

Engine commands take `--json`. Human and JSON output come from the same result. `tm ui` instead runs a local server until you stop it.

## Verdicts

| Verdict | Exit code | Meaning |
|---|---|---|
| PASS | 0 | The check passed |
| FAIL | 1 | The check failed |
| INCOMPLETE | 2 | Something saved is missing, or setup failed, so it was not checked |
| BLOCKED | 3 | The check cannot run yet, for example no check is set up or no sandbox for `network: deny` |
| ERROR | 4 | The check crashed, timed out, or the save point failed its integrity check |

Usage errors exit 64. A save point with no verdict is shown as not checked, never as working.

Save points and verdicts are signed with a key in `~/.timemachine`. That catches accidental edits and edits by tools that do not read the key. It is not tamper proof against someone who can read that key.

## The web app

The web app lives in `apps/web` and is built into the CLI package, so `tm ui` is all you need. `pnpm --filter @timetm/web build` makes a static preview with in-memory demo data in `apps/web/preview/dist/`; use `tm ui` for real projects. Details: `apps/web/README.md`. The Electron Mac app was retired on 22 October 2026 (ADR 0012).

## Repo map

`packages/core` (the one engine), `packages/cli` (`tm`, serves the web app), `apps/web` (the web app), `site/` (static website with two Vercel functions; waitlist setup: `docs/launch/SUPABASE_SETUP.md`), `docs/` (guide, plan, decisions).

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
| `docs/adr/` | Decisions, from the name (0001) to the web app (0012) and the one-time price (0013) |
| `docs/DEMO_SCRIPT.md` | The 60 second demo video |
| `docs/OUTREACH.md` | Finding and testing with the first 5 builders |
| `docs/apply/` | Drafts for a16z speedrun and YC W27 |
| `docs/legal/` | Terms and Privacy drafts, not in effect |
| `design/` | App and website design, experience rules |

## Who builds it

Preston Susanto, a student founder who builds with coding agents. Questions and bug reports: preston@unvibe.site or [GitHub issues](https://github.com/ShadowEsu/Time-Machine/issues).

## License

MIT for the code. See [LICENSE](LICENSE). The $50 web app license (ADR 0013) is a purchase, not a change to the code license. Time Machine is not affiliated with Apple Inc.
