import { describe, expect, it, vi } from "vitest";
import { handleWaitlist, isAllowedOrigin, isConfigured, MAX_BODY_BYTES } from "./waitlist.js";

// Synthetic data only.
const EMAIL = "Synthetic.Person+tm@Example.test";
const NORMALIZED = "synthetic.person+tm@example.test";
const ENV = { SUPABASE_URL: "https://fake-project.supabase.test/", SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key-123" };
const HOST = "timemachine.example.test";

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

function setup({ env = ENV, response = () => new Response(null, { status: 201 }) } = {}) {
  const fetch = vi.fn(async () => response());
  const log = vi.fn();
  return { fetch, log, deps: { env, fetch, log } };
}

const good = { email: EMAIL, consent: true, source: "/blog/first-post", company: "" };

describe("waitlist handler", () => {
  it("stores a valid signup in Supabase and returns ok", async () => {
    const { fetch, deps } = setup();
    const res = await handleWaitlist(request(good), deps);
    expect(res).toEqual({ status: 200, headers: {}, body: { ok: true } });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://fake-project.supabase.test/rest/v1/waitlist?on_conflict=email_normalized");
    expect(init.method).toBe("POST");
    expect(init.headers.apikey).toBe(ENV.SUPABASE_SERVICE_ROLE_KEY);
    expect(init.headers.Authorization).toBe(`Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`);
    expect(init.headers.Prefer).toBe("return=minimal,resolution=ignore-duplicates");
    expect(JSON.parse(init.body)).toEqual({ email: NORMALIZED, consent: true, source: "/blog/first-post" });
  });

  it("treats a repeat signup as ok (ignored duplicate or 409)", async () => {
    for (const status of [201, 200, 409]) {
      const { deps } = setup({ response: () => new Response(null, { status }) });
      const res = await handleWaitlist(request(good), deps);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    }
  });

  it("rejects invalid emails without calling Supabase", async () => {
    const bad = ["", "no-at-sign", "a@b", "two@@example.test", "spa ce@example.test", `${"a".repeat(250)}@x.test`, 42, null];
    for (const email of bad) {
      const { fetch, deps } = setup();
      const res = await handleWaitlist(request({ ...good, email }), deps);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ ok: false, error: "invalid_email" });
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("requires consent to be exactly true", async () => {
    for (const consent of [undefined, false, "true", 1]) {
      const { fetch, deps } = setup();
      const res = await handleWaitlist(request({ ...good, consent }), deps);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ ok: false, error: "consent_required" });
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("quietly drops bots that fill the honeypot", async () => {
    const { fetch, deps } = setup();
    const res = await handleWaitlist(request({ ...good, company: "Acme Bots" }), deps);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects bodies over 2 KB by header and by actual size", async () => {
    const big = { ...good, source: "/" + "x".repeat(MAX_BODY_BYTES) };
    const byHeader = setup();
    const r1 = await handleWaitlist(request(big), byHeader.deps);
    expect(r1.status).toBe(413);
    expect(r1.body).toEqual({ ok: false, error: "too_large" });

    const byBytes = setup();
    const r2 = await handleWaitlist(request(big, { contentLength: null }), byBytes.deps);
    expect(r2.status).toBe(413);
    expect(byHeader.fetch).not.toHaveBeenCalled();
    expect(byBytes.fetch).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON and non-object bodies", async () => {
    for (const body of ["{not json", "[]", "null", '"text"']) {
      const { deps } = setup();
      const res = await handleWaitlist(request(body), deps);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ ok: false, error: "bad_request" });
    }
  });

  it("allows only POST and says so in the Allow header", async () => {
    for (const method of ["GET", "PUT", "DELETE", "OPTIONS"]) {
      const { fetch, deps } = setup();
      const res = await handleWaitlist(request(good, { method }), deps);
      expect(res.status).toBe(405);
      expect(res.headers).toEqual({ Allow: "POST" });
      expect(res.body).toEqual({ ok: false, error: "method_not_allowed" });
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("refuses other origins and a missing origin", async () => {
    for (const origin of ["https://evil.example.test", null, "null", "file://"]) {
      const { fetch, deps } = setup();
      const res = await handleWaitlist(request(good, { origin }), deps);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ ok: false, error: "forbidden_origin" });
      expect(fetch).not.toHaveBeenCalled();
    }
    expect(isAllowedOrigin("http://localhost:4173", HOST)).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:3000", HOST)).toBe(true);
    expect(isAllowedOrigin(`https://${HOST}`, HOST)).toBe(true);
  });

  it("returns not_configured when either variable is missing", async () => {
    const envs = [{}, { SUPABASE_URL: ENV.SUPABASE_URL }, { SUPABASE_SERVICE_ROLE_KEY: "k" }, { ...ENV, SUPABASE_URL: "not a url" }];
    for (const env of envs) {
      const { fetch, deps } = setup({ env });
      const res = await handleWaitlist(request(good), deps);
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ ok: false, error: "not_configured" });
      expect(fetch).not.toHaveBeenCalled();
      expect(isConfigured(env)).toBe(false);
    }
    expect(isConfigured(ENV)).toBe(true);
  });

  it("returns 502 upstream when Supabase fails or is unreachable", async () => {
    const failing = setup({ response: () => new Response(`{"message":"boom"}`, { status: 500 }) });
    const r1 = await handleWaitlist(request(good), failing.deps);
    expect(r1.status).toBe(502);
    expect(r1.body).toEqual({ ok: false, error: "upstream" });

    const down = setup({
      response: () => {
        throw new TypeError("fetch failed");
      },
    });
    const r2 = await handleWaitlist(request(good), down.deps);
    expect(r2.status).toBe(502);
    expect(r2.body).toEqual({ ok: false, error: "upstream" });
  });

  it("never puts the email or the key in a log line or a response", async () => {
    const leaky = `{"message":"duplicate key","details":"Key (email_normalized)=(${NORMALIZED}) already exists, key ${ENV.SUPABASE_SERVICE_ROLE_KEY}"}`;
    const cases = [
      setup({ response: () => new Response(leaky, { status: 500 }) }),
      setup({
        response: () => {
          throw new Error(`connect failed for ${NORMALIZED} with ${ENV.SUPABASE_SERVICE_ROLE_KEY}`);
        },
      }),
      setup({ env: {} }),
      setup(),
    ];
    for (const { deps, log } of cases) {
      const res = await handleWaitlist(request(good), deps);
      const outputs = [JSON.stringify(res), ...log.mock.calls.map((args) => args.join(" "))];
      for (const out of outputs) {
        expect(out.toLowerCase()).not.toContain(NORMALIZED);
        expect(out).not.toContain(ENV.SUPABASE_SERVICE_ROLE_KEY);
      }
    }
    // The failure cases did log something, so the check above was not vacuous.
    expect(cases[0].log).toHaveBeenCalled();
    expect(cases[1].log).toHaveBeenCalled();
  });

  it("never throws, even when the body cannot be read", async () => {
    const { deps } = setup();
    const res = await handleWaitlist(
      request(good, {
        readBody: async () => {
          throw new Error(`stream broke while reading ${NORMALIZED}`);
        },
      }),
      deps,
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(res)).not.toContain(NORMALIZED);
  });

  it("stores only a path as the source", async () => {
    const { fetch, deps } = setup();
    await handleWaitlist(request({ ...good, source: "https://elsewhere.test/x" }), deps);
    expect(JSON.parse(fetch.mock.calls[0][1].body).source).toBeNull();
  });
});
