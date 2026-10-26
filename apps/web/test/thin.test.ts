import { describe, expect, test } from "vitest";
import type { ThinPreview } from "../src/shared/api.ts";
import { thinConfirm, thinReview, thinSummary } from "../src/renderer/thin-view.ts";

const preview = (n: number): ThinPreview => ({
  remove: Array.from({ length: n }, (_, i) => ({ id: `cp-${String(i + 1).padStart(4, "0")}`, at: "2026-10-24T03:00:00Z", reason: "Auto save with a newer one the same hour" })),
  keep: 5,
  bytesFreed: 48_000,
  unreadable: [],
});

describe("Storage > Thin old auto saves", () => {
  test("the preview says how many can go, about how much, and what always stays", () => {
    expect(thinSummary(preview(13))).toBe("13 auto saves can go, about 46.9 KB. Working, pinned and named save points always stay.");
    expect(thinSummary(preview(0))).toBe("No auto saves can go yet. Working, pinned and named save points always stay.");
  });

  test("Review lists each one with its time and why it can go", () => {
    const html = thinReview(preview(2));
    expect(html.match(/<li>/g)).toHaveLength(2);
    expect(html).toContain("Auto save with a newer one the same hour");
  });

  test("the confirm names the count and says the folder is not touched", () => {
    const c = thinConfirm("thesis-notes", preview(13));
    expect(c.action).toBe("Remove 13");
    expect(c.title).toBe("Remove 13 auto saves from thesis-notes?");
    expect(c.body).toContain("your folder is not touched");
  });
});
