// GET /api/health. Says whether the waitlist is set up. Never returns secret values.
import { isConfigured } from "./_lib/waitlist.js";

export function GET() {
  return new Response(JSON.stringify({ ok: true, waitlist: isConfigured(process.env) }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
