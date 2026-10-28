import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { BOX_VERSION, PRIVACY_VERSION, TERMS_VERSION } from "./_lib/agreement.js";

// Runs the real site/assets/account.js against a small stand-in DOM, with the box's attributes taken from site/account.html.
const SCRIPT = readFileSync(new URL("../assets/account.js", import.meta.url), "utf8");
const PAGE = readFileSync(new URL("../account.html", import.meta.url), "utf8");
const SITE = "https://time-machine-site.vercel.app";
const EMAIL = "buyer@example.test";

function boxAttributes() {
  const input = PAGE.match(/<input\b[^>]*\bname="agree"[^>]*>/)?.[0];
  if (!input) throw new Error("account.html has no agree box");
  const attrs = {};
  for (const name of ["data-terms-version", "data-privacy-version", "data-box-version"]) {
    const value = input.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
    if (value !== undefined) attrs[name] = value;
  }
  return attrs;
}

class El {
  constructor(attrs = {}, inner = {}) {
    this.attrs = { ...attrs };
    this.inner = inner;
    this.listeners = {};
    this.children = [];
    this.hidden = false;
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.textContent = "";
  }
  querySelector(selector) { return this.inner[selector] ?? null; }
  // No buttons in the stand-in forms: busy() only toggles them.
  querySelectorAll() { return []; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  fire(type) { for (const fn of this.listeners[type] ?? []) fn({ type, preventDefault() {} }); }
  getAttribute(name) { return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  removeAttribute(name) { delete this.attrs[name]; }
  focus() { this.focused = true; }
  appendChild(child) { this.children.push(child); return child; }
}

function page() {
  const emailField = new El({ name: "email" });
  const box = new El({ name: "agree", ...boxAttributes() });
  const note = new El({ id: "account-agree-note", "data-account-agree-note": "" });
  const codeField = new El({ name: "code" });
  const sendForm = new El({ "data-account-step": "send" }, { 'input[name="email"]': emailField, 'input[name="agree"]': box, "[data-account-agree-note]": note });
  const verifyForm = new El({ "data-account-step": "verify" }, { 'input[name="code"]': codeField, "[data-account-sent]": new El(), "[data-account-back]": new El() });
  const keys = new El({ "data-account-keys": "" }, { "[data-account-list]": new El(), "[data-account-email]": new El(), "[data-account-signout]": new El(), h2: new El() });
  for (const el of [sendForm, verifyForm, keys]) el.hidden = true;
  const status = new El({ "data-account-status": "" });
  const top = { "[data-account-status]": status, '[data-account-step="send"]': sendForm, '[data-account-step="verify"]': verifyForm, "[data-account-keys]": keys };
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const data = url === `${SITE}/api/health` ? { ok: true, auth: true } : url === `${SITE}/api/auth` ? { ok: true } : {};
    return { status: 200, json: async () => data };
  };
  const storage = new Map();
  const document = {
    currentScript: { src: `${SITE}/assets/account.js` },
    querySelector: (selector) => top[selector] ?? null,
    createElement: () => new El(),
    createTextNode: (text) => ({ textContent: text }),
  };
  const context = {
    document,
    location: { protocol: "https:", href: `${SITE}/account.html` },
    sessionStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) },
    fetch,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    navigator: {},
    window: { isSecureContext: true },
  };
  vm.runInNewContext(SCRIPT, context);
  return { emailField, box, note, codeField, sendForm, verifyForm, calls, auth: () => calls.filter((c) => c.url === `${SITE}/api/auth`) };
}

// Lets every pending fetch and promise step run.
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("the sign-in page script", () => {
  it("sends no code while the box is unticked, and says why under the box", async () => {
    const p = page();
    await settle();
    expect(p.sendForm.hidden).toBe(false);
    p.emailField.value = EMAIL;
    expect(p.note.getAttribute("data-state")).toBe(null);
    p.sendForm.fire("submit");
    await settle();
    expect(p.auth()).toEqual([]);
    expect(p.box.getAttribute("aria-invalid")).toBe("true");
    expect(p.note.textContent).toBe("Please tick the box to get a code.");
    expect(p.note.getAttribute("data-state")).toBe("error");
    // Ticking clears the note, and an empty note carries no error style (Design P2: no empty red pill).
    p.box.checked = true;
    p.box.fire("change");
    expect(p.note.textContent).toBe("");
    expect(p.note.getAttribute("data-state")).toBe(null);
  });

  it("sends the box's versions with the code request and again with the code", async () => {
    const p = page();
    await settle();
    p.emailField.value = EMAIL;
    p.box.checked = true;
    p.box.fire("change");
    p.sendForm.fire("submit");
    await settle();
    const agreement = { agreed: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, boxVersion: BOX_VERSION };
    expect(p.auth()).toHaveLength(1);
    expect(p.auth()[0].init.method).toBe("POST");
    expect(JSON.parse(p.auth()[0].init.body)).toEqual({ action: "send", email: EMAIL, ...agreement });
    expect(p.verifyForm.hidden).toBe(false);
    p.codeField.value = "123456";
    p.verifyForm.fire("submit");
    await settle();
    expect(p.auth()).toHaveLength(2);
    expect(p.auth()[1].init.method).toBe("POST");
    expect(JSON.parse(p.auth()[1].init.body)).toEqual({ action: "verify", email: EMAIL, code: "123456", ...agreement });
  });
});
