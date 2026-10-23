import { describe, expect, it, vi } from "vitest";
import { POST } from "./checkout.js";
import { handleCheckout, isCheckoutConfigured, LIVE_APPROVAL, PRICE_CENTS, PRODUCT_NAME, PRODUCT_TAG, publicKeyOf, siteOrigin } from "./_lib/checkout.js";

// Synthetic values only. The signing key is 32 arbitrary bytes; it never signs anything here.
const SIGNING = Buffer.alloc(32, 3).toString("base64url");
const ENV = { STRIPE_SECRET_KEY: "sk_test_synthetic_secret", TM_LICENSE_PRIVATE_KEY: SIGNING };
const HOST = "timemachine.example.test";
const LINK = "https://checkout.stripe.com/c/pay/cs_test_synthetic#abc";
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const created = () => json({ id: "cs_test_synthetic", object: "checkout.session", url: LINK });

function request(overrides = {}) {
  return { method: "POST", origin: `https://${HOST}`, host: HOST, ...overrides };
}

function setup({ env = ENV, response = created } = {}) {
  const fetch = vi.fn(async () => response());
  const log = vi.fn();
  return { fetch, log, deps: { env, fetch, log } };
}

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
    const form = Object.fromEntries(new URLSearchParams(init.body));
    expect(form).toEqual({
      mode: "payment",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(PRICE_CENTS),
      "line_items[0][price_data][product_data][name]": PRODUCT_NAME,
      success_url: `https://${HOST}/thanks?session={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://${HOST}/#pricing`,
      allow_promotion_codes: "true",
      "metadata[product]": "tm-web",
      "payment_intent_data[metadata][product]": "tm-web",
    });
    expect(PRICE_CENTS).toBe(5000);
    expect(PRODUCT_TAG).toBe("tm-web");
    expect(form.mode).not.toBe("subscription");
  });

  it("uses a Stripe price id and SITE_ORIGIN when they are set", async () => {
    const { fetch, deps } = setup({ env: { ...ENV, STRIPE_PRICE_ID: "price_synthetic", SITE_ORIGIN: "https://tm.example.test/" } });
    expect((await handleCheckout(request(), deps)).status).toBe(200);
    const form = Object.fromEntries(new URLSearchParams(fetch.mock.calls[0][1].body));
    expect(form["line_items[0][price]"]).toBe("price_synthetic");
    expect(Object.keys(form).some((k) => k.includes("price_data"))).toBe(false);
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

  it("stays closed with a live or unknown Stripe key until live mode is approved, and calls nothing", async () => {
    for (const key of ["sk_live_SYNTHETIC0123456789", "rk_live_SYNTHETIC0123456789", "pk_test_SYNTHETIC0123456789", "sk_SYNTHETIC", "sk_test_"]) {
      for (const env of [{ ...ENV, STRIPE_SECRET_KEY: key }, { ...ENV, STRIPE_SECRET_KEY: key, STRIPE_LIVE_OK: "yes" }]) {
        const { fetch, deps } = setup({ env });
        expect(isCheckoutConfigured(env)).toBe(false);
        expect(await handleCheckout(request(), deps)).toEqual({ status: 503, headers: {}, body: { ok: false, error: "checkout_closed" } });
        expect(fetch).not.toHaveBeenCalled();
      }
    }
    expect(isCheckoutConfigured({ ...ENV, STRIPE_SECRET_KEY: "rk_test_Synthetic0123" })).toBe(true);
    expect(isCheckoutConfigured({ ...ENV, STRIPE_SECRET_KEY: "sk_live_SYNTHETIC0123456789", STRIPE_LIVE_OK: LIVE_APPROVAL })).toBe(true);
  });

  it("stays closed in test mode when the signing key is the release key, so a test card never buys a real key", async () => {
    const releasePub = publicKeyOf(SIGNING); // stands in for the release key
    const { fetch, deps } = setup();
    expect(isCheckoutConfigured(ENV, releasePub)).toBe(false);
    expect(await handleCheckout(request(), { ...deps, sellerPublicKey: releasePub })).toEqual({ status: 503, headers: {}, body: { ok: false, error: "checkout_closed" } });
    expect(fetch).not.toHaveBeenCalled();
    expect(isCheckoutConfigured({ ...ENV, STRIPE_LIVE_OK: LIVE_APPROVAL }, releasePub)).toBe(true);
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
      const res = await POST(new Request(`https://${HOST}/api/checkout`, { method: "POST", headers: { host: HOST, origin: `https://${HOST}` } }));
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await res.json()).toEqual({ ok: true, url: LINK });
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
