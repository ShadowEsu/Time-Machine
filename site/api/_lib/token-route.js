// Web Request/Response adapter for the token-authorized routes.
export function tokenRoute(handler) {
  return async function handle(request) {
    const result = await handler({ method: request.method, token: new URL(request.url).searchParams.get("token") }, {
      env: process.env, fetch: globalThis.fetch, log: (message) => console.error(message),
    });
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      ...result.headers,
    };
    const body = result.body === null ? null : typeof result.body === "string" ? result.body : JSON.stringify(result.body);
    return new Response(body, { status: result.status, headers });
  };
}
