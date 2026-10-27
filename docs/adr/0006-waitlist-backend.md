# ADR 0006: Waitlist backend

Date: 15 October 2026. Status: accepted, pending owner setup. The code is built. It does not save anything until the owner does the three steps below.

## Decision

- **One Supabase table** called `waitlist`, created by `supabase/migrations/0001_waitlist.sql`.
- **One Vercel function**, `POST /api/waitlist` in `site/api/`, is the only writer. `GET /api/health` says whether the waitlist is set up and never shows a key.
- **What is stored:** the email, the consent tick (must be true), the page the person signed up from, and the time. Nothing else. No IP address, no browser details, no cookies.
- **Who can read it:** row level security is on with no policies. The `anon` and `authenticated` roles have no access. Only the service role key can insert or read.
- **Where the key lives:** `SUPABASE_KEY` is set only in the Vercel project's environment variables. It is never in the site files, a commit, a log or the browser.
- **Duplicates:** the email is stored lower case and trimmed, with a unique index. Signing up twice is a quiet success and stores one row.
- **Logs:** the function logs only an upstream status code or error name. It never logs or echoes the email.
- **No fake success:** without both settings, the function answers 503 and the form asks people to email preston@unvibe.site. It never says "You're on the list" unless Supabase accepted the row.
- **Other guards:** same origin requests only, a 2 KB body limit, an 8 second upstream timeout, and a hidden honeypot field for bots.

## What the owner must do

1. **Create a Supabase project** for Time Machine (for example `time-machine`). Keep it separate from Unvibe's.
2. **Create the table.** In the SQL editor, paste all of `supabase/migrations/0001_waitlist.sql` and run it. Or run `supabase db push` after `supabase link`. The file is safe to run twice.
3. **Add two settings in Vercel** for the project `time-machine-site`, under Settings, then Environment Variables: `SUPABASE_URL` (the Project URL) and `SUPABASE_KEY` (the secret key). Then redeploy.

Check it: `/api/health` should return `{"ok":true,"waitlist":true,"database":"reachable","email":false}` (see the 19 October addendum). Then sign up with your own email and look for the row in `tm_waitlist.waitlist`. Full steps are in `supabase/README.md`.

## Deleting data

- **One person:** run `delete from tm_waitlist.waitlist where email_normalized = lower(trim('person@example.com'));` in the SQL editor.
- **Everyone:** run `truncate tm_waitlist.waitlist;`. Do not delete the Supabase project: it is the shared `jaymini-prod` project (see the 18 October addendum).
- **Stop collecting:** remove the two Vercel settings and redeploy. The form goes back to asking people to email the team.

The Privacy draft (`docs/legal/PRIVACY.md`) keeps waitlist emails until the person unsubscribes, or until 6 months after launch if they do not sign up.

## Alternatives

- **A hosted form (Tally, Formspree).** Fastest, but a third party holds the list, adds its own scripts and branding, and breaks our self only Content Security Policy. Rejected.
- **An email tool (Buttondown, ConvertKit).** Good for sending later. More data and tracking than we need today. Can be added later by exporting the table.
- **Vercel KV or Blob.** No real unique constraint and no SQL for export or delete. Rejected.
- **No backend, mailto link only.** Honest, but people drop off. Kept as the fallback when the settings are missing.

## Cost

- Free on the Supabase and Vercel free tiers at our size.
- Free Supabase projects can pause after a period with no activity. Check the project is awake before any launch or post.
- One more service holds personal data, so the Privacy draft must name Supabase and Vercel as processors before the form goes live.

## Migration path

Export the table to CSV from Table Editor, or run `select email, source, created_at from tm_waitlist.waitlist order by created_at;`. Any Postgres or email tool can take that file. The function makes one REST call, so moving to another store means changing one URL and one header.

## Addendum, 18 October 2026

- Signups are saved as **pending and unconfirmed** (`waitlist_join_pending`). The answer is the same for new and existing emails. Unsubscribed rows are never reactivated by a new signup.
- **The site sends no email.** Team decision: our existing email agents handle outreach. A confirmation or welcome flow needs the team's explicit approval of that exact flow first.
- Places in line, totals and referral credit count only rows with `confirmed_at` set and `unsubscribed_at` empty. Nothing on the site confirms a row today, so nobody sees a place yet.
- Also stored: a referral code per row, the code that brought the person (if any), and anonymous daily visit counts in `funnel_events`. Migrations 0002 and 0003; combined SQL in `docs/launch/SUPABASE_SETUP.md`.
- **Shared project, separate schema (team decision, 18 Oct).** The free Supabase organization was at its 2-project limit, so the waitlist lives in `jaymini-prod`, schema `tm_waitlist`. The site holds the anon key (`SUPABASE_KEY`), which can call only `waitlist_join_pending`, `waitlist_status` and `funnel_event_add` (security definer, empty search path) and cannot read any table. Cost: Time Machine depends on Jaymini's project staying active, and both share its limits. Migration path: run the same four migrations in a dedicated project, export `tm_waitlist.waitlist`, change two Vercel settings.

## Addendum, 19 October 2026

- `/api/health` used to say `waitlist: true` whenever both settings were present, even if the key was wrong or the project was paused. It now also reports `database`: `reachable` only after a read-only `waitlist_status` call with a code that matches nobody succeeds, else `unreachable` or `not_configured`. Normal page loads share a 30-second Vercel CDN answer instead of each probing the database. The forms show a "may not save right now" line when `database` is `unreachable`; a real signup answer still replaces it.
- Built today: pending signups only. A signup gets no code back, so the site has no share link, place in line or referral credit yet. `waitlist_status` and the stored referral columns wait for a confirmation flow that is not decided.
- Migration `0005_bounded_public_rpcs.sql` bounds the public writers inside the database: 60 signup calls/minute, 1,000/hour and 300 events/minute, with serialized indexed counts and HTTP 429 at capacity. Signup calls are counted as bare timestamps, so a duplicate email costs the same slot as a new one and the cap is no membership test. The site keeps the email and shows a retry message. Direct RPC event callers get the same strict type/path checks as the API, and each accepted event removes at most 500 event rows older than 90 days. No new service or IP tracking. Rollback SQL is in `supabase/README.md`.
