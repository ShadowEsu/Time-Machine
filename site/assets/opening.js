/* A first-visit flourish, not a loading screen. The page is always usable. */
(() => {
  const root = document.documentElement;
  let seen = false;
  try { seen = localStorage.getItem("tm-intro-seen") === "1"; localStorage.setItem("tm-intro-seen", "1"); } catch (_) { /* Storage is optional. */ }
  root.dataset.intro = !seen && !matchMedia("(prefers-reduced-motion: reduce)").matches ? "playing" : "done";
})();
