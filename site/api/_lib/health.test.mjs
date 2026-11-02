import { expect, it, vi } from "vitest";
import { publicKeyOf } from "./checkout.js";
import { checkHealth } from "./health.js";

// Synthetic values only.
const ENV = { SUPABASE_URL: "https://synthetic.example.test", SUPABASE_KEY: "synthetic-secret-db", RESEND_API_KEY: "synthetic-secret-mail" };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

it("reports configured but unreachable when the database refuses the key, and never the keys", async () => {
  const log = vi.fn();
  const fetch = vi.fn(async () => json({ message: "Invalid API key" }, 401));
  const body = await checkHealth({ env: ENV, fetch, log });
  expect(body).toEqual({ ok: true, waitlist: true, database: "unreachable", email: false, checkout: false, auth: false, releaseKey: false, billing: "off", webhookConfigured: false });
  expect(JSON.stringify(body)).not.toContain("synthetic-secret");
  expect(log).toHaveBeenCalledWith("health: upstream returned status 401");
});

it("reports reachable only after a real read-only call answers with rows", async () => {
  const fetch = vi.fn(async () => json([]));
  expect(await checkHealth({ env: ENV, fetch })).toEqual({ ok: true, waitlist: true, database: "reachable", email: false, checkout: false, auth: false, releaseKey: false, billing: "off", webhookConfigured: false });
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe("https://synthetic.example.test/rest/v1/rpc/waitlist_status");
  expect(init.headers["Accept-Profile"]).toBe("tm_waitlist");
  expect(JSON.parse(init.body)).toEqual({ p_code: "" });
});

it("reports unreachable on a network failure and skips the call when not configured", async () => {
  const down = vi.fn(async () => { throw new TypeError("fetch failed"); });
  expect((await checkHealth({ env: ENV, fetch: down })).database).toBe("unreachable");
  const fetch = vi.fn();
  expect(await checkHealth({ env: { ...ENV, SUPABASE_KEY: "" }, fetch })).toEqual({ ok: true, waitlist: false, database: "not_configured", email: false, checkout: false, auth: false, releaseKey: false, billing: "off", webhookConfigured: false });
  expect(fetch).not.toHaveBeenCalled();
});

it("reports checkout only when the Stripe key and a well formed signing key are both set, without calling Stripe", async () => {
  const fetch = vi.fn();
  const signing = Buffer.alloc(32, 7).toString("base64url");
  const env = { STRIPE_SECRET_KEY: "sk_test_synthetic", TM_LICENSE_PRIVATE_KEY: signing };
  const body = await checkHealth({ env, fetch });
  expect(body).toEqual({ ok: true, waitlist: false, database: "not_configured", email: false, checkout: true, auth: false, releaseKey: false, billing: "test", webhookConfigured: false });
  expect(JSON.stringify(body)).not.toContain("synthetic");
  expect(JSON.stringify(body)).not.toContain(signing);
  expect((await checkHealth({ env: { ...env, TM_LICENSE_PRIVATE_KEY: "" }, fetch })).checkout).toBe(false);
  expect((await checkHealth({ env: { ...env, TM_LICENSE_PRIVATE_KEY: "tooshort" }, fetch })).checkout).toBe(false);
  expect((await checkHealth({ env: { ...env, STRIPE_SECRET_KEY: "" }, fetch })).checkout).toBe(false);
  expect((await checkHealth({ env: { ...env, STRIPE_SECRET_KEY: "sk_live_SYNTHETIC0123456789" }, fetch })).checkout).toBe(false);
  // Live opens only behind the full production gate; the retired approval value opens nothing.
  const liveRk = "rk_live_" + "synthetic";
  expect((await checkHealth({ env: { ...env, STRIPE_SECRET_KEY: liveRk, VERCEL_ENV: "production", STRIPE_LIVE_OK: "yes-attorney-cleared" }, fetch })).checkout).toBe(false);
  expect((await checkHealth({ env: { ...env, STRIPE_SECRET_KEY: liveRk, VERCEL_ENV: "production", TM_CHECKOUT_LIVE: "1" }, fetch })).checkout).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

// Security L4: the post-flip probe reads the mode as a value, never a key. "live" only when the full Production gate
// opens; a live key that the gate refuses reads "off", not "live".
it("reports billing off, test or live from the gate, never from the key alone", async () => {
  const fetch = vi.fn();
  const pub = (await import("./checkout.js")).publicKeyOf;
  const release = Buffer.alloc(32, 9).toString("base64url");
  const prodLive = { STRIPE_SECRET_KEY: "rk_live_" + "SYNTH0123", TM_LICENSE_PRIVATE_KEY: release, VERCEL_ENV: "production", TM_CHECKOUT_LIVE: "1" };
  const mode = async (env) => (await checkHealth({ env, fetch, sellerPublicKey: pub(release) })).billing;
  expect(await mode(prodLive)).toBe("live");
  expect(await mode({ ...prodLive, TM_CHECKOUT_LIVE: "true" })).toBe("off");
  expect(await mode({ ...prodLive, VERCEL_ENV: "preview" })).toBe("off");
  expect(await mode({ ...prodLive, STRIPE_SECRET_KEY: "sk_test_SYNTH" })).toBe("off");
  expect(await mode({ STRIPE_SECRET_KEY: "rk_test_SYNTH", TM_LICENSE_PRIVATE_KEY: Buffer.alloc(32, 3).toString("base64url"), VERCEL_ENV: "preview" })).toBe("test");
  const body = JSON.stringify(await checkHealth({ env: prodLive, fetch, sellerPublicKey: pub(release) }));
  expect(body).not.toContain("SYNTH0123");
  expect(body).not.toContain(release);
  expect(fetch).not.toHaveBeenCalled();
});

it("reports auth only when SUPABASE_URL and SUPABASE_ANON_KEY are both set, never from SUPABASE_KEY", async () => {
  const fetch = vi.fn(async () => json([]));
  expect((await checkHealth({ env: ENV, fetch })).auth).toBe(false);
  expect((await checkHealth({ env: { ...ENV, SUPABASE_ANON_KEY: "synthetic-anon" }, fetch })).auth).toBe(true);
  expect((await checkHealth({ env: { SUPABASE_ANON_KEY: "synthetic-anon" }, fetch })).auth).toBe(false);
});

// Live-flip condition 2 (Security, 31 Oct): Production proves its signing key is the release key without anyone reading it.
it("reports releaseKey true only when the configured private key's public half is the release public key, as a boolean only", async () => {
  const fetch = vi.fn();
  const signing = Buffer.alloc(32, 7).toString("base64url");
  const release = publicKeyOf(signing); // stands in for SELLER_PUBLIC_KEY, whose private half is only in Vercel
  const body = await checkHealth({ env: { TM_LICENSE_PRIVATE_KEY: signing }, fetch, sellerPublicKey: release });
  expect(body.releaseKey).toBe(true);
  expect(JSON.stringify(body)).not.toContain(signing);
  expect(JSON.stringify(body)).not.toContain(release);
  const other = Buffer.alloc(32, 8).toString("base64url");
  for (const TM_LICENSE_PRIVATE_KEY of [other, undefined, "", "tooshort", "A".repeat(42), `${signing}\n`, ` ${signing}`, "!".repeat(43)]) {
    expect((await checkHealth({ env: { TM_LICENSE_PRIVATE_KEY }, fetch, sellerPublicKey: release })).releaseKey, String(TM_LICENSE_PRIVATE_KEY)).toBe(false);
  }
  // Without the injected stand-in, the committed release public key is the one compared.
  expect((await checkHealth({ env: { TM_LICENSE_PRIVATE_KEY: signing }, fetch })).releaseKey).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
