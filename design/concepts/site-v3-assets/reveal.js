/* Reveals play once when a block is 15 percent into view. Transform and opacity only.
   Elements with data-stagger reveal their [data-i] children one after another. */
(() => {
  "use strict";
  const els = [...document.querySelectorAll(".rv, .vs, [data-stagger]")];
  if (!("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    els.forEach((e) => e.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver((list) => list.forEach((e) => {
    if (!e.isIntersecting) return;
    io.unobserve(e.target);
    e.target.classList.add("in");
  }), { threshold: 0.15 });
  els.forEach((e) => io.observe(e));
})();
