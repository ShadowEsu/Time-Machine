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
- **Claude Code hook command:** the build bundles the `tm` CLI into `out/tm.mjs`, and the hooks call it with the app's own Node as quoted absolute paths: `ELECTRON_RUN_AS_NODE=1 '<Electron>' '<out/tm.mjs>'`. If that does not answer, the fallback is `npx -y timetm@<version>`, pinned to the CLI version, never the bare package name. `TM_HOOK_COMMAND` overrides both. Before adding any line the app runs `<command> --version` and adds nothing unless it answers with this version. Settings says "connected" only when the lines are there and the command runs, and "connected, but the command does not run yet" when the lines are there but it does not answer. The paths point into this checkout, so moving or deleting it stops the hooks until you connect again.
- **Window frame:** a sidebar with Projects (a verdict glyph each) and Add project, then Agents, Storage and Settings. A toolbar with the project name, a "Back to now" pill whenever you are looking at the past (Compare, or an older save point in the drawer, `⌘↑`), "Jump to…" (`⌘K`) and a ⋯ menu with the other project actions and the Inspector. `?` shows every shortcut that works today.
- **Project screen (D02):** status first. One plain sentence ("Broken since 8:16 PM. The last version that works is from 7:03 PM: add dark mode.") and exactly one primary button by state, plus at most one secondary: Broken with a known working version offers "Go back to the 7:03 PM version" and "See what changed"; Broken with none offers "Find the last working version"; Works offers Save now and Check it works; Not checked yet offers Check it works. Under it, History: a slim ruler (green only after a recorded PASS) and the list, newest first, with the last working version marked. Agent save points read like "Claude Code: add dark mode". Save point IDs, commits and isolation mode names appear only with Show Git details on.
- **Save point drawer (D03):** a row click opens it from the right; `Esc` closes it. The title, the verdict in a sentence, one primary action (Use this version when it works, otherwise Check it works), Try it first and Compare with now, and What's saved next to What's not saved in plain words. Check again and the Inspector sit in its ⋯ menu.
- **Rewind (D04):** with a known working version it opens straight on Review (no search): the version, its evidence, Comes back and Does not come back, and what Use will do (save your current version first, a new local branch, a recovery copy, nothing pushed or deleted). Use this version is one click from Review, then Done shows what came back, what did not, things to do by hand, and Undo. Try it first (verify in a safe copy, then a copy you can open) is optional. Without a known working version, Find (find-good, with live progress) runs first. Your folder and branch are never touched. Undo (`⌘Z`, only in Done and in History afterwards) removes the new branch and the recovery copy through the engine's `undoRecover`. It keeps every save point, and it refuses if the branch or the copy has new work in it. The app only passes on a recovery copy it made in this session.
- **Time View:** the Rewind as a full window scene. Open it from the project screen, `⌘⇧R`, Space on a save point in History, or the button on a red corner card. The selected save point sits on a stage card with the files it changed. Older save points recede to the left in a depth corridor. A Now card on the right shows the newest save point. Under the stage: the verdict with its evidence, then Comes back and Does not come back as two equal columns. At the bottom: a ruler with agent session clips, an activity band (files changed per save point), verdict ticks and a playhead. Everything right of the playhead is dimmed and labeled "These stay saved". `J` and `L` step, `⇧J` and `⇧L` jump to the previous or next verdict change, `T` tries, `C` compares, `Enter` uses a proven version (or tries an unproven one) at once, `Esc` goes back to exactly where you were. Use always saves your current version first and makes a new branch. It never switches your folder. Green appears only for a save point with a recorded PASS. It uses the same Rewind state and the same engine calls (find-good, verify, open, recover).
- **Simple rewind:** the same steps as a plain sheet. It is used when Reduce motion is on, or when Settings, Rewind style is set to Simple.
- **Compare (D05):** now (the folder as it is, saved first only if something changed) or any save point against any other: code, files outside Git, settings (names only), packages and environment, with a plain sentence on top.
- **Menu bar dot and overlay (D06):** the dot is green only when every project's newest save point has a real PASS, red on any FAIL, a grey open arc while Claude Code is in a turn or the app is running an action, grey otherwise. A project that moved or has no save points yet keeps it grey. A corner card appears only when a project's verdict turns from PASS to FAIL, with "Go back to the 7:03 PM version" (the last one that works, named by its time) and See what changed. Both open the app window on the screen the card was on. The card never takes focus and hides on its own unless you hover it. While Claude Code is in a turn, a small pill at the bottom of the screen says so. It comes from the hook audit lines ("agent-turn started" at each prompt, "ended" at stop) and counts as over after an hour without an end. The timeline strip is in the menu bar menu.
- **Agents, Storage and Settings (D07):** three pages. Agents: Claude Code connection status per project, with Connect after showing the exact lines. Storage: space used per project, a cleanup of old check logs (it removes only the files the preview listed) and Remove from app. Settings: appearance, Show Git details, rewind style, the global shortcut that shows the app window (`⌃⌥T` by default, can be changed or turned off), corner cards, agent pill, and where checks run (a safe copy on this Mac, with the network sandbox found). The shortcut needs two modifier keys, one of them Control or Command, and can't be copy, paste, cut, undo, quit, close or select all. Settings are stored as Zod checked JSON in the app's data folder.
- **Jump to… (`⌘K`):** one list you can type into: actions (Save now, Check it works, go back to the last working version, Compare, Agents, Storage, Settings), projects, and the 12 newest save points by time and title. Every typed word must match. Arrow keys and Enter, no mouse needed.
- **Inspector (`⌘I`, or ⋯):** the raw engine result of the last action and the same action as a `tm` command, with Copy. For the selected save point: the exact commit, its ref, the last check's command, exit code and log (with Show log), and the `tm` commands to check, open, use and compare it. Undo of a rewind has no `tm` command yet, so the Inspector says it is app only.
- **Look:** warm paper and ink in light and dark, Instrument Serif headlines, Inter for text and Geist Mono for times and technical facts, the same system as the website. The fonts ship in `src/renderer/fonts/` with their SIL OFL licences. Nothing loads from the network.

Every verdict has a shape and a word: Works, Broken, Couldn't check, Needs something, Check crashed, Not checked yet. Color only confirms. When a shortcut fires, its button shows its pressed state for about 120 ms.

## Planned, not built

- Signing, notarization and auto update (D08). Until then macOS asks you to confirm the first open.
- Thinning old save points (cleanup removes old check logs only), stronger isolation with Docker or Apple container, Cursor, Codex and Gemini hooks, automatic hourly saves.
- From the Time View design: screenshots per save point (the stage shows the changed files instead), sounds and haptics, hover skimming, zoom levels, the reverse fork animation on Undo, and stopping a running search (Esc leaves the view, the search keeps going).
- AI summaries, "What broke?", asking in plain words in Jump to…, pinning, and from the overlay design: Focus mode handling, a Recent cards list, card frequency limits, and a draggable pill.

## Browser preview

`pnpm --filter @timetm/desktop preview:build` writes a static site to `preview/dist/` (`index.html`, `app.js`, `styles.css`, `fonts/`). It is the same window code with the engine swapped for an in-memory demo of the Marigold Tips story: six save points, the fourth one broke it, the project screen says so and offers to go back to the third, which worked. A banner says it is a preview with demo data, and the overlay card and timeline strip are simulated inside the page. `?state=works`, `?state=unchecked` and `?state=new` (no project yet, onboarding with the sample folder) tell shorter stories. Open `index.html` in any browser. Nothing in it touches your files. Screenshots of every screen are in `preview-shots/v2/`.

## Layout

```
src/main/       Electron main process: windows, menu bar item, overlay, store watcher, IPC
src/preload/    The two narrow bridges (app window, overlay), contextIsolation and sandbox on
src/renderer/   Window code and styles, plain TypeScript and CSS
src/shared/     IPC contract with Zod schemas, plain words, card copy, tm command mapping
preview/        Browser preview entry and the in-memory demo engine
scripts/        esbuild build script
```
