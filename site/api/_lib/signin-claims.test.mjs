import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

// True claims only: the site offers sign-in to see a key again only while sign-in works. Every "Sign in" link and
// line sits in an element marked data-checkout-open, which ships hidden and is shown by assets/checkout.js only when
// /api/health says both checkout and sign-in (auth) are open. The Terms and Privacy pages never promise it.
const SITE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = readFileSync(join(SITE, "assets/checkout.js"), "utf8");

function pages(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return d.name === "api" || d.name === "assets" || d.name === "node_modules" ? [] : pages(p);
    return d.name.endsWith(".html") ? [p] : [];
  });
}

// Runs the real assets/checkout.js with /api/health answering `health`, and returns whether the marked elements show.
async function shown(health) {
  const els = [{ hidden: true }, { hidden: true }];
  const sandbox = {
    location: { protocol: "https:" },
    document: { currentScript: { src: "https://tm.example.test/assets/checkout.js" }, querySelectorAll: () => els },
    fetch: async () => ({ ok: true, json: async () => health }),
    URL,
    Promise,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(SCRIPT, sandbox);
  await sandbox.window.tmHealth;
  await new Promise((resolve) => setTimeout(resolve, 0));
  return els.every((el) => !el.hidden);
}

describe("sign-in claims", () => {
  it("shows the sign-in links only when /api/health says checkout and sign-in are both open", async () => {
    expect(await shown({ ok: true, checkout: true, auth: true })).toBe(true);
    expect(await shown({ ok: true, checkout: true, auth: false })).toBe(false);
    expect(await shown({ ok: true, checkout: false, auth: true })).toBe(false);
    expect(await shown({ ok: true, checkout: true })).toBe(false);
    expect(await shown(null)).toBe(false);
  });

  it.each(pages(SITE).filter((f) => !f.endsWith("account.html")).map((f) => [relative(SITE, f), f]))("%s links to sign-in only inside hidden data-checkout-open elements", (_page, file) => {
    const html = readFileSync(file, "utf8");
    for (const m of html.matchAll(/<(\w+)\b([^>]*\bdata-checkout-open\b[^>]*)>/g)) expect(m[2]).toMatch(/\bhidden\b/);
    const rest = html.replace(/<(\w+)\b[^>]*\bdata-checkout-open\b[^>]*>[\s\S]*?<\/\1>/g, "");
    expect(rest).not.toMatch(/href="\/?account(\.html)?"/);
    expect(rest).not.toMatch(/sign in at/i);
  });
});
