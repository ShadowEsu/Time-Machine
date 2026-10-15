/* Waitlist forms. Wires every form[data-waitlist] to POST /api/waitlist.
   Shows success only when the server says ok. Never fakes it. */
(function () {
  "use strict";

  var FOUNDER = "preston@unvibe.site";
  var MSG = {
    ok: "You're on the list. We'll email you once, when it's ready.",
    sending: "Adding you…",
    email: "Please enter a valid email address.",
    consent: "Please tick the box so we can email you.",
    invalidEmail: "That email doesn't look right. Check it and try again.",
    badRequest: "Something in the form went wrong. Reload the page and try again.",
    origin: "This form only works on the Time Machine site.",
    upstream: "We couldn't save that just now. Please try again in a minute.",
    network: "We couldn't reach the server. Check your connection and try again."
  };

  // The API sits next to the assets folder, so blog pages and the home page hit the same URL.
  var script = document.currentScript || document.querySelector('script[src*="waitlist.js"]');
  var endpoint = new URL("../api/waitlist", script ? script.src : location.href).href;
  var isFile = location.protocol === "file:";

  function say(status, form, state, text, withMail) {
    status.textContent = "";
    if (withMail) {
      var parts = text.split(FOUNDER);
      var link = document.createElement("a");
      link.href = "mailto:" + FOUNDER + "?subject=" + encodeURIComponent("Time Machine waitlist");
      link.textContent = FOUNDER;
      status.appendChild(document.createTextNode(parts[0]));
      status.appendChild(link);
      status.appendChild(document.createTextNode(parts[1] || ""));
    } else {
      status.textContent = text;
    }
    status.setAttribute("data-state", state);
    form.setAttribute("data-state", state);
  }

  function messageFor(status, error) {
    if (status === 400 && error === "invalid_email") return MSG.invalidEmail;
    if (status === 400 && error === "consent_required") return MSG.consent;
    if (status === 400 || status === 413) return MSG.badRequest;
    if (status === 403) return MSG.origin;
    return MSG.upstream;
  }

  function wire(form) {
    var email = form.querySelector('input[name="email"]');
    var consent = form.querySelector('input[name="consent"]');
    var honeypot = form.querySelector('input[name="company"]');
    var button = form.querySelector('button[type="submit"], button:not([type])');
    var status = form.querySelector("[data-waitlist-status]");
    if (!email || !consent || !status) return;
    var busy = false;

    function fail(text, field) {
      say(status, form, "error", text);
      if (field) {
        field.setAttribute("aria-invalid", "true");
        field.focus();
      }
    }

    email.addEventListener("input", function () { email.removeAttribute("aria-invalid"); });
    consent.addEventListener("change", function () { consent.removeAttribute("aria-invalid"); });

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (busy) return;

      var value = email.value.trim();
      if (!value || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return fail(MSG.email, email);
      if (!consent.checked) return fail(MSG.consent, consent);

      if (isFile) {
        say(status, form, "info", "The waitlist works on the live site. For now, email " + FOUNDER + " and we'll add you by hand.", true);
        return;
      }

      busy = true;
      if (button) button.disabled = true;
      form.setAttribute("aria-busy", "true");
      say(status, form, "pending", MSG.sending);

      var controller = typeof AbortController === "function" ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { controller.abort(); }, 15000) : null;

      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          email: value,
          consent: true,
          source: location.pathname,
          company: honeypot ? honeypot.value : ""
        }),
        signal: controller ? controller.signal : undefined
      })
        .then(function (res) {
          return res.json().then(
            function (data) { return { status: res.status, data: data || {} }; },
            function () { return { status: res.status, data: {} }; }
          );
        })
        .then(function (r) {
          if (r.status === 200 && r.data.ok === true) {
            say(status, form, "ok", MSG.ok);
            form.reset();
          } else if (r.status === 503 && r.data.error === "not_configured") {
            say(status, form, "info", "The waitlist isn't open yet. Email " + FOUNDER + " and we'll add you by hand.", true);
          } else {
            var field = r.data.error === "invalid_email" ? email : r.data.error === "consent_required" ? consent : null;
            fail(messageFor(r.status, r.data.error), field);
          }
        }, function () {
          fail(MSG.network);
        })
        .then(function () {
          if (timer) clearTimeout(timer);
          busy = false;
          if (button) button.disabled = false;
          form.removeAttribute("aria-busy");
        });
    });
  }

  var forms = document.querySelectorAll("form[data-waitlist]");
  for (var i = 0; i < forms.length; i++) wire(forms[i]);
})();
