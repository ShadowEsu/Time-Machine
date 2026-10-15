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

- **Onboarding (D01):** pick a project folder, choose the check (prefilled by `init`, changed with `setCheck`), try it, and connect Claude Code hooks after showing the exact lines.
- **Projects and History (D02):** a project list with verdict glyphs, the save point ruler, and big buttons: Save now, Check it works, Find the last working version.
- **Save point detail (D03):** What's saved and What's not saved, from the coverage report.
- **Rewind wizard (D04):** Find (find-good, with live progress), Try (verify in a safe copy, or make a copy you can open), Use (recover, after a plain confirmation), Done (what came back, what did not, things to do by hand). Your folder and branch are never touched.
- **Compare (D05):** code, files outside Git, settings (names only), packages and environment.
- **Menu bar dot and overlay (D06):** the dot is green only when every project's newest save point has a real PASS, red on any FAIL, grey otherwise. A corner card appears when a check on the newest save point gives a new result. The card never takes focus and hides on its own unless you hover it. `⌘⇧T` shows a timeline strip.
- **Settings (D07):** Show Git details, appearance, corner cards, storage used per project, the hotkey, and Claude Code connections.
- **Inspector (`⌘I`):** the raw engine result and the same action as a `tm` command, with Copy.

Every verdict has a shape and a word: Works, Broken, Couldn't check, Needs something, Check crashed, Not checked yet. Color only confirms.

## Planned, not built

- Signing, notarization and auto update (D08). Until then macOS asks you to confirm the first open.
- Clean up of old save points, stronger isolation with Docker or Apple container, Cursor, Codex and Gemini hooks, automatic hourly saves.
- The Time View animation, screenshots per save point, AI summaries and the Ask bar from the design spec.

## Browser preview

`pnpm --filter @timetm/desktop preview:build` writes a static site to `preview/dist/` (`index.html`, `app.js`, `styles.css`). It is the same window code with the engine swapped for an in-memory demo of the Marigold Tips story: six save points, cp-0004 broke it, Find the last working version lands on cp-0003, then Use this version. A banner says it is a preview with demo data, and the overlay card and timeline strip are simulated inside the page. Open `index.html` in any browser. Nothing in it touches your files.

## Layout

```
src/main/       Electron main process: windows, menu bar item, overlay, store watcher, IPC
src/preload/    The two narrow bridges (app window, overlay), contextIsolation and sandbox on
src/renderer/   Window code and styles, plain TypeScript and CSS
src/shared/     IPC contract with Zod schemas, plain words, card copy, tm command mapping
preview/        Browser preview entry and the in-memory demo engine
scripts/        esbuild build script
```
