/* Sign in with a one-time email code to see your web app keys again.
   The token from /api/auth lives in sessionStorage only, for this tab. Keys are shown, never stored or logged.
   No code is asked for until the Terms and Privacy box is ticked. Both calls to /api/auth send the versions the box
   names (its data-terms-version, data-privacy-version and data-box-version), and the server records them. */
(function () {
  "use strict";

  var CONTACT = "preston@unvibe.site";
  var TOKEN_KEY = "tm-account-token";
  var TOKEN_RE = /^[A-Za-z0-9._-]{20,4000}$/;
  var KEY_RE = /^TM1[A-Za-z0-9._-]{8,400}$/;
  var MSG = {
    closed: "Sign-in is not open yet.",
    checkoutClosed: "Checkout is not open yet, so there are no purchases to sign in to.",
    email: "Please enter a valid email address.",
    code: "Please enter the 6-digit code from the email.",
    agree: "Please tick the box to get a code.",
    outdated: "The Terms or Privacy changed since this page loaded. Reload the page, read them, and tick the box again.",
    sending: "Sending the code…",
    sent: "We sent a 6-digit code to ",
    checking: "Checking the code…",
    loading: "Fetching your keys…",
    badCode: "That code did not match, or it expired. Check the newest email, or ask for a new code.",
    expired: "Your sign-in ended. Sign in again.",
    rateLimited: "Too many tries. Wait a minute, then try again.",
    upstream: "We couldn't do that just now. Try again in a minute, or email " + CONTACT + ".",
    network: "We couldn't reach the server. Check your connection and try again.",
    none: "No purchase found for this email. Use the email you gave at checkout."
  };

  var status = document.querySelector("[data-account-status]");
  var sendForm = document.querySelector('[data-account-step="send"]');
  var verifyForm = document.querySelector('[data-account-step="verify"]');
  var keys = document.querySelector("[data-account-keys]");
  if (!status || !sendForm || !verifyForm || !keys) return;
  var emailField = sendForm.querySelector('input[name="email"]');
  var agreeBox = sendForm.querySelector('input[name="agree"]');
  if (!agreeBox) return;
  // Why the box stopped a send is said right under it (Design, 28 Oct), not in the status line above the form.
  var agreeNote = sendForm.querySelector("[data-account-agree-note]");
  // The note is styled as an error only while it says something, so an empty one draws nothing (Design P2, 28 Oct).
  function note(text) {
    if (!agreeNote) return;
    agreeNote.textContent = text;
    if (text) agreeNote.setAttribute("data-state", "error"); else agreeNote.removeAttribute("data-state");
  }
  agreeBox.addEventListener("change", function () {
    agreeBox.removeAttribute("aria-invalid");
    note("");
  });
  var codeField = verifyForm.querySelector('input[name="code"]');
  var sentLine = verifyForm.querySelector("[data-account-sent]");
  var list = keys.querySelector("[data-account-list]");
  var who = keys.querySelector("[data-account-email]");
  var script = document.currentScript || document.querySelector('script[src*="account.js"]');
  var api = function (path) { return new URL("../api/" + path, script ? script.src : location.href).href; };
  var email = "";
  // What the ticked box agreed to, sent again with the code.
  var agreement = null;

  function store(value) {
    try {
      if (value === null) sessionStorage.removeItem(TOKEN_KEY);
      else if (value === undefined) return sessionStorage.getItem(TOKEN_KEY);
      else sessionStorage.setItem(TOKEN_KEY, value);
    } catch (e) { /* Storage is optional. */ }
    return null;
  }

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
    if (state) status.setAttribute("data-state", state); else status.removeAttribute("data-state");
  }

  function show(step) {
    sendForm.hidden = step !== "send";
    verifyForm.hidden = step !== "verify";
    keys.hidden = step !== "keys";
  }

  function busy(form, on) {
    form.setAttribute("aria-busy", on ? "true" : "false");
    var buttons = form.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = on;
  }

  function call(path, options) {
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 15000) : null;
    options.headers = options.headers || {};
    options.headers.Accept = "application/json";
    options.credentials = "same-origin";
    if (controller) options.signal = controller.signal;
    return fetch(api(path), options)
      .then(function (res) {
        return res.json().then(
          function (data) { return { status: res.status, data: data || {} }; },
          function () { return { status: res.status, data: {} }; }
        );
      })
      .then(function (r) { clearTimeout(timer); return r; }, function () { clearTimeout(timer); return { status: 0, data: {} }; });
  }

  // Marks the box, moves focus to it and says why nothing was sent: under the box while it shows, else in the status line.
  function refuse(text) {
    agreeBox.setAttribute("aria-invalid", "true");
    if (agreeNote && !sendForm.hidden) {
      say("");
      note(text);
    } else say(text, "error");
    agreeBox.focus();
  }

  // A POST to /api/auth that carries what the box agreed to.
  function authBody(body, agreed) {
    body.agreed = agreed.agreed;
    body.termsVersion = agreed.termsVersion;
    body.privacyVersion = agreed.privacyVersion;
    body.boxVersion = agreed.boxVersion;
    return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  }

  function messageFor(r) {
    if (r.status === 0) return MSG.network;
    if (r.status === 400 && r.data.error === "agreement_required") return MSG.agree;
    if (r.status === 400 && r.data.error === "agreement_outdated") return MSG.outdated;
    if (r.status === 401) return MSG.badCode;
    if (r.status === 429) return MSG.rateLimited;
    if (r.status === 503 && r.data.error === "auth_closed") return MSG.closed;
    if (r.status === 503 && r.data.error === "checkout_closed") return MSG.checkoutClosed;
    return MSG.upstream;
  }

  function keyBlock(license, index) {
    var box = document.createElement("div");
    box.className = "license";
    var h = document.createElement("p");
    h.className = "license-h";
    h.id = "license-h-" + index;
    h.textContent = license.issued ? "Issued " + license.issued : "Key";
    var code = document.createElement("code");
    code.className = "license-key";
    code.id = "license-key-" + index;
    code.setAttribute("translate", "no");
    code.setAttribute("aria-labelledby", h.id);
    code.textContent = license.key;
    var row = document.createElement("div");
    row.className = "copy-row";
    var button = document.createElement("button");
    button.className = "btn btn-ghost btn-sm";
    button.type = "button";
    button.textContent = "Copy key";
    var out = document.createElement("p");
    out.className = "copy-status";
    out.setAttribute("role", "status");
    out.setAttribute("aria-live", "polite");
    button.addEventListener("click", function () {
      var done = function (text) { out.textContent = ""; setTimeout(function () { out.textContent = text; }, 50); };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(license.key).then(function () { done("Copied"); }, function () { done("Copy did not work. Select the key and copy it by hand."); });
      } else {
        done("Select the key and copy it by hand.");
      }
    });
    row.appendChild(button);
    row.appendChild(out);
    box.appendChild(h);
    box.appendChild(code);
    box.appendChild(row);
    return box;
  }

  function render(data) {
    list.textContent = "";
    who.textContent = typeof data.email === "string" ? data.email : "";
    var licenses = Array.isArray(data.licenses) ? data.licenses.filter(function (l) { return l && typeof l.key === "string" && KEY_RE.test(l.key); }) : [];
    if (!licenses.length) {
      var none = document.createElement("p");
      none.className = "account-none";
      none.textContent = MSG.none;
      list.appendChild(none);
    } else {
      for (var i = 0; i < licenses.length; i++) list.appendChild(keyBlock(licenses[i], i));
    }
    say("");
    show("keys");
    keys.querySelector("h2").focus();
  }

  function load(token) {
    say(MSG.loading, "pending");
    call("account", { method: "GET", headers: { Authorization: "Bearer " + token } }).then(function (r) {
      if (r.status === 200 && r.data.ok === true) return render(r.data);
      if (r.status === 401) { store(null); show("send"); return say(MSG.expired, "error"); }
      show("send");
      say(messageFor(r), "error");
    });
  }

  function signOut() {
    store(null);
    list.textContent = "";
    who.textContent = "";
    email = "";
    codeField.value = "";
    show("send");
    say("You are signed out.", "info");
    emailField.focus();
  }

  sendForm.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var value = emailField.value.trim();
    if (!value || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) { emailField.setAttribute("aria-invalid", "true"); emailField.focus(); return say(MSG.email, "error"); }
    emailField.removeAttribute("aria-invalid");
    if (!agreeBox.checked) return refuse(MSG.agree);
    agreeBox.removeAttribute("aria-invalid");
    note("");
    var agreed = { agreed: true, termsVersion: agreeBox.getAttribute("data-terms-version"), privacyVersion: agreeBox.getAttribute("data-privacy-version"), boxVersion: agreeBox.getAttribute("data-box-version") };
    busy(sendForm, true);
    say(MSG.sending, "pending");
    call("auth", authBody({ action: "send", email: value }, agreed)).then(function (r) {
      busy(sendForm, false);
      if (r.status === 200 && r.data.ok === true) {
        email = value;
        agreement = agreed;
        sentLine.textContent = MSG.sent + email + ".";
        codeField.value = "";
        say("");
        show("verify");
        codeField.focus();
      } else {
        if (r.status === 400 && /^agreement_/.test(r.data.error)) return refuse(messageFor(r));
        say(messageFor(r), "error");
      }
    });
  });

  verifyForm.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var code = codeField.value.replace(/\s+/g, "");
    if (!/^[0-9]{6}$/.test(code)) { codeField.setAttribute("aria-invalid", "true"); codeField.focus(); return say(MSG.code, "error"); }
    codeField.removeAttribute("aria-invalid");
    busy(verifyForm, true);
    say(MSG.checking, "pending");
    call("auth", authBody({ action: "verify", email: email, code: code }, agreement)).then(function (r) {
      busy(verifyForm, false);
      var token = r.data.token;
      if (r.status === 200 && r.data.ok === true && typeof token === "string" && TOKEN_RE.test(token)) {
        store(token);
        load(token);
      } else if (r.status === 400 && /^agreement_/.test(r.data.error)) {
        show("send");
        refuse(messageFor(r));
      } else {
        say(messageFor(r), "error");
        codeField.focus();
      }
    });
  });

  verifyForm.querySelector("[data-account-back]").addEventListener("click", function () { show("send"); say(""); emailField.focus(); });
  keys.querySelector("[data-account-signout]").addEventListener("click", signOut);

  if (location.protocol === "file:") return say(MSG.closed, "info");

  // Health first: while sign-in is closed, the form stays hidden and the page says so.
  call("health", { method: "GET" }).then(function (r) {
    if (r.status === 200 && r.data.auth === false) return say(MSG.closed, "info");
    var token = store();
    if (token && TOKEN_RE.test(token)) return load(token);
    show("send");
  });
})();
