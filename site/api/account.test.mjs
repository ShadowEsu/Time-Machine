import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseLicenseKey } from "../../packages/core/src/license.ts";
import { GET } from "./account.js";
import { handleAccount, LIMITS, resetRateLimits } from "./_lib/auth.js";
import { handleLicense, purchaseId } from "./_lib/license.js";

// Synthetic values only. A throwaway signing keypair per test file.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUB = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64url");
const PRIV = privateKey.export({ type: "pkcs8", format: "der" }).subarray(-32).toString("base64url");
const ENV = { SUPABASE_URL: "https://fake-project.supabase.test", SUPABASE_ANON_KEY: "synthetic-anon-key", STRIPE_SECRET_KEY: "sk_test_synthetic_secret", TM_LICENSE_PRIVATE_KEY: PRIV };
const EMAIL = "buyer@example.test";
const TOKEN = "synthetic.access.token-0123456789";
const AUTH = `Bearer ${TOKEN}`;
const CREATED = Math.floor(Date.UTC(2026, 9, 22, 7, 0, 0) / 1000);
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const session = (id, extra = {}) => ({ id, object: "checkout.session", mode: "payment", payment_status: "paid", status: "complete", created: CREATED, customer_details: { email: EMAIL, name: "Synthetic Buyer" }, ...extra });
const user = () => json({ id: "00000000-0000-4000-8000-000000000000", email: EMAIL, role: "authenticated" });

// Routes each fetch by URL: the Supabase user call, then one or more Stripe pages.
function setup({ env = ENV, userReply = user, pages = [{ data: [session("cs_test_one1234567890")], has_more: false }] } = {}) {
  const stripe = pages.map((page) => () => json(page));
  const fetch = vi.fn(async (url) => (String(url).includes("/auth/v1/user") ? userReply() : (stripe.shift() ?? (() => json({ data: [], has_more: false })))()));
  const log = vi.fn();
  return { fetch, log, deps: { env, fetch, log } };
}
const request = (overrides = {}) => ({ method: "GET", authorization: AUTH, ...overrides });

beforeEach(() => resetRateLimits());

describe("account handler", () => {
  it("lists one key per paid one-time session, the same key the thanks page gives, and nothing else from Stripe", async () => {
    const pages = [
      { data: [session("cs_test_one1234567890"), session("cs_test_sub1234567890", { mode: "subscription" }), session("cs_test_unpaid234567890", { payment_status: "unpaid" })], has_more: true },
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
    const thanks = await handleLicense({ method: "GET", session: "cs_test_one1234567890" }, { env: ENV, fetch: async () => json(session("cs_test_one1234567890")) });
    expect(res.body.licenses[0].key).toBe(thanks.body.key);
    expect(JSON.stringify(res.body)).not.toContain("Synthetic Buyer");
    expect(JSON.stringify(res.body)).not.toContain("cs_test_");

    const [userUrl, userInit] = fetch.mock.calls[0];
    expect(userUrl).toBe("https://fake-project.supabase.test/auth/v1/user");
    expect(userInit.headers.apikey).toBe(ENV.SUPABASE_ANON_KEY);
    expect(userInit.headers.Authorization).toBe(AUTH);
    const first = new URL(fetch.mock.calls[1][0]);
    expect(first.origin + first.pathname).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(Object.fromEntries(first.searchParams)).toEqual({ "customer_details[email]": EMAIL, status: "complete", limit: "100" });
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${ENV.STRIPE_SECRET_KEY}`);
    expect(new URL(fetch.mock.calls[2][0]).searchParams.get("starting_after")).toBe("cs_test_unpaid234567890");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("answers an empty list for an email with no paid sessions", async () => {
    const { deps } = setup({ pages: [{ data: [], has_more: false }] });
    expect(await handleAccount(request(), deps)).toEqual({ status: 200, headers: {}, body: { ok: true, email: EMAIL, licenses: [] } });
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

  it("is closed with the right 503 when sign-in or checkout is not set up", async () => {
    const noAuth = setup({ env: { ...ENV, SUPABASE_ANON_KEY: "" } });
    expect(await handleAccount(request(), noAuth.deps)).toEqual({ status: 503, headers: {}, body: { ok: false, error: "auth_closed" } });
    const noStripe = setup({ env: { ...ENV, STRIPE_SECRET_KEY: "" } });
    expect(await handleAccount(request(), noStripe.deps)).toEqual({ status: 503, headers: {}, body: { ok: false, error: "checkout_closed" } });
    const noSigning = setup({ env: { ...ENV, TM_LICENSE_PRIVATE_KEY: "" } });
    expect((await handleAccount(request(), noSigning.deps)).body.error).toBe("checkout_closed");
    expect(noAuth.fetch).not.toHaveBeenCalled();
    expect(noStripe.fetch).not.toHaveBeenCalled();
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
