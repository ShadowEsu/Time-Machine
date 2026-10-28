// Sign-in from the app to the Time Machine site, to list the keys bought with an email. No network:
// fetch is always a stand-in. The token stays in memory and never shows up in a result or an error.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import * as tm from "@timetm/core";
import { tempDir } from "../../../fixtures/demo/setup.ts";
import { Account, DEFAULT_SITE, siteFromEnv, type AccountFetch, type AccountFetchInit } from "../src/server/account.ts";
import { Credentials, type Cipher } from "../src/server/credentials.ts";
import { Engine } from "../src/server/engine.ts";
import { AppState } from "../src/server/state.ts";
import { AGREED, BOX_VERSION, PRIVACY_URL, PRIVACY_VERSION, TERMS_URL, TERMS_VERSION } from "../src/shared/agreement.ts";
import { CallSchema, type Call } from "../src/shared/api.ts";
import { isAllowedExternal } from "../src/shared/links.ts";
import { FakeEngine } from "../preview/fake.ts";

const SITE = "http://localhost:3000";
const EMAIL = "buyer@example.test";
const TOKEN = "synthetic.app-token.0123456789abcdef";
const KEY = "TM1.eyJ2IjoxfQ.c2lnbmF0dXJl";
const LICENSES = [{ key: KEY, id: "cs_0123456789abcdef01234567", issued: "2026-10-25" }];

const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

/** Answers like the site: health, auth send and verify (code 123456), account for TOKEN. */
function site(overrides: Partial<Record<"health" | "send" | "verify" | "account", () => Response | Promise<Response>>> = {}) {
  const fetch = vi.fn(async (url: string, init: AccountFetchInit): Promise<Response> => {
    const path = new URL(url).pathname;
    if (path === "/api/health") return (overrides.health ?? (() => json({ ok: true, waitlist: true, database: "reachable", email: false, checkout: true, auth: true })))();
    if (path === "/api/auth") {
      const body = JSON.parse(init.body ?? "{}") as { action: string; code?: string };
      if (body.action === "send") return (overrides.send ?? (() => json({ ok: true })))();
      return (overrides.verify ?? (() => (body.code === "123456" ? json({ ok: true, token: TOKEN, expiresIn: 3600 }) : json({ ok: false, error: "bad_code" }, 401))))();
    }
    if (path === "/api/account") {
      if (overrides.account) return overrides.account();
      return init.headers.authorization === `Bearer ${TOKEN}` ? json({ ok: true, email: EMAIL, licenses: LICENSES }) : json({ ok: false, error: "unauthorized" }, 401);
    }
    throw new Error(`unexpected ${url}`);
  });
  return { fetch, account: new Account({ site: () => SITE, fetch }) };
}

async function failure(p: Promise<unknown>): Promise<tm.TmError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof tm.TmError) return e;
    throw e;
  }
  throw new Error("expected a failure");
}

describe("site address", () => {
  test("defaults to the Time Machine site, and TM_SITE_ORIGIN may point at https or a local http site", () => {
    expect(DEFAULT_SITE).toBe("https://time-machine.company");
    expect(siteFromEnv({})).toBe(DEFAULT_SITE);
    expect(siteFromEnv({ TM_SITE_ORIGIN: "http://localhost:3000/" })).toBe("http://localhost:3000");
    expect(siteFromEnv({ TM_SITE_ORIGIN: "https://staging.example.test/x" })).toBe("https://staging.example.test");
    for (const bad of ["http://evil.example.test", "ftp://localhost", "not a url"]) expect(() => siteFromEnv({ TM_SITE_ORIGIN: bad })).toThrow(/TM_SITE_ORIGIN/);
  });
});

describe("account", () => {
  test("siteStatus reads /api/health and keeps only checkout and auth", async () => {
    const { fetch, account } = site();
    expect(await account.siteStatus()).toEqual({ checkout: true, auth: true });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`${SITE}/api/health`);
    expect(init.method).toBe("GET");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.redirect).toBe("error");
  });

  test("signIn asks the site to email a code, with the ticked box's agreement, as the site's own page does", async () => {
    const { fetch, account } = site();
    expect(await account.signIn(EMAIL, AGREED)).toEqual({ ok: true });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`${SITE}/api/auth`);
    expect(init.method).toBe("POST");
    expect(init.headers.origin).toBe(SITE);
    expect(init.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body ?? "")).toEqual({ action: "send", email: EMAIL, agreed: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, boxVersion: BOX_VERSION });
  });

  test("verifyCode keeps the token in memory only; accountLicenses sends it and lists the keys", async () => {
    const { fetch, account } = site();
    expect(await account.accountLicenses()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    const verified = await account.verifyCode(EMAIL, "123456", AGREED);
    expect(verified).toEqual({ ok: true });
    expect(JSON.parse(fetch.mock.calls[0]![1].body ?? "")).toEqual({ action: "verify", email: EMAIL, code: "123456", agreed: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, boxVersion: BOX_VERSION });
    const listed = await account.accountLicenses();
    expect(listed).toEqual({ email: EMAIL, licenses: LICENSES });
    const [url, init] = fetch.mock.calls[1]!;
    expect(url).toBe(`${SITE}/api/account`);
    expect(init.method).toBe("GET");
    expect(init.headers.authorization).toBe(`Bearer ${TOKEN}`);
    // The token is in no result, and not in anything the object would serialize.
    expect(JSON.stringify([verified, listed, account])).not.toContain(TOKEN);
  });

  test("signOut forgets the token without asking the site, and is fine when already signed out", async () => {
    const { fetch, account } = site();
    expect(await account.signOut()).toEqual({ ok: true });
    await account.verifyCode(EMAIL, "123456", AGREED);
    const calls = fetch.mock.calls.length;
    expect(await account.signOut()).toEqual({ ok: true });
    expect(await account.accountLicenses()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(calls);
  });

  test("a token the site no longer accepts is forgotten, so the app shows signed out", async () => {
    const { fetch, account } = site({ account: () => json({ ok: false, error: "unauthorized" }, 401) });
    await account.verifyCode(EMAIL, "123456", AGREED);
    expect(await account.accountLicenses()).toBeNull();
    const calls = fetch.mock.calls.length;
    expect(await account.accountLicenses()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(calls);
  });

  test("a token past its expiry is forgotten without asking the site", async () => {
    let now = 1_000_000;
    const { fetch } = site();
    const account = new Account({ site: () => SITE, fetch, now: () => now });
    await account.verifyCode(EMAIL, "123456", AGREED);
    now += 3601 * 1000;
    expect(await account.accountLicenses()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("errors are short plain sentences, never the site's own text", async () => {
    const closed = site({ send: () => json({ ok: false, error: "auth_closed" }, 503) });
    expect((await failure(closed.account.signIn(EMAIL, AGREED))).message).toBe("Sign-in is not open yet.");
    const { account } = site();
    expect((await failure(account.verifyCode(EMAIL, "000000", AGREED))).message).toBe("That code didn't match.");
    const busy = site({ send: () => json({ ok: false, error: "rate_limited" }, 429) });
    expect((await failure(busy.account.signIn(EMAIL, AGREED))).message).toBe("Too many tries, wait a minute.");
    const unticked = site({ send: () => json({ ok: false, error: "agreement_required" }, 400) });
    expect((await failure(unticked.account.signIn(EMAIL, AGREED))).message).toBe("Tick the box to agree to the Terms first.");
    const outdated = site({ send: () => json({ ok: false, error: "agreement_outdated" }, 400) });
    expect((await failure(outdated.account.signIn(EMAIL, AGREED))).message).toBe("The Terms or Privacy changed since this version of Time Machine. Update it, then sign in.");
    const noKeys = site({ account: () => json({ ok: false, error: "checkout_closed" }, 503) });
    await noKeys.account.verifyCode(EMAIL, "123456", AGREED);
    expect((await failure(noKeys.account.accountLicenses())).message).toBe("Buying is not open yet, so there are no keys to list.");
    const broken = site({ health: () => json({ error: { message: "secret upstream detail" } }, 500) });
    const e = await failure(broken.account.siteStatus());
    expect(e.message).toBe("The Time Machine site had a problem. Try again in a minute.");
    expect(e.message).not.toContain("secret");
  });

  test("an answer of the wrong shape is refused, on every endpoint", async () => {
    const malformed = "The Time Machine site sent an answer the app did not expect.";
    expect((await failure(site({ health: () => json({ checkout: "yes" }) }).account.siteStatus())).message).toBe(malformed);
    expect((await failure(site({ verify: () => json({ ok: true, token: "short", expiresIn: 3600 }) }).account.verifyCode(EMAIL, "123456", AGREED))).message).toBe(malformed);
    const bad = site({ account: () => json({ ok: true, email: EMAIL, licenses: [{ key: "not a key", id: "x", issued: "today" }] }) });
    await bad.account.verifyCode(EMAIL, "123456", AGREED);
    expect((await failure(bad.account.accountLicenses())).message).toBe(malformed);
    expect((await failure(site({ health: () => new Response("<html>", { status: 200 }) }).account.siteStatus())).message).toBe(malformed);
  });

  test("gives up after the timeout, and says the site could not be reached when offline", async () => {
    // Executor form: the test tsconfig targets ES2023, which has no Promise.withResolvers.
    const hang: AccountFetch = (_url, init) => new Promise<Response>((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
    const slow = new Account({ site: () => SITE, fetch: hang, timeoutMs: 20 });
    expect((await failure(slow.siteStatus())).message).toBe("The Time Machine site did not answer in time. Try again.");
    const offline = new Account({ site: () => SITE, fetch: async () => { throw new TypeError("fetch failed"); } });
    expect((await failure(offline.signIn(EMAIL, AGREED))).message).toBe("Could not reach the Time Machine site. Check the internet connection and try again.");
  });
});

describe("contract, engine and preview", () => {
  test("the calls are validated: a real looking email, a six digit code, and the ticked box", () => {
    expect(CallSchema.parse({ method: "signIn", email: " Buyer@Example.test ", ...AGREED })).toEqual({ method: "signIn", email: EMAIL, ...AGREED });
    expect(CallSchema.safeParse({ method: "signIn", email: "nope", ...AGREED }).success).toBe(false);
    expect(CallSchema.safeParse({ method: "verifyCode", email: EMAIL, code: "123456", ...AGREED }).success).toBe(true);
    for (const code of ["12345", "1234567", "abcdef", ""]) expect(CallSchema.safeParse({ method: "verifyCode", email: EMAIL, code, ...AGREED }).success).toBe(false);
    // Without the box, or with it ticked next to other versions, nothing reaches the site.
    for (const method of ["signIn", "verifyCode"]) {
      const call = { method, email: EMAIL, ...(method === "verifyCode" ? { code: "123456" } : {}) };
      for (const agreement of [{}, { ...AGREED, agreed: false }, { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, boxVersion: BOX_VERSION }, { agreed: true }]) {
        expect(CallSchema.safeParse({ ...call, ...agreement }).success).toBe(false);
      }
      for (const field of ["termsVersion", "privacyVersion", "boxVersion"]) {
        for (const value of ["outdated-version", undefined]) {
          expect(CallSchema.safeParse({ ...call, ...AGREED, [field]: value }).success).toBe(false);
        }
      }
    }
    expect(CallSchema.safeParse({ method: "siteStatus" }).success).toBe(true);
    expect(CallSchema.safeParse({ method: "accountLicenses", token: TOKEN }).success).toBe(false);
    expect(CallSchema.safeParse({ method: "signOut" }).success).toBe(true);
  });

  test("the engine routes the five calls to the site named by TM_SITE_ORIGIN", async () => {
    const dir = tempDir("account");
    const { fetch } = site();
    const noCipher: Cipher = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => "" };
    const before = process.env.TM_SITE_ORIGIN;
    process.env.TM_SITE_ORIGIN = SITE;
    try {
      // The engine hands the account the app's fetch; the stand-in reads the same fields the account sends.
      const appFetch = (async (input: string | URL | Request, init?: RequestInit) => fetch(String(input), init as AccountFetchInit)) as typeof globalThis.fetch;
      const engine = new Engine(new AppState(join(dir, "data")), { candidates: ["false"], version: "9.9.9" }, { credentials: new Credentials(join(dir, "credentials.json"), noCipher, {}), fetch: appFetch });
      expect(await engine.run({ method: "siteStatus" })).toEqual({ ok: true, data: { checkout: true, auth: true } });
      expect(await engine.run({ method: "accountLicenses" })).toEqual({ ok: true, data: null });
      expect(await engine.run({ method: "signIn", email: EMAIL, ...AGREED })).toEqual({ ok: true, data: { ok: true } });
      expect(JSON.parse(fetch.mock.calls[1]![1].body ?? "")).toEqual({ action: "send", email: EMAIL, ...AGREED });
      expect(await engine.run({ method: "verifyCode", email: EMAIL, code: "000000", ...AGREED })).toEqual({ ok: false, error: { kind: "usage", message: "That code didn't match." } });
      expect(await engine.run({ method: "verifyCode", email: EMAIL, code: "123456", ...AGREED })).toEqual({ ok: true, data: { ok: true } });
      expect(JSON.parse(fetch.mock.calls[3]![1].body ?? "")).toEqual({ action: "verify", email: EMAIL, code: "123456", ...AGREED });
      expect(await engine.run({ method: "accountLicenses" })).toEqual({ ok: true, data: { email: EMAIL, licenses: LICENSES } });
      expect(await engine.run({ method: "signOut" })).toEqual({ ok: true, data: { ok: true } });
      expect(await engine.run({ method: "accountLicenses" })).toEqual({ ok: true, data: null });
      expect(fetch.mock.calls.every(([url]) => url.startsWith(`${SITE}/api/`))).toBe(true);
    } finally {
      if (before === undefined) delete process.env.TM_SITE_ORIGIN;
      else process.env.TM_SITE_ORIGIN = before;
    }
  });

  test("the preview signs in with any email and code 123456, and lists one fake key", async () => {
    const fake = new FakeEngine();
    expect(await fake.call({ method: "siteStatus" })).toEqual({ ok: true, data: { checkout: true, auth: true } });
    expect(await fake.call({ method: "accountLicenses" })).toEqual({ ok: true, data: null });
    expect(await fake.call({ method: "signIn", email: EMAIL, ...AGREED })).toEqual({ ok: true, data: { ok: true } });
    expect(await fake.call({ method: "verifyCode", email: EMAIL, code: "000000", ...AGREED })).toMatchObject({ ok: false, error: { message: "That code didn't match." } });
    expect(await fake.call({ method: "verifyCode", email: EMAIL, code: "123456", ...AGREED })).toEqual({ ok: true, data: { ok: true } });
    const listed = await fake.call({ method: "accountLicenses" });
    expect(listed).toMatchObject({ ok: true, data: { email: EMAIL, licenses: [{ key: expect.stringMatching(/^TM1\./), issued: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }] } });
    expect(await fake.call({ method: "signOut" })).toEqual({ ok: true, data: { ok: true } });
    expect(await fake.call({ method: "accountLicenses" })).toEqual({ ok: true, data: null });
    // Like the site, the preview sends no code without the box.
    expect(await fake.call({ method: "signIn", email: EMAIL } as Call)).toMatchObject({ ok: false, error: { message: "Tick the box to agree to the Terms first." } });
    for (const method of ["signIn", "verifyCode"] as const) {
      for (const field of ["termsVersion", "privacyVersion", "boxVersion"]) {
        for (const value of ["outdated-version", undefined]) {
          const call = { method, email: EMAIL, code: "123456", ...AGREED, [field]: value } as Call;
          expect(await fake.call(call)).toMatchObject({ ok: false, error: { message: "The Terms or Privacy changed since this version of Time Machine. Update it, then sign in." } });
        }
      }
    }
  });

  test("the box names the versions the site's /api/auth checks, and its two pages open from the app", () => {
    const site = readFileSync(new URL("../../../site/api/_lib/agreement.js", import.meta.url), "utf8");
    expect(site).toContain(`export const TERMS_VERSION = "${TERMS_VERSION}";`);
    expect(site).toContain(`export const PRIVACY_VERSION = "${PRIVACY_VERSION}";`);
    expect(site).toContain(`export const BOX_VERSION = "${BOX_VERSION}";`);
    expect(TERMS_URL).toBe("https://time-machine.company/terms.html");
    expect(PRIVACY_URL).toBe("https://time-machine.company/privacy.html");
    expect(isAllowedExternal(TERMS_URL) && isAllowedExternal(PRIVACY_URL)).toBe(true);
  });
});
