/* The page Stripe sends a buyer back to. Reads ?session=cs_... from the address, asks
   /api/license for the key, and shows it once. The key is never stored or logged by this page. */
(function () {
  "use strict";

  var CONTACT = "preston@unvibe.site";
  var SESSION_RE = /^cs_[A-Za-z0-9_]{10,200}$/;
  var MSG = {
    loading: "Fetching your key…",
    noSession: "This page needs the link Stripe opens after payment. If you paid and lost that link, email " + CONTACT + " with the time of your purchase.",
    notPaid: "Stripe has not marked this purchase as paid yet. Wait a minute and reload this page. If it stays like this, email " + CONTACT + " with the time of your purchase.",
    testPurchase: "This was a Stripe test purchase, so no license key is issued for it.",
    notFound: "We could not find this purchase. Check that you opened the link Stripe gave you, or email " + CONTACT + ".",
    closed: "Checkout is not open yet, so no key can be issued. If you did pay, email " + CONTACT + ".",
    upstream: "The license service did not answer. Reload this page in a minute. If it keeps failing, email " + CONTACT + " and we send your key by hand.",
    network: "We could not reach the server. Check your connection and reload this page."
  };

  var status = document.querySelector("[data-license-status]");
  var box = document.querySelector("[data-license-box]");
  var keyEl = document.getElementById("license-key");
  if (!status || !box || !keyEl) return;
  var script = document.currentScript || document.querySelector('script[src*="thanks.js"]');
  var api = function (path) { return new URL("../api/" + path, script ? script.src : location.href).href; };

  function say(text, state) {
    status.textContent = "";
    var parts = text.split(CONTACT);
    status.appendChild(document.createTextNode(parts[0]));
    if (parts.length > 1) {
      var a = document.createElement("a");
      a.href = "mailto:" + CONTACT + "?subject=" + encodeURIComponent("Time Machine license");
      a.textContent = CONTACT;
      status.appendChild(a);
      status.appendChild(document.createTextNode(parts[1]));
    }
    status.setAttribute("data-state", state);
  }

  var session = new URLSearchParams(location.search).get("session") || "";
  if (!SESSION_RE.test(session)) return say(MSG.noSession, "error");

  say(MSG.loading, "pending");
  fetch(api("license?session=") + encodeURIComponent(session), { headers: { Accept: "application/json" }, credentials: "same-origin" })
    .then(function (res) {
      return res.json().then(
        function (data) { return { status: res.status, data: data || {} }; },
        function () { return { status: res.status, data: {} }; }
      );
    })
    .then(function (r) {
      var key = r.data.key;
      if (r.status === 200 && r.data.ok === true && typeof key === "string" && /^TM1[A-Za-z0-9._-]{8,400}$/.test(key)) {
        keyEl.textContent = key;
        box.hidden = false;
        status.textContent = "";
        status.removeAttribute("data-state");
        keyEl.focus();
      } else if (r.status === 400) {
        say(MSG.noSession, "error");
      } else if (r.status === 402 && r.data.error === "test_purchase") {
        say(MSG.testPurchase, "error");
      } else if (r.status === 402) {
        say(MSG.notPaid, "error");
      } else if (r.status === 404) {
        say(MSG.notFound, "error");
      } else if (r.status === 503) {
        say(MSG.closed, "error");
      } else {
        say(MSG.upstream, "error");
      }
    }, function () {
      say(MSG.network, "error");
    });
})();
