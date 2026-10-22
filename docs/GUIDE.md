# Time Machine user guide

Save points for your projects before AI agents act, checked with your own tests.

## 1. What Time Machine is and is not

Time Machine saves your project as save points. The CLI calls them checkpoints, with IDs like `cp-0003`. Each one records your code (including uncommitted changes), files not in Git yet, config key names, and dependency and environment digests.

Later it can rebuild any save point in a separate copy, run your check there, and tell you which one still works. Then it prepares a recovery branch for you.

What it is not:

- It is not universal undo. It does not restore databases, deployed versions, emails, payments or anything outside your project folder.
- It never stores secret values from config files like `.env`, only key names and a fingerprint. You set those again by hand. Other files are skipped only when their name or content matches a secret pattern.
- It does not replace a full disk backup.
- Checks run in host mode by default. That is weaker isolation than a container, and every verdict says so.
- A save point that was never checked is shown as "not checked", never as working.

## 2. Install

Time Machine is not on npm yet. `npx timetm init` will work only once it is published. For now, build it from source.

You need Node 22 or newer, pnpm and Git.

```sh
git clone <this repository> Time-Machine
cd Time-Machine
pnpm install
pnpm build
node packages/cli/dist/tm.js --help
```

To run `tm` from any folder, install it globally from this folder:

```sh
npm install -g ./packages/cli
tm --version
```

The global `tm` points at this folder, so keep the folder. The MCP server is added as `tm mcp`, so it needs `tm` on your PATH.

## 3. Two minute tour

```sh
tm demo
```

`tm demo [dir]` builds a synthetic project called "Marigold Tips", a tiny JavaScript tip calculator with tests. It records 6 save points:

| Save point | Note | Works? |
|---|---|---|
| cp-0001 | Initial tip calculator | yes |
| cp-0002 | Added split bill | yes |
| cp-0003 | Added dark mode | yes |
| cp-0004 | Agent: fixed lint warnings | no, rounding broke |
| cp-0005 | Changed currency | no |
| cp-0006 | Added a dependency | no |

Then it runs `find-good` and `recover` so you see the whole rescue in under a minute. It lands on cp-0003 and creates the branch `tm/recover/cp-0003`. Pass a folder name to choose where the demo goes. The demo uses your normal store, so its save points show up next to your own projects. All data in it is fake.

The demo ends with the next step: `cd` into your own project, run `tm init`, then add the Claude Code plugin (section 9). `tm demo --json` prints the same result as before, with no next step in it.

## 4. Your own project in ten minutes

Your project must be a Git repository.

**Step 1. Set it up.**

```sh
cd my-app
tm init
```

```
Created /home/you/my-app/timemachine.yml
  Check     npm test
  Setup     npm ci --prefer-offline --no-audit --no-fund   (runs first in each fresh copy)
  Network   on during checks
Next: tm checkpoint -m "first save point"
```

`init` guesses the check: `npm test`, then `npm run build`, then `cargo test`, `go test ./...` or `pytest`. If it finds nothing, the check is empty and `init` says so: "No test command found, so save points can't be checked yet. Set verify.command in timemachine.yml, then run tm init again to approve it." An empty check is never approved, so the Claude Code plugin stays off in that project until you set one.

Checks run in a fresh copy with no `node_modules`, so `init` also guesses the install step for Node projects with dependencies: `npm ci` with a `package-lock.json`, `pnpm install --frozen-lockfile` with a `pnpm-lock.yaml`, `yarn install --frozen-lockfile` with a `yarn.lock`, otherwise `npm install`. It is written as `verify.setup` and you can change it. Setup always has the network.

**Step 2. Save.**

```sh
tm checkpoint -m "Added dark mode"
```

```
Saved cp-0003  "Added dark mode"
  Code: commit 4e1d0b7 on main, including 2 uncommitted changes
  Files: 1 file not in Git
  Config: 2 keys in .env (0 saved, 2 name only)
  Environment: platform linux-x64, node v22.18.0, git 2.43.0
Not saved
  Secret values in .env: PORT, STRIPE_SECRET_KEY
  Databases, deployed versions and external services are not captured
Not checked yet.
Next: tm verify cp-0003
```

**Step 3. Check it.**

```sh
tm verify cp-0003
```

```
PASS       cp-0003 works (host mode, network on, 1.4 s)
           The check passed.
           Log: /home/you/.timemachine/projects/9f2c41d07a3be815/logs/cp-0003-2026-10-15T10-42-07-311Z.log
```

**Step 4. When something breaks, find the last working version.**

```sh
tm find-good
```

```
  cp-0006   FAIL       The check failed with exit code 1.
  cp-0005   FAIL       The check failed with exit code 1.
  cp-0004   FAIL       The check failed with exit code 1.
  cp-0003   PASS       The check passed.
PASS  cp-0003 is the newest version that works.
Next: tm recover cp-0003
```

**Step 5. Recover.**

```sh
tm recover cp-0003
```

```
Recovery ready for cp-0003. Nothing was pushed, merged or deployed. Your folder and branch were not touched.
  Branch          tm/recover/cp-0003
  Recovery copy   /home/you/my-app-recovered-cp-0003
  Saved first     cp-0007, your state before this recovery
  Last check      PASS
Restored
  Code at commit 4e1d0b7
  1 saved file
Not restored
  Secret values in .env: PORT, STRIPE_SECRET_KEY
  Databases, deployed versions and external services are not captured
Manual steps
  Set PORT in .env in the recovery copy.
  Set STRIPE_SECRET_KEY in .env in the recovery copy.
  Review the recovery copy at /home/you/my-app-recovered-cp-0003.
  Keep working in the recovery copy. Review and commit the restored files you want to keep before moving or removing it.
Report: /home/you/.timemachine/projects/9f2c41d07a3be815/reports/recover-cp-0003-2026-10-15T10-45-12-004Z.md
```

Your broken state was saved first as cp-0007, so you can always come back to it.

## 5. Commands reference

Every command takes `--json`. The JSON and the human output come from the same result. `-h`, `--help` and `--version` work everywhere.

| Command | What it does |
|---|---|
| `tm init [--no-approve]` | Writes `timemachine.yml` with a guessed check and install step. Keeps an existing file. Approves the current check on this computer for the Claude Code plugin and the MCP `verify` and `find_good` tools. Run it again to approve a changed check. `--no-approve` only writes or keeps the file, and prints how to approve. |
| `tm status` | Says if this project has `timemachine.yml` and if this computer approved its check. Changes nothing. `--json` prints `{"initialized", "approved", "check"}`; `check` is null when there is no `verify.command`. The plugin's setup skill uses it. |
| `tm checkpoint [-m note] [--if-changed]` | Saves a save point. `--if-changed` skips it when nothing changed since the newest one. |
| `tm timeline` | Lists save points, newest first, with verdicts. |
| `tm diff <a> <b>` | Compares code, files, config keys, dependencies and environment. |
| `tm open <cp> [--dir path]` | Rebuilds a save point in a separate folder. Default is a temp folder. |
| `tm verify [cp]` | Runs the check on a save point. Default is the newest. |
| `tm find-good` | Checks save points from newest to oldest until one passes. |
| `tm recover <cp>` | Saves your current state, then makes a recovery branch and copy. |
| `tm log` | Shows the append-only audit log. |
| `tm demo [dir]` | Builds the Marigold Tips demo and runs the rescue. |
| `tm hook install` | Adds Claude Code hooks to `.claude/settings.json`. |
| `tm hook <prompt\|pre-bash\|stop> [--if-initialized]` | What the hooks call. Reads hook JSON on stdin. `--if-initialized` does nothing, silently, unless this computer approved the project's check with `tm init`. The Claude Code plugin uses it. |
| `tm mcp` | Runs an MCP server over stdio. |

`checkpoint` also takes `--trigger <name>` to label what caused the save point. The default is `manual`. A trigger that starts with `claude-code` is refused with a usage error (exit code 64), because only the hooks (`tm hook`) can mark a save point as made by Claude Code.

Each save point also records which agent made it, when one did: `agent: { name, prompt }` in `tm timeline --json`. The Claude Code hooks record "Claude Code" and the prompt of the current turn, clipped to one line. A prompt is stored as "(text hidden...)" instead when it looks like it holds a secret (the same rule as notes), when it contains any current secret value from the project's config files such as `.env`, or when it contains a URL with a user and password, like `postgres://user:pass@host`. `--trigger mcp` records "MCP agent". Save points made by you, the app, or older versions of Time Machine have `agent: null`.

`timeline` rows look like this:

```
History of my-app
cp-0004   FAIL        2026-10-15 10:51  8a03f6e  Agent: fixed lint warnings
cp-0003   PASS        2026-10-15 10:42  4e1d0b7  Added dark mode
```

`diff` lines use `+` added, `-` removed, `~` changed, and Git's `A`, `M`, `D` for code.

**Exit codes.** `verify` and `find-good` exit with the verdict code: PASS 0, FAIL 1, INCOMPLETE 2, BLOCKED 3, ERROR 4. Other commands exit 0 on success and 4 on an error, such as "There are no checkpoints yet". Usage errors exit 64. That includes bad flags, unknown commands and an invalid `timemachine.yml`.

## 6. timemachine.yml reference

The file lives at your project root. Unknown keys are rejected, so typos show up as errors.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `version` | `1` | `1` | File format version. |
| `verify.command` | string | `""` | The check. Exit 0 means it works. Empty means BLOCKED. |
| `verify.setup` | string | `""` | Runs before the check, for example `npm ci`. Shares the time limit. It always has the network so it can install dependencies. |
| `verify.timeoutSeconds` | whole number, 1 to 86400 | `600` | Longer checks stop with ERROR. |
| `verify.network` | `allow` or `deny` | `allow` | `deny` turns the network off during checks. Needs a sandbox. |
| `capture.untracked` | boolean | `true` | Save files not in Git, unless `.gitignore` skips them. |
| `capture.include` | list of paths or patterns | `[]` | Ignored files to save anyway. |
| `capture.maxFileMB` | number, up to 1024 | `5` | Larger files are not saved. |
| `config.files` | list of paths | `[".env"]` | Config files. Only key names and a fingerprint are saved. |
| `config.plain` | list of key names | `[]` | Keys whose values are safe to save, unless they look like a secret. |
| `environment.files` | list of paths inside the project | see below | Environment definition files. Saved even when `.gitignore` skips them, restored, and checked against their digest. |

The default `environment.files` list is `Dockerfile`, `docker-compose.yml`, `compose.yaml`, `.nvmrc`, `.node-version`, `.tool-versions`, `.python-version` and `.devcontainer/devcontainer.json`.

`tm init` writes `network: deny` only when it finds a sandbox. Otherwise it writes `allow`.

Example:

```yaml
version: 1
verify:
  setup: "npm ci"
  command: "npm test"
  timeoutSeconds: 600
  network: allow
capture:
  untracked: true
  include: ["data/seed.json"]
  maxFileMB: 5
config:
  files: [".env"]
  plain: ["PORT", "LOG_LEVEL"]
```

## 7. What is saved and what is not

**Saved:**

- Code, including uncommitted changes to tracked files. Each save point is a Git commit pinned at `refs/tm/<id>` and also written as a Git bundle into the store.
- Files not in Git yet, unless `.gitignore` skips them, plus anything in `capture.include`.
- Config key names and a fingerprint, so changes show up in `diff`. Values only for keys in `config.plain`.
- Lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `Cargo.lock`, `go.sum` and others) and environment definition files (`Dockerfile`, `.nvmrc` and the rest of `environment.files`), saved as files even when `.gitignore` skips them, plus their digests. A recovery lists them under "Dependencies" and "Environment definition" only when the copy holds the exact saved bytes.
- Node, Git and platform versions. Recorded and compared by `tm diff`, not restored.

**Not saved:**

- Secret values. A file that looks like it contains a secret is skipped and listed.
- Files over `capture.maxFileMB`, and symbolic links. These are listed as missing.
- Installed dependencies such as `node_modules`. The lockfile comes back; the install step rebuilds them.
- Other files your `.gitignore` skips. Each save point lists them, for example "Files your .gitignore skips were not saved: node_modules/, dist/".
- Databases, deployed versions and external services.

Every save point lists what it did not save.

**Where the store lives.** In `~/.timemachine`, or `$TM_HOME` if you set it. Each project gets a folder at `projects/<hash of the project path>/` with `objects/`, `checkpoints/`, `bundles/`, `logs/`, `reports/`, `audit.jsonl` and `project.json`. Deleting your project folder does not delete its save points. Keep `~/.timemachine/key` too. It signs every save point, so edits by other tools are caught. Save points are not encrypted: anyone who can read your disk can read them.

## 8. Verdicts and what to do

| Verdict | Exit | Meaning | What to do |
|---|---|---|---|
| PASS | 0 | The check passed. | Safe to recover to. |
| FAIL | 1 | The check failed. | Run `tm find-good`. Read the log path shown. |
| INCOMPLETE | 2 | Something saved is missing, so the check did not run. | See the listed files. Raise `capture.maxFileMB`, or skip the file in `.gitignore`. |
| BLOCKED | 3 | The check cannot run yet. | Fix the reason shown. |
| ERROR | 4 | The check crashed, timed out, or the save point failed its integrity check. | Raise `verify.timeoutSeconds`, make sure the command is installed, or pick another save point. |

`find-good` keeps going past FAIL, INCOMPLETE and ERROR. It stops at the first PASS, or at BLOCKED.

**Common BLOCKED reasons:**

- No check is set up. Add `verify.command` to `timemachine.yml`.
- The network is set to `deny` but no sandbox is available. Time Machine never runs the check with the network on in that case. Fix it one of two ways:
  - On Linux, install bubblewrap, for example `sudo apt install bubblewrap`. On macOS the built in `sandbox-exec` is used.
  - Or set `verify.network: allow`.

With `network: deny`, the `setup` step still has the network so it can install dependencies. Only the check itself runs without it.

Checks run with a clean environment. Only `PATH`, `HOME`, `USER`, `LOGNAME`, `LANG`, `TMPDIR`, `SHELL`, proxy and certificate settings, package manager settings like `npm_config_*`, and your `config.plain` values are passed in, plus `CI=1`. A check that needs a secret value may fail.

## 9. Using it with AI agents

### Claude Code hooks

```sh
tm hook install
```

This adds hooks to the project's `.claude/settings.json`. Your existing settings stay.

- **Before each prompt:** saves a save point. It is skipped if nothing changed.
- **Before risky shell commands** like `rm -rf` or `git reset --hard`: saves a save point first. Claude Code then shows you one line, for example "Time Machine saved cp-0007 before git reset --hard." The command is clipped to about 60 characters, and replaced by "a risky command" when it holds a secret. Nothing is shown when nothing changed since the last save point, and the prompt and Stop hooks show nothing.
- **When Claude stops:** saves and runs the check. If the check passed before and fails now, it tells Claude which save point last worked.

Hooks never block the agent because of their own errors. Prompt text and the risky command in a save point's note are hidden when they look like a secret, hold a current secret value from your config files such as `.env`, or have a URL with a user and password in it.

The hooks call `tm hook prompt`, `tm hook pre-bash` and `tm hook stop`. You do not run these yourself. If a `tm` that is this same version is on your PATH, the hooks call `tm`. Otherwise they call the `tm` that ran `tm hook install`, by its absolute path, with the same Node. `tm hook install` prints the command. If you move or delete that folder, run `tm hook install` again. Only a `tm` run through `npx` makes the hooks call `npx -y timetm@<version>`, pinned to the exact version that installed them.

### Claude Code plugin

Instead of `tm hook install`, you can add the Time Machine plugin to Claude Code from this repo:

```text
/plugin marketplace add ShadowEsu/Time-Machine
/plugin install time-machine@time-machine
```

It brings the same three hooks, the MCP server (`tm mcp`) and a `/time-machine:setup` skill that runs `tm init` with you. The skill first runs `tm status --json` and tells you what is missing: no `timemachine.yml`, no check, or a check not approved on this computer. `tm` must be installed and on your PATH. The plugin hooks run in every Claude Code session, so they call `tm hook <event> --if-initialized`, which acts only where you approved the check:

- **A `timemachine.yml` alone is not consent.** A cloned repo can ship one. `tm init` (or setting the check in the app) records `consent.json` in the project's store, `~/.timemachine/projects/<id>/`, outside the repo: a SHA-256 hash of `verify.setup`, `verify.command` and `verify.network`, encoded as a JSON array so the fields cannot run together. All three hooks need it, because save points copy files like `.env` and Stop runs the check. `tm init --no-approve` writes the file without approving it, so you can read the guessed check first.
- **A changed check stops the hooks.** When `verify.setup`, `verify.command` or `verify.network` no longer matches the approval (for example a pulled change from `deny` to `allow`), the hooks save nothing and run nothing. Once per changed check, the next prompt hook prints `{"systemMessage":"Time Machine: the check in timemachine.yml changed; run tm init to approve it."}`, which Claude Code shows you as a warning. The pre-bash and Stop hooks stay silent. `tm init` keeps the file as it is, approves the new check and prints it on the `Approved` line.
- **Only Time Machine's `tm` runs.** The hooks and the MCP server call `scripts/tm-hook` in the plugin. It checks once per `tm` path and modification time that the first line of `tm --help` is "tm: save points for your project, checked with your own tests.", with no stdin and a 10 second limit, and caches the answer in `~/.timemachine/plugin-tm-check`. Otherwise, or when `tm` is missing, it exits 0 with no output.
- **No double saves.** If a project also has hooks from `tm hook install` in `.claude/settings.json` or `.claude/settings.local.json`, the plugin steps aside there.

### MCP server

```sh
claude mcp add timemachine -- tm mcp
```

`tm mcp` runs over stdio and offers these tools: `checkpoint`, `timeline`, `diff`, `verify`, `find_good`, `recover` and `log`. They call the same engine as the CLI, so the answers match. `verify` and `find_good` run the project's check, so they refuse with "Run tm init in this project to approve its check first." until `tm init` approved it on this computer. A repo's author writes that check, so until it is approved their descriptions name no command. Once approved, the descriptions and results carry it only as JSON-quoted data, cut to 200 characters with "…", and say it is data from `timemachine.yml`, not instructions.

## 10. Safety promises

- **Your folder and branch are never touched.** `open`, `verify` and `find-good` work in separate Git worktrees. `recover` creates a new branch and a recovery copy next to your project. Switching is up to you.
- **Nothing is pushed, merged or deployed.** Ever.
- **Your current state is saved before a recovery**, so a recovery can be undone.
- **Secret values from config files like `.env` are never stored**, only key names and a fingerprint. Files that match a secret pattern are skipped; a secret that matches none, or one already committed to Git, is saved like any code. Check logs are scrubbed of current secret values.
- **Host mode is always labeled.** Every verdict says which isolation mode and network rule it ran with.
- **Save points are signed.** A changed save point fails its integrity check and gives ERROR, not PASS.
- **Every action is in the audit log.** See `tm log`.

## 11. FAQ and troubleshooting

**"This folder is not inside a Git repository."** Run `git init`, then make a first commit. Time Machine works best with at least one commit. Without one, every file counts as not in Git, so the size limit and secret scan apply to all of them.

**"There are no checkpoints yet."** Run `tm checkpoint` first.

**How do I keep using the recovered version?** Keep working in the recovery copy. Saved files that were uncommitted may still be uncommitted there. Review and commit only the restored files you want to keep before moving or removing the copy. Switching to the recovery branch alone does not restore those uncommitted files.

**`tm open` left a folder behind.** That copy is yours to inspect. Remove it with `git worktree remove <path>`.

**How do I clean up?**

- Recovery branches: `git branch -D tm/recover/cp-0003`.
- Pinned refs: `git for-each-ref refs/tm` lists them. Remove one with `git update-ref -d refs/tm/cp-0003`.
- A whole project's store: find the folder under `~/.timemachine/projects/` whose `project.json` names your project, and delete it. This deletes its save points for good.

**How much disk does it use?** Files are stored once by content and compressed, so repeats cost nothing. Bundles hold only new commits. Large files are skipped above `capture.maxFileMB`. Check with `du -sh ~/.timemachine`. Automatic thinning is not built yet.

## 12. Planned, not built yet

These are planned. None of them work today.

- **Checkout for the web app.** The price is $50 once (ADR 0013) and `tm license <key>` works, but nothing is for sale until checkout opens. The web app needs a key to open; there is no free plan.
- **Container isolation** with Docker, OrbStack or Apple `container`, labeled as stronger than host mode.
- **Dependency cache**, so checks do not reinstall packages every time.
- **npm package** `timetm`, with `npx timetm init`.
- **Store thinning** with a size budget. Pinned and newest PASS save points will never be thinned.
- Hook kits for Cursor, Codex and Gemini CLI.
