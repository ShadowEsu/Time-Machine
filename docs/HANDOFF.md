# Handoff notes for the next AI session

Last updated: 17 October 2026. Written by the Claude Code session that ran from 15 to 17 October 2026.

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
- **External side effects need founder approval** (deploys, publishing, sending email or messages, CRM writes). Composio CLI at `~/.local/bin/composio` has connected apps (GitHub, Gmail, Vercel `gdg-deploy`, Linear, HubSpot, Instagram, Mixpanel, Resend, Discord). Check live state with `composio connections list`. The Composio Vercel connection could NOT see the `shadowesus-projects` team (403), so Vercel work used the Vercel CLI login on the Mac instead.
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

### Where w2 stopped (18 Oct, usage pause)
- Nothing in progress, tree clean. Resume when BOSS says usage refilled.
- **Supabase next steps** once a new Composio supabase link shows ACTIVE: `SUPABASE_LIST_ALL_ORGANIZATIONS` -> `SUPABASE_CREATE_A_PROJECT` (name `time-machine-waitlist`, region `us-west-1`, free; generate the DB password locally, never print it) -> wait healthy -> `SUPABASE_BETA_RUN_SQL_QUERY` with the combined block in `docs/launch/SUPABASE_SETUP.md` §2 -> `SUPABASE_GET_PROJECT_API_KEYS` reveal, pipe the service role key on stdin to `npx vercel env add SUPABASE_SERVICE_ROLE_KEY production` (plus `SUPABASE_URL`) -> redeploy -> one real signup with a `+test` address, confirm the pending row by read-only SQL, delete it. Pending rows get no place, so expect `{ok:true,pending:true}` only.
- **npm next steps** once Preston enables 2FA: `npm publish --access public` in `packages/cli` (send any OTP or browser URL to BOSS), then `npm view timetm version` and `npx timetm@latest demo` in a clean HOME; then update "not on npm yet" everywhere and redeploy.
- **Email:** do not send or wire any email. Preston's own email agents handle it. Unused Vercel vars `WAITLIST_FROM` and `SITE_URL` are set on time-machine-site production; nothing reads them.

---

## 6. Open work, in order (small items included)

### Release (authorized, repeat when things change)
1. Run `pnpm typecheck && pnpm test && pnpm build` on the final tree.
2. Push the branch, open a PR to `main`, confirm all 8 CI checks pass (`gh pr checks <n>`), then merge. Always typecheck the committed HEAD in a clean worktree before pushing (`git worktree add /tmp/x HEAD`, `pnpm install --frozen-lockfile`, `pnpm typecheck`).
3. Deploy production from a clean `git archive origin/main` export with `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` set (look them up through the Vercel API for project `time-machine-site` under team `shadowesus-projects`), `npx -y vercel@latest deploy --prod --yes`. Authorized after screenshot self-review and green CI. Smoke: https://time-machine-site.vercel.app/ returns 200 and shows the new text.
4. Keep test counts and status in `README.md`, `docs/PLAN.md`, `site/index.html`, `site/story.html`, `site/company.html` in sync.

### Blocked on the founder
7. **npm publish of `timetm` 0.1.0.** One command away: `"private"` removed, MIT `LICENSE` in the package, repository/homepage/bugs/author set, README rewritten for npm. `npm pack`: 4 files, 151.9 kB; installed from the tarball in a clean temp dir with a fresh HOME, `tm --version` 0.1.0, `--help`, `npx timetm demo` all worked (17 Oct). Founder steps: `docs/launch/NPM_PUBLISH.md`. After publish, update every "not on npm yet" (site status line + FAQ, README, GUIDE, PLAN) and redeploy.
8. **D08 signing and notarization** of the Mac app: needs an Apple Developer account and an adult signer (founder is a student; see `docs/legal/README.md`).
9. **Waitlist backend:** the founder creates the Supabase project by following `docs/launch/SUPABASE_SETUP.md`, then a redeploy. Until then the form says the waitlist opens soon.
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
- Test counts were updated everywhere on 17 Oct to 261 (259 on macOS, 2 Linux-only, all green in CI). Update every place listed in Release step 4 when the number changes.
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
