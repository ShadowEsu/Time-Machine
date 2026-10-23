/* The Pay once button. Reads /api/health first (the request checkout.js already made): while checkout
   is closed the button is disabled and says so, and nothing is for sale. A click asks /api/checkout for
   a Stripe URL and goes there. No price, key or card detail ever passes through this page. */
(function () {
  "use strict";

  var CONTACT = "preston@unvibe.site";
  var MSG = {
    soon: "The price is set. Checkout is not open yet, so nothing is for sale today.",
    starting: "Opening checkout…",
    failed: "We couldn't start checkout just now. Try again in a minute, or email " + CONTACT + ".",
    network: "We couldn't reach the server. Check your connection and try again."
  };

  var button = document.querySelector("button[data-buy]");
  var status = document.querySelector("[data-buy-status]");
  if (!button || !status) return;
  var label = button.textContent;
  var script = document.currentScript || document.querySelector('script[src*="buy.js"]');
  var api = function (path) { return new URL("../api/" + path, script ? script.src : location.href).href; };

  function say(text, link) {
    status.textContent = "";
    var parts = text.split(link ? link.text : "\u0000");
    status.appendChild(document.createTextNode(parts[0]));
    if (parts.length > 1) {
      var a = document.createElement("a");
      a.href = link.href;
      a.textContent = link.text;
      status.appendChild(a);
      status.appendChild(document.createTextNode(parts[1]));
    }
  }

  function closed() {
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
    button.textContent = "Checkout opens soon";
    say(MSG.soon);
  }

  function open() {
    button.disabled = false;
    button.removeAttribute("aria-disabled");
    button.textContent = label;
  }

  function fail(text) {
    open();
    say(text, { text: CONTACT, href: "mailto:" + CONTACT + "?subject=" + encodeURIComponent("Time Machine web app") });
  }

  if (location.protocol === "file:" || !window.tmHealth) return closed();

  // A failed or unreadable answer leaves the button enabled, so a click can say what went wrong.
  window.tmHealth.then(function (h) { if (h && h.checkout === false) closed(); else open(); });

  button.addEventListener("click", function () {
    if (button.disabled) return;
    button.disabled = true;
    say(MSG.starting);
    fetch(api("checkout"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "same-origin",
      body: "{}"
    })
      .then(function (res) {
        return res.json().then(
          function (data) { return { status: res.status, data: data || {} }; },
          function () { return { status: res.status, data: {} }; }
        );
      })
      .then(function (r) {
        var url = r.data.url;
        if (r.status === 200 && r.data.ok === true && typeof url === "string" && /^https:\/\//.test(url)) {
          location.assign(url);
        } else if (r.status === 503 && r.data.error === "checkout_closed") {
          closed();
        } else {
          fail(MSG.failed);
        }
      }, function () {
        fail(MSG.network);
      });
  });
})();
