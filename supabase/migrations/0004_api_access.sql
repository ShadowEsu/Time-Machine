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
