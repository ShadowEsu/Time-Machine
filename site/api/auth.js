// POST /api/auth. {action:"send", email} emails a one-time code through Supabase Auth.
// {action:"verify", email, code} trades the code for a token the browser keeps for the tab.
// Vercel Node.js function using the Web Request and Response signature.
// Needs SUPABASE_URL and SUPABASE_ANON_KEY in Vercel. The email is never logged.
import { handleAuth } from "./_lib/auth.js";
import { clientIp, readRequestBody } from "./_lib/waitlist.js";

async function handle(request) {
  const result = await handleAuth(
    {
      method: request.method,
      origin: request.headers.get("origin"),
      // Vercel sets host to the domain the client asked for. x-forwarded-host is never trusted here.
      host: request.headers.get("host"),
      // Vercel overwrites x-forwarded-for with the real client IP. Only a one-way code made from it is kept, in memory.
      ip: clientIp(request.headers.get("x-forwarded-for"), request.headers.get("x-real-ip")),
      contentLength: request.headers.get("content-length"),
      readBody: (maxBytes) => readRequestBody(request, maxBytes),
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
