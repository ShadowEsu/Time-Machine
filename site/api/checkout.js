// POST /api/checkout starts a Stripe Checkout Session for the one-time web app purchase and returns its link.
// Vercel Node.js function using the Web Request and Response signature.
// Needs STRIPE_SECRET_KEY and TM_LICENSE_PRIVATE_KEY in Vercel. Optional: SITE_ORIGIN, STRIPE_PRICE_ID.
import { handleCheckout } from "./_lib/checkout.js";

async function handle(request) {
  const result = await handleCheckout(
    {
      method: request.method,
      origin: request.headers.get("origin"),
      // Vercel sets host to the domain the client asked for. x-forwarded-host is never trusted here.
      host: request.headers.get("host"),
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
