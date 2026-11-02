// The launch splash, the entrance timing, the Reduce motion switch and the preview sheet's entrance. The splash runs on a
// fake clock, so the tests say exactly when it fades and when it is gone. No window needed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { afterBanner } from "../src/renderer/rewind-copy.ts";
import {
  BLOCK_STAGGER_MAX, BLOCK_STAGGER_MS, blockDelay, bringBackMoment, checkRun, CROSSFADE_MS, EASE, entranceDelay, HERO_MS, LEAVE_MS, liftFrom, LINE_STAGGER_MS,
  MENU_OUT_MS, MOMENT_MS, PAGE_IN_MS, PRESS_EASE, REDUCE_MOTION_CLASS, RETURN_MS, ROLL_MS, rolledDigits, rowDelay, ROW_STAGGER_MAX, ROW_STAGGER_MS, SETTLE_MS, undoReturn,
} from "../src/renderer/motion.ts";
import { SPLASH_FADE_MS, SPLASH_MIN_MS, splashController, splashFadeAt, type SplashHost } from "../src/renderer/splash.ts";

/** A splash on a fake clock. `events` records when it started fading, for how long, and when it went. */
function fakeSplash(reduced = false, shownAt = 100) {
  let t = shownAt;
  let timers: { at: number; fn: () => void }[] = [];
  const events: string[] = [];
  const host: SplashHost = {
    now: () => t,
    reduced: () => reduced,
    later: (fn, ms) => void timers.push({ at: t + ms, fn }),
    fade: (ms) => void events.push(`fade ${ms} at ${t}`),
    remove: () => void events.push(`gone at ${t}`),
  };
  const splash = splashController(host);
  const advance = (to: number): void => {
    for (;;) {
      const next = timers.filter((x) => x.at <= to).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      timers = timers.filter((x) => x !== next);
      t = next.at;
      next.fn();
    }
    t = to;
  };
  return { splash, events, advance };
}

describe("the launch splash", () => {
  test("a fast load still shows it for the minimum, so it never flashes, then it fades", () => {
    const { splash, events, advance } = fakeSplash();
    advance(250);
    splash.ready();
    expect(splash.phase()).toBe("showing");
    advance(100 + SPLASH_MIN_MS);
    expect(events).toEqual([`fade ${SPLASH_FADE_MS} at ${100 + SPLASH_MIN_MS}`]);
    expect(splash.phase()).toBe("fading");
    advance(100 + SPLASH_MIN_MS + SPLASH_FADE_MS);
    expect(events.at(-1)).toBe(`gone at ${100 + SPLASH_MIN_MS + SPLASH_FADE_MS}`);
    expect(splash.phase()).toBe("gone");
  });

  test("a slow load adds no wait: it fades the moment the first page is drawn", () => {
    const { splash, events, advance } = fakeSplash();
    advance(2400);
    splash.ready();
    expect(events).toEqual([`fade ${SPLASH_FADE_MS} at 2400`]);
  });

  test("any key or click skips it at once, and the data arriving later changes nothing", () => {
    const { splash, events, advance } = fakeSplash();
    advance(180);
    splash.skip();
    expect(events).toEqual([`fade ${SPLASH_FADE_MS} at 180`]);
    advance(400);
    splash.ready();
    splash.skip();
    advance(5000);
    expect(events).toEqual([`fade ${SPLASH_FADE_MS} at 180`, `gone at ${180 + SPLASH_FADE_MS}`]);
  });

  test("with Reduce motion it has no minimum and no fade: it is there only while loading", () => {
    const { splash, events, advance } = fakeSplash(true);
    advance(160);
    splash.ready();
    expect(events).toEqual(["fade 0 at 160", "gone at 160"]);
    expect(splash.phase()).toBe("gone");
    expect(splashFadeAt(100, 160, true)).toBe(160);
    expect(splashFadeAt(100, 160, false)).toBe(100 + SPLASH_MIN_MS);
  });
});

describe("entrances", () => {
  test("a page entrance continues across redraws and is plain once it has finished", () => {
    expect(entranceDelay(0, 0, PAGE_IN_MS)).toBe(0);
    // Redrawn 80 ms in: it carries on from 80 ms instead of starting over.
    expect(entranceDelay(0, 80, PAGE_IN_MS)).toBe(-80);
    expect(entranceDelay(0, PAGE_IN_MS, PAGE_IN_MS)).toBeNull();
  });

  test("a page's blocks rise one after another, and only the first few stagger", () => {
    expect(blockDelay(0, 0, 300)).toBe(0);
    expect(blockDelay(1, 0, 300)).toBe(BLOCK_STAGGER_MS);
    expect(blockDelay(BLOCK_STAGGER_MAX + 3, 0, 300)).toBe(BLOCK_STAGGER_MAX * BLOCK_STAGGER_MS);
    expect(blockDelay(2, BLOCK_STAGGER_MAX * BLOCK_STAGGER_MS + 300, 300)).toBeNull();
  });
});

describe("Reduce motion and the preview sheet's entrance", () => {
  const dir = join(import.meta.dirname, "../src/renderer");
  const css = ["styles.css", "states.css", "features.css"].map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
  const frames = (name: string): string => css.match(new RegExp(`@keyframes ${name} \\{([^}]*\\{[^}]*\\})+[^}]*\\}`))?.[0] ?? "";

  test("the app's Reduce motion setting is the rm class on the page, never calm, the name of the Calm shell", () => {
    expect(REDUCE_MOTION_CLASS).toBe("rm");
    const app = readFileSync(join(dir, "app.ts"), "utf8");
    expect(app).toMatch(/classList\.toggle\(REDUCE_MOTION_CLASS, st\.settings\.reduceMotion\)/);
    expect(app).not.toMatch(/classList\.\w+\("calm"/);
    expect(css).not.toMatch(/\.calm\b/);
    // The rules that still everything else under it are all there, under the new name.
    expect(css).toMatch(/\.rm \*, \.rm \*::before, \.rm \*::after \{ animation-duration: \.01ms !important;/);
  });

  test("the sheet slides in from the right with a fade over --t-glide (260 ms) and fades out over --t-exit (150 ms)", () => {
    expect(css).toMatch(/--t-glide: 260ms;/);
    expect(css).toMatch(/\.lp-sheet\.enter \{ animation: sheet-in var\(--t-glide\) var\(--ease\) both; \}/);
    expect(frames("sheet-in")).toMatch(/opacity: 0/);
    expect(frames("sheet-in")).toMatch(/translateX\(24px\)/);
    // It leaves like every sheet (placeLeaving), over LEAVE_MS, which is --t-exit.
    expect(css).toMatch(new RegExp(`--t-exit: ${LEAVE_MS}ms;`));
    expect(LEAVE_MS).toBe(150);
    // No timing token of its own.
    expect(css).not.toMatch(/--t-sheet/);
  });

  test("under the computer's reduced motion or the app's setting it only fades, opacity only, in 120 ms or less", () => {
    expect(frames("sheet-fade")).toMatch(/opacity: 0/);
    expect(frames("sheet-fade")).not.toMatch(/transform|translate/);
    const fade = "animation: sheet-fade var\\(--t-snap\\) var\\(--ease\\) both !important;";
    expect(css).toMatch(new RegExp(`@media \\(prefers-reduced-motion: reduce\\) \\{ \\.lp-sheet\\.enter \\{ ${fade} \\} \\}`));
    expect(css).toMatch(new RegExp(`\\.rm \\.lp-sheet\\.enter \\{ ${fade} \\}`));
    expect(css).toMatch(/--t-snap: 120ms;/);
  });

  test("the bring-back moment has its own token", () => {
    expect(css).toMatch(/--t-moment: 560ms;/);
  });
});

/** The app's motion tokens as styles.css declares them, in ms, and its two curves. */
const DIR = join(import.meta.dirname, "../src/renderer");
const STYLES = readFileSync(join(DIR, "styles.css"), "utf8");
const CSS = ["styles.css", "states.css", "features.css"].map((f) => readFileSync(join(DIR, f), "utf8")).join("\n");
const token = (name: string): number => Number(new RegExp(`--${name}: (\\d+)ms;`).exec(STYLES)?.[1] ?? NaN);
const curve = (name: string): string => (new RegExp(`--${name}: (cubic-bezier\\([^)]*\\));`).exec(STYLES)?.[1] ?? "").replace(/\s+/g, "");

describe("B6 §3: every duration comes from a token", () => {
  test("settle, moment, return, crossfade, enter and exit are the CSS tokens, on the CSS curves", () => {
    expect(SETTLE_MS).toBe(token("t-press"));
    expect(MOMENT_MS).toBe(token("t-moment"));
    expect(RETURN_MS).toBe(token("t-glide"));
    expect(CROSSFADE_MS).toBe(token("t-snap"));
    expect(MENU_OUT_MS).toBe(token("t-snap"));
    expect(PAGE_IN_MS).toBe(token("t-enter"));
    expect(LEAVE_MS).toBe(token("t-exit"));
    expect(EASE.replace(/\s+/g, "")).toBe(curve("ease"));
    expect(PRESS_EASE.replace(/\s+/g, "")).toBe(curve("press-ease"));
    // The spec's own numbers: rows 8 × 40 ms, lines 60 ms apart, counts roll over 240 ms, the status lands over 320 ms.
    expect([ROW_STAGGER_MAX, ROW_STAGGER_MS, LINE_STAGGER_MS, ROLL_MS, HERO_MS]).toEqual([8, 40, 60, 240, 320]);
  });

  test("the moment runs over --t-moment, Undo's return over --t-glide, and the CSS settle and menu use the tokens by name", () => {
    const steps = bringBackMoment({ dx: 0, dy: 300 }, 2, false);
    expect(steps.find((s) => s.part === "card")?.duration).toBe(MOMENT_MS);
    expect(Math.max(...steps.map((s) => s.delay + s.duration))).toBeLessThanOrEqual(MOMENT_MS);
    expect(undoReturn({ left: 0, top: 100, width: 600, height: 240 }, { left: 0, top: 500, width: 600, height: 76 }, false)?.duration).toBe(RETURN_MS);
    // The glyph settles; the Checking ring that replaces it keeps breathing (it is a status, not a result).
    expect(CSS).toMatch(/\.lp-row\.v-land \.lp-v \.vi \{ animation: v-settle var\(--t-press\) var\(--press-ease\) var\(--vd, 0ms\) both; \}/);
    expect(CSS).toMatch(/\.spk\.v-land \{ animation: v-settle var\(--t-press\) var\(--press-ease\) var\(--vd, 0ms\) both; \}/);
    expect(CSS).toMatch(/@keyframes v-settle \{ from \{ scale: \.6; \} \}/);
    expect(CSS).toMatch(/\.mn-l\.enter \{ transform-origin: top right; animation: menu-in var\(--t-enter\) var\(--ease\) both; \}/);
    expect(CSS).toMatch(/@keyframes menu-in \{ from \{ opacity: 0; transform: scale\(\.96\); \} \}/);
    expect(CSS).toMatch(/\.nav-scrim\.enter > \.side \{ animation: nav-in var\(--t-glide\) var\(--ease\) both; \}/);
    expect(CSS).toMatch(/@keyframes nav-in \{ from \{ transform: translateX\(-100%\); \} \}/);
  });
});

describe("B6 §3.1: rows stagger once, counts roll", () => {
  test("only the first 8 rows stagger, 40 ms apart, and a redraw carries them on", () => {
    expect(rowDelay(0, 0, 260)).toBe(0);
    expect(rowDelay(7, 0, 260)).toBe(7 * ROW_STAGGER_MS);
    expect(rowDelay(8, 0, 260)).toBeNull();
    expect(rowDelay(2, 100, 260)).toBe(2 * ROW_STAGGER_MS - 100);
    expect(rowDelay(7, 7 * ROW_STAGGER_MS + 260, 260)).toBeNull();
  });

  test("a count rolls only the digits that changed; a new width rolls every digit; words never roll", () => {
    expect(rolledDigits("6", "7")).toEqual([0]);
    expect(rolledDigits("16", "17")).toEqual([1]);
    expect(rolledDigits("Free plan, 1 of 3 projects", "Free plan, 2 of 3 projects")).toEqual([11]);
    expect(rolledDigits("9", "10")).toEqual([0, 1]);
    expect(rolledDigits("7", "7")).toEqual([]);
    expect(rolledDigits(null, "7")).toEqual([]);
  });
});

describe("B6 §3.2: the check run follows the engine, result by result", () => {
  // History's save points, oldest first, as points() holds them. The engine (core findGood) walks them newest first.
  const ids = ["cp-0001", "cp-0002", "cp-0003", "cp-0004", "cp-0005", "cp-0006"];

  test("before any result only the newest is checking, and nothing shows a verdict ahead of its result", () => {
    const r = checkRun(ids, [], true);
    expect(r.checking).toBe("cp-0006");
    expect([...r.done.keys()]).toEqual([]);
    expect([r.n, r.of]).toEqual([1, 6]);
  });

  test("each result settles its own row as it arrives, and the ring moves to the next older one: red, red, red, green", () => {
    const events = [
      { checkpoint: "cp-0006", verdict: "FAIL" },
      { checkpoint: "cp-0005", verdict: "FAIL" },
      { checkpoint: "cp-0004", verdict: "FAIL" },
      { checkpoint: "cp-0003", verdict: "PASS" },
    ];
    const seen = events.map((_, i) => checkRun(ids, events.slice(0, i + 1), i < 3));
    expect(seen.map((r) => r.checking)).toEqual(["cp-0005", "cp-0004", "cp-0003", null]);
    expect(seen.map((r) => [...r.done.keys()].length)).toEqual([1, 2, 3, 4]);
    expect([...seen[3]!.done.entries()]).toEqual([["cp-0006", "FAIL"], ["cp-0005", "FAIL"], ["cp-0004", "FAIL"], ["cp-0003", "PASS"]]);
    expect(seen.map((r) => r.found)).toEqual([null, null, null, "cp-0003"]);
    expect(seen[1]!.n).toBe(3);
  });

  test("the order is the arrival order: a result is never placed ahead, and nothing is checking once the search ends", () => {
    const r = checkRun(ids, [{ checkpoint: "cp-0006", verdict: "FAIL" }], false);
    expect(r.checking).toBeNull();
    expect(r.done.get("cp-0005")).toBeUndefined();
    // The oldest failed: nothing older is left to check.
    expect(checkRun(["cp-0001"], [{ checkpoint: "cp-0001", verdict: "FAIL" }], true).checking).toBeNull();
  });
});

describe("B6 §3.3: bring back lifts the row into the card, with Undo there from the first frame", () => {
  const card = { left: 300, top: 120, width: 640, height: 260 };

  test("the card starts where the row was, kept inside the window, and lands in its own place", () => {
    expect(liftFrom({ left: 300, top: 520, width: 640, height: 76 }, card, 900)).toEqual({ dx: 0, dy: 400 });
    // A row below the fold rises from the window's bottom edge, so the card (and Undo in it) is in view from frame 1.
    expect(liftFrom({ left: 300, top: 1400, width: 640, height: 76 }, card, 900)).toEqual({ dx: 0, dy: 900 - 260 - 120 });
    expect(liftFrom(null, card, 900)).toBeNull();
  });

  test("the card only moves (never fades), lifts 6 px first, lands on none; the two lines then the safe line fade in last", () => {
    const steps = bringBackMoment({ dx: 0, dy: 400 }, 2, false);
    const c = steps.find((s) => s.part === "card")!;
    expect(c.keyframes.every((k) => !("opacity" in k))).toBe(true);
    expect(c.keyframes[0]).toMatchObject({ transform: "translate(0px, 400px)" });
    expect(c.keyframes[1]).toMatchObject({ transform: "translate(0px, 394px)" });
    expect(c.keyframes.at(-1)).toMatchObject({ transform: "none" });
    const lines = steps.filter((s) => s.part === "line");
    expect(lines.map((s) => s.delay)).toEqual([lines[0]!.delay, lines[0]!.delay + LINE_STAGGER_MS]);
    expect(lines.every((s) => s.keyframes.every((k) => !("transform" in k)))).toBe(true);
    const safe = steps.find((s) => s.part === "safe")!;
    expect(safe.delay).toBeGreaterThan(Math.max(...lines.map((s) => s.delay)));
    // Nothing in the moment targets Undo or Keep it.
    expect(steps.every((s) => ["card", "line", "safe"].includes(s.part))).toBe(true);
  });

  test("Undo and Keep it sit outside every part that fades, so they are there at full opacity on frame 1", () => {
    const html = afterBanner({ name: "“Added dark mode”", branch: "tm/recover/cp-0003", copyDir: "/x/app-recovered-cp-0003", open: true, working: false, busy: false, undoKey: "⌘Z", reveal: "Show in Finder", checkId: "cp-0003", broken: { id: "cp-0007", title: "Your broken version" } });
    expect(html.match(/class="after-l"/g)?.length).toBe(2);
    expect(html).toMatch(/<p class="after-l">On the new branch <span[^>]*>tm\/recover\/cp-0003<\/span>\.<\/p>/);
    expect(html).toMatch(/<p class="after-l">In a copy at <span[^>]*>\/x\/app-recovered-cp-0003<\/span>\. Your folder was not touched\.<\/p>/);
    const fading = [...html.matchAll(/<(p|div) class="after-(?:l|broken)">[\s\S]*?<\/\1>/g)].map((m) => m[0]).join("");
    expect(fading).not.toMatch(/undo-rewind|undo-dismiss/);
    expect(html.indexOf('data-act="undo-rewind"')).toBeGreaterThan(0);
  });

  test("Undo shrinks the card back into its row over --t-glide", () => {
    const back = undoReturn(card, { left: 300, top: 520, width: 640, height: 80 }, false)!;
    expect(back.keyframes[0]).toMatchObject({ transform: "none", opacity: 1 });
    expect(back.keyframes.at(-1)).toMatchObject({ transform: "translate(0px, 400px) scale(1, 0.3077)", opacity: 0 });
  });
});

describe("B6 §4: under reduced motion nothing moves and the final frame is the same", () => {
  test("bring back puts the card in its place with no lift, no fades; Undo's return and the row stagger do not run", () => {
    expect(bringBackMoment({ dx: 0, dy: 400 }, 2, true)).toEqual([]);
    expect(undoReturn({ left: 0, top: 0, width: 10, height: 10 }, { left: 0, top: 100, width: 10, height: 10 }, true)).toBeNull();
    // No lift when the row is not on screen either: the card is simply there, and its lines still arrive.
    expect(bringBackMoment(null, 2, false).some((s) => s.part === "card")).toBe(false);
  });

  test("the CSS stills the settle, the ring, the menus and the drawer under the setting and the computer's switch", () => {
    expect(CSS).toMatch(/\.rm \*, \.rm \*::before, \.rm \*::after \{ animation-duration: \.01ms !important; animation-iteration-count: 1 !important;/);
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \*, \*::before, \*::after \{ animation-duration: \.01ms !important; animation-iteration-count: 1 !important;/);
    // The rail's working dot breathes three times, then rests (a static dot); under reduced motion it never starts.
    expect(CSS).toMatch(/\.breath \{[^}]*animation: breath 2\.4s ease-in-out 3;/);
    expect(CSS).toMatch(/\.rm \.breath, /);
  });

  test("no loading state spins: .spin is gone from the renderer", () => {
    const src = ["app.ts", "ask-panel.ts", "feature-settings.ts"].map((f) => readFileSync(join(DIR, f), "utf8")).join("\n");
    expect(src).not.toMatch(/class="spin"/);
    expect(CSS).not.toMatch(/\.spin\b/);
  });
});
