// POST /api/checkout starts a Stripe Checkout Session for the one-time web app purchase and returns its link.
// The body says the buyer ticked the Terms and Privacy box before Buy: {agreed: true, termsVersion, privacyVersion}.
// Vercel Node.js function using the Web Request and Response signature.
// Needs STRIPE_SECRET_KEY and TM_LICENSE_PRIVATE_KEY in Vercel. Optional: SITE_ORIGIN, STRIPE_PRICE_ID.
import { handleCheckout } from "./_lib/checkout.js";
import { clientIp, readRequestBody } from "./_lib/waitlist.js";

async function handle(request) {
  const result = await handleCheckout(
    {
      method: request.method,
      origin: request.headers.get("origin"),
      // Vercel sets host to the domain the client asked for. x-forwarded-host is never trusted here.
      host: request.headers.get("host"),
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
