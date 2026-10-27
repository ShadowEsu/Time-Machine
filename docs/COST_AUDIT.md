# Time Machine cost audit

Read-only audit, 2026-10-19 20:40 to 21:05 UTC. Nothing was changed: no billing, plan, cap, setting or data writes, no test purchases, and no model calls made just to measure. Every number below was read live from a provider API at the time shown. "Not measured" means the surface was unavailable. It does not mean $0.

## Summary

- **No measured charge anywhere.** No provider surface we could reach showed an invoice or a usage charge. Vercel says `costs_not_found`, the Gemini project has billing turned off, and GitHub Actions billable time is 0 ms. Dollar spend for Supabase and GitHub could not be read (see "Not measured").
- **All hosting is shared and on free tiers.** Vercel `shadowesus-projects` is on the Hobby plan and is shared with Unvibe, Jaymini and other projects. Supabase `jaymini-prod` is in a Free org and is shared with Jaymini production. Time Machine's own share is small: about 2.5% of team requests this month (since the project appeared on 2026-10-18).
- **Main cost risk is abuse, not current traffic.** At audit time `/api/event` and `/api/waitlist` had no rate limit and no Vercel Firewall config. Migration `0005` is now applied live and the API deployed: global database write caps return `429 rate_limited` rather than inserting when full. These caps limit writes, not function invocations or read requests. See "Code paths that can cost money".

## Measured usage

| Surface | Scope | Period | Measured value | Source |
|---|---|---|---|---|
| Vercel plan | Team `shadowesus-projects` (`team_Q6QN…`) | now | `plan: hobby`, `planIteration: legacy`, billing `status: active`, `spendManagement: null`, `softBlock: null` | `GET /v2/teams/{team}` |
| Vercel charges | Team | 2026-10-01 to now | `404 costs_not_found` | `GET /v1/billing/charges?from&to` |
| Vercel requests | Team (all projects) | 2026-10-01 to 2026-10-19 (data lastUpdate 20:41:46Z) | 60,700 (34,415 cache hit + 26,285 miss) | `GET /v2/usage?type=requests` |
| Vercel outbound bandwidth | Team | same | 7.95 GB out (7,954,006,230 B), 86.3 MB in | same |
| Vercel functions | Team | same | 10,151 ok, 84 error, 0 throttled, 0 timeout, 2.915 GB-h | same |
| Vercel requests | **time-machine-site** (`prj_AetD…`) | 2026-10-15 to 2026-10-19 | about 1,538 (lower bound) to 1,711 (upper bound) | same, daily per-project `breakdown` percent × team total |
| Vercel bandwidth | **time-machine-site** | same | about 40.8 to 45.0 MB out | same |
| Vercel functions | **time-machine-site** | same | about 261 to 266 ok, about 9 error, 0.008 to 0.015 GB-h | same |
| Vercel builds | Team / **time-machine-site** | 30 days to 2026-10-19 | team: 391 builds, 19,087 build-s. TM: about 49 build-s. 9 production deploys, all READY | `GET /v2/usage?type=builds`, `GET /v6/deployments?projectId` |
| Vercel Blob | Team (store `unvibe-waitlist`, not TM) | now | feature **blocked** from 2026-09-28T16:31Z to 2026-10-28T16:31Z (`isCurrentlyBlocked: true`), 2,991 B stored | `GET /v2/teams` `featureBlocks`, `GET /v2/usage?type=storage_blob` |
| Vercel firewall / domains | **time-machine-site** | now | firewall `404 Config not found`, `attackModeEnabled: null`. Only domain: `time-machine-site.vercel.app`. Team-owned domains (`unvibe.live`, `unvibe.site`) are not TM's | `GET /v1/security/firewall/config/active`, `GET /v9/projects/{id}/domains` |
| Supabase plan | Org `ShadowEsu's Org` (`nmuyvgwvznrnqtevftff`) | now | `plan: free`. Project `jaymini-prod` us-west-1 `ACTIVE_HEALTHY`, `selected_addons: []` | `GET /v1/organizations/{org}`, `/v1/projects/{ref}/billing/addons` |
| Supabase DB size | `jaymini-prod`, whole DB (shared) | 2026-10-19 20:48:11Z | 11,581,107 B (11.6 MB). Storage objects: 0 | `POST /v1/projects/{ref}/database/query/read-only` |
| Supabase DB size | **`tm_waitlist` schema** | same | 196,608 B. `waitlist`: 0 live rows (1 insert ever). `funnel_events`: 17 rows, all `visit`, all on 2026-10-19 | same (`pg_stat_user_tables`) |
| Supabase REST requests | `jaymini-prod`, all schemas | 2026-10-12 to 2026-10-19, daily | 1, 48, 22, 21, 35, 25, 24, 50 (226 total). Auth, storage and realtime: 0 | `GET /v1/projects/{ref}/analytics/endpoints/usage.api-counts?interval=7day` |
| Supabase REST requests | **TM RPCs** | 2026-10-18 20:40Z to 2026-10-19 20:40Z | out of 52 REST calls: 17 `funnel_event_add`, 1 `waitlist_join_pending`, 2 `waitlist_status` | `GET /v1/projects/{ref}/analytics/endpoints/logs?sql=` (table `logs`) |
| Gemini (Ask, opt-in) | GCP project `gen-lang-client-0763360198` (#1011998020612), which owns the key in `gemini-app.env`. The same key is in `apps/desktop/.env` and is shared with the owner's other apps | now | `billingEnabled: false`, `billingAccountName: ""`. Key restricted to `generativelanguage.googleapis.com` | `apikeys v2 keys:lookupKey`, `cloudbilling v1 projects/{n}/billingInfo` |
| Gemini requests | Same project (all apps sharing the key) | 30 days to 2026-10-19T20:59Z | `CreateInteraction` (the Ask endpoint): 3 × 2xx, 3 × 4xx. `StreamGenerateContent` (not used by TM): 35 × 2xx, 45 × 4xx, 9 × 5xx. Daily total: 66 on 10-17, 29 on 10-18, 0 on other days | Cloud Monitoring `serviceruntime.googleapis.com/api/request_count` |
| GitHub Actions | Repo `ShadowEsu/Time-Machine` (public, created 2026-10-14) | 2026-10-15 to 2026-10-19 | 67 runs, 134.7 min run time, **billable_ms 0** on every run (macOS + Ubuntu) | `gh api repos/…/actions/runs/{id}/timing` |
| npm | `timetm` | now | not published (registry 404) | `npm view timetm` |
| Email / domains / Apple | TM | now | The site sends no email, and no email provider is in the code. No domain was bought for TM. Apple signing is not set up (D08, blocked). No provider surface exists to read | code and docs inspection |

**How TM's share was attributed.** Vercel reports only a team total per day, plus a breakdown in whole percent for the top projects. TM's lower bound is its own percent × the team total. Its upper bound also adds the "Other" bucket on days when TM was not listed. TM is listed only on 10-18 (requests 10%, functions 13%) and 10-19 (requests 25%, functions 29%). The per-project values are therefore estimates, not provider line items.

## Not measured (exact gaps)

| Field | What was tried | Result | Who can close it |
|---|---|---|---|
| Vercel itemized usage and costs | `GET /v1/usage` | `plan_upgrade_required` (Pro/Enterprise only) | Dashboard https://vercel.com/shadowesus-projects/~/usage (the owner's login) |
| Supabase org usage, egress, spend cap | `/v1/organizations/{org}/usage`, `/billing` (`Cannot GET`), `/platform/organizations/{org}/usage` and `/platform/projects/{ref}/daily-stats` | `401 Unsupported access token` (a PAT cannot reach these) | Dashboard https://supabase.com/dashboard/org/nmuyvgwvznrnqtevftff/usage |
| GitHub account billing | `gh api /users/ShadowEsu/settings/billing/usage` and `/actions` | needs the `user` scope. The token has `gist, read:org, repo, workflow` | The owner: `gh auth refresh -h github.com -s user`, or https://github.com/settings/billing |
| Gemini token counts | No inference was issued, by design. Monitoring gives request counts only | not available | AI Studio usage page for project `gen-lang-client-0763360198` |
| Apple Developer Program | No account surface was available | unknown | The owner |

Composio (live): the Vercel connection is `ACTIVE`, and `VERCEL_GET_TEAMS` now returns `shadowesus-projects`. HANDOFF §3 used to record a 403 here; it has been updated. All Composio Supabase and Stripe connections are `EXPIRED`. Usage data in this report came from the Vercel CLI login token and the Supabase PAT, both read-only.

## Code paths that can cost money

- **Site functions** (`site/api/waitlist.js`, `event.js`, `health.js`; fluid compute, `iad1`, project default timeout 300 s). Existing protections:
  - same-origin `Origin` check on POST
  - 2 KB and 1 KB body caps
  - strict email, path and code regexes
  - honeypot field
  - upstream timeouts of 8 s and 3 s, so a call cannot hang until the 300 s limit
  - the anon key can call only three `security definer` functions
  - client `visit` events are sent once per path per session and are skipped under GPC/DNT

  The `Origin` header can be forged by any non-browser client. Migration `0005`, applied live on 19 Oct, caps all callers together, including direct PostgREST calls with the public anon key: 60 accepted signup calls per minute, 1000 per hour, and 300 event rows per minute. Every accepted signup records a bare timestamp, including duplicates, so list membership cannot be inferred by quota use. Migration `0006` adds per-client buckets: signup 5/minute and 20/hour, status 30/minute, event 60/minute. The API sends an HMAC code, never the raw IP. Direct PostgREST callers can omit or spoof that code and remain bounded only by the global write caps. Apply/deploy evidence is tracked below.
- **Amplification:** scripted POSTs still invoke a function on every request. Migration `0005` bounds database writes and removes up to 500 event rows older than 90 days per accepted event call, plus up to 500 signup-attempt timestamps older than an hour per accepted signup call. It sets no total row cap, and pending waitlist rows never expire. A fill attack can consume the database space shared with Jaymini, though more slowly under the caps. `GET /api/waitlist?code=` has no Origin check, by design, and runs `waitlist_status`, which scans confirmed rows. Read-request cost grows with traffic and list size.
- **Mac app Ask:**
  - off by default (`features: { ask: false }` in `engine.ts:94`) and turned on per project after a consent card
  - uses the user's own key from env or Keychain
  - model `gemini-3.5-flash-lite` via `/v1beta/interactions`, 30 s timeout, at most 50 save points per request
  - the packaged app reads only `process.env` and Keychain. A scan of `release/Time Machine.app` found 0 files containing the key
- **Mac app Vercel chips:** GET only, against 3 allow-listed paths on the user's own token. Vercel does not bill API reads [INFERENCE, not measured].
- **CLI and core:** no network calls to paid services were found.

## Risks and actions (no billing changes made)

1. **Shared Hobby limits (team-wide).** The team already has a Blob block until 2026-10-28 (Unvibe store). A spike in any project counts against the same allowance that TM uses. Action: watch https://vercel.com/shadowesus-projects/~/usage. Whether to move off Hobby is the owner's call. Vercel's terms limit Hobby to non-commercial use [INFERENCE from Vercel docs; check before launch].
2. **Public request abuse.** `0005` and its API mapping are live. `0006` and per-client API buckets are implemented and locally verified, pending live apply and deployment. They limit accepted RPC work, not Vercel function invocations or invalid payloads rejected before Supabase. Still open: platform-level request limits if the plan supports them, and retention for stale pending signups.
3. **Shared database.** TM writes go into Jaymini's production DB on a Free org. Data is isolated by schema, but capacity and egress are shared. Egress could not be measured.
4. **Gemini.** No billing account is linked, so the key runs on the free tier. Free-tier data-use terms apply, and the consent text already says so. Rotating the previously leaked Google key is still the owner's task (brief).
5. **Supabase org owner has `mfa_enabled: false`.** This is an account-safety risk for billing control.

## Needs the owner's approval

- Any Vercel or Supabase plan change, spend cap or spend management setting.
- Linking billing to the Gemini project, and rotating the key.
- The Apple Developer Program fee (D08), any domain purchase, and npm publish.
- Granting the `gh` `user` scope or dashboard access so the unmeasured fields above can be read.
