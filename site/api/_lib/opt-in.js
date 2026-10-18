// Pure opt-in handlers. Env, fetch and logs are injected. Never echo an email or raw token.
import { callRpc, isConfigured, isValidEmail, reply } from "./waitlist.js";
import { hashToken, isEmailConfigured, sendEmail, validToken, welcomeUnsubToken } from "./email.js";

const redirect = (target) => reply(303, null, { Location: target });
const upstream = () => reply(502, { ok: false, error: "upstream" });

export async function handleConfirm(req, deps) {
  if (req.method !== "GET") return reply(405, { ok: false, error: "method_not_allowed" }, { Allow: "GET" });
  if (!validToken(req.token)) return redirect("/confirmed.html?error=invalid");
  if (!isConfigured(deps.env) || !isEmailConfigured(deps.env)) return reply(503, { ok: false, error: "not_configured" });
  const unsub = welcomeUnsubToken(req.token);
  const rows = await callRpc("waitlist_confirm", { p_hash: hashToken(req.token), p_unsub_hash: hashToken(unsub) }, deps);
  if (!rows) return upstream();
  if (!rows.length) return redirect("/confirmed.html?error=invalid");
  const info = rows[0];
  if (!info || typeof info.email !== "string" || !isValidEmail(info.email)
      || typeof info.code !== "string" || !/^[a-z0-9]{10}$/.test(info.code)
      || !Number.isSafeInteger(info.position) || info.position < 1
      || !Number.isSafeInteger(info.total) || info.total < info.position) {
    deps.log?.("confirm: upstream returned an unexpected shape");
    return upstream();
  }
  if (!await sendEmail("welcome", info.email, { unsub, confirm: req.token }, info, deps)) return upstream();
  const completed = await callRpc("waitlist_confirm_complete", { p_hash: hashToken(req.token) }, deps);
  if (!completed) return upstream();
  if (!completed.length) return redirect("/confirmed.html?error=invalid");
  if (completed[0]?.completed !== true) return upstream();
  return redirect(`/confirmed.html?code=${info.code}`);
}

export async function handleUnsubscribe(req, deps) {
  if (req.method !== "GET" && req.method !== "POST") {
    return reply(405, { ok: false, error: "method_not_allowed" }, { Allow: "GET, POST" });
  }
  const plain = { "Content-Type": "text/plain; charset=utf-8" };
  if (!validToken(req.token)) return reply(400, "This unsubscribe link is invalid.", plain);
  if (req.method === "GET") {
    // No state change, fetch, or token reflected in HTML. The form posts to this same URL.
    return reply(200, '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Unsubscribe | Time Machine</title><main><h1>Leave the Time Machine waitlist?</h1><form method="post"><button type="submit">Unsubscribe</button></form></main></html>', { "Content-Type": "text/html; charset=utf-8" });
  }
  if (!isConfigured(deps.env)) return reply(503, { ok: false, error: "not_configured" });
  // RFC 8058 mail clients have no Origin. The random token authorizes this request.
  // Ignore the small one-click body; no personal information is accepted or stored from it.
  const rows = await callRpc("waitlist_unsubscribe", { p_hash: hashToken(req.token) }, deps);
  if (!rows) return upstream();
  if (!rows.length) return reply(400, "This unsubscribe link is invalid.", plain);
  if (rows[0]?.unsubscribed !== true) return upstream();
  return reply(200, "You are unsubscribed", plain);
}
