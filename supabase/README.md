# Supabase setup for the waitlist

The site saves waitlist signups in one Supabase project. It sends no email. See [Waitlist email](../docs/launch/EMAIL_OPT_IN.md) for why, and what must happen before any email is added.

For click-by-click setup and the combined SQL, see [Supabase setup](../docs/launch/SUPABASE_SETUP.md).

## API behavior

- `POST /api/waitlist` saves a pending, unconfirmed signup. Success is `200 {"ok":true,"pending":true}` for new and existing emails alike. No code, place in line or token is returned. No email is sent.
- `GET /api/waitlist?code=CODE` returns `ok`, `position`, `referrals` and `total` for confirmed, subscribed rows only. Pending, unsubscribed or unknown codes return `404`. Codes are 10 lowercase letters or digits. The site has no page that shows a code or a place in line yet, because signups stay pending.
- `POST /api/event` counts visits, shares and link copies. The site sends only visits today; it has no share or copy button yet.
- `GET /api/health` returns `{"ok":true,"waitlist":<bool>,"database":"reachable"|"unreachable"|"not_configured","email":false}`. `waitlist` is true when both Supabase settings are present. `database` is `reachable` only when a read-only `waitlist_status` call with a code that matches nobody just worked. Vercel's CDN keeps each answer for 30 seconds. `email` is always false.
- When the database's global write cap is full, signup and event POSTs return `429 {"ok":false,"error":"rate_limited"}` with `Retry-After: 60`. The form says the list is busy and keeps the typed email. This applies equally to new and duplicate emails, so the cap cannot reveal who is on the list.

Only confirmed, subscribed rows count in positions and totals. Only confirmed, subscribed friends earn referral credit. Order: more confirmed friends first, then earlier signup time. The site does not confirm anyone today, and a signup gets no code back, so referral credit and places in line are planned, not live. How a signup becomes confirmed is not decided.

## What gets stored

One row per normalized email: email, consent, source page, signup time, the person's own referral code, the code that referred them (if any), and `confirmed_at` and `unsubscribed_at` times (both empty for a site signup). No tokens. Saving again with the same email changes nothing, so an unsubscribed person is never added back.

The `funnel_events` table stores event type, page path, a referral flag and the time. It holds no email or referral code. Neither table stores IP addresses, browser details or cookies. The `funnel_daily` view reports daily visits, raw signups (pending included), confirmations, unsubscribes, shares and copies.

Row level security is on with no policies. The `anon` and `authenticated` roles cannot read or write the tables or the view. `anon` can run three security definer functions and nothing else: `waitlist_join_pending`, `waitlist_status` and `funnel_event_add` (see `0004_api_access.sql`). The site calls them with the project's anon key, kept in Vercel as `SUPABASE_KEY`. The anon key is public by design, so anyone holding it can call these functions directly. Migration `0005` enforces write caps, event types and strict plain paths inside the database, not just the site API.

## 1. Apply migrations 0001 to 0005

In Supabase **SQL Editor**, paste these files in order and click **Run**:

1. `supabase/migrations/0001_waitlist.sql`
2. `supabase/migrations/0002_referrals_and_funnel.sql`
3. `supabase/migrations/0003_pending_signups.sql`
4. `supabase/migrations/0004_api_access.sql`
5. `supabase/migrations/0005_bounded_public_rpcs.sql`

The combined block in the click-by-click guide covers `0001` through `0004`; then apply `0005` separately. The files are safe to run twice. `0003` replaces the instant place-in-line signup from `0002` with pending signups. It also removes a never deployed email draft if a local database has it.

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

`0005` permits at most 60 new waitlist rows in a rolling minute and 1,000 in a rolling hour, and 300 event rows in a rolling minute. These are global caps with no IP address or identifier storage. An advisory transaction lock makes the count-and-insert atomic across API instances and direct PostgREST callers. The indexed counts stop at the cap; they never scan unbounded result sets. Attackers can still exhaust the shared cap and temporarily block legitimate signups; these limits bound storage growth, not all denial-of-service or compute cost.

Events only accept `visit`, `share` or `copy`, and a path matching `^/[A-Za-z0-9._~/-]{0,199}$`: no queries, fragments, email addresses or referral codes in a query. The path constraint is `NOT VALID` to leave historical rows alone while enforcing new writes. Each accepted event removes at most 500 event rows older than 90 days using the time index. This is opportunistic retention, not a hard deletion deadline when the site is inactive.

Emergency rollback restores the pre-`0005` writers and removes the new path constraint. It intentionally keeps the harmless time indexes, never changes grants, and never touches another schema. Review before applying: it reopens the unbounded public write surface.

```sql
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
notify pgrst, 'reload schema';
commit;
```
