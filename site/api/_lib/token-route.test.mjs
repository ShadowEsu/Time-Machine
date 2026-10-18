import { afterEach, expect, it, vi } from "vitest";
import { GET as confirm } from "../confirm.js";
import { GET as unsubscribeGet, POST as unsubscribePost } from "../unsubscribe.js";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const TOKEN = "a".repeat(43);
it("returns a no-store invalid redirect without reflecting a raw token", async () => {
  const res = await confirm(new Request("https://site.example.test/api/confirm?token=invalid"));
  expect(res.status).toBe(303);
  expect(res.headers.get("Location")).toBe("/confirmed.html?error=invalid");
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(await res.text()).toBe("");
});
it("GET displays HTML without querying or updating Supabase", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const res = await unsubscribeGet(new Request(`https://site.example.test/api/unsubscribe?token=${TOKEN}`));
  expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  const html = await res.text();
  expect(html).toContain('method="post"');
  expect(html).not.toContain(TOKEN);
  expect(fetch).not.toHaveBeenCalled();
});
it("accepts one-click POST without Origin or email configuration", async () => {
  vi.stubEnv("SUPABASE_URL", "https://synthetic.example.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key");
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{ unsubscribed: true }]))));
  const res = await unsubscribePost(new Request(`https://site.example.test/api/unsubscribe?token=${TOKEN}`, { method: "POST", body: "List-Unsubscribe=One-Click" }));
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("You are unsubscribed");
  expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
});
