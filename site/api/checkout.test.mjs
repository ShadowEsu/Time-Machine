import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./checkout.js";
import { BOX_VERSION, PRIVACY_VERSION, TERMS_VERSION } from "./_lib/agreement.js";
import { handleCheckout, isCheckoutConfigured, PRICE_CENTS, PRODUCT_NAME, PRODUCT_TAG, publicKeyOf, siteOrigin } from "./_lib/checkout.js";
import { LIMITS, resetRateLimits } from "./_lib/ratelimit.js";

// Synthetic values only. The signing key is 32 arbitrary bytes; it never signs anything here.
const SIGNING = Buffer.alloc(32, 3).toString("base64url");
const ENV = { STRIPE_SECRET_KEY: "sk_test_synthetic_secret", TM_LICENSE_PRIVATE_KEY: SIGNING };
const HOST = "timemachine.example.test";
const LINK = "https://checkout.stripe.com/c/pay/cs_test_synthetic#abc";
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const created = () => json({ id: "cs_test_synthetic", object: "checkout.session", url: LINK });
// A fixed clock for the session's expiry time.
const NOW = Date.UTC(2026, 9, 23, 17, 0, 0);

// The current box was ticked to agree to the Terms and confirm the Privacy Policy was read.
const AGREED = { agreed: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, boxVersion: BOX_VERSION };

function request(overrides = {}, body = AGREED) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { method: "POST", origin: `https://${HOST}`, host: HOST, contentLength: String(new TextEncoder().encode(text).length), readBody: async () => text, ...overrides };
}

function setup({ env = ENV, response = created } = {}) {
  const fetch = vi.fn(async () => response());
  const log = vi.fn();
  return { fetch, log, deps: { env, fetch, log, now: () => NOW } };
}

beforeEach(() => resetRateLimits());
afterEach(() => vi.useRealTimers());

describe("checkout handler", () => {
  it("starts a one-time $50 Checkout Session and returns only its link", async () => {
    const { fetch, deps } = setup();
    const res = await handleCheckout(request(), deps);
    expect(res).toEqual({ status: 200, headers: {}, body: { ok: true, url: LINK } });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${ENV.STRIPE_SECRET_KEY}`);
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(init.headers["Stripe-Version"]).toBe("2024-06-20");
    const form = Object.fromEntries(new URLSearchParams(init.body));
    expect(form).toEqual({
      mode: "payment",
      // Card only (Apple Pay and Google Pay ride on it): no delayed method leaves a buyer waiting days for a key.
      "payment_method_types[0]": "card",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(PRICE_CENTS),
      "line_items[0][price_data][product_data][name]": PRODUCT_NAME,
      success_url: `https://${HOST}/thanks?session={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://${HOST}/#pricing`,
      allow_promotion_codes: "true",
      "metadata[product]": "tm-web",
      // What the buyer agreed to before Buy, kept with the session.
      "metadata[agreed_at]": "2026-10-23T17:00:00.000Z",
      "metadata[terms_version]": TERMS_VERSION,
      "metadata[privacy_version]": PRIVACY_VERSION,
      "metadata[box_version]": BOX_VERSION,
      "payment_intent_data[metadata][product]": "tm-web",
      // The shortest life Stripe allows (30 minutes) plus a minute for clock drift.
      expires_at: String(NOW / 1000 + 31 * 60),
    });
    expect(PRICE_CENTS).toBe(5000);
    expect(PRODUCT_TAG).toBe("tm-web");
    expect(form.mode).not.toBe("subscription");
  });

  it("refuses without a ticked box, with 400 agreement_required and no Stripe call", async () => {
    const { fetch, deps } = setup();
    for (const body of [{}, { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, boxVersion: BOX_VERSION }, { ...AGREED, agreed: false }, { ...AGREED, agreed: "true" }]) {
      expect(await handleCheckout(request({}, body), deps)).toEqual({ status: 400, headers: {}, body: { ok: false, error: "agreement_required" } });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a box ticked next to other or missing versions, with 400 agreement_outdated and no Stripe call", async () => {
    const { fetch, deps } = setup();
    for (const field of ["termsVersion", "privacyVersion", "boxVersion"]) {
      for (const value of ["outdated-version", undefined]) {
        expect(await handleCheckout(request({}, { ...AGREED, [field]: value }), deps)).toEqual({ status: 400, headers: {}, body: { ok: false, error: "agreement_outdated" } });
      }
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a body that is not a small JSON object before calling Stripe", async () => {
    const { fetch, deps } = setup();
    expect((await handleCheckout(request({}, "{not json"), deps)).status).toBe(400);
    expect((await handleCheckout(request({}, "[]"), deps)).status).toBe(400);
    expect((await handleCheckout(request({}, { ...AGREED, pad: "x".repeat(4096) }), deps)).status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("limits each client to 10 sessions per 10 minutes, answering 429 without asking Stripe (Security L2)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { fetch, deps } = setup();
    for (let i = 0; i < LIMITS.checkout; i += 1) expect((await handleCheckout(request({ ip: "203.0.113.7" }), deps)).status).toBe(200);
    expect(LIMITS.checkout).toBe(10);
    expect(await handleCheckout(request({ ip: "203.0.113.7" }), deps)).toEqual({ status: 429, headers: { "Retry-After": "60" }, body: { ok: false, error: "rate_limited" } });
    expect(fetch).toHaveBeenCalledTimes(LIMITS.checkout);
    expect((await handleCheckout(request({ ip: "203.0.113.8" }), deps)).status).toBe(200);
    vi.setSystemTime(NOW + 10 * 60 * 1000);
    expect((await handleCheckout(request({ ip: "203.0.113.7" }), deps)).status).toBe(200);
  });

  it("always sends the $50 price inline, never a configured price id, and uses SITE_ORIGIN when it is set", async () => {
    const { fetch, deps } = setup({ env: { ...ENV, STRIPE_PRICE_ID: "price_synthetic", SITE_ORIGIN: "https://tm.example.test/" } });
    expect((await handleCheckout(request(), deps)).status).toBe(200);
    const form = Object.fromEntries(new URLSearchParams(fetch.mock.calls[0][1].body));
    expect(form["line_items[0][price]"]).toBeUndefined();
    expect(form["line_items[0][price_data][currency]"]).toBe("usd");
    expect(form["line_items[0][price_data][unit_amount]"]).toBe("5000");
    expect(form.success_url).toBe("https://tm.example.test/thanks?session={CHECKOUT_SESSION_ID}");
    expect(form.cancel_url).toBe("https://tm.example.test/#pricing");
  });

  it("is closed with 503 until both the Stripe key and a well formed signing key are set, and calls nothing", async () => {
    for (const env of [{}, { STRIPE_SECRET_KEY: ENV.STRIPE_SECRET_KEY }, { TM_LICENSE_PRIVATE_KEY: SIGNING }, { ...ENV, TM_LICENSE_PRIVATE_KEY: "not-a-key" }]) {
      const { fetch, deps } = setup({ env });
      expect(isCheckoutConfigured(env)).toBe(false);
      expect(await handleCheckout(request(), deps)).toEqual({ status: 503, headers: {}, body: { ok: false, error: "checkout_closed" } });
      expect(fetch).not.toHaveBeenCalled();
    }
    expect(isCheckoutConfigured(ENV)).toBe(true);
  });

  it("stays closed with a live or unknown Stripe key off the live gate, and calls nothing", async () => {
    for (const key of ["sk_live_SYNTHETIC0123456789", "rk_live_SYNTHETIC0123456789", "pk_test_SYNTHETIC0123456789", "sk_SYNTHETIC", "sk_test_"]) {
      for (const env of [{ ...ENV, STRIPE_SECRET_KEY: key }, { ...ENV, STRIPE_SECRET_KEY: key, TM_CHECKOUT_LIVE: "1" }]) {
        const { fetch, deps } = setup({ env });
        expect(isCheckoutConfigured(env)).toBe(false);
        expect(await handleCheckout(request(), deps)).toEqual({ status: 503, headers: {}, body: { ok: false, error: "checkout_closed" } });
        expect(fetch).not.toHaveBeenCalled();
      }
    }
    expect(isCheckoutConfigured({ ...ENV, STRIPE_SECRET_KEY: "rk_test_Synthetic0123" })).toBe(true);
  });

  it("stays closed in test mode when the signing key is the release key, so a test card never buys a real key", async () => {
    const releasePub = publicKeyOf(SIGNING); // stands in for the release key
    const { fetch, deps } = setup();
    expect(isCheckoutConfigured(ENV, releasePub)).toBe(false);
    expect(await handleCheckout(request(), { ...deps, sellerPublicKey: releasePub })).toEqual({ status: 503, headers: {}, body: { ok: false, error: "checkout_closed" } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stays closed with a test key on the Production deployment, with or without the live flag, so the live site never takes a test card", async () => {
    const releasePub = publicKeyOf(SIGNING);
    for (const extra of [{}, { TM_CHECKOUT_LIVE: "1" }]) {
      for (const key of ["sk_test_synthetic_secret", "rk_test_Synth01"]) {
        const prod = { ...ENV, STRIPE_SECRET_KEY: key, VERCEL_ENV: "production", ...extra };
        const { fetch, deps } = setup({ env: prod });
        expect(isCheckoutConfigured(prod)).toBe(false);
        expect(isCheckoutConfigured(prod, releasePub)).toBe(false);
        expect(await handleCheckout(request(), deps)).toEqual({ status: 503, headers: {}, body: { ok: false, error: "checkout_closed" } });
        expect(fetch).not.toHaveBeenCalled();
      }
    }
    expect(isCheckoutConfigured({ ...ENV, VERCEL_ENV: "preview" })).toBe(true);
    expect(isCheckoutConfigured({ ...ENV, VERCEL_ENV: "development" })).toBe(true);
  });

  it("refuses other methods and other origins before calling Stripe", async () => {
    const { fetch, deps } = setup();
    expect((await handleCheckout(request({ method: "GET" }), deps)).status).toBe(405);
    expect((await handleCheckout(request({ origin: "https://evil.example.test" }), deps)).status).toBe(403);
    expect((await handleCheckout(request({ origin: null }), deps)).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("answers 502 on a Stripe failure and keeps Stripe's message in the server log only", async () => {
    const secretish = "No such price: price_x on account acct_synthetic";
    const { log, deps } = setup({ response: () => json({ error: { type: "invalid_request_error", message: secretish } }, 400) });
    const res = await handleCheckout(request(), deps);
    expect(res).toEqual({ status: 502, headers: {}, body: { ok: false, error: "stripe_error" } });
    expect(JSON.stringify(res)).not.toContain("acct_synthetic");
    expect(log).toHaveBeenCalledWith(`checkout: stripe returned status 400: ${secretish}`);
    expect(JSON.stringify(log.mock.calls)).not.toContain(ENV.STRIPE_SECRET_KEY);

    const down = setup({ response: () => { throw new TypeError("fetch failed"); } });
    expect((await handleCheckout(request(), down.deps)).status).toBe(502);
    expect(down.log).toHaveBeenCalledWith("checkout: stripe request failed (TypeError)");
  });

  it("refuses a link that is not an https checkout.stripe.com address", async () => {
    for (const url of ["http://checkout.stripe.com/x", "https://evil.example.test/checkout.stripe.com", "nope", undefined]) {
      const { log, deps } = setup({ response: () => json({ id: "cs_test_x", url }) });
      expect((await handleCheckout(request(), deps)).status).toBe(502);
      expect(log).toHaveBeenCalledWith("checkout: stripe returned an unexpected shape");
    }
  });

  it("derives the site from the request host over https and refuses a bad host", () => {
    expect(siteOrigin({}, "Time-Machine.example.test")).toBe("https://time-machine.example.test");
    expect(siteOrigin({ SITE_ORIGIN: "not a url" }, HOST)).toBe(`https://${HOST}`);
    expect(siteOrigin({}, "bad host/with path")).toBe(null);
    expect(siteOrigin({}, null)).toBe(null);
  });

  it("serves the Web Request signature with no-store and a JSON body", async () => {
    const fetch = vi.fn(async () => created());
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("STRIPE_SECRET_KEY", ENV.STRIPE_SECRET_KEY);
    vi.stubEnv("TM_LICENSE_PRIVATE_KEY", SIGNING);
    try {
      const res = await POST(new Request(`https://${HOST}/api/checkout`, { method: "POST", headers: { host: HOST, origin: `https://${HOST}`, "content-type": "application/json" }, body: JSON.stringify(AGREED) }));
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await res.json()).toEqual({ ok: true, url: LINK });
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("the Buy button's box names the current versions, both pages and the age line, and sends them", () => {
    const script = readFileSync(new URL("../assets/buy.js", import.meta.url), "utf8");
    expect(script).toContain(`var TERMS_VERSION = "${TERMS_VERSION}";`);
    expect(script).toContain(`var PRIVACY_VERSION = "${PRIVACY_VERSION}";`);
    expect(script).toContain(`var BOX_VERSION = "${BOX_VERSION}";`);
    expect(script).toContain('box.setAttribute("data-box-version", BOX_VERSION)');
    expect(script).toContain('boxVersion: box.getAttribute("data-box-version")');
    for (const words of ['"I agree to the "', 'link("terms.html", "Terms (draft)")', '" and have read the "', 'link("privacy.html", "Privacy Policy (draft)")', '". I am 18 or older, or I am the parent or guardian paying."']) expect(script).toContain(words);
    expect(script).not.toMatch(/box\.checked = true/);
    expect(script).toContain("agreement_outdated");
  });
});

// Live checkout opens only when every one of these holds: the Production deployment, TM_CHECKOUT_LIVE exactly "1",
// a restricted live key (rk_live_), and the release signing key. Everything else answers 503 before any Stripe call.
describe("live gate", () => {
  const RELEASE = publicKeyOf(SIGNING); // stands in for the release key, whose private half is not in the repo
  // A synthetic restricted live key, built at run time so it never reads as a real one to a secret scanner.
  const LIVE_RK = "rk_live_" + "synthetic";
  const LIVE = { STRIPE_SECRET_KEY: LIVE_RK, TM_LICENSE_PRIVATE_KEY: SIGNING, VERCEL_ENV: "production", TM_CHECKOUT_LIVE: "1" };

  async function expectClosed(env, sellerPublicKey = RELEASE) {
    const { fetch, deps } = setup({ env });
    expect(isCheckoutConfigured(env, sellerPublicKey), JSON.stringify({ ...env, TM_LICENSE_PRIVATE_KEY: "…" })).toBe(false);
    expect(await handleCheckout(request(), { ...deps, sellerPublicKey })).toEqual({ status: 503, headers: {}, body: { ok: false, error: "checkout_closed" } });
    expect(fetch).not.toHaveBeenCalled();
  }

  it("opens on Production with the exact flag, a restricted live key and the release signing key", async () => {
    expect(isCheckoutConfigured(LIVE, RELEASE)).toBe(true);
    const { fetch, deps } = setup({ env: LIVE });
    expect(await handleCheckout(request(), { ...deps, sellerPublicKey: RELEASE })).toEqual({ status: 200, headers: {}, body: { ok: true, url: LINK } });
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${LIVE.STRIPE_SECRET_KEY}`);
  });

  it("stays closed when any one of the four conditions is missing", async () => {
    const { TM_CHECKOUT_LIVE: _flag, ...noFlag } = LIVE;
    const { VERCEL_ENV: _env, ...noEnv } = LIVE;
    await expectClosed(noFlag);
    await expectClosed(noEnv);
    await expectClosed({ ...LIVE, STRIPE_SECRET_KEY: "sk_test_synthetic_secret" });
    await expectClosed(LIVE, publicKeyOf(Buffer.alloc(32, 9).toString("base64url"))); // a throwaway signer, not the release key
  });

  it("never opens live on a Preview or development deployment, or any other VERCEL_ENV", async () => {
    for (const VERCEL_ENV of ["preview", "development", "Production", "production ", ""]) await expectClosed({ ...LIVE, VERCEL_ENV });
  });

  it("needs TM_CHECKOUT_LIVE to be exactly 1", async () => {
    for (const TM_CHECKOUT_LIVE of ["true", "1 ", " 1", "01", "yes", "yes-attorney-cleared", ""]) await expectClosed({ ...LIVE, TM_CHECKOUT_LIVE });
  });

  it("takes only an anchored restricted live key: no secret, publishable, organization or malformed key", async () => {
    for (const STRIPE_SECRET_KEY of ["sk_live_SYNTH01", "RK_LIVE_SYNTH01", " rk_live_SYNTH01", "rk_live_SYNTH01\n", "rk_live_SYN 01", "rk_live_", "pk_live_SYNTH01", "sk_org_SYNTH01", "xrk_live_SYNTH01"]) {
      await expectClosed({ ...LIVE, STRIPE_SECRET_KEY });
    }
  });

  it("ignores the retired STRIPE_LIVE_OK approval value", async () => {
    const { TM_CHECKOUT_LIVE: _flag, ...noFlag } = LIVE;
    await expectClosed({ ...noFlag, STRIPE_LIVE_OK: "yes-attorney-cleared" });
    await expectClosed({ ...noFlag, STRIPE_SECRET_KEY: "sk_live_" + "synthetic", STRIPE_LIVE_OK: "yes-attorney-cleared" });
    await expectClosed({ ...ENV, VERCEL_ENV: "preview", STRIPE_SECRET_KEY: LIVE_RK, STRIPE_LIVE_OK: "yes-attorney-cleared" });
  });
});
