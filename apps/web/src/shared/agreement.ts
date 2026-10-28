// The Terms someone agrees to and Privacy notice they have read by ticking the box before Send code. The site's /api/auth refuses
// a sign-in without that box, and records these versions. No Zod here, so the window bundle stays small.
import { SITE_HOST } from "./links.js";

/** Must equal TERMS_VERSION, PRIVACY_VERSION and BOX_VERSION in site/api/_lib/agreement.js (a test keeps them equal). */
export const TERMS_VERSION = "terms-2026-10-22";
export const PRIVACY_VERSION = "privacy-2026-10-28b";
export const BOX_VERSION = "agree-box-2026-10-29";

export const TERMS_URL = `https://${SITE_HOST}/terms.html`;
export const PRIVACY_URL = `https://${SITE_HOST}/privacy.html`;

/** What a ticked box sends with each sign-in call. */
export interface SignInAgreement {
  agreed: true;
  termsVersion: typeof TERMS_VERSION;
  privacyVersion: typeof PRIVACY_VERSION;
  boxVersion: typeof BOX_VERSION;
}

export const AGREED: SignInAgreement = { agreed: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, boxVersion: BOX_VERSION };

/** Said when a code is asked for without the box, by the window, the preview, or the site's refusal. */
export const AGREE_FIRST = "Tick the box to agree to the Terms and Privacy first.";
/** Said when the site checks other versions than this app's box names. */
export const AGREEMENT_OUTDATED = "The Terms or Privacy changed since this version of Time Machine. Update it, then sign in.";
