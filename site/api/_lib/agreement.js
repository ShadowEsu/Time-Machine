// The Terms a person agrees to and Privacy Policy they have read before sign-in and checkout.
// A page version names that page's "Last updated" date, with a letter suffix when its words change twice on one day.
// BOX_VERSION names the box wording. Every box sends all three versions, so an older page or app is refused and says why.
import { reply } from "./waitlist.js";

export const TERMS_VERSION = "terms-2026-10-22";
export const PRIVACY_VERSION = "privacy-2026-10-28b";
export const BOX_VERSION = "agree-box-2026-10-29";

/**
 * A 400 reply when the body did not tick the current agreement box, or null when it did.
 * agreement_required: the box was not ticked. agreement_outdated: the box or page versions differ.
 * @param {Record<string, unknown>} data
 */
export function agreementRefusal(data) {
  if (data.agreed !== true) return reply(400, { ok: false, error: "agreement_required" });
  if (data.termsVersion !== TERMS_VERSION || data.privacyVersion !== PRIVACY_VERSION || data.boxVersion !== BOX_VERSION) return reply(400, { ok: false, error: "agreement_outdated" });
  return null;
}

/**
 * What is recorded for an agreement: when, and which versions.
 * @param {number} now milliseconds since the epoch
 */
export function agreementRecord(now) {
  return { agreed_at: new Date(now).toISOString(), terms_version: TERMS_VERSION, privacy_version: PRIVACY_VERSION, box_version: BOX_VERSION };
}
