// The launch splash and the entrance timing. The splash runs on a fake clock, so the tests say
// exactly when it fades and when it is gone. No window needed.
import { describe, expect, test } from "vitest";
import { entranceDelay, PAGE_IN_MS, ROW_IN_MS, ROW_STAGGER_CAP_MS, rowDelay } from "../src/renderer/motion.ts";
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

  test("journal rows stagger, and the last starts at most 300 ms after the first however long the journal is", () => {
    expect(rowDelay(0, 0)).toBe(0);
    expect(rowDelay(1, 0)).toBeGreaterThan(0);
    const starts = Array.from({ length: 60 }, (_, i) => rowDelay(i, 0) ?? 0);
    expect(Math.max(...starts)).toBe(ROW_STAGGER_CAP_MS);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    // Once every row has arrived, a redraw draws them plainly.
    expect(rowDelay(59, ROW_STAGGER_CAP_MS + ROW_IN_MS)).toBeNull();
  });
});
