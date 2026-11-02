// Runs in the head before the first paint (a classic script, so the page waits for it): a reload holds the launch splash
// back, so a quick reload never draws it. splash.ts shows it later if the reload's first page is still not drawn.
import { SPLASH_HELD_CLASS, splashHeld } from "./splash.js";

if (splashHeld((performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type)) {
  document.documentElement.classList.add(SPLASH_HELD_CLASS);
}
