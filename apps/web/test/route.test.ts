import { describe, expect, test } from "vitest";
import { restoreRoute } from "../src/renderer/route.ts";

const A = "0b8f2f5e-3f7c-4a59-9a43-1d2f6c1b2a10";
const kept = (r: object): string => JSON.stringify(r);

describe("the route kept for a reload (writer#29, dev#31)", () => {
  test("History comes back on the same project, with the detail it had open", () => {
    expect(restoreRoute(kept({ screen: "history", projectId: A, drawer: true, selected: "cp-0003" }), [A])).toEqual({ screen: "history", projectId: A, drawer: true, selected: "cp-0003" });
    expect(restoreRoute(kept({ screen: "history", projectId: A, drawer: false, selected: null }), [A])).toEqual({ screen: "history", projectId: A, drawer: false, selected: null });
  });

  test("a Rewind or Compare comes back as History, an app page as itself without a detail", () => {
    expect(restoreRoute(kept({ screen: "rewind", projectId: A, drawer: false }), [A])?.screen).toBe("history");
    expect(restoreRoute(kept({ screen: "compare", projectId: A, drawer: false }), [A])?.screen).toBe("history");
    expect(restoreRoute(kept({ screen: "settings", projectId: A, drawer: true, selected: "cp-0001" }), [A])).toEqual({ screen: "settings", projectId: A, drawer: false, selected: null });
  });

  test("a removed project is not opened, and with no projects the app starts at Welcome", () => {
    expect(restoreRoute(kept({ screen: "history", projectId: "gone", drawer: false }), [A])).toEqual({ screen: "overview", projectId: null, drawer: false, selected: null });
    expect(restoreRoute(kept({ screen: "storage", projectId: null }), [])).toEqual({ screen: "welcome", projectId: null, drawer: false, selected: null });
    expect(restoreRoute(kept({ screen: "onboarding", projectId: null }), [])?.screen).toBe("onboarding");
  });

  test("nothing kept, or something unreadable, starts as usual", () => {
    expect(restoreRoute(null, [A])).toBeNull();
    expect(restoreRoute("{not json", [A])).toBeNull();
    expect(restoreRoute(kept({ screen: "elsewhere" }), [A])).toBeNull();
  });
});
