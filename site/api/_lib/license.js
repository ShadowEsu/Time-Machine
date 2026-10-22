// License signing and GET /api/license core. Pure: no Vercel, no globals. Fetch, env and log are injected.
// Rules: never log or echo the Stripe secret key, the signing key, or the Stripe session object.
// A key is TM1.<payload>.<signature>, signed exactly as signLicense in packages/core/src/license.ts
// signs it, so the CLI and the web app verify it offline with the embedded public key.
import { createHash, createPrivateKey, sign } from "node:crypto";
import { z } from "zod";
import { isCheckoutConfigured, PRICE_CENTS, PRODUCT_TAG, reply, stripeHeaders, STRIPE_API, UPSTREAM_TIMEOUT_MS } from "./checkout.js";

const PKCS8_HEADER = Buffer.from("302e020100300506032b657004220420", "hex");
const SessionIdSchema = z.string().regex(/^cs_[A-Za-z0-9_]{10,200}$/);
// Only the fields the decision needs. Everything else Stripe sends is dropped here.
export const SessionSchema = z.object({
  id: z.string().min(1),
  mode: z.string(),
  payment_status: z.string(),
  created: z.number().int().nonnegative(),
  metadata: z.object({ product: z.string() }).partial().nullish(),
  currency: z.string().nullish(),
  amount_subtotal: z.number().int().nullish(),
});

// A paid one-time Time Machine purchase: made by this site's checkout (the product tag), in dollars, for
// the full price before any promotion code (amount_subtotal is the amount before discounts). Any other
// paid session on the same Stripe account never becomes a key.
export function isTmPurchase(session) {
  return session.mode === "payment" && session.payment_status === "paid" && session.metadata?.product === PRODUCT_TAG
    && session.currency === "usd" && typeof session.amount_subtotal === "number" && session.amount_subtotal >= PRICE_CENTS;
}

// Signs {v:1,id,plan,issued} in that key order with the raw Ed25519 private key (32 bytes, base64url).
// Byte for byte the same as core's signLicense, which the license test proves with parseLicenseKey.
export function signLicense(payload, privateKey) {
  const raw = Buffer.from(privateKey, "base64url");
  if (raw.length !== 32) throw new Error("The license signing key must be 32 raw Ed25519 bytes, base64url.");
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_HEADER, raw]), format: "der", type: "pkcs8" });
  const body = Buffer.from(JSON.stringify({ v: 1, id: payload.id, plan: payload.plan, issued: payload.issued }));
  return ["TM1", body.toString("base64url"), sign(null, body, key).toString("base64url")].join(".");
}

// The purchase id inside a key: a one-way code of the Stripe session id, so the same page reload gives
// the same key and the real session id is never inside the key.
export function purchaseId(sessionId) {
  return `cs_${createHash("sha256").update(sessionId).digest("hex").slice(0, 24)}`;
}

// The issue date, YYYY-MM-DD in UTC, from the session's creation time, so it never changes on reload.
export function issuedDate(createdSeconds) {
  return new Date(createdSeconds * 1000).toISOString().slice(0, 10);
}

/**
 * GET ?session=cs_... returns the license key for a paid Checkout Session.
 * @param {{ method: string, session?: string|null }} req
 * @param {{ env: Record<string, string|undefined>, fetch: typeof fetch, log?: (message: string) => void }} deps
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: object }>}
 */
export async function handleLicense(req, deps) {
  const log = deps.log ?? (() => {});
  if (req.method !== "GET") return reply(405, { ok: false, error: "method_not_allowed" }, { Allow: "GET" });
  const session = SessionIdSchema.safeParse(req.session);
  if (!session.success) return reply(400, { ok: false, error: "invalid_session" });
  if (!isCheckoutConfigured(deps.env)) return reply(503, { ok: false, error: "checkout_closed" });

  let res;
  try {
    res = await deps.fetch(`${STRIPE_API}/checkout/sessions/${session.data}`, {
      method: "GET",
      headers: stripeHeaders(deps.env),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    log(`license: stripe request failed (${err && err.name ? err.name : "Error"})`);
    return reply(502, { ok: false, error: "stripe_error" });
  }
  if (res.status === 404) return reply(404, { ok: false, error: "not_found" });
  if (!res.ok) {
    log(`license: stripe returned status ${res.status}`);
    return reply(502, { ok: false, error: "stripe_error" });
  }
  const parsed = SessionSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success || parsed.data.id !== session.data) {
    log("license: stripe returned an unexpected shape");
    return reply(502, { ok: false, error: "stripe_error" });
  }
  if (!isTmPurchase(parsed.data)) return reply(402, { ok: false, error: "not_paid" });

  return reply(200, { ok: true, ...licenseFor(parsed.data, deps.env.TM_LICENSE_PRIVATE_KEY) });
}

// The one place a paid session becomes a key. /api/license and /api/account both use it, so the key
// on the thanks page and the key after sign-in are the same bytes.
export function licenseFor(session, privateKey) {
  const id = purchaseId(session.id);
  const issued = issuedDate(session.created);
  return { key: signLicense({ id, plan: "web", issued }, privateKey), id, issued };
}
