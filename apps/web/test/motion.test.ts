// The launch splash, the entrance timing, the Reduce motion switch and the preview sheet's entrance. The splash runs on a
// fake clock, so the tests say exactly when it fades and when it is gone. No window needed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { BLOCK_STAGGER_MAX, BLOCK_STAGGER_MS, blockDelay, entranceDelay, LEAVE_MS, PAGE_IN_MS, REDUCE_MOTION_CLASS } from "../src/renderer/motion.ts";
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

  test("the bring-back moment has its own token, for later", () => {
    expect(css).toMatch(/--t-moment: 560ms;/);
  });
});
