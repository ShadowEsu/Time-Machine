// What going back says it will do: a plain folder (no Git) is never promised a branch (Design gate MF2).
import { describe, expect, test } from "vitest";
import { afterBanner, anywayBody, bringBackView, railLine, REVIEW_KEY, reviewKey, goBackSteps, unprovenLine, type AfterView } from "../src/renderer/rewind-copy.ts";

describe("rewind wording", () => {
  test("a plain folder: save, then a copy; no branch anywhere", () => {
    const html = goBackSteps({ folder: true, id: "cp-0003", gitDetails: true });
    expect(html).toContain("We save your current version first");
    expect(html).toContain("We build a copy</b> next to your folder");
    expect(html).not.toMatch(/deployed|safe copy|recovery copy/i);
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

describe("the one confirm's unproven line", () => {
  test("a version that passed adds no line, and neither does a project with no check (it only saves versions)", () => {
    expect(unprovenLine(true, "PASS")).toBeNull();
    for (const v of [null, "FAIL", "INCOMPLETE", "BLOCKED", "ERROR", "PASS"] as const) expect(unprovenLine(false, v)).toBeNull();
  });

  test("not checked, failed and a check that did not finish each add one true line, never the same one", () => {
    const lines = (["FAIL", "INCOMPLETE", "BLOCKED", "ERROR", null] as const).map((v) => unprovenLine(true, v));
    for (const l of lines) expect(l).toMatch(/^[^\n]+\.$/);
    expect(new Set(lines).size).toBe(lines.length);
    expect(unprovenLine(true, null)).toMatch(/not been checked|hasn’t been checked/);
    expect(unprovenLine(true, "FAIL")).toMatch(/failed/);
  });
});

describe("where a bring back opens", () => {
  test("the one confirm, unless the folder is missing or the save point you were on is damaged: then the dial, to choose one", () => {
    expect(bringBackView({ folderMissing: false, damaged: false })).toBe("confirm");
    expect(bringBackView({ folderMissing: true, damaged: false })).toBe("dial");
    expect(bringBackView({ folderMissing: false, damaged: true })).toBe("dial");
  });
});

describe("after a bring back: a banner on History, not a toast (B4)", () => {
  const view = (over: Partial<AfterView> = {}): AfterView => ({
    name: "“Added dark mode” (8:03:18 AM)",
    branch: "tm/recover/cp-0003",
    copyDir: "/Users/me/tmp/marigold-tips-recovered-cp-0003",
    open: true,
    working: false,
    busy: false,
    undoKey: "⌘Z",
    reveal: "Show in Finder",
    checkId: "cp-0003",
    broken: { id: "cp-0008", title: "Your broken version, saved before going back" },
    ...over,
  });
  /** The buttons in document order: [data-act, words without the key cap]. */
  const buttons = (html: string): string[][] =>
    [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => [/data-act="([^"]+)"/.exec(m[1] ?? "")?.[1] ?? "", (m[2] ?? "").replace(/<kbd>[\s\S]*?<\/kbd>/, "").replace(/<[^>]+>/g, "")]);
  /** The words a button points to with aria-describedby. */
  const consequence = (html: string, act: string): string => {
    const id = new RegExp(`<button[^>]*data-act="${act}"[^>]*aria-describedby="([^"]+)"`).exec(html)?.[1] ?? "none";
    return new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(html)?.[1] ?? "";
  };

  test("says where the working version went (branch and copy) and that your folder was not touched, once; Undo and Keep it each carry a consequence", () => {
    const html = afterBanner(view());
    expect(html).not.toMatch(/toast|role="alert"/);
    expect(html).toContain("tm/recover/cp-0003");
    expect(html).toContain("/Users/me/tmp/marigold-tips-recovered-cp-0003");
    expect(html.match(/not touched/g)?.length).toBe(1);
    // Undo and Keep it come first after where it went, so Undo is in view from the first frame on a phone too.
    expect(buttons(html)).toEqual([
      ["undo-rewind", "Undo this bring back"],
      ["undo-dismiss", "Keep it"],
      ["reveal-dir", "Show in Finder"],
      ["verify-one", "Check it works"],
      ["pick", "Show it in History"],
    ]);
    expect(html).toMatch(/data-act="reveal-dir" data-path="\/Users\/me\/tmp\/marigold-tips-recovered-cp-0003"/);
    expect(html).toMatch(/data-act="pick" data-id="cp-0008"/);
    // The row is named in the sentence, so the link can be short and say where it goes.
    expect(/class="after-broken">([\s\S]*?)<button/.exec(html)?.[1]).toContain("saved in History as “Your broken version, saved before going back”.");
    expect(html).toMatch(/<kbd>⌘Z<\/kbd>/);
    expect(consequence(html, "undo-rewind")).toMatch(/^Removes the copy and the branch\. [^.]+\.$/);
    expect(consequence(html, "undo-dismiss")).toMatch(/^Keeps the copy and the branch\. [^.]+\.$/);
    expect(html).not.toContain("—");
  });

  test("a plain folder has no Git: its banner never mentions a branch", () => {
    const html = afterBanner(view({ branch: "" }));
    expect(html).not.toMatch(/branch/i);
    expect(consequence(html, "undo-rewind")).toMatch(/^Removes the copy\./);
    expect(consequence(html, "undo-dismiss")).toMatch(/^Keeps the copy\./);
  });

  test("a project with no check gets no Check it works, and no broken row is linked when there is none", () => {
    const acts = buttons(afterBanner(view({ checkId: null, broken: null }))).map((b) => b[0]);
    expect(acts).toEqual(["undo-rewind", "undo-dismiss", "reveal-dir"]);
  });

  test("after Keep it, or for a recovery tm ui did not make, it still says where it went, with no Undo and no Keep it", () => {
    const kept = afterBanner(view({ open: false }));
    expect(buttons(kept).map((b) => b[0])).toEqual(["reveal-dir", "copy", "verify-one", "pick"]);
    expect(kept).toMatch(/data-act="copy" data-text="tm\/recover\/cp-0003"/);
    expect(kept.match(/not touched/g)?.length).toBe(1);
    // A copy that was moved or removed: no Show in Finder, and the banner says so.
    const gone = afterBanner(view({ open: false, copyDir: "" }));
    expect(buttons(gone).map((b) => b[0])).not.toContain("reveal-dir");
    expect(gone).toContain("Its copy is not there anymore.");
  });

  test("while Undo works, both choices wait, and Undo says so", () => {
    const html = afterBanner(view({ working: true, busy: true }));
    expect(html).toMatch(/<button[^>]*data-act="undo-rewind"[^>]*disabled[^>]*>Undoing…/);
    expect(html).toMatch(/<button[^>]*data-act="undo-dismiss"[^>]*disabled/);
  });

  test("the engine's names and paths are escaped", () => {
    const html = afterBanner(view({ name: "“<i>x</i>”", copyDir: "/tmp/<b>y</b>", broken: { id: "cp-0008", title: "<s>z</s>" } }));
    expect(html).not.toMatch(/<i>x|<b>y|<s>z/);
  });

  test("the sidebar says a working copy is ready next to the verdict until Keep it or Undo", () => {
    expect(railLine("Broken", true)).toBe("Broken · copy ready");
    expect(railLine("Broken", false)).toBe("Broken");
  });
});
