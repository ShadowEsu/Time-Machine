-- Bound the public RPC surface, including callers that bypass the website API.
-- Apply after 0004. Touches only tm_waitlist objects; no new service, IP or browser identifier.
-- Signup limits count calls, not stored rows. A duplicate email uses a slot exactly like a new one,
-- so neither the cap nor its 429 can reveal whether an email is already on the list.

-- One timestamp per accepted signup call. No email, IP, source or code: nothing that names a person.
create table if not exists tm_waitlist.waitlist_join_attempts (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now()
);

comment on table tm_waitlist.waitlist_join_attempts is
  'One timestamp per accepted signup call, kept about an hour to enforce the signup cap. No personal data.';

create index if not exists waitlist_join_attempts_created_at_idx on tm_waitlist.waitlist_join_attempts (created_at);
create index if not exists funnel_events_created_at_idx on tm_waitlist.funnel_events (created_at);

-- Row level security on, and no policies at all. Only the security definer function writes here.
alter table tm_waitlist.waitlist_join_attempts enable row level security;
revoke all on table tm_waitlist.waitlist_join_attempts from public, anon, authenticated;

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

  -- Check before any write: the PT429 exception rolls back the whole call, so a refused call
  -- records nothing and cannot keep the window full by itself. LIMIT bounds each indexed count.
  if (select count(*) from (
        select 1 from tm_waitlist.waitlist_join_attempts a where a.created_at >= v_now - interval '1 minute' limit 60
      ) recent) >= 60
     or (select count(*) from (
        select 1 from tm_waitlist.waitlist_join_attempts a where a.created_at >= v_now - interval '1 hour' limit 1000
      ) recent) >= 1000 then
    raise exception using errcode = 'PT429', message = 'rate_limited';
  end if;

  -- Every accepted call costs one slot, whether or not the email is new.
  insert into tm_waitlist.waitlist_join_attempts (created_at) values (v_now);

  -- Bounded, indexed cleanup. Attempts older than the hourly window are never counted again.
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
