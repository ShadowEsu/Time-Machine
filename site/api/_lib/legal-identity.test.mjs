import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { PRIVACY_VERSION, TERMS_VERSION } from "./agreement.js";

// Money is taken under these pages, so they must name the seller, point buyers at the support mailbox (never a
// person's own address), carry no DRAFT label, and record one consent version everywhere a box is ticked.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const files = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? (n === "node_modules" ? [] : files(p)) : /\.(html|js|mjs|ts|json|md)$/.test(n) && !/\.test\.(mjs|ts)$/.test(n) ? [p] : [];
});
const SHIPPED = [...files(join(ROOT, "site")), ...files(join(ROOT, "apps/web/src")), ...files(join(ROOT, "plugins")), ...files(join(ROOT, ".claude-plugin")),
  join(ROOT, "packages/cli/package.json"), join(ROOT, "docs/legal/TERMS.md"), join(ROOT, "docs/legal/PRIVACY.md")];

it("no shipped file shows a personal address, a DRAFT label or an [Operator] placeholder", () => {
  for (const f of SHIPPED) {
    const t = readFileSync(f, "utf8");
    expect(t, f).not.toContain("preston@unvibe.site");
    // buy.js keeps its "nothing is for sale today" message: it only shows while /api/health says checkout is off.
    expect(t, f).not.toMatch(/\(draft\)|DRAFT\.|draft-tag|Draft, pending lawyer review|\[Operator\]|\[Contact\]/);
  }
});

it("the pages a buyer reads around a purchase never call the terms a draft", () => {
  for (const f of ["site/terms.html", "site/privacy.html", "site/thanks.html", "site/account.html", "site/assets/buy.js"]) {
    expect(readFileSync(join(ROOT, f), "utf8"), f).not.toMatch(/draft/i);
  }
});

it("the Terms name the seller and the support mailbox", () => {
  const terms = readFileSync(join(ROOT, "site/terms.html"), "utf8");
  expect(terms).toContain('between you and Unvibe ("we")');
  expect(terms).toContain("mailto:support@unvibe.site");
});

it("every agree box records the same consent versions as the server", () => {
  for (const f of ["apps/web/src/shared/agreement.ts", "site/assets/buy.js", "site/account.html"]) {
    const t = readFileSync(join(ROOT, f), "utf8");
    expect(t, f).toContain(TERMS_VERSION);
    expect(t, f).toContain(PRIVACY_VERSION);
    expect([...t.matchAll(/(terms|privacy)-20\d\d-\d\d-\d\d[a-z]?/g)].map((m) => m[0]).sort(), f).toEqual(
      [...t.matchAll(/(terms|privacy)-20\d\d-\d\d-\d\d[a-z]?/g)].map((m) => (m[1] === "terms" ? TERMS_VERSION : PRIVACY_VERSION)).sort());
  }
});
