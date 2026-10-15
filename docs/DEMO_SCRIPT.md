# 60 second demo video

Status: script ready, not recorded yet. For the a16z speedrun (closes 1 November 2026) and YC W27 (closes 2 November 2026, 8pm PT). Target shoot date: 30 October.

Everything on screen is a real run of `tm demo`. The output lines below are copied from a run on 15 October 2026 and match `packages/cli/src/format.ts` and `packages/core/src/demo.ts`. Marigold Tips is a synthetic project. Its `.env` holds a fake key that works nowhere.

## Before you record

1. Build from source: `pnpm install && pnpm build`.
2. Make `tm` work in the terminal: `alias tm="node $PWD/packages/cli/dist/tm.js"`. If `timetm` is on npm by the shoot date, use `npx timetm demo` instead and say so in the end card.
3. Use a fresh store so the numbers start at cp-0001: `export TM_HOME="$(mktemp -d)"`.
4. Pass a short folder so paths fit on screen: `tm demo ~/marigold-tips` (the folder must be new or empty).
5. Terminal: dark theme, 20 pt mono font, window about 110 columns wide. Keep color on so PASS is green and FAIL is red.
6. Do one dry run. The real run takes a few seconds. Do not speed up, retype or edit any output line. You may pan, zoom and cut between parts of the real output.

## Shot list

| Time | Picture | On screen text | Voice over |
|---|---|---|---|
| 0:00 to 0:05 | Black screen, then a terminal with a red test failure | It worked yesterday. | "My agent fixed a lint warning. Now my tests fail, and I don't know which version last worked." |
| 0:05 to 0:12 | Type `tm demo ~/marigold-tips` and press Enter. Cut to the top of the output | A real run. A synthetic project. | "This is Time Machine. The demo builds a small app and saves a point after every change." |
| 0:12 to 0:18 | Zoom on the six save points. Hold on the arrow | `cp-0004   Agent: fixed lint warnings    <- an agent's lint fix broke it here` | "At step four, an agent's lint fix broke the math. Two more changes landed on top." |
| 0:18 to 0:30 | Pan to the `tm find-good` block. Each line in turn | `cp-0006 FAIL` `cp-0005 FAIL` `cp-0004 FAIL` `cp-0003 PASS` | "Find good rebuilds each save point in a separate copy and runs your tests there. Broken. Broken. Broken. Then this one works." |
| 0:30 to 0:34 | Hold on the verdict line | `PASS  cp-0003 is the newest version that works.` | "That's proof, not a guess." |
| 0:34 to 0:44 | Pan to the `tm recover cp-0003` block | `Recovery ready for cp-0003. Nothing was pushed, merged or deployed. Your folder and branch were not touched.` then `Branch  tm/recover/cp-0003` and `Saved first  cp-0007, your state before this recovery` | "Recover makes a new branch and a working copy. It saves where you are first. It never touches your folder, and it never pushes." |
| 0:44 to 0:51 | Zoom on the Not restored block | `Not restored` `Secret values in .env: PORT, STRIPE_SECRET_KEY` `Databases, deployed versions and external services are not captured` | "And it tells you what it could not bring back. It never stores secret values, only their names." |
| 0:51 to 0:56 | New terminal: `tm hook install`. Show the first two lines of output | `Before each prompt and before risky shell commands, a checkpoint is saved if anything changed.` | "With Claude Code, it saves before every prompt and before risky commands like rm -rf, which built in rewind skips." |
| 0:56 to 1:00 | End card on white | **Time Machine.** Save points with proof of which ones still work. Below, small: Free command line tool. Not on npm yet. Mac app in development. | "Time Machine. Back to what worked." |

## The full output to work from

This is the exact text of the run. Your paths will differ.

```text
Built a demo project, Marigold Tips, in ~/marigold-tips
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
Next: tm recover cp-0003

$ tm recover cp-0003
Recovery ready for cp-0003. Nothing was pushed, merged or deployed. Your folder and branch were not touched.
  Branch          tm/recover/cp-0003
  Recovery copy   ~/marigold-tips-recovered-cp-0003
  Saved first     cp-0007, your state before this recovery
  Last check      PASS
Restored
  Code at commit 0885a4a
  1 saved file
Not restored
  Secret values in .env: PORT, STRIPE_SECRET_KEY
  Databases, deployed versions and external services are not captured
Manual steps
  Set PORT in .env in the recovery copy.
  Set STRIPE_SECRET_KEY in .env in the recovery copy.
  ...
```

The commit hash changes each run. The "1 saved file" is `data/themes.json`, which the agent made but never committed. Git alone would not have it.

## Optional cutaway (if a shot runs short)

In the demo folder, `tm verify cp-0004` prints one line that shows how the check ran:

```text
FAIL       cp-0004 is broken (host mode, network off via sandbox-exec, 0.3 s)
```

On Linux the sandbox name is `bwrap` or `unshare`. The time is whatever your run measures. Use the line as printed.

## Rules for this video

- Every line on screen comes from a real run. No mocked terminal, no edited text.
- Do not show the Mac app as working. If you show it at all, use the browser preview with its "demo data" banner on screen and say "in development".
- Do not say "undo anything", "guaranteed", "zero setup", or "works with every agent". Hooks exist for Claude Code today. The MCP server works with any agent that speaks MCP.
- Do not show `npx timetm` unless the package is really on npm that day.
- No music stings on the FAIL lines. Calm, not scary.

## Description for the upload

Time Machine saves a point after each change, proves which save point still passes your tests in a separate copy, and makes a recovery branch without touching your folder. This is a real run on a synthetic project. The command line tool is free. It is not on npm yet. The Mac app is in development.
