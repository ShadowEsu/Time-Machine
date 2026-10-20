# Mac source-app acceptance — 20 October 2026

## Scope and isolation

Clean clone of `ShadowEsu/Time-Machine` at `f5483a2` on Apple silicon macOS. This pass exercises the actual Electron application and engine, not the website's illustrated app demo. Dependencies were installed from the lockfile (pnpm 10.28.0; Node 25.7.0). HOME, TM_HOME and Electron userData were isolated under `/tmp`; no personal project, API credential, signing identity, npm publication or billing action was used.

## Commands and observed output

```sh
git clone --quiet https://github.com/ShadowEsu/Time-Machine.git /tmp/tm-app-acceptance-20261020
cd /tmp/tm-app-acceptance-20261020
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @timetm/desktop build
```

Install: 61 packages, 7.2 seconds. CLI build: `packages/cli/dist/tm.js`, 614.4 KB. Desktop output: `apps/desktop/out/`. Install plus both builds exited 0 in 21.98 seconds.

```sh
env -u ELECTRON_RUN_AS_NODE -u TM_HOOK_COMMAND -u GEMINI_API_KEY -u VERCEL_TOKEN \
 HOME=/tmp/tm-app-acceptance-home TM_HOME=/tmp/tm-app-acceptance-store \
 TM_DESKTOP_USER_DATA=/tmp/tm-app-acceptance-userdata pnpm app -- --remote-debugging-port=9444
```

The promised source launcher built and opened the actual Mac app. For browser inspection, the same built app was subsequently launched through Playwright Electron with `args: ["/tmp/tm-app-acceptance-20261020/apps/desktop", "--remote-debugging-port=9444"]` and the same isolated environment. Passing the debug flag after `pnpm app -- --...` did not expose CDP, so that invocation was not used as remote-debugging evidence.

## Exercised user flow

- Welcome → Try the demo → real-engine Marigold Review → Go back → Done. Separate recovery copy and exclusions shown. Undo demo rewind succeeded.
- Own synthetic Git project with **no first commit**: Add project → initialize/save → “Saved, not checked” → Try it now → real `npm test` PASS → Connect Claude Code and finish. The app installed commands pointing to its bundled `out/tm.mjs`, without requiring npm publication.
- Executed the literal installed prompt and stop hook commands in separate shell processes with Claude Code's JSON input. Prompt made the app show its working indicator. Changed `add(a,b)` from `a+b` to `a-b`; stop created a real failing checkpoint.
- Stop exited **2**, deliberately reporting: `Time Machine: the check passed at cp-0001 and fails now at cp-0003 (The check failed with exit code 1.) The last working save point is cp-0001.` This is the expected Claude regression notification, not an application crash.
- Broken → Go back → Review → confirmation → Done at `cp-0001`. `npm test` in `/tmp/tm-app-site-proof/user-project-recovered-cp-0001` reported **1 test, 1 pass, 0 fail**. Original `math.js` still contained `a-b`; `git branch --list 'tm/recover/*'` showed `+ tm/recover/cp-0001`.
- Compare showed the actual saved-to-current changes. Agents, Storage and Settings rendered; optional Ask/Vercel features stayed off. No renderer page errors were observed.
- Claude itself was not invoked: real installed hook processes were used, without inference credentials.

### Native folder-picker limitation

The macOS chooser was opened without a stub. Automating its keyboard selection with `osascript` failed: `System Events got an error: osascript is not allowed to send keystrokes. (1002)`. No permission was changed or bypassed. For the rest of onboarding only, Electron's folder-dialog result was supplied with the fixture path; renderer, IPC, initialization, saves, checks, hook installation and recovery remained real. **Native OS folder selection is not accepted by this evidence and needs a manual selection or an authorized Accessibility-enabled runner.** Quarantined downloads, Apple signing/notarization and Finder's first-open gate were not exercised.

## Bug and regression

After a completed hook turn, the sidebar tooltip falsely said `Claude Code: Connected to user-project. No turn recorded yet.` until Agents had been opened. A failing assertion expected `/Last turn ended/`; `/tmp/tm-app-site-proof/sidebar-before.json` records `pass: false`.

`refreshStatuses` now refreshes the existing completed-turn audit-log projection alongside project and connection status. The same real app then showed `Claude Code: Idle. Last turn ended 2:09 PM in user-project.`; `sidebar-after.json` records the corrected value, and the renderer emitted no page errors. The permanent native smoke installs hook lines and asserts that a completed external turn updates the sidebar without visiting Agents.

```sh
pnpm --filter @timetm/desktop build
pnpm --filter @timetm/desktop typecheck
```

Both exited 0 (11.97 seconds together).

## Evidence

Local artifact root: `/tmp/tm-app-site-proof/`. App captures include `app-demo-review.png`, `app-demo-recovered.png`, `app-onboarding-check.png`, `app-own-project-broken.png`, `app-own-project-recovered.png`, `app-compare.png` and `app-sidebar-fixed.png`. These are acceptance artifacts, not release-package or notarization proof.


### Full source-native regression smoke

```sh
node /tmp/tm-pw/source-native.mjs
```

This temporary runner imports `apps/desktop/scripts/smoke-native.mjs`, changing only the Electron executable and launch arguments to the source app rather than the self-signed package. The exact runner is saved with the acceptance artifacts. It does not package, sign or notarize anything.

Observed output (exit 0, 73.70 seconds):

```text
PASS: demo Broken state, modal focus, nested focus return, persistent announcements, recovery, untouched source, single copy, terminal save point shown live, Claude Code turn shown live (working, then its checked save point), and no check left after quit.
Evidence: /var/folders/94/v27f7lmn4fjb1lvsswc4dk0c0000gn/T/tm-native-smoke-3NOR8c
```

The completed-turn sidebar assertion also passed inside that run. The first attempts exposed smoke setup issues: invoking the script inside omp's Eval made `process.execPath` point to omp rather than Node, and installing the standalone CLI's different hook command left the app correctly reporting a partial connection. The final smoke runs under real Node and installs the app's own command through its real IPC API.

### Website checks

```sh
python3 -m http.server 4391 --bind 127.0.0.1 --directory site
env URL=http://127.0.0.1:4391/ OUT=/tmp/tm-app-site-proof/local-final-axe node /tmp/tm-pw/release-axe.mjs
```

Observed `PASS all rows`: eight pages at 1440 px, home and How it works at 390/320 px, plus a normal-motion home row. Every row had zero axe violations, zero document overflow and zero page errors.

Keyboard testing then caught an introduced mobile comparison issue: at maximum scroll the sticky row heading covered the start of the final column (`stickyRight: 161`, `lastColumnLeft: 81.984375`). A failing geometry assertion is recorded in `table-before.json`. Mobile comparison columns now fit the space beside the sticky heading. After the fix, the same keyboard scenario reached maximum scroll with `stickyRight: 161`, `lastColumnLeft: 161`, assertion PASS and document overflow 0 (`table-after.json`, `local/table-scrolled-320-after.png`).
The website refinement uses the existing Time Machine icon and self-hosted typography, neutral charcoal/white controls, tighter section rhythm, a labelled sideways-scrolling comparison with sticky row headings, and full-height footer lettering. It does not copy Claude or Unvibe assets. Local geometry evidence in `local-report.json`: document overflow 0, header overflow 0, footer lettering inside its footer at 1440, 390 and 320 px. Screenshots: `local/{home,table,footer,install}-{1440,390,320}.png`.

## Quiet-instrument refinement

The follow-on `polish/quiet-instrument-20261020` pass uses neutral light/dark surfaces, a smaller sans-serif navigation hierarchy, quieter borders and shadows, and a history-first initial view. Ask remains available from its visible button and shortcut rather than occupying a permanent column. Consent wording and recovery exclusions remain intact. `design/APP_V3_DIRECTION.md` records the rationale and distinguishes design hypotheses from user research.

The actual source-built Electron app was rehearsed with an isolated synthetic Marigold Tips project. Thirteen axe WCAG AA rows passed with zero violations, horizontal overflow or renderer errors:

- Broken at 1600 × 885, 1280 × 800 and 960 × 640, each in light and dark.
- Ask opened at 1280 × 800.
- Recovery review and completed recovery at 1280 × 800 light and 960 × 640 light/dark.

The requested 1600 × 1000 window was clamped by the Mac display to 1600 × 885; the report records the actual viewport, not the requested size. Recovery created a separate local branch while the original project's branch, HEAD and working-tree status stayed unchanged.

The first rehearsal caught two genuine accessibility regressions before acceptance. Muted light-theme text measured 4.36:1 on the sidebar and 4.12:1 on a selected surface; the shared caption token is now darker. At the minimum window size the recovery-limits pane scrolled without keyboard access; that labelled region is now focusable. The source-native smoke includes focus and Page Down assertions for this boundary. Failing-before reports and passing screenshots are retained in the release evidence.

The updated full source-native smoke also exited 0, including the new minimum-window focus/Page Down scenario, nested-dialog focus return, recovery, source preservation, single-copy behavior, installed hook turns and shutdown cleanup. Evidence: `/var/folders/94/v27f7lmn4fjb1lvsswc4dk0c0000gn/T/tm-native-smoke-cLc1KZ`.

### Real recovery recording

`site/assets/demo/recovery.mp4` records the real Electron app from Broken through checked review to a completed recovery. The bundled project is synthetic; checks and recovery are real. The recording asserts the original project's branch, HEAD and working-tree status remain unchanged. It contains no inference, personal project or API credential.

`ffprobe` reports H.264, 1280 × 800, yuv420p, 30 fps, 39.033 seconds, 603,523 bytes and no audio stream. The site provides seven English caption cues, a text transcript and native playback controls. It uses `preload="none"` and no autoplay. The poster and all refreshed story images come from this source-app acceptance run, not a website reconstruction.

### Responsive recording-site acceptance

Local playback passed at 1440, 768, 390 and 320 px. In each fresh browser context the MP4 was not requested before play; after play its current time advanced, seven caption cues loaded in `showing` mode, and no media error occurred. Keyboard activation opened the transcript. The footer wordmark stayed inside its footer, the comparison's final mobile column remained readable beside its sticky heading, and document overflow and renderer errors were zero.

The WCAG AA pass again reported `PASS all rows`: eight pages at 1440 px, home and How it works at 390/320 px, plus home with normal motion. Every row had zero axe violations. A direct managed-browser inspection at 390 px also exercised the native play button and transcript; clicking the middle of the video itself did not start playback, while the visible native play control did.

Three cold mobile LCP samples on the local server, using 150 ms latency, 1.6 Mbps download and 4× CPU slowdown, were 1,940, 1,704 and 1,856 ms. These are local measurements, not production-network evidence.
