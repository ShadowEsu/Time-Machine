// The Terms and Privacy Policy a person agrees to before sign-in (/api/auth) and before checkout (/api/checkout).
// Each version names the text of one page by its "Last updated" date. Change it whenever that page's words change;
// every box sends the versions it showed, so a page or app from before the change is refused and says why.
import { reply } from "./waitlist.js";

export const TERMS_VERSION = "terms-2026-10-22";
export const PRIVACY_VERSION = "privacy-2026-10-22";

/**
 * A 400 reply when the body did not agree to the current Terms and Privacy Policy, or null when it did.
 * agreement_required: the box was not ticked. agreement_outdated: it was ticked next to other versions.
 * @param {Record<string, unknown>} data
 */
export function agreementRefusal(data) {
  if (data.agreed !== true) return reply(400, { ok: false, error: "agreement_required" });
  if (data.termsVersion !== TERMS_VERSION || data.privacyVersion !== PRIVACY_VERSION) return reply(400, { ok: false, error: "agreement_outdated" });
  return null;
}

/**
 * What is recorded for an agreement: when, and which versions.
 * @param {number} now milliseconds since the epoch
 */
export function agreementRecord(now) {
  return { agreed_at: new Date(now).toISOString(), terms_version: TERMS_VERSION, privacy_version: PRIVACY_VERSION };
}
