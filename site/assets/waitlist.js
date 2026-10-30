/* Waitlist forms. Wires every form[data-waitlist] to /api/waitlist.
   A signup is saved as pending and unconfirmed. The site sends no email. Never fakes success.
   A friend's ?ref= code is kept for the visit and sent with the signup.
   Visit counts go to /api/event with no IP, cookie or identifier. */
(function () {
  "use strict";

  var CONTACT = "preston@unvibe.site";
  var CODE_RE = /^[a-z0-9]{10}$/;
  var MSG = {
    ok: "Saved as pending and unconfirmed. No email has been sent.",
    sending: "Saving…",
    email: "Please enter a valid email address.",
    consent: "Please tick the box to join the waitlist.",
    outdated: "The words by the box changed since this page loaded. Reload the page, read them, and tick the box again.",
    invalidEmail: "That email doesn't look right. Check it and try again.",
    badRequest: "Something in the form went wrong. Reload the page and try again.",
    origin: "This form only works on the Time Machine site.",
    upstream: "We couldn't save that just now. Please try again in a minute.",
    network: "We couldn't reach the server. Check your connection and try again.",
    rateLimited: "The waitlist is busy. Please try again in a minute.",
    soon: "The waitlist opens soon. It is not saving emails yet. Email " + CONTACT + " and we add you by hand.",
    down: "Signups may not save right now. If yours fails, email " + CONTACT + " and we add you by hand."
  };

  // The API sits next to the assets folder, so blog pages and the home page hit the same URLs.
  var script = document.currentScript || document.querySelector('script[src*="waitlist.js"]');
  var base = script ? script.src : location.href;
  var api = function (path) { return new URL("../api/" + path, base).href; };
  var isFile = location.protocol === "file:";

  function store(kind, key, value) {
    try {
      var s = kind === "local" ? localStorage : sessionStorage;
      if (value === undefined) return s.getItem(key);
      s.setItem(key, value);
    } catch (e) { /* Storage is optional. */ }
    return null;
  }

  // A friend's link ends in ?ref=<code>. Keep it for this visit so a signup on any page credits them.
  var params = new URLSearchParams(location.search);
  if (CODE_RE.test(params.get("ref") || "")) store("session", "tm-ref", params.get("ref"));
  var ref = store("session", "tm-ref") || "";
  if (!CODE_RE.test(ref)) ref = "";

  // Funnel counts. Respects Global Privacy Control and Do Not Track. Failures are silent by design.
  var quiet = navigator.globalPrivacyControl === true || navigator.doNotTrack === "1";
  function count(type) {
    if (isFile || quiet) return;
    try {
      fetch(api("event"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        keepalive: true,
        body: JSON.stringify(ref ? { type: type, path: location.pathname, via: "ref" } : { type: type, path: location.pathname })
      }).catch(function () {});
    } catch (e) { /* Counting never breaks the page. */ }
  }
  if (!store("session", "tm-visit:" + location.pathname)) {
    store("session", "tm-visit:" + location.pathname, "1");
    count("visit");
  }

  // One span, so the status row (a flex box with a dot) lays the sentence out as one line of text.
  function say(status, form, state, text) {
    status.textContent = "";
    var line = document.createElement("span");
    var parts = text.split(CONTACT);
    line.appendChild(document.createTextNode(parts[0]));
    if (parts.length > 1) {
      var link = document.createElement("a");
      link.href = "mailto:" + CONTACT + "?subject=" + encodeURIComponent("Time Machine waitlist");
      link.textContent = CONTACT;
      line.appendChild(link);
      line.appendChild(document.createTextNode(parts[1]));
    }
    status.appendChild(line);
    status.setAttribute("data-state", state);
    form.setAttribute("data-state", state);
  }

  function messageFor(status, error) {
    if (status === 400 && error === "invalid_email") return MSG.invalidEmail;
    if (status === 400 && error === "consent_required") return MSG.consent;
    if (status === 400 && error === "consent_outdated") return MSG.outdated;
    if (status === 400 || status === 413) return MSG.badRequest;
    if (status === 429 && error === "rate_limited") return MSG.rateLimited;
    if (status === 403) return MSG.origin;
    return MSG.upstream;
  }

  function wire(form) {
    var email = form.querySelector('input[name="email"]');
    var consent = form.querySelector('input[name="consent"]');
    // The second, optional box. Separate from the npm box: leaving it unticked never blocks a signup.
    var feedback = form.querySelector('input[name="feedback"]');
    var honeypot = form.querySelector('input[name="company"]');
    var button = form.querySelector('button[type="submit"], button:not([type])');
    var status = form.querySelector("[data-waitlist-status]");
    if (!email || !status) return;
    var busy = false;

    function fail(text, field) {
      say(status, form, "error", text);
      if (field) {
        field.setAttribute("aria-invalid", "true");
        field.focus();
      }
    }

    email.addEventListener("input", function () { email.removeAttribute("aria-invalid"); });
    if (consent) consent.addEventListener("change", function () { consent.removeAttribute("aria-invalid"); });

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (busy) return;

      var value = email.value.trim();
      if (!value || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return fail(MSG.email, email);
      // Every form needs its own unticked box: consent is only what the person ticked. A form without one never sends.
      if (!consent) return fail(MSG.badRequest);
      if (!consent.checked) return fail(MSG.consent, consent);

      if (isFile) return say(status, form, "info", MSG.soon);

      busy = true;
      if (button) button.disabled = true;
      form.setAttribute("aria-busy", "true");
      say(status, form, "pending", MSG.sending);

      var controller = typeof AbortController === "function" ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { controller.abort(); }, 15000) : null;
      // The box's value names the wording the person agreed to (consent_text_version, 0007). The feedback box says whether it
      // is ticked, and sends its own wording's version only when it is (0008).
      var body = { email: value, consent: consent.checked, consentVersion: consent.value, source: location.pathname, company: honeypot ? honeypot.value : "" };
      if (feedback) body.feedback = feedback.checked;
      if (feedback && feedback.checked) body.feedbackVersion = feedback.value;
      if (ref) body.ref = ref;

      fetch(api("waitlist"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
        signal: controller ? controller.signal : undefined
      })
        .then(function (res) {
          return res.json().then(
            function (data) { return { status: res.status, data: data || {} }; },
            function () { return { status: res.status, data: {} }; }
          );
        })
        .then(function (r) {
          if (r.status === 200 && r.data.ok === true && r.data.pending === true) {
            say(status, form, "ok", MSG.ok);
            form.reset();
          } else if (r.status === 503 && r.data.error === "not_configured") {
            say(status, form, "info", MSG.soon);
          } else {
            var field = r.data.error === "invalid_email" ? email : r.data.error === "consent_required" || r.data.error === "consent_outdated" ? consent : null;
            fail(messageFor(r.status, r.data.error), field);
          }
        }, function () {
          fail(MSG.network);
        })
        .then(function () {
          clearTimeout(timer);
          busy = false;
          if (button) button.disabled = false;
          form.removeAttribute("aria-busy");
        });
    });
  }

  // Say up front when the list is not saving, so nobody is surprised after typing.
  // checkout.js (loaded first) already asked /api/health; its promise resolves to null on any failure.
  var forms = document.querySelectorAll("form[data-waitlist]");
  for (var i = 0; i < forms.length; i++) wire(forms[i]);
  if (!isFile && forms.length && window.tmHealth) {
    window.tmHealth.then(function (h) {
      // Only Supabase decides if signups are saved. The site sends no email, so h.email is not checked.
      // A down database is still worth a try: the real answer to a signup replaces this line.
      var text = !h ? null : h.waitlist === false ? MSG.soon : h.database === "unreachable" ? MSG.down : null;
      if (!text) return;
      for (var j = 0; j < forms.length; j++) {
        var s = forms[j].querySelector("[data-waitlist-status]");
        if (s && !s.getAttribute("data-state")) say(s, forms[j], "info", text);
      }
    });
  }

  // A link marked data-waitlist-focus brings its form (href="#id") into view and puts the cursor in the email field.
  var jumps = document.querySelectorAll("a[data-waitlist-focus]");
  for (var n = 0; n < jumps.length; n++) {
    jumps[n].addEventListener("click", function (ev) {
      var form = document.getElementById(this.getAttribute("href").slice(1));
      var field = form && form.querySelector('input[name="email"]');
      if (!field || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      ev.preventDefault();
      var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      form.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
      field.focus({ preventScroll: true });
    });
  }
})();
