// POST /api/checkout core. Pure: no Vercel, no globals. Fetch, env and log are injected.
// Starts a Stripe Checkout Session for the one-time web app purchase. Rules: never log or echo
// the Stripe secret key, never return Stripe's error text, never fake a checkout link.
import { createPrivateKey, createPublicKey } from "node:crypto";
import { z } from "zod";
import { instanceClient, rateLimited } from "./ratelimit.js";
import { isAllowedOrigin, rateLimitReply } from "./waitlist.js";

export const STRIPE_API = "https://api.stripe.com/v1";
export const UPSTREAM_TIMEOUT_MS = 8000;
// Every Stripe call names its API version, so a Dashboard upgrade never changes the fields read here
// (payment_intent.latest_charge and the dispute list included).
export const STRIPE_VERSION = "2024-06-20";
// An unpaid Checkout Session closes after this long, the shortest Stripe allows (30 minutes), plus a
// minute so clock drift between here and Stripe never asks for less than that.
export const SESSION_LIFETIME_S = 31 * 60;
export const PRICE_CENTS = 5000;
export const PRODUCT_NAME = "Time Machine web app (one-time)";
// Every session this site creates carries this tag, and only tagged sessions become keys.
export const PRODUCT_TAG = "tm-web";
// Live mode stays locked until the attorney and Preston approve it in writing (docs/launch/CHECKOUT_SETUP.md, section 6).
// That approval is recorded by setting STRIPE_LIVE_OK to exactly this value; until then only test keys open checkout.
export const LIVE_APPROVAL = "yes-attorney-cleared";
// The release public key every Time Machine release checks keys against. Must equal LICENSE_PUBLIC_KEY in
// packages/core/src/license.ts (a test keeps them equal). Keys signed with its private half work forever,
// so that private key only ever signs keys for real, live-mode payments.
export const SELLER_PUBLIC_KEY = "Q_PPODTar9QhyhsdEruxYVIpPl-kSZnrfTQtcAzHqoA";
export const PKCS8_HEADER = Buffer.from("302e020100300506032b657004220420", "hex");

export const reply = (status, body, headers = {}) => ({ status, headers, body });

// The raw Ed25519 public key (base64url) of a raw 32-byte private key (base64url).
export function publicKeyOf(privateKey) {
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_HEADER, Buffer.from(privateKey, "base64url")]), format: "der", type: "pkcs8" });
  return createPublicKey(key).export({ type: "spki", format: "der" }).subarray(-32).toString("base64url");
}

// True when the configured signing key is the release key, whose keys every release accepts.
export function signsReleaseKeys(env, sellerPublicKey = SELLER_PUBLIC_KEY) {
  return publicKeyOf(env.TM_LICENSE_PRIVATE_KEY) === sellerPublicKey;
}

// The signing key decodes to 32 raw Ed25519 bytes, and either live mode is approved, or the Stripe key is
// a test key on a deployment that is not Production and the signing key is NOT the release key (test mode
// signs with a throwaway keypair, so a test card never buys a key real releases accept, and the live site
// never takes a test card for a key that release builds reject). Checkout stays closed otherwise: nobody
// can pay for a key the site cannot sign, and a live key set by mistake takes no money. Used by checkout,
// license, account and /api/health. `sellerPublicKey` is injectable so tests can stand in for the release key.
export function isCheckoutConfigured(env, sellerPublicKey = SELLER_PUBLIC_KEY) {
  if (!env || !env.STRIPE_SECRET_KEY || !env.TM_LICENSE_PRIVATE_KEY) return false;
  if (!/^[A-Za-z0-9_-]{43}$/.test(env.TM_LICENSE_PRIVATE_KEY)) return false;
  if (Buffer.from(env.TM_LICENSE_PRIVATE_KEY, "base64url").length !== 32) return false;
  if (env.STRIPE_LIVE_OK === LIVE_APPROVAL) return true;
  // Vercel sets VERCEL_ENV to "production" on the live deployment; previews and local runs keep test mode.
  if (env.VERCEL_ENV === "production") return false;
  return /^(sk|rk)_test_[A-Za-z0-9_]+$/.test(env.STRIPE_SECRET_KEY) && !signsReleaseKeys(env, sellerPublicKey);
}

export function stripeHeaders(env) {
  return { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Version": STRIPE_VERSION };
}

// Where Stripe sends the buyer afterwards: SITE_ORIGIN, or the host this request came to over https.
export function siteOrigin(env, host) {
  if (env.SITE_ORIGIN) {
    try {
      const url = new URL(env.SITE_ORIGIN);
      if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
    } catch {
      // Fall through to the request host.
    }
  }
  if (typeof host === "string" && /^[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(host)) return `https://${host.toLowerCase()}`;
  return null;
}

// Stripe answers with the session object. Only a real Checkout link is accepted.
const SessionSchema = z.object({
  url: z.string().refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname === "checkout.stripe.com";
    } catch {
      return false;
    }
  }),
});

/**
 * POST starts a Checkout Session and returns its link.
 * @param {{ method: string, origin?: string|null, host?: string|null, ip?: string|null }} req
 * @param {{ env: Record<string, string|undefined>, fetch: typeof fetch, log?: (message: string) => void, sellerPublicKey?: string, now?: () => number }} deps
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: object }>}
 */
export async function handleCheckout(req, deps) {
  const log = deps.log ?? (() => {});
  if (req.method !== "POST") return reply(405, { ok: false, error: "method_not_allowed" }, { Allow: "POST" });
  if (!isAllowedOrigin(req.origin, req.host)) return reply(403, { ok: false, error: "forbidden_origin" });
  if (!isCheckoutConfigured(deps.env, deps.sellerPublicKey)) return reply(503, { ok: false, error: "checkout_closed" });
  const site = siteOrigin(deps.env, req.host);
  if (!site) return reply(400, { ok: false, error: "bad_request" });
  if (rateLimited("checkout", instanceClient(req.ip))) return rateLimitReply();

  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("line_items[0][quantity]", "1");
  if (deps.env.STRIPE_PRICE_ID) {
    form.set("line_items[0][price]", deps.env.STRIPE_PRICE_ID);
  } else {
    form.set("line_items[0][price_data][currency]", "usd");
    form.set("line_items[0][price_data][unit_amount]", String(PRICE_CENTS));
    form.set("line_items[0][price_data][product_data][name]", PRODUCT_NAME);
  }
  form.set("success_url", `${site}/thanks?session={CHECKOUT_SESSION_ID}`);
  form.set("cancel_url", `${site}/#pricing`);
  form.set("allow_promotion_codes", "true");
  form.set("metadata[product]", PRODUCT_TAG);
  form.set("payment_intent_data[metadata][product]", PRODUCT_TAG);
  form.set("expires_at", String(Math.floor((deps.now ?? Date.now)() / 1000) + SESSION_LIFETIME_S));

  let res;
  try {
    res = await deps.fetch(`${STRIPE_API}/checkout/sessions`, {
      method: "POST",
      headers: stripeHeaders(deps.env),
      body: form.toString(),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    log(`checkout: stripe request failed (${err && err.name ? err.name : "Error"})`);
    return reply(502, { ok: false, error: "stripe_error" });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // Stripe's message is for the server log only. It can name the account or the key's mode.
    const message = data && data.error && typeof data.error.message === "string" ? data.error.message : "";
    log(`checkout: stripe returned status ${res.status}${message ? `: ${message}` : ""}`);
    return reply(502, { ok: false, error: "stripe_error" });
  }
  const parsed = SessionSchema.safeParse(data);
  if (!parsed.success) {
    log("checkout: stripe returned an unexpected shape");
    return reply(502, { ok: false, error: "stripe_error" });
  }
  return reply(200, { ok: true, url: parsed.data.url });
}
