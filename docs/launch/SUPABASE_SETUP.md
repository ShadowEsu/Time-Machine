# Waitlist database setup

This is done. Since 18 October 2026 the waitlist on https://time-machine.company saves signups. This page records how it is set up, so it can be checked or rebuilt.

Each signup is saved as pending and unconfirmed. The site sends no email. Pending signups do not count in anyone's place in line, the total, or referral credit. How a signup becomes confirmed, and any future waitlist email, is not decided yet. See [Waitlist email](EMAIL_OPT_IN.md).

## Where it lives

- **Supabase project:** `jaymini-prod` (`wzgfjuxcprignwdlopvl`, us-west-1). The owner's free Supabase organization allows 2 projects and both are used, so Time Machine shares this one.
- **Kept separate:** every Time Machine table and function is in its own schema, `tm_waitlist`. Nothing is in Jaymini's `public` schema.
- **The key the site holds:** the project's anon key, in the Vercel setting `SUPABASE_KEY`. In `tm_waitlist` that key can only call three functions: save a pending signup, look up a place in line, and add a funnel count. It cannot read any table, and it gets nothing in `tm_waitlist` beyond those three functions. The service role key is not used by the site.

## What gets stored

- **Each signup:** the email, the consent tick, which words by the box were ticked (a dated version such as `waitlist-2026-10-28`), the page they signed up from, the time, their own referral code, the referral code that brought them (if any), and confirmation and unsubscribe times. Both times stay empty for a site signup.
- **Funnel counts:** the event type (visit, share or copy), the page path, whether the visit came from a referral link, and the time. No email and no code.
- **Never stored:** IP addresses, browser details, cookies, tokens.
- **Abuse controls:** a code derived from the IP using HMAC, the endpoint bucket and the time. Only the last hour counts. Older codes are removed in batches during later accepted requests, not on a schedule. No raw IP reaches Supabase.

## 1. Create the schema and functions

Run this in the Supabase **SQL Editor** of the project. This block combines migrations `0001` through `0004`; then apply `0005` and `0006` separately as described below. On a database already running `0006`, do not rerun older migrations because they recreate obsolete function signatures.

```sql
-- Time Machine waitlist.
-- Stores an email, the consent tick, and the page the person signed up from.
-- No IP addresses, no user agents, nothing else.

-- Everything lives in its own schema, so the waitlist can share a Supabase project without
-- touching that project's public schema.
create schema if not exists tm_waitlist;

create table if not exists tm_waitlist.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null check (char_length(email) between 3 and 254),
  email_normalized text generated always as (lower(btrim(email))) stored,
  consent boolean not null check (consent),
  source text check (source is null or char_length(source) <= 200),
  created_at timestamptz not null default now(),
  constraint waitlist_email_normalized_key unique (email_normalized)
);

comment on table tm_waitlist.waitlist is
  'Waitlist signups. Written only by the site API with the service role key.';

-- Row level security on, and no policies at all.
-- The anon and authenticated roles can do nothing with this table.
-- The service role bypasses row level security and is the only writer.
alter table tm_waitlist.waitlist enable row level security;

revoke all on table tm_waitlist.waitlist from anon, authenticated;
grant select, insert on table tm_waitlist.waitlist to service_role;
-- Time Machine waitlist: referral codes, list position, and anonymous funnel counts.
-- Needs 0001_waitlist.sql first. Safe to run twice.
-- Adds to each signup: their own referral code, and the code (if any) that brought them.
-- Adds a funnel_events table that holds only an event type, a page path, a via-referral flag and the time.
-- No IP addresses, no user agents, no cookies, no emails or codes in funnel_events.

-- A fresh code: 10 characters from a to z and 0 to 9, from random bytes.
create or replace function tm_waitlist.waitlist_new_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(
    substr('abcdefghijklmnopqrstuvwxyz0123456789', 1 + get_byte(uuid_send(gen_random_uuid()), 0) % 36, 1),
    ''
  )
  from generate_series(1, 10);
$$;

-- Existing rows get a code when the column is added. On a second run the whole line is skipped.
alter table tm_waitlist.waitlist
  add column if not exists ref_code text not null default tm_waitlist.waitlist_new_code()
    constraint waitlist_ref_code_key unique
    constraint waitlist_ref_code_format check (ref_code ~ '^[a-z0-9]{10}$');

-- The code that brought this person, or null. Deleting the referrer clears it.
alter table tm_waitlist.waitlist
  add column if not exists referred_by text
    constraint waitlist_referred_by_fkey references tm_waitlist.waitlist (ref_code) on delete set null;

create index if not exists waitlist_referred_by_idx on tm_waitlist.waitlist (referred_by);

comment on column tm_waitlist.waitlist.ref_code is 'This person''s own referral code, made in SQL.';
comment on column tm_waitlist.waitlist.referred_by is 'The referral code that brought this person, or null.';

-- Place in the list for one code.
-- Order rule, shown on the site: more friends who joined with your link first, then earlier join time first.
-- Position is 1 plus the number of entries ahead under that rule. No row back means the code is unknown.
create or replace function tm_waitlist.waitlist_status(p_code text)
returns table ("position" bigint, referrals bigint, total bigint)
language sql
stable
set search_path = ''
as $$
  with refs as (
    select w.referred_by as code, count(*) as n
    from tm_waitlist.waitlist w
    where w.referred_by is not null
    group by w.referred_by
  ),
  entries as (
    select w.ref_code, w.created_at, coalesce(r.n, 0) as referrals
    from tm_waitlist.waitlist w
    left join refs r on r.code = w.ref_code
  )
  select
    1 + (
      select count(*)
      from entries e
      where e.referrals > me.referrals
         or (e.referrals = me.referrals and e.created_at < me.created_at)
    ),
    me.referrals,
    (select count(*) from tm_waitlist.waitlist)
  from entries me
  where me.ref_code = p_code;
$$;

-- Join the list. Returns one row (code, position, total) for a new signup.
-- Returns no rows when the email is already on the list, and changes nothing.
-- A ref that is badly shaped or matches no one is ignored. Your own code cannot match,
-- because your code does not exist until your row is added.
create or replace function tm_waitlist.waitlist_join(p_email text, p_source text default null, p_ref text default null)
returns table (code text, "position" bigint, total bigint)
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_ref text;
  v_code text;
begin
  select w.ref_code into v_ref
  from tm_waitlist.waitlist w
  where p_ref ~ '^[a-z0-9]{10}$' and w.ref_code = p_ref;

  insert into tm_waitlist.waitlist (email, consent, source, referred_by)
  values (p_email, true, p_source, v_ref)
  on conflict (email_normalized) do nothing
  returning ref_code into v_code;

  if v_code is null then
    return;
  end if;

  return query
    select v_code, s."position", s.total
    from tm_waitlist.waitlist_status(v_code) s;
end;
$$;

-- Anonymous funnel counts.
create table if not exists tm_waitlist.funnel_events (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('visit', 'share', 'copy')),
  path text not null check (char_length(path) between 1 and 200 and left(path, 1) = '/'),
  via_ref boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table tm_waitlist.funnel_events is
  'Anonymous page visits, shares and link copies. Written only by the site API with the service role key.';

-- Signups and funnel counts per day (UTC).
-- Rebuild so rerunning the combined setup also works after 0003 adds view columns.
drop view if exists tm_waitlist.funnel_daily;
create view tm_waitlist.funnel_daily
with (security_invoker = true)
as
with e as (
  select
    (f.created_at at time zone 'utc')::date as day,
    count(*) filter (where f.type = 'visit') as visits,
    count(*) filter (where f.type = 'visit' and f.via_ref) as visits_via_ref,
    count(*) filter (where f.type = 'share') as shares,
    count(*) filter (where f.type = 'copy') as copies
  from tm_waitlist.funnel_events f
  group by 1
),
s as (
  select
    (w.created_at at time zone 'utc')::date as day,
    count(*) as signups,
    count(*) filter (where w.referred_by is not null) as signups_via_ref
  from tm_waitlist.waitlist w
  group by 1
)
select
  coalesce(e.day, s.day) as day,
  coalesce(e.visits, 0) as visits,
  coalesce(e.visits_via_ref, 0) as visits_via_ref,
  coalesce(s.signups, 0) as signups,
  coalesce(s.signups_via_ref, 0) as signups_via_ref,
  coalesce(e.shares, 0) as shares,
  coalesce(e.copies, 0) as copies
from e
full join s on s.day = e.day
order by 1 desc;

-- Row level security on, and no policies at all. Only the service role can read or write.
alter table tm_waitlist.funnel_events enable row level security;

revoke all on table tm_waitlist.funnel_events from public, anon, authenticated;
revoke all on table tm_waitlist.funnel_daily from public, anon, authenticated;
grant select, insert on table tm_waitlist.funnel_events to service_role;
grant select on table tm_waitlist.funnel_daily to service_role;

-- Functions: Postgres lets everyone run new functions by default. Take that away.
revoke all on function tm_waitlist.waitlist_new_code() from public, anon, authenticated;
revoke all on function tm_waitlist.waitlist_status(text) from public, anon, authenticated;
revoke all on function tm_waitlist.waitlist_join(text, text, text) from public, anon, authenticated;
grant execute on function tm_waitlist.waitlist_new_code() to service_role;
grant execute on function tm_waitlist.waitlist_status(text) to service_role;
grant execute on function tm_waitlist.waitlist_join(text, text, text) to service_role;

-- Ask the Supabase API to pick up the new functions and table now.
notify pgrst, 'reload schema';
-- Pending signups. Safe to run twice after 0001 and 0002.
-- The site sends no email. A signup is saved as pending and unconfirmed.
-- Only confirmed, subscribed rows count in positions, totals and referral credit.
-- How a row becomes confirmed is not decided yet. No tokens are made or stored.

alter table tm_waitlist.waitlist
  add column if not exists confirmed_at timestamptz,
  add column if not exists unsubscribed_at timestamptz;

comment on column tm_waitlist.waitlist.confirmed_at is 'When this person confirmed. Null means pending.';
comment on column tm_waitlist.waitlist.unsubscribed_at is 'When this person left the list. Null means subscribed.';

-- Remove an earlier, never deployed email draft if a local database has it.
drop function if exists tm_waitlist.waitlist_join(text, text, text, text, text);
drop function if exists tm_waitlist.waitlist_confirm(text, text);
drop function if exists tm_waitlist.waitlist_confirm_complete(text);
drop function if exists tm_waitlist.waitlist_unsubscribe(text);
alter table tm_waitlist.waitlist
  drop column if exists confirm_token_hash,
  drop column if exists unsub_token_hash,
  drop column if exists confirm_sent_at,
  drop column if exists welcome_sent_at,
  drop column if exists welcome_position,
  drop column if exists welcome_total;

-- The 0002 join answered with a place in line at once. Pending rows have no place, so it goes.
drop function if exists tm_waitlist.waitlist_join(text, text, text);

-- Save a pending signup. Same answer for new and existing emails, so nobody can probe the list.
-- An existing row is never changed, so an unsubscribed person is not added back.
-- A ref that is badly shaped or matches no one is ignored.
create or replace function tm_waitlist.waitlist_join_pending(p_email text, p_source text default null, p_ref text default null)
returns table (saved boolean)
language sql
volatile
set search_path = ''
as $$
  insert into tm_waitlist.waitlist (email, consent, source, referred_by)
  values (
    p_email,
    true,
    p_source,
    (select w.ref_code from tm_waitlist.waitlist w where p_ref ~ '^[a-z0-9]{10}$' and w.ref_code = p_ref)
  )
  on conflict (email_normalized) do nothing;
  select true;
$$;

-- Place in the list for one code. Only confirmed, subscribed rows count, and only their friends earn credit.
-- Order rule, shown on the site: more friends who joined with your link first, then earlier join time first.
-- No row back means the code is unknown, pending or unsubscribed.
create or replace function tm_waitlist.waitlist_status(p_code text)
returns table ("position" bigint, referrals bigint, total bigint)
language sql
stable
set search_path = ''
as $$
  with active as (
    select w.ref_code, w.referred_by, w.created_at
    from tm_waitlist.waitlist w
    where w.confirmed_at is not null and w.unsubscribed_at is null
  ),
  refs as (
    select a.referred_by as code, count(*) as n
    from active a
    where a.referred_by is not null
    group by a.referred_by
  ),
  entries as (
    select a.ref_code, a.created_at, coalesce(r.n, 0) as referrals
    from active a
    left join refs r on r.code = a.ref_code
  )
  select
    1 + (
      select count(*)
      from entries e
      where e.referrals > me.referrals
         or (e.referrals = me.referrals and e.created_at < me.created_at)
    ),
    me.referrals,
    (select count(*) from active)
  from entries me
  where me.ref_code = p_code;
$$;

-- Signups and funnel counts per day (UTC). Signups counts every row, pending included.
drop view if exists tm_waitlist.funnel_daily;
create view tm_waitlist.funnel_daily
with (security_invoker = true)
as
with e as (
  select
    (f.created_at at time zone 'utc')::date as day,
    count(*) filter (where f.type = 'visit') as visits,
    count(*) filter (where f.type = 'visit' and f.via_ref) as visits_via_ref,
    count(*) filter (where f.type = 'share') as shares,
    count(*) filter (where f.type = 'copy') as copies
  from tm_waitlist.funnel_events f
  group by 1
),
w as (
  select (created_at at time zone 'utc')::date as day, 1 as signups,
    (referred_by is not null)::int as signups_via_ref, 0 as confirms, 0 as unsubscribes
  from tm_waitlist.waitlist
  union all
  select (confirmed_at at time zone 'utc')::date, 0, 0, 1, 0
  from tm_waitlist.waitlist where confirmed_at is not null
  union all
  select (unsubscribed_at at time zone 'utc')::date, 0, 0, 0, 1
  from tm_waitlist.waitlist where unsubscribed_at is not null
),
s as (
  select day, sum(signups) as signups, sum(signups_via_ref) as signups_via_ref,
    sum(confirms) as confirms, sum(unsubscribes) as unsubscribes
  from w
  group by day
)
select
  coalesce(e.day, s.day) as day,
  coalesce(e.visits, 0) as visits,
  coalesce(e.visits_via_ref, 0) as visits_via_ref,
  coalesce(s.signups, 0) as signups,
  coalesce(s.signups_via_ref, 0) as signups_via_ref,
  coalesce(e.shares, 0) as shares,
  coalesce(e.copies, 0) as copies,
  coalesce(s.confirms, 0) as confirms,
  coalesce(s.unsubscribes, 0) as unsubscribes
from e
full join s on s.day = e.day
order by 1 desc;

-- Only the service role can use any of it.
revoke all on table tm_waitlist.funnel_daily from public, anon, authenticated;
grant select on table tm_waitlist.funnel_daily to service_role;
revoke all on function tm_waitlist.waitlist_join_pending(text, text, text) from public, anon, authenticated;
revoke all on function tm_waitlist.waitlist_status(text) from public, anon, authenticated;
grant execute on function tm_waitlist.waitlist_join_pending(text, text, text) to service_role;
grant execute on function tm_waitlist.waitlist_status(text) to service_role;

-- Ask the Supabase API to pick up the changes now.
notify pgrst, 'reload schema';
-- API access through the anon key, limited to three functions.
-- The site's server calls these with the project's anon key and the tm_waitlist profile.
-- anon can run the functions and nothing else: no table reads, no table writes.
-- The functions run as their owner (security definer) with an empty search_path.

grant usage on schema tm_waitlist to anon, service_role;

alter function tm_waitlist.waitlist_join_pending(text, text, text) security definer;
alter function tm_waitlist.waitlist_status(text) security definer;

-- One funnel count. Type and path are checked by the table's constraints.
create or replace function tm_waitlist.funnel_event_add(p_type text, p_path text, p_via_ref boolean default false)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into tm_waitlist.funnel_events (type, path, via_ref) values (p_type, p_path, coalesce(p_via_ref, false));
$$;

revoke all on function tm_waitlist.funnel_event_add(text, text, boolean) from public, anon, authenticated;
revoke all on function tm_waitlist.waitlist_new_code() from public, anon, authenticated;

grant execute on function tm_waitlist.waitlist_join_pending(text, text, text) to anon, service_role;
grant execute on function tm_waitlist.waitlist_status(text) to anon, service_role;
grant execute on function tm_waitlist.funnel_event_add(text, text, boolean) to anon, service_role;

-- Tables and the view stay closed to anon and authenticated.
revoke all on all tables in schema tm_waitlist from anon, authenticated;

notify pgrst, 'reload schema';
```

Then run [`supabase/migrations/0005_bounded_public_rpcs.sql`](../../supabase/migrations/0005_bounded_public_rpcs.sql) to bound the public writers: 60 signup calls/minute, 1,000/hour, 300 events/minute, strict event paths and batched removal of event rows older than 90 days. The caps are global, enforced inside the RPCs even for direct PostgREST callers, and return `429 rate_limited` when full. New and duplicate emails count the same, so the cap reveals nothing about who signed up. Signatures and grants stay the same. Review the [rollback SQL](../../supabase/README.md#public-rpc-limits-and-rollback) before applying.

Next run [`supabase/migrations/0006_per_client_limits.sql`](../../supabase/migrations/0006_per_client_limits.sql) **before** deploying the site API that sends `p_client`. Per client: 5 signup calls/minute and 20/hour, 30 status lookups/minute, 60 events/minute. The API derives a 22-character HMAC code from Vercel's client IP using `SUPABASE_KEY`; it sends only that code to Supabase. New and duplicate signups use the same quota. Over quota returns `429 rate_limited` with `Retry-After: 60`. Counts and inserts run under transaction advisory locks. The `client_calls` table has RLS enabled and no public grants.

The new optional parameter lets the old API keep working during rollout. A missing IP skips the per-client bucket. Direct PostgREST callers can omit or forge the parameter; the global `0005` caps still bind them. Unkeyed health lookups remain read-only. To roll back the API, redeploy its previous version and keep `0006` installed. See [RPC limits and rollback](../../supabase/README.md#public-rpc-limits-and-rollback).

Then run [`supabase/migrations/0007_consent_text_version.sql`](../../supabase/migrations/0007_consent_text_version.sql) **right before** deploying the site API that sends `p_consent_version`. It records which words by the box each person ticked (rows from before it say `unrecorded`) and refuses a signup without a well-formed version, direct PostgREST callers included. It replaces the `0006` signature, so signups through the old API fail until the new one is live. Rollback: [supabase/README.md](../../supabase/README.md#1-apply-migrations-0001-to-0007).


## 2. Let the API see the schema

In the project, open **Project Settings**, **Data API**, and add `tm_waitlist` to **Exposed schemas** (keep `public` and `graphql_public`). Without this, the site gets an error when it saves.

## 3. Vercel settings for time-machine-site

Production and Preview:

- `SUPABASE_URL`: `https://wzgfjuxcprignwdlopvl.supabase.co`
- `SUPABASE_KEY`: the project's anon key (Project Settings, API Keys, Legacy, `anon`)

Redeploy after changing either. The site sends every call with the `tm_waitlist` profile.

## 4. Check it works

1. Open https://time-machine.company/api/health. It should show `{"ok":true,"waitlist":true,"database":"reachable","email":false}`. `database` comes from a real read-only call and can lag up to 30 seconds behind (CDN cache). `unreachable` means a wrong key, a missing grant or a paused project.
2. Sign up on the live site with a `+test` address. The form should say the signup is saved and pending.
3. In the SQL Editor, run `select email, source, created_at from tm_waitlist.waitlist order by created_at desc limit 5;` and see the row. Delete test rows with the query in the next section.

## 6. Read your numbers

Every site signup is pending. Nobody has a place in line until confirmation is decided and built. Open **SQL Editor**, click **New query**, paste one of these, and click **Run**.

**Newest signups:**

```sql
select email, source, referred_by is not null as came_from_a_friend, created_at
from tm_waitlist.waitlist
order by created_at desc
limit 50;
```

**How many people signed up (pending included):**

```sql
select count(*) as signups from tm_waitlist.waitlist;
```

**The funnel, day by day (UTC), newest first:**

```sql
select * from tm_waitlist.funnel_daily limit 30;
```

The columns are: `visits`, `visits_via_ref` (visits that came from a referral link), `signups` (every signup, pending included), `signups_via_ref` (signups that used someone's referral code), `shares`, `copies`, `confirms` and `unsubscribes`. The last two stay at 0 until confirmation exists.

**Who brought the most friends (pending signups, not public referral credit):**

```sql
select w.email, count(r.id) as friends_joined
from tm_waitlist.waitlist w
join tm_waitlist.waitlist r on r.referred_by = w.ref_code
group by w.email
order by friends_joined desc
limit 20;
```

**Delete one person** (when someone asks to be removed). Replace the example address only in the SQL editor, never in a committed file:

```sql
delete from tm_waitlist.waitlist where email_normalized = lower(trim('person@example.com'));
```

## Free projects pause

Free Supabase projects pause after about a week with no activity. A paused project cannot save signups, and the form will say it could not save. Before any launch or post, open the Supabase dashboard and check the project is active. If it is paused, click **Restore project** and wait for it to come back.
