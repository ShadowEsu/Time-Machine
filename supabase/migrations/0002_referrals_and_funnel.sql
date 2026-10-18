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
