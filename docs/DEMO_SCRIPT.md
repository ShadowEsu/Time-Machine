# 60 second demo video

Status: script ready, not recorded yet. For the a16z speedrun (closes 1 November 2026, 11:59pm PT) and YC W27 (closes 2 November 2026, 8pm PT). Target shoot date: 30 October.

Pitch: Your agent can break things. Time Machine proves which version still passes your tests and gets you back to it.

Everything on screen is a real run of `tm demo`. The output lines below were copied from a run on 15 October 2026 and match `packages/cli/src/format.ts` and `packages/core/src/demo.ts`. Marigold Tips is a synthetic project. Its `.env` holds a fake key that works nowhere.

## Before you record

1. Build from source: `pnpm install && pnpm build`.
2. Make `tm` work in the terminal: `alias tm="node $PWD/packages/cli/dist/tm.js"`. If `timetm` is on npm by the shoot date, use `npx timetm demo` instead and say so in the end card.
3. Use a fresh store so the numbers start at cp-0001: `export TM_HOME="$(mktemp -d)"`.
4. Pass a short folder so paths fit on screen: `tm demo ~/marigold-tips` (the folder must be new or empty).
5. Terminal: dark theme, 20 pt mono font, about 110 columns wide. Keep color on so PASS is green and FAIL is red.
6. Do one dry run. The real run takes a few seconds. Do not speed up, retype or edit any output line. You may pan, zoom and cut between parts of the real output.

## Shot list

Seven shots. The video ends on the verdict and the "Not restored" list, because that is the product: proof, and honesty about the rest.

| # | Time | Picture | On screen text | Voice over |
|---|---|---|---|---|
| 1 | 0:00 to 0:06 | Black, then the Claude Code docs page, zoomed on one sentence | "Checkpointing does not track files modified by Bash commands." Small: code.claude.com/docs/en/checkpointing | "Your agent can break things. And its own rewind skips anything it did in the shell." |
| 2 | 0:06 to 0:12 | Terminal. Type `tm demo ~/marigold-tips`, press Enter | A real run. A synthetic project. | "This is Time Machine. The demo builds a small app with six save points." |
| 3 | 0:12 to 0:19 | Zoom on the six save points. Hold on the arrow | `cp-0004   Agent: fixed lint warnings    <- an agent's lint fix broke it here` | "At step four, an agent's lint fix broke the math. Two more changes landed on top." |
| 4 | 0:19 to 0:31 | Pan down the `tm find-good` block, one line at a time | `cp-0006 FAIL` `cp-0005 FAIL` `cp-0004 FAIL` `cp-0003 PASS` | "Find good rebuilds each save point in a separate copy and runs the tests there. Broken. Broken. Broken. This one works." |
| 5 | 0:31 to 0:42 | Pan to the `tm recover cp-0003` block | `Recovery ready for cp-0003. Nothing was pushed, merged or deployed. Your folder and branch were not touched.` then `Saved first  cp-0007` | "Recover saves where you are first. Then it makes a new branch and a separate copy. Your folder is not touched. Nothing is pushed." |
| 6 | 0:42 to 0:50 | Split frame. Top: the verdict line. Bottom: the Not restored block | `PASS  cp-0003 is the newest version that works.` and `Not restored` `Secret values in .env: PORT, STRIPE_SECRET_KEY` `Databases, deployed versions and external services are not captured` | "That is the verdict. Proof, not a guess. And here is what it could not bring back. It stores key names, never secret values." |
| 7 | 0:50 to 1:00 | Hold shot 6. Fade the end card in over it | **Time Machine.** Proves which version still passes your tests and gets you back to it. Small: Free command line tool. Not on npm yet. Mac app in development. | "Time Machine. Back to what worked." |

Shot 6 is the last real frame. Do not cut away to anything else after it.

## The full output to work from

This is the exact text of the run. Your paths and the commit hash will differ.

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
  Code at commit 3613344
  1 saved file
Not restored
  Secret values in .env: PORT, STRIPE_SECRET_KEY
  Databases, deployed versions and external services are not captured
Manual steps
  Set PORT in .env in the recovery copy.
  Set STRIPE_SECRET_KEY in .env in the recovery copy.
  ...
```

The "1 saved file" is `data/themes.json`, which the agent made but never committed. Git alone would not have it.

## Optional cutaway (only if a shot runs short)

In the demo folder, `tm verify cp-0004` prints one line that shows how the check ran:

```text
FAIL       cp-0004 is broken (host mode, network off via sandbox-exec, 0.3 s)
```

On Linux the sandbox name is `bwrap` or `unshare`. Use the line exactly as printed.

## Rules for this video

- Every terminal line comes from a real run. No mocked terminal, no edited text.
- The web app (`tm ui`) may be shown on a real project or on `tm demo`. Do not show a Mac app: it was retired (ADR 0012).
- Do not show or mention the action connector for email, Slack and other apps. It is planned only (ADR 0007).
- Do not say "undo anything", "guaranteed", "zero setup", or "works with every agent". Hooks exist for Claude Code today. The MCP server works with any agent that speaks MCP.
- Do not show `npx timetm` unless the package is really on npm that day.
- No music stings on the FAIL lines. Calm, not scary.

## Description for the upload

Your agent can break things. Time Machine proves which version still passes your tests and gets you back to it. It saves before each prompt, before risky shell commands, and after each agent turn, runs your tests on each save point in a separate copy, and makes a recovery branch without touching your folder. Every recovery lists what it could not bring back. This is a real run on a synthetic project. The command line tool is free and not on npm yet. The Mac app is in development.
