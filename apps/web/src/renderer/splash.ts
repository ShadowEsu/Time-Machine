// The launch screen: a black stage with the wordmark and a thin loading bar, drawn by index.html
// before any script runs. It stays while the window loads its first real data, at least
// SPLASH_MIN_MS so it never flashes, then fades. Any key or click skips it. With Reduce motion it
// does not fade and has no minimum: it goes the moment the data is there.

/** Shortest time the splash is on screen, so a fast load does not flash it. */
export const SPLASH_MIN_MS = 600;
/** How long the fade out takes. */
export const SPLASH_FADE_MS = 300;
/** Fired on the window when the splash starts to lift. */
export const SPLASH_OUT = "tm-splash-out";

export type SplashPhase = "showing" | "fading" | "gone";

/** What the splash needs from the window. The tests drive it with a fake clock. */
export interface SplashHost {
  now(): number;
  reduced(): boolean;
  later(fn: () => void, ms: number): void;
  /** Start fading over `ms`. From here on the splash no longer takes clicks. */
  fade(ms: number): void;
  remove(): void;
}

export interface Splash {
  /** The first real data is drawn. */
  ready(): void;
  /** A key or click: go now, without waiting for the minimum. */
  skip(): void;
  phase(): SplashPhase;
}

/** When the splash starts to fade, for a splash shown at `shownAt` whose data was ready at `readyAt`. */
export function splashFadeAt(shownAt: number, readyAt: number, reduced: boolean): number {
  return reduced ? readyAt : Math.max(readyAt, shownAt + SPLASH_MIN_MS);
}

export function splashController(host: SplashHost): Splash {
  const shownAt = host.now();
  let phase: SplashPhase = "showing";
  const leave = (): void => {
    if (phase !== "showing") return;
    phase = "fading";
    const ms = host.reduced() ? 0 : SPLASH_FADE_MS;
    host.fade(ms);
    const done = (): void => {
      phase = "gone";
      host.remove();
    };
    if (ms) host.later(done, ms);
    else done();
  };
  return {
    ready() {
      if (phase !== "showing") return;
      const now = host.now();
      const wait = splashFadeAt(shownAt, now, host.reduced()) - now;
      if (wait > 0) host.later(leave, wait);
      else leave();
    },
    skip: leave,
    phase: () => phase,
  };
}

/** The splash in this window, or one that does nothing when the page has none (the browser preview). */
export function mountSplash(): Splash {
  const el = document.getElementById("splash");
  if (!el) return { ready() {}, skip() {}, phase: () => "gone" };
  const onKey = (): void => splash.skip();
  const splash = splashController({
    now: () => performance.now(),
    reduced: () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    later: (fn, ms) => void setTimeout(fn, ms),
    fade(ms) {
      performance.mark("tm-splash-fade");
      window.removeEventListener("keydown", onKey, true);
      el.style.transitionDuration = `${ms}ms`;
      el.classList.add("out");
      // The window's arrivals (the page, its ruler, its rows) play as the splash lifts, not hidden under it.
      window.dispatchEvent(new Event(SPLASH_OUT));
    },
    remove: () => el.remove(),
  });
  // The key still reaches the window, so a shortcut pressed during the splash works.
  window.addEventListener("keydown", onKey, true);
  el.addEventListener("pointerdown", () => splash.skip());
  return splash;
}
