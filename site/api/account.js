// GET /api/account with Authorization: Bearer <token> lists the license keys for the signed-in email.
// The keys come from Stripe's paid sessions for that email; the site keeps no license table.
// Vercel Node.js function using the Web Request and Response signature.
// Needs SUPABASE_URL, SUPABASE_ANON_KEY, STRIPE_SECRET_KEY and TM_LICENSE_PRIVATE_KEY in Vercel.
import { handleAccount } from "./_lib/auth.js";
import { clientIp } from "./_lib/waitlist.js";

async function handle(request) {
  const result = await handleAccount(
    {
      method: request.method,
      authorization: request.headers.get("authorization"),
      ip: clientIp(request.headers.get("x-forwarded-for"), request.headers.get("x-real-ip")),
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
