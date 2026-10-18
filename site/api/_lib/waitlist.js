// Waitlist handler core. Pure: no Vercel, no globals. Fetch, env and log are injected.
// Rules: never log or echo the email, never echo secrets, never fake success.

export const MAX_BODY_BYTES = 2048;
export const MAX_EMAIL_LENGTH = 254;
const MAX_SOURCE_LENGTH = 200;
const UPSTREAM_TIMEOUT_MS = 8000;

// Referral codes: exactly 10 characters from a to z and 0 to 9. Made in SQL, see 0002_referrals_and_funnel.sql.
const CODE_RE = /^[a-z0-9]{10}$/;

// Deliberately simple: one @, no spaces, a dot in the domain.
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.][^\s@]*\.[^\s@]{2,}$/;
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const reply = (status, body, headers = {}) => ({ status, headers, body });

// Both variables present and the URL parses. Used by the handler and by /api/health.
export function isConfigured(env) {
  return Boolean(env && env.SUPABASE_SERVICE_ROLE_KEY && supabaseOrigin(env));
}

export function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

export function isValidEmail(value) {
  return value.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(value);
}

// Same origin only: the Origin host must equal the host the request came to,
// or be localhost for local testing. A missing Origin is refused.
export function isAllowedOrigin(origin, host) {
  if (!origin) return false;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (LOCAL_HOSTNAMES.has(url.hostname)) return true;
  return Boolean(host) && url.host.toLowerCase() === String(host).toLowerCase();
}

function cleanSource(value) {
  if (typeof value !== "string") return null;
  const s = value.trim().slice(0, MAX_SOURCE_LENGTH);
  return s.startsWith("/") ? s : null;
}

// The Supabase project origin, or null when SUPABASE_URL is missing or not an http(s) URL.
export function supabaseOrigin(env) {
  if (!env.SUPABASE_URL) return null;
  let base;
  try {
    base = new URL(env.SUPABASE_URL);
  } catch {
    return null;
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") return null;
  return base.origin;
}

export function supabaseHeaders(env) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

// Reads a JSON object body of at most maxBytes. Returns { data } or { fail } with a ready reply.
export async function readJsonObject(req, maxBytes) {
  const declared = Number(req.contentLength);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { fail: reply(413, { ok: false, error: "too_large" }) };
  }
  let text;
  try {
    text = await req.readBody();
  } catch {
    return { fail: reply(400, { ok: false, error: "bad_request" }) };
  }
  if (typeof text !== "string") return { fail: reply(400, { ok: false, error: "bad_request" }) };
  if (new TextEncoder().encode(text).length > maxBytes) {
    return { fail: reply(413, { ok: false, error: "too_large" }) };
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { fail: reply(400, { ok: false, error: "bad_request" }) };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { fail: reply(400, { ok: false, error: "bad_request" }) };
  }
  return { data };
}

const isCount = (value) => Number.isSafeInteger(value) && value >= 0;

// Calls a Postgres function through PostgREST. Returns the parsed rows array, or null after logging
// a safe line. Logs only an error name or status code: upstream messages can quote the email back.
async function callRpc(name, args, deps, log) {
  let res;
  try {
    res = await deps.fetch(`${supabaseOrigin(deps.env)}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: supabaseHeaders(deps.env),
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    log(`waitlist: upstream request failed (${err && err.name ? err.name : "Error"})`);
    return null;
  }
  if (!res.ok) {
    log(`waitlist: upstream returned status ${res.status}`);
    return null;
  }
  let rows;
  try {
    rows = await res.json();
  } catch {
    rows = null;
  }
  if (!Array.isArray(rows) || rows.length > 1) {
    log("waitlist: upstream returned an unexpected shape");
    return null;
  }
  return rows;
}

/**
 * POST joins the list. GET ?code= looks up a place in the list.
 * @param {{ method: string, origin?: string|null, host?: string|null, code?: string|null,
 *           contentLength?: string|null, readBody: () => Promise<string> }} req
 * @param {{ env: Record<string, string|undefined>, fetch: typeof fetch,
 *           log?: (message: string) => void }} deps
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: object }>}
 */
export async function handleWaitlist(req, deps) {
  const log = deps.log ?? (() => {});

  if (req.method === "GET") return handleStatus(req, deps, log);
  if (req.method !== "POST") {
    return reply(405, { ok: false, error: "method_not_allowed" }, { Allow: "GET, POST" });
  }
  if (!isAllowedOrigin(req.origin, req.host)) {
    return reply(403, { ok: false, error: "forbidden_origin" });
  }

  const { data, fail } = await readJsonObject(req, MAX_BODY_BYTES);
  if (fail) return fail;

  // Honeypot. People never see this field. Bots that fill it get a quiet ok and nothing is stored.
  if (typeof data.company === "string" ? data.company.trim() !== "" : data.company != null) {
    return reply(200, { ok: true });
  }

  if (typeof data.email !== "string") return reply(400, { ok: false, error: "invalid_email" });
  const email = normalizeEmail(data.email);
  if (!isValidEmail(email)) return reply(400, { ok: false, error: "invalid_email" });
  if (data.consent !== true) return reply(400, { ok: false, error: "consent_required" });

  if (!isConfigured(deps.env)) return reply(503, { ok: false, error: "not_configured" });

  // A badly shaped ref is dropped here. An unknown or own code is dropped in SQL. Neither blocks the signup.
  const ref = typeof data.ref === "string" && CODE_RE.test(data.ref) ? data.ref : null;
  const rows = await callRpc("waitlist_join", { p_email: email, p_source: cleanSource(data.source), p_ref: ref }, deps, log);
  if (!rows) return reply(502, { ok: false, error: "upstream" });

  // No row back means the email was already on the list. Nothing changed.
  if (rows.length === 0) return reply(200, { ok: true });
  const { code, position, total } = rows[0] ?? {};
  if (typeof code !== "string" || !CODE_RE.test(code) || !isCount(position) || !isCount(total)) {
    log("waitlist: upstream returned an unexpected shape");
    return reply(502, { ok: false, error: "upstream" });
  }
  return reply(200, { ok: true, code, position, total });
}

// GET ?code=. No Origin check: browsers do not send Origin on same origin GET requests.
// The answer holds no personal data, only counts, and no CORS header lets other sites read it.
async function handleStatus(req, deps, log) {
  const code = req.code;
  if (typeof code !== "string" || !CODE_RE.test(code)) return reply(400, { ok: false, error: "invalid_code" });
  if (!isConfigured(deps.env)) return reply(503, { ok: false, error: "not_configured" });

  const rows = await callRpc("waitlist_status", { p_code: code }, deps, log);
  if (!rows) return reply(502, { ok: false, error: "upstream" });
  if (rows.length === 0) return reply(404, { ok: false, error: "not_found" });
  const { position, referrals, total } = rows[0] ?? {};
  if (!isCount(position) || !isCount(referrals) || !isCount(total)) {
    log("waitlist: upstream returned an unexpected shape");
    return reply(502, { ok: false, error: "upstream" });
  }
  return reply(200, { ok: true, position, referrals, total });
}
