// The toast's clock. A toast stays 6 s, and its time does not run while someone points at it or
// has focus inside it, so it never leaves while being read or while Dismiss is about to be pressed.

/** How long a toast stays when nobody holds it. */
export const TOAST_MS = 6000;

export type ToastHold = "hover" | "focus";

export class ToastTimer {
  private left = 0;
  private since = 0;
  private handle: ReturnType<typeof setTimeout> | undefined;
  private readonly holds = new Set<ToastHold>();

  constructor(private readonly onEnd: () => void, private readonly now: () => number = () => Date.now()) {}

  /** A new toast: the full time again, with no holds from the one before. */
  start(ms = TOAST_MS): void {
    this.stop();
    this.holds.clear();
    this.left = ms;
    this.run();
  }

  /** Pointer over the toast, or focus inside it: the time stops until every hold is let go. */
  hold(why: ToastHold): void {
    if (!this.handle && !this.holds.size) return;
    if (!this.holds.size) this.pause();
    this.holds.add(why);
  }

  release(why: ToastHold): void {
    if (!this.holds.delete(why) || this.holds.size) return;
    this.run();
  }

  stop(): void {
    clearTimeout(this.handle);
    this.handle = undefined;
    this.left = 0;
  }

  private pause(): void {
    clearTimeout(this.handle);
    this.handle = undefined;
    this.left = Math.max(0, this.left - (this.now() - this.since));
  }

  private run(): void {
    if (this.left <= 0) return;
    this.since = this.now();
    this.handle = setTimeout(() => {
      this.handle = undefined;
      this.left = 0;
      this.onEnd();
    }, this.left);
  }
}
