// Sign-in from the app to the Time Machine site, to list the license keys bought with an email.
// It calls only three site endpoints: /api/health, /api/auth and /api/account. Every answer is checked
// with Zod. The sign-in token lives in this object's memory only: never on disk, never in a log, an
// error or a result. Quitting the app signs out.
import * as tm from "@timetm/core";
import { z } from "zod";
import type { AccountLicenses, SiteStatus } from "../shared/api.js";
import { SITE_HOST } from "../shared/links.js";

export const DEFAULT_SITE = `https://${SITE_HOST}`;
const TIMEOUT_MS = 10_000;
const LOCAL_HOSTS: Readonly<Record<string, true>> = { localhost: true, "127.0.0.1": true, "[::1]": true };

export interface AccountFetchInit {
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
  redirect: "error";
}
export interface AccountFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type AccountFetch = (url: string, init: AccountFetchInit) => Promise<AccountFetchResponse>;

export interface AccountIo {
  /** The site origin, read when a call is made. */
  site: () => string;
  fetch: AccountFetch;
  now?: () => number;
  timeoutMs?: number;
}

/** TM_SITE_ORIGIN, or the Time Machine site. Only https, or http on this computer for a local site. */
export function siteFromEnv(env: Record<string, string | undefined>): string {
  const raw = env.TM_SITE_ORIGIN;
  if (!raw) return DEFAULT_SITE;
  let url: URL | null = null;
  try {
    url = new URL(raw);
  } catch {
    url = null;
  }
  if (url && (url.protocol === "https:" || (url.protocol === "http:" && Object.hasOwn(LOCAL_HOSTS, url.hostname)))) return url.origin;
  throw new tm.TmError("usage", "TM_SITE_ORIGIN must be an https address, or http on localhost.");
}

const Health = z.object({ checkout: z.boolean(), auth: z.boolean() });
const Sent = z.object({ ok: z.literal(true) });
// The same token shape the site's /api/account accepts.
const Verified = z.object({ ok: z.literal(true), token: z.string().regex(/^[A-Za-z0-9._-]{20,4000}$/), expiresIn: z.number().int().positive() });
const Listed = z.object({
  ok: z.literal(true),
  email: z.string().min(3).max(254),
  licenses: z
    .array(z.object({ key: z.string().max(4000).regex(/^TM1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/), id: z.string().min(1).max(100), issued: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .max(1000),
});
const Problem = z.object({ error: z.string().max(100) });

const NOT_OPEN = "Sign-in is not open yet.";
const BAD_CODE = "That code didn't match.";
const TOO_MANY = "Too many tries, wait a minute.";
const NO_CHECKOUT = "Buying is not open yet, so there are no keys to list.";
const TROUBLE = "The Time Machine site had a problem. Try again in a minute.";
const MALFORMED = "The Time Machine site sent an answer the app did not expect.";

/** A short plain sentence for a site error. The site's own text is never shown. */
function sentence(status: number, error: string | null): string {
  if (status === 429) return TOO_MANY;
  if (status === 503 && error === "auth_closed") return NOT_OPEN;
  if (status === 503 && error === "checkout_closed") return NO_CHECKOUT;
  if (status === 401 && error === "bad_code") return BAD_CODE;
  return TROUBLE;
}

class SiteError extends tm.TmError {
  constructor(readonly status: number, error: string | null) {
    super("usage", sentence(status, error));
  }
}

/** The app's sign-in to the site. One per app run, so the token goes when the app quits. */
export class Account {
  #token: { value: string; expires: number } | null = null;

  private readonly now: () => number;

  constructor(private readonly io: AccountIo) {
    this.now = io.now ?? Date.now;
  }

  private async request<T>(method: "GET" | "POST", path: "/api/health" | "/api/auth" | "/api/account", schema: z.ZodType<T>, opts: { body?: unknown; token?: string } = {}): Promise<T> {
    const site = this.io.site();
    const headers: Record<string, string> = { accept: "application/json" };
    // The site's /api/auth takes calls from its own origin only, as its sign-in page sends them.
    if (opts.body !== undefined) Object.assign(headers, { "content-type": "application/json", origin: site });
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    let res: AccountFetchResponse;
    try {
      res = await this.io.fetch(`${site}${path}`, {
        method,
        headers,
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        signal: AbortSignal.timeout(this.io.timeoutMs ?? TIMEOUT_MS),
        redirect: "error",
      });
    } catch (e) {
      // The underlying error is dropped on purpose: its text is not ours to show.
      if (e instanceof Error && e.name === "TimeoutError") throw new tm.TmError("internal", "The Time Machine site did not answer in time. Try again.");
      throw new tm.TmError("internal", "Could not reach the Time Machine site. Check the internet connection and try again.");
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      const problem = Problem.safeParse(body);
      throw new SiteError(res.status, problem.success ? problem.data.error : null);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new tm.TmError("internal", MALFORMED);
    return parsed.data;
  }

  /** What the site has open right now. */
  async siteStatus(): Promise<SiteStatus> {
    const h = await this.request("GET", "/api/health", Health);
    return { checkout: h.checkout, auth: h.auth };
  }

  /** Asks the site to email a six digit code. */
  async signIn(email: string): Promise<{ ok: true }> {
    await this.request("POST", "/api/auth", Sent, { body: { action: "send", email } });
    return { ok: true };
  }

  /** Trades the code for a sign-in token, kept in memory only. */
  async verifyCode(email: string, code: string): Promise<{ ok: true }> {
    const v = await this.request("POST", "/api/auth", Verified, { body: { action: "verify", email, code } });
    this.#token = { value: v.token, expires: this.now() + v.expiresIn * 1000 };
    return { ok: true };
  }

  /** Forgets the token. The site keeps no session to end, so nothing is sent. */
  signOut(): { ok: true } {
    this.#token = null;
    return { ok: true };
  }

  /** The keys bought with the signed-in email, or null when signed out or the sign-in ended. */
  async accountLicenses(): Promise<AccountLicenses | null> {
    const token = this.#token;
    if (!token || this.now() >= token.expires) {
      this.#token = null;
      return null;
    }
    try {
      const r = await this.request("GET", "/api/account", Listed, { token: token.value });
      return { email: r.email, licenses: r.licenses.map((l) => ({ key: l.key, id: l.id, issued: l.issued })) };
    } catch (e) {
      if (e instanceof SiteError && e.status === 401) {
        this.#token = null;
        return null;
      }
      throw e;
    }
  }
}
