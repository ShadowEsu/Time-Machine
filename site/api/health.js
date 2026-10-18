// GET /api/health. Says whether the waitlist is set up. Never returns secret values.
// email is always false: the site sends no email. How email is handled later is not decided.
import { isConfigured } from "./_lib/waitlist.js";

export function GET() {
  return new Response(JSON.stringify({ ok: true, waitlist: isConfigured(process.env), email: false }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
