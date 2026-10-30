# Supabase setup for the waitlist

The site saves waitlist signups in one Supabase project. It sends no email. See [Waitlist email](../docs/launch/EMAIL_OPT_IN.md) for why, and what must happen before any email is added.

For click-by-click setup and the combined SQL, see [Supabase setup](../docs/launch/SUPABASE_SETUP.md).

## API behavior

- `POST /api/waitlist` saves a pending, unconfirmed signup. Success is `200 {"ok":true,"pending":true}` for new and existing emails alike. No code, place in line or token is returned. No email is sent.
- `GET /api/waitlist?code=CODE` returns `ok`, `position`, `referrals` and `total` for confirmed, subscribed rows only. Pending, unsubscribed or unknown codes return `404`. Codes are 10 lowercase letters or digits. The site has no page that shows a code or a place in line yet, because signups stay pending.
- `POST /api/event` counts visits, shares and link copies. The site sends only visits today; it has no share or copy button yet.
- `POST /api/feedback` saves one set of survey answers from the web app, sent only after the person pressed Send (`apps/web/src/shared/pmf.ts`): `q1` to `q4`, `appVersion` and `installId` (the random survey ID), nothing else. Success is `200 {"ok":true}`; nothing stored is echoed. `409 {"ok":false,"error":"already_answered"}` when the same survey ID answered in the last 90 days. Any other key, a `q1` outside `very`, `somewhat`, `not`, `na`, an answer over 2,000 characters, an ID that is not a version 4 UUID or a malformed app version is `400 bad_request`, before the database. Bodies over 20 KB are `413`. The API also keeps an in-memory limit of 10 calls an hour per client per function instance. Answers are never logged.
- `GET /api/health` returns `{"ok":true,"waitlist":<bool>,"database":"reachable"|"unreachable"|"not_configured","email":false}`. `waitlist` is true when both Supabase settings are present. `database` is `reachable` only when a read-only `waitlist_status` call with a code that matches nobody just worked. Vercel's CDN keeps each answer for 30 seconds. `email` is always false.
- When a database cap is full, the endpoint returns `429 {"ok":false,"error":"rate_limited"}` with `Retry-After: 60`. Per client: signup 5/minute and 20/hour, status lookup 30/minute, event 60/minute, feedback 3/minute and 10/hour. The form keeps the typed email. Signup caps count calls, not saved rows: duplicate and new emails each use a slot.

Only confirmed, subscribed rows count in positions and totals. Only confirmed, subscribed friends earn referral credit. Order: more confirmed friends first, then earlier signup time. The site does not confirm anyone today, and a signup gets no code back, so referral credit and places in line are planned, not live. How a signup becomes confirmed is not decided.

## What gets stored

One row per normalized email: email, consent, `consent_text_version` (which words by the box the person ticked, for example `waitlist-2026-10-28`; `unrecorded` for rows saved before `0007`), source page, signup time, the person's own referral code, the code that referred them (if any), and `confirmed_at` and `unsubscribed_at` times (both empty for a site signup). The separate, optional box "Email me to ask for feedback." adds `feedback_consent` (true only when ticked), `feedback_consent_text_version` (for example `feedback-2026-10-30`) and `feedback_consent_at`; unticked, the two are empty and `feedback_consent` is false. No tokens. Saving again with the same email changes nothing, the feedback box included, so an unsubscribed person is never added back and nobody can rewrite what someone else agreed to.

`feedback_answers` (`0008`) stores one row per Send: the four answers (`q1` is one of `very`, `somewhat`, `not`, `na`; `q2` to `q4` at most 2,000 characters each, empty when skipped), the app version, the random survey ID and the time. No email, IP address, client code or usage counts. The survey ID is stored as sent because the privacy policy names it and people quote it to have their answers deleted: `delete from tm_waitlist.feedback_answers where install_id = '<survey ID>';`. One answer per survey ID in any 90 days. Retention is 365 days: the daily pg_cron job `tm-feedback-retention` (03:17 UTC) deletes older rows, and each feedback call also removes up to 500 of them.

The `funnel_events` table stores event type, page path, a referral flag and the time. It holds no email or referral code. Neither table stores IP addresses, browser details or cookies. The `funnel_daily` view reports daily visits, raw signups (pending included), confirmations, unsubscribes, shares and copies.

`client_calls` stores a 22-character HMAC code derived from the client IP, the endpoint bucket and the time. The API uses Vercel's overwritten `x-forwarded-for` header, falling back to `x-real-ip`; the raw IP never goes to Supabase. The server-side `SUPABASE_KEY` keys the HMAC. Only the last hour counts. Later accepted keyed calls, signups and events remove up to 500 older rows at a time. This is opportunistic cleanup, not a scheduled deletion deadline. Unkeyed health lookups stay read-only.

Row level security is on with no policies. The `anon` and `authenticated` roles cannot read or write the tables or the view. `anon` can run four security definer functions and nothing else: `waitlist_join_pending`, `waitlist_status` and `funnel_event_add` (see `0004_api_access.sql`), and `feedback_add` (see `0008_feedback.sql`, granted to `anon` only). The site calls them with the project's anon key, kept in Vercel as `SUPABASE_KEY`. The anon key is public by design, so anyone holding it can call these functions directly. Migration `0005` enforces write caps, event types and strict plain paths inside the database, not just the site API; `0008` enforces the answer rules, its own global cap of 60 a minute and the 90-day rule the same way.

## 1. Apply migrations 0001 to 0008

In Supabase **SQL Editor**, paste these files in order and click **Run**:

1. `supabase/migrations/0001_waitlist.sql`
2. `supabase/migrations/0002_referrals_and_funnel.sql`
3. `supabase/migrations/0003_pending_signups.sql`
4. `supabase/migrations/0004_api_access.sql`
5. `supabase/migrations/0005_bounded_public_rpcs.sql`
6. `supabase/migrations/0006_per_client_limits.sql`
7. `supabase/migrations/0007_consent_text_version.sql`
8. `supabase/migrations/0008_feedback.sql`

The combined block in the click-by-click guide covers `0001` through `0004`; then apply `0005` and `0006` separately, in that order. Apply `0006` before deploying the API that sends `p_client`. Its optional trailing parameter keeps the previous API working during deployment. `0006` is safe to reapply. Do not rerun older migrations after `0006`: they would recreate obsolete RPC signatures.

`0007` adds `consent_text_version` and makes `waitlist_join_pending` require `p_consent_version`. It drops the `0006` signature, so signups through the `0006` API fail until the API that sends the version is live: apply `0007` right before that deploy. `0007` is safe to reapply. To roll it back, redeploy the previous API, then run this and rerun `0006`; the column and its values stay:

```sql
drop function if exists tm_waitlist.waitlist_join_pending(text, text, text, text, text);
alter table tm_waitlist.waitlist alter column consent_text_version drop not null;
```

`0008` adds `feedback_answers`, `feedback_add`, a `feedback` bucket in `client_calls`, the waitlist's three feedback consent columns and the daily retention job, and gives `waitlist_join_pending` an optional trailing `p_feedback_version`. **Enable pg_cron first** (Database → Extensions → pg_cron): without it `0008` stops with "Enable the pg_cron extension" and changes nothing. The `0007` API keeps working after it (a call without the new parameter records no feedback consent), so apply `0008` before deploying the API that calls `/rest/v1/rpc/feedback_add` or sends `p_feedback_version`. `0008` is safe to reapply; it keeps one retention job. After applying, check `select has_table_privilege('anon', 'tm_waitlist.feedback_answers', 'select,insert,update,delete');` is false, and `select jobname, schedule from cron.job;` lists `tm-feedback-retention`. To roll it back, redeploy the previous API, then run this and rerun `0007`; the table, the columns and their values stay:

```sql
drop function if exists tm_waitlist.feedback_add(uuid, text, text, text, text, text, text);
drop function if exists tm_waitlist.waitlist_join_pending(text, text, text, text, text, text);
```

Keep the retention job unless the table is emptied: `select cron.unschedule('tm-feedback-retention');` stops it.

With the Supabase CLI: `supabase link --project-ref <your-project-ref>`, then `supabase db push`.

## 2. Add two settings to Vercel

In Supabase **Project Settings → API Keys**, copy the Project URL and the `anon` key. In Vercel, open **time-machine-site → Settings → Environment Variables** and add, for **Production** and **Preview**:

| Name | Value |
|---|---|
| `SUPABASE_URL` | Supabase Project URL starting with `https://` |
| `SUPABASE_KEY` | Supabase `anon` key |

Never paste the service role key here, and never put any key in source files, commits, docs or chats. Then tell BOSS or the coding agent: "The Supabase variables are in Vercel. Please redeploy time-machine-site." New variables need a redeploy.

## 3. Check it

`GET /api/health` should return `{"ok":true,"waitlist":true,"database":"reachable","email":false}`. `database: "reachable"` proves the URL, the key, the `tm_waitlist` profile and the `waitlist_status` grant work. It does not prove `waitlist_join_pending` or `funnel_event_add`; a test signup does. If `waitlist` is false, a setting is missing or the URL is not an http(s) URL. If `database` is `unreachable`, the function log says `health: upstream returned status <code>` or `health: upstream request failed (<error name>)`; a paused free project is the usual cause.

A signup with your own email should appear in `tm_waitlist.waitlist` with `confirmed_at` empty. The Vercel function log shows only a status code from Supabase, never an email or the key.

## Export the list

**Table Editor → tm_waitlist → waitlist → Export to CSV**, or in the SQL editor:

```sql
select email, source, created_at, confirmed_at, unsubscribed_at from tm_waitlist.waitlist order by created_at;
```

Every site signup is pending. Do not use this list to send email until the steps in [Waitlist email](../docs/launch/EMAIL_OPT_IN.md) are done.

## Delete someone

If a person asks to be removed:

```sql
delete from tm_waitlist.waitlist where email_normalized = lower(trim('person@example.com'));
```

Replace the synthetic example address only in the SQL editor, never in a committed file.

## Public RPC limits and rollback

`0005` permits at most 60 signup calls in a rolling minute and 1,000 in a rolling hour, and 300 event rows in a rolling minute. Signup calls are counted in `waitlist_join_attempts`, which holds only an id and a time. New and duplicate emails each cost one call, so the cap is no membership test. A call refused with 429 records nothing. Each accepted call removes at most 500 attempt times older than one hour. These are global caps with no email, IP address or identifier in the attempt table. An advisory transaction lock makes the count-and-insert atomic across API instances and direct PostgREST callers. The indexed counts stop at the cap; they never scan unbounded result sets. Attackers can still exhaust the shared cap and temporarily block legitimate signups; these limits bound storage growth, not all denial-of-service or compute cost.

`0006` adds database-backed per-client buckets. Advisory locks serialize count-and-insert. The API supplies the HMAC code; missing IP headers supply null. Direct PostgREST callers with the public anon key can omit or spoof `p_client`, so the global caps still protect writes but the per-client buckets do not authenticate direct callers. Invalid API payloads are rejected before the database and do not consume a bucket. A rejected database call writes nothing.

To roll back the API after `0006`, redeploy the previous API and leave the database migration in place. Old calls omit `p_client` and still work. Do not run the pre-`0005` SQL below with `0006` installed; that would create ambiguous overloads.


Events only accept `visit`, `share` or `copy`, and a path matching `^/[A-Za-z0-9._~/-]{0,199}$`: no queries, fragments, email addresses or referral codes in a query. The path constraint is `NOT VALID` to leave historical rows alone while enforcing new writes. Each accepted event removes at most 500 event rows older than 90 days using the time index. This is opportunistic retention, not a hard deletion deadline when the site is inactive.

Emergency rollback restores the pre-`0005` writers, removes the new path constraint and drops the attempt table. It intentionally keeps the harmless event time index, never changes grants, and never touches another schema. Review before applying: it reopens the unbounded public write surface.

```sql
do $$
begin
  if to_regprocedure('tm_waitlist.waitlist_join_pending(text,text,text,text)') is not null then
    raise exception '0006 is installed. Roll back the API only; keep the compatible database signatures.';
  end if;
end;
$$;
begin;
alter table tm_waitlist.funnel_events drop constraint if exists funnel_events_path_format;
create or replace function tm_waitlist.waitlist_join_pending(p_email text, p_source text default null, p_ref text default null)
returns table (saved boolean)
language sql volatile security definer set search_path = ''
as $$
  insert into tm_waitlist.waitlist (email, consent, source, referred_by)
  values (p_email, true, p_source,
    (select w.ref_code from tm_waitlist.waitlist w where p_ref ~ '^[a-z0-9]{10}$' and w.ref_code = p_ref))
  on conflict (email_normalized) do nothing;
  select true;
$$;
create or replace function tm_waitlist.funnel_event_add(p_type text, p_path text, p_via_ref boolean default false)
returns void
language sql volatile security definer set search_path = ''
as $$
  insert into tm_waitlist.funnel_events (type, path, via_ref)
  values (p_type, p_path, coalesce(p_via_ref, false));
$$;
drop table if exists tm_waitlist.waitlist_join_attempts;
notify pgrst, 'reload schema';
commit;
```
