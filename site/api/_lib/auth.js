// Sign-in and account core. Pure: no Vercel, no globals. Fetch, env and log are injected.
// A buyer signs in with a one-time code that Supabase Auth emails them, then sees every key for the
// email they paid with. Keys are derived from Stripe's own records, so the site keeps no license table.
// Rules: never log the email, the code, the token, the anon key or the Stripe key. Never fake a key.
import { z } from "zod";
import { agreementRecord, agreementRefusal } from "./agreement.js";
import { isCheckoutConfigured, reply, signsReleaseKeys, STRIPE_API, stripeHeaders, UPSTREAM_TIMEOUT_MS } from "./checkout.js";
import { isTestPurchaseOnReleaseKey, isTmPurchase, licenseFor, paymentStanding, SESSION_EXPAND, SessionSchema } from "./license.js";
import { rateLimited } from "./ratelimit.js";
import { clientId, isAllowedOrigin, isValidEmail, normalizeEmail, readJsonObject, supabaseOrigin } from "./waitlist.js";

export const MAX_AUTH_BYTES = 2048;
const MAX_STRIPE_PAGES = 10;

// Sign-in is set up only when both SUPABASE_URL and SUPABASE_ANON_KEY are present. There is no
// fallback to SUPABASE_KEY on purpose: turning on Supabase Auth is a separate decision from the waitlist
// (see docs/launch/CHECKOUT_SETUP.md), so it needs its own setting.
export function isAuthConfigured(env) {
  return Boolean(env && env.SUPABASE_ANON_KEY && supabaseOrigin(env));
}

const rateLimitReply = () => reply(429, { ok: false, error: "rate_limited" }, { "Retry-After": "60" });

const Email = z.string().max(254).transform(normalizeEmail).refine(isValidEmail);
const AuthBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send"), email: Email }),
  z.object({ action: z.literal("verify"), email: Email, code: z.string().regex(/^\d{6,10}$/) }),
]);
const VerifyReply = z.object({ access_token: z.string().min(1), expires_in: z.number().int().positive() });
// email_confirmed_at is checked after parsing: an unconfirmed email is not proof the caller owns it (Security L1).
const UserReply = z.object({
  email: z.string().max(254).transform(normalizeEmail).refine(isValidEmail),
  email_confirmed_at: z.string().nullish(),
});
const SessionsPage = z.object({
  data: z.array(SessionSchema),
  has_more: z.boolean(),
});

// How the session signed in, from the token's own payload (Supabase's `amr`). A refreshed token keeps it.
const SessionClaims = z.object({ amr: z.array(z.object({ method: z.string() })).min(1) });

/**
 * True only when every way this session signed in was an emailed code. Read after Supabase accepted the same token,
 * so the payload is Supabase's. With Confirm email on, someone who signs up first with a buyer's email and a password
 * keeps that password after the buyer's code confirms the email; that session says "password" and is refused, as is
 * any other method (OAuth, SSO). Anything missing or malformed is refused too.
 * @param {string} token
 */
function signedInByCodeOnly(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return false;
  }
  const claims = SessionClaims.safeParse(payload);
  return claims.success && claims.data.amr.every((a) => a.method === "otp");
}

function authHeaders(env, token) {
  const headers = { apikey: env.SUPABASE_ANON_KEY, "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * POST {action:"send", email} emails a code. POST {action:"verify", email, code} trades it for a token.
 * Both also carry {agreed: true, termsVersion, privacyVersion, boxVersion}: the box by the email field, ticked to agree
 * to the Terms and confirm the Privacy notice was read (agreement.js). Without it nothing is sent to Supabase. The agreement is recorded in the
 * Supabase Auth user's metadata: on send it goes with a new email's account as it is created, and on verify it is
 * written to the signed-in user, which also covers an email that already had an account.
 * @param {{ method: string, origin?: string|null, host?: string|null, ip?: string|null,
 *           contentLength?: string|null, readBody: (maxBytes: number) => Promise<string> }} req
 * @param {{ env: Record<string, string|undefined>, fetch: typeof fetch, log?: (message: string) => void, now?: () => number }} deps
 */
export async function handleAuth(req, deps) {
  const log = deps.log ?? (() => {});
  if (req.method !== "POST") return reply(405, { ok: false, error: "method_not_allowed" }, { Allow: "POST" });
  if (!isAllowedOrigin(req.origin, req.host)) return reply(403, { ok: false, error: "forbidden_origin" });
  const { data, fail } = await readJsonObject(req, MAX_AUTH_BYTES);
  if (fail) return fail;
  const body = AuthBody.safeParse(data);
  if (!body.success) return reply(400, { ok: false, error: "bad_request" });
  const refused = agreementRefusal(data);
  if (refused) return refused;
  if (!isAuthConfigured(deps.env)) return reply(503, { ok: false, error: "auth_closed" });
  if (rateLimited(body.data.action, clientId(req.ip, deps.env.SUPABASE_ANON_KEY))) return rateLimitReply();

  const base = `${supabaseOrigin(deps.env)}/auth/v1`;
  const send = body.data.action === "send";
  const agreement = agreementRecord((deps.now ?? Date.now)());
  let res;
  try {
    res = await deps.fetch(send ? `${base}/otp` : `${base}/verify`, {
      method: "POST",
      headers: authHeaders(deps.env),
      // Supabase keeps `data` as user metadata only when this call creates the user.
      body: JSON.stringify(send ? { email: body.data.email, create_user: true, data: agreement } : { type: "email", email: body.data.email, token: body.data.code }),
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
  // The code proved the email, so its user now records this agreement, new or not. Unrecorded means not signed in.
  try {
    const saved = await deps.fetch(`${base}/user`, {
      method: "PUT",
      headers: authHeaders(deps.env, parsed.data.access_token),
      body: JSON.stringify({ data: agreement }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!saved.ok) {
      log(`auth: supabase user update returned status ${saved.status}`);
      return reply(502, { ok: false, error: "auth_error" });
    }
  } catch (err) {
    log(`auth: supabase request failed (${err && err.name ? err.name : "Error"})`);
    return reply(502, { ok: false, error: "auth_error" });
  }
  return reply(200, { ok: true, token: parsed.data.access_token, expiresIn: parsed.data.expires_in });
}

/**
 * GET with Authorization: Bearer <token> lists the keys for the signed-in email.
 * @param {{ method: string, authorization?: string|null, ip?: string|null }} req
 * @param {{ env: Record<string, string|undefined>, fetch: typeof fetch, log?: (message: string) => void, sellerPublicKey?: string }} deps
 */
export async function handleAccount(req, deps) {
  const log = deps.log ?? (() => {});
  if (req.method !== "GET") return reply(405, { ok: false, error: "method_not_allowed" }, { Allow: "GET" });
  if (!isAuthConfigured(deps.env)) return reply(503, { ok: false, error: "auth_closed" });
  if (!isCheckoutConfigured(deps.env, deps.sellerPublicKey)) return reply(503, { ok: false, error: "checkout_closed" });
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
  if (!user.data.email_confirmed_at) return reply(401, { ok: false, error: "unauthorized" });
  if (!signedInByCodeOnly(match[1])) return reply(401, { ok: false, error: "unauthorized" });
  const email = user.data.email;

  const releaseKey = signsReleaseKeys(deps.env, deps.sellerPublicKey);
  const licenses = [];
  let after = null;
  for (let page = 0; page < MAX_STRIPE_PAGES; page += 1) {
    const query = new URLSearchParams({ "customer_details[email]": email, status: "complete", limit: "100", "expand[]": `data.${SESSION_EXPAND}` });
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
      if (!isTmPurchase(session) || isTestPurchaseOnReleaseKey(session, releaseKey)) continue;
      // A refunded or disputed purchase is left out (Security L5); only Time Machine purchases cost this lookup.
      const standing = await paymentStanding(session, deps, "account");
      if (standing === "error") return reply(502, { ok: false, error: "stripe_error" });
      if (standing === "ok") licenses.push(licenseFor(session, deps.env.TM_LICENSE_PRIVATE_KEY));
    }
    const last = parsed.data.data[parsed.data.data.length - 1];
    if (!parsed.data.has_more || !last) break;
    after = last.id;
  }
  return reply(200, { ok: true, email, licenses });
}
