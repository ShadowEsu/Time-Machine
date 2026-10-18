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
| `signing:setup` | Create or reuse the local self-signed identity on this Mac |
| `package:local` | Build, stage, package and self-sign `release/Time Machine.app`, then zip it |

## Running an unsigned build

This build is not signed or notarized by Apple yet. macOS warns the first time you open it. To open it anyway, do one of these:

- In Finder, Control-click the app, choose Open, then choose Open again.
- Or open System Settings, then Privacy & Security, scroll to the message about the app and click Open Anyway.

Only do this for a build you got from the official GitHub repository, [ShadowEsu/Time-Machine](https://github.com/ShadowEsu/Time-Machine). Apple Developer ID signing and notarization are planned (D08). The welcome screen says this is not signed or notarized by Apple.

## Local self-signed Mac package

This is not Apple Developer ID signing. It does not notarize the app or make Apple trust it. The first-open warning and the guidance above still apply to downloaded builds. Apple signing and notarization remain planned (D08).

From the root on a Mac with Node 22.12+, pnpm and OpenSSL 3 installed:

```sh
pnpm --filter @timetm/desktop package:local
```

The script builds `out/`, copies only that output and a minimal `package.json` to a temporary staging folder, and uses the exact `@electron/packager@19.0.1` and Electron version in this package. It does not package this checkout, `node_modules`, the store or signing material. The bundled engine and CLI are already in `out/`. The CLI stays unpacked because hooks run it through a real filesystem path.

Output is `apps/desktop/release/Time Machine.app` and `apps/desktop/release/Time Machine.zip`. The script replaces only these two local artifacts. It does not install in `/Applications`, publish, enroll with Apple or notarize anything. The app keeps bundle ID `dev.timetm.desktop`; helper IDs stay under it.

`signing:setup` runs automatically when packaging. It makes **Time Machine Self Signed** once, in a dedicated `~/.timemachine-signing/signing.keychain-db`. Future builds unlock and reuse it. The same directory holds an encrypted private key (`private-key.pem`), certificate (`certificate.pem`), encrypted PKCS#12 backup (`identity.p12`) and password file (`password`). Its permissions are 0700, with files 0600. Back up the whole directory privately. Never commit or share it. Losing it means losing this signing identity. Setup resumes incomplete steps without replacing an existing key or certificate.

Trust is user-local, only for code signing. The dedicated keychain is appended to the user keychain search list, preserving every existing entry. No system trust or unrelated identities are changed. The identity has a ten-year certificate. `security` receives the saved password as a process argument for keychain operations; do not run this under shell tracing or log process arguments.

Nested Mach-O code is signed first, then helper and framework bundles, then the app. Hardened runtime is on, with no timestamp. Main and helper executables get V8 JIT permission and the library-validation exception needed by a self-signed Electron app without an Apple Team ID. The app is not App Sandbox signed, so sandbox inheritance entitlements are not added. No unsigned executable memory, camera, microphone or Accessibility entitlement is added.

Check the artifact locally:

```sh
codesign --verify --deep --strict --verbose=2 'apps/desktop/release/Time Machine.app'
codesign -d -r- 'apps/desktop/release/Time Machine.app'
spctl --assess --type execute --verbose=4 'apps/desktop/release/Time Machine.app'
```

The first command must pass. The last is expected to reject this non-Apple-trusted build. A stable designated requirement across rebuilds identifies the same signer and bundle, not proof that macOS privacy permissions persist. That persistence has not been tested.

Exercised locally on 17 October 2026 (Apple silicon): two full packages reused the same certificate and had identical designated requirements. `codesign --verify --deep --strict` passed on the final app. Hardened runtime was present. `spctl` rejected it (exit 3), as expected for this signer.

The packaged `.app` launched through its own executable with isolated HOME, TM_HOME and userData. The real-engine demo reached a passing version and made `tm/recover/cp-0003` in two clicks. The synthetic project kept the same branch, HEAD and working-tree status before and after recovery. The result showed what was not restored. No renderer page errors were observed. Evidence and screenshots: `/tmp/tm-pw/app-selfsigned/`. This did not exercise a quarantined download, Finder's first-open warning or privacy grant persistence.

## What is built

- **Onboarding (D01):** three named steps, one click each. Pick a project folder: setup starts as soon as you pick it, adds `timemachine.yml` (`init`) and makes the first save point. It says "Saved, not checked" until a check runs. Choose the check: the one `init` found is already picked, with a quiet line for the install step that runs first when there is one ("Installs first with npm ci …"). Try it now is optional; changing it uses `setCheck`. Choose when to save: "Connect Claude Code and finish" adds the hook lines (shown first in plain words, the exact lines on request) and finishes, and "Skip, finish without it" finishes without them. If the lines cannot be prepared, or the command does not run on this Mac, Finish is the only button and the step says why. Each step's buttons stay in view on short windows.
- **Try the demo:** the first button on the welcome screen. The real engine builds Marigold Tips in a new temporary folder, breaks it on purpose and checks its save points newest first (`tm demo`). The engine's demo also makes its own recovery; the app undoes just that branch and copy, so the one recovery is the one you choose. It then opens Rewind on Review of the version the search found, which says how many save points were checked, with one key: "Go back to the 7:03 PM version". Done shows what came back, what did not and the things to do by hand.
- **Claude Code hook command:** the build bundles the `tm` CLI into `out/tm.mjs`, and the hooks call it with the app's own Node as quoted absolute paths: `ELECTRON_RUN_AS_NODE=1 '<Electron>' '<out/tm.mjs>'`. If that does not answer, the fallback is `npx -y timetm@<version>`, pinned to the CLI version, never the bare package name. `TM_HOOK_COMMAND` overrides both. Before adding any line the app runs `<command> --version` and adds nothing unless it answers with this version. Settings says "connected" only when the lines are there and the command runs, and "connected, but the command does not run yet" when the lines are there but it does not answer. The paths point into this checkout, so moving or deleting it stops the hooks until you connect again.
- **Window frame:** a rail with Projects (a verdict glyph and how long ago each last saved), Add project, the Agents list (Claude Code with its real state, Codex, Gemini CLI and Cursor marked Planned), then Storage (space used) and Settings. A toolbar with a breadcrumb ("marigold-tips / History"), a "Back to now" pill whenever you are looking at the past (Compare, or an older save point, `⌘↑`), "Jump to…" (`⌘K`), Ask (`⌘J`) and a ⋯ menu with the other project actions and the Inspector. `?` shows every shortcut that works today. Toasts sit over the bottom of the rail, so they never cover the journal.
- **Project page (D02):** one document column. A status sentence in Newsreader with an italic accent ("Broken *since 8:16 PM.*"), one filled primary button and at most one quiet text link: Broken with a known working version offers "Go back to the 7:03 PM version" and "See what changed"; Broken with none offers "Find the last working version"; Works offers Save now and Check it works; Not checked yet offers Check it works. Under it, "What does not come back" (or Saved and Not saved when nothing is broken) in plain words. Then a slim ruler with agent session clips and the playhead, and the journal: a day heading ("Today", the date, the count), then one entry per save point with its time in the margin, the verdict glyph on a hairline, a serif title, an author chip, the verdict pill, a check summary from recorded evidence only ("check failed · 4 files") and a "We ran" box. Two or more automatic saves in a row fold into one line until opened. Green only after a recorded PASS. Titles name the agent once: "Add dark mode" next to a "Claude Code" author chip, "Claude Code: add dark mode" where no author is shown (Jump to…, tooltips). Save point IDs, commits and isolation mode names appear only with Show Git details on.
- **Entry detail (D03):** clicking an entry opens it in the right column when the window is at least 1100 points wide, so the page keeps its status sentence beside it. Narrower windows show it as a full sheet over the page instead of covering half of it. `Esc` closes it. The title, author and verdict, the verdict in a sentence, an "Agent said / We ran" box side by side (the hook records what the agent was asked, not its reply, so Agent said is labelled as not recorded yet and planned; an agent's claim is never shown as a check), one primary action (Go back to this version when it works, otherwise Check it works), Open a safe copy (explained under it) and Compare with now, What's saved and What's not saved, and the Inspector.
- **Rewind (D04) with the dial:** open it from the project page, `⌘⇧R`, Space on a selected save point, or the button on a red corner card. With a known working version it opens straight on Review (no search). The reading pane shows the version, its evidence, the files it changed, Comes back and Does not come back, and what going back will do (save your current version first, a new local branch, a recovery copy, nothing pushed or deleted). Beside it, the dial: one detent per save point around a 270 degree arc, a verdict dot at each, labels for the first, the newest, the last working one and the selected one. Drag it, scroll over it, or use J and L, the arrow keys, Home and End; Shift J and Shift L jump to the next verdict change. Turning it only moves the selection. Under the dial is the key, "Go back to the 7:03 PM version", with one quiet alternative, See what changed (`C`). So the rescue is two clicks: the project page's main button, then the key. For a version without a passing check the key is "Try it first" (`Enter`), which says it opens the version in a safe copy and runs your check, and "Go back anyway" is a quiet link. Done says the version is back on a new branch, lists what came back, what did not and things to do by hand, and has one key, Done, with "Undo this rewind" (`⌘Z`) under it. "Show the recovery copy in Finder" and "Copy the report as text" sit inside the report, not in a row of buttons. Without a known working version, Find (find-good, with live progress) runs first. Your folder and branch are never touched. Undo removes the new branch and the recovery copy through the engine's `undoRecover`, keeps every save point, and refuses if the branch or the copy has new work in it. The app only passes on a recovery copy it made in this session. A ruler along the bottom keeps the agent session clips, the files-changed band and the "These stay saved" veil. With Reduce motion on, the dial does not spin and the playhead does not glide: they move straight to each save point. `Esc` goes back to exactly where you were.
- **Simple rewind:** the same steps as a plain sheet, when Settings, Rewind style is set to Simple.
- **Compare (D05):** now (the folder as it is, saved first only if something changed) or any save point against any other: code, other files we saved, settings (names only), packages and environment, with a plain sentence on top. Each choice reads time, verdict, then title, so a long title is cut, never the verdict.
- **Ask and Vercel deploys in the window:** a right-hand Ask column on project pages (`⌘J` shows or hides it; on narrow windows it is a drawer you summon). A cited save point brings its entry into view with a brief tint. Read-only deploy chips sit on the journal entries whose recorded commit a Vercel deploy was built from, deploys from a computer are listed under the journal, and Settings has a Features section per project. These views come from `src/renderer/ask-panel.ts`, `deploys.ts` and `feature-settings.ts`. Both features are off until turned on per project (ADR 0008, ADR 0009).
- **Menu bar dot and overlay (D06):** the dot is green only when every project's newest save point has a real PASS, red on any FAIL, a grey open arc while Claude Code is in a turn or the app is running an action, grey otherwise. A project that moved or has no save points yet keeps it grey. A corner card appears only when a project's verdict turns from PASS to FAIL, with "Go back to the 7:03 PM version" (the last one that works, named by its time) and See what changed. Both open the app window on the screen the card was on. The card never takes focus and hides on its own unless you hover it. While Claude Code is in a turn, a small pill at the bottom of the screen says so. It comes from the hook audit lines ("agent-turn started" at each prompt, "ended" at stop) and counts as over after an hour without an end. The timeline strip is in the menu bar menu.
- **Agents, Storage and Settings (D07):** three pages. Agents: one channel line per coding agent. Claude Code says Working (since when), Idle with the time its last turn ended (from the audit log's "agent-turn ended" lines), Partly connected, or Not connected. Codex, Gemini CLI and Cursor say Planned and not connected. Nothing is invented. Under it, Claude Code's connection per project, with Connect after showing what the lines do in plain words; the exact lines, with their long command paths, open under "Show the exact lines" or with Git details on. Storage: space used per project, "Clean up old check logs…" (it explains what goes, lists it first and removes only the files it listed) and Remove from app. Settings: appearance, Show Git details, rewind style, Features per project, the global shortcut that shows the app window (`⌃⌥T` by default, can be changed or turned off), corner cards, agent pill, and where checks run (a safe copy on this Mac, with the network sandbox found). The shortcut needs two modifier keys, one of them Control or Command, and can't be copy, paste, cut, undo, quit, close or select all. Settings are stored as Zod checked JSON in the app's data folder.
- **Jump to… (`⌘K`):** one list you can type into: actions (Save now, Check it works, go back to the last working version, Compare, Agents, Storage, Settings), projects, and the 12 newest save points by time and title. Every typed word must match. Arrow keys and Enter, no mouse needed.
- **Inspector (`⌘I`, or ⋯):** the raw engine result of the last action and the same action as a `tm` command, with Copy. For the selected save point: the exact commit, its ref, the last check's command, exit code and log (with Show log), and the `tm` commands to check, open, use and compare it. Undo of a rewind has no `tm` command yet, so the Inspector says it is app only.
- **Look:** the Notebook direction from `design/APP_V3_DIRECTION.md`: warm paper and ink in light and dark, one mulberry accent for focus and questions (never a verdict), Newsreader headings with italic accents, Inter for text and Geist Mono for times and technical facts. The fonts ship in `src/renderer/fonts/` with their SIL OFL licences. Nothing loads from the network.
- **Launch splash:** a black window with the Time Machine wordmark ("Machine" in italic orange) and a thin loading bar along the bottom edge, like the website's opening screen. It is drawn by `index.html` before any script runs and fades out over 300 ms once the settings, the projects and the first page are drawn, after at least 600 ms so it never flashes. The bar has no percentage. Any key or click skips it, and the key still reaches the app. It shows at launch only, never when you move between pages. With Reduce motion on it does not fade and has no minimum: it is there only while the app loads. The logic is in `src/renderer/splash.ts`.
- **Motion:** a new page fades in and rises 8 px (220 ms). Sheets, Jump to… and the shortcut sheet scale and fade in, and they fade out when they close; the Rewind scene, the Inspector and toasts fade out too. What is closing never takes clicks, so nothing waits for it. A project's journal rows rise in one after another the first time the journal shows in a session, with the last row starting at most 300 ms after the first. Only opacity and transform move, so nothing shifts the layout. A redraw in the middle continues the movement instead of restarting it (`src/renderer/motion.ts`). The verdict stamp keeps its own moment. With Reduce motion on, none of this moves.

Every verdict has a shape and a word: Works, Broken, Couldn't check, Needs something, Check crashed, Not checked yet. Color only confirms. When a shortcut fires, its button shows its pressed state for about 120 ms.

## Planned, not built

- Apple Developer ID signing, notarization and auto update (D08). A local self-signed package is built, but it is not Apple trusted (see Running an unsigned build).
- Thinning old save points (cleanup removes old check logs only), stronger isolation with Docker or Apple container, Cursor, Codex and Gemini CLI hooks, automatic hourly saves.
- Recording what an agent said at the end of a turn, so "Agent said" can show it next to "We ran". Test counts in the check summary ("3 tests failed"); today it says passed or failed and how many files changed.
- From the Rewind design: screenshots per save point, sounds and haptics, zoom levels, the reverse fork animation on Undo, and stopping a running search (Esc leaves the view, the search keeps going).
- Generated summaries on journal entries, personal notes and pins, a live agent feed, "What broke?", asking in plain words in Jump to…, and from the overlay design: Focus mode handling, a Recent cards list, card frequency limits, and a draggable pill.

## Browser preview

`pnpm --filter @timetm/desktop preview:build` writes a static site to `preview/dist/` (`index.html`, `app.js`, `styles.css`, `features.css`, `fonts/`). It is the same window code with the engine swapped for an in-memory demo of the Marigold Tips story: six save points, the fourth one broke it, the project screen says so and offers to go back to the third, which worked. A banner says it is a preview with demo data, and the overlay card (bottom right, so it never covers the page's buttons) and timeline strip are simulated inside the page. `?state=works`, `?state=unchecked` and `?state=new` tell shorter stories. `?state=new` is a first launch with no project: Add a project walks through onboarding with the sample folder, and Try the demo builds the demo story, searches it and lands on Review with the Go back key, like the app. The preview starts with Ask on and a Vercel project linked, with canned answers and sample deploys. `?state=ask-off`, `?state=no-key`, `?state=ask-error` and `?state=no-vercel` show those features off, without a Gemini key, failing to reach Gemini, and without a Vercel token. Open `index.html` in any browser. Nothing in it touches your files. Screenshots of every screen, light and dark at 1280 by 800 and 960 by 640, are in `preview-shots/v3/`.

The preview never opens a simulated overlay by itself. Use the banner's Show overlay button when you want to try it, so it cannot cover consent or navigation.

## First run exercised checks

17 October 2026, synthetic data only. Clicks count from the first window to a recovery branch. Times are wall time with instant clicks, so reading time is not included.

| Path | Before | After |
|---|---|---|
| Try the demo, real Electron app and engine | 3 clicks, 5.8 s. It landed on the project page saying "Not checked yet", because the newest save point was the engine's own "Before going back" one; the filled button was Check it works and going back was the quiet link. It also left two recovery branches (`tm/recover/cp-0003` and `-2`) | 2 clicks, 5.3 s: Try the demo, then the Go back key. One recovery branch, `tm/recover/cp-0003` |
| Add a project, real Electron app and engine, a synthetic Git repo (folder dialog answered by the test) | 10 clicks, 3.2 s to a checked first save point plus 1.3 s for the rescue, without Claude Code | 9 clicks, 3.9 s plus 1.3 s, with Claude Code connected on the way |
| Onboarding only, browser preview | 5 clicks; at 960 by 640 Continue and Finish were below the fold | 4 clicks; the buttons stay in view at 1280 by 800 and 960 by 640 |

- In both native runs the project folder's branch, HEAD commit and `git status` were the same before and after Go back. Done listed what was not brought back (in the demo, the `.env` values, databases, deploys and other services) and the things to do by hand.
- The Add a project path counted: Add a project, Choose folder, Continue, Connect Claude Code and finish, Check it works, Done, Save now (after a change outside the app broke the test), Go back to the version, the Go back key.
- Browser preview, Playwright at 1280 by 800 and 960 by 640 (`/tmp/tm-pw/firstrun.mjs`): no covered buttons, no horizontal overflow, no page errors. Native runs: `/tmp/tm-pw/native-firstrun.mjs` and `/tmp/tm-pw/native-add.mjs`. Screenshots in `/tmp/tm-pw/app-firstrun/`.
- Not exercised: the macOS first open warning itself (the build was run from source) and a real Finder folder dialog. Dark mode was looked at on the welcome screen and onboarding step 2 only.

## Splash and motion exercised checks

18 October 2026, Apple silicon, synthetic demo data only. The packaged self-signed app (`package:local`) ran through its own executable with isolated HOME, TM_HOME, TMPDIR and userData.

- Splash timing, measured from the window starting to load to the fade starting: 658 to 735 ms over six normal launches. From starting the process that was 0.9 to 1.3 s, and 2.8 s on the first launch after packaging. With Reduce motion emulated, the splash went with no fade at 654 to 678 ms, which is when the first page was drawn. So the 600 ms minimum adds at most about 80 ms. A key pressed at 180 ms started the fade at once.
- Demo to recovery still works with the splash. Packaged app: Try the demo, leave the Rewind, Check it works (Broken), then Go back made `tm/recover/cp-0003`. Built from source: Try the demo, then the Go back key, made it in 2 clicks. Both times the demo folder kept the same branch, HEAD and status, and no renderer page errors were seen.
- Browser preview (Chrome, 1280 by 800): page entrance and journal stagger played once, a closing Jump to… kept fading across a redraw and was removed after it, and with Reduce motion nothing moved. The browser preview has no splash.
- Screenshots for the website, 1280 by 800 at 2x, light and dark: `/tmp/tm-pw/site-app-shots/`. Scripts: `/tmp/tm-pw/native-shots.mjs`, `/tmp/tm-pw/native-splash.mjs`, `/tmp/tm-pw/polish-preview.mjs`.

## V3 exercised checks

Local browser preview, 16 October 2026. These checks use synthetic demo data, not a real project or a live Gemini or Vercel connection.

- `pnpm typecheck`: passed.
- `pnpm vitest run apps/desktop/test`: 5 files, 120 tests passed. Final workspace `pnpm typecheck && pnpm test && pnpm build` also passed: 226 tests passed, 2 Linux-only tests skipped.
- `pnpm --filter @timetm/desktop preview:build`: passed.
- Playwright, adapted from `/tmp/tm-pw/m7.mjs` and `overlap.mjs` for the v3 selectors: `/tmp/tm-pw/m7v3.mjs`.
- Rescue: **2 clicks**, project page primary action → Review key → Done. Undo is visible and returns to the project page when used.
- What changed: **1 click**, See what changed → Compare.
- Agents: **1 click** from the project page, entry detail, Compare, Storage and Settings, using Agents in the rail.
- Keyboard paths: Esc closes the entry; `⌘K`, type "dark mode", Enter opens that save point; `⌘J` hides and shows Ask; `⌘⇧R`, J, L and → scrub the dial; dragging selects the first detent; Esc returns to the project page. Reduce motion keeps the dial, with an effectively instant transition.
- Overlap checks: home, entry detail, Rewind Review and Done at **1280×800, 960×640 and 1440×900** passed. No horizontal overflow at 960 on the captured screens. No page errors or console errors.
- **108 screenshots**, 27 views in light and dark at 1280×800 and 960×640, in `preview-shots/v3/`. They include the three home states, entry detail, Review, Try it first, Done, the inline Undo message, Compare, checks, Agents, Storage, Settings and Features, an Ask answer and consent, palette, shortcuts, onboarding, welcome, corner card, Inspector, timeline strip and Simple rewind.

Native macOS smoke also passed in an isolated userData directory and Time Machine store. The actual Electron window loaded bundled Newsreader fonts and the real engine created the synthetic demo, verified a working save point as PASS, recovered it and undid that recovery through IPC. The bundled CLI answered its version probe through the Electron executable. Showing the corner panel kept a separate native window focused; the panel was visible, non-focusable and not focused. A real Gemini request through Electron refused before consent and returned an answer with a save point citation after consent. No renderer page errors were observed. The smoke used synthetic data, not a customer's project.

Still not exercised: macOS global shortcuts, Finder actions, a whole real agent session, a live Vercel connection, notarization and auto-update. Browser layout checks are not a claim of accessibility conformance.

## Layout

```
src/main/       Electron main process: windows, menu bar item, overlay, store watcher, IPC
src/preload/    The two narrow bridges (app window, overlay), contextIsolation and sandbox on
src/renderer/   Window code and styles, plain TypeScript and CSS
src/shared/     IPC contract with Zod schemas, plain words, card copy, tm command mapping
preview/        Browser preview entry and the in-memory demo engine
scripts/        esbuild build script
```
