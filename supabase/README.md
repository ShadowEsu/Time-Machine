# Supabase setup for the waitlist

The site has one form that saves emails: the waitlist. It posts to `/api/waitlist`, a small Vercel function in `site/api/`. `GET /api/waitlist?code=` looks up a person's place in the list. `POST /api/event` counts page visits, shares and link copies. These functions are the only things in the site that use Supabase.

For a click-by-click guide with the full SQL in one block, see `docs/launch/SUPABASE_SETUP.md`.

Until the two settings below are in Vercel, the form says the waitlist isn't open yet and asks people to email the founder. It never pretends to save.

## What gets stored

One row per person: the email, the consent tick (always true), the page they signed up from, the time, their own referral code, and the referral code that brought them (if any). No IP address. No browser details. Repeat signups with the same email are ignored, so each person is stored once.

The `funnel_events` table holds one row per visit, share or link copy: the event type, the page path, whether the visit came through a referral link, and the time. No email, no code, no IP address, no browser details. The `funnel_daily` view adds these up per day, next to signups.

Nobody can read or write the tables, the view or the functions with the public key. Row level security is on with no policies, and the `anon` and `authenticated` roles have no access. Only the service role key can use them. That key lives in Vercel and never reaches the browser.

## 1. Create the tables

Pick one way.

**SQL editor (easiest)**

1. Open your Supabase project, or create one called `time-machine`.
2. Go to SQL Editor and start a new query.
3. Paste all of `supabase/migrations/0001_waitlist.sql`, then all of `supabase/migrations/0002_referrals_and_funnel.sql`, and press Run.
4. Go to Table Editor. You should see `waitlist` and `funnel_events` tables with no rows.

**Supabase CLI**

1. Install the CLI and run `supabase login`.
2. From the repo root, run `supabase link --project-ref <your-project-ref>`.
3. Run `supabase db push`. It applies everything in `supabase/migrations/`.

The files are safe to run twice.

## 2. Add two settings to Vercel

In Supabase, open Project Settings, then API Keys (or API on older projects). Copy:

- the Project URL, like `https://abcdefgh.supabase.co`
- the secret key: the `service_role` key, or a new `sb_secret_...` key

In Vercel, open the site project, then Settings, then Environment Variables. Add:

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | the Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | the secret key |

Then redeploy so the function picks them up.

Never put the secret key in the site files, a commit, or a chat. It can read and change every table.

## 3. Check it works

1. Open `https://<your-site>/api/health`. It should say `{"ok":true,"waitlist":true}`. It never shows the key.
2. Sign up on the live site with your own email.
3. In Supabase, open Table Editor, then `waitlist`. Your row should be there.

If step 1 says `"waitlist":false`, a setting is missing or the URL is not a full `https://` address. If step 2 shows "We couldn't save that just now", the table is missing or the key is wrong. The Vercel function log shows only the status code from Supabase, never the email.

## Export the list

Table Editor, then `waitlist`, then Export to CSV. Or in the SQL editor:

```sql
select email, source, created_at from public.waitlist order by created_at;
```

## Delete someone

If a person asks to be removed:

```sql
delete from public.waitlist where email_normalized = lower(trim('person@example.com'));
```
