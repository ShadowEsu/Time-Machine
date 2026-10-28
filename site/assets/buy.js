/* The Pay once button. Reads /api/health first (the request checkout.js already made): while checkout
   is closed the button is disabled and says so, and nothing is for sale. A click asks /api/checkout for
   a Stripe URL and goes there. No price, key or card detail ever passes through this page.
   Before Buy sits an unticked Terms and Privacy box, added here so it shows only while checkout can open. Nothing is
   sent until it is ticked; then /api/checkout gets the versions it names, and Stripe keeps them with the session. */
(function () {
  "use strict";

  var CONTACT = "preston@unvibe.site";
  // Must equal TERMS_VERSION, PRIVACY_VERSION and BOX_VERSION in site/api/_lib/agreement.js (a test keeps them equal).
  var TERMS_VERSION = "terms-2026-10-22";
  var PRIVACY_VERSION = "privacy-2026-10-28b";
  var BOX_VERSION = "agree-box-2026-10-29";
  var MSG = {
    soon: "The price is set. Checkout is not open yet, so nothing is for sale today.",
    starting: "Opening checkout…",
    failed: "We couldn't start checkout just now. Try again in a minute, or email " + CONTACT + ".",
    network: "We couldn't reach the server. Check your connection and try again.",
    agree: "Please tick the box before you buy.",
    outdated: "The Terms or Privacy changed since this page loaded. Reload the page, read them, and tick the box again."
  };

  var button = document.querySelector("button[data-buy]");
  var status = document.querySelector("[data-buy-status]");
  if (!button || !status) return;
  var label = button.textContent;
  var script = document.currentScript || document.querySelector('script[src*="buy.js"]');
  var api = function (path) { return new URL("../api/" + path, script ? script.src : location.href).href; };
  var page = function (path) { return new URL("../" + path, script ? script.src : location.href).href; };

  function link(href, text) {
    var a = document.createElement("a");
    a.href = page(href);
    a.textContent = text;
    return a;
  }

  // The box: unticked, its versions on it, hidden until checkout can open.
  var agree = document.createElement("label");
  agree.className = "wl-consent buy-agree";
  agree.hidden = true;
  var box = document.createElement("input");
  box.type = "checkbox";
  box.name = "agree";
  box.required = true;
  box.setAttribute("data-terms-version", TERMS_VERSION);
  box.setAttribute("data-privacy-version", PRIVACY_VERSION);
  box.setAttribute("data-box-version", BOX_VERSION);
  var words = document.createElement("span");
  words.appendChild(document.createTextNode("I agree to the "));
  words.appendChild(link("terms.html", "Terms (draft)"));
  words.appendChild(document.createTextNode(" and have read the "));
  words.appendChild(link("privacy.html", "Privacy Policy (draft)"));
  words.appendChild(document.createTextNode(". I am 18 or older, or I am the parent or guardian paying."));
  agree.appendChild(box);
  agree.appendChild(words);
  button.parentNode.insertBefore(agree, button);
  box.addEventListener("change", function () { box.removeAttribute("aria-invalid"); });

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
    agree.hidden = true;
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
    button.textContent = "Checkout opens soon";
    say(MSG.soon);
  }

  function open() {
    agree.hidden = false;
    button.disabled = false;
    button.removeAttribute("aria-disabled");
    button.textContent = label;
  }

  function fail(text) {
    open();
    say(text, { text: CONTACT, href: "mailto:" + CONTACT + "?subject=" + encodeURIComponent("Time Machine web app") });
  }

  // Marks the box, moves focus to it and says why nothing was sent.
  function refuse(text) {
    open();
    box.setAttribute("aria-invalid", "true");
    box.focus();
    say(text);
  }

  if (location.protocol === "file:" || !window.tmHealth) return closed();

  // A failed or unreadable answer leaves the button enabled, so a click can say what went wrong.
  window.tmHealth.then(function (h) { if (h && h.checkout === false) closed(); else open(); });

  button.addEventListener("click", function () {
    if (button.disabled) return;
    if (!box.checked) return refuse(MSG.agree);
    box.removeAttribute("aria-invalid");
    button.disabled = true;
    say(MSG.starting);
    fetch(api("checkout"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ agreed: true, termsVersion: box.getAttribute("data-terms-version"), privacyVersion: box.getAttribute("data-privacy-version"), boxVersion: box.getAttribute("data-box-version") })
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
        } else if (r.status === 400 && r.data.error === "agreement_required") {
          refuse(MSG.agree);
        } else if (r.status === 400 && r.data.error === "agreement_outdated") {
          refuse(MSG.outdated);
        } else {
          fail(MSG.failed);
        }
      }, function () {
        fail(MSG.network);
      });
  });
})();
