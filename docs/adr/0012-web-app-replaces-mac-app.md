# ADR 0012: The web app replaces the Mac app

Date: 22 October 2026. Status: accepted by the team. Implemented.

## Decision

Time Machine ships two surfaces, both from the npm package `timetm`:

- the free `tm` command line tool, with the Claude Code hooks and the MCP server;
- the web app, started with `tm ui`. It runs on the user's computer, binds to `127.0.0.1`, and opens in the browser. Nothing is hosted. There is no account.

The Electron Mac app is retired. Its renderer and engine bridge live on as the web app in `apps/web`. The Electron main process, preload scripts, overlay window, menu bar item, global shortcut, native folder picker, signing and notarization scripts and the native smoke test are deleted.

## Why

- Apple signing and notarization (D08) needed a paid Apple Developer account and an adult account holder, and was the one Phase B item no session could finish.
- `tm ui` already drove the same renderer and the same engine from the CLI, with a token-guarded local server and boundary tests. Keeping two shells doubled every change.
- A browser app runs on macOS, Linux and Windows the day it ships, and in cloud development environments where 64 percent of developers now work.
- We want one thing to sell: the web app, once, for $50 (ADR 0013).

## What the web app loses

- No global shortcut, no corner cards over other apps, no menu bar dot. The status lives in the browser tab.
- No native folder picker. Projects are added by their full local path.
- API keys for the opt-in features come from the server's environment only (`GEMINI_API_KEY`, `VERCEL_TOKEN`); the browser never stores them.

## Alternatives considered

- Keep both shells. Rejected: two codepaths, one unsigned, and the Mac shell blocked on an Apple account.
- Tauri. Rejected: still a native shell to sign and notarize.
- A hosted web app. Rejected: the engine must run next to the user's Git repository and store, and the project rules exclude cloud storage and accounts.

## Cost and migration

- `apps/desktop` becomes `apps/web`. `src/main` becomes `src/server`. Settings files on disk that still hold `hotkey`, `agentPill` or `overlayCards` load with those keys dropped.
- The site, README, guide and brief say "web app" and stop promising a signed Mac download. The Mac acceptance report of 20 October stays as history.
- A native shell can come back later as a thin wrapper around the same server, if anyone asks for it.
