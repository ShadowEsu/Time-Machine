// The toast's clock: it leaves after 6 s, but never while someone points at it or has focus in it.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TOAST_MS, ToastTimer } from "../src/renderer/toast.ts";

describe("toast timer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const make = (): { timer: ToastTimer; ended: () => number } => {
    let n = 0;
    return { timer: new ToastTimer(() => n++), ended: () => n };
  };

  test("a toast nobody touches leaves after 6 s", () => {
    const { timer, ended } = make();
    timer.start();
    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(ended()).toBe(0);
    vi.advanceTimersByTime(1);
    expect(ended()).toBe(1);
  });

  test("hover and focus stop the time until both let go, and the rest of it then runs", () => {
    const { timer, ended } = make();
    timer.start();
    vi.advanceTimersByTime(4000);
    timer.hold("hover");
    timer.hold("focus");
    vi.advanceTimersByTime(60_000);
    timer.release("hover");
    vi.advanceTimersByTime(60_000);
    expect(ended()).toBe(0);
    timer.release("focus");
    vi.advanceTimersByTime(1999);
    expect(ended()).toBe(0);
    vi.advanceTimersByTime(1);
    expect(ended()).toBe(1);
  });

  test("a new toast gets the full time, and a dismissed one never ends twice", () => {
    const { timer, ended } = make();
    timer.start();
    vi.advanceTimersByTime(5000);
    timer.start();
    vi.advanceTimersByTime(5000);
    expect(ended()).toBe(0);
    timer.stop();
    timer.hold("hover");
    timer.release("hover");
    vi.advanceTimersByTime(60_000);
    expect(ended()).toBe(0);
  });
});
