-- Which words each person agreed to (consent audit T2). Apply after 0006, immediately before deploying the site API that
-- sends p_consent_version: the 0006 API calls the old signature, which this drops, so signups fail between the two.
-- Safe to run twice. One transaction: a failure leaves 0006 in place.
--
-- Every waitlist box sends its wording's version (for example waitlist-2026-10-28; the site keeps the current one in
-- site/api/_lib/waitlist.js WAITLIST_CONSENT_VERSION). Rows saved before this migration recorded no version, so they get
-- 'unrecorded', never a version nobody saw. A join without a well-formed version is refused, direct PostgREST callers too.

begin;

alter table tm_waitlist.waitlist add column if not exists consent_text_version text;
update tm_waitlist.waitlist set consent_text_version = 'unrecorded' where consent_text_version is null;
alter table tm_waitlist.waitlist alter column consent_text_version set not null;
alter table tm_waitlist.waitlist drop constraint if exists waitlist_consent_text_version_shape;
alter table tm_waitlist.waitlist add constraint waitlist_consent_text_version_shape
  check (consent_text_version = 'unrecorded' or consent_text_version ~ '^waitlist-[0-9]{4}-[0-9]{2}-[0-9]{2}$');
comment on column tm_waitlist.waitlist.consent_text_version is
  'The version of the words by the box this person ticked, as the site sent it. unrecorded: saved before 0007.';

-- The argument list changes, so the 0006 signature goes. Keeping both would make PostgREST calls ambiguous.
drop function if exists tm_waitlist.waitlist_join_pending(text, text, text, text);

-- 0006 behavior plus the version. It is checked before the rate limits, so a refused call takes no slot.
create or replace function tm_waitlist.waitlist_join_pending(
  p_email text, p_consent_version text, p_source text default null, p_ref text default null, p_client text default null)
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

  -- An existing row is never changed (0003), so an unsubscribed person is not added back and nobody who knows an email
  -- can rewrite what that person agreed to. The answer stays the same for new and known emails.
  insert into tm_waitlist.waitlist (email, consent, consent_text_version, source, referred_by)
  values (
    p_email,
    true,
    p_consent_version,
    p_source,
    (select w.ref_code from tm_waitlist.waitlist w where p_ref ~ '^[a-z0-9]{10}$' and w.ref_code = p_ref)
  )
  on conflict (email_normalized) do nothing;
  return query select true;
end;
$$;

-- A new function starts with default grants. Re-apply 0004: anon and service_role may execute, nobody else.
revoke all on function tm_waitlist.waitlist_join_pending(text, text, text, text, text) from public, anon, authenticated;
grant execute on function tm_waitlist.waitlist_join_pending(text, text, text, text, text) to anon, service_role;

notify pgrst, 'reload schema';

commit;
