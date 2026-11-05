// The launch screen: the paper window with the wordmark and the branded loader (the buddy, its clock hand sweeping),
// drawn by index.html before any script runs. It never adds wait (MOTION-SPEC §3.2): every open holds it back
// (splash-gate.ts decides before the first paint) and it shows only if the first page is still not drawn after
// splashHoldMs, 600 ms for a first open (the spec's loader threshold) and 1 s for a reload. Once shown it has no minimum:
// it fades the moment the data is there. Any key or click skips it. With Reduce motion it does not fade.

/** How long the fade out takes (--m-fast, the spec's crossfade to content). */
export const SPLASH_FADE_MS = 180;
/** Fired on the window when the splash starts to lift. */
export const SPLASH_OUT = "tm-splash-out";
/** A first open whose first page is drawn within this long shows no splash (MOTION-SPEC §2: a loader only past 600 ms). */
export const SPLASH_LAUNCH_HOLD_MS = 600;
/** A reload whose first page is drawn within this long of the reload shows no splash (Design §3.4). */
export const SPLASH_HOLD_MS = 1000;
/** On the page element while the splash is held back. styles.css does not draw a held splash. */
export const SPLASH_HELD_CLASS = "splash-held";
/** The wordmark's face. splash-gate.ts starts loading it before the first paint. */
export const SPLASH_FONT = '600 1em "Bricolage Grotesque"';
/** On the page element until SPLASH_FONT is there. styles.css keeps the wordmark out of layout meanwhile, so the face
 *  arriving never moves it: it is laid out once, in its own face (CLS 0). */
export const SPLASH_FONT_CLASS = "splash-font";

export type SplashPhase = "held" | "showing" | "fading" | "gone";

/** How long the splash is held back for the page's navigation (PerformanceNavigationTiming.type): 1 s on a reload. */
export function splashHoldMs(navigationType: string | undefined): number {
  return navigationType === "reload" ? SPLASH_HOLD_MS : SPLASH_LAUNCH_HOLD_MS;
}

/** What the splash needs from the window. The tests drive it with a fake clock. */
export interface SplashHost {
  /** Milliseconds since the page started loading. */
  now(): number;
  reduced(): boolean;
  later(fn: () => void, ms: number): void;
  /** Draw a held splash. */
  show(): void;
  /** Start fading over `ms`. From here on the splash no longer takes clicks. */
  fade(ms: number): void;
  remove(): void;
}

export interface Splash {
  /** The first real data is drawn. */
  ready(): void;
  /** A key or click: go now. */
  skip(): void;
  phase(): SplashPhase;
}

/** The splash's own arrival (the wordmark rising, --m-normal). A page drawn within this long of the splash showing cuts to it. */
export const SPLASH_ARRIVE_MS = 350;

/** `holdMs`: the splash is not drawn until this long after the page started loading, and never if the page is drawn first.
 *  0 draws it at once (a page whose gate did not run). */
export function splashController(host: SplashHost, holdMs = 0): Splash {
  let phase: SplashPhase = holdMs > 0 ? "held" : "showing";
  let shownAt = host.now();
  const leave = (): void => {
    if (phase !== "showing") return;
    phase = "fading";
    // Landing while the splash is still arriving cuts straight to the page: no fade-in followed by a fade-out (Design).
    const ms = host.reduced() || host.now() - shownAt < SPLASH_ARRIVE_MS ? 0 : SPLASH_FADE_MS;
    host.fade(ms);
    const done = (): void => {
      phase = "gone";
      host.remove();
    };
    if (ms) host.later(done, ms);
    else done();
  };
  /** A held splash that is no longer needed goes without ever being drawn, so nothing lifts. */
  const drop = (): void => {
    phase = "gone";
    host.remove();
  };
  if (phase === "held") {
    host.later(() => {
      if (phase !== "held") return;
      phase = "showing";
      shownAt = host.now();
      host.show();
    }, Math.max(0, holdMs - host.now()));
  }
  return {
    ready() {
      if (phase === "held") return drop();
      leave();
    },
    skip() {
      if (phase === "held") drop();
      else leave();
    },
    phase: () => phase,
  };
}

/** The splash in this window, or one that does nothing when the page has none (the browser preview). */
export function mountSplash(): Splash {
  const el = document.getElementById("splash");
  if (!el) return { ready() {}, skip() {}, phase: () => "gone" };
  const page = document.documentElement;
  const onKey = (): void => splash.skip();
  const splash = splashController({
    now: () => performance.now(),
    reduced: () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    later: (fn, ms) => void setTimeout(fn, ms),
    show() {
      performance.mark("tm-splash-show");
      page.classList.remove(SPLASH_HELD_CLASS);
    },
    fade(ms) {
      performance.mark("tm-splash-fade");
      window.removeEventListener("keydown", onKey, true);
      el.style.transitionDuration = `${ms}ms`;
      el.classList.add("out");
      // The window's arrivals (the page, its ruler, its rows) play as the splash lifts, not hidden under it.
      window.dispatchEvent(new Event(SPLASH_OUT));
    },
    remove() {
      window.removeEventListener("keydown", onKey, true);
      el.remove();
      page.classList.remove(SPLASH_HELD_CLASS);
    },
  }, page.classList.contains(SPLASH_HELD_CLASS) ? splashHoldMs((performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type) : 0);
  // The key still reaches the window, so a shortcut pressed during the splash works.
  window.addEventListener("keydown", onKey, true);
  el.addEventListener("pointerdown", () => splash.skip());
  return splash;
}
