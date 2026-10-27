import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseLicenseKey } from "../../packages/core/src/license.ts";
import { GET } from "./account.js";
import { handleAccount } from "./_lib/auth.js";
import { LIMITS, resetRateLimits } from "./_lib/ratelimit.js";
import { handleLicense, purchaseId } from "./_lib/license.js";

// Synthetic values only. A throwaway signing keypair per test file.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUB = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64url");
const PRIV = privateKey.export({ type: "pkcs8", format: "der" }).subarray(-32).toString("base64url");
const ENV = { SUPABASE_URL: "https://fake-project.supabase.test", SUPABASE_ANON_KEY: "synthetic-anon-key", STRIPE_SECRET_KEY: "sk_test_synthetic_secret", TM_LICENSE_PRIVATE_KEY: PRIV };
const EMAIL = "buyer@example.test";
const CREATED = Math.floor(Date.UTC(2026, 9, 22, 7, 0, 0) / 1000);
// A token shaped like Supabase's: header.payload.signature, base64url. Only the payload's amr is read, after Supabase
// itself accepts the token; the signature here is synthetic.
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const tokenWith = (payload) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.c3ludGhldGljLXNpZ25hdHVyZQ`;
const OTP_SESSION = { sub: "00000000-0000-4000-8000-000000000000", aal: "aal1", amr: [{ method: "otp", timestamp: CREATED }] };
const TOKEN = tokenWith(OTP_SESSION);
const AUTH = `Bearer ${TOKEN}`;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
// Sessions as Stripe lists them with expand[]=data.payment_intent.latest_charge.
const session = (id, extra = {}, chargeExtra = {}) => ({ id, object: "checkout.session", mode: "payment", payment_status: "paid", status: "complete", created: CREATED, livemode: false, metadata: { product: "tm-web" }, currency: "usd", amount_subtotal: 5000, amount_total: 5000, customer_details: { email: EMAIL, name: "Synthetic Buyer" }, payment_intent: { id: `pi_${id.slice(3)}`, object: "payment_intent", latest_charge: { id: `ch_${id.slice(3)}`, object: "charge", refunded: false, amount_refunded: 0, ...chargeExtra } }, ...extra });
const isDisputes = (url) => String(url).startsWith("https://api.stripe.com/v1/disputes?");
const user = (extra = {}) => json({ id: "00000000-0000-4000-8000-000000000000", email: EMAIL, email_confirmed_at: "2026-10-22T07:00:00Z", role: "authenticated", ...extra });

// Routes each fetch by URL: the Supabase user call, the dispute list for one payment (`disputes` maps a
// payment intent id to its dispute statuses), then one or more Stripe session pages.
function setup({ env = ENV, userReply = user, pages = [{ data: [session("cs_test_one1234567890")], has_more: false }], disputes = {} } = {}) {
  const stripe = pages.map((page) => () => json(page));
  const disputeReply = (url) => json({ object: "list", data: (disputes[new URL(url).searchParams.get("payment_intent")] ?? []).map((status) => ({ object: "dispute", status })), has_more: false });
  const fetch = vi.fn(async (url) => (String(url).includes("/auth/v1/user") ? userReply() : isDisputes(url) ? disputeReply(url) : (stripe.shift() ?? (() => json({ data: [], has_more: false })))()));
  const log = vi.fn();
  return { fetch, log, deps: { env, fetch, log } };
}
const sessionCalls = (fetch) => fetch.mock.calls.filter(([url]) => String(url).startsWith("https://api.stripe.com/v1/checkout/sessions"));
const request = (overrides = {}) => ({ method: "GET", authorization: AUTH, ...overrides });

beforeEach(() => resetRateLimits());

describe("account handler", () => {
  it("lists one key per paid one-time session, the same key the thanks page gives, and nothing else from Stripe", async () => {
    const pages = [
      { data: [session("cs_test_one1234567890"), session("cs_test_sub1234567890", { mode: "subscription" }), session("cs_test_other234567890", { metadata: { product: "unvibe-lifetime" }, amount_subtotal: 100, amount_total: 100 }), session("cs_test_unpaid234567890", { payment_status: "unpaid" })], has_more: true },
      { data: [session("cs_test_two1234567890")], has_more: false },
    ];
    const { fetch, deps } = setup({ pages });
    const res = await handleAccount(request(), deps);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.email).toBe(EMAIL);
    expect(res.body.licenses.map((l) => l.id)).toEqual([purchaseId("cs_test_one1234567890"), purchaseId("cs_test_two1234567890")]);
    for (const l of res.body.licenses) {
      expect(l).toEqual({ key: expect.stringMatching(/^TM1\./), id: l.id, issued: "2026-10-22" });
      expect(parseLicenseKey(l.key, PUB)).toEqual({ v: 1, id: l.id, plan: "web", issued: "2026-10-22" });
    }
    const thanks = await handleLicense({ method: "GET", session: "cs_test_one1234567890" }, { env: ENV, fetch: async (url) => (isDisputes(url) ? json({ data: [], has_more: false }) : json(session("cs_test_one1234567890"))) });
    expect(res.body.licenses[0].key).toBe(thanks.body.key);
    expect(JSON.stringify(res.body)).not.toContain("Synthetic Buyer");
    expect(JSON.stringify(res.body)).not.toContain("cs_test_");

    const [userUrl, userInit] = fetch.mock.calls[0];
    expect(userUrl).toBe("https://fake-project.supabase.test/auth/v1/user");
    expect(userInit.headers.apikey).toBe(ENV.SUPABASE_ANON_KEY);
    expect(userInit.headers.Authorization).toBe(AUTH);
    const pagesAsked = sessionCalls(fetch);
    const first = new URL(pagesAsked[0][0]);
    expect(first.origin + first.pathname).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(Object.fromEntries(first.searchParams)).toEqual({ "customer_details[email]": EMAIL, status: "complete", limit: "100", "expand[]": "data.payment_intent.latest_charge" });
    expect(pagesAsked[0][1].headers.Authorization).toBe(`Bearer ${ENV.STRIPE_SECRET_KEY}`);
    expect(new URL(pagesAsked[1][0]).searchParams.get("starting_after")).toBe("cs_test_unpaid234567890");
    expect(pagesAsked).toHaveLength(2);
    // Only the two Time Machine purchases cost a dispute lookup; the subscription, foreign and unpaid ones do not.
    expect(fetch.mock.calls.filter(([url]) => isDisputes(url)).map(([url]) => new URL(url).searchParams.get("payment_intent"))).toEqual(["pi_test_one1234567890", "pi_test_two1234567890"]);
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it("leaves out a fully refunded purchase and one with an open or lost dispute, and keeps a won one (Security L5)", async () => {
    const pages = [{ data: [
      session("cs_test_kept1234567890"),
      session("cs_test_partial234567890", {}, { amount_refunded: 1000 }),
      session("cs_test_refunded34567890", {}, { refunded: true, amount_refunded: 5000 }),
      session("cs_test_open1234567890", {}, { disputed: true }),
      session("cs_test_lost1234567890", {}, { disputed: true }),
      session("cs_test_won12345678900", {}, { disputed: true }),
    ], has_more: false }];
    const disputes = { pi_test_open1234567890: ["needs_response"], pi_test_lost1234567890: ["lost"], pi_test_won12345678900: ["won"] };
    const res = await handleAccount(request(), setup({ pages, disputes }).deps);
    expect(res.status).toBe(200);
    expect(res.body.licenses.map((l) => l.id)).toEqual(["cs_test_kept1234567890", "cs_test_partial234567890", "cs_test_won12345678900"].map(purchaseId));
  });

  it("answers 502 when a purchase's dispute state cannot be read, instead of listing a partial set", async () => {
    const s = setup();
    s.fetch.mockImplementation(async (url) => (String(url).includes("/auth/v1/user") ? user() : isDisputes(url) ? json({ error: { message: "Invalid API Key provided: sk_test_synthetic_secret" } }, 401) : json({ data: [session("cs_test_one1234567890")], has_more: false })));
    expect(await handleAccount(request(), s.deps)).toEqual({ status: 502, headers: {}, body: { ok: false, error: "stripe_error" } });
    expect(s.log).toHaveBeenCalledWith("account: stripe disputes returned status 401");
    expect(JSON.stringify(s.log.mock.calls)).not.toContain(ENV.STRIPE_SECRET_KEY);
  });

  it("answers an empty list for an email with no paid sessions", async () => {
    const { deps } = setup({ pages: [{ data: [], has_more: false }] });
    expect(await handleAccount(request(), deps)).toEqual({ status: 200, headers: {}, body: { ok: true, email: EMAIL, licenses: [] } });
  });

  it("lists no release key for a test-mode purchase", async () => {
    // PUB stands in for the release key, since its real private half is not in the repo.
    const pages = [{ data: [session("cs_test_one1234567890"), session("cs_live_two1234567890", { livemode: true })], has_more: false }];
    const s = setup({ env: { ...ENV, STRIPE_LIVE_OK: "yes-attorney-cleared" }, pages });
    const res = await handleAccount(request(), { ...s.deps, sellerPublicKey: PUB });
    expect(res.body.licenses.map((l) => l.id)).toEqual([purchaseId("cs_live_two1234567890")]);
    const closed = setup();
    expect((await handleAccount(request(), { ...closed.deps, sellerPublicKey: PUB })).body.error).toBe("checkout_closed");
    expect(closed.fetch).not.toHaveBeenCalled();
  });

  it("is 401 for a missing, malformed or rejected token, and Stripe is never asked", async () => {
    const { fetch, deps } = setup();
    for (const authorization of [null, "", "Bearer", "Bearer short", "Basic abcdefghijklmnopqrstuvwxyz", `Bearer ${"a".repeat(4001)}`]) {
      expect(await handleAccount(request({ authorization }), deps)).toEqual({ status: 401, headers: {}, body: { ok: false, error: "unauthorized" } });
    }
    expect(fetch).not.toHaveBeenCalled();
    for (const status of [401, 403]) {
      const rejected = setup({ userReply: () => json({ msg: "invalid JWT" }, status) });
      expect((await handleAccount(request(), rejected.deps)).status).toBe(401);
      expect(rejected.fetch).toHaveBeenCalledTimes(1);
    }
    const shape = setup({ userReply: () => json({ id: "x" }) });
    expect((await handleAccount(request(), shape.deps)).status).toBe(502);
    expect(shape.log).toHaveBeenCalledWith("account: supabase user returned an unexpected shape");
    expect((await handleAccount(request({ method: "POST" }), deps)).status).toBe(405);
  });

  it("is 401 for a user whose email Supabase never confirmed, and Stripe is never asked (Security L1)", async () => {
    for (const extra of [{ email_confirmed_at: null }, { email_confirmed_at: "" }, { email_confirmed_at: undefined }]) {
      const unconfirmed = setup({ userReply: () => user(extra) });
      expect(await handleAccount(request(), unconfirmed.deps)).toEqual({ status: 401, headers: {}, body: { ok: false, error: "unauthorized" } });
      expect(unconfirmed.fetch).toHaveBeenCalledTimes(1);
    }
    const confirmed = setup();
    expect((await handleAccount(request(), confirmed.deps)).status).toBe(200);
  });

  it("is 401 unless the session was signed in with an emailed code only, and Stripe is never asked (Security: pre-registered password)", async () => {
    const refused = [
      // Someone signed up first with the buyer's email and a password; the buyer's code later confirmed that email.
      { ...OTP_SESSION, amr: [{ method: "password", timestamp: 1 }] },
      // A refreshed session keeps its amr, so a refreshed password session reads the same.
      { ...OTP_SESSION, amr: [{ method: "password", timestamp: 1 }], session_id: "refreshed" },
      { ...OTP_SESSION, amr: [{ method: "otp", timestamp: 1 }, { method: "password", timestamp: 2 }] },
      { ...OTP_SESSION, amr: [{ method: "oauth", timestamp: 1 }] },
      { ...OTP_SESSION, amr: [] },
      { ...OTP_SESSION, amr: "otp" },
      { ...OTP_SESSION, amr: undefined },
    ];
    const garbled = [`${b64({ alg: "HS256" })}.not-json-at-all.c2ln`, `${b64({ alg: "HS256" })}.${b64("otp")}.c2ln`, "only-one-part-but-long-enough-to-pass"];
    for (const token of [...refused.map(tokenWith), ...garbled]) {
      const s = setup();
      expect(await handleAccount(request({ authorization: `Bearer ${token}` }), s.deps)).toEqual({ status: 401, headers: {}, body: { ok: false, error: "unauthorized" } });
      expect(s.fetch).toHaveBeenCalledTimes(1);
    }
    expect((await handleAccount(request(), setup().deps)).status).toBe(200);
  });

  it("is closed with the right 503 when sign-in or checkout is not set up", async () => {
    const noAuth = setup({ env: { ...ENV, SUPABASE_ANON_KEY: "" } });
    expect(await handleAccount(request(), noAuth.deps)).toEqual({ status: 503, headers: {}, body: { ok: false, error: "auth_closed" } });
    const noStripe = setup({ env: { ...ENV, STRIPE_SECRET_KEY: "" } });
    expect(await handleAccount(request(), noStripe.deps)).toEqual({ status: 503, headers: {}, body: { ok: false, error: "checkout_closed" } });
    const noSigning = setup({ env: { ...ENV, TM_LICENSE_PRIVATE_KEY: "" } });
    expect((await handleAccount(request(), noSigning.deps)).body.error).toBe("checkout_closed");
    expect(noAuth.fetch).not.toHaveBeenCalled();
    expect(noStripe.fetch).not.toHaveBeenCalled();
    const live = setup({ env: { ...ENV, STRIPE_SECRET_KEY: "sk_live_SYNTHETIC0123456789" } });
    expect((await handleAccount(request(), live.deps)).body.error).toBe("checkout_closed");
    expect(live.fetch).not.toHaveBeenCalled();
  });

  it("answers 502 on Stripe trouble with the secret kept out of the log, and limits per client", async () => {
    const denied = setup({ pages: [{ error: { message: "Invalid API Key provided: sk_test_synthetic_secret" } }] });
    denied.fetch.mockImplementation(async (url) => (String(url).includes("/auth/v1/user") ? user() : json({ error: { message: "Invalid API Key provided: sk_test_synthetic_secret" } }, 401)));
    expect(await handleAccount(request(), denied.deps)).toEqual({ status: 502, headers: {}, body: { ok: false, error: "stripe_error" } });
    expect(denied.log).toHaveBeenCalledWith("account: stripe returned status 401");
    expect(JSON.stringify(denied.log.mock.calls)).not.toContain(ENV.STRIPE_SECRET_KEY);
    const { deps } = setup();
    resetRateLimits();
    for (let i = 0; i < LIMITS.account; i += 1) expect((await handleAccount(request({ ip: "203.0.113.7" }), setup().deps)).status).toBe(200);
    expect((await handleAccount(request({ ip: "203.0.113.7" }), deps)).status).toBe(429);
    expect((await handleAccount(request({ ip: "203.0.113.8" }), setup().deps)).status).toBe(200);
  });

  it("serves the Web Request signature with no-store", async () => {
    const { fetch } = setup();
    vi.stubGlobal("fetch", fetch);
    for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
    try {
      const res = await GET(new Request("https://timemachine.example.test/api/account", { headers: { authorization: AUTH } }));
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect((await res.json()).licenses).toHaveLength(1);
      expect((await GET(new Request("https://timemachine.example.test/api/account"))).status).toBe(401);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
