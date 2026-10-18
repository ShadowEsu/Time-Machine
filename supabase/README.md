# Supabase and email setup for the waitlist

The double opt-in flow is built. Provider setup and delivery are not verified. Preston must configure Supabase, Resend, DNS and Vercel before the form can send mail.

For click-by-click setup and the combined SQL, see [Supabase setup](../docs/launch/SUPABASE_SETUP.md). For Resend and email behavior, see [Waitlist emails](../docs/launch/EMAIL_OPT_IN.md).

## API behavior

- `POST /api/waitlist` saves a pending signup and sends a confirmation email. Success is `200 {"ok":true,"pending":true}`. It returns no code or referral card before confirmation.
- `GET /api/confirm` consumes a valid confirmation token once, confirms the row and sends a welcome email. It redirects to `/confirmed.html?code=CODE`, or `/confirmed.html?error=invalid` for an invalid, used or expired link.
- `GET /api/waitlist?code=CODE` returns `ok`, `position`, `referrals` and `total` for confirmed, subscribed rows only. Pending or unsubscribed rows return `404`. Codes are 10 lowercase letters or digits.
- `GET /api/unsubscribe` only shows a confirmation page. `POST /api/unsubscribe` stops the subscription. Signup does not silently reactivate an unsubscribed row.
- `POST /api/event` still counts visits, shares and link copies.

Only confirmed, subscribed rows count in positions and totals. Only confirmed, subscribed friends earn referral credit. Automatic emails are confirmation and welcome only.

## What gets stored

One row per normalized email: email, consent, source, signup time, referral codes, confirmation and unsubscribe state, send timing, and SHA-256 token hashes. Raw tokens are not stored. Confirmation tokens expire after 7 days and can be used once. Confirmation resends have a 10-minute cooldown. Unsubscribe tokens do not expire and remain reusable until replaced at confirmation.

The `funnel_events` table stores event type, page path, referral flag and time. It holds no email or referral code. Neither table stores IP addresses, browser details or cookies. The `funnel_daily` view reports daily funnel counts, raw signups, confirmations and unsubscribes. Raw signups are not the confirmed subscriber total.

Row level security is on with no public policies. The `anon` and `authenticated` roles have no access to the tables, view or waitlist functions. Only the server's service role key can use them. It never reaches the browser.

## 1. Apply migrations 0001 + 0002 + 0003

In Supabase **SQL Editor**, paste these files in order and click **Run**:

1. `supabase/migrations/0001_waitlist.sql`
2. `supabase/migrations/0002_referrals_and_funnel.sql`
3. `supabase/migrations/0003_double_opt_in.sql`

Or use the single combined block in the click-by-click guide. The scripts support reruns. `0003` replaces the old signup and ranking behavior with double opt-in.

With the Supabase CLI, link the project with `supabase link --project-ref <your-project-ref>`, then run `supabase db push` to apply migrations.

## 2. Configure Resend and Vercel

Create a free Resend account. In **Domains**, add or open `unvibe.site`. At your DNS provider, add the exact record types, names and values Resend shows. Wait for Resend to mark the sending domain verified. Do not invent DNS values or remove unrelated records.

In Resend **API Keys**, create a sending key for the domain. In Supabase **Project Settings**, copy the Project URL and service role key. In Vercel, open **time-machine-site → Settings → Environment Variables** and add:

| Name | Status | Value |
|---|---|---|
| `SUPABASE_URL` | Required | Supabase Project URL starting with `https://` |
| `SUPABASE_SERVICE_ROLE_KEY` | Required, secret | Supabase service role key |
| `RESEND_API_KEY` | Required, secret | Resend sending key |
| `WAITLIST_FROM` | Optional, default | `Time Machine <timemachine@unvibe.site>` |
| `SITE_URL` | Optional, default | `https://time-machine-site.vercel.app` |

Save for **Production** and **Preview**. Mark secrets **Sensitive** if available. Never put secret values in source files, commits, docs or chats. The sender must use your verified domain. Set `SITE_URL` explicitly if email links should use another public site address.

Tell BOSS or the coding agent: "Supabase, Resend and DNS are configured. Please redeploy time-machine-site." New variables require a redeploy.

## 3. Understand readiness and failures

`GET /api/health` should return `{"ok":true,"waitlist":true,"email":true}` after configuration. This checks configuration presence and the Supabase URL shape only. It does not prove migrations are applied, credentials work or messages arrive.

- `waitlist:false`: check the Supabase variables and URL.
- `email:false` or signup `503`: check `RESEND_API_KEY` and required configuration.
- Signup `502` after a Resend failure: the pending row is retained. The 10-minute resend cooldown still applies.
- Welcome send failure: the row stays confirmed and the token stays consumed. There is no automatic welcome retry.

Use synthetic data for local checks. Real signup or delivery tests need separate founder approval.

## Export confirmed subscribers

In **Table Editor → waitlist**, filter `confirmed_at` to not null and `unsubscribed_at` to null before exporting. Do not use pending or unsubscribed rows for a mailing list. Exporting does not send email.

## Delete someone

Unsubscribe links stop mail without deleting the row. If someone asks for deletion, use **Table Editor → waitlist**, find the requested email and delete that row. Never paste real addresses into committed examples.
