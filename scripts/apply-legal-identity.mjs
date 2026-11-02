#!/usr/bin/env node
// Applies the seller name, the support mailbox and the end of the DRAFT label in one step, from site/legal-identity.json.
//
//   1. Fill site/legal-identity.json: seller, supportEmail, final (true drops every DRAFT marker), lastUpdated
//      ("3 November 2026"), termsVersion and privacyVersion (new consent versions, e.g. "terms-2026-11-03").
//   2. node scripts/apply-legal-identity.mjs        rewrites the files and prints what changed
//      node scripts/apply-legal-identity.mjs --check  changes nothing; fails if any rule would match 0 times
//   3. Run the site tests, review the diff, open the PR.
//
// Every rule must match at least once (or exactly as many times as it says), so a renamed file or reworded line
// stops the script instead of leaving a stale DRAFT label or a personal address on the live site.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OLD_EMAIL = "preston@unvibe.site";

export function loadIdentity(root = ROOT) {
  return JSON.parse(readFileSync(join(root, "site/legal-identity.json"), "utf8"));
}

const escHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Checks the config; returns a list of problems (empty when it can be applied). */
export function problems(id) {
  const out = [];
  if (id.seller !== null && (typeof id.seller !== "string" || !id.seller.trim() || /[<>\n]/.test(id.seller))) out.push("seller must be a plain one-line name");
  if (id.supportEmail !== null && !/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(id.supportEmail ?? "")) out.push("supportEmail must be an email address");
  if (id.supportEmail === OLD_EMAIL) out.push("supportEmail must not be a person's own address");
  if (id.final) {
    if (!id.seller || !id.supportEmail) out.push("final needs seller and supportEmail");
    if (!/^\d{1,2} [A-Z][a-z]+ 20\d\d$/.test(id.lastUpdated ?? "")) out.push('final needs lastUpdated like "3 November 2026"');
    if (!/^terms-20\d\d-\d\d-\d\d[a-z]?$/.test(id.termsVersion ?? "")) out.push("final needs termsVersion like terms-2026-11-03");
    if (!/^privacy-20\d\d-\d\d-\d\d[a-z]?$/.test(id.privacyVersion ?? "")) out.push("final needs privacyVersion like privacy-2026-11-03");
  }
  return out;
}

const SITE_PAGES = ["site/index.html", "site/how-it-works.html", "site/security.html", "site/company.html", "site/changelog.html", "site/story.html",
  "site/account.html", "site/thanks.html", "site/terms.html", "site/privacy.html", "site/blog/index.html",
  "site/blog/a-save-point-should-prove-it-works.html", "site/blog/building-in-the-open.html", "site/blog/rewind-does-not-cover-the-shell.html",
  "site/blog/what-time-machine-does-not-do.html", "site/blog/why-a-safety-net-makes-people-braver.html"];
const EMAIL_FILES = [...SITE_PAGES, "site/assets/account.js", "site/assets/buy.js", "site/assets/thanks.js", "site/assets/waitlist.js",
  "packages/cli/package.json", "plugins/time-machine/.claude-plugin/plugin.json", ".claude-plugin/marketplace.json", "docs/legal/PRIVACY.md"];
const LEGAL = ["site/terms.html", "site/privacy.html"];
// Places that name the legal pages: every page footer, the agree boxes (site and app) and the tests that read them.
const LABEL_FILES = [...SITE_PAGES, "site/assets/buy.js", "apps/web/src/renderer/plan.ts", "apps/web/test/plan.test.ts",
  "site/api/auth.test.mjs", "site/api/checkout.test.mjs"];
const VERSION_FILES = ["apps/web/src/shared/agreement.ts", "site/api/_lib/agreement.js", "site/assets/buy.js", "site/account.html"];

/** The rules, in order. `min` is the least number of matches the rule must find across its files. */
export function rules(id) {
  const r = [];
  if (id.supportEmail) {
    r.push({ name: "support mailbox", files: EMAIL_FILES, find: OLD_EMAIL, replace: id.supportEmail, min: 30 });
    r.push({ name: "contact (docs)", files: ["docs/legal/PRIVACY.md"], find: "[Contact]", replace: id.supportEmail, min: 1 });
  }
  if (id.seller) {
    r.push({ name: "seller (site)", files: LEGAL, find: '<span class="ph">[Operator]</span>', replace: escHtml(id.seller), min: 2 });
    r.push({ name: "seller (docs)", files: ["docs/legal/TERMS.md", "docs/legal/PRIVACY.md"], find: "[Operator]", replace: id.seller, min: 2 });
  }
  if (id.final) {
    r.push(
      { name: "draft bar", files: LEGAL, find: '<aside class="draftbar" aria-label="Draft notice">DRAFT. Not in effect.</aside>\n', replace: "", min: 2 },
      { name: "draft banner line", files: LEGAL, find: "      <strong>DRAFT. Not in effect. Needs lawyer review.</strong>\n", replace: "", min: 2 },
      { name: "titles", files: LEGAL, find: /(Terms of Service|Privacy Policy) \(draft\)\. Time Machine/g, replace: "$1. Time Machine", min: 4 },
      { name: "descriptions", files: LEGAL, find: /Draft (Terms of Service|Privacy Policy) for Time Machine\. Not in effect\. Needs lawyer review\./g, replace: "$1 for Time Machine.", min: 4 },
      { name: "section tags", files: LEGAL, find: / <span class="tag tag-plan draft-tag">Draft<\/span>/g, replace: "", min: 4 },
      { name: "section notes", files: LEGAL, find: /<strong>Draft, pending lawyer review\.( Sign-in is not open yet\.)?( Checkout is not open yet(, so nothing is for sale today)?\.)?<\/strong> /g,
        replace: (_m, signin) => (signin ? `<strong>${signin.trim()}</strong> ` : ""), min: 4 },
      { name: "link labels", files: LABEL_FILES, find: /\b(Terms|Privacy Policy|Privacy|privacy policy) \(draft\)/g, replace: "$1", min: 40 },
      { name: "last updated", files: LEGAL, find: /Last updated: \d{1,2} [A-Z][a-z]+ 20\d\d\./g, replace: `Last updated: ${id.lastUpdated}.`, min: 2 },
      { name: "docs draft line", files: ["docs/legal/TERMS.md", "docs/legal/PRIVACY.md"], find: "**DRAFT. Not in effect. Needs lawyer review.** Last updated: [date].", replace: `Last updated: ${id.lastUpdated}.`, min: 2 },
      { name: "terms version", files: VERSION_FILES, find: /terms-20\d\d-\d\d-\d\d[a-z]?/g, replace: id.termsVersion, min: 4 },
      { name: "privacy version", files: VERSION_FILES, find: /privacy-20\d\d-\d\d-\d\d[a-z]?/g, replace: id.privacyVersion, min: 4 },
    );
  }
  return r;
}

const count = (text, find) => (typeof find === "string" ? text.split(find).length - 1 : (text.match(find) ?? []).length);

/** Applies the rules under `root`. Returns [{ name, matches }]; throws (writing nothing) if a rule falls short. */
export function apply(id, { root = ROOT, write = true } = {}) {
  const bad = problems(id);
  if (bad.length) throw new Error(`legal-identity.json: ${bad.join("; ")}`);
  const texts = new Map();
  const read = (f) => texts.get(f) ?? readFileSync(join(root, f), "utf8");
  const report = [];
  for (const rule of rules(id)) {
    let total = 0;
    for (const f of rule.files) {
      const before = read(f);
      const n = count(before, rule.find);
      if (!n) continue;
      total += n;
      texts.set(f, typeof rule.find === "string" ? before.split(rule.find).join(rule.replace) : before.replace(rule.find, rule.replace));
    }
    if (total < rule.min) throw new Error(`rule "${rule.name}" matched ${total} times, expected at least ${rule.min}; nothing was written`);
    report.push({ name: rule.name, matches: total });
  }
  if (write) for (const [f, t] of texts) writeFileSync(join(root, f), t);
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const id = loadIdentity();
  const write = !process.argv.includes("--check");
  const report = apply(id, { write });
  for (const r of report) console.log(`${r.name}: ${r.matches}`);
  console.log(report.length ? (write ? "written" : "check only, nothing written") : "legal-identity.json is empty: nothing to apply");
}
