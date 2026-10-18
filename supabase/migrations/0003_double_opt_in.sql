-- Double opt-in. Safe to run twice after 0001 and 0002.
-- Existing signups stay unconfirmed until they opt in. No automatic emails.
alter table public.waitlist
  add column if not exists confirmed_at timestamptz,
  add column if not exists unsubscribed_at timestamptz,
  add column if not exists confirm_token_hash text unique,
  add column if not exists unsub_token_hash text unique,
  add column if not exists confirm_sent_at timestamptz,
  add column if not exists welcome_sent_at timestamptz,
  add column if not exists welcome_position bigint,
  add column if not exists welcome_total bigint;

-- Only confirmed, subscribed entries and friends count toward the list.
create or replace function public.waitlist_status(p_code text)
returns table ("position" bigint, referrals bigint, total bigint)
language sql stable set search_path = ''
as $$
  with active as (
    select * from public.waitlist where confirmed_at is not null and unsubscribed_at is null
  ), refs as (
    select referred_by as code, count(*) as n from active
    where referred_by is not null group by referred_by
  ), entries as (
    select w.ref_code, w.created_at, coalesce(r.n, 0) as referrals
    from active w left join refs r on r.code = w.ref_code
  )
  select 1 + (select count(*) from entries e
              where e.referrals > me.referrals
                 or (e.referrals = me.referrals and e.created_at < me.created_at)),
         me.referrals, (select count(*) from active)
  from entries me where me.ref_code = p_code;
$$;

-- Replace the old immediate-join RPC completely.
drop function if exists public.waitlist_join(text, text, text);
create or replace function public.waitlist_join(
  p_email text, p_source text, p_ref text, p_confirm_hash text, p_unsub_hash text
)
returns table (send_confirmation boolean)
language plpgsql volatile set search_path = ''
as $$
declare
  v_row public.waitlist%rowtype;
  v_ref text;
begin
  if p_confirm_hash !~ '^[a-f0-9]{64}$' or p_unsub_hash !~ '^[a-f0-9]{64}$'
     or p_confirm_hash is null or p_unsub_hash is null then
    raise exception 'Invalid token hash';
  end if;
  select w.ref_code into v_ref from public.waitlist w
    where p_ref ~ '^[a-z0-9]{10}$' and w.ref_code = p_ref;
  insert into public.waitlist(email, consent, source, referred_by)
    values(p_email, true, p_source, v_ref)
    on conflict(email_normalized) do nothing;
  -- Serialize resends, including concurrent requests for the same address.
  select * into v_row from public.waitlist w
    where w.email_normalized = lower(btrim(p_email)) for update;
  if v_row.confirmed_at is not null or v_row.unsubscribed_at is not null
     or v_row.confirm_sent_at > now() - interval '10 minutes' then
    return;
  end if;
  update public.waitlist set confirm_token_hash = p_confirm_hash,
    unsub_token_hash = p_unsub_hash, confirm_sent_at = now()
    where id = v_row.id;
  return query select true;
end;
$$;

-- Confirm once, but retain the token until the welcome is accepted by Resend.
-- Freeze the first rank for an identical, idempotent welcome payload on retries.
create or replace function public.waitlist_confirm(p_hash text, p_unsub_hash text)
returns table (email text, code text, "position" bigint, total bigint)
language plpgsql volatile set search_path = ''
as $$
declare
  v_email text;
  v_code text;
begin
  if p_unsub_hash is null or p_unsub_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid token hash';
  end if;
  update public.waitlist w set confirmed_at = coalesce(w.confirmed_at, now()),
    unsub_token_hash = p_unsub_hash
    where w.confirm_token_hash = p_hash
      and w.confirm_sent_at >= now() - interval '7 days'
      and w.welcome_sent_at is null and w.unsubscribed_at is null
    returning w.email, w.ref_code into v_email, v_code;
  if v_code is null then return; end if;
  update public.waitlist w set welcome_position = coalesce(w.welcome_position, s."position"),
    welcome_total = coalesce(w.welcome_total, s.total)
    from public.waitlist_status(v_code) s where w.ref_code = v_code;
  return query select v_email, v_code, w.welcome_position, w.welcome_total
    from public.waitlist w where w.ref_code = v_code;
end;
$$;

-- Only called after provider acceptance, which is not proof of inbox delivery.
create or replace function public.waitlist_confirm_complete(p_hash text)
returns table (completed boolean)
language sql volatile set search_path = ''
as $$
  update public.waitlist set confirm_token_hash = null, welcome_sent_at = now()
    where confirm_token_hash = p_hash and confirmed_at is not null and unsubscribed_at is null
    returning true;
$$;

create or replace function public.waitlist_unsubscribe(p_hash text)
returns table (unsubscribed boolean)
language sql volatile set search_path = ''
as $$
  update public.waitlist set unsubscribed_at = coalesce(unsubscribed_at, now()),
    confirm_token_hash = null
  where unsub_token_hash = p_hash
  returning true;
$$;

-- Keep the existing column order and append confirmation/unsubscribe counts.
create or replace view public.funnel_daily with (security_invoker = true) as
with events as (
  select (created_at at time zone 'utc')::date as day,
    count(*) filter (where type = 'visit') as visits,
    count(*) filter (where type = 'visit' and via_ref) as visits_via_ref,
    count(*) filter (where type = 'share') as shares,
    count(*) filter (where type = 'copy') as copies
  from public.funnel_events group by 1
), activity as (
  select (created_at at time zone 'utc')::date as day,
    1 as signup, (referred_by is not null)::integer as via_ref, 0 as confirms, 0 as unsubscribes
    from public.waitlist
  union all
  select (confirmed_at at time zone 'utc')::date, 0, 0, 1, 0
    from public.waitlist where confirmed_at is not null
  union all
  select (unsubscribed_at at time zone 'utc')::date, 0, 0, 0, 1
    from public.waitlist where unsubscribed_at is not null
), signups as (
  select day, sum(signup) as signups, sum(via_ref) as signups_via_ref,
    sum(confirms) as confirms, sum(unsubscribes) as unsubscribes from activity group by day
)
select coalesce(e.day, s.day) as day, coalesce(e.visits, 0) as visits,
  coalesce(e.visits_via_ref, 0) as visits_via_ref, coalesce(s.signups, 0) as signups,
  coalesce(s.signups_via_ref, 0) as signups_via_ref, coalesce(e.shares, 0) as shares,
  coalesce(e.copies, 0) as copies, coalesce(s.confirms, 0) as confirms,
  coalesce(s.unsubscribes, 0) as unsubscribes
from events e full join signups s on e.day = s.day order by 1 desc;

alter table public.waitlist enable row level security;
revoke all on table public.waitlist, public.funnel_daily from public, anon, authenticated;
grant select, insert, update on table public.waitlist to service_role;
grant select on table public.funnel_daily to service_role;
revoke all on function public.waitlist_join(text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.waitlist_confirm(text,text) from public, anon, authenticated;
revoke all on function public.waitlist_confirm_complete(text) from public, anon, authenticated;
revoke all on function public.waitlist_unsubscribe(text) from public, anon, authenticated;
revoke all on function public.waitlist_status(text) from public, anon, authenticated;
grant execute on function public.waitlist_join(text,text,text,text,text) to service_role;
grant execute on function public.waitlist_confirm(text,text) to service_role;
grant execute on function public.waitlist_confirm_complete(text) to service_role;
grant execute on function public.waitlist_unsubscribe(text) to service_role;
grant execute on function public.waitlist_status(text) to service_role;
notify pgrst, 'reload schema';
