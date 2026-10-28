import { describe, expect, it, vi } from "vitest";
import { POST } from "../waitlist.js";
import { clientId, clientIp, handleWaitlist, isAllowedOrigin, isConfigured, MAX_BODY_BYTES, readRequestBody } from "./waitlist.js";

// Synthetic data only.
const EMAIL = "Synthetic.Person+tm@Example.test";
const NORMALIZED = "synthetic.person+tm@example.test";
const ENV = { SUPABASE_URL: "https://fake-project.supabase.test/", SUPABASE_KEY: "fake-service-role-key-123" };
const HOST = "timemachine.example.test";
// Documentation addresses only (RFC 5737, RFC 3849).
const IP = "203.0.113.7";
const OTHER_IP = "198.51.100.23";

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

const CODE = "abc123xyz0";
const REF = "frnd000ref";
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const joined = () => json([{ saved: true }]);

function setup({ env = ENV, response = joined } = {}) {
  const fetch = vi.fn(async () => response());
  const log = vi.fn();
  return { fetch, log, deps: { env, fetch, log } };
}

const good = { email: EMAIL, consent: true, source: "/blog/first-post", company: "" };

describe("waitlist handler", () => {
  it("saves a pending signup with one Supabase call and sends no email", async () => {
    const { fetch, deps } = setup();
    const res = await handleWaitlist(request(good), deps);
    expect(res).toEqual({ status: 200, headers: {}, body: { ok: true, pending: true } });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://fake-project.supabase.test/rest/v1/rpc/waitlist_join_pending");
    expect(init.method).toBe("POST");
    expect(init.headers.apikey).toBe(ENV.SUPABASE_KEY);
    expect(init.headers.Authorization).toBe(`Bearer ${ENV.SUPABASE_KEY}`);
    expect(JSON.parse(init.body)).toEqual({ p_email: NORMALIZED, p_source: "/blog/first-post", p_ref: null, p_client: null });
  });

  it("passes a well formed ref code to Supabase", async () => {
    const { fetch, deps } = setup();
    const res = await handleWaitlist(request({ ...good, ref: REF }), deps);
    expect(res.status).toBe(200);
    expect(JSON.parse(fetch.mock.calls[0][1].body).p_ref).toBe(REF);
  });

  it("ignores a bad ref and still signs the person up", async () => {
    const bad = ["", "short", "UPPERCASE1", "abc123xyz01", "abc-23xyz0", " abc123xyz0", 1234567890, null, {}, ["abc123xyz0"]];
    for (const ref of bad) {
      const { fetch, deps } = setup();
      const res = await handleWaitlist(request({ ...good, ref }), deps);
      expect(res.body).toEqual({ ok: true, pending: true });
      expect(JSON.parse(fetch.mock.calls[0][1].body).p_ref).toBeNull();
    }
  });

  it("does not claim success when Supabase answers with an unexpected shape", async () => {
    const shapes = [
      () => json({ saved: true }),
      () => json([]),
      () => json([{ saved: "true" }]),
      () => json([{ saved: true }, { saved: true }]),
      () => new Response("not json", { status: 200 }),
      () => new Response(null, { status: 409 }),
    ];
    for (const response of shapes) {
      const { deps, log } = setup({ response });
      const res = await handleWaitlist(request(good), deps);
      expect(res.status).toBe(502);
      expect(res.body).toEqual({ ok: false, error: "upstream" });
      expect(log).toHaveBeenCalled();
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
    expect(res.body).toEqual({ ok: true, pending: true });
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

  it("allows only GET and POST and says so in the Allow header", async () => {
    for (const method of ["HEAD", "PUT", "DELETE", "OPTIONS"]) {
      const { fetch, deps } = setup();
      const res = await handleWaitlist(request(good, { method }), deps);
      expect(res.status).toBe(405);
      expect(res.headers).toEqual({ Allow: "GET, POST" });
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
    // Both hosts serve the site (Security D-1/D-2, 28 Oct): each accepts only its own origin.
    expect(isAllowedOrigin("https://time-machine.company", "time-machine.company")).toBe(true);
    expect(isAllowedOrigin("https://time-machine-site.vercel.app", "time-machine.company")).toBe(false);
    expect(isAllowedOrigin("https://time-machine.company", "time-machine-site.vercel.app")).toBe(false);
  });

  it("compares Origin with the Host header and ignores x-forwarded-host", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("SUPABASE_URL", "");
    try {
      const send = (origin) =>
        POST(new Request(`https://${HOST}/api/waitlist`, {
          method: "POST",
          headers: { host: HOST, origin, "x-forwarded-host": "evil.example.test", "content-type": "application/json" },
          body: JSON.stringify(good),
        }));
      const spoofed = await send("https://evil.example.test");
      expect(spoofed.status).toBe(403);
      expect(await spoofed.json()).toEqual({ ok: false, error: "forbidden_origin" });
      const same = await send(`https://${HOST}`);
      expect(same.status).not.toBe(403);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("returns not_configured when either variable is missing", async () => {
    const envs = [{}, { SUPABASE_URL: ENV.SUPABASE_URL }, { SUPABASE_KEY: "k" }, { ...ENV, SUPABASE_URL: "not a url" }];
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

  it("stops a body without Content-Length at the byte limit instead of buffering it all", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_BODY_BYTES + 1));
        // The sender never finishes. The handler must cancel and reply without waiting for EOF.
      },
      cancel,
    });
    const { fetch, deps } = setup();
    const req = request("", {
      contentLength: null,
      readBody: (maxBytes) => readRequestBody({ body }, maxBytes),
    });
    const result = await handleWaitlist(req, deps);
    expect(result.status).toBe(413);
    expect(result.body).toEqual({ ok: false, error: "too_large" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns a retryable 429 instead of false success or a generic database error at capacity", async () => {
    const { deps } = setup({ response: () => json({ code: "PT429", message: "rate_limited" }, 429) });
    const result = await handleWaitlist(request(good), deps);
    expect(result).toEqual({
      status: 429,
      headers: { "Retry-After": "60" },
      body: { ok: false, error: "rate_limited" },
    });
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
    const leaky = `{"message":"duplicate key","details":"Key (email_normalized)=(${NORMALIZED}) already exists, key ${ENV.SUPABASE_KEY}"}`;
    const cases = [
      setup({ response: () => new Response(leaky, { status: 500 }) }),
      setup({
        response: () => {
          throw new Error(`connect failed for ${NORMALIZED} with ${ENV.SUPABASE_KEY}`);
        },
      }),
      setup({ env: {} }),
      setup(),
      setup({ response: () => json([{ email: NORMALIZED, key: ENV.SUPABASE_KEY }]) }),
    ];
    for (const { deps, log } of cases) {
      const res = await handleWaitlist(request({ ...good, ref: REF }), deps);
      const outputs = [JSON.stringify(res), ...log.mock.calls.map((args) => args.join(" "))];
      for (const out of outputs) {
        expect(out.toLowerCase()).not.toContain(NORMALIZED);
        expect(out).not.toContain(ENV.SUPABASE_KEY);
      }
    }
    // The failure cases did log something, so the check above was not vacuous.
    expect(cases[0].log).toHaveBeenCalled();
    expect(cases[1].log).toHaveBeenCalled();
    expect(cases[4].log).toHaveBeenCalled();
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
    expect(JSON.parse(fetch.mock.calls[0][1].body).p_source).toBeNull();
  });
});

function statusRequest(code, overrides = {}) {
  return { method: "GET", origin: null, host: HOST, code, readBody: async () => "", ...overrides };
}

describe("waitlist status lookup", () => {
  it("returns position, referrals and total for a known code", async () => {
    const { fetch, deps } = setup({ response: () => json([{ position: 3, referrals: 2, total: 42 }]) });
    const res = await handleWaitlist(statusRequest(CODE), deps);
    expect(res).toEqual({ status: 200, headers: {}, body: { ok: true, position: 3, referrals: 2, total: 42 } });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://fake-project.supabase.test/rest/v1/rpc/waitlist_status");
    expect(init.method).toBe("POST");
    expect(init.headers.apikey).toBe(ENV.SUPABASE_KEY);
    expect(JSON.parse(init.body)).toEqual({ p_code: CODE, p_client: null });
  });

  it("works without an Origin header, because browsers omit it on same origin GET", async () => {
    const { deps } = setup({ response: () => json([{ position: 1, referrals: 0, total: 1 }]) });
    const res = await handleWaitlist(statusRequest(CODE, { origin: undefined }), deps);
    expect(res.status).toBe(200);
  });

  it("returns 404 not_found for an unknown code", async () => {
    const { deps } = setup({ response: () => json([]) });
    const res = await handleWaitlist(statusRequest(CODE), deps);
    expect(res).toEqual({ status: 404, headers: {}, body: { ok: false, error: "not_found" } });
  });

  it("returns 400 for a badly shaped code without calling Supabase", async () => {
    for (const code of [null, "", "short", "ABC123XYZ0", "abc123xyz01", "abc123xyz%", "abc123xyz0 "]) {
      const { fetch, deps } = setup();
      const res = await handleWaitlist(statusRequest(code), deps);
      expect(res).toEqual({ status: 400, headers: {}, body: { ok: false, error: "invalid_code" } });
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("returns not_configured when the settings are missing", async () => {
    const { fetch, deps } = setup({ env: {} });
    const res = await handleWaitlist(statusRequest(CODE), deps);
    expect(res).toEqual({ status: 503, headers: {}, body: { ok: false, error: "not_configured" } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns 502 upstream when Supabase fails or answers oddly, and logs no key", async () => {
    const responses = [
      () => new Response(`{"message":"${ENV.SUPABASE_KEY}"}`, { status: 500 }),
      () => json([{ position: 1 }]),
      () => {
        throw new Error(`down ${ENV.SUPABASE_KEY}`);
      },
    ];
    for (const response of responses) {
      const { deps, log } = setup({ response });
      const res = await handleWaitlist(statusRequest(CODE), deps);
      expect(res).toEqual({ status: 502, headers: {}, body: { ok: false, error: "upstream" } });
      expect(log).toHaveBeenCalled();
      for (const args of log.mock.calls) expect(args.join(" ")).not.toContain(ENV.SUPABASE_KEY);
    }
  });

  it("maps a database rate limit on the lookup to the same retryable 429", async () => {
    const { deps } = setup({ response: () => json({ code: "PT429", message: "rate_limited" }, 429) });
    const res = await handleWaitlist(statusRequest(CODE, { ip: IP }), deps);
    expect(res).toEqual({ status: 429, headers: { "Retry-After": "60" }, body: { ok: false, error: "rate_limited" } });
  });
});

describe("per-client code", () => {
  it("is stable for one IP, differs per IP and per key, and is 22 base64url characters", () => {
    const a = clientId(IP, ENV.SUPABASE_KEY);
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(clientId(IP, ENV.SUPABASE_KEY)).toBe(a);
    expect(clientId(OTHER_IP, ENV.SUPABASE_KEY)).not.toBe(a);
    expect(clientId("2001:db8::1", ENV.SUPABASE_KEY)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(clientId(IP, "another-fake-key")).not.toBe(a);
  });

  it("is null when there is no IP", () => {
    for (const ip of [null, undefined, ""]) expect(clientId(ip, ENV.SUPABASE_KEY)).toBeNull();
  });

  it("takes the first x-forwarded-for entry, then x-real-ip, else null", () => {
    expect(clientIp(` ${IP} , 10.0.0.1`, OTHER_IP)).toBe(IP);
    expect(clientIp(IP, null)).toBe(IP);
    expect(clientIp(null, ` ${OTHER_IP} `)).toBe(OTHER_IP);
    expect(clientIp(" , 10.0.0.1", OTHER_IP)).toBe(OTHER_IP);
    expect(clientIp("", "")).toBeNull();
    expect(clientIp(null, null)).toBeNull();
  });

  it("never forwards the visitor's IP to the database", async () => {
    const fetch = vi.fn(async () => joined());
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("SUPABASE_URL", ENV.SUPABASE_URL);
    vi.stubEnv("SUPABASE_KEY", ENV.SUPABASE_KEY);
    try {
      const res = await POST(new Request(`https://${HOST}/api/waitlist`, {
        method: "POST",
        headers: { host: HOST, origin: `https://${HOST}`, "x-forwarded-for": `${IP}, 10.0.0.1`, "content-type": "application/json" },
        body: JSON.stringify(good),
      }));
      expect(res.status).toBe(200);
      const [url, init] = fetch.mock.calls[0];
      expect(`${url} ${init.body} ${JSON.stringify(init.headers)}`).not.toContain(IP);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

});
