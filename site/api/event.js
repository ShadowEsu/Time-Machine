// POST /api/event. Vercel Node.js function using the Web Request and Response signature.
// Counts page visits, shares and link copies. Needs SUPABASE_URL and SUPABASE_KEY in Vercel.
import { handleEvent } from "./_lib/event.js";

async function handle(request) {
  const result = await handleEvent(
    {
      method: request.method,
      origin: request.headers.get("origin"),
      host: request.headers.get("x-forwarded-host") || request.headers.get("host") || new URL(request.url).host,
      contentLength: request.headers.get("content-length"),
      readBody: () => request.text(),
    },
    { env: process.env, fetch: globalThis.fetch, log: (message) => console.error(message) },
  );
  if (result.body === null) {
    return new Response(null, { status: result.status, headers: { ...result.headers, "Cache-Control": "no-store" } });
  }
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
