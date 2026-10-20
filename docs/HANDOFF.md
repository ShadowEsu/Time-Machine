# Handoff notes for the next AI session

Last updated: 19 October 2026. First written by the Claude Code session that ran from 15 to 17 October 2026; see "Release 2026-10-19" for the latest pass.

Read this file first, then `CLAUDE.md`, then `docs/BUILD_BRIEF.md`. This file is the full memory of what was decided, built, verified and left open. The repo is public, so this file holds no keys, tokens or personal account details. Where those exist, it says where they live on the founder's Mac.

---

## 1. The idea in one page

**Time Machine** is a safety net for people who let AI coding agents (Claude Code first) change their projects.

- **Pitch:** "Your agent can break things. Time Machine proves which version still passes your tests and gets you back to it."
- **Older pitch, retired:** "proves which version still works". A reviewer flagged it as an overclaim, because a passing test is not proof the app is correct. Use "passes your tests".
- **Who it is for:**
  - Non-technical builders who use agents (Mac app, buttons only).
  - Developers who live in the terminal (the `tm` CLI, Claude Code hooks, an MCP server).
- **What it does:**
  1. Saves a save point of the project before each agent prompt, before risky shell commands, and after each agent turn. Save points live outside the project in `~/.timemachine`, with a git bundle, so they survive `rm -rf` of the project.
  2. Checks a save point by rebuilding it in a separate Git worktree and running the user's own check (for example `npm test`). The verdict is PASS, FAIL, INCOMPLETE, BLOCKED or ERROR, with fixed exit codes 0 to 4 (ADR 0005).
  3. `find-good` finds the newest save point that passes.
  4. `recover` saves now first, then puts the good version on a new branch with a recovery copy next to the project. It never touches the user's folder or current branch. Every result lists what did not come back (secret values, databases, deployed versions).
- **The core marketing fact:** Claude Code's own docs say "Checkpointing does not track files modified by Bash commands." Source: https://code.claude.com/docs/en/checkpointing (section "Bash command changes not tracked"). So `rm`, `mv`, `sed -i` run by the agent cannot be rewound there. Our pre-bash hook saves before risky commands. The site leads with this.

### Pain points the product answers (founder research, with sources in the applications)

| Pain | Our answer |
|---|---|
| Built-in rewind skips shell commands | Pre-bash hook saves first (`packages/core/src/hooks.ts`, `isRisky`) |
| Agents wipe folders and drives (Cursor forum, Gemini CLI incident, Replit database) | Store lives outside the project with a git bundle |
| Restore itself destroys later work (Cursor restore checkpoint) | Recover saves now first, then makes a new branch |
| Fix loops burn time and credits (Bolt, Lovable) | `find-good` proves which version last worked |
| Nobody trusts agent output (Stack Overflow 2026: 7% trust for important decisions, 48% when easy to check) | The verdict is the product: PASS or FAIL, proved in a safe copy |
| Agents now act outside code (ChatGPT developer mode, Claude connectors) | v2 action connector, planned only (ADR 0007) |

### Psychology and retention (founder's brief, keep it)

- People judge a page's look in about 50 ms (Lindgaard 2006). Calm, premium first impression.
- Aesthetic-usability effect: polish signals reliability for a safety tool.
- People scan F and layer-cake patterns: every screen leads with one plain sentence verdict, details one click lower.
- Easy undo lowers anxiety (Shneiderman rule 6). Core promise: "Let your agent try. You can always get back to a version that works."
- Aha in 60 seconds: `tm demo` breaks and rescues a project. Activation = first real PASS plus first Rewind tried in session one.
- Head start effect (Nunes and Dreze loyalty cards): onboarding is 3 steps and the first save point is made for you.
- Peak and end: the Rewind is the peak; sessions end with an honest "came back / did not come back" summary.
- Stored value (IKEA effect): pinned save points, named checks, own rules. Export always free, never a trap.
- Habits take about 66 days (Lally 2010). Quiet presence: menu bar dot and corner card only when it matters.
- Speed is trust: every action two keystrokes or fewer. Sean Ellis "very disappointed" survey monthly.
- **The Ladder pricing (ADR 0002):** $9, $8 from month 7, $7 from month 13, $6 floor. Restores never paywalled. CLI free. Nothing is for sale yet.
- **Refused on purpose:** streaks, badges, guilt notifications, fake urgency.

---

## 2. Founder decisions made in this session (do not re-ask)

| Topic | Decision |
|---|---|
| Order of work | Finish the code MVP (CLI, Mac app, site, npm) before a16z speedrun (closes 1 Nov 2026, 11:59pm PT) and YC W27 (closes 2 Nov 2026, 8pm PT). Then build the Claude/ChatGPT action connector as v2. |
| App look | **Concept A "Notebook"** (Granola-like: warm paper, Newsreader serif, history as a journal, Ask panel on the right), **plus Concept B's dial as the Rewind control and B's agent channels**. Built. |
| Website look | **Concept A "Editorial"**: warm paper, Newsreader display serif with ink-blue (#1d3bb8) italics, the 3D device with power-on and hover tilt kept. Built (3aa6e7f). |
| Website, latest feedback (17 Oct) | Founder loves the giant white-on-black serif "Time Machine" wordmark in the footer and wants that at the START and upper page. Add color: orange slider/dial, a few colored buttons. Shorten the body/instructions scroll, it is not smooth. A ~3 second cinematic opening with the wordmark/device. Sound effects and maybe music. Break ("dies") and rewind animation like a movie. Device, not a car. Great on phones, not laggy on weak laptops. **In progress, not verified yet** (see section 6). |
| "Something to talk to" | **Ask about your history**: Gemini, opt-in per project, the user's own key. Built (ADR 0008). |
| "More Vercel" | **Show deploys on the timeline, read-only.** No rollback, no promote. Built (ADR 0009). |
| Other agents | Founder did not pick. Research recommends Cursor, then Codex CLI, then Gemini CLI (`docs/research/agent-integrations.md`). Shown as Planned in the app and site. |
| Push to GitHub | Approved: "push after the app redesign". Done several times. |
| Vercel private preview redeploy | Approved: "Yes, private preview". Done once (pre-v3 site). Redeploy of the final site is still to do. |
| npm publish | NOT authorized yet. Needs founder npm account, 2FA, and a license choice (MIT or Apache 2.0, recorded as an ADR). |
| v2 connector | Gated by ADR 0007: npm shipped, founder written sign-off in the ADR, and who signs for money and data settled. Not started. |

---

## 3. Environment rules (from the founder's machine setup)

- Sessions run as panes inside **herdr**. One supervisor session ("BOSS", pane `w1:p2`) assigns work and reads status. Prompts from BOSS are the founder's intent. Report to BOSS with `herdr agent prompt w1:p2 "<status>"`. Do not close panes you did not create. Never run `herdr server stop`.
- **Models and routing are owned by the founder.** Never use `/model`, never write `modelRoles`, `retry.fallbackChains` or any routing setting at any scope, never redeem saved reset credits, never use Cursor accounts. Approved chain: Claude Opus 5.5 high, falling back to `openai-codex/gpt-6.1-sol:high`, and back. On quota limits, wait for natural resets. A session-only `retry.usageAwareFallback=true` was set in the old session at the founder's request; it was never saved.
- The researcher session is free-models-only and isolated. Do not touch it.
- **External side effects need founder approval** (deploys, publishing, sending email or messages, CRM writes). Composio CLI at `~/.local/bin/composio` has connected apps (GitHub, Gmail, Vercel `gdg-deploy`, Linear, HubSpot, Instagram, Mixpanel, Resend, Discord). Check live state with `composio connections list`. As of 19 October the Composio Vercel connection is active and sees the `shadowesus-projects` team (`VERCEL_GET_TEAMS`, see `docs/COST_AUDIT.md`). The earlier 403 is gone. Past Vercel work used the Vercel CLI login on the Mac. The Composio Supabase and Stripe connections were EXPIRED on 19 October.
- **Gemini key for apps only:** `~/.config/preston-secrets/gemini-app.env`. A copy is in `apps/desktop/.env` (gitignored via `.env*`). Never print, log or commit it. Never use it for agent inference.
- **Vercel CLI login** exists on the Mac (`~/Library/Application Support/com.vercel.cli/auth.json`). The session used it only to deploy and to read deployment metadata. The app must never read that file (ADR 0009 says so).
- Repo rules in `CLAUDE.md` are binding: every bug fix starts with a failing test; TS strict, no `any`, Zod for every external input; never touch the user's working copy; never promise universal undo; secret values never stored; planned vs built always labelled; no em dashes in docs or site copy; banned claims: "guaranteed", "undo anything", "replays any app", "zero setup", "enterprise ready".

---

## 4. Repo map

- **Repo:** https://github.com/ShadowEsu/Time-Machine (public). Local clone: `~/projects/Time-Machine`.
- **Branches:** `main` (merged from `claude/awesome-mendel-5sk1w0` by PR #1 on 17 Oct, history kept). Keep working on a branch and merge by PR after CI is green.
- **Package manager:** pnpm 10.28.0 via corepack. Node 22+ (the Mac has Node 25).

| Path | What |
|---|---|
| `packages/core` | The one engine. No Electron imports, no network. checkpoint, timeline, diff, open, verify, findGood, recover, undoRecover, hooks, MCP support, setCheck, cleanStore, hookStatus, secret screening |
| `packages/cli` | `tm` command (npm name `timetm`), bundled to `dist/tm.js` |
| `apps/desktop` | Electron Mac app. `src/main` (windows, tray, overlay, IPC, ask.ts, vercel.ts, credentials.ts), `src/preload`, `src/renderer` (app.ts, ask-panel.ts, deploys.ts, feature-settings.ts, styles.css, features.css, fonts), `src/shared` (api.ts Zod IPC contract, cards, format, commands, links), `preview/` (browser preview with a fake engine), `test/` |
| `site/` | Static website (Vercel project `time-machine-site`, root directory `site`). `index.html` (Editorial home), `story.html` (the 9 act scroll story), how-it-works, security, company, blog, privacy, terms, `api/` waitlist function, `vercel.json` (CSP) |
| `design/` | `APP_DESIGN_SPEC.md`, `EXPERIENCE.md`, `APP_V3_DIRECTION.md`, `SITE_V3_DIRECTION.md`, `WEBSITE_SPEC.md`, `concepts/` (app-v3-a/b, site-v3-a/b HTML concepts and shots), `notes/app-v2-fresh-eyes.md` |
| `docs/` | `BUILD_BRIEF.md` (scope source of truth), `PLAN.md` (status and dates), `GUIDE.md`, `DEMO_SCRIPT.md`, `OUTREACH.md`, `apply/` (a16z and YC drafts), `adr/0001` to `0009`, `research/agent-integrations.md`, `legal/` |
| `supabase/` | Waitlist table (ADR 0006), waiting on founder setup |

### Commands

```
pnpm install
pnpm typecheck
pnpm test                        # vitest, about 75 s; 2 tests run only on Linux
pnpm build                       # core, cli, bundles packages/cli/dist/tm.js
node packages/cli/dist/tm.js demo   # breaks and rescues the synthetic Marigold project
pnpm --filter @timetm/desktop build          # Electron app into apps/desktop/out
pnpm --filter @timetm/desktop exec install-electron   # Electron binary (already installed)
pnpm --filter @timetm/desktop dev            # runs the real app
pnpm --filter @timetm/desktop preview:build  # browser preview into apps/desktop/preview/dist
python3 -m http.server 4321 --bind 127.0.0.1 --directory site                       # site
python3 -m http.server 4322 --bind 127.0.0.1 --directory apps/desktop/preview/dist  # app preview
```

App preview stories: `?state=works`, `?state=unchecked`, `?state=new`, `?state=ask-off`, `?state=no-key`, `?state=ask-error`, `?state=no-vercel`.

Throwaway Playwright scripts (not in the repo) live in `/tmp/tm-pw/` (m7v3.mjs click counts, overlap.mjs, audit-v3.mjs, scroll-v3.mjs, perf-v3.mjs). `/tmp` can be wiped; recreate them if missing.

---

## 5. What was built and verified in this session

### Engine and CLI
- `setCheck` refuses a symlinked or hard-linked `timemachine.yml` (test first). Commit 0bcc3ac.
- Agent attribution: each save point records `agent: { name, prompt? }`. Prompts go through secret screening; hidden when they hold a current project secret value or a `scheme://user:pass@` URL. Only the hooks can attribute to Claude Code; `--trigger claude-code*` from the CLI is refused (exit 64).
- `undoRecover`: removes a recovery branch and copy only if untouched. Never removes save points.
- `hookStatus`, `probeHookCommand`, pinned hook fallback `npx -y timetm@<version>` (the review found `npx -y timetm` pointed at an unowned npm name: a supply chain risk).
- `cleanStore`: removes only superseded check logs, only the files the preview showed.
- Coverage lists files `.gitignore` skips.
- Save points expose recorded Git HEAD (for Vercel matching). Commit 96ddf25.
- Security/honesty review (Reviewer2): 1 blocker, 10 should-fix, 12 nits. All fixed with tests. Full text was in the session; the fixes are in commits 58ae50d, 1fd7f5b, 688a192, 9111cf2.

### Mac app (apps/desktop)
- D01 to D07 built: onboarding (3 steps), Notebook project home (status sentence, one primary action, "What does not come back"), journal history with ruler, entry detail, Rewind with the dial (Review then Done, Undo), Compare with now, Agents page (Claude Code real state; Codex, Gemini CLI, Cursor Planned), Storage, Settings, Inspector (Cmd+I), Jump to palette (Cmd+K), shortcut sheet (?), menu bar dot, corner card only on PASS to FAIL, agent pill, global hotkey Control+Alt+T.
- Opt-in Ask panel (Cmd+J) with consent card, cited save points as time chips, escaped model text. Model `gemini-3.5-flash-lite` via `https://generativelanguage.googleapis.com/v1beta/interactions` (`gemini-3.8-flash` hit the free tier daily limit). Consent text now says secret filtering cannot catch every secret (commit 447922d).
- Read-only Vercel deploy chips matched by recorded commit SHA; deploys without Git metadata listed separately. `openExternal` allow-list: https `*.vercel.app`, `vercel.com`, Gemini terms.
- Keys stored with Electron `safeStorage` (macOS Keychain) or env; the window only learns `configured: boolean`.
- Browser preview no longer pops the corner card by itself (it covered the consent button). Commit 447922d.

**Verification evidence:**
- `pnpm typecheck && pnpm test && pnpm build`: passed. 18 test files, 226 passed, 2 Linux-only skipped (228 total).
- Click counts (Playwright `/tmp/tm-pw/m7v3.mjs`): rescue in 2 clicks, "what changed" in 1, Agents in 1 from five screens; Esc, Cmd+K, Cmd+J, dial keyboard and drag passed; no overflow at 960 wide.
- 108 app screenshots: `apps/desktop/preview-shots/v3/` (gitignored, on disk only on the Mac).
- **Native Electron smoke passed** (isolated userData and store): real demo created, verify cp-0003 PASS, recover and undo through IPC, bundled CLI version probe through Electron, Newsreader font loaded, corner panel visible but non-focusable while another window kept focus, real Gemini answer after consent (refused before consent), no renderer errors. Results: `/var/folders/94/v27f7lmn4fjb1lvsswc4dk0c0000gn/T/tm-native-Pj5cue/results.json` (temp folder, may be gone).
- Not exercised: macOS global shortcuts, Finder actions, a full real Claude Code session end to end, a live Vercel token, signing, notarization, auto-update.

### Website (site/)
- Leads with the cited Bash gap. Editorial v3 on every page (3aa6e7f), mobile readability and touch fixes (9a397dd).
- Earlier checks (pre-v3): no horizontal scroll on 12 pages at 1440 and 390, light and dark, motion and reduced motion (96 of 96 runs).
- Perf baseline: `/tmp/tm-perf/before.md`. Acts 4 "The rewind" and 6 "The receipt" dropped frames at 1x; 35 to 38 compositor surfaces per device frame from 3D flattening, blur and backdrop-filter.
- Private Vercel preview deployed 16 Oct (pre-v3 site): https://time-machine-site-8ka8ecc0l-shadowesus-projects.vercel.app (behind Vercel login; anonymous request gets 302). Project `time-machine-site`, team `shadowesus-projects`, SSO protection on all except custom domains.

### Docs and growth
- `docs/DEMO_SCRIPT.md` (60 second, 7 shots on `tm demo`), `docs/apply/a16z-speedrun.md` (SR008), `docs/apply/yc-w27.md`, `docs/OUTREACH.md` (3 drafts). All drafts only, with `[FOUNDER]` placeholders for facts only the founder knows (bio, traction, entity, video link, deck, age and signer rules).
- ADR 0008 (Ask), ADR 0009 (Vercel), research on agent hooks.

### Website cinematic pass (17 Oct, done)
- Commits c3efc30, 9231e29, 69f09bb, 1a1d322 (worker SiteFinish2, after two earlier workers died on quota).
- First-visit opening: giant Newsreader "Time *Machine*" on ink, orange playhead, device rising. 2.9 s (1.2 s on touch and low tier). Skip button, Enter and Escape skip it; repeat visits skip via a localStorage flag; reduced motion skips; page works without JavaScript.
- Second big-type band after the hero: "It worked *at 10:42.*"
- Orange: dial pointer `#FF791F`, warm buttons with dark text (contrast 6.90), fader track `#D14E0B`, focus rings `#B83E08`. Ink blue stays for links and some primary buttons. Green and red only mean a recorded verdict.
- Home 16% shorter at 1440 and 12% at 390; story page 23 to 24% shorter. Native scrolling only. The home spec-sheet section was cut (story page keeps it); easy to restore.
- Sound off by default, Sound button on phones too; procedural WebAudio only (`site/assets/sound.js`): dial detents, failure, rewind, success cues, quiet drone. No music file.
- "Play break + rewind" button: screen dims once, BROKEN on cp-0006, dial steps back to cp-0003, WORKS. Reduced motion jumps straight there. "Synthetic demo" label kept.
- Verified: `/tmp/tm-pw/behaviors-v4.mjs` and `final-v4.mjs` (156 page loads, 13 pages x 1440/390/360 x light, dark, reduced motion, low tier: no errors, no horizontal scroll). Parent re-checked opening, settled hero, phone 390 and break/rewind in a real browser. Screenshots: `/tmp/tm-site-shots-v3/final/`.
- Perf (Chromium, CPU throttle, software renderer): story dropped frames 22/27/22 -> 10/11/4, long tasks 1 -> 0; home stays about 60 fps; weak tier peaks at 17 render surfaces vs 34.
- Not tested: Safari, Firefox, physical phones, real hidden-tab audio stop (simulated only). Story headline at 1440 overlaps the device's bounding box but not its visible pixels.

### CI and release (17 Oct, done)
- CI green on macOS and Linux, Node 22 and 24: run 39070976942 on commit 1a1d322.
- Private Vercel preview redeployed from `git archive HEAD`: https://time-machine-site-5ku15uzil-shadowesus-projects.vercel.app (anonymous 302; deployed `index.html` contains opening.js, sound.js, "Play break + rewind", "passes your tests", "228"). Older preview: https://time-machine-site-8ka8ecc0l-shadowesus-projects.vercel.app.

### Public site, waitlist growth, MIT (17 Oct evening, founder decisions relayed by BOSS)
- **Public:** Vercel SSO protection turned off on `time-machine-site` (API `PATCH ssoProtection: null`); anonymous GET https://time-machine-site.vercel.app/ returns 200. Production deploys are authorized after screenshot self-review and green CI.
- **License MIT** (ADR 0010, `LICENSE`, every package.json). npm still unpublished.
- **Home page rebuilt** (Preston: "the website is horrible"): one promise ("Your AI agent broke it. Get back the version that passed your tests."), real `tm demo` output right beside or under it, the waitlist form in the first screen, then Why (Claude Code docs quote), How (3 steps + what does not come back), Built in the open (CI, MIT, agents), 6 FAQs, end form. 4014 px tall at 1440 (was 8460), 4845 at 390 (was 11332). The first-visit opening, the 3D device, sound and the Ladder were removed from home (in git history; the story page keeps its own cinema). Absolute OG image `assets/img/og.png` on every page, canonical, `robots.txt`, `sitemap.xml`.
- **Referral + funnel** (contract in `docs/launch/SUPABASE_SETUP.md` and `site/api/_lib/`): signup returns a personal code, place in line and total; `?ref=` is kept per visit and credited on signup; returning visitors see their real place (`GET /api/waitlist?code=`). Order rule shown on the site: most friends joined first, then earliest signup. `/api/event` counts visit, copy and share with no IP, cookie or identifier, and skips browsers with GPC or DNT. View `funnel_daily` reads the funnel. The no-checkbox hero form asks consent through the button and the line under it; forms with a checkbox still need the tick.
- **Honest closed state:** `/api/health` says `waitlist:false`, so every form says up front "The waitlist opens soon. It is not saving emails yet." with the founder's email.
- **Verified:** `pnpm typecheck`, `pnpm test` 248 passed + 2 Linux-only skipped. `/tmp/tm-pw/audit5.mjs`: 108 loads (9 pages x 1440/390/320 x light/dark x motion/reduced) with no page errors and no sideways scroll. `/tmp/tm-pw/ref-smoke.mjs` (mocked API at 1440/390/320): ref credited across pages, card shows "#3 of 41", reload shows fresh "#2 of 42 / 1 friend", Copy puts `/?ref=<code>` on the clipboard, events carry `via: ref`. Mobile LCP (390, 4x CPU, slow 4G, local server) 0.90 to 0.92 s, element `p.dek`. Shots: `/tmp/tm-pw/v4-*.png`, `ref-*.png`, `soon-390.png`. Backend SQL ran twice on a local Postgres 17 with Supabase-style roles (WaitlistBackend agent).
- **Not done:** double opt-in and unsubscribe emails (need an email provider and a sending domain; today nothing is emailed); real Supabase; physical phones.
- **Safari and Firefox engines (17 Oct night):** `/tmp/tm-pw/xbrowser.mjs`, Playwright WebKit 2370 and Firefox 157, 9 pages x 1440/390 x motion/reduced motion = 72 loads, plus the live home and story pages (16 loads). No page or console errors and no sideways scroll in either engine. Home: h1, email field and demo proof (full terminal at 1440, 3-line excerpt at 390) all in the first screen. Every finding was identical in Chromium, so nothing is engine specific: (1) on `story.html` with reduced motion each act shows its end state, so the "Rewind" kicker and "Keep scrolling" line stay hidden on purpose (`story.js` `reveal`, `RM` jumps p to 1); (2) story stamps and the paper sheet extend past the edge and are clipped, decorative; (3) a `security.html` tree line is wider than 390 inside its own scrolling `<pre>`. Shots: `/tmp/tm-pw/xb-{webkit,firefox}-{1440,390}-{m,rm}-{home,story}.png`. Real Safari on iOS and macOS still untested.

### Two minute first run (17 Oct night)
- **Found:** on a real Node repo, `tm init` wrote no install step, so every check in a fresh copy failed to start (exit 127, no `node_modules`) and `find-good` could never pass. Fixed test first (`packages/core/test/init-setup.test.ts`): `init` now writes `verify.setup` from the lockfile (`npm ci`, `pnpm install --frozen-lockfile`, `yarn install --frozen-lockfile`, else `npm install`, all `--prefer-offline`), only when the project has dependencies. `InitResult.verifySetup` added; `tm init` prints it.
- **Timed:** `scripts/time-first-run.sh` (packed `timetm`, fresh HOME, empty npm cache, `sindresorhus/slugify`, an appended `throw` as the agent's break): 54.3 s and 82.1 s from `init` to a verified recovery branch. `find-good` is almost all of it (two `npm install` runs). Next cut if needed: reuse `node_modules` between save points with the same package.json and lockfile inside one `find-good`.
- **README** now leads with the site's promise, a 30 second demo block, install (npm once published, source today), four-command use with the timing, safety limits, CI and MIT badges.
- **Mac app first run** (agent AppFirstRun, commits 5359ad1, fd70c10): Try the demo is the primary button and reaches a recovery branch in 2 clicks (was 3, and used to leave two branches); picking a folder starts setup; step 3 is one click to connect Claude Code and finish, or skip; buttons stay in view at 960x640; welcome shows "Not signed or notarized by Apple yet"; `apps/desktop/README.md` "Running an unsigned build". Welcome headline now matches the site: "Get back the version that passed your tests." Native Electron smoke passed (screens in `/tmp/tm-pw/app-firstrun/native-after/`).

### One page home, no site email, signed app (18 Oct)
- **Home** rebuilt after Preston's reference (tenacitylabs.co): one dark page, a warm curtain glow, centered serif promise, three real verdict chips, the form, three cards (Save, Check, Bring back), then a dense footer with status, what works with it, what does not come back, five FAQs, navigation and the giant wordmark. 1815 px tall at 1440. Other pages stay, linked from the footer.
- **Waitlist** (agent WaitlistBackend, commits 3752993, a77056c, 58aab82): pending signups, no site email, confirmed-only ranks; `/api/health` email is always false. An earlier Resend double opt-in draft was built then removed on Preston's "no emails" call. SQL block ran twice on Postgres 17; pending rows get no place, a hand-confirmed row does, refs credit only active rows, anon and authenticated are refused.
- **Mac app** (agent AppFirstRun, 1438b21): `pnpm --filter @timetm/desktop package:local` builds `apps/desktop/release/Time Machine.app` signed with the stable self-signed identity "Time Machine Self Signed" (backups in `~/.timemachine-signing/`, 0600). Same designated requirement across two builds; Gatekeeper rejects it, as expected without Apple Developer ID.
- **Blocked:** npm publish (account needs two-factor; logged in as prestonsusanto, E403, nothing published); Supabase (Composio links tm-waitlist and tm-waitlist-2 both EXPIRED before sign-in finished; nothing created).
- **Live:** PR #6 merged 87acf0f, prod deploy `mikjromdp` at https://time-machine-site.vercel.app (200, health `waitlist:false, email:false`), 1883 px at 1440, BOSS approved.

### Longer home, opening screen, app polish (18 Oct, Preston's request)
- **Site** (PR #7, 0dd5c84, prod `luyys6tur`): black opening screen with the wordmark and an orange loading bar (`site/assets/intro.js`; first load per visit, leaves when the page and fonts are ready, at least 900 ms, at most 2.5 s, any key or click skips, none with reduced motion or no JS). Scroll fade-ins (`data-reveal`). New sections: real app window under the hero; "If you don't write code" with three real screens (broken, dial, done; phone crops `*-m.jpg`); developer cards plus real `tm demo` output; why (Claude Code docs quote); four plain words; end CTA. 6505 px at 1440. Live: intro gone in 1.6 to 1.7 s, mobile LCP 0.75 s (H1), no side scroll at 1440/390/320. Screens come from the packaged app (agent AppPolish, `/tmp/tm-pw/site-app-shots/`).
- **App** (agent AppPolish, 3924171, c42977d): launch splash (black, wordmark, indeterminate bar, fades when settings, projects and first page are drawn, 600 ms minimum, skippable); 220 ms page fades, sheet scale-fades, journal stagger capped at 300 ms; hover, press and focus polish; empty states. Splash fade starts 658 to 735 ms after load in the packaged app. Known: after Try the demo, the newest save point ("Before going back") is unchecked, so a project page shows Not checked yet until a check runs; fix lives in `packages/core` demo.
- **Typing and premium motion** (Preston: "make the loading last longer, ~2 seconds, typing effect throughout"): `site/assets/motion.js` types `[data-type]` text with an orange caret when it comes into view (`data-type-now` types after the opening leaves; `data-type="term"` keys in commands and drops output lines one by one). Used on the home h1, h2s, step h3s, both terminals, and the h1 of how-it-works, security, company and all blog pages. Headings get an `aria-label` with the full text (line breaks become spaces). Also: pointer light on cards and screenshots, one light sweep across the footer wordmark, the app window settles from a tilt on scroll (CSS scroll-driven, where supported). Opening: wordmark types in, bar fills over ~1.9 s, leaves after at least 2 s (removed ~2.9 s with the fade). Reduced motion: no typing, plain text; a 3 s CSS safety reveal shows text if the script never runs. Research for "premium animations" used existing knowledge only (no web search from this paid pane).

### Waitlist live (19 Oct UTC, PR #9 merged e624d77, prod `1ylft9s23`)
- Live `/api/health` = `{"ok":true,"waitlist":true,"email":false}`. Real browser signup at 390 on the live site with a `+tmtest` Gmail address and `?ref=zzzzzzzzzz`: form said "Saved as pending and unconfirmed. No email has been sent."; network `/api/health 200`, `/api/event 204`, `/api/waitlist 200`; row present in `tm_waitlist.waitlist` (source `/`, unknown ref ignored, `confirmed_at` empty) and a visit event with `via_ref true`. Test row and test event deleted (counts 0/0). Setup doc rewritten as built; ADR 0006 addendum records the shared-project decision.

### Mac app skills pass completed locally (18 Oct, Sol continuation)
- **Demo state:** `runDemo` now verifies the save point created before the engine’s own recovery in the background. Review does not wait for it. Leaving Review shows Broken only after the real check fails. Before: the packaged app still said Not checked yet after 15 seconds. After: Broken was already visible on leaving Review; source branch, HEAD and working-tree status stayed unchanged.
- **Copy and polish:** upright status/Rewind headings, sentence-case labels, curly “Couldn’t check” in the shared verdict vocabulary, pretty/balanced wrapping, tabular numbers and at least 40 px primary/navigation hit areas. The launch wordmark keeps its existing italic treatment.
- **Accessibility:** `dialog-focus.ts` owns initial focus, Tab/Shift+Tab containment, inert backgrounds and focus return, including nested Jump to inside Rewind. One persistent live region outside the redraw tree announces stages, check results and toasts. The demo busy sheet is a named modal dialog with a decorative spinner.
- **Retained regression:** `pnpm --filter @timetm/desktop package:local`, then `pnpm --filter @timetm/desktop smoke:native`. The macOS-only smoke uses pinned `playwright-core` (no browser download), isolated HOME/TM_HOME/userData and synthetic data. It checks the demo’s real Failed evidence, modal/nested focus, persistent announcements, recovery branch and untouched source. Passed; evidence `/var/folders/94/v27f7lmn4fjb1lvsswc4dk0c0000gn/T/tm-native-smoke-nT4oHV/`.
- **Verification:** typecheck, 265 tests + 2 Linux-only skips, CLI build, preview build and local self-signed package passed. Packaged journey: 5.75 s Try the demo to Review, 0.68 s Go back to Done; Add a project through checked recovery 9 clicks, 3.93 s on synthetic data. Do not compare journey totals including the old harness’s artificial 15-second wait. Native keyboard assertions and axe WCAG 2.2 AA: 0 violations on welcome, project, check result, dark project and simple Rewind with reduced motion; 0 renderer errors. Final audit/screenshots `/tmp/tm-accessibility-GC48of/`. VoiceOver speech and quarantined first launch were not exercised. Website unchanged in this pass; no redeploy needed.
- **npm next steps** once Preston enables 2FA: `npm publish --access public` in `packages/cli` (send any OTP or browser URL to BOSS), then `npm view timetm version` and `npx timetm@latest demo` in a clean HOME; then update "not on npm yet" everywhere and redeploy.
- **Email:** do not send or wire any email. Preston's own email agents handle it.

### Interactive rewind story replaces the hero screenshot (19 Oct, Preston's request)
- **Why:** Preston said the static app picture under the hero "doesn't really do anything" and asked for an interactive 3D story. The old `.rw` replay and the `.window` screenshot are gone, along with the now unused `app-review.jpg` and `app-review-800.jpg`. Real app screens stay in "If you don't write code".
- **What:** `site/index.html` `figure.rewind-story[data-rewind]`, styles `.rs-*` in `site/assets/home.css`, behaviour in `site/assets/rewind.js`. It is a CSS 3D instrument (aluminium case, knurled dial, screen, LED, restore button) with save point cards behind it and a timeline. No Three.js and no network assets. Story: cp-0003 passes, cp-0004 to cp-0006 fail (verdicts from a real `tm demo` run), cp-0001 and cp-0002 have no check ("No verdict assumed"). Plays once when 40% visible (650 ms steps), stops at the break, and the visitor turns the dial back. "Bring back this version" works only on a passing save point and shows a receipt (new branch, separate copy, current folder untouched). Then "Start again".
- **Controls:** dial is a `role=slider` (arrows, Home/End, pointer drag); timeline buttons; "Rewind to the passing version"; Play/Pause. Manual input stops playback. Pauses when hidden or scrolled away. Reduced motion and `data-tier="low"` never autoplay and jump straight to states. Visible caption labels it an illustration; a live region announces each state; noscript fallback text.
- **Verified locally:** `/tmp/tm-pw/hero-story-smoke.mjs` at 1440, 390 and 320, motion and reduced: form above the fold, no sideways scroll, keyboard dial path to recovery, Start again, rewind, playback cancel, 0 page errors, axe WCAG 2.2 AA 0 violations on the story. Mobile LCP 1.1 to 1.7 s (`P.sub`). Site audit: 108 loads, 0 problems.

### Composio-inspired interactive app view (19 Oct)
- **Direction:** Preston asked for Composio-like animations and a web app interface. Inspected the current composio.dev hero and product panels in Chrome. Borrowed its product-explaining interactions, not its blue branding. Time Machine keeps its orange, serif identity and existing 3D device.
- **Surface:** “Try the app demo” below the waitlist opens a browser-only app illustration. “3D story” and “App demo” switch between two views of the same checkpoint state in `site/assets/rewind.js`. The app has six selectable save points, recorded check evidence, an explicit recovery review (saved files included; secrets and database contents excluded; current folder untouched), passing-only recovery and Start again. No cloud project access, login, file access or engine calls. Real Mac app screenshots remain linked below.
- **Motion and keyboard:** changing a save point animates the detail pane for 240 ms, using only opacity and transform; fast selections cancel the previous animation. Reduced motion and low tier skip playback and detail animation. View changes cancel pending story playback without resetting the checkpoint. The entry link moves keyboard focus to the selected app save point without the native fragment navigation clearing it. Named buttons, pressed states and the existing live region remain synchronized.
- **Accessibility corrections:** the full-page audit exposed two existing named `<pre>` elements without a valid naming role. Both now have `role="region"` so their labels are valid while the output remains readable. The mobile comparison scroller is also a named, focusable region so keyboard users can scroll its table.
- **Browser proof:** `/tmp/tm-pw/app-demo-smoke.mjs` passed at 1440/1060/768/390/320, with motion and reduced motion. Keyboard entry/recovery, checked-versus-unchecked gating, synchronized views, playback cancellation, restart, low-tier instant actions and no-JS fallback passed. All 10 full-page axe WCAG 2.2 AA scans found 0 violations; no page errors or sideways scroll; form above the fold. The comparison table scrolls with arrow keys at 320. Screenshots reviewed in `/tmp/tm-pw/app-demo-local/`.
- **Performance:** mobile LCP 1.26–1.40 s across three follow-up samples at 4× CPU, 1.6 Mbit/s and 150 ms latency. The initial sample taken alongside parallel browser and test work was 4.47 s (the next two were 1.29/1.31 s); do not call the local environment contention-free.

### Release 2026-10-19 (integration branch `release/e2e-20261019`)
- **CI** (6e3d941): every job now also runs `pnpm --filter @timetm/desktop build` and `node scripts/check-cli-package.mjs` after typecheck, test and build. The package check packs `packages/cli`, requires exactly `LICENSE`, `README.md`, `dist/tm.js` and `package.json`, unpacks the tarball outside the repo and runs `tm --version` and `tm --help` from it.
- **Vitest 4.1.12** replaces 3.2.7, which pulled advisories through `@vitest/mocker` and `tinypool`. `pnpm audit` reports no known advisories.
- **Core recovery fixes** (93db542, 98deb71, tests first): `recover` lists every coverage gap in `notRestored` (secret-looking tracked edits, secret files by name, ignored folders); `undoRecover` removes the branch when the recovery copy was deleted by hand; `checkpoint` works before the first commit; a failed recovery copy removes the `tm/recover` branch it just made; undo reads `git status` raw (a leading ` M` no longer turns `.env` into `env`) and accepts Time Machine's own rewrite of a tracked config file, while a real edit still blocks undo.
- **Mac app** (d2c3064, 4777e48, 9f9e357): single instance (a second launch focuses the running app); on quit it unregisters shortcuts, closes the store watcher and stops a running check, removing its temporary copy; startup failure shows an error dialog and exits instead of leaving a windowless process; IPC failures are handled; an unreadable folder gets a clear error. App, Dock and menu bar icons are drawn from code by `apps/desktop/scripts/app-icon.mjs` (no image tools or network). `build.mjs` writes `out/icon.png`; `package-local.mjs` builds the `.icns`, sets version and copyright in `Info.plist` and fails if the bundle still has Electron's icon.
- **Site API** (a9aff08): signup and event POSTs return `429 {"ok":false,"error":"rate_limited"}` with `Retry-After: 60` when the database cap is full; the form says the list is busy and keeps the typed email. `/api/health` adds `database`: `reachable`, `unreachable` or `not_configured`, from a cached read-only probe, so "configured" is never reported as "working". Oversized streaming bodies are cancelled before buffering.
- **Migration 0005** (`supabase/migrations/0005_bounded_public_rpcs.sql`): global write caps inside the `tm_waitlist` RPCs (so direct PostgREST callers are bound too), strict event paths, and batched removal of event rows older than 90 days. The signup cap counts calls in `tm_waitlist.waitlist_join_attempts` (timestamps only, RLS on, no grants), so a duplicate email costs the same slot as a new one and the cap cannot reveal list membership. Signatures and grants are unchanged; rollback SQL is in `supabase/README.md`. Proven on PGlite (caps, oracle, rollback and reapply). **Applied to the live database on 19 Oct** through the Management API and checked: attempt table with RLS and no anon access, the three public RPCs still security definer and anon only.
- **Other fixes:** a failed recovery keeps its original error even when branch cleanup cannot list worktrees (b21ee5d); a store lock left by a killed command is taken back at once when its process is gone on this Mac, instead of failing for 30 s (1416fed).
- **Docs:** `docs/COST_AUDIT.md` (read-only cost audit), `docs/launch/NPM_PUBLISH.md` (package check step).
- **Verified on the final tree:** `pnpm typecheck` passed; Vitest 25 files, 284 passed, 2 skipped (286); build, desktop build and `check-cli-package` passed; `package:local` + `smoke:native` passed, including a new step where a `tm checkpoint` from the terminal appears in the open app without a reload; axe WCAG 2.2 AA found 0 violations on 8 site pages at 1440 px and on 2 pages at 390 and 320 px. Not exercised: notarization.
- **Release steps, in order:** (1) deploy the API that maps 429 (0005 is already live); (2) check `/api/health` reports `database: "reachable"`; (3) then follow "Release" in section 6.

---

## 6. Open work, in order (small items included)

### Release (authorized, repeat when things change)
1. Run `pnpm typecheck && pnpm test && pnpm build` on the final tree.
2. Push the branch, open a PR to `main`, confirm all 8 CI checks pass (`gh pr checks <n>`), then merge. Always typecheck the committed HEAD in a clean worktree before pushing (`git worktree add /tmp/x HEAD`, `pnpm install --frozen-lockfile`, `pnpm typecheck`).
3. Deploy production from a clean `git archive origin/main` export with `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` set (look them up through the Vercel API for project `time-machine-site` under team `shadowesus-projects`), `npx -y vercel@latest deploy --prod --yes`. Authorized after screenshot self-review and green CI. Smoke: https://time-machine-site.vercel.app/ returns 200 and shows the new text.
4. Keep test counts and status in `README.md`, `docs/PLAN.md`, `site/index.html`, `site/story.html`, `site/company.html` in sync.

### Blocked on the founder
7. **npm publish of `timetm` 0.1.0.** Not published; `timetm` is not on npm. Blocked only on the founder turning on npm two factor for publishing (last attempt: E403). One command away: `"private"` removed, MIT `LICENSE` in the package, repository/homepage/bugs/author set, README rewritten for npm. Before publishing run `node scripts/check-cli-package.mjs` (CI runs it too). `npm pack`: 4 files, 151.9 kB; installed from the tarball in a clean temp dir with a fresh HOME, `tm --version` 0.1.0, `--help`, `npx timetm demo` all worked (17 Oct). Founder steps: `docs/launch/NPM_PUBLISH.md`. After publish, update every "not on npm yet" (site status line + FAQ, README, GUIDE, PLAN) and redeploy.
8. **D08 signing and notarization** of the Mac app: needs an Apple Developer account and an adult signer (founder is a student; see `docs/legal/README.md`). Until it is done, a downloaded `Time Machine.zip` is quarantined and Gatekeeper blocks the app. Five blockers. 1 and 2 are open owner actions. 3 to 5 are handled by `package:release` once 1 and 2 exist. That path is unexercised: only its argument lists are unit tested (`apps/desktop/test/signing.test.ts`). The default `package:local` runs the same commands as before.
   1. A Developer ID Application certificate, which needs a paid Apple Developer Program team. Today `package-local` signs with the self-signed "Time Machine Self Signed" identity. Open.
   2. A `notarytool` credential profile on the Mac (`xcrun notarytool store-credentials`, with an app-specific password or an App Store Connect API key). None exists. Open.
   3. A secure timestamp. Handled by `package:release`: Developer ID builds sign with `--timestamp` and hardened runtime. The default build keeps `--timestamp=none`.
   4. The `disable-library-validation` entitlement. Handled by `package:release`: it signs with `apps/desktop/scripts/entitlements.release.plist`, which keeps only `allow-jit` (V8 needs it). The default build keeps `entitlements.local.plist`. Unknown until the first real run: whether a helper needs more.
   5. Stapling. Handled by `package:release`: after Accepted it runs `xcrun stapler staple`, zips the stapled app again, then checks `codesign --verify --deep --strict` and `spctl --assess --type execute -vv`. Anything but Accepted stops and prints the `xcrun notarytool log <id> --keychain-profile <profile>` command.
   Once 1 and 2 exist: `TM_SIGN_IDENTITY="Developer ID Application: <Name> (<TEAMID>)" TM_NOTARY_PROFILE=<profile> pnpm --filter @timetm/desktop package:release`, then `smoke:native`. Steps in `apps/desktop/README.md` "Before Apple notarization".
9. **Waitlist backend:** live since 19 Oct (see "Waitlist live"). Migration 0005 is applied live (see "Release 2026-10-19").
10. **Vercel login protection:** off since 17 Oct (founder decision). The site is public on vercel.app.
10b. **Waitlist emails (double opt-in + unsubscribe):** not built, nothing is emailed. Options for the founder in `docs/launch/EMAIL_OPT_IN.md` (Resend on unvibe.site, Resend on a new domain, or wait).
11. **Domain** purchase, **lawyer review** of Terms and Privacy, **who signs for money**.
12. **Record the 60 second demo video** (`docs/DEMO_SCRIPT.md`).
13. **Fill `[FOUNDER]` placeholders** and submit: a16z speedrun by 1 Nov 11:59pm PT, YC W27 by 2 Nov 8pm PT. Notes from the drafts: a16z FAQ suggests students check the alpha fellowship and email sr-team@a16z.com about age; speedrun residency is in person in SF from Feb 2027.
14. **Find 5 builders** for think-aloud tests (`docs/OUTREACH.md`). Never send without approval.
15. **Real Vercel token** to exercise the deploy chips live (paste in app Settings > Features, or `VERCEL_TOKEN`).

### Next product work (after release)
16. Agent hook kits in this order: Cursor native hooks, Codex CLI hooks, Gemini CLI hooks, then Copilot in VS Code, Windsurf, Cline, Aider (`docs/research/agent-integrations.md`). Each must be verified end to end (prompt save, pre-command save, end-of-turn check) before it is called supported. MCP-only clients are "agent-directed tools", not "automatic protection".
17. "Agent said": record the agent's reply (currently shown as "Not recorded. Recording replies is planned.").
18. Real test counts per save point (the journal shows "check failed · 2 files", not invented test counts).
19. Planned app items from `apps/desktop/README.md`: thinning old save points, Docker or Apple container isolation, generated journal summaries, notes and pins, live agent feed, "What broke?", Focus mode handling, recent cards list, card frequency limits, draggable pill.
20. v2 action connector (ADR 0007), only after its gate: remote MCP server (Streamable HTTP plus OAuth) as a Claude custom connector and ChatGPT developer mode connector, via Composio auth. Gmail hold and recall, Slack delete first. Emails move from "Never" to "hold and recall only" in the brief only after founder sign-off. Payments stay "refund, not undo".

### Small leftovers worth remembering
- `apps/desktop/preview-shots/` is gitignored; screenshots exist only on the Mac.
- Test counts: 286 (284 on macOS, 2 Linux-only) on 19 Oct, in `README.md`, `docs/PLAN.md`, `site/index.html`, `site/story.html`, `site/company.html`. `site/assets/story.js` reads the number from the HTML.
- Ask uses Flash-Lite because the 3.8 Flash free tier hit its daily limit.
- The Gemini key in use is temporary; when it changes, update `apps/desktop/.env` (gitignored) only.
- `docs/HANDOFF.md` (this file) should be updated at the end of every session.

---

## 7. How this session worked (lessons for the next AI)

- **Subagents die on provider quota mid-task** (it happened 5 times: AppUX, SitePerfMobile, Reviewer, SiteFinish on Codex limits or network errors). Give every long agent explicit milestones and make it commit after each one. Before restarting, read `history://<agent>` and `git status` so no work is lost, stop the old writer, then start exactly one replacement.
- **One writer per file area.** Parallel agents worked well when ownership was explicit (core vs app vs site) and shared files (`apps/desktop/src/shared/api.ts`, `engine.ts`, `preview/fake.ts`) were edited additively with messages between agents.
- **Verify the real thing.** Browser preview checks missed native behaviour; the native Electron smoke caught nothing broken but was the only proof the overlay never takes focus. Screenshots caught real design bugs (overlapping buttons, duplicated agent names, a popup covering consent).
- **Honesty review pays off.** It found an npm supply chain risk and several overclaims. Re-run a fresh reviewer before any public launch.
- **The founder's taste:** dislikes "basic"; loves the oversized serif wordmark, the 3D device, the launch feel; wants color (orange), sound, motion, but smooth on phones and weak laptops; wants things easy to navigate for non-technical people. Granola is the reference for the app's feel.
- **Status to BOSS** at the end of each task: what changed, what was verified (paths), what is blocked, next steps.
