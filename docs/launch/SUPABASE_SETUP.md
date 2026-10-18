# Supabase setup for the waitlist

This guide is for Preston. It takes about 10 minutes. You do not need to write code.

When you finish, the waitlist on https://time-machine-site.vercel.app saves signups. Each signup is saved as pending and unconfirmed. The site sends no email. Pending signups do not count in anyone's place in line, the total, or referral credit. How a signup becomes confirmed, and any future waitlist email, is not decided yet. See [Waitlist email](EMAIL_OPT_IN.md).

Until you finish, the form says the waitlist is not open yet and asks people to email you. It never pretends to save.

## What gets stored

- **Each signup:** the email, the consent tick, the page they signed up from, the time, their own referral code, the referral code that brought them (if any), and confirmation and unsubscribe times. Both times stay empty for a site signup.
- **Funnel counts:** the event type (visit, share or copy), the page path, whether the visit came from a referral link, and the time. No email and no code.
- **Never stored:** IP addresses, browser details, cookies, tokens.

Only the site's server function can read or write any of this. The public key can do nothing.

## 1. Create the Supabase project

1. Go to https://supabase.com and sign in.
2. Click **New project**.
3. Pick your organization. Choose the **Free** plan.
4. Name it `time-machine`.
5. Make up a strong database password and save it in your password manager. You will not need it for this guide.
6. For **Region**, pick a West US option (for example West US, North California).
7. Click **Create new project**. Wait until it says the project is ready. This takes a minute or two.

## 2. Create the tables

1. In the left sidebar, click **SQL Editor**.
2. Click **New query**.
3. Copy the whole SQL block below, from the first line to the last. Paste it into the editor.
4. Click **Run**.
5. You should see "Success. No rows returned". Notices that say "already exists, skipping" or "does not exist, skipping" are fine.
6. In the left sidebar, click **Table Editor**. You should see two tables: `waitlist` and `funnel_events`. Both are empty.

The block is safe to run more than once. Running it again changes no signups.

It is the three files `supabase/migrations/0001_waitlist.sql`, `supabase/migrations/0002_referrals_and_funnel.sql` and `supabase/migrations/0003_pending_signups.sql`, one after the other.

```sql
-- Time Machine waitlist.
-- Stores an email, the consent tick, and the page the person signed up from.
-- No IP addresses, no user agents, nothing else.

create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null check (char_length(email) between 3 and 254),
  email_normalized text generated always as (lower(btrim(email))) stored,
  consent boolean not null check (consent),
  source text check (source is null or char_length(source) <= 200),
  created_at timestamptz not null default now(),
  constraint waitlist_email_normalized_key unique (email_normalized)
);

comment on table public.waitlist is
  'Waitlist signups. Written only by the site API with the service role key.';

-- Row level security on, and no policies at all.
-- The anon and authenticated roles can do nothing with this table.
-- The service role bypasses row level security and is the only writer.
alter table public.waitlist enable row level security;

revoke all on table public.waitlist from anon, authenticated;
grant select, insert on table public.waitlist to service_role;

-- Time Machine waitlist: referral codes, list position, and anonymous funnel counts.
-- Needs 0001_waitlist.sql first. Safe to run twice.
-- Adds to each signup: their own referral code, and the code (if any) that brought them.
-- Adds a funnel_events table that holds only an event type, a page path, a via-referral flag and the time.
-- No IP addresses, no user agents, no cookies, no emails or codes in funnel_events.

-- A fresh code: 10 characters from a to z and 0 to 9, from random bytes.
create or replace function public.waitlist_new_code()
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
alter table public.waitlist
  add column if not exists ref_code text not null default public.waitlist_new_code()
    constraint waitlist_ref_code_key unique
    constraint waitlist_ref_code_format check (ref_code ~ '^[a-z0-9]{10}$');

-- The code that brought this person, or null. Deleting the referrer clears it.
alter table public.waitlist
  add column if not exists referred_by text
    constraint waitlist_referred_by_fkey references public.waitlist (ref_code) on delete set null;

create index if not exists waitlist_referred_by_idx on public.waitlist (referred_by);

comment on column public.waitlist.ref_code is 'This person''s own referral code, made in SQL.';
comment on column public.waitlist.referred_by is 'The referral code that brought this person, or null.';

-- Place in the list for one code.
-- Order rule, shown on the site: more friends who joined with your link first, then earlier join time first.
-- Position is 1 plus the number of entries ahead under that rule. No row back means the code is unknown.
create or replace function public.waitlist_status(p_code text)
returns table ("position" bigint, referrals bigint, total bigint)
language sql
stable
set search_path = ''
as $$
  with refs as (
    select w.referred_by as code, count(*) as n
    from public.waitlist w
    where w.referred_by is not null
    group by w.referred_by
  ),
  entries as (
    select w.ref_code, w.created_at, coalesce(r.n, 0) as referrals
    from public.waitlist w
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
    (select count(*) from public.waitlist)
  from entries me
  where me.ref_code = p_code;
$$;

-- Join the list. Returns one row (code, position, total) for a new signup.
-- Returns no rows when the email is already on the list, and changes nothing.
-- A ref that is badly shaped or matches no one is ignored. Your own code cannot match,
-- because your code does not exist until your row is added.
create or replace function public.waitlist_join(p_email text, p_source text default null, p_ref text default null)
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
  from public.waitlist w
  where p_ref ~ '^[a-z0-9]{10}$' and w.ref_code = p_ref;

  insert into public.waitlist (email, consent, source, referred_by)
  values (p_email, true, p_source, v_ref)
  on conflict (email_normalized) do nothing
  returning ref_code into v_code;

  if v_code is null then
    return;
  end if;

  return query
    select v_code, s."position", s.total
    from public.waitlist_status(v_code) s;
end;
$$;

-- Anonymous funnel counts.
create table if not exists public.funnel_events (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('visit', 'share', 'copy')),
  path text not null check (char_length(path) between 1 and 200 and left(path, 1) = '/'),
  via_ref boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.funnel_events is
  'Anonymous page visits, shares and link copies. Written only by the site API with the service role key.';

-- Signups and funnel counts per day (UTC).
-- Rebuild so rerunning the combined setup also works after 0003 adds view columns.
drop view if exists public.funnel_daily;
create view public.funnel_daily
with (security_invoker = true)
as
with e as (
  select
    (f.created_at at time zone 'utc')::date as day,
    count(*) filter (where f.type = 'visit') as visits,
    count(*) filter (where f.type = 'visit' and f.via_ref) as visits_via_ref,
    count(*) filter (where f.type = 'share') as shares,
    count(*) filter (where f.type = 'copy') as copies
  from public.funnel_events f
  group by 1
),
s as (
  select
    (w.created_at at time zone 'utc')::date as day,
    count(*) as signups,
    count(*) filter (where w.referred_by is not null) as signups_via_ref
  from public.waitlist w
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
alter table public.funnel_events enable row level security;

revoke all on table public.funnel_events from public, anon, authenticated;
revoke all on table public.funnel_daily from public, anon, authenticated;
grant select, insert on table public.funnel_events to service_role;
grant select on table public.funnel_daily to service_role;

-- Functions: Postgres lets everyone run new functions by default. Take that away.
revoke all on function public.waitlist_new_code() from public, anon, authenticated;
revoke all on function public.waitlist_status(text) from public, anon, authenticated;
revoke all on function public.waitlist_join(text, text, text) from public, anon, authenticated;
grant execute on function public.waitlist_new_code() to service_role;
grant execute on function public.waitlist_status(text) to service_role;
grant execute on function public.waitlist_join(text, text, text) to service_role;

-- Ask the Supabase API to pick up the new functions and table now.
notify pgrst, 'reload schema';

-- Pending signups. Safe to run twice after 0001 and 0002.
-- The site sends no email. A signup is saved as pending and unconfirmed.
-- Only confirmed, subscribed rows count in positions, totals and referral credit.
-- How a row becomes confirmed is not decided yet. No tokens are made or stored.

alter table public.waitlist
  add column if not exists confirmed_at timestamptz,
  add column if not exists unsubscribed_at timestamptz;

comment on column public.waitlist.confirmed_at is 'When this person confirmed. Null means pending.';
comment on column public.waitlist.unsubscribed_at is 'When this person left the list. Null means subscribed.';

-- Remove an earlier, never deployed email draft if a local database has it.
drop function if exists public.waitlist_join(text, text, text, text, text);
drop function if exists public.waitlist_confirm(text, text);
drop function if exists public.waitlist_confirm_complete(text);
drop function if exists public.waitlist_unsubscribe(text);
alter table public.waitlist
  drop column if exists confirm_token_hash,
  drop column if exists unsub_token_hash,
  drop column if exists confirm_sent_at,
  drop column if exists welcome_sent_at,
  drop column if exists welcome_position,
  drop column if exists welcome_total;

-- The 0002 join answered with a place in line at once. Pending rows have no place, so it goes.
drop function if exists public.waitlist_join(text, text, text);

-- Save a pending signup. Same answer for new and existing emails, so nobody can probe the list.
-- An existing row is never changed, so an unsubscribed person is not added back.
-- A ref that is badly shaped or matches no one is ignored.
create or replace function public.waitlist_join_pending(p_email text, p_source text default null, p_ref text default null)
returns table (saved boolean)
language sql
volatile
set search_path = ''
as $$
  insert into public.waitlist (email, consent, source, referred_by)
  values (
    p_email,
    true,
    p_source,
    (select w.ref_code from public.waitlist w where p_ref ~ '^[a-z0-9]{10}$' and w.ref_code = p_ref)
  )
  on conflict (email_normalized) do nothing;
  select true;
$$;

-- Place in the list for one code. Only confirmed, subscribed rows count, and only their friends earn credit.
-- Order rule, shown on the site: more friends who joined with your link first, then earlier join time first.
-- No row back means the code is unknown, pending or unsubscribed.
create or replace function public.waitlist_status(p_code text)
returns table ("position" bigint, referrals bigint, total bigint)
language sql
stable
set search_path = ''
as $$
  with active as (
    select w.ref_code, w.referred_by, w.created_at
    from public.waitlist w
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
drop view if exists public.funnel_daily;
create view public.funnel_daily
with (security_invoker = true)
as
with e as (
  select
    (f.created_at at time zone 'utc')::date as day,
    count(*) filter (where f.type = 'visit') as visits,
    count(*) filter (where f.type = 'visit' and f.via_ref) as visits_via_ref,
    count(*) filter (where f.type = 'share') as shares,
    count(*) filter (where f.type = 'copy') as copies
  from public.funnel_events f
  group by 1
),
w as (
  select (created_at at time zone 'utc')::date as day, 1 as signups,
    (referred_by is not null)::int as signups_via_ref, 0 as confirms, 0 as unsubscribes
  from public.waitlist
  union all
  select (confirmed_at at time zone 'utc')::date, 0, 0, 1, 0
  from public.waitlist where confirmed_at is not null
  union all
  select (unsubscribed_at at time zone 'utc')::date, 0, 0, 0, 1
  from public.waitlist where unsubscribed_at is not null
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
revoke all on table public.funnel_daily from public, anon, authenticated;
grant select on table public.funnel_daily to service_role;
revoke all on function public.waitlist_join_pending(text, text, text) from public, anon, authenticated;
revoke all on function public.waitlist_status(text) from public, anon, authenticated;
grant execute on function public.waitlist_join_pending(text, text, text) to service_role;
grant execute on function public.waitlist_status(text) to service_role;

-- Ask the Supabase API to pick up the changes now.
notify pgrst, 'reload schema';
```

## 3. Copy two values from Supabase

1. In the left sidebar, click the gear icon, **Project Settings**.
2. Click **API**. On newer dashboards, the URL is under **Data API** and keys are under **API Keys**.
3. Copy the **Project URL**. It looks like `https://abcdefghijklmnop.supabase.co`.
4. Copy the **service_role** key. Click **Reveal** first. On newer dashboards it is on the **Legacy API keys** tab. A new secret key starting with `sb_secret_` also works.

**Warning: the service_role key is a secret.** It can read and delete every signup. Never share it, never paste it in a chat, an email or a document, and never commit it to the repo. It goes in exactly one place: Vercel, in the next step.

## 4. Add the two values to Vercel

1. Go to https://vercel.com and open the project **time-machine-site**.
2. Click **Settings**, then **Environment Variables**.
3. Add the first variable:
   - Key: `SUPABASE_URL`
   - Value: the Project URL from step 3
   - Environments: tick **Production** and **Preview**
4. Click **Save**.
5. Add the second variable:
   - Key: `SUPABASE_SERVICE_ROLE_KEY`
   - Value: the service_role key from step 3
   - Environments: tick **Production** and **Preview**
   - If Vercel offers a **Sensitive** switch, turn it on.
6. Click **Save**.
7. Tell BOSS or your coding agent: "The Supabase variables are in Vercel. Please redeploy time-machine-site." The site only picks up new variables after a redeploy.

No email settings are needed. The site does not read any.

## 5. Check it works

1. Open https://time-machine-site.vercel.app/api/health in your browser.
2. It should show `{"ok":true,"waitlist":true,"email":false}`. It never shows the key. `email:false` is on purpose: the site sends no email.
3. If it shows `"waitlist":false`, a variable is missing, misspelled, or the URL does not start with `https://`. Fix it in Vercel and ask for another redeploy.
4. Sign up on the live site with your own email. The form should say "Saved as pending and unconfirmed. No email has been sent."
5. In Supabase, open **Table Editor**, then `waitlist`. Your row should be there with `confirmed_at` empty.

The health check only looks at the settings. It does not prove the tables exist or the key works. Step 5 does. If the form says it could not save, the tables are missing or the key is wrong. Run step 2 again, check the key, and redeploy. The Vercel function log shows only a status code from Supabase, never an email or the key.

## 6. Read your numbers

Every site signup is pending. Nobody has a place in line until confirmation is decided and built. Open **SQL Editor**, click **New query**, paste one of these, and click **Run**.

**Newest signups:**

```sql
select email, source, referred_by is not null as came_from_a_friend, created_at
from public.waitlist
order by created_at desc
limit 50;
```

**How many people signed up (pending included):**

```sql
select count(*) as signups from public.waitlist;
```

**The funnel, day by day (UTC), newest first:**

```sql
select * from public.funnel_daily limit 30;
```

The columns are: `visits`, `visits_via_ref` (visits that came from a referral link), `signups` (every signup, pending included), `signups_via_ref` (signups that used someone's referral code), `shares`, `copies`, `confirms` and `unsubscribes`. The last two stay at 0 until confirmation exists.

**Who brought the most friends (pending signups, not public referral credit):**

```sql
select w.email, count(r.id) as friends_joined
from public.waitlist w
join public.waitlist r on r.referred_by = w.ref_code
group by w.email
order by friends_joined desc
limit 20;
```

**Delete one person** (when someone asks to be removed). Replace the example address only in the SQL editor, never in a committed file:

```sql
delete from public.waitlist where email_normalized = lower(trim('person@example.com'));
```

## Free projects pause

Free Supabase projects pause after about a week with no activity. A paused project cannot save signups, and the form will say it could not save. Before any launch or post, open the Supabase dashboard and check the project is active. If it is paused, click **Restore project** and wait for it to come back.
