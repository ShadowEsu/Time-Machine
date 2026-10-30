// Survey answers from the app (apps/web/src/shared/pmf.ts), sent only when the person pressed Send. Pure: no Vercel, no
// globals. Fetch, env and log are injected. Stores exactly the four answers, the app version, the random survey ID and the
// time (set by Postgres), through the security definer function feedback_add (0008_feedback.sql). No IP, no user agent, no
// email. A one-way per-client code goes to the database rate limit only, never into feedback_answers. Answers are never
// logged and never echoed back.
import { instanceClient, rateLimited } from "./ratelimit.js";
import { clientId, isAllowedOrigin, isConfigured, rateLimitReply, readJsonObject, reply, supabaseHeaders, supabaseOrigin } from "./waitlist.js";

// Three answers of 2,000 UTF-16 units are at most 18,000 bytes of UTF-8; the rest of the body is under 300.
export const MAX_FEEDBACK_BYTES = 20480;
export const MAX_ANSWER_LENGTH = 2000;
const UPSTREAM_TIMEOUT_MS = 8000;
// The same four values as feedback_answers' check (0008) and the app's PMF_Q1_OPTIONS.
const FEELINGS = new Set(["very", "somewhat", "not", "na"]);
const KEYS = new Set(["q1", "q2", "q3", "q4", "installId", "appVersion"]);
// randomUUID's shape: version 4, variant 10xx, lowercase.
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VERSION_RE = /^[0-9A-Za-z.+-]{1,32}$/;

/** A trimmed answer of at most MAX_ANSWER_LENGTH characters, or null. Postgres text can't hold a NUL character. */
function answer(value) {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s.length <= MAX_ANSWER_LENGTH && !s.includes("\0") ? s : null;
}

/** The function's arguments for a well-formed body, or null. Any key the app does not send makes the body malformed. */
export function feedbackArgs(data) {
  if (Object.keys(data).some((k) => !KEYS.has(k))) return null;
  const [q2, q3, q4] = [answer(data.q2), answer(data.q3), answer(data.q4)];
  if (!FEELINGS.has(data.q1) || q2 === null || q3 === null || q4 === null) return null;
  if (typeof data.installId !== "string" || !UUID_V4_RE.test(data.installId)) return null;
  if (typeof data.appVersion !== "string" || !VERSION_RE.test(data.appVersion)) return null;
  return { p_install_id: data.installId, p_q1: data.q1, p_q2: q2, p_q3: q3, p_q4: q4, p_app_version: data.appVersion };
}

/**
 * POST only. 200 {ok:true} once saved; 409 already_answered when this install sent answers in the last 90 days.
 * @param {{ method: string, origin?: string|null, host?: string|null, ip?: string|null,
 *           contentLength?: string|null, readBody: (maxBytes: number) => Promise<string> }} req
 * @param {{ env: Record<string, string|undefined>, fetch: typeof fetch,
 *           log?: (message: string) => void }} deps
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: object }>}
 */
export async function handleFeedback(req, deps) {
  const log = deps.log ?? (() => {});

  if (req.method !== "POST") {
    return reply(405, { ok: false, error: "method_not_allowed" }, { Allow: "POST" });
  }
  if (!isAllowedOrigin(req.origin, req.host)) {
    return reply(403, { ok: false, error: "forbidden_origin" });
  }
  if (rateLimited("feedback", instanceClient(req.ip))) return rateLimitReply();

  const { data, fail } = await readJsonObject(req, MAX_FEEDBACK_BYTES);
  if (fail) return fail;
  const args = feedbackArgs(data);
  if (!args) return reply(400, { ok: false, error: "bad_request" });

  if (!isConfigured(deps.env)) return reply(503, { ok: false, error: "not_configured" });

  let res;
  try {
    res = await deps.fetch(`${supabaseOrigin(deps.env)}/rest/v1/rpc/feedback_add`, {
      method: "POST",
      headers: supabaseHeaders(deps.env),
      body: JSON.stringify({ ...args, p_client: clientId(req.ip, deps.env.SUPABASE_KEY) }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    log(`feedback: upstream request failed (${err && err.name ? err.name : "Error"})`);
    return reply(502, { ok: false, error: "upstream" });
  }
  if (res.status === 429) return rateLimitReply();
  if (!res.ok) {
    // Upstream text can quote an answer back, so only the status is logged.
    log(`feedback: upstream returned status ${res.status}`);
    return reply(502, { ok: false, error: "upstream" });
  }
  let rows;
  try {
    rows = await res.json();
  } catch {
    rows = null;
  }
  const saved = Array.isArray(rows) && rows.length === 1 ? rows[0]?.saved : undefined;
  if (saved === false) return reply(409, { ok: false, error: "already_answered" });
  if (saved !== true) {
    log("feedback: upstream returned an unexpected shape");
    return reply(502, { ok: false, error: "upstream" });
  }
  return reply(200, { ok: true });
}
