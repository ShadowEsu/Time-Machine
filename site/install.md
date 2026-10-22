# Install Time Machine

Time Machine saves your project before Claude Code acts, checks each save point with your own tests in a separate copy, and brings back the newest one that passes.

These steps are for a person or a coding agent such as Claude Code. Run them in order.

## Before you start

- macOS or Linux. The `tm` CLI and the web app (`tm ui`) work on both.
- Node 22 or newer, and Git.
- A Git project with a check command, such as `npm test`.
- The CLI is not on npm yet. Install it from source as shown below.

## 1. Install from source

Clone Time Machine outside your project, for example in your home folder:

```sh
cd ~
git clone https://github.com/ShadowEsu/Time-Machine.git && cd Time-Machine
pnpm install && pnpm build
npm install -g ./packages/cli
```

No pnpm? Run `npm install -g pnpm` first.

The global `tm` command points at this folder. Keep the folder.

## 2. Run the demo

```sh
tm demo
```

This builds a small synthetic project in a temporary folder, breaks it, then brings back the last version that passed. Your own projects are not touched.

## 3. Set up your project

Go to your project folder and run:

```sh
cd path/to/your-project
tm init --no-approve
```

`tm init --no-approve` writes `timemachine.yml` with a guessed check (for example `npm test`) and install step (for example `npm ci`), or keeps the one the project already has. Open the file and confirm the check is the command that tells you the project works, and that `verify.setup`, `verify.command` and `verify.network` are safe to run on this computer. Then approve it:

```sh
tm init
```

`tm init` keeps the file as it is and records your approval outside the project. The Claude Code plugin and the MCP `verify` and `find_good` tools run only a check you approved. If the check changes later, run `tm init` again after you have read it.

Optional, for Claude Code, pick one of these two:

- **The Claude Code plugin.** In Claude Code, run `/plugin marketplace add ShadowEsu/Time-Machine`, then `/plugin install time-machine@time-machine`. No account is needed. `tm` from step 1 must be installed. It adds the hooks and the MCP server for every project, but they act only in projects where you ran `tm init` on this computer. `tm init` approves the check in `timemachine.yml`; a `timemachine.yml` that came with a cloned repo is not enough. If the check changes later, the hooks stop and ask you to run `tm init` again, which keeps your file and approves the new check. The hooks do nothing when `tm` is not on your PATH, or when the `tm` on your PATH is not Time Machine.
- **Hooks for this project only.** `tm hook install` adds hooks to `.claude/settings.json` so Time Machine saves before each prompt and before risky shell commands. It changes a settings file, so ask before you run it.

If a project also has hooks from `tm hook install`, the plugin steps aside there, so nothing saves twice.

## 4. Open the app in your browser

```sh
tm ui
```

This opens the Time Machine web app in your browser. The server runs on your own computer at `127.0.0.1`, so your project is never uploaded. Nothing is hosted and there is no account. Keep the terminal open while you use it. Ctrl+C stops it.

Open the full address that `tm ui` prints. It includes a private session key. Do not share it.

The web app needs a one-time $50 license key to open. It asks for the key the first time. Checkout is not open yet. The `tm` command line tool is open source (MIT) and never needs a key.

## 5. Enter your license key

If you bought a key, enter it once per computer, either when `tm ui` asks for it or with:

```sh
tm license <key>
```

Or open `tm ui`, go to Settings, then License, and paste the key. The key works offline. The CLI never needs a key, and restores are never behind the paywall.

## Everyday commands

```sh
tm checkpoint -m "works"   # save now
tm find-good               # check save points, newest first, each in a fresh copy
tm recover cp-0001         # bring one back on a new branch, tm/recover/cp-0001
tm ui                      # the web app, in your browser, on this computer
tm license <key>           # enter the web app license key
```

## Limits

- Time Machine is not a backup and not a replacement for Git. Keep committing.
- Secret values, databases, deployed versions and anything outside your project do not come back. Every result lists what did not.
- A passing check means your tests passed. It does not prove the app is correct.

Source and full docs: https://github.com/ShadowEsu/Time-Machine
