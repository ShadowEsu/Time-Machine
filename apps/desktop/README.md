# Time Machine for Mac (desktop app)

Phase B of the build brief: D01 to D07. The app is a window, a menu bar item and a small overlay on top of the same engine the `tm` command uses (`@timetm/core`). The app and the CLI call the same functions and read the same store (`$TM_HOME`, otherwise `~/.timemachine`), so they never disagree.

## Run it on a Mac

From the repository root:

```sh
pnpm install
pnpm app
```

`pnpm app` downloads the Electron binary the first time, builds the app into `apps/desktop/out/` and opens it. Node 22.12 or newer is needed.

Other scripts, run from the root with `pnpm --filter @timetm/desktop <script>`:

| Script | What it does |
|---|---|
| `dev` | Build and run the app (same as `pnpm app`) |
| `build` | Build the app into `out/` without running it |
| `preview:build` | Build the browser preview into `preview/dist/` |
| `typecheck` | Type check the main process and the window code |

## What is built

- **Onboarding (D01):** three named steps. Pick a project folder. Choose the check (prefilled by `init`, changed with `setCheck`) and try it. Choose when to save, including Claude Code hooks after showing the exact lines. The first save point is made right after setup. It says "Saved, not checked" until a check runs.
- **Projects and History (D02):** a project list with verdict glyphs, the save point ruler (time left to right, a playhead on the selected save point, ticks green only after a recorded PASS), and big buttons: Save now, Check it works, Find the last working version. Agent save points read like "Claude Code: add dark mode", from the agent and prompt the engine records on each save point.
- **Save point detail (D03):** What's saved and What's not saved in plain words, from the coverage report. For agent save points, what the agent was asked, kept apart from the verdict.
- **Rewind wizard (D04):** Find (find-good, with live progress), Try (verify in a safe copy, or make a copy you can open), Use (recover, after a plain confirmation), Done (what came back, what did not, things to do by hand). Your folder and branch are never touched. Undo (`⌘Z`, in Done and in History afterwards) removes the new branch and the recovery copy through the engine's `undoRecover`. It keeps every save point, and it refuses if the branch or the copy has new work in it.
- **Time View:** the Rewind as a full window scene. Open it with Find the last working version, `⌘⇧R`, Space on a save point in History, or the Rewind button on a red corner card. The selected save point sits on a stage card with the files it changed. Older save points recede to the left in a depth corridor. A Now card on the right shows the newest save point. Under the stage: the verdict with its evidence, then Comes back and Does not come back as two equal columns. At the bottom: a ruler with agent session clips, an activity band (files changed per save point), verdict ticks and a playhead. Everything right of the playhead is dimmed and labeled "These stay saved". `J` and `L` step, `⇧J` and `⇧L` jump to the previous or next verdict change, `T` tries, `C` compares, `Enter` does the main action at once, `Esc` goes back to exactly where you were. Use always saves your current version first and makes a new branch. It never switches your folder. Green appears only for a save point with a recorded PASS. It uses the same wizard state and the same engine calls (find-good, verify, open, recover).
- **Simple rewind:** the same four steps as a plain sheet. It is used when Reduce motion is on, or when Settings, Rewind style is set to Simple.
- **Compare (D05):** now (the folder as it is, saved first only if something changed) or any save point against any other: code, files outside Git, settings (names only), packages and environment, with a plain sentence on top.
- **Menu bar dot and overlay (D06):** the dot is green only when every project's newest save point has a real PASS, red on any FAIL, a grey open arc while Claude Code is in a turn or the app is running an action, grey otherwise. A corner card appears only when a project's verdict turns from PASS to FAIL, with Rewind and See what broke. Both open the app window on the screen the card was on. The card never takes focus and hides on its own unless you hover it. While Claude Code is in a turn, a small pill at the bottom of the screen says so. It comes from the hook audit lines ("agent-turn started" at each prompt, "ended" at stop) and counts as over after an hour without an end. The timeline strip is in the menu bar menu.
- **Settings (D07):** Show Git details, appearance, rewind style, corner cards, agent pill, storage used per project with a cleanup of old check logs, isolation mode (basic, with the network sandbox found on this Mac), Claude Code connection status per project, and the global shortcut that shows the app window (`⌃⌥T` by default, can be changed or turned off). Settings are stored as Zod checked JSON in the app's data folder.
- **Inspector (`⌘I`):** the raw engine result of the last action and the same action as a `tm` command, with Copy. For the selected save point: the exact commit, its ref, the last check's command, exit code and log (with Show log), and the `tm` commands to check, open, use and compare it. Undo of a rewind has no `tm` command yet, so the Inspector says it is app only.

Every verdict has a shape and a word: Works, Broken, Couldn't check, Needs something, Check crashed, Not checked yet. Color only confirms. When a shortcut fires, its button shows its pressed state for about 120 ms.

## Planned, not built

- Signing, notarization and auto update (D08). Until then macOS asks you to confirm the first open.
- Thinning old save points (cleanup removes old check logs only), stronger isolation with Docker or Apple container, Cursor, Codex and Gemini hooks, automatic hourly saves.
- From the Time View design: screenshots per save point (the stage shows the changed files instead), sounds and haptics, hover skimming, zoom levels, the "Back to now" toolbar pill, the reverse fork animation on Undo, and stopping a running search (Esc leaves the view, the search keeps going).
- AI summaries, "What broke?", the Ask bar, pinning, and from the overlay design: Focus mode handling, a Recent cards list, card frequency limits, and a draggable pill.

## Browser preview

`pnpm --filter @timetm/desktop preview:build` writes a static site to `preview/dist/` (`index.html`, `app.js`, `styles.css`). It is the same window code with the engine swapped for an in-memory demo of the Marigold Tips story: six save points, cp-0004 broke it, Find the last working version opens the Time View and lands on cp-0003, then Try it and Use this version. A banner says it is a preview with demo data, and the overlay card and timeline strip are simulated inside the page. Open `index.html` in any browser. Nothing in it touches your files.

## Layout

```
src/main/       Electron main process: windows, menu bar item, overlay, store watcher, IPC
src/preload/    The two narrow bridges (app window, overlay), contextIsolation and sandbox on
src/renderer/   Window code and styles, plain TypeScript and CSS
src/shared/     IPC contract with Zod schemas, plain words, card copy, tm command mapping
preview/        Browser preview entry and the in-memory demo engine
scripts/        esbuild build script
```
