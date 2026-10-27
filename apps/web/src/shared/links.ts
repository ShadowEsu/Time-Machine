// The only web pages the app opens in the browser. The main process refuses anything else, and the
// window only draws a link when this allows it. No Zod here, so the window bundle stays small.
import { ASK_CONSENT } from "./ask.js";

/** One DNS label: letters, digits and inner hyphens. */
const LABEL = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";
const VERCEL_APP = new RegExp(`^(?:${LABEL}\\.)+vercel\\.app$`);

/** The Time Machine website. The only page the app links to about itself. */
export const SITE_HOST = "time-machine-site.vercel.app";
/** Where the one-time license is bought. Shown in Settings and when the free project limit is reached. */
export const PRICING_URL = `https://${SITE_HOST}/#pricing`;

export const EXTERNAL_REFUSED = "Only the Time Machine site, Vercel pages and Google’s Gemini terms open from the app.";

/**
 * True for the Time Machine site, a Vercel deploy (https://*.vercel.app), a page on https://vercel.com,
 * and Google's Gemini API terms. Plain https only, with no login or port in the URL.
 */
export function isAllowedExternal(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  return u.hostname === SITE_HOST || u.hostname === "vercel.com" || VERCEL_APP.test(u.hostname) || u.href === ASK_CONSENT.termsUrl;
}
