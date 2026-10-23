import { beforeEach, describe, expect, it } from "vitest";
import { LIMITS, rateLimited, resetRateLimits } from "./ratelimit.js";

beforeEach(() => resetRateLimits());

describe("rate limiter", () => {
  it("keeps a sign-in client limited while another endpoint is flooded with new clients", () => {
    const now = Date.UTC(2026, 9, 23, 17, 0, 0);
    for (let i = 0; i < LIMITS.send; i += 1) expect(rateLimited("send", "client-a", now)).toBe(false);
    expect(rateLimited("send", "client-a", now)).toBe(true);
    for (let i = 0; i <= 10000; i += 1) rateLimited("license", `flood-${i}`, now);
    expect(rateLimited("send", "client-a", now)).toBe(true);
  });
});
