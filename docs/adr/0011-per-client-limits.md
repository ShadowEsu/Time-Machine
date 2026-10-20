# ADR 0011: Per-client public request limits

Status: accepted

## Decision

Enforce per-client limits in Supabase migration `0006`. The site API derives a 22-character client code with `HMAC-SHA256(SUPABASE_KEY, "tm-client-v1:" + ip)`. It reads the client IP from Vercel's overwritten `x-forwarded-for` header, then `x-real-ip`.

Limits per client:

| Endpoint | Limit |
|---|---|
| Signup | 5 calls per minute and 20 per hour |
| Referral status | 30 lookups per minute |
| Event | 60 events per minute |

Over the limit, the database raises `PT429`. The API returns `429 rate_limited` with `Retry-After: 60`.

## Why

Vercel functions do not share memory, so in-memory counters reset across instances. A database counter is shared by every function instance. Advisory transaction locks make count and insert atomic.

The raw IP never leaves the function. The HMAC code is stable for a short abuse window and is not reversible without the server-side key. It changes if the key changes.

## Retention and privacy

Only the last hour counts. Later keyed calls, signups and events remove up to 500 older rows at a time. With no later traffic, old rows remain until cleanup runs. Health checks call status without a client code and stay read-only.

## Limits of this control

Direct PostgREST callers can use the public anon key and omit or spoof `p_client`. The global caps from `0005` still bind their writes. Invalid requests rejected by the API never reach Supabase and do not consume a database bucket.
