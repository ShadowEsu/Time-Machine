/* Get started (/get-started). Loaded parser-blocking in <head>, so both classes are set before the first paint
   (no inline script: the CSP allows only files from this site). It honours the stored "Pause motion" choice
   (sound.js owns the button; intro.js reads it the same way), so the enter fade doesn't play, and it shows the
   "Windows isn't supported yet" line on a Windows user agent without moving the steps after paint. */
(function () {
  "use strict";
  var root = document.documentElement;
  try { if (localStorage.getItem("tm-motion") === "paused") root.classList.add("motion-paused"); } catch (e) { /* Storage is optional. */ }
  if (/Windows/.test(navigator.userAgent)) root.classList.add("os-windows");
})();
