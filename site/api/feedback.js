// POST /api/feedback. Vercel Node.js function using the Web Request and Response signature.
// Takes the app's survey answers, sent only when the person pressed Send. Needs SUPABASE_URL and SUPABASE_KEY in Vercel.
import { handleFeedback } from "./_lib/feedback.js";
import { clientIp, readRequestBody } from "./_lib/waitlist.js";

async function handle(request) {
  const result = await handleFeedback(
    {
      method: request.method,
      origin: request.headers.get("origin"),
      // Vercel sets host to the domain the client asked for. Its docs only promise to overwrite a
      // client-sent x-forwarded-for, not x-forwarded-host, so x-forwarded-host is never trusted here.
      host: request.headers.get("host"),
      // Vercel overwrites x-forwarded-for with the real client IP. Only a one-way code made from it leaves this function.
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
