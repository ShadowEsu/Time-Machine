// POST /api/event. Vercel Node.js function using the Web Request and Response signature.
// Counts page visits, shares and link copies. Needs SUPABASE_URL and SUPABASE_KEY in Vercel.
import { handleEvent } from "./_lib/event.js";
import { readRequestBody } from "./_lib/waitlist.js";

async function handle(request) {
  const result = await handleEvent(
    {
      method: request.method,
      origin: request.headers.get("origin"),
      // Vercel sets host to the domain the client asked for. Its docs only promise to overwrite a
      // client-sent x-forwarded-for, not x-forwarded-host, so x-forwarded-host is never trusted here.
      host: request.headers.get("host"),
      contentLength: request.headers.get("content-length"),
      readBody: (maxBytes) => readRequestBody(request, maxBytes),
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
