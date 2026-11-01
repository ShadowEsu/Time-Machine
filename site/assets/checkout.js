/* Checkout flag, on every page, loaded before waitlist.js and buy.js. Sign in only matters once someone
   can buy and sign-in works, so elements marked data-checkout-open ship hidden and are shown only when
   /api/health says both checkout and auth are open. On file:, a failed request or a non-JSON answer they
   stay hidden. Links marked data-open-label ship with words that are true while nothing is for sale
   ("Pricing") and take the label the attribute names ("Pay once") only once checkout is open.
   waitlist.js and buy.js read the same request from window.tmHealth (null when the answer could not be read). */
(function () {
  "use strict";

  var script = document.currentScript;
  window.tmHealth = location.protocol === "file:" ? Promise.resolve(null) :
    fetch(new URL("../api/health", script.src).href, { headers: { Accept: "application/json" }, credentials: "same-origin" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; });

  window.tmHealth.then(function (h) {
    if (!h || h.checkout !== true) return;
    var labels = document.querySelectorAll("[data-open-label]");
    for (var j = 0; j < labels.length; j++) labels[j].textContent = labels[j].getAttribute("data-open-label");
    if (h.auth !== true) return;
    var els = document.querySelectorAll("[data-checkout-open]");
    for (var i = 0; i < els.length; i++) els[i].hidden = false;
  });
})();
