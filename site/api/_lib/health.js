// Health check core. Pure: no Vercel, no globals. Fetch and env are injected.
// `waitlist` says the two Supabase settings are present. `database` says whether a real, read-only
// call to the waitlist database just worked, so "configured" is never reported as "working".
// `checkout` says the Stripe key and the license signing key are both present. No Stripe call is made.
// `releaseKey` says the configured signing key's public half is the committed release public key, as a boolean only,
// so Production can prove it signs keys every release accepts without anyone reading the key.
// `auth` says SUPABASE_URL and SUPABASE_ANON_KEY are both present, so sign-in can be offered.
import { isAuthConfigured } from "./auth.js";
import { isCheckoutConfigured, isLiveKey, signsReleaseKeys } from "./checkout.js";
import { isConfigured, supabaseHeaders, supabaseOrigin } from "./waitlist.js";

const UPSTREAM_TIMEOUT_MS = 3000;
// The table only permits 10-character codes, so this cannot match a person.
// waitlist_status accepts text and is read-only.
const PROBE_CODE = "";

/**
 * @param {{ env: Record<string, string|undefined>, fetch: typeof fetch,
 *           log?: (message: string) => void, sellerPublicKey?: string }} deps
 * @returns {Promise<{ ok: true, waitlist: boolean, database: "reachable"|"unreachable"|"not_configured", email: false, checkout: boolean, auth: boolean, releaseKey: boolean, billing: "off"|"test"|"live", webhookConfigured: false }>}
 */
export async function checkHealth(deps) {
  const log = deps.log ?? (() => {});
  const waitlist = isConfigured(deps.env);
  const checkout = isCheckoutConfigured(deps.env, deps.sellerPublicKey);
  const auth = isAuthConfigured(deps.env);
  const releaseKey = signsReleaseKeys(deps.env, deps.sellerPublicKey);
  // The mode the open gate admitted: a key the gate refuses reads "off". Values only, never a key.
  const billing = !checkout ? "off" : isLiveKey(deps.env.STRIPE_SECRET_KEY) ? "live" : "test";
  // Time Machine has no Stripe webhook by design (billing READINESS L2): keys are derived from Stripe's records on request.
  const flags = { email: false, checkout, auth, releaseKey, billing, webhookConfigured: false };
  if (!waitlist) return { ok: true, waitlist, database: "not_configured", ...flags };

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
  return { ok: true, waitlist, database, ...flags };
}
