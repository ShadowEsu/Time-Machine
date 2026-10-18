/* Waitlist forms. Wires every form[data-waitlist] to /api/waitlist.
   Shows success only when the server says ok. Never fakes it.
   After a signup: a personal link, the real place in line, and one share button.
   Funnel counts (visit, share, copy) go to /api/event with no IP, cookie or identifier. */
(function () {
  "use strict";

  var FOUNDER = "preston@unvibe.site";
  var CODE_RE = /^[a-z0-9]{10}$/;
  var MSG = {
    ok: "You're on the list.",
    sending: "Adding you…",
    email: "Please enter a valid email address.",
    consent: "Please tick the box so we can email you.",
    invalidEmail: "That email doesn't look right. Check it and try again.",
    badRequest: "Something in the form went wrong. Reload the page and try again.",
    origin: "This form only works on the Time Machine site.",
    upstream: "We couldn't save that just now. Please try again in a minute.",
    network: "We couldn't reach the server. Check your connection and try again.",
    soon: "The waitlist opens soon. It is not saving emails yet. Email " + FOUNDER + " and Preston adds you by hand."
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
    var parts = text.split(FOUNDER);
    line.appendChild(document.createTextNode(parts[0]));
    if (parts.length > 1) {
      var link = document.createElement("a");
      link.href = "mailto:" + FOUNDER + "?subject=" + encodeURIComponent("Time Machine waitlist");
      link.textContent = FOUNDER;
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
    if (status === 400 || status === 413) return MSG.badRequest;
    if (status === 403) return MSG.origin;
    return MSG.upstream;
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  // The card after a signup. Real numbers from the server only; nothing is shown when they are missing.
  function showCard(form, info) {
    var old = form.parentNode.querySelector(".ref-card");
    if (old) old.remove();
    var link = location.origin + "/?ref=" + info.code;
    var card = el("div", "ref-card");
    if (typeof info.position === "number" && typeof info.total === "number") {
      card.appendChild(el("p", "ref-pos", "You're #" + info.position + " of " + info.total + "."));
    }
    if (typeof info.referrals === "number") {
      card.appendChild(el("p", "ref-sub", info.referrals === 1 ? "1 friend joined with your link." : info.referrals + " friends joined with your link."));
    }
    card.appendChild(el("p", "ref-rule", "Each friend who joins with your link moves you up. Order: most friends joined first, then earliest signup."));
    var row = el("div", "ref-row");
    var field = el("input");
    field.type = "text";
    field.readOnly = true;
    field.value = link;
    field.setAttribute("aria-label", "Your personal link");
    field.addEventListener("focus", function () { field.select(); });
    var copy = el("button", "btn btn-warm btn-sm", "Copy link");
    copy.type = "button";
    copy.addEventListener("click", function () {
      count("copy");
      var done = function () { copy.textContent = "Copied"; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, function () { field.focus(); });
      else field.focus();
    });
    row.appendChild(field);
    row.appendChild(copy);
    if (typeof navigator.share === "function") {
      var share = el("button", "btn btn-ghost btn-sm", "Share");
      share.type = "button";
      share.addEventListener("click", function () {
        count("share");
        navigator.share({
          title: "Time Machine",
          text: "Time Machine saves your project before an AI agent acts and brings back the newest version that passes your tests.",
          url: link
        }).catch(function () {});
      });
      row.appendChild(share);
    }
    card.appendChild(row);
    form.parentNode.insertBefore(card, form.nextSibling);
  }

  function wire(form, first) {
    var email = form.querySelector('input[name="email"]');
    var consent = form.querySelector('input[name="consent"]');
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
      // Forms with a checkbox need the tick. Forms without one ask through the button and the line under it.
      if (consent && !consent.checked) return fail(MSG.consent, consent);

      if (isFile) return say(status, form, "info", MSG.soon);

      busy = true;
      if (button) button.disabled = true;
      form.setAttribute("aria-busy", "true");
      say(status, form, "pending", MSG.sending);

      var controller = typeof AbortController === "function" ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { controller.abort(); }, 15000) : null;
      var body = { email: value, consent: true, source: location.pathname, company: honeypot ? honeypot.value : "" };
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
          if (r.status === 200 && r.data.ok === true) {
            say(status, form, "ok", MSG.ok);
            form.reset();
            if (CODE_RE.test(r.data.code || "")) {
              store("local", "tm-code", r.data.code);
              showCard(form, r.data);
            } else {
              lookup(form);
            }
          } else if (r.status === 503 && r.data.error === "not_configured") {
            say(status, form, "info", MSG.soon);
          } else {
            var field = r.data.error === "invalid_email" ? email : r.data.error === "consent_required" ? consent : null;
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

    if (first) lookup(form);
  }

  // Someone who joined on this browser before sees their real place, fetched fresh.
  function lookup(form) {
    var code = store("local", "tm-code");
    if (isFile || !CODE_RE.test(code || "")) return;
    fetch(api("waitlist") + "?code=" + encodeURIComponent(code), { headers: { Accept: "application/json" }, credentials: "same-origin" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (data && data.ok === true) {
          data.code = code;
          showCard(form, data);
        }
      }, function () {});
  }

  // Say up front when the list is not saving yet, so nobody is surprised after typing.
  var forms = document.querySelectorAll("form[data-waitlist]");
  for (var i = 0; i < forms.length; i++) wire(forms[i], i === 0);
  if (!isFile && forms.length) {
    fetch(api("health"), { headers: { Accept: "application/json" }, credentials: "same-origin" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (h) {
        if (!h || h.waitlist !== false) return;
        for (var j = 0; j < forms.length; j++) {
          var s = forms[j].querySelector("[data-waitlist-status]");
          if (s && !s.getAttribute("data-state")) say(s, forms[j], "info", MSG.soon);
        }
      }, function () {});
  }
})();
