// What going back says it will do: a plain folder (no Git) is never promised a branch (Design gate MF2).
import { describe, expect, test } from "vitest";
import { anywayBody, REVIEW_KEY, reviewKey, goBackSteps } from "../src/renderer/rewind-copy.ts";

describe("rewind wording", () => {
  test("a plain folder: save, then a recovery copy; no branch anywhere", () => {
    const html = goBackSteps({ folder: true, id: "cp-0003", gitDetails: true });
    expect(html).toContain("We save your current version first");
    expect(html).toContain("We build a recovery copy</b> next to your folder");
    expect(html).toContain("Nothing is deleted. Your folder is not touched.</b> You can undo it.");
    expect(html).not.toMatch(/branch/i);
    const body = anywayBody("It is not checked, so we don’t know if it works.", true);
    expect(body).toBe("It is not checked, so we don’t know if it works. We save your current version first. Your folder is not touched, and you can undo it.");
    expect(body).not.toMatch(/branch/i);
  });

  test("a Git project keeps the branch step and today's words", () => {
    const html = goBackSteps({ folder: false, id: "cp-0003", gitDetails: false });
    expect(html).toContain("We put this version on a new local branch</b>.");
    expect(html).toContain("Nothing is pushed, merged, deployed or deleted. Your folder and branch are not touched.");
    expect(goBackSteps({ folder: false, id: "cp-0003", gitDetails: true })).toContain("tm/recover/cp-0003");
    expect(anywayBody("Its check failed, so it may not work.", false)).toBe("Its check failed, so it may not work. We save your current version first and put this one on a new local branch. Your folder and branch are not touched, and you can undo it.");
  });
});

describe("the rewind sheet's key", () => {
  test("a project with no check brings the version back as a copy: never Try it, never a check, whatever verdict is stored", () => {
    for (const v of [null, "BLOCKED", "FAIL", "PASS"] as const) {
      for (const tried of [false, true]) expect(reviewKey(false, v, tried)).toBe("copy");
    }
    expect(REVIEW_KEY.copy).toEqual({ act: "tv-use", label: "Bring it back as a copy" });
  });

  test("a project with a check: Bring it back when it passed, else Try it first, then Try it again", () => {
    expect(reviewKey(true, "PASS", false)).toBe("bring-back");
    expect(reviewKey(true, null, false)).toBe("try");
    expect(reviewKey(true, "FAIL", true)).toBe("try-again");
    expect(REVIEW_KEY["bring-back"]).toEqual({ act: "tv-use", label: "Bring it back" });
    expect(REVIEW_KEY.try.act).toBe("tv-try");
  });
});
