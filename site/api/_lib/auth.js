// Sign-in and account core. Pure: no Vercel, no globals. Fetch, env and log are injected.
// A buyer signs in with a one-time code that Supabase Auth emails them, then sees every key for the
// email they paid with. Keys are derived from Stripe's own records, so the site keeps no license table.
// Rules: never log the email, the code, the token, the anon key or the Stripe key. Never fake a key.
import { z } from "zod";
import { isCheckoutConfigured, reply, STRIPE_API, stripeHeaders, UPSTREAM_TIMEOUT_MS } from "./checkout.js";
import { isTmPurchase, licenseFor, SessionSchema } from "./license.js";
import { clientId, isAllowedOrigin, isValidEmail, normalizeEmail, readJsonObject, supabaseOrigin } from "./waitlist.js";

export const MAX_AUTH_BYTES = 2048;
const MAX_STRIPE_PAGES = 10;
const WINDOW_MS = 60 * 60 * 1000;
// Best effort, per function instance: a cold start forgets it. Supabase and Stripe keep their own limits too.
export const LIMITS = { send: 5, verify: 20, account: 60 };
const buckets = new Map();

// Sign-in is set up only when both SUPABASE_URL and SUPABASE_ANON_KEY are present. There is no
// fallback to SUPABASE_KEY on purpose: turning on Supabase Auth is a separate decision from the waitlist
// (see docs/launch/CHECKOUT_SETUP.md), so it needs its own setting.
export function isAuthConfigured(env) {
  return Boolean(env && env.SUPABASE_ANON_KEY && supabaseOrigin(env));
}

// True when this client has used up its hour for the bucket. Counts per one-way client code; without
// an IP every caller shares one global count. Call `resetRateLimits` in tests.
export function rateLimited(bucket, client, now = Date.now()) {
  const key = `${bucket}:${client ?? "*"}`;
  let entry = buckets.get(key);
  if (!entry || now - entry.start >= WINDOW_MS) {
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
const rateLimitReply = () => reply(429, { ok: false, error: "rate_limited" }, { "Retry-After": "60" });

const Email = z.string().max(254).transform(normalizeEmail).refine(isValidEmail);
const AuthBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send"), email: Email }),
  z.object({ action: z.literal("verify"), email: Email, code: z.string().regex(/^\d{6,10}$/) }),
]);
const VerifyReply = z.object({ access_token: z.string().min(1), expires_in: z.number().int().positive() });
const UserReply = z.object({ email: z.string().max(254).transform(normalizeEmail).refine(isValidEmail) });
const SessionsPage = z.object({
  data: z.array(SessionSchema),
  has_more: z.boolean(),
});

function authHeaders(env, token) {
  const headers = { apikey: env.SUPABASE_ANON_KEY, "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * POST {action:"send", email} emails a code. POST {action:"verify", email, code} trades it for a token.
 * @param {{ method: string, origin?: string|null, host?: string|null, ip?: string|null,
 *           contentLength?: string|null, readBody: (maxBytes: number) => Promise<string> }} req
 * @param {{ env: Record<string, string|undefined>, fetch: typeof fetch, log?: (message: string) => void }} deps
 */
export async function handleAuth(req, deps) {
  const log = deps.log ?? (() => {});
  if (req.method !== "POST") return reply(405, { ok: false, error: "method_not_allowed" }, { Allow: "POST" });
  if (!isAllowedOrigin(req.origin, req.host)) return reply(403, { ok: false, error: "forbidden_origin" });
  const { data, fail } = await readJsonObject(req, MAX_AUTH_BYTES);
  if (fail) return fail;
  const body = AuthBody.safeParse(data);
  if (!body.success) return reply(400, { ok: false, error: "bad_request" });
  if (!isAuthConfigured(deps.env)) return reply(503, { ok: false, error: "auth_closed" });
  if (rateLimited(body.data.action, clientId(req.ip, deps.env.SUPABASE_ANON_KEY))) return rateLimitReply();

  const base = `${supabaseOrigin(deps.env)}/auth/v1`;
  const send = body.data.action === "send";
  let res;
  try {
    res = await deps.fetch(send ? `${base}/otp` : `${base}/verify`, {
      method: "POST",
      headers: authHeaders(deps.env),
      body: JSON.stringify(send ? { email: body.data.email, create_user: true } : { type: "email", email: body.data.email, token: body.data.code }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    log(`auth: supabase request failed (${err && err.name ? err.name : "Error"})`);
    return reply(502, { ok: false, error: "auth_error" });
  }
  if (res.status === 429) return rateLimitReply();
  if (send) {
    if (res.ok) return reply(200, { ok: true });
    log(`auth: supabase otp returned status ${res.status}`);
    return reply(502, { ok: false, error: "auth_error" });
  }
  // A wrong or expired code is a 4xx from Supabase. Its message is not logged: it can quote the email.
  if (res.status >= 400 && res.status < 500) return reply(401, { ok: false, error: "bad_code" });
  const parsed = res.ok ? VerifyReply.safeParse(await res.json().catch(() => null)) : null;
  if (!parsed || !parsed.success) {
    log(res.ok ? "auth: supabase verify returned an unexpected shape" : `auth: supabase verify returned status ${res.status}`);
    return reply(502, { ok: false, error: "auth_error" });
  }
  return reply(200, { ok: true, token: parsed.data.access_token, expiresIn: parsed.data.expires_in });
}

/**
 * GET with Authorization: Bearer <token> lists the keys for the signed-in email.
 * @param {{ method: string, authorization?: string|null, ip?: string|null }} req
 * @param {{ env: Record<string, string|undefined>, fetch: typeof fetch, log?: (message: string) => void }} deps
 */
export async function handleAccount(req, deps) {
  const log = deps.log ?? (() => {});
  if (req.method !== "GET") return reply(405, { ok: false, error: "method_not_allowed" }, { Allow: "GET" });
  if (!isAuthConfigured(deps.env)) return reply(503, { ok: false, error: "auth_closed" });
  if (!isCheckoutConfigured(deps.env)) return reply(503, { ok: false, error: "checkout_closed" });
  const match = /^Bearer ([A-Za-z0-9._-]{20,4000})$/.exec(typeof req.authorization === "string" ? req.authorization.trim() : "");
  if (!match) return reply(401, { ok: false, error: "unauthorized" });
  if (rateLimited("account", clientId(req.ip, deps.env.SUPABASE_ANON_KEY))) return rateLimitReply();

  let user;
  try {
    const res = await deps.fetch(`${supabaseOrigin(deps.env)}/auth/v1/user`, {
      method: "GET",
      headers: authHeaders(deps.env, match[1]),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) return reply(401, { ok: false, error: "unauthorized" });
    if (!res.ok) {
      log(`account: supabase user returned status ${res.status}`);
      return reply(502, { ok: false, error: "auth_error" });
    }
    user = UserReply.safeParse(await res.json().catch(() => null));
  } catch (err) {
    log(`account: supabase request failed (${err && err.name ? err.name : "Error"})`);
    return reply(502, { ok: false, error: "auth_error" });
  }
  if (!user.success) {
    log("account: supabase user returned an unexpected shape");
    return reply(502, { ok: false, error: "auth_error" });
  }
  const email = user.data.email;

  const licenses = [];
  let after = null;
  for (let page = 0; page < MAX_STRIPE_PAGES; page += 1) {
    const query = new URLSearchParams({ "customer_details[email]": email, status: "complete", limit: "100" });
    if (after) query.set("starting_after", after);
    let res;
    try {
      res = await deps.fetch(`${STRIPE_API}/checkout/sessions?${query}`, {
        method: "GET",
        headers: stripeHeaders(deps.env),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (err) {
      log(`account: stripe request failed (${err && err.name ? err.name : "Error"})`);
      return reply(502, { ok: false, error: "stripe_error" });
    }
    if (!res.ok) {
      log(`account: stripe returned status ${res.status}`);
      return reply(502, { ok: false, error: "stripe_error" });
    }
    const parsed = SessionsPage.safeParse(await res.json().catch(() => null));
    if (!parsed.success) {
      log("account: stripe returned an unexpected shape");
      return reply(502, { ok: false, error: "stripe_error" });
    }
    for (const session of parsed.data.data) {
      if (isTmPurchase(session)) licenses.push(licenseFor(session, deps.env.TM_LICENSE_PRIVATE_KEY));
    }
    const last = parsed.data.data[parsed.data.data.length - 1];
    if (!parsed.data.has_more || !last) break;
    after = last.id;
  }
  return reply(200, { ok: true, email, licenses });
}
