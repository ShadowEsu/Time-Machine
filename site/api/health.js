// GET /api/health. Says whether the waitlist is set up, whether its database answers, and whether checkout is set up. Never returns secret values.
// email is always false: the site sends no email. How email is handled later is not decided.
// Normal page loads share a 30-second Vercel CDN answer instead of each probing the database.
import { checkHealth } from "./_lib/health.js";

export async function GET() {
  const body = await checkHealth({ env: process.env, fetch: globalThis.fetch, log: (message) => console.error(message) });
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=30",
    },
  });
}
