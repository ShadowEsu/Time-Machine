// GET /api/license?session=cs_... returns the license key for a paid Checkout Session. The thanks page calls it.
// Vercel Node.js function using the Web Request and Response signature.
// Needs STRIPE_SECRET_KEY and TM_LICENSE_PRIVATE_KEY in Vercel. The key is shown on the page only; no email is sent.
import { handleLicense } from "./_lib/license.js";

async function handle(request) {
  const result = await handleLicense(
    { method: request.method, session: new URL(request.url).searchParams.get("session") },
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
