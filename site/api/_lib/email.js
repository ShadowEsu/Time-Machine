// Raw tokens exist only in the outgoing email and request memory. Store SHA256 hashes only.
import { randomBytes, createHash } from "node:crypto";

export const hashToken = (token) => createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export const validToken = (token) => typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
export const isEmailConfigured = (env) => Boolean(env && env.RESEND_API_KEY);
export const siteUrl = (env) => (env.SITE_URL || "https://time-machine-site.vercel.app").replace(/\/$/, "");
const escapeHtml = (text) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export async function sendEmail(kind, email, tokens, info, deps) {
  const root = siteUrl(deps.env);
  const unsubscribe = `${root}/api/unsubscribe?token=${tokens.unsub}`;
  const confirmation = `${root}/api/confirm?token=${tokens.confirm}`;
  const link = kind === "confirm" ? confirmation : `${root}/?ref=${info.code}`;
  const subject = kind === "confirm" ? "Confirm your place on the Time Machine waitlist" : `You're #${info.position} on the Time Machine waitlist`;
  const intro = kind === "confirm"
    ? "Click the link below to confirm your place on the Time Machine waitlist. This link expires in 7 days."
    : `You're #${info.position} of ${info.total} on the Time Machine waitlist. Here's your personal referral link.`;
  const rule = "Order: most friends who confirmed with your link first, then earlier signup first.";
  const reason = "You got this email because you asked to join the Time Machine waitlist. If this was not you, you can unsubscribe below.";
  const footer = "Time Machine, built by Preston Susanto, preston@unvibe.site";
  const text = [intro, link, kind === "welcome" ? rule : "", reason, `Unsubscribe: ${unsubscribe}`, footer].filter(Boolean).join("\n\n");
  const html = `<p>${escapeHtml(intro)}</p><p><a href="${escapeHtml(link)}">${kind === "confirm" ? "Confirm my place" : "Your referral link"}</a></p>${kind === "welcome" ? `<p>${escapeHtml(rule)}</p>` : ""}<p>${escapeHtml(reason)}</p><p><a href="${escapeHtml(unsubscribe)}">Unsubscribe</a></p><p>${escapeHtml(footer)}</p>`;
  // No tracking pixels or redirect links. Disable open/click tracking in the Resend domain settings too.
  try {
    const res = await deps.fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${deps.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: deps.env.WAITLIST_FROM || "Time Machine <timemachine@unvibe.site>",
        to: [email], subject, text, html,
        headers: { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return true;
    deps.log?.(`email: upstream returned status ${res.status}`);
  } catch {
    deps.log?.("email: upstream request failed");
  }
  return false;
}
