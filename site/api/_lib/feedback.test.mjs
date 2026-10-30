import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../feedback.js";
import { handleFeedback, MAX_FEEDBACK_BYTES } from "./feedback.js";
import { LIMITS, resetRateLimits } from "./ratelimit.js";

// Synthetic data only.
const ENV = { SUPABASE_URL: "https://fake-project.supabase.test/", SUPABASE_KEY: "fake-anon-key-123" };
const HOST = "timemachine.example.test";
// Documentation address only (RFC 5737).
const IP = "203.0.113.9";
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ANSWERS = { q1: "very", q2: "People who ship with Claude Code", q3: "I get my working version back", q4: "", installId: ID, appVersion: "0.1.0" };

beforeEach(() => resetRateLimits());

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

function setup({ env = ENV, response = () => new Response(JSON.stringify([{ saved: true }]), { status: 200 }) } = {}) {
  const fetch = vi.fn(async () => response());
  const log = vi.fn();
  return { fetch, log, deps: { env, fetch, log } };
}

describe("feedback handler", () => {
  it("saves the answers through feedback_add in tm_waitlist and answers only ok", async () => {
    const { fetch, deps } = setup();
    const res = await handleFeedback(request(ANSWERS), deps);
    expect(res).toEqual({ status: 200, headers: {}, body: { ok: true } });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://fake-project.supabase.test/rest/v1/rpc/feedback_add");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Profile"]).toBe("tm_waitlist");
    expect(JSON.parse(init.body)).toEqual({
      p_install_id: ID, p_q1: "very", p_q2: "People who ship with Claude Code", p_q3: "I get my working version back", p_q4: "",
      p_app_version: "0.1.0", p_client: null,
    });
  });

  it("trims answers, and never echoes or logs what was sent", async () => {
    const { fetch, log, deps } = setup({ response: () => new Response("upstream says People who ship", { status: 500 }) });
    const res = await handleFeedback(request({ ...ANSWERS, q2: "  spaced  " }), deps);
    expect(JSON.parse(fetch.mock.calls[0][1].body).p_q2).toBe("spaced");
    expect(res).toEqual({ status: 502, headers: {}, body: { ok: false, error: "upstream" } });
    expect(JSON.stringify(log.mock.calls)).not.toContain("spaced");
    expect(JSON.stringify(log.mock.calls)).not.toContain("People");
  });

  it("says already_answered when this install answered in the last 90 days", async () => {
    const { deps } = setup({ response: () => new Response(JSON.stringify([{ saved: false }]), { status: 200 }) });
    expect(await handleFeedback(request(ANSWERS), deps)).toEqual({ status: 409, headers: {}, body: { ok: false, error: "already_answered" } });
  });

  it("refuses anything but a well-formed body, before the database", async () => {
    const bad = [
      { ...ANSWERS, q1: "love" },
      { ...ANSWERS, q1: undefined },
      { ...ANSWERS, q2: "x".repeat(2001) },
      { ...ANSWERS, q3: 7 },
      { ...ANSWERS, q4: "nul\0" },
      { ...ANSWERS, installId: "0f8fad5b-d9cb-169f-a165-70867728950e" },
      { ...ANSWERS, installId: ID.toUpperCase() },
      { ...ANSWERS, askCount: 5 },
      { ...ANSWERS, projectCount: 2 },
      { ...ANSWERS, daysUsed: 8 },
      { ...ANSWERS, appVersion: "x".repeat(33) },
      { ...ANSWERS, appVersion: "<b>" },
      { ...ANSWERS, email: "someone@example.test" },
      [ANSWERS],
      "not json",
    ];
    for (const body of bad) {
      // Each case from a fresh limiter: these calls share one client (no IP), and the limit is not what is tested here.
      resetRateLimits();
      const { fetch, deps } = setup();
      const res = await handleFeedback(request(body), deps);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
    }
    const { deps } = setup();
    // The cap is 2,000 characters, and three full answers in three-byte characters still fit the body limit.
    expect((await handleFeedback(request({ ...ANSWERS, q2: "x".repeat(2000) }), deps)).status).toBe(200);
    resetRateLimits();
    expect((await handleFeedback(request({ ...ANSWERS, q2: "é".repeat(2000), q3: "日".repeat(2000), q4: "日".repeat(2000) }), deps)).status).toBe(200);
  });

  it("is POST only, from its own origin only, with a body of at most 20 KB", async () => {
    const { fetch, deps } = setup();
    expect(await handleFeedback(request(ANSWERS, { method: "GET" }), deps)).toEqual({ status: 405, headers: { Allow: "POST" }, body: { ok: false, error: "method_not_allowed" } });
    expect((await handleFeedback(request(ANSWERS, { origin: "https://evil.example.test" }), deps)).status).toBe(403);
    expect((await handleFeedback(request(ANSWERS, { origin: null }), deps)).status).toBe(403);
    const big = JSON.stringify({ ...ANSWERS, q2: "x".repeat(MAX_FEEDBACK_BYTES) });
    expect((await handleFeedback(request(big), deps)).status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("limits each client in memory, and passes the database's own 429 through", async () => {
    const { deps } = setup();
    for (let i = 0; i < LIMITS.feedback; i += 1) expect((await handleFeedback(request(ANSWERS, { ip: IP }), deps)).status).toBe(200);
    expect(await handleFeedback(request(ANSWERS, { ip: IP }), deps)).toEqual({ status: 429, headers: { "Retry-After": "60" }, body: { ok: false, error: "rate_limited" } });
    expect((await handleFeedback(request(ANSWERS, { ip: "203.0.113.10" }), deps)).status).toBe(200);
    resetRateLimits();
    const db = setup({ response: () => new Response(JSON.stringify({ code: "PT429" }), { status: 429 }) });
    expect((await handleFeedback(request(ANSWERS, { ip: IP }), db.deps)).status).toBe(429);
  });

  it("says not_configured without Supabase settings", async () => {
    const { fetch, deps } = setup({ env: {} });
    expect(await handleFeedback(request(ANSWERS), deps)).toEqual({ status: 503, headers: {}, body: { ok: false, error: "not_configured" } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends a one-way client code, never the IP", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify([{ saved: true }]), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("SUPABASE_URL", ENV.SUPABASE_URL);
    vi.stubEnv("SUPABASE_KEY", ENV.SUPABASE_KEY);
    try {
      const res = await POST(new Request(`https://${HOST}/api/feedback`, {
        method: "POST",
        headers: { host: HOST, origin: `https://${HOST}`, "x-forwarded-for": IP, "content-type": "application/json" },
        body: JSON.stringify(ANSWERS),
      }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      const [url, init] = fetch.mock.calls[0];
      expect(`${url} ${init.body} ${JSON.stringify(init.headers)}`).not.toContain(IP);
      expect(JSON.parse(init.body).p_client).toMatch(/^[A-Za-z0-9_-]{22}$/);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
