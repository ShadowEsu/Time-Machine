import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

// The links to the pricing section ask for a payment ("Pay once") only while something is for sale. Runs the real
// site/assets/checkout.js against the pricing links as they ship in each page, with /api/health answering `health`.
const SCRIPT = readFileSync(new URL("../assets/checkout.js", import.meta.url), "utf8");
const PAGES = ["index.html", "thanks.html", "account.html"];

const strip = (html) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

// Every link to the pricing section in a page, as shipped: its attributes and its text. Links inside data-checkout-open
// elements are left out: they ship hidden and show only once checkout and sign-in are open (sign-in-claims test).
function pricingLinks(file) {
  const html = readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace(/<(\w+)\b[^>]*\bdata-checkout-open\b[^>]*>[\s\S]*?<\/\1>/g, "");
  return [...html.matchAll(/<a\b([^>]*\bhref="(?:index\.html)?#pricing"[^>]*)>([\s\S]*?)<\/a>/g)].map((m) => {
    const attrs = {};
    for (const a of m[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? "";
    return { attrs, text: strip(m[2]) };
  });
}

// `health` is what /api/health answered (null: it could not be read); `undefined` is the page with no script.
async function labels(file, health) {
  const els = pricingLinks(file).map((l) => ({
    hidden: false,
    textContent: l.text,
    getAttribute: (name) => (Object.hasOwn(l.attrs, name) ? l.attrs[name] : null),
    matches: (selector) => selector === "[data-open-label]" && Object.hasOwn(l.attrs, "data-open-label"),
  }));
  if (health !== undefined) {
    const sandbox = {
      location: { protocol: "https:" },
      document: { currentScript: { src: "https://tm.example.test/assets/checkout.js" }, querySelectorAll: (s) => els.filter((el) => el.matches(s)) },
      fetch: async () => ({ ok: true, json: async () => health }),
      URL,
      Promise,
    };
    sandbox.window = sandbox;
    vm.runInNewContext(SCRIPT, sandbox);
    await sandbox.window.tmHealth;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return els.map((el) => el.textContent);
}

describe("links to the pricing section", () => {
  it.each(PAGES)("%s has one", (file) => {
    expect(pricingLinks(file).length).toBeGreaterThan(0);
  });

  it.each(PAGES.flatMap((file) => [
    [file, "checkout is closed", { ok: true, checkout: false, auth: false }],
    [file, "/api/health can't be read", null],
    [file, "the page runs without JavaScript", undefined],
  ]))("%s: while %s, none asks for a payment", async (file, _state, health) => {
    for (const text of await labels(file, health)) expect(text).not.toMatch(/\bpay\b|\bbuy\b/i);
  });

  it.each(PAGES)("%s: once checkout is open, the header and footer links say Pay once", async (file) => {
    const open = await labels(file, { ok: true, checkout: true, auth: false });
    const marked = pricingLinks(file).map((l) => Object.hasOwn(l.attrs, "data-open-label"));
    expect(marked.some(Boolean)).toBe(true);
    open.forEach((text, i) => { if (marked[i]) expect(text).toBe("Pay once"); });
  });
});
