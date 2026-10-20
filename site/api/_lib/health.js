// Health check core. Pure: no Vercel, no globals. Fetch and env are injected.
// `waitlist` says the two Supabase settings are present. `database` says whether a real, read-only
// call to the waitlist database just worked, so "configured" is never reported as "working".
import { isConfigured, supabaseHeaders, supabaseOrigin } from "./waitlist.js";

const UPSTREAM_TIMEOUT_MS = 3000;
// The table only permits 10-character codes, so this cannot match a person.
// waitlist_status accepts text and is read-only.
const PROBE_CODE = "";

/**
 * @param {{ env: Record<string, string|undefined>, fetch: typeof fetch,
 *           log?: (message: string) => void }} deps
 * @returns {Promise<{ ok: true, waitlist: boolean, database: "reachable"|"unreachable"|"not_configured", email: false }>}
 */
export async function checkHealth(deps) {
  const log = deps.log ?? (() => {});
  const waitlist = isConfigured(deps.env);
  if (!waitlist) return { ok: true, waitlist, database: "not_configured", email: false };

  let database = "unreachable";
  try {
    const res = await deps.fetch(`${supabaseOrigin(deps.env)}/rest/v1/rpc/waitlist_status`, {
      method: "POST",
      headers: supabaseHeaders(deps.env),
      body: JSON.stringify({ p_code: PROBE_CODE }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const rows = res.ok ? await res.json().catch(() => null) : null;
    if (Array.isArray(rows)) database = "reachable";
    else log(res.ok ? "health: upstream returned an unexpected shape" : `health: upstream returned status ${res.status}`);
  } catch (err) {
    log(`health: upstream request failed (${err && err.name ? err.name : "Error"})`);
  }
  return { ok: true, waitlist, database, email: false };
}
