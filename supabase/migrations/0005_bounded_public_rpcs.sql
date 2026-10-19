-- Bound the public RPC surface, including callers that bypass the website API.
-- Apply after 0004. Touches only tm_waitlist objects; no new service, IP or browser identifier.
-- Limits count stored rows, not requests. At capacity every caller (including duplicates) gets 429,
-- so the cap cannot turn into an email membership probe. Otherwise duplicates are quiet pending success.

create index if not exists waitlist_created_at_idx on tm_waitlist.waitlist (created_at);
create index if not exists funnel_events_created_at_idx on tm_waitlist.funnel_events (created_at);

-- NOT VALID keeps historical rows untouched, while enforcing the rule on every new write.
-- The existing type constraint already restricts events to visit/share/copy.
alter table tm_waitlist.funnel_events drop constraint if exists funnel_events_path_format;
alter table tm_waitlist.funnel_events add constraint funnel_events_path_format
  check (path ~ '^/[A-Za-z0-9._~/-]{0,199}$') not valid;

create or replace function tm_waitlist.waitlist_join_pending(p_email text, p_source text default null, p_ref text default null)
returns table (saved boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
begin
  -- Serialize the check and insert across serverless instances and direct PostgREST callers.
  -- Two-int advisory keys are namespaced for these two tm_waitlist writers only.
  perform pg_catalog.pg_advisory_xact_lock(17524576, 1);
  v_now := clock_timestamp();

  -- LIMIT bounds each indexed count even if privileged imports exceed these limits.
  if (select count(*) from (
        select 1 from tm_waitlist.waitlist w where w.created_at >= v_now - interval '1 minute' limit 60
      ) recent) >= 60
     or (select count(*) from (
        select 1 from tm_waitlist.waitlist w where w.created_at >= v_now - interval '1 hour' limit 1000
      ) recent) >= 1000 then
    raise exception using errcode = 'PT429', message = 'rate_limited';
  end if;

  -- Use the post-lock time, not the transaction start time, for the rolling window.
  insert into tm_waitlist.waitlist (email, consent, source, referred_by, created_at)
  values (
    p_email,
    true,
    p_source,
    (select w.ref_code from tm_waitlist.waitlist w where p_ref ~ '^[a-z0-9]{10}$' and w.ref_code = p_ref),
    v_now
  )
  on conflict (email_normalized) do nothing;
  return query select true;
end;
$$;

create or replace function tm_waitlist.funnel_event_add(p_type text, p_path text, p_via_ref boolean default false)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
begin
  -- Do not echo supplied values in errors: a rejected path could contain personal data.
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

  -- Opportunistic, indexed and bounded cleanup; inactive sites may retain older rows until the next event.
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

-- CREATE OR REPLACE preserves the existing signatures and grants from 0004.
notify pgrst, 'reload schema';
