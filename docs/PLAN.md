# Plan to MVP

Status (22 October 2026): M0 to M3 code is built and merged to `main`. License: MIT (ADR 0010). `timetm` is one command from npm (`docs/launch/NPM_PUBLISH.md`); publishing waits on two-factor on the founder's npm account. 384 automated tests (382 on macOS, 2 run only on Linux) in CI on macOS and Linux, Node 22 and 24. The web app (Phase B, W01 to W07) is built and served by `tm ui` from the CLI; the Electron Mac app was retired on 22 October (ADR 0012). The web app costs $50 once (ADR 0013): `tm license` and the Settings panel are built, the site shows the price, and checkout opens once an adult signer and a Stripe account exist (`docs/launch/CHECKOUT_SETUP.md`). The website is public at https://time-machine-site.vercel.app: one page with the promise and the waitlist in the first screen, a real recording, a step-by-step section for people who don't code, the developer view with an agent-readable `install.md`, plain-word definitions, a changelog and a dense footer. The waitlist saves pending signups once Supabase is set up (`docs/launch/SUPABASE_SETUP.md`); the site sends no email. The action connector remains proposed v2 (ADR 0007). Full session memory: `docs/HANDOFF.md`.

Waiting on the founder: npm account (publish), who signs for money (blocks checkout), a Stripe account, lawyer review, a domain, and the demo video. Anything not marked done is planned. Scope comes from `docs/BUILD_BRIEF.md`. This file says the order and the dates.

## Goal

By 31 October 2026, a stranger can run `npx timetm init` on the demo project, break it, and get a verified recovery branch in under 2 minutes. That is the demo for the a16z speedrun (closes 1 November) and YC W27 (closes 2 November, 8pm PT).

Measured 17 October on a real repo (`sindresorhus/slugify`, packed `timetm`, fresh home, empty npm cache): 54 to 82 s from `init` to a verified recovery branch over two runs (`scripts/time-first-run.sh`). Before `init` guessed the install step, the same path never reached a verified branch: every check failed to start without `node_modules`. The web app's Try the demo reaches a recovery branch in 2 clicks. What remains for the goal is the npm publish itself.

## Milestones

| # | Dates | What ships | Done when |
|---|---|---|---|
| M0 (done) | 15 to 16 Oct | pnpm workspace, `packages/core`, `packages/cli`, TS strict, Zod, Vitest, CI. Demo fixture with a broken history. V01 to V14 written and failing | `pnpm test` runs and shows 14 red tests for the right reasons |
| M1 (done) | 17 to 21 Oct | `tm init`, `tm checkpoint`, external store, `refs/tm/*`, git bundle, secret safe config, coverage report, `tm timeline`, `tm diff`, audit log | Save point tests green. No secret value appears in the store, logs or test output |
| M2 (done) | 22 to 25 Oct | `tm open` (worktree), `tm verify` (host mode, timeout, clean env, network rule), `tm find-good`, `tm recover` | The demo runs end to end. The working copy and current branch are byte for byte unchanged after every command |
| M3 (done, publish waiting) | 26 to 28 Oct | `--json` on every command, exit codes per ADR 0005, Claude Code hook kit, `tm mcp`, publish `timetm` 0.1 to npm | All V tests green on macOS and Linux CI. `npx timetm --help` works from a clean machine |
| M4 (site done, private) | 29 to 31 Oct | 60 second demo video, one page site with waitlist, Terms and Privacy reviewed, both applications submitted | Applications sent. The site says what is built and what is planned |
| M5 (done) | 21 to 22 Oct | Phase B web app (W01 to W07), `tm license`, the price on the site | Per the brief and ADR 0012, 0013 |
| M6 | When the signer exists | Open checkout: Stripe keys and the license signing key on Vercel, one test purchase | `/api/health` says `checkout:true` and a test key activates |

Each milestone ends with a commit and push. A milestone is not done if any test is skipped.

## Founder tasks (only you can do these)

| Task | By | Note |
|---|---|---|
| Create an npm account and claim `timetm` | 20 Oct | The name is free today. Turn on 2FA |
| Pick an open source license for the engine and CLI | 20 Oct | Apache 2.0 or MIT keep adoption easy. Recorded as an ADR |
| Decide who signs for money: a parent or guardian, or a company with an adult officer | 28 Oct | Blocks Stripe and the Terms. See `docs/legal/README.md` and `docs/launch/CHECKOUT_SETUP.md` |
| Pick and buy a domain | 28 Oct | Needed for the site and support email |
| Find 5 builders who use coding agents for think aloud tests | 31 Oct | How and what to say: `docs/OUTREACH.md` |
| Lawyer review of Terms and Privacy | Before the first paid user | A law school clinic or startup program can help |
| Record the demo video | 30 Oct | Script: `docs/DEMO_SCRIPT.md` |

## Website plan (M4 first, full film in M5)

- **M4 version:** one page. Hero "Time Machine", the pitch line, the 60 second demo video, the install line, a plain "What it saves / What it does not save" table, a waitlist form, Terms and Privacy links. Static, on Vercel.
- **M5 version:** the 12 beat scroll story from `design/WEBSITE_SPEC.md`, then the fork to `/builders`, `/developers`, `/agents`.
- Every claim on the site matches what is built that day. Planned features carry a "Planned" label.

## Backend (built, M6 opens it)

The CLI and the web app are fully local. The only backend is on the site:

| Piece | Choice | Status |
|---|---|---|
| Waitlist | One Supabase table and one Vercel function (ADR 0006) | Live |
| Payments | Stripe Checkout, one-time $50 (ADR 0013). We never touch card numbers | Built, closed until the keys are set |
| License | A key signed with Ed25519, verified offline by the CLI and the web app, saved once per computer. Restores never check it | Built |
| Data held | Nothing: the key holds an opaque purchase id, the plan and the date. Stripe keeps the payment record | Built |
| Sign in | Supabase Auth email codes through `/api/auth`; `/api/account` lists a buyer's keys from Stripe by email. No password, no table | Built, closed until the keys are set |
| Hosting | Vercel functions: `checkout`, `license`, `auth`, `account`, plus `health` | Built |

## Proposed decisions waiting on the founder

- Refund window: full refund within 14 days of the first payment (written into the Terms draft).
- Telemetry: off by default, opt in only (written into the Privacy draft).
- Disputes: California law, small claims or Contra Costa County courts, no forced arbitration.
