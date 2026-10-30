-- Survey answers from the app, and the waitlist's second, optional box ("Email me to ask for feedback.").
-- Apply after 0007, before deploying the site API that calls feedback_add or sends p_feedback_version. Safe to run twice.
-- One transaction: a failure leaves 0007 in place. Needs pg_cron enabled first (section 6): it refuses to apply without it.
--
-- The 0007 API keeps working after this migration: waitlist_join_pending gains one trailing parameter with a default, and
-- PostgREST calls by name, so a call without p_feedback_version records no feedback consent.
--
-- feedback_answers holds what the app's Send posts (apps/web/src/shared/pmf.ts): the four answers, the app version, and the
-- random survey ID the app made at its first Send, and the time. The privacy policy names the survey ID, and people quote it
-- to have their answers deleted, so it is stored as sent. No email, no IP, no client code, no usage counts. One answer per
-- survey ID in any 90 days. Answers are kept 365 days: a daily pg_cron job deletes older ones (section 6), and every
-- feedback call also removes up to 500 of them.

begin;

-- 1. The waitlist's feedback box. Unticked is the default and records nothing else; ticked records its wording and time.
alter table tm_waitlist.waitlist add column if not exists feedback_consent boolean not null default false;
alter table tm_waitlist.waitlist add column if not exists feedback_consent_text_version text;
alter table tm_waitlist.waitlist add column if not exists feedback_consent_at timestamptz;
alter table tm_waitlist.waitlist drop constraint if exists waitlist_feedback_consent_shape;
alter table tm_waitlist.waitlist add constraint waitlist_feedback_consent_shape check (
  (feedback_consent = false and feedback_consent_text_version is null and feedback_consent_at is null)
  or (feedback_consent = true and feedback_consent_text_version ~ '^feedback-[0-9]{4}-[0-9]{2}-[0-9]{2}$' and feedback_consent_at is not null));
comment on column tm_waitlist.waitlist.feedback_consent is
  'True only when the person ticked the separate box "Email me to ask for feedback." Rows saved before 0008: false.';
comment on column tm_waitlist.waitlist.feedback_consent_text_version is
  'The version of the feedback box words this person ticked, as the site sent it. Null when the box was not ticked.';
comment on column tm_waitlist.waitlist.feedback_consent_at is 'When the feedback box was ticked. Null when it was not.';

-- 2. Survey answers. Row level security on and no policies: only feedback_add writes here, and anon reads nothing.
create table if not exists tm_waitlist.feedback_answers (
  id bigint generated always as identity primary key,
  install_id uuid not null,
  q1 text not null check (q1 in ('very', 'somewhat', 'not', 'na')),
  q2 text not null default '' check (char_length(q2) <= 2000),
  q3 text not null default '' check (char_length(q3) <= 2000),
  q4 text not null default '' check (char_length(q4) <= 2000),
  app_version text not null check (app_version ~ '^[0-9A-Za-z.+-]{1,32}$'),
  created_at timestamptz not null default now()
);

comment on table tm_waitlist.feedback_answers is
  'Survey answers the app sent after the person pressed Send: the four answers, the app version, the random survey ID and the time. One per survey ID in any 90 days. Deleted after 365 days by the daily pg_cron job tm-feedback-retention.';

create index if not exists feedback_answers_install_created_idx on tm_waitlist.feedback_answers (install_id, created_at);
create index if not exists feedback_answers_created_at_idx on tm_waitlist.feedback_answers (created_at);

alter table tm_waitlist.feedback_answers enable row level security;
revoke all on table tm_waitlist.feedback_answers from public, anon, authenticated;
grant select on table tm_waitlist.feedback_answers to service_role;

-- 3. A feedback bucket in the per-client limits (0006): 3 a minute and 10 an hour per client.
alter table tm_waitlist.client_calls drop constraint if exists client_calls_bucket_check;
alter table tm_waitlist.client_calls add constraint client_calls_bucket_check
  check (bucket in ('signup', 'status', 'event', 'feedback'));

-- 0006 behavior plus the feedback bucket.
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
    -- Lock order is fixed: a caller takes its global lock (if any) first, then this one, and never
    -- holds two client locks, so calls cannot deadlock. A hash collision only adds waiting.
    perform pg_catalog.pg_advisory_xact_lock(17524577, pg_catalog.hashtext(p_bucket || ':' || p_client));

    v_per_minute := case p_bucket when 'signup' then 5 when 'status' then 30 when 'event' then 60 when 'feedback' then 3 end;
    v_per_hour := case p_bucket when 'signup' then 20 when 'feedback' then 10 end;

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

-- 4. Saves one set of answers. Returns saved = false, and stores nothing, when this survey ID already answered in the last
-- 90 days. Refuses malformed input before any limit is taken. Global cap: 60 calls a minute.
create or replace function tm_waitlist.feedback_add(
  p_install_id uuid,
  p_q1 text,
  p_q2 text,
  p_q3 text,
  p_q4 text,
  p_app_version text,
  p_client text default null)
returns table (saved boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
begin
  -- Same rules as the table and the site API. Do not echo values: an answer is free text.
  if p_install_id is null
     or p_q1 is null or p_q1 not in ('very', 'somewhat', 'not', 'na')
     or p_q2 is null or char_length(p_q2) > 2000
     or p_q3 is null or char_length(p_q3) > 2000
     or p_q4 is null or char_length(p_q4) > 2000
     or p_app_version is null or p_app_version !~ '^[0-9A-Za-z.+-]{1,32}$' then
    raise exception using errcode = '22023', message = 'invalid_feedback';
  end if;

  -- One lock for all feedback calls makes the 90-day check and the insert atomic, across API instances and direct callers.
  perform pg_catalog.pg_advisory_xact_lock(17524576, 3);
  v_now := clock_timestamp();

  if (select count(*) from (
        select 1 from tm_waitlist.feedback_answers f where f.created_at >= v_now - interval '1 minute' limit 60
      ) recent) >= 60 then
    raise exception using errcode = 'PT429', message = 'rate_limited';
  end if;

  perform tm_waitlist.client_call_take(p_client, 'feedback', v_now);

  -- Retention: answers are kept 365 days. Bounded and indexed; runs on every accepted call, refused answers included.
  delete from tm_waitlist.feedback_answers f
  using (
    select old.id from tm_waitlist.feedback_answers old
    where old.created_at < v_now - interval '365 days'
    order by old.created_at limit 500
  ) expired
  where f.id = expired.id;

  if exists (
    select 1 from tm_waitlist.feedback_answers f
    where f.install_id = p_install_id and f.created_at >= v_now - interval '90 days'
  ) then
    return query select false;
    return;
  end if;

  insert into tm_waitlist.feedback_answers (install_id, q1, q2, q3, q4, app_version, created_at)
  values (p_install_id, p_q1, p_q2, p_q3, p_q4, p_app_version, v_now);
  return query select true;
end;
$$;

-- Anon only: the site API calls it with the anon key. Nobody else may execute it.
revoke all on function tm_waitlist.feedback_add(uuid, text, text, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function tm_waitlist.feedback_add(uuid, text, text, text, text, text, text) to anon;

-- 5. waitlist_join_pending: 0007 behavior plus the optional feedback box. The argument list changes, so the 0007 signature
-- goes; keeping both would make PostgREST calls ambiguous. A call without p_feedback_version (the 0007 API) still works.
drop function if exists tm_waitlist.waitlist_join_pending(text, text, text, text, text);

create or replace function tm_waitlist.waitlist_join_pending(
  p_email text, p_consent_version text, p_source text default null, p_ref text default null, p_client text default null,
  p_feedback_version text default null)
returns table (saved boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
begin
  if p_consent_version is null or p_consent_version !~ '^waitlist-[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception using errcode = '22023', message = 'consent_version_required';
  end if;
  -- Null: the feedback box was not ticked. Anything else must name a wording.
  if p_feedback_version is not null and p_feedback_version !~ '^feedback-[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception using errcode = '22023', message = 'feedback_version_invalid';
  end if;

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

  -- An existing row is never changed (0003), so nobody who knows an email can rewrite what that person agreed to, the
  -- feedback box included. The answer stays the same for new and known emails.
  insert into tm_waitlist.waitlist (email, consent, consent_text_version, source, referred_by, feedback_consent, feedback_consent_text_version, feedback_consent_at)
  values (
    p_email,
    true,
    p_consent_version,
    p_source,
    (select w.ref_code from tm_waitlist.waitlist w where p_ref ~ '^[a-z0-9]{10}$' and w.ref_code = p_ref),
    p_feedback_version is not null,
    p_feedback_version,
    case when p_feedback_version is not null then v_now end
  )
  on conflict (email_normalized) do nothing;
  return query select true;
end;
$$;

-- A new function starts with default grants. Re-apply 0004: anon and service_role may execute, nobody else.
revoke all on function tm_waitlist.waitlist_join_pending(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function tm_waitlist.waitlist_join_pending(text, text, text, text, text, text) to anon, service_role;

-- 6. Retention, enforced on a schedule: every day at 03:17 UTC, answers older than 365 days are deleted, whether or not new
-- answers arrive. Needs pg_cron (Supabase: Database > Extensions > pg_cron). Without it this migration stops here and the
-- whole transaction rolls back. Scheduling the same job name again replaces it, so a second run keeps one job.
do $$
begin
  if pg_catalog.to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception using errcode = '55000',
      message = 'Enable the pg_cron extension (Database > Extensions) before applying 0008: it deletes survey answers older than 365 days every day.';
  end if;
  perform cron.schedule('tm-feedback-retention', '17 3 * * *',
    $job$delete from tm_waitlist.feedback_answers where created_at < now() - interval '365 days'$job$);
end;
$$;

notify pgrst, 'reload schema';

commit;
