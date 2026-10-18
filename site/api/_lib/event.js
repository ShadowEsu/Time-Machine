// Funnel event handler core. Pure: no Vercel, no globals. Fetch, env and log are injected.
// Stores only the event type, the page path, a via-referral flag, and the time (set by Postgres).
// No IP, no user agent, no cookies, no email, no referral code.
import { isAllowedOrigin, isConfigured, readJsonObject, reply, supabaseHeaders, supabaseOrigin } from "./waitlist.js";

export const MAX_EVENT_BYTES = 1024;
const UPSTREAM_TIMEOUT_MS = 3000;
const TYPES = new Set(["visit", "share", "copy"]);
// A plain site path: no query, no fragment, no @, at most 200 characters. So no code or email can ride along.
const PATH_RE = /^\/[A-Za-z0-9._~\/-]{0,199}$/;

/**
 * @param {{ method: string, origin?: string|null, host?: string|null,
 *           contentLength?: string|null, readBody: () => Promise<string> }} req
 * @param {{ env: Record<string, string|undefined>, fetch: typeof fetch,
 *           log?: (message: string) => void }} deps
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: object|null }>}
 */
export async function handleEvent(req, deps) {
  const log = deps.log ?? (() => {});

  if (req.method !== "POST") {
    return reply(405, { ok: false, error: "method_not_allowed" }, { Allow: "POST" });
  }
  if (!isAllowedOrigin(req.origin, req.host)) {
    return reply(403, { ok: false, error: "forbidden_origin" });
  }

  const { data, fail } = await readJsonObject(req, MAX_EVENT_BYTES);
  if (fail) return fail;
  if (!TYPES.has(data.type) || typeof data.path !== "string" || !PATH_RE.test(data.path)) {
    return reply(400, { ok: false, error: "bad_request" });
  }
  if (data.via !== undefined && data.via !== "ref") return reply(400, { ok: false, error: "bad_request" });

  if (!isConfigured(deps.env)) return reply(503, { ok: false, error: "not_configured" });

  let res;
  try {
    res = await deps.fetch(`${supabaseOrigin(deps.env)}/rest/v1/funnel_events`, {
      method: "POST",
      headers: { ...supabaseHeaders(deps.env), Prefer: "return=minimal" },
      body: JSON.stringify({ type: data.type, path: data.path, via_ref: data.via === "ref" }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    log(`event: upstream request failed (${err && err.name ? err.name : "Error"})`);
    return reply(502, { ok: false, error: "upstream" });
  }
  if (!res.ok) {
    log(`event: upstream returned status ${res.status}`);
    return reply(502, { ok: false, error: "upstream" });
  }
  return reply(204, null);
}
