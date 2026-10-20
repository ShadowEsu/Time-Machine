-- Per-client limits on the three public functions. Apply after 0005, and before deploying the site
-- API that sends p_client. Safe to run twice. One transaction: a failure leaves 0005 in place.
--
-- The site API sends p_client: a one-way code (HMAC of the caller's IP, keyed with the API key,
-- 22 characters). The IP itself never reaches the database. p_client defaults to null, so the API
-- deployed before this migration keeps working; a null client gets only the global 0005 caps.
-- Direct PostgREST callers holding the anon key can omit or change p_client. Only the global caps bind them.
--
-- Limits per client: signup 5 per minute and 20 per hour, status 30 per minute, event 60 per minute.
-- Like 0005, signup limits count calls, not stored rows: a duplicate email uses a slot like a new one.

begin;

-- One row per accepted call that carried a client code. Only the last hour is counted. Older rows are
-- removed in batches during later calls; with no later calls, old rows stay until the next one.
create table if not exists tm_waitlist.client_calls (
  client text not null check (char_length(client) between 16 and 64),
  bucket text not null check (bucket in ('signup', 'status', 'event')),
  created_at timestamptz not null default now()
);

comment on table tm_waitlist.client_calls is
  'One row per accepted public call: a one-way client code (never an IP), the function, the time. Only the last hour is counted; older rows are removed in batches of up to 500 during later calls, not on a schedule.';

create index if not exists client_calls_client_bucket_created_at_idx
  on tm_waitlist.client_calls (client, bucket, created_at);
-- Retention scans oldest rows first; without this it would scan the whole table.
create index if not exists client_calls_created_at_idx on tm_waitlist.client_calls (created_at);

-- Row level security on, and no policies at all. Only the functions below write here.
alter table tm_waitlist.client_calls enable row level security;
revoke all on table tm_waitlist.client_calls from public, anon, authenticated;

-- Shared check for one client. Callable only by the function owner, through the security definer
-- functions below. Raises PT429 before writing anything; the raise rolls back the whole call.
-- Every call (even with a null client) removes up to 500 rows older than an hour.
create or replace function tm_waitlist.client_call_take(p_client text, p_bucket text, p_now timestamptz)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_per_minute int;
  v_per_hour int;
begin
  if p_client is not null then
    -- Do not echo the value: it is opaque, and a raw check error would name the column.
    if char_length(p_client) not between 16 and 64 then
      raise exception using errcode = '22023', message = 'invalid_client';
    end if;
    -- Make count-then-insert atomic per (bucket, client), across API instances and direct callers.
    -- Lock order is fixed: a caller takes its global 0005 lock (if any) first, then this one, and never
    -- holds two client locks, so calls cannot deadlock. A hash collision only adds waiting.
    perform pg_catalog.pg_advisory_xact_lock(17524577, pg_catalog.hashtext(p_bucket || ':' || p_client));

    v_per_minute := case p_bucket when 'signup' then 5 when 'status' then 30 when 'event' then 60 end;
    v_per_hour := case p_bucket when 'signup' then 20 end;

    if (select count(*) from (
          select 1 from tm_waitlist.client_calls c
          where c.client = p_client and c.bucket = p_bucket and c.created_at >= p_now - interval '1 minute'
          limit v_per_minute
        ) recent) >= v_per_minute
       or (v_per_hour is not null and (select count(*) from (
          select 1 from tm_waitlist.client_calls c
          where c.client = p_client and c.bucket = p_bucket and c.created_at >= p_now - interval '1 hour'
          limit v_per_hour
        ) recent) >= v_per_hour) then
      raise exception using errcode = 'PT429', message = 'rate_limited';
    end if;

    insert into tm_waitlist.client_calls (client, bucket, created_at) values (p_client, p_bucket, p_now);
  end if;

  -- Bounded, indexed, opportunistic cleanup. Rows older than the longest window are never counted again.
  delete from tm_waitlist.client_calls c
  where c.ctid = any (array(
    select old.ctid from tm_waitlist.client_calls old
    where old.created_at < p_now - interval '1 hour'
    order by old.created_at limit 500
  ));
end;
$$;

revoke all on function tm_waitlist.client_call_take(text, text, timestamptz) from public, anon, authenticated;

-- The argument lists change, so the old signatures go. Keeping both would make PostgREST calls ambiguous.
drop function if exists tm_waitlist.waitlist_join_pending(text, text, text);
drop function if exists tm_waitlist.waitlist_status(text);
drop function if exists tm_waitlist.funnel_event_add(text, text, boolean);

-- 0005 behavior plus the per-client check. Both checks run before any write.
create or replace function tm_waitlist.waitlist_join_pending(
  p_email text, p_source text default null, p_ref text default null, p_client text default null)
returns table (saved boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(17524576, 1);
  v_now := clock_timestamp();

  if (select count(*) from (
        select 1 from tm_waitlist.waitlist_join_attempts a where a.created_at >= v_now - interval '1 minute' limit 60
      ) recent) >= 60
     or (select count(*) from (
        select 1 from tm_waitlist.waitlist_join_attempts a where a.created_at >= v_now - interval '1 hour' limit 1000
      ) recent) >= 1000 then
    raise exception using errcode = 'PT429', message = 'rate_limited';
  end if;

  -- Per-client check, then its slot. Runs before the email is looked at, so new and known emails cost the same.
  perform tm_waitlist.client_call_take(p_client, 'signup', v_now);

  insert into tm_waitlist.waitlist_join_attempts (created_at) values (v_now);

  delete from tm_waitlist.waitlist_join_attempts a
  using (
    select old.id from tm_waitlist.waitlist_join_attempts old
    where old.created_at < v_now - interval '1 hour'
    order by old.created_at limit 500
  ) expired
  where a.id = expired.id;

  insert into tm_waitlist.waitlist (email, consent, source, referred_by)
  values (
    p_email,
    true,
    p_source,
    (select w.ref_code from tm_waitlist.waitlist w where p_ref ~ '^[a-z0-9]{10}$' and w.ref_code = p_ref)
  )
  on conflict (email_normalized) do nothing;
  return query select true;
end;
$$;

-- Same answer as 0003: place, friends and total for one code, or no row. Now volatile, since it records the call.
create or replace function tm_waitlist.waitlist_status(p_code text, p_client text default null)
returns table ("position" bigint, referrals bigint, total bigint)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- The unkeyed lookup also serves /api/health. Keep that path strictly read-only.
  if p_client is not null then
    perform tm_waitlist.client_call_take(p_client, 'status', clock_timestamp());
  end if;

  return query
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
end;
$$;

create or replace function tm_waitlist.funnel_event_add(
  p_type text, p_path text, p_via_ref boolean default false, p_client text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
begin
  if p_type is null or p_type not in ('visit', 'share', 'copy')
     or p_path is null or p_path !~ '^/[A-Za-z0-9._~/-]{0,199}$' then
    raise exception using errcode = '22023', message = 'invalid_event';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(17524576, 2);
  v_now := clock_timestamp();
  if (select count(*) from (
        select 1 from tm_waitlist.funnel_events f where f.created_at >= v_now - interval '1 minute' limit 300
      ) recent) >= 300 then
    raise exception using errcode = 'PT429', message = 'rate_limited';
  end if;

  perform tm_waitlist.client_call_take(p_client, 'event', v_now);

  delete from tm_waitlist.funnel_events f
  using (
    select old.id from tm_waitlist.funnel_events old
    where old.created_at < v_now - interval '90 days'
    order by old.created_at limit 500
  ) expired
  where f.id = expired.id;

  insert into tm_waitlist.funnel_events (type, path, via_ref, created_at)
  values (p_type, p_path, coalesce(p_via_ref, false), v_now);
end;
$$;

-- New functions start with default grants. Re-apply 0004: anon and service_role may execute, nobody else.
revoke all on function tm_waitlist.waitlist_join_pending(text, text, text, text) from public, anon, authenticated;
revoke all on function tm_waitlist.waitlist_status(text, text) from public, anon, authenticated;
revoke all on function tm_waitlist.funnel_event_add(text, text, boolean, text) from public, anon, authenticated;
grant execute on function tm_waitlist.waitlist_join_pending(text, text, text, text) to anon, service_role;
grant execute on function tm_waitlist.waitlist_status(text, text) to anon, service_role;
grant execute on function tm_waitlist.funnel_event_add(text, text, boolean, text) to anon, service_role;

notify pgrst, 'reload schema';

commit;
