import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./auth.js";
import { BOX_VERSION, PRIVACY_VERSION, TERMS_VERSION } from "./_lib/agreement.js";
import { handleAuth, isAuthConfigured } from "./_lib/auth.js";
import { LIMITS, resetRateLimits } from "./_lib/ratelimit.js";

// Synthetic values only.
const ENV = { SUPABASE_URL: "https://fake-project.supabase.test/", SUPABASE_ANON_KEY: "synthetic-anon-key" };
const HOST = "timemachine.example.test";
const EMAIL = "Buyer@Example.test";
const NORMALIZED = "buyer@example.test";
const TOKEN = "synthetic.access.token-0123456789";
// The current box was ticked to agree to the Terms and confirm the Privacy notice was read.
const AGREED = { agreed: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, boxVersion: BOX_VERSION };
const SEND = { action: "send", email: EMAIL, ...AGREED };
const NOW = Date.UTC(2026, 9, 28, 9, 30, 0);
const RECORD = { agreed_at: "2026-10-28T09:30:00.000Z", terms_version: TERMS_VERSION, privacy_version: PRIVACY_VERSION, box_version: BOX_VERSION };
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
  const fetch = vi.fn(async (url, init) => response(url, init));
  const log = vi.fn();
  return { fetch, log, deps: { env, fetch, log, now: () => NOW } };
}

beforeEach(() => resetRateLimits());

describe("auth handler", () => {
  it("send asks Supabase for a code with the normalized email, create_user and the agreement, and never logs the email", async () => {
    const { fetch, log, deps } = setup();
    const res = await handleAuth(request(SEND), deps);
    expect(res).toEqual({ status: 200, headers: {}, body: { ok: true } });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://fake-project.supabase.test/auth/v1/otp");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ apikey: ENV.SUPABASE_ANON_KEY, "Content-Type": "application/json" });
    // A new email's account is created with the agreement in its user metadata. Supabase ignores data for an existing one.
    expect(JSON.parse(init.body)).toEqual({ email: NORMALIZED, create_user: true, data: RECORD });
    const failing = setup({ response: () => json({ msg: `Error sending to ${NORMALIZED}` }, 500) });
    expect((await handleAuth(request(SEND), failing.deps)).body).toEqual({ ok: false, error: "auth_error" });
    expect(JSON.stringify(failing.log.mock.calls)).not.toContain("example.test");
    expect(log).not.toHaveBeenCalled();
  });

  it("verify trades the code for a token and expiry, and a wrong code is 401 without detail", async () => {
    const { fetch, deps } = setup({ response: (url) => (url.endsWith("/user") ? json({ id: "u1" }) : json({ access_token: TOKEN, token_type: "bearer", expires_in: 3600, refresh_token: "r", user: { email: NORMALIZED } })) });
    const res = await handleAuth(request({ action: "verify", email: EMAIL, code: "123456", ...AGREED }), deps);
    expect(res).toEqual({ status: 200, headers: {}, body: { ok: true, token: TOKEN, expiresIn: 3600 } });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://fake-project.supabase.test/auth/v1/verify");
    expect(JSON.parse(init.body)).toEqual({ type: "email", email: NORMALIZED, token: "123456" });
    for (const status of [400, 401, 403]) {
      const bad = setup({ response: () => json({ msg: "Token has expired or is invalid" }, status) });
      expect(await handleAuth(request({ action: "verify", email: EMAIL, code: "1234567890", ...AGREED }), bad.deps)).toEqual({ status: 401, headers: {}, body: { ok: false, error: "bad_code" } });
      expect(bad.log).not.toHaveBeenCalled();
      expect(bad.fetch).toHaveBeenCalledTimes(1);
    }
    const shape = setup({ response: () => json({ access_token: "", expires_in: 3600 }) });
    expect((await handleAuth(request({ action: "verify", email: EMAIL, code: "123456", ...AGREED }), shape.deps)).status).toBe(502);
    expect(shape.log).toHaveBeenCalledWith("auth: supabase verify returned an unexpected shape");
  });

  it("refuses send and verify without a ticked box, with 400 and no Supabase call", async () => {
    const { fetch, deps } = setup();
    const unticked = [
      { action: "send", email: EMAIL },
      { action: "send", email: EMAIL, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, boxVersion: BOX_VERSION },
      { ...SEND, agreed: false },
      { ...SEND, agreed: "true" },
      { action: "verify", email: EMAIL, code: "123456" },
      { action: "verify", email: EMAIL, code: "123456", ...AGREED, agreed: 1 },
    ];
    for (const body of unticked) {
      expect(await handleAuth(request(body), deps)).toEqual({ status: 400, headers: {}, body: { ok: false, error: "agreement_required" } });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a box ticked next to other or missing versions, with 400 agreement_outdated and no Supabase call", async () => {
    const { fetch, deps } = setup();
    for (const action of ["send", "verify"]) {
      for (const field of ["termsVersion", "privacyVersion", "boxVersion"]) {
        for (const value of ["outdated-version", undefined]) {
          const body = { action, email: EMAIL, ...(action === "verify" ? { code: "123456" } : {}), ...AGREED, [field]: value };
          expect(await handleAuth(request(body), deps)).toEqual({ status: 400, headers: {}, body: { ok: false, error: "agreement_outdated" } });
        }
      }
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("verify records the agreement on the signed-in user, so an email that already had an account gets it too", async () => {
    const verified = () => json({ access_token: TOKEN, expires_in: 3600 });
    const { fetch, deps } = setup({ response: (url) => (url.endsWith("/user") ? json({ id: "u1" }) : verified()) });
    expect((await handleAuth(request({ action: "verify", email: EMAIL, code: "123456", ...AGREED }), deps)).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = fetch.mock.calls[1];
    expect(url).toBe("https://fake-project.supabase.test/auth/v1/user");
    expect(init.method).toBe("PUT");
    expect(init.headers).toEqual({ apikey: ENV.SUPABASE_ANON_KEY, "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` });
    expect(JSON.parse(init.body)).toEqual({ data: RECORD });

    // Not recorded means not signed in: the token is not handed out.
    const failing = setup({ response: (u) => (u.endsWith("/user") ? json({ msg: `user ${NORMALIZED}` }, 500) : verified()) });
    const res = await handleAuth(request({ action: "verify", email: EMAIL, code: "123456", ...AGREED }), failing.deps);
    expect(res).toEqual({ status: 502, headers: {}, body: { ok: false, error: "auth_error" } });
    expect(failing.log).toHaveBeenCalledWith("auth: supabase user update returned status 500");
    expect(JSON.stringify(failing.log.mock.calls)).not.toContain("example.test");
    const down = setup({ response: (u) => { if (u.endsWith("/user")) throw new TypeError("fetch failed"); return verified(); } });
    expect((await handleAuth(request({ action: "verify", email: EMAIL, code: "123456", ...AGREED }), down.deps)).body).toEqual({ ok: false, error: "auth_error" });
    expect(down.log).toHaveBeenCalledWith("auth: supabase request failed (TypeError)");
  });

  it("passes Supabase's 429 through as rate_limited and limits per client itself", async () => {
    const { deps } = setup({ response: () => json({ msg: "too many" }, 429) });
    expect(await handleAuth(request(SEND), deps)).toEqual({ status: 429, headers: { "Retry-After": "60" }, body: { ok: false, error: "rate_limited" } });
    const { fetch, deps: ok } = setup();
    resetRateLimits();
    for (let i = 0; i < LIMITS.send; i += 1) expect((await handleAuth(request(SEND, { ip: "203.0.113.7" }), ok)).status).toBe(200);
    expect((await handleAuth(request(SEND, { ip: "203.0.113.7" }), ok)).status).toBe(429);
    expect((await handleAuth(request(SEND, { ip: "203.0.113.8" }), ok)).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(LIMITS.send + 1);
  });

  it("validates the body, the method and the origin before calling anyone", async () => {
    const { fetch, deps } = setup();
    for (const body of [{ action: "send", ...AGREED }, { ...SEND, email: "nope" }, { ...SEND, email: `${"a".repeat(250)}@example.test` }, { action: "verify", email: EMAIL, code: "12345", ...AGREED }, { action: "verify", email: EMAIL, code: "abcdef", ...AGREED }, { action: "reset", email: EMAIL, ...AGREED }, []]) {
      expect((await handleAuth(request(body), deps)).status).toBe(400);
    }
    expect((await handleAuth(request("{not json"), deps)).status).toBe(400);
    expect((await handleAuth(request(SEND, { method: "GET" }), deps)).status).toBe(405);
    expect((await handleAuth(request(SEND, { origin: "https://evil.example.test" }), deps)).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("is closed with 503 until SUPABASE_URL and SUPABASE_ANON_KEY are both set, with no fallback to SUPABASE_KEY", async () => {
    for (const env of [{}, { SUPABASE_URL: ENV.SUPABASE_URL }, { SUPABASE_ANON_KEY: "x" }, { SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_KEY: "synthetic-other-key" }]) {
      const { fetch, deps } = setup({ env });
      expect(isAuthConfigured(env)).toBe(false);
      expect(await handleAuth(request(SEND), deps)).toEqual({ status: 503, headers: {}, body: { ok: false, error: "auth_closed" } });
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
        body: JSON.stringify(SEND),
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

  it("the sign-in page has an unticked box naming the current versions, with both pages linked and the age line", () => {
    const page = readFileSync(new URL("../account.html", import.meta.url), "utf8");
    const send = page.slice(page.indexOf('data-account-step="send"'), page.indexOf('data-account-step="verify"'));
    const box = send.match(/<label class="wl-consent account-agree">(<input\b[^>]*>)<span>(.*?)<\/span><\/label>/);
    expect(box).not.toBeNull();
    expect(box[1]).toContain('type="checkbox"');
    expect(box[1]).not.toContain("checked");
    expect(box[1]).toContain(`data-terms-version="${TERMS_VERSION}"`);
    expect(box[1]).toContain(`data-privacy-version="${PRIVACY_VERSION}"`);
    expect(box[1]).toContain(`data-box-version="${BOX_VERSION}"`);
    expect(box[2]).toBe('I agree to the <a href="terms.html">Terms (draft)</a> and have read the <a href="privacy.html">Privacy notice (draft)</a>. I am 13 or older.');
    // Why a send was refused is said right under the box, and the box names it (Design, 28 Oct).
    const note = box[1].match(/aria-describedby="([^"]+)"/)?.[1];
    expect(note).toBeTruthy();
    expect(send.indexOf(`id="${note}"`)).toBeGreaterThan(send.indexOf(box[0]));
    const script = readFileSync(new URL("../assets/account.js", import.meta.url), "utf8");
    expect(script).toContain("agreement_required");
    expect(script).toContain("agreement_outdated");
  });
});
