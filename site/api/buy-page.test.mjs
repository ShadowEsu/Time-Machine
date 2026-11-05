import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { FREE_PROJECT_LIMIT } from "../../packages/core/src/license.ts";

// Runs the real site/assets/buy.js against a small stand-in for the pricing card in site/index.html, and reads what a
// visitor would see in each /api/health state. The card's elements and their shipped text come from index.html.
const SCRIPT = readFileSync(new URL("../assets/buy.js", import.meta.url), "utf8");
const PAGE = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const SITE = "https://time-machine-site.vercel.app";

const strip = (html) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

// Every [data-buy-closed] element in the card, with its text and whether it ships hidden.
function closedNotes() {
  return [...PAGE.matchAll(/<(\w+)\b([^>]*\bdata-buy-closed\b[^>]*)>([\s\S]*?)<\/\1>/g)].map((m) => ({ hidden: /\bhidden\b/.test(m[2]), text: strip(m[3]) }));
}

function buyButton() {
  const m = PAGE.match(/<button\b([^>]*\bdata-buy\b[^>]*)>([\s\S]*?)<\/button>/);
  if (!m) throw new Error("index.html has no Buy button");
  return { hidden: /\bhidden\b/.test(m[1]), disabled: /\bdisabled\b/.test(m[1]), text: strip(m[2]) };
}

class El {
  constructor(init = {}) {
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
    this.children = [];
    this.attrs = {};
    Object.assign(this, init);
  }
  appendChild(child) { this.children.push(child); return child; }
  insertBefore(child) { this.children.push(child); return child; }
  addEventListener() {}
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null; }
  removeAttribute(name) { delete this.attrs[name]; }
  focus() {}
}

const text = (el) => [el.textContent, ...el.children.map(text)].join("");

// `health` is what /api/health answered (null: it could not be read); `undefined` runs the card as it ships, no script.
async function card(health) {
  const notes = closedNotes().map((n) => new El({ hidden: n.hidden, textContent: n.text }));
  const shipped = buyButton();
  const button = new El({ hidden: shipped.hidden, disabled: shipped.disabled, textContent: shipped.text });
  const status = new El();
  const parent = new El();
  button.parentNode = parent;
  if (health !== undefined) {
    const document = {
      currentScript: { src: `${SITE}/assets/buy.js` },
      querySelector: (s) => (s === "button[data-buy]" ? button : s === "[data-buy-status]" ? status : null),
      querySelectorAll: (s) => (s === "[data-buy-closed]" ? notes : []),
      createElement: () => new El(),
      createTextNode: (t) => new El({ textContent: t }),
    };
    const context = { document, location: { protocol: "https:", href: `${SITE}/` }, URL, fetch: async () => ({ status: 500, json: async () => ({}) }) };
    context.window = { tmHealth: Promise.resolve(health) };
    vm.runInNewContext(SCRIPT, context);
    await new Promise((resolve) => setImmediate(resolve));
  }
  const agree = parent.children[0];
  const visible = [...notes.filter((n) => !n.hidden), ...(button.hidden ? [] : [button]), status, ...(agree && !agree.hidden ? [agree] : [])];
  return { button, agree, notes, words: visible.map(text).join(" ").replace(/\s+/g, " ").trim() };
}

describe("the pricing card", () => {
  it.each([
    ["checkout is closed", { ok: true, checkout: false }],
    ["the page runs without JavaScript", undefined],
  ])("while %s: no Buy button, no promise of a date, and the free limit the app enforces", async (_state, health) => {
    const c = await card(health);
    expect(c.button.hidden).toBe(true);
    expect(c.notes.some((n) => !n.hidden)).toBe(true);
    expect(c.words).not.toMatch(/\bsoon\b|opens on|coming/i);
    expect(c.words).toMatch(new RegExp(`\\b${FREE_PROJECT_LIMIT} projects\\b`));
  });

  it("once checkout is open: the closed note goes, and the Buy button and the agreement box show", async () => {
    const c = await card({ ok: true, checkout: true });
    expect(c.notes.every((n) => n.hidden)).toBe(true);
    expect(c.button.hidden).toBe(false);
    expect(c.button.disabled).toBe(false);
    expect(c.agree.hidden).toBe(false);
    expect(c.words).toMatch(/\$50/);
  });

  it("when /api/health can't be read: the Buy button shows, so a click can say what went wrong", async () => {
    const c = await card(null);
    expect(c.button.hidden).toBe(false);
    expect(c.notes.every((n) => n.hidden)).toBe(true);
  });
});
