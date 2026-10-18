import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { handleWaitlist } from "./waitlist.js";
import { handleConfirm, handleUnsubscribe } from "./opt-in.js";

const ENV = { SUPABASE_URL: "https://project.example.test", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key", RESEND_API_KEY: "synthetic-email-key" };
const EMAIL = "synthetic@example.test";
const CODE = "abc123xyz0";
const TOKEN = "A".repeat(43);
const hash = (token) => createHash("sha256").update(token).digest("hex");
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
const signup = () => ({ method: "POST", origin: "https://site.example.test", host: "site.example.test", readBody: async () => JSON.stringify({ email: EMAIL, consent: true }) });
function setup(rows = [], env = ENV, mail = () => json({ id: "synthetic" })) {
  const fetch = vi.fn(async (url) => url === "https://api.resend.com/emails" ? mail()
    : url.endsWith("/waitlist_confirm_complete") ? json([{ completed: true }]) : json(rows));
  const log = vi.fn();
  return { fetch, log, deps: { env, fetch, log } };
}

describe("double opt-in signup emails", () => {
  it("requires Resend before writing anything", async () => {
    const { fetch, deps } = setup([], { ...ENV, RESEND_API_KEY: "" });
    expect((await handleWaitlist(signup(), deps)).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("stores only SHA256 hashes of separate 32-byte base64url tokens and sends the links", async () => {
    const { fetch, deps } = setup([{ send_confirmation: true }]);
    expect((await handleWaitlist(signup(), deps)).body).toEqual({ ok: true, pending: true });
    const row = JSON.parse(fetch.mock.calls[0][1].body);
    const [url, init] = fetch.mock.calls[1];
    const email = JSON.parse(init.body);
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe(`Bearer ${ENV.RESEND_API_KEY}`);
    expect(email.from).toBe("Time Machine <timemachine@unvibe.site>");
    expect(email.subject).toBe("Confirm your place on the Time Machine waitlist");
    const confirm = new URL(email.text.match(/https:\/\/\S+\/api\/confirm\?token=\S+/)[0]);
    const unsub = email.headers["List-Unsubscribe"].slice(1, -1);
    const confirmToken = confirm.searchParams.get("token");
    const unsubToken = new URL(unsub).searchParams.get("token");
    expect(confirmToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(confirmToken, "base64url")).toHaveLength(32);
    expect(unsubToken).not.toBe(confirmToken);
    expect(row.p_confirm_hash).toBe(hash(confirmToken));
    expect(row.p_unsub_hash).toBe(hash(unsubToken));
    expect(email.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(email.text).toContain(unsub);
    expect(email.html).toContain(unsub);
    expect(email.html).not.toContain("<img");
    expect(email.text).toContain("Time Machine, built by Preston Susanto, preston@unvibe.site");
  });
  it("supports the configured sender and site URL", async () => {
    const { fetch, deps } = setup([{ send_confirmation: true }], { ...ENV, SITE_URL: "https://site.example.test/", WAITLIST_FROM: "Synthetic <tm@example.test>" });
    await handleWaitlist(signup(), deps);
    const email = JSON.parse(fetch.mock.calls[1][1].body);
    expect(email.from).toBe("Synthetic <tm@example.test>");
    expect(email.text).toContain("https://site.example.test/api/confirm?token=");
  });
  it("returns upstream failure when Resend fails, never logging body, address or keys", async () => {
    for (const mail of [() => json({ message: `${EMAIL} ${ENV.RESEND_API_KEY}` }, 429), () => { throw new Error(`${EMAIL} ${ENV.RESEND_API_KEY}`); }]) {
      const { deps, log } = setup([{ send_confirmation: true }], ENV, mail);
      const result = await handleWaitlist(signup(), deps);
      expect(result.status).toBe(502);
      const out = JSON.stringify([result, log.mock.calls]);
      expect(out).not.toContain(EMAIL);
      expect(out).not.toContain(ENV.RESEND_API_KEY);
      expect(log).toHaveBeenCalled();
    }
  });
});

describe("confirmation", () => {
  it("consumes the token hash, issues a new unsubscribe hash, emails real counts and redirects", async () => {
    const { fetch, deps } = setup([{ email: EMAIL, code: CODE, position: 2, total: 9 }]);
    const res = await handleConfirm({ method: "GET", token: TOKEN }, deps);
    expect(res.status).toBe(303);
    expect(res.headers.Location).toBe(`/confirmed.html?code=${CODE}`);
    expect(fetch.mock.calls[0][0]).toContain("/rpc/waitlist_confirm");
    const args = JSON.parse(fetch.mock.calls[0][1].body);
    expect(args.p_hash).toBe(hash(TOKEN));
    expect(args.p_unsub_hash).toMatch(/^[a-f0-9]{64}$/);
    const email = JSON.parse(fetch.mock.calls[1][1].body);
    expect(email.subject).toBe("You're #2 on the Time Machine waitlist");
    expect(email.text).toContain("#2 of 9");
    expect(email.text).toContain(`https://time-machine-site.vercel.app/?ref=${CODE}`);
    expect(email.text).toContain("confirmed");
    expect(email.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });
  it("redirects invalid, expired and used tokens without sending email", async () => {
    for (const token of [TOKEN, null, "short", "!".repeat(43)]) {
      const { deps, fetch } = setup([]);
      const res = await handleConfirm({ method: "GET", token }, deps);
      expect(res.headers.Location).toBe("/confirmed.html?error=invalid");
      expect(fetch).toHaveBeenCalledTimes(token === TOKEN ? 1 : 0);
    }
  });
  it("requires configuration and maps provider failures to 502 without exposing email", async () => {
    expect((await handleConfirm({ method: "GET", token: TOKEN }, setup([], {}).deps)).status).toBe(503);
    const { deps, log } = setup([{ email: EMAIL, code: CODE, position: 1, total: 1 }], ENV, () => json({ email: EMAIL }, 500));
    const res = await handleConfirm({ method: "GET", token: TOKEN }, deps);
    expect(res.status).toBe(502);
    expect(JSON.stringify([res, log.mock.calls])).not.toContain(EMAIL);
  });
  it("retains confirmation after provider failure and retries an identical idempotent welcome", async () => {
    let accepted = false;
    let completed = false;
    const calls = [];
    const deps = {
      env: ENV, log: vi.fn(),
      fetch: vi.fn(async (url, init) => {
        if (url === "https://api.resend.com/emails") {
          calls.push(init);
          return json({}, accepted ? 200 : 503);
        }
        if (url.endsWith("/waitlist_confirm_complete")) {
          completed = true;
          return json([{ completed: true }]);
        }
        return json(completed ? [] : [{ email: EMAIL, code: CODE, position: 2, total: 9 }]);
      }),
    };
    expect((await handleConfirm({ method: "GET", token: TOKEN }, deps)).status).toBe(502);
    expect(completed).toBe(false);
    accepted = true;
    expect((await handleConfirm({ method: "GET", token: TOKEN }, deps)).status).toBe(303);
    expect(completed).toBe(true);
    expect(calls[0].body).toBe(calls[1].body);
    expect(calls[0].headers["Idempotency-Key"]).toBe(`welcome/${hash(TOKEN)}`);
    expect(calls[1].headers["Idempotency-Key"]).toBe(calls[0].headers["Idempotency-Key"]);
    expect((await handleConfirm({ method: "GET", token: TOKEN }, deps)).headers.Location).toBe("/confirmed.html?error=invalid");
    expect(calls).toHaveLength(2);
  });
  it("rejects unsupported methods", async () => {
    expect((await handleConfirm({ method: "POST", token: TOKEN }, setup().deps)).status).toBe(405);
  });
});

describe("unsubscribe", () => {
  it("GET displays one POST button without calling the store", async () => {
    const { fetch, deps } = setup();
    const res = await handleUnsubscribe({ method: "GET", token: TOKEN }, deps);
    expect(res.status).toBe(200);
    expect(res.body).toContain('method="post"');
    expect(res.body).toContain("Unsubscribe");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("POST accepts RFC8058 without Origin and stores the hash only", async () => {
    const { fetch, deps } = setup([{ unsubscribed: true }]);
    const res = await handleUnsubscribe({ method: "POST", token: TOKEN, readBody: async () => "List-Unsubscribe=One-Click" }, deps);
    expect(res.status).toBe(200);
    expect(res.body).toBe("You are unsubscribed");
    expect(fetch.mock.calls[0][0]).toContain("/rpc/waitlist_unsubscribe");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ p_hash: hash(TOKEN) });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("invalid tokens cannot change state and unconfigured POST returns 503", async () => {
    const { fetch, deps } = setup();
    expect((await handleUnsubscribe({ method: "POST", token: "<script>" }, deps)).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect((await handleUnsubscribe({ method: "POST", token: TOKEN }, setup([], {}).deps)).status).toBe(503);
  });
  it("does not claim success for an unknown token or failed upstream", async () => {
    expect((await handleUnsubscribe({ method: "POST", token: TOKEN }, setup([]).deps)).status).toBe(400);
    const { deps } = setup();
    deps.fetch = vi.fn(async () => json({}, 500));
    expect((await handleUnsubscribe({ method: "POST", token: TOKEN }, deps)).status).toBe(502);
    expect((await handleUnsubscribe({ method: "DELETE", token: TOKEN }, deps)).status).toBe(405);
  });
});
