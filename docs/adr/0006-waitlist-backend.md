# ADR 0006: Waitlist backend

Date: 15 October 2026. Status: accepted, pending founder setup. The code is built. It does not save anything until the founder does the three steps below.

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

## What the founder must do

1. **Create a Supabase project** for Time Machine (for example `time-machine`). Keep it separate from Unvibe's.
2. **Create the table.** In the SQL editor, paste all of `supabase/migrations/0001_waitlist.sql` and run it. Or run `supabase db push` after `supabase link`. The file is safe to run twice.
3. **Add two settings in Vercel** for the project `time-machine-site`, under Settings, then Environment Variables: `SUPABASE_URL` (the Project URL) and `SUPABASE_KEY` (the secret key). Then redeploy.

Check it: `/api/health` should return `{"ok":true,"waitlist":true}`. Then sign up with your own email and look for the row in Table Editor. Full steps are in `supabase/README.md`.

## Deleting data

- **One person:** run `delete from public.waitlist where email_normalized = lower(trim('person@example.com'));` in the SQL editor.
- **Everyone:** run `truncate public.waitlist;`, or delete the Supabase project.
- **Stop collecting:** remove the two Vercel settings and redeploy. The form goes back to asking people to email the founder.

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

Export the table to CSV from Table Editor, or run `select email, source, created_at from public.waitlist order by created_at;`. Any Postgres or email tool can take that file. The function makes one REST insert, so moving to another store means changing one URL and one header.

## Addendum, 18 October 2026

- Signups are saved as **pending and unconfirmed** (`waitlist_join_pending`). The answer is the same for new and existing emails. Unsubscribed rows are never reactivated by a new signup.
- **The site sends no email.** Founder decision: his existing email agents handle outreach. A confirmation or welcome flow needs his explicit approval of that exact flow first.
- Places in line, totals and referral credit count only rows with `confirmed_at` set and `unsubscribed_at` empty. Nothing on the site confirms a row today, so nobody sees a place yet.
- Also stored: a referral code per row, the code that brought the person (if any), and anonymous daily visit counts in `funnel_events`. Migrations 0002 and 0003; combined SQL in `docs/launch/SUPABASE_SETUP.md`.
