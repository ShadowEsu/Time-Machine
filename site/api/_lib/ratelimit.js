// Per-client request limits for the sign-in, account, license and checkout functions. Pure: no Vercel.
// Best effort, per function instance: a cold start forgets it. Supabase and Stripe keep their own limits too.
import { randomBytes } from "node:crypto";
import { clientId } from "./waitlist.js";

const HOUR_MS = 60 * 60 * 1000;
const TEN_MIN_MS = 10 * 60 * 1000;
// license and checkout each call Stripe, so their limits keep one client from using up the Stripe
// account's API rate limit for every buyer (Security L2).
export const LIMITS = { send: 5, verify: 20, account: 60, license: 30, checkout: 10 };
const WINDOWS_MS = { send: HOUR_MS, verify: HOUR_MS, account: HOUR_MS, license: TEN_MIN_MS, checkout: TEN_MIN_MS };
const buckets = new Map();
// Checkout and license have no shared secret meant for this, so their client codes use a key that lives
// only as long as the counts do. The raw IP is never kept.
const INSTANCE_KEY = randomBytes(32).toString("base64url");

// The one-way client code for an IP, for buckets that have no configured key of their own.
export function instanceClient(ip) {
  return clientId(ip, INSTANCE_KEY);
}

// True when this client has used up its window for the bucket. Counts per one-way client code; without
// an IP every caller shares one global count. Call `resetRateLimits` in tests.
export function rateLimited(bucket, client, now = Date.now()) {
  const key = `${bucket}:${client ?? "*"}`;
  let entry = buckets.get(key);
  if (!entry || now - entry.start >= WINDOWS_MS[bucket]) {
    entry = { start: now, count: 0 };
    buckets.set(key, entry);
    if (buckets.size > 10000) buckets.clear();
  }
  entry.count += 1;
  return entry.count > LIMITS[bucket];
}

export function resetRateLimits() {
  buckets.clear();
}
