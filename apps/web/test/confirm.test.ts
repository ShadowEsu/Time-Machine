// Destructive confirms: "Never mind" is the first control, so the sheet opens with it focused
// (DialogFocus focuses a new dialog's first control) and Enter right away changes nothing.
import { describe, expect, test } from "vitest";
import { confirmButtons } from "../src/renderer/confirm.ts";

describe("destructive confirms", () => {
  test("Never mind comes before the action, for Remove from app and Go back anyway", () => {
    for (const action of ["Remove from app", "Go back anyway"]) {
      const buttons = [...confirmButtons(action).matchAll(/<button[^>]*data-act="([^"]+)"[^>]*>([^<]*)<\/button>/g)].map((m) => [m[1], m[2]]);
      expect(buttons).toEqual([["confirm-cancel", "Never mind"], ["confirm-do", action]]);
    }
  });
});
