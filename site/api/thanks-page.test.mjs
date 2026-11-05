import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

// Runs the real site/assets/thanks.js against a small stand-in DOM whose heading and lead start as site/thanks.html ships them.
// The page may say a payment went through only after /api/license returned a key, which it does only for a paid session.
const SCRIPT = readFileSync(new URL("../assets/thanks.js", import.meta.url), "utf8");
const PAGE = readFileSync(new URL("../thanks.html", import.meta.url), "utf8");
const SITE = "https://time-machine-site.vercel.app";
const SESSION = "cs_test_thanksPage0123456789";
// A stand-in with a key's shape only; thanks.js checks the shape, never the signature.
const KEY = `TM1.${"a".repeat(16)}.${"b".repeat(16)}`;
const PAID = /payment went through|thank you/i;

const text = (html) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

// The page title, the h1 and the paragraph right after it, as the HTML ships them.
function shipped() {
  const head = PAGE.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>\s*<p\b[^>]*>([\s\S]*?)<\/p>/);
  if (!head) throw new Error("thanks.html has no h1 followed by a paragraph");
  return { title: text(PAGE.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ""), h1: text(head[1]), lead: text(head[2]) };
}

class El {
  constructor(textContent = "") {
    this.attrs = {};
    this.children = [];
    this.hidden = false;
    this.textContent = textContent;
  }
  getAttribute(name) { return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  removeAttribute(name) { delete this.attrs[name]; }
  appendChild(child) { this.children.push(child); this.textContent += child.textContent; return child; }
  focus() { this.focused = true; }
}

/** @param {string} search  @param {{ status: number, data: object } | null} answer  null: no request is expected */
function page(search, answer) {
  const s = shipped();
  const h1 = new El(s.h1);
  const lead = new El(s.lead);
  const status = new El();
  const box = new El();
  box.hidden = true;
  const keyEl = new El();
  const top = { "[data-license-status]": status, "[data-license-box]": box, "[data-thanks-title]": h1, "[data-thanks-lead]": lead };
  const doc = { title: s.title };
  const calls = [];
  const document = {
    get title() { return doc.title; },
    set title(v) { doc.title = v; },
    currentScript: { src: `${SITE}/assets/thanks.js` },
    querySelector: (selector) => top[selector] ?? null,
    getElementById: (id) => (id === "license-key" ? keyEl : null),
    createElement: () => new El(),
    createTextNode: (t) => ({ textContent: t }),
  };
  const fetch = async (url) => {
    calls.push(url);
    if (!answer) throw new Error(`unexpected request ${url}`);
    return { status: answer.status, json: async () => answer.data };
  };
  vm.runInNewContext(SCRIPT, { document, location: { protocol: "https:", href: `${SITE}/thanks${search}`, search }, fetch, URL, URLSearchParams, encodeURIComponent });
  return { h1, lead, status, box, keyEl, calls, doc };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const claim = (p) => [p.doc.title, p.h1.textContent, p.lead.textContent].filter((t) => PAID.test(t));

describe("the thanks page", () => {
  it("ships with no payment claim in its title, heading or lead", () => {
    const s = shipped();
    expect([s.title, s.h1, s.lead].filter((t) => PAID.test(t))).toEqual([]);
  });

  it("claims no payment when it was opened without a session", async () => {
    const p = page("", null);
    await settle();
    expect(p.calls).toEqual([]);
    expect(claim(p)).toEqual([]);
    expect(p.status.textContent).toMatch(/^This page needs the link Stripe opens after payment/);
    expect(p.box.hidden).toBe(true);
  });

  it("claims no payment while checkout is closed", async () => {
    const p = page(`?session=${SESSION}`, { status: 503, data: { ok: false, error: "checkout_closed" } });
    await settle();
    expect(p.calls).toHaveLength(1);
    expect(claim(p)).toEqual([]);
    expect(p.status.textContent).toMatch(/^Checkout is not open yet/);
    expect(p.box.hidden).toBe(true);
  });

  it("claims no payment for an unpaid, test, refunded or unknown session", async () => {
    for (const answer of [
      { status: 402, data: { ok: false, error: "not_paid" } },
      { status: 402, data: { ok: false, error: "test_purchase" } },
      { status: 402, data: { ok: false, error: "refunded" } },
      { status: 404, data: { ok: false, error: "not_found" } },
      { status: 502, data: { ok: false, error: "stripe_error" } },
    ]) {
      const p = page(`?session=${SESSION}`, answer);
      await settle();
      expect(claim(p), JSON.stringify(answer)).toEqual([]);
      expect(p.box.hidden).toBe(true);
    }
  });

  it("thanks the buyer and shows the key only after /api/license returned one", async () => {
    const p = page(`?session=${SESSION}`, { status: 200, data: { ok: true, key: KEY } });
    await settle();
    expect(p.calls).toEqual([`${SITE}/api/license?session=${SESSION}`]);
    expect(p.h1.textContent).toBe("Thank you");
    expect(p.lead.textContent).toMatch(/^Your payment went through Stripe\. Your key for the Time Machine web app is below\./);
    expect(p.doc.title).toBe("Thank you. Time Machine");
    expect(p.box.hidden).toBe(false);
    expect(p.keyEl.textContent).toBe(KEY);
  });
});
