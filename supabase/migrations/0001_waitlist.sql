-- Time Machine waitlist.
-- Stores an email, the consent tick, and the page the person signed up from.
-- No IP addresses, no user agents, nothing else.

-- Everything lives in its own schema, so the waitlist can share a Supabase project without
-- touching that project's public schema.
create schema if not exists tm_waitlist;

create table if not exists tm_waitlist.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null check (char_length(email) between 3 and 254),
  email_normalized text generated always as (lower(btrim(email))) stored,
  consent boolean not null check (consent),
  source text check (source is null or char_length(source) <= 200),
  created_at timestamptz not null default now(),
  constraint waitlist_email_normalized_key unique (email_normalized)
);

comment on table tm_waitlist.waitlist is
  'Waitlist signups. Written only by the site API with the service role key.';

-- Row level security on, and no policies at all.
-- The anon and authenticated roles can do nothing with this table.
-- The service role bypasses row level security and is the only writer.
alter table tm_waitlist.waitlist enable row level security;

revoke all on table tm_waitlist.waitlist from anon, authenticated;
grant select, insert on table tm_waitlist.waitlist to service_role;
