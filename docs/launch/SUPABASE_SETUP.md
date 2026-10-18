# Supabase and Resend setup for the waitlist

This guide is for Preston. You do not need to write code. The double opt-in flow is built, but real Supabase and Resend setup and email delivery have not been verified.

After setup and redeployment, the form saves a pending signup and sends a confirmation email. It shows no referral code or card yet. Clicking the confirmation link activates the signup, opens the referral card and sends a welcome email. Only confirmed, subscribed people count in positions, totals and referral credit.

## What gets stored

- **Each signup:** email, consent, source page, signup time, referral codes, confirmation and unsubscribe state, send timing and SHA-256 token hashes. Raw tokens are not stored.
- **Email links:** confirmation tokens are single-use and expire after 7 days. Confirmation resends have a 10-minute cooldown. Unsubscribe tokens do not expire. Confirmation replaces the initial unsubscribe link with a new one in the welcome email.
- **Funnel counts:** event type (visit, share or copy), page path, referral flag and time. No email or code.
- **Never stored:** IP addresses, browser details or cookies.

Only the site's server functions can read or write this data. The public key has no access. The only automatic emails are confirmation and welcome. Either email has an unsubscribe link. Opening it with GET changes nothing. Pressing the button sends POST and stops the subscription. A later signup does not silently reactivate it.

## 1. Create the Supabase project

1. Go to https://supabase.com and sign in.
2. Click **New project**.
3. Pick your organization. Choose the **Free** plan.
4. Name it `time-machine`.
5. Make up a strong database password and save it in your password manager. You will not need it for this guide.
6. For **Region**, pick a West US option (for example West US, North California).
7. Click **Create new project**. Wait until it says the project is ready. This takes a minute or two.

## 2. Apply migrations 0001 + 0002 + 0003

1. In the left sidebar, click **SQL Editor**.
2. Click **New query**.
3. Copy the whole SQL block below, from the first line to the last. Paste it into the editor.
4. Click **Run**.
5. You should see "Success. No rows returned". Notices that say "already exists, skipping" are fine.
6. In the left sidebar, click **Table Editor**. You should see two tables: `waitlist` and `funnel_events`. Both are empty.

The block supports reruns without creating duplicate tables or signups. Existing rows are not proof of email confirmation.

It combines `supabase/migrations/0001_waitlist.sql`, `supabase/migrations/0002_referrals_and_funnel.sql` and `supabase/migrations/0003_double_opt_in.sql`, in that order. Run the whole block so the final double opt-in functions replace the earlier signup behavior.

```sql
-- Time Machine waitlist.
-- Stores an email, the consent tick, and the page the person signed up from.
-- No IP addresses, no user agents, nothing else.

create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null check (char_length(email) between 3 and 254),
  email_normalized text generated always as (lower(btrim(email))) stored,
  consent boolean not null check (consent),
  source text check (source is null or char_length(source) <= 200),
  created_at timestamptz not null default now(),
  constraint waitlist_email_normalized_key unique (email_normalized)
);

comment on table public.waitlist is
  'Waitlist signups. Written only by the site API with the service role key.';

-- Row level security on, and no policies at all.
-- The anon and authenticated roles can do nothing with this table.
-- The service role bypasses row level security and is the only writer.
alter table public.waitlist enable row level security;

revoke all on table public.waitlist from anon, authenticated;
grant select, insert on table public.waitlist to service_role;

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
create or replace view public.funnel_daily
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
```

## 3. Copy two values from Supabase

1. In the left sidebar, click the gear icon, **Project Settings**.
2. Click **API**. On newer dashboards, the URL is under **Data API** and keys are under **API Keys**.
3. Copy the **Project URL**. It looks like `https://abcdefghijklmnop.supabase.co`.
4. Copy the **service_role** key. Click **Reveal** first. On newer dashboards it is on the **Legacy API keys** tab. A new secret key starting with `sb_secret_` also works.

The service role key is a secret. It can read and change the data. Save it in your password manager. Never paste it into chat, an email, a document or the repo. It goes in Vercel in step 5.

## 4. Set up a free Resend account and sending domain

1. Go to https://resend.com and create a free account, or sign in to the account you want to use.
2. Click **Domains**, then **Add domain**, and enter `unvibe.site`. If it is already listed, open it.
3. Leave the domain page open. It shows the DNS records needed to verify sending.
4. In another tab, open the DNS settings where you manage `unvibe.site`.
5. Add each record Resend shows. Copy the exact **Type**, **Name** and **Value** from Resend. Use its shown settings for any other fields. Do not invent record values or remove unrelated records.
6. Go back to Resend and click **Verify**. Wait until it shows the sending domain is verified.
7. Open **API Keys** and click **Create API Key**. Create a key with permission to send from this domain.
8. Save the key in your password manager. Do not put it in chat or the repo.

No domain or provider configuration is assumed to be complete. The sender will default to `Time Machine <timemachine@unvibe.site>`, which requires `unvibe.site` to be verified in your Resend account.

## 5. Add the settings to Vercel, then ask for a redeploy

1. Go to https://vercel.com and open **time-machine-site**.
2. Click **Settings**, then **Environment Variables**.
3. Add each required variable below. Copy its name exactly and paste its value. Select **Production** and **Preview**, then click **Save** for each one.
4. For secret keys, turn on **Sensitive** if Vercel offers it.
5. The last two settings are optional. Leave them unset to use the defaults shown, or save your own sender and public site address.

| Name | Status | Value |
|---|---|---|
| `SUPABASE_URL` | Required | Project URL from step 3, starting with `https://` |
| `SUPABASE_SERVICE_ROLE_KEY` | Required, secret | Supabase service role key from step 3 |
| `RESEND_API_KEY` | Required, secret | Resend API key from step 4 |
| `WAITLIST_FROM` | Optional, default | `Time Machine <timemachine@unvibe.site>` |
| `SITE_URL` | Optional, default | `https://time-machine-site.vercel.app` |

Any custom sender must use a domain verified in your Resend account. `SITE_URL` is the public address used for email links.

Tell BOSS or the coding agent: "Supabase, Resend and DNS are configured. Please redeploy time-machine-site." New variables only take effect after a redeploy.

## 6. Understand readiness

After redeployment, open https://time-machine-site.vercel.app/api/health. It should show `{"ok":true,"waitlist":true,"email":true}`. This checks configuration presence and the Supabase URL shape only. It does not contact Supabase or Resend, check tables, verify the domain or prove delivery.

- `waitlist:false`: a Supabase variable is missing or the URL does not start with `https://`. Fix it in Vercel and ask for another redeploy.
- `email:false`: check `RESEND_API_KEY`. Without it, signup returns `503`.
- Resend send failure: signup returns `502`. The pending row stays saved. The 10-minute resend cooldown still applies.
- Welcome send failure: the row stays confirmed and the confirmation token stays consumed. There is no automatic welcome retry.

A successful signup returns `200 {"ok":true,"pending":true}`. Only after confirmation does `/api/waitlist?code=CODE` return `ok`, `position`, `referrals` and `total`. Pending and unsubscribed codes return `404`. A valid confirmation link opens `/confirmed.html?code=CODE`; invalid, used or expired links open `/confirmed.html?error=invalid`.

Use synthetic data for local checks. Do not run a real signup or send a test email without separate founder approval. Seeing a pending row in **Table Editor → waitlist** proves storage only, not delivery.

## 7. Read your numbers

For the current subscriber list, open **Table Editor → waitlist**. Filter `confirmed_at` to not null and `unsubscribed_at` to null. Only these rows count in public positions and totals. Referral credit also requires the friend to be confirmed and subscribed.

The SQL reports below include raw signup history. They are not all active-subscriber reports. Open **SQL Editor**, click **New query**, paste one report and click **Run**.

**Newest stored signups, including pending and unsubscribed rows:**

```sql
select email, source, referred_by is not null as came_from_a_friend, created_at
from public.waitlist
order by created_at desc
limit 50;
```

**All stored signups, not the confirmed subscriber total:**

```sql
select count(*) as signups from public.waitlist;
```

**The funnel, day by day (UTC), newest first:**

```sql
select * from public.funnel_daily limit 30;
```

The funnel columns include `visits`, `visits_via_ref`, `signups`, `signups_via_ref`, `shares` and `copies`. Migration `0003` adds `confirms` and `unsubscribes`. Signup columns are raw signup history, not current subscribers. Confirmation and unsubscribe columns record those actions by day.

**Raw referred signups by person, including pending and unsubscribed rows. This is not public referral credit:**

```sql
select w.email, count(r.id) as friends_joined
from public.waitlist w
join public.waitlist r on r.referred_by = w.ref_code
group by w.email
order by friends_joined desc
limit 20;
```

**Delete one person**, only when they ask for deletion. For stopping mail, they can use the unsubscribe link in their email at any time. Replace the synthetic example address only in the SQL editor, never in a committed file:

```sql
delete from public.waitlist where email_normalized = lower(trim('person@example.com'));
```

## Free projects pause

Free Supabase projects pause after about a week with no activity. A paused project cannot save signups, and the form will say it could not save. Before any launch or post, open the Supabase dashboard and check the project is active. If it is paused, click **Restore project** and wait for it to come back.
