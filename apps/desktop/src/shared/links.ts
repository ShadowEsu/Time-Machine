// The only web pages the app opens in the browser. The main process refuses anything else, and the
// window only draws a link when this allows it. No Zod here, so the window bundle stays small.
import { ASK_CONSENT } from "./ask.js";

/** One DNS label: letters, digits and inner hyphens. */
const LABEL = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";
const VERCEL_APP = new RegExp(`^(?:${LABEL}\\.)+vercel\\.app$`);

export const EXTERNAL_REFUSED = "Only Vercel pages and Google’s Gemini terms open from the app.";

/**
 * True for a Vercel deploy (https://*.vercel.app), a page on https://vercel.com, and Google's
 * Gemini API terms. Plain https only, with no login or port in the URL.
 */
export function isAllowedExternal(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  return u.hostname === "vercel.com" || VERCEL_APP.test(u.hostname) || u.href === ASK_CONSENT.termsUrl;
}
