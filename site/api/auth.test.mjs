import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./auth.js";
import { handleAuth, isAuthConfigured, LIMITS, resetRateLimits } from "./_lib/auth.js";

// Synthetic values only.
const ENV = { SUPABASE_URL: "https://fake-project.supabase.test/", SUPABASE_ANON_KEY: "synthetic-anon-key" };
const HOST = "timemachine.example.test";
const EMAIL = "Buyer@Example.test";
const NORMALIZED = "buyer@example.test";
const TOKEN = "synthetic.access.token-0123456789";
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

function request(body, overrides = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    method: "POST",
    origin: `https://${HOST}`,
    host: HOST,
    contentLength: String(new TextEncoder().encode(text).length),
    readBody: async () => text,
    ...overrides,
  };
}

function setup({ env = ENV, response = () => json({}) } = {}) {
  const fetch = vi.fn(async () => response());
  const log = vi.fn();
  return { fetch, log, deps: { env, fetch, log } };
}

beforeEach(() => resetRateLimits());

describe("auth handler", () => {
  it("send asks Supabase for a code with the normalized email and create_user, and never logs the email", async () => {
    const { fetch, log, deps } = setup();
    const res = await handleAuth(request({ action: "send", email: EMAIL }), deps);
    expect(res).toEqual({ status: 200, headers: {}, body: { ok: true } });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://fake-project.supabase.test/auth/v1/otp");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ apikey: ENV.SUPABASE_ANON_KEY, "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ email: NORMALIZED, create_user: true });
    const failing = setup({ response: () => json({ msg: `Error sending to ${NORMALIZED}` }, 500) });
    expect((await handleAuth(request({ action: "send", email: EMAIL }), failing.deps)).body).toEqual({ ok: false, error: "auth_error" });
    expect(JSON.stringify(failing.log.mock.calls)).not.toContain("example.test");
    expect(log).not.toHaveBeenCalled();
  });

  it("verify trades the code for a token and expiry, and a wrong code is 401 without detail", async () => {
    const { fetch, deps } = setup({ response: () => json({ access_token: TOKEN, token_type: "bearer", expires_in: 3600, refresh_token: "r", user: { email: NORMALIZED } }) });
    const res = await handleAuth(request({ action: "verify", email: EMAIL, code: "123456" }), deps);
    expect(res).toEqual({ status: 200, headers: {}, body: { ok: true, token: TOKEN, expiresIn: 3600 } });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://fake-project.supabase.test/auth/v1/verify");
    expect(JSON.parse(init.body)).toEqual({ type: "email", email: NORMALIZED, token: "123456" });
    for (const status of [400, 401, 403]) {
      const bad = setup({ response: () => json({ msg: "Token has expired or is invalid" }, status) });
      expect(await handleAuth(request({ action: "verify", email: EMAIL, code: "1234567890" }), bad.deps)).toEqual({ status: 401, headers: {}, body: { ok: false, error: "bad_code" } });
      expect(bad.log).not.toHaveBeenCalled();
    }
    const shape = setup({ response: () => json({ access_token: "", expires_in: 3600 }) });
    expect((await handleAuth(request({ action: "verify", email: EMAIL, code: "123456" }), shape.deps)).status).toBe(502);
    expect(shape.log).toHaveBeenCalledWith("auth: supabase verify returned an unexpected shape");
  });

  it("passes Supabase's 429 through as rate_limited and limits per client itself", async () => {
    const { deps } = setup({ response: () => json({ msg: "too many" }, 429) });
    expect(await handleAuth(request({ action: "send", email: EMAIL }), deps)).toEqual({ status: 429, headers: { "Retry-After": "60" }, body: { ok: false, error: "rate_limited" } });
    const { fetch, deps: ok } = setup();
    resetRateLimits();
    for (let i = 0; i < LIMITS.send; i += 1) expect((await handleAuth(request({ action: "send", email: EMAIL }, { ip: "203.0.113.7" }), ok)).status).toBe(200);
    expect((await handleAuth(request({ action: "send", email: EMAIL }, { ip: "203.0.113.7" }), ok)).status).toBe(429);
    expect((await handleAuth(request({ action: "send", email: EMAIL }, { ip: "203.0.113.8" }), ok)).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(LIMITS.send + 1);
  });

  it("validates the body, the method and the origin before calling anyone", async () => {
    const { fetch, deps } = setup();
    for (const body of [{ action: "send" }, { action: "send", email: "nope" }, { action: "send", email: `${"a".repeat(250)}@example.test` }, { action: "verify", email: EMAIL, code: "12345" }, { action: "verify", email: EMAIL, code: "abcdef" }, { action: "reset", email: EMAIL }, []]) {
      expect((await handleAuth(request(body), deps)).status).toBe(400);
    }
    expect((await handleAuth(request("{not json"), deps)).status).toBe(400);
    expect((await handleAuth(request({ action: "send", email: EMAIL }, { method: "GET" }), deps)).status).toBe(405);
    expect((await handleAuth(request({ action: "send", email: EMAIL }, { origin: "https://evil.example.test" }), deps)).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("is closed with 503 until SUPABASE_URL and SUPABASE_ANON_KEY are both set, with no fallback to SUPABASE_KEY", async () => {
    for (const env of [{}, { SUPABASE_URL: ENV.SUPABASE_URL }, { SUPABASE_ANON_KEY: "x" }, { SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_KEY: "synthetic-other-key" }]) {
      const { fetch, deps } = setup({ env });
      expect(isAuthConfigured(env)).toBe(false);
      expect(await handleAuth(request({ action: "send", email: EMAIL }), deps)).toEqual({ status: 503, headers: {}, body: { ok: false, error: "auth_closed" } });
      expect(fetch).not.toHaveBeenCalled();
    }
    expect(isAuthConfigured(ENV)).toBe(true);
  });

  it("serves the Web Request signature with no-store and never sends the IP upstream", async () => {
    const fetch = vi.fn(async () => json({}));
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("SUPABASE_URL", ENV.SUPABASE_URL);
    vi.stubEnv("SUPABASE_ANON_KEY", ENV.SUPABASE_ANON_KEY);
    try {
      const res = await POST(new Request(`https://${HOST}/api/auth`, {
        method: "POST",
        headers: { host: HOST, origin: `https://${HOST}`, "x-forwarded-for": "203.0.113.9", "content-type": "application/json" },
        body: JSON.stringify({ action: "send", email: EMAIL }),
      }));
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      const [url, init] = fetch.mock.calls[0];
      expect(`${url} ${init.body} ${JSON.stringify(init.headers)}`).not.toContain("203.0.113.9");
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
