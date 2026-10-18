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
