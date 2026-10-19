# Supabase setup for the waitlist

The site saves waitlist signups in one Supabase project. It sends no email. See [Waitlist email](../docs/launch/EMAIL_OPT_IN.md) for why, and what must happen before any email is added.

For click-by-click setup and the combined SQL, see [Supabase setup](../docs/launch/SUPABASE_SETUP.md).

## API behavior

- `POST /api/waitlist` saves a pending, unconfirmed signup. Success is `200 {"ok":true,"pending":true}` for new and existing emails alike. No code, place in line or token is returned. No email is sent.
- `GET /api/waitlist?code=CODE` returns `ok`, `position`, `referrals` and `total` for confirmed, subscribed rows only. Pending, unsubscribed or unknown codes return `404`. Codes are 10 lowercase letters or digits.
- `POST /api/event` counts visits, shares and link copies.
- `GET /api/health` returns `{"ok":true,"waitlist":<bool>,"email":false}`. `waitlist` is true when both Supabase settings are present. `email` is always false.

Only confirmed, subscribed rows count in positions and totals. Only confirmed, subscribed friends earn referral credit. The site does not confirm anyone today. How a signup becomes confirmed is not decided.

## What gets stored

One row per normalized email: email, consent, source page, signup time, the person's own referral code, the code that referred them (if any), and `confirmed_at` and `unsubscribed_at` times (both empty for a site signup). No tokens. Saving again with the same email changes nothing, so an unsubscribed person is never added back.

The `funnel_events` table stores event type, page path, a referral flag and the time. It holds no email or referral code. Neither table stores IP addresses, browser details or cookies. The `funnel_daily` view reports daily visits, raw signups (pending included), confirmations, unsubscribes, shares and copies.

Row level security is on with no policies. The `anon` and `authenticated` roles have no access to the tables, the view or the waitlist functions. Only the service role key can use them. It lives in Vercel and never reaches the browser.

## 1. Apply migrations 0001 + 0002 + 0003

In Supabase **SQL Editor**, paste these files in order and click **Run**:

1. `supabase/migrations/0001_waitlist.sql`
2. `supabase/migrations/0002_referrals_and_funnel.sql`
3. `supabase/migrations/0003_pending_signups.sql`

Or use the single combined block in the click-by-click guide. The files are safe to run twice. `0003` replaces the instant place-in-line signup from `0002` with pending signups. It also removes a never deployed email draft if a local database has it.

With the Supabase CLI: `supabase link --project-ref <your-project-ref>`, then `supabase db push`.

## 2. Add two settings to Vercel

In Supabase **Project Settings**, copy the Project URL and the service role key. In Vercel, open **time-machine-site → Settings → Environment Variables** and add, for **Production** and **Preview**:

| Name | Value |
|---|---|
| `SUPABASE_URL` | Supabase Project URL starting with `https://` |
| `SUPABASE_KEY` | Supabase service role key (secret) |

Never put the secret key in source files, commits, docs or chats. Then tell BOSS or the coding agent: "The Supabase variables are in Vercel. Please redeploy time-machine-site." New variables need a redeploy.

## 3. Check it

`GET /api/health` should return `{"ok":true,"waitlist":true,"email":false}`. This checks that the settings are present and the URL has the right shape. It does not prove the tables exist or the key works. If `waitlist` is false, a setting is missing or the URL does not start with `https://`.

A signup with your own email should appear in **Table Editor → waitlist** with `confirmed_at` empty. The Vercel function log shows only a status code from Supabase, never an email or the key.

## Export the list

**Table Editor → waitlist → Export to CSV**, or in the SQL editor:

```sql
select email, source, created_at, confirmed_at, unsubscribed_at from public.waitlist order by created_at;
```

Every site signup is pending. Do not use this list to send email until the steps in [Waitlist email](../docs/launch/EMAIL_OPT_IN.md) are done.

## Delete someone

If a person asks to be removed:

```sql
delete from public.waitlist where email_normalized = lower(trim('person@example.com'));
```

Replace the synthetic example address only in the SQL editor, never in a committed file.
