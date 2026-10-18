import { describe, expect, it, vi } from "vitest";
import { handleEvent, MAX_EVENT_BYTES } from "./event.js";

// Synthetic data only.
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

const visit = { type: "visit", path: "/blog/first-post" };

describe("event handler", () => {
  it("stores a visit and answers 204 with no body", async () => {
    const { fetch, deps } = setup();
    const res = await handleEvent(request(visit), deps);
    expect(res).toEqual({ status: 204, headers: {}, body: null });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://fake-project.supabase.test/rest/v1/funnel_events");
    expect(init.method).toBe("POST");
    expect(init.headers.apikey).toBe(ENV.SUPABASE_SERVICE_ROLE_KEY);
    expect(init.headers.Authorization).toBe(`Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`);
    expect(init.headers.Prefer).toBe("return=minimal");
    expect(JSON.parse(init.body)).toEqual({ type: "visit", path: "/blog/first-post", via_ref: false });
  });

  it("stores share and copy events, and the via ref flag", async () => {
    for (const type of ["share", "copy"]) {
      const { fetch, deps } = setup();
      const res = await handleEvent(request({ type, path: "/", via: "ref" }), deps);
      expect(res.status).toBe(204);
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ type, path: "/", via_ref: true });
    }
  });

  it("stores only type, path and the via flag, dropping anything else sent", async () => {
    const { fetch, deps } = setup();
    await handleEvent(request({ ...visit, email: "someone@example.test", code: "abc123xyz0", ua: "Bot" }), deps);
    expect(Object.keys(JSON.parse(fetch.mock.calls[0][1].body)).sort()).toEqual(["path", "type", "via_ref"]);
  });

  it("rejects unknown types without calling Supabase", async () => {
    for (const type of ["signup", "VISIT", "", null, 1, undefined]) {
      const { fetch, deps } = setup();
      const res = await handleEvent(request({ ...visit, type }), deps);
      expect(res).toEqual({ status: 400, headers: {}, body: { ok: false, error: "bad_request" } });
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("rejects paths that are not plain site paths", async () => {
    const bad = ["", "blog", "https://elsewhere.test/", "/?ref=abc123xyz0", "/#x", "/a@b.test", "/" + "x".repeat(200), null, 5];
    for (const path of bad) {
      const { fetch, deps } = setup();
      const res = await handleEvent(request({ ...visit, path }), deps);
      expect(res.status).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("rejects a via value other than ref", async () => {
    for (const via of ["share", true, "", null]) {
      const { fetch, deps } = setup();
      const res = await handleEvent(request({ ...visit, via }), deps);
      expect(res.status).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("rejects malformed JSON and non-object bodies", async () => {
    for (const body of ["{not json", "[]", "null", '"visit"']) {
      const { deps } = setup();
      const res = await handleEvent(request(body), deps);
      expect(res.status).toBe(400);
    }
  });

  it("refuses bodies over 1 KB by header and by actual size", async () => {
    const big = { ...visit, pad: "x".repeat(MAX_EVENT_BYTES) };
    expect(MAX_EVENT_BYTES).toBe(1024);
    const byHeader = setup();
    const r1 = await handleEvent(request(big), byHeader.deps);
    expect(r1).toEqual({ status: 413, headers: {}, body: { ok: false, error: "too_large" } });
    const byBytes = setup();
    const r2 = await handleEvent(request(big, { contentLength: null }), byBytes.deps);
    expect(r2.status).toBe(413);
    expect(byHeader.fetch).not.toHaveBeenCalled();
    expect(byBytes.fetch).not.toHaveBeenCalled();
  });

  it("allows only POST", async () => {
    for (const method of ["GET", "HEAD", "PUT", "OPTIONS"]) {
      const { fetch, deps } = setup();
      const res = await handleEvent(request(visit, { method }), deps);
      expect(res).toEqual({ status: 405, headers: { Allow: "POST" }, body: { ok: false, error: "method_not_allowed" } });
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("refuses other origins and a missing origin", async () => {
    for (const origin of ["https://evil.example.test", null, "null"]) {
      const { fetch, deps } = setup();
      const res = await handleEvent(request(visit, { origin }), deps);
      expect(res).toEqual({ status: 403, headers: {}, body: { ok: false, error: "forbidden_origin" } });
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("returns not_configured when either variable is missing", async () => {
    for (const env of [{}, { SUPABASE_URL: ENV.SUPABASE_URL }, { SUPABASE_SERVICE_ROLE_KEY: "k" }]) {
      const { fetch, deps } = setup({ env });
      const res = await handleEvent(request(visit), deps);
      expect(res).toEqual({ status: 503, headers: {}, body: { ok: false, error: "not_configured" } });
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("returns 502 upstream on failure and never logs the key", async () => {
    const responses = [
      () => new Response(`{"message":"${ENV.SUPABASE_SERVICE_ROLE_KEY}"}`, { status: 500 }),
      () => {
        throw new Error(`down ${ENV.SUPABASE_SERVICE_ROLE_KEY}`);
      },
    ];
    for (const response of responses) {
      const { deps, log } = setup({ response });
      const res = await handleEvent(request(visit), deps);
      expect(res).toEqual({ status: 502, headers: {}, body: { ok: false, error: "upstream" } });
      expect(log).toHaveBeenCalled();
      for (const args of log.mock.calls) expect(args.join(" ")).not.toContain(ENV.SUPABASE_SERVICE_ROLE_KEY);
    }
  });

  it("never throws, even when the body cannot be read", async () => {
    const { deps } = setup();
    const res = await handleEvent(request(visit, { readBody: async () => Promise.reject(new Error("broke")) }), deps);
    expect(res.status).toBe(400);
  });
});
