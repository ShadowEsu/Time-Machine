// Waitlist handler core. Pure: no Vercel, no globals. Fetch, env and log are injected.
// Rules: never log or echo the email, never echo secrets, never fake success.

export const MAX_BODY_BYTES = 2048;
export const MAX_EMAIL_LENGTH = 254;
const MAX_SOURCE_LENGTH = 200;
const UPSTREAM_TIMEOUT_MS = 8000;

// Deliberately simple: one @, no spaces, a dot in the domain.
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.][^\s@]*\.[^\s@]{2,}$/;
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

const reply = (status, body, headers = {}) => ({ status, headers, body });

// Both variables present and the URL parses. Used by the handler and by /api/health.
export function isConfigured(env) {
  return Boolean(env && env.SUPABASE_SERVICE_ROLE_KEY && supabaseInsertUrl(env));
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

function supabaseInsertUrl(env) {
  if (!env.SUPABASE_URL) return null;
  let base;
  try {
    base = new URL(env.SUPABASE_URL);
  } catch {
    return null;
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") return null;
  return `${base.origin}/rest/v1/waitlist?on_conflict=email_normalized`;
}

/**
 * @param {{ method: string, origin?: string|null, host?: string|null,
 *           contentLength?: string|null, readBody: () => Promise<string> }} req
 * @param {{ env: Record<string, string|undefined>, fetch: typeof fetch,
 *           log?: (message: string) => void }} deps
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: object }>}
 */
export async function handleWaitlist(req, deps) {
  const log = deps.log ?? (() => {});

  if (req.method !== "POST") {
    return reply(405, { ok: false, error: "method_not_allowed" }, { Allow: "POST" });
  }
  if (!isAllowedOrigin(req.origin, req.host)) {
    return reply(403, { ok: false, error: "forbidden_origin" });
  }

  const declared = Number(req.contentLength);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return reply(413, { ok: false, error: "too_large" });
  }
  let text;
  try {
    text = await req.readBody();
  } catch {
    return reply(400, { ok: false, error: "bad_request" });
  }
  if (typeof text !== "string") return reply(400, { ok: false, error: "bad_request" });
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return reply(413, { ok: false, error: "too_large" });
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return reply(400, { ok: false, error: "bad_request" });
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return reply(400, { ok: false, error: "bad_request" });
  }

  // Honeypot. People never see this field. Bots that fill it get a quiet ok and nothing is stored.
  if (typeof data.company === "string" ? data.company.trim() !== "" : data.company != null) {
    return reply(200, { ok: true });
  }

  if (typeof data.email !== "string") return reply(400, { ok: false, error: "invalid_email" });
  const email = normalizeEmail(data.email);
  if (!isValidEmail(email)) return reply(400, { ok: false, error: "invalid_email" });
  if (data.consent !== true) return reply(400, { ok: false, error: "consent_required" });

  if (!isConfigured(deps.env)) return reply(503, { ok: false, error: "not_configured" });
  const url = supabaseInsertUrl(deps.env);

  const key = deps.env.SUPABASE_SERVICE_ROLE_KEY;
  let res;
  try {
    res = await deps.fetch(url, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal,resolution=ignore-duplicates",
      },
      body: JSON.stringify({ email, consent: true, source: cleanSource(data.source) }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    // Only the error name. Messages from fetch can include the request URL.
    log(`waitlist: upstream request failed (${err && err.name ? err.name : "Error"})`);
    return reply(502, { ok: false, error: "upstream" });
  }

  // 409 means the address is already there, so the person is on the list.
  if (res.ok || res.status === 409) return reply(200, { ok: true });

  // Status only. The upstream body can quote the email back.
  log(`waitlist: upstream returned status ${res.status}`);
  return reply(502, { ok: false, error: "upstream" });
}
