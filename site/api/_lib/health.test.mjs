import { afterEach, expect, it, vi } from "vitest";
import { GET } from "../health.js";
afterEach(() => vi.unstubAllEnvs());
it("reports Supabase readiness, always email false, and never the keys", async () => {
  vi.stubEnv("SUPABASE_URL", "https://synthetic.example.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-secret-db");
  vi.stubEnv("RESEND_API_KEY", "synthetic-secret-mail");
  const res = GET();
  const text = await res.text();
  expect(JSON.parse(text)).toEqual({ ok: true, waitlist: true, email: false });
  expect(text).not.toContain("synthetic-secret");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  expect(await GET().json()).toEqual({ ok: true, waitlist: false, email: false });
});
