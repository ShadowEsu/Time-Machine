// POST /api/waitlist joins the list. GET /api/waitlist?code=<CODE> looks up a place in the list.
// Vercel Node.js function using the Web Request and Response signature.
// Needs two environment variables in Vercel: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
import { handleWaitlist } from "./_lib/waitlist.js";

async function handle(request) {
  const result = await handleWaitlist(
    {
      method: request.method,
      origin: request.headers.get("origin"),
      host: request.headers.get("x-forwarded-host") || request.headers.get("host") || new URL(request.url).host,
      code: new URL(request.url).searchParams.get("code"),
      contentLength: request.headers.get("content-length"),
      readBody: () => request.text(),
    },
    { env: process.env, fetch: globalThis.fetch, log: (message) => console.error(message) },
  );
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: {
      ...result.headers,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
