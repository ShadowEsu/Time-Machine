# Time Machine

Save points for your projects, with proof of which ones still work.

When an AI agent or a late night change breaks your project, Time Machine finds the newest save point that still passes your check, rebuilds it in a separate copy, and prepares a recovery branch. It never touches your folder or your current branch, and it never pushes, merges or deploys.

**Status: early. Not on npm yet.** The engine, the CLI, Claude Code hooks and the MCP server below work and are tested. The Mac app is planned.

## What works today

| Command | What it does |
|---|---|
| `tm init` | Writes `timemachine.yml` with a guessed check, like `npm test` |
| `tm checkpoint -m "note"` | Saves code (including uncommitted changes), files not in Git yet, config key names, lockfile and environment digests |
| `tm timeline` | Lists save points and their verdicts |
| `tm diff cp-0002 cp-0004` | Compares code, files, config keys, dependencies and environment |
| `tm open cp-0003` | Rebuilds a save point in a separate folder |
| `tm verify cp-0003` | Runs your check there and records a verdict |
| `tm find-good` | Walks back until a save point passes |
| `tm recover cp-0003` | Saves your current state first, then makes branch `tm/recover/cp-0003` and a recovery copy |
| `tm log` | Shows the append-only audit log |
| `tm demo` | Builds a small broken project and rescues it, so you can watch the whole thing in a minute |
| `tm hook install` | Adds Claude Code hooks: a save point before each prompt and risky command, and a check when Claude stops that tells it if a working state just broke |
| `tm mcp` | An MCP server so agents can save, check, find and recover through the same engine |

Every command takes `--json`. Human and JSON output come from the same result.

## What it does not do

Time Machine is not universal undo. It does not restore databases, deployed versions, emails, payments or anything outside your project. It never stores secret values, only key names and a fingerprint, so you set those again by hand. Every save point and every recovery says what was not restored.

Checks run in **host mode**: a separate Git worktree on your machine with a clean environment and a time limit. That is weaker isolation than a container, and every verdict says so. With `network: deny`, checks run with no network through a sandbox. If no sandbox is available, the check does not run and the verdict is BLOCKED.

## Verdicts

| Verdict | Exit code | Meaning |
|---|---|---|
| PASS | 0 | The check passed |
| FAIL | 1 | The check failed |
| INCOMPLETE | 2 | Something saved is missing, so it was not checked |
| BLOCKED | 3 | The check cannot run yet, for example no check is set up |
| ERROR | 4 | The check crashed, timed out, or the save point failed its integrity check |

Usage errors exit 64.

## Try it from source

Needs Node 22 or newer, pnpm and Git.

```sh
pnpm install
pnpm build
pnpm test            # runs the acceptance tests V01 to V14 on a synthetic demo project
node packages/cli/dist/tm.js demo
```

Save points live outside your project in `~/.timemachine` (or `$TM_HOME`), so deleting the project folder does not delete them.

## Docs

- `docs/GUIDE.md`: the user guide
- `docs/BUILD_BRIEF.md`: scope and requirements
- `docs/PLAN.md`: milestones and dates
- `docs/adr/`: decisions
- `design/`: app and website design
