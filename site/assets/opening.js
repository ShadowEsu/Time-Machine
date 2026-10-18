/* A first-visit flourish, not a loading screen. The page is always usable. */
(() => {
  "use strict";
  const root = document.documentElement;
  let seen = false;
  try { seen = localStorage.getItem("tm-intro-seen") === "1"; localStorage.setItem("tm-intro-seen", "1"); } catch (_) { /* Storage is optional. */ }
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const light = root.dataset.tier === "low" || matchMedia("(pointer: coarse)").matches;
  root.dataset.intro = !seen && !reduced ? "playing" : "done";
  root.dataset.introLight = String(light);
  let timer;
  const finish = () => {
    if (root.dataset.intro !== "playing") return;
    clearTimeout(timer); root.dataset.intro = "done";
    dispatchEvent(new Event("tm:intro-end"));
  };
  document.addEventListener("click", e => { if (e.target.closest("#introEnter")) finish(); });
  addEventListener("keydown", e => {
    if (e.key === "Escape" || (e.key === "Enter" && (e.target === document.body || e.target.id === "introEnter"))) finish();
  });
  addEventListener("scroll", () => { if (scrollY > 100) finish(); }, { passive: true });
  document.addEventListener("visibilitychange", () => { if (document.hidden) finish(); });
  // Also releases the Skip control if the device script is unavailable.
  document.addEventListener("DOMContentLoaded", () => { timer = setTimeout(finish, light ? 1200 : 2900); }, { once: true });
})();
