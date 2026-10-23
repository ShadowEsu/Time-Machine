import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { LICENSE_PUBLIC_KEY, parseLicenseKey, signLicense as coreSign } from "../../packages/core/src/license.ts";
import { GET } from "./license.js";
import { LIVE_APPROVAL, publicKeyOf, SELLER_PUBLIC_KEY } from "./_lib/checkout.js";
import { handleLicense, issuedDate, purchaseId, signLicense } from "./_lib/license.js";

// A throwaway keypair per test file. Synthetic values only.
function keys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    pub: publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64url"),
    priv: privateKey.export({ type: "pkcs8", format: "der" }).subarray(-32).toString("base64url"),
  };
}
const K = keys();
const ENV = { STRIPE_SECRET_KEY: "sk_test_synthetic_secret", TM_LICENSE_PRIVATE_KEY: K.priv };
const SESSION = "cs_test_a1B2c3D4e5F6g7H8i9J0synthetic";
// The date comes from Stripe's created time, never from the clock.
const CREATED = Math.floor(Date.UTC(2026, 9, 22, 7, 0, 0) / 1000);
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const paid = (extra = {}) => json({
  id: SESSION, object: "checkout.session", mode: "payment", payment_status: "paid", created: CREATED, livemode: false,
  metadata: { product: "tm-web" }, currency: "usd", amount_subtotal: 5000, amount_total: 5000,
  customer_details: { email: "buyer@example.test", name: "Synthetic Buyer" }, ...extra,
});

function setup({ env = ENV, response = paid } = {}) {
  const fetch = vi.fn(async () => response());
  const log = vi.fn();
  return { fetch, log, deps: { env, fetch, log } };
}
const request = (session = SESSION, method = "GET") => ({ method, session });

describe("license signer", () => {
  it("signs byte for byte what core signs, and core verifies it", () => {
    const payload = { id: "cs_0123456789abcdef01234567", plan: "web", issued: "2026-10-22" };
    const key = signLicense(payload, K.priv);
    expect(key).toBe(coreSign({ v: 1, ...payload }, K.priv));
    expect(parseLicenseKey(key, K.pub)).toEqual({ v: 1, ...payload });
    expect(() => parseLicenseKey(key, keys().pub)).toThrow(/signature does not match/);
    expect(() => signLicense(payload, "tooshort")).toThrow(/32 raw Ed25519 bytes/);
  });

  it("makes a stable purchase id that hides the session id, and a stable date", () => {
    const id = purchaseId(SESSION);
    expect(id).toMatch(/^cs_[0-9a-f]{24}$/);
    expect(id).toBe(purchaseId(SESSION));
    expect(id).not.toContain("synthetic");
    expect(purchaseId("cs_test_other")).not.toBe(id);
    expect(issuedDate(CREATED)).toBe("2026-10-22");
    expect(issuedDate(0)).toBe("1970-01-01");
  });
});

describe("license handler", () => {
  it("returns a key the CLI accepts for a paid session, the same key on every reload, and nothing from the session", async () => {
    const { fetch, deps } = setup();
    const res = await handleLicense(request(), deps);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, key: expect.stringMatching(/^TM1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/), id: purchaseId(SESSION), issued: "2026-10-22" });
    expect(parseLicenseKey(res.body.key, K.pub)).toEqual({ v: 1, id: purchaseId(SESSION), plan: "web", issued: "2026-10-22" });
    const text = JSON.stringify(res) + Buffer.from(res.body.key.split(".")[1], "base64url").toString();
    expect(text).not.toContain("example.test");
    expect(text).not.toContain("Synthetic Buyer");
    expect(text).not.toContain(SESSION);
    expect(text).not.toContain(ENV.STRIPE_SECRET_KEY);
    expect(text).not.toContain(K.priv);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`https://api.stripe.com/v1/checkout/sessions/${SESSION}`);
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe(`Bearer ${ENV.STRIPE_SECRET_KEY}`);
    expect((await handleLicense(request(), setup().deps)).body.key).toBe(res.body.key);
  });

  it("answers 402 until the session is a paid one-time payment", async () => {
    for (const extra of [{ payment_status: "unpaid" }, { payment_status: "no_payment_required" }, { mode: "subscription" }]) {
      const { deps } = setup({ response: () => paid(extra) });
      expect(await handleLicense(request(), deps)).toEqual({ status: 402, headers: {}, body: { ok: false, error: "not_paid" } });
    }
  });

  it("gives no key for another product's paid session on the same Stripe account", async () => {
    const foreign = [
      { metadata: { product: "unvibe-lifetime" }, amount_subtotal: 100, amount_total: 100, client_reference_id: "someone-else" },
      { metadata: {} },
      { metadata: null },
      { metadata: { product: "tm-web" }, currency: "eur" },
      { metadata: { product: "tm-web" }, amount_subtotal: 100, amount_total: 100 },
      { metadata: { product: "tm-web" }, amount_subtotal: null },
    ];
    for (const extra of foreign) {
      const { deps } = setup({ response: () => paid(extra) });
      expect(await handleLicense(request(), deps)).toEqual({ status: 402, headers: {}, body: { ok: false, error: "not_paid" } });
    }
    // A promotion code lowers what was charged, not the price the session was opened at, so it still counts.
    const promo = setup({ response: () => paid({ amount_total: 2500, total_details: { amount_discount: 2500 } }) });
    expect((await handleLicense(request(), promo.deps)).status).toBe(200);
  });

  it("never asks Stripe with a live key until live mode is approved", async () => {
    const live = setup({ env: { ...ENV, STRIPE_SECRET_KEY: "sk_live_SYNTHETIC0123456789" } });
    expect(await handleLicense(request(), live.deps)).toEqual({ status: 503, headers: {}, body: { ok: false, error: "checkout_closed" } });
    expect(live.fetch).not.toHaveBeenCalled();
  });

  it("never signs a release key for a test-mode purchase", async () => {
    expect(SELLER_PUBLIC_KEY).toBe(LICENSE_PUBLIC_KEY);
    expect(publicKeyOf(K.priv)).toBe(K.pub);
    // K stands in for the release keypair here, since its real private half is not in the repo.
    const asRelease = (env, response = paid) => {
      const s = setup({ env, response });
      return { ...s, deps: { ...s.deps, sellerPublicKey: K.pub } };
    };
    const closed = asRelease(ENV);
    expect(await handleLicense(request(), closed.deps)).toEqual({ status: 503, headers: {}, body: { ok: false, error: "checkout_closed" } });
    expect(closed.fetch).not.toHaveBeenCalled();
    const approved = { ...ENV, STRIPE_LIVE_OK: LIVE_APPROVAL };
    expect(await handleLicense(request(), asRelease(approved).deps)).toEqual({ status: 402, headers: {}, body: { ok: false, error: "test_purchase" } });
    const live = await handleLicense(request(), asRelease(approved, () => paid({ livemode: true })).deps);
    expect(live.status).toBe(200);
    expect(parseLicenseKey(live.body.key, K.pub).plan).toBe("web");
  });

  it("validates the session id, the method, and the Stripe shape before signing", async () => {
    const { fetch, deps } = setup();
    for (const bad of [null, "", "cs_short", "pi_test_a1B2c3D4e5F6", "cs_test_a1B2c3D4e5F6g7H8i9J0/x", `cs_${"a".repeat(201)}`]) {
      expect(await handleLicense(request(bad), deps)).toEqual({ status: 400, headers: {}, body: { ok: false, error: "invalid_session" } });
    }
    expect((await handleLicense(request(SESSION, "POST"), deps)).status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
    const shape = setup({ response: () => json({ id: SESSION, mode: "payment", payment_status: "paid" }) });
    expect((await handleLicense(request(), shape.deps)).status).toBe(502);
    expect(shape.log).toHaveBeenCalledWith("license: stripe returned an unexpected shape");
    const other = setup({ response: () => paid({ id: "cs_test_someoneelse1234" }) });
    expect((await handleLicense(request(), other.deps)).status).toBe(502);
  });

  it("is closed with 503 when the keys are missing, 404 for an unknown session, 502 for other Stripe trouble", async () => {
    const closed = setup({ env: { STRIPE_SECRET_KEY: ENV.STRIPE_SECRET_KEY } });
    expect(await handleLicense(request(), closed.deps)).toEqual({ status: 503, headers: {}, body: { ok: false, error: "checkout_closed" } });
    expect(closed.fetch).not.toHaveBeenCalled();
    const missing = setup({ response: () => json({ error: { type: "invalid_request_error", message: "No such checkout.session" } }, 404) });
    expect(await handleLicense(request(), missing.deps)).toEqual({ status: 404, headers: {}, body: { ok: false, error: "not_found" } });
    const denied = setup({ response: () => json({ error: { message: "Invalid API Key provided: sk_test_synthetic_secret" } }, 401) });
    const res = await handleLicense(request(), denied.deps);
    expect(res).toEqual({ status: 502, headers: {}, body: { ok: false, error: "stripe_error" } });
    expect(JSON.stringify(denied.log.mock.calls)).not.toContain(ENV.STRIPE_SECRET_KEY);
    expect(denied.log).toHaveBeenCalledWith("license: stripe returned status 401");
    const down = setup({ response: () => { throw new TypeError("fetch failed"); } });
    expect((await handleLicense(request(), down.deps)).status).toBe(502);
    expect(down.log).toHaveBeenCalledWith("license: stripe request failed (TypeError)");
  });

  it("serves the Web Request signature with no-store", async () => {
    const fetch = vi.fn(async () => paid());
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("STRIPE_SECRET_KEY", ENV.STRIPE_SECRET_KEY);
    vi.stubEnv("TM_LICENSE_PRIVATE_KEY", K.priv);
    try {
      const res = await GET(new Request(`https://timemachine.example.test/api/license?session=${SESSION}`));
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      const body = await res.json();
      expect(parseLicenseKey(body.key, K.pub).id).toBe(purchaseId(SESSION));
      expect((await GET(new Request("https://timemachine.example.test/api/license"))).status).toBe(400);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
