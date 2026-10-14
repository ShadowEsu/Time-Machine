# Time Machine build brief

Status: research complete, nothing built yet. Last updated 14 October 2026.

This is the working plan for the product and the website. It condenses the founder's business plan and four research passes (market, sales, design, tooling). It is a plan to test, not a description of anything that exists.

## 1. What we are building

**One line:** Time Machine turns a failed purchase-to-access automation into a sealed, replayable test, so a developer or their coding agent can prove a fix works before it touches a live customer.

**The loop:**

1. A customer pays, but never gets access.
2. `tm capture` records the handler input and every dependency response through explicit adapters, with redaction before anything is written.
3. `tm case create` seals it into an immutable case bundle, with business assertions such as "one paid purchase creates exactly one access grant".
4. `tm replay` runs the original code with the network sealed off. It should FAIL, which proves the bug is reproduced.
5. A human or an agent (Claude Code, Cursor) writes a fix.
6. `tm compare` runs the fix against the same case and the same frozen assertions. It should PASS.
7. The case joins the regression suite and runs in CI forever.

**Verdicts:** `PASS` 0, `FAIL` 1, `INCOMPLETE` 2 (not enough evidence to judge), `BLOCKED` 3 (a safety policy refused it), `ERROR` 4. Showing INCOMPLETE honestly is a feature.

**Positioning to test** (research recommends narrowing the plan's wording):

- Lead with: *incident to regression test for payment webhooks, with agent-verified fixes*.
- What Stripe does not do: its events can only be listed or resent for 30 days (15 in the Dashboard). A case keeps the failure forever.
- A timely wedge: teams migrating from Lemon Squeezy to Stripe Managed Payments (GA April 2026) can replay real past purchases against the new handler before cutover.
- Own these nouns: *the failed purchase, the case, the sealed replay, the verdict, the regression that never comes back*. Avoid generic "replay", "sandbox", and "time travel debugging" claims; Keploy, Speedscale, Tusk, Hookdeck, and RunAgain already use them.

## 2. Product scope: P0 local alpha

Build only the P0 local alpha. Everything runs on the developer's own machine or in CI. No hosted service.

| ID | Requirement |
|---|---|
| F01 | One TypeScript handler boundary, business logic unchanged |
| F02 | Explicit JSON HTTP and tool adapters (request, response, error, call identity) |
| F03 | Capture policy and redaction before persistence |
| F04 | Code and environment provenance (commit, tree digest, lockfile, runtime) |
| F05 | Immutable case bundle with export, import, schema validation, integrity checks |
| F06 | Strict fixture replay, no live network fallback |
| F07 | Local state fixture, fresh per run, shared only within a declared scenario |
| F08 | Business assertions that run independently of the candidate code |
| F09 | Baseline versus candidate comparison |
| F10 | Honest result classification with exit codes |
| F11 | CLI output: human summary, JSON, test runner compatible |
| F12 | Regression suite pinned to a revision |

Acceptance tests T01 to T16 from the business plan gate the alpha: baseline reproduction, candidate repair, wrong fix caught, new dependency call gives INCOMPLETE, duplicate events, state reset, ambiguous timeouts, secret capture, egress bypass gives BLOCKED, resource abuse, invalid bundles, capture outage, build mismatch, assertion tampering, context isolation.

**Out of scope for P0:** dashboard, accounts, billing, team registry, Python, databases beyond a declared state port, concurrency, live recovery, production retries, autonomous patches.

**Early additions the research supports** (decide after the first slice works):

- `tm capture --stripe-event evt_...`: build a case from a Stripe test-mode event pulled through the API.
- A starter library of payment-to-access invariants: duplicate safe, reorder safe, refund revokes, cancel at period end, async payment not fulfilled early.
- A Claude Code `SKILL.md` and, later, an MCP server so agents can run `tm` themselves.

## 3. Engineering plan

**Proposed stack** (confirm each choice in an ADR at kickoff):

- Node 24 LTS (verify the current LTS line at kickoff), TypeScript strict, pnpm workspace.
- Packages: `packages/sdk` (capture adapters, redaction), `packages/runner` (isolated replay, matcher, state, assertions), `packages/cli` (`tm`), `examples/purchase-to-access` (synthetic demo app with fake Stripe and membership endpoints).
- Zod for the case and result schemas. Vitest for tests.
- Egress denial in two layers: an operating system boundary (for example a container with networking disabled in CI) plus in-process interception that throws on any unregistered request. ADR required, and T10 must prove it.
- Local filesystem registry for cases. No database for P0.

**The first ten working days** (from the business plan):

| Day | Work |
|---|---|
| 1 | Pick the demo workflow, write its business assertions |
| 2 | Case schema, supported boundary, threat model |
| 3 to 4 | Sample handler and explicit capture adapters |
| 5 | Seal and inspect a synthetic case, redaction tests |
| 6 to 7 | Replay with network denied and strict fixture matching |
| 8 | Original failure plus a covered candidate repair, same assertions |
| 9 | Missing fixtures, secret capture, state reset, egress bypass tests |
| 10 | Someone else installs the example; record every point of confusion |

**First demo bug:** the membership API acknowledges the access grant, but the handler misreads the success field and leaves local access pending. A parser fix keeps the same outbound requests, so the baseline FAIL and candidate PASS run against identical fixtures. A second demo shows a lowercase-email "fix" returning INCOMPLETE because the new request has no recorded response.

## 4. Website plan

**Goal:** Apple simple, a16z premium, and alive. It should feel like the newest infrastructure company, not a template.

**Stack:**

- Next.js App Router on Vercel. Server-rendered pages; only the story decks run as client components.
- [scroll-beat-kit](https://github.com/buildwithomar/scroll-beat-kit) (MIT) for pinned scroll stories. It is vanilla JS: load it client-only and add a small `destroy()` before using client-side navigation.
- Motion (motion.dev) for small UI motion. CSS scroll-driven animations as progressive enhancement only.
- No smooth-scroll hijacking, no 3D or Spline in the hero. Product visuals are live HTML and SVG, not screenshots or video.

**Type** (free now, upgrade later):

- Inter Display for the wordmark and headlines.
- Inter for body.
- Geist Mono for code and verdict labels.
- SF Pro cannot legally be used on the web.

Wordmark starting spec: `clamp(72px, 17vw, 260px)`, weight about 640, line height 0.9, tracking about -0.05em.

**Brand:** "Monolith". Pure black on white. Color appears only when a verdict appears: PASS green, INCOMPLETE amber, FAIL red. A thin timeline hairline and a playhead are the one motion signature. Never use Apple's clock-with-arrow icon.

**Homepage story** (static hero, then three decks of four beats each):

| Deck | Beats |
|---|---|
| Hero | "Time Machine" huge in black. One line, two buttons: Start replaying, Read the docs. Plus "Copy setup prompt" for agents. |
| 1. The incident | A customer pays. Access never arrives. Then the guessing starts. Rewind. |
| 2. The case | Captured, exactly. Sealed off. Your agent writes the fix. Replay. |
| 3. The verdict | Wrong fix, caught (INCOMPLETE). Right fix, proven (PASS). Never again (regression suite). Give your agent a time machine. |

After the decks come normal sections: supported flows (only real ones), a section for agencies, a short security summary, proof (a founder note until real customers exist), a pricing teaser, FAQ, and a final call to action.

**Pages a top-tier company always has:** Home, Product, How it works, Pricing, Docs (with `llms.txt` and markdown versions), Changelog, Security, Status, Company story, Blog, Brand, Legal, and an `/agents` page with a `SKILL.md` and setup prompt.

**Performance budgets** (mobile p75): LCP under 2.0 s, INP under 150 ms, CLS under 0.05, motion JavaScript under about 60 KB gzip. With reduced motion, every deck renders its end state as a normal page.

## 5. Open decisions before building

1. **The name.** Apple holds "TIME MACHINE" as a trademark for software. Check it with a trademark attorney before spending on a logo, domain, or launch. Until then, treat "Time Machine" as the working name.
2. **Demo payment provider:** Stripe test mode first (recommended), Lemon Squeezy second.
3. **Website or engine first:** the business plan says engine first. A simple landing page with a waitlist can ship alongside it.
4. **Open source license** for the SDK and CLI, decided before outside contributions.

## 6. Tools and connections

- **Ready:** GitHub (this repo), Vercel, Supabase, Figma (direct), and through Composio: Linear, Resend, HubSpot, LinkedIn, Vercel, Supabase.
- **Pending approval:** Composio Stripe (test mode), GitHub, Notion, Figma, PostHog, Sentry.
- **Skills to use when building:** `anthropic-skills:mcp-builder`, `anthropic-skills:skill-creator`, and the webapp-testing pattern for site QA. scroll-beat-kit's own checks (`beat-capture`, `sweep-beats`, `scroll-perf`) run in CI for the site.
