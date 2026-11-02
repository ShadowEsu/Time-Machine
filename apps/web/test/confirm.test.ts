// Destructive confirms: "Never mind" is the first control, so the sheet opens with it focused
// (DialogFocus focuses a new dialog's first control) and Enter right away changes nothing.
// Bringing a version back: one confirm, whatever opened it, with both lists full size (B3).
import { afterEach, describe, expect, test } from "vitest";
import { BRING_KEY, bringBackConfirm, confirmButtons, type BringBackView } from "../src/renderer/confirm.ts";
import { DialogFocus } from "../src/renderer/dialog-focus.ts";

describe("destructive confirms", () => {
  test("Never mind comes before the action, for Remove from app and Go back anyway", () => {
    for (const action of ["Remove from app", "Go back anyway"]) {
      const buttons = [...confirmButtons(action).matchAll(/<button[^>]*data-act="([^"]+)"[^>]*>([^<]*)<\/button>/g)].map((m) => [m[1], m[2]]);
      expect(buttons).toEqual([["confirm-cancel", "Never mind"], ["confirm-do", action]]);
    }
  });
});

const view = (over: Partial<BringBackView> = {}): BringBackView => ({
  name: "“Added dark mode” (8:03:18 AM)",
  folder: false,
  comes: ["Code, including work that was not committed yet", "1 other file we saved next to your code"],
  notComes: ["The values of PORT, STRIPE_SECRET_KEY in .env. We kept the names.", "Database contents, anything already deployed, and changes in other services"],
  unproven: null,
  phone: false,
  working: false,
  error: null,
  ...over,
});
/** The buttons in document order: [data-act, words]. */
const buttons = (html: string): string[][] =>
  [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map((m) => [/data-act="([^"]+)"/.exec(m[1] ?? "")?.[1] ?? "", m[2] ?? ""]);
/** The items listed under the section labelled by `id`. */
const listed = (html: string, id: string): string[] => {
  const sec = new RegExp(`<section[^>]*aria-labelledby="${id}"[^>]*>([\\s\\S]*?)</section>`).exec(html)?.[1] ?? "";
  return [...sec.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1] ?? "");
};

describe("the one confirm for a bring back", () => {
  test("names the version and lists what comes back and what does not, from the engine's lines, each a section of its own", () => {
    const html = bringBackConfirm(view(), "");
    expect(html).toMatch(/role="dialog" aria-modal="true" aria-labelledby="bb-h"/);
    expect(/<h2 id="bb-h">([\s\S]*?)<\/h2>/.exec(html)?.[1]).toContain("Added dark mode");
    expect(listed(html, "bb-yes").length).toBe(2);
    expect(listed(html, "bb-no")).toEqual(["The values of PORT, STRIPE_SECRET_KEY in .env. We kept the names.", "Database contents, anything already deployed, and changes in other services"]);
    // Full size: no inner card around the lists (Design 4a), and nothing from the old Review step (steps, files, dial).
    expect(html).not.toMatch(/tv-cols|class="kv|rw-steps|rw-files|dialmod|class="dial/);
  });

  test("the title breaks before the version's name, not inside it, so the name takes the dialog's full width (Design, PR #71)", () => {
    const h = /<h2 id="bb-h">([\s\S]*?)<\/h2>/.exec(bringBackConfirm(view(), ""))?.[1] ?? "";
    expect(h).toMatch(/^Bring back <span class="bb-name">“Added dark mode” \(<span class="nw">8:03:18 AM<\/span>\)\?<\/span>$/);
  });

  test("the engine's words are escaped", () => {
    const html = bringBackConfirm(view({ notComes: ["<b>x</b>.env"], name: "“<i>y</i>”" }), "");
    expect(html).not.toContain("<b>x</b>");
    expect(html).not.toContain("<i>y</i>");
  });

  test("two buttons named for the outcome; Never mind takes focus, so Enter right away changes nothing", () => {
    const wide = bringBackConfirm(view(), "");
    expect(buttons(wide)).toEqual([["tv-exit", "Never mind"], ["tv-use", "Bring it back"]]);
    expect(wide).toMatch(/<button[^>]*data-act="tv-exit"[^>]*data-autofocus/);
    expect(wide.match(/data-autofocus/g)?.length).toBe(1);
    // A phone's bottom sheet stacks them: Bring it back on top, Never mind last, in the same order for Tab. Never mind still takes focus.
    const phone = bringBackConfirm(view({ phone: true }), "");
    expect(buttons(phone)).toEqual([["tv-use", "Bring it back"], ["tv-exit", "Never mind"]]);
    expect(phone).toMatch(/<button[^>]*data-act="tv-exit"[^>]*data-autofocus/);
    expect(phone).toContain("bb phone");
  });

  test("a version that isn't proven adds one line; a proven one adds none", () => {
    const line = "It hasn’t been checked, so we don’t know if it works.";
    const proven = bringBackConfirm(view(), "");
    const unproven = bringBackConfirm(view({ unproven: line }), "");
    expect(proven).not.toContain("bb-unproven");
    expect(unproven.match(/class="bb-unproven"/g)?.length).toBe(1);
    expect(unproven).toContain(line);
  });

  test("while it works both buttons wait, and a failure says why and keeps the confirm", () => {
    const busy = bringBackConfirm(view({ working: true }), "");
    expect([...busy.matchAll(/<button[^>]*>/g)].every((m) => m[0].includes("disabled"))).toBe(true);
    const failed = bringBackConfirm(view({ error: "Something went wrong" }), "");
    expect(failed).toMatch(/role="alert"[^>]*>Something went wrong/);
    expect(buttons(failed).map((b) => b[0])).toEqual(["tv-exit", "tv-use"]);
  });

  test("a plain folder is never promised a branch; a Git project is", () => {
    expect(bringBackConfirm(view({ folder: true }), "")).not.toMatch(/branch/i);
    expect(bringBackConfirm(view(), "")).toMatch(/branch/);
  });
});

// A tiny DOM for DialogFocus: elements that match the selectors it asks for, a focus that moves, and nothing else.
class El {
  children: El[] = [];
  parentElement: El | null = null;
  inert = false;
  tabIndex: number;
  dataset: Record<string, string> = {};
  constructor(readonly sels: string[], tabIndex = -1, readonly attrs: Record<string, string> = {}) {
    this.tabIndex = tabIndex;
  }
  add(...kids: El[]): this {
    for (const k of kids) (k.parentElement = this), this.children.push(k);
    return this;
  }
  all(): El[] {
    return this.children.flatMap((c) => [c, ...c.all()]);
  }
  querySelectorAll(sel: string): El[] {
    return this.all().filter((e) => e.sels.includes(sel) || (sel.startsWith("button") && e.sels.includes("button")));
  }
  querySelector(sel: string): El | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  closest(sel: string): El | null {
    for (let e: El | null = this; e; e = e.parentElement) if ((sel === "[data-leave]" && e.dataset.leave) || (sel === "[inert]" && e.inert)) return e;
    return null;
  }
  contains(o: unknown): boolean {
    return o === this || this.all().includes(o as El);
  }
  getAttribute(n: string): string | null {
    return this.attrs[n] ?? null;
  }
  getClientRects(): unknown[] {
    return [{}];
  }
  matches(): boolean {
    return false;
  }
  hasAttribute(n: string): boolean {
    return n in this.attrs;
  }
  focus(): void {
    doc.activeElement = this;
  }
}
const doc: { activeElement: El | null } = { activeElement: null };
const DIALOG = '[role="dialog"][aria-modal="true"]';

describe("the bring back confirm's focus", () => {
  afterEach(() => {
    doc.activeElement = null;
  });

  test("lands on Never mind, Tab stays inside, and Never mind or Esc gives focus back to what opened it", () => {
    Object.assign(globalThis, { document: doc, HTMLElement: El });
    const opener = new El(["#opener"], 0);
    const page = new El([]).add(opener);
    const root = new El([]).add(page);
    const focus = new DialogFocus();
    const r = root as unknown as HTMLElement;
    opener.focus();
    focus.sync(r, "#opener");
    expect(doc.activeElement).toBe(opener);

    // The confirm opens over the page, from the opener.
    const never = new El(["button", "[data-autofocus]", "#never"], 0, { "data-autofocus": "" });
    const bring = new El(["button", "#bring"], 0);
    const dialog = new El([DIALOG]).add(never, bring);
    const scrim = new El([]).add(dialog);
    scrim.dataset.leave = BRING_KEY;
    root.add(scrim);
    focus.sync(r, "#opener");
    expect(doc.activeElement).toBe(never);
    expect(page.inert).toBe(true);

    // Tab from the last control wraps to the first; Shift+Tab from the first to the last.
    const tab = (shiftKey: boolean): void => void focus.trapTab({ key: "Tab", shiftKey, preventDefault() {} } as KeyboardEvent);
    bring.focus();
    tab(false);
    expect(doc.activeElement).toBe(never);
    tab(true);
    expect(doc.activeElement).toBe(bring);

    // Never mind: the confirm goes, and focus goes back to the opener, not to the page's start.
    never.focus();
    root.children = root.children.filter((c) => c !== scrim);
    focus.sync(r, "#never");
    expect(doc.activeElement).toBe(opener);
    expect(page.inert).toBe(false);
  });
});
