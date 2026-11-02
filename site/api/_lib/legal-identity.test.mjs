import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { apply, loadIdentity, problems } from "../../../scripts/apply-legal-identity.mjs";

// Going live means three facts change at once: who sells, which mailbox answers, and that the Terms and Privacy
// Policy are no longer drafts. scripts/apply-legal-identity.mjs makes that one reviewed step. These tests run it on a
// copy of the repo and check the result says no DRAFT anywhere, names no person's address, and moves every consent
// version together, so the agree boxes, the server and the app keep recording the same version.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PARTS = ["site", "apps/web/src", "apps/web/test", "docs/legal", "packages/cli/package.json", "plugins", ".claude-plugin"];
const work = mkdtempSync(join(tmpdir(), "legal-id-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

function copyRepo() {
  const dest = mkdtempSync(join(work, "repo-"));
  for (const p of PARTS) cpSync(join(ROOT, p), join(dest, p), { recursive: true, filter: (src) => !src.includes("node_modules") });
  return dest;
}
function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === "node_modules" ? [] : files(p)) : [p];
  });
}
const textOf = (root, sub) => files(join(root, sub)).filter((f) => /\.(html|js|mjs|ts|json|md)$/.test(f)).map((f) => [f.slice(root.length + 1), readFileSync(f, "utf8")]);

const LIVE = { seller: "Example Seller LLC & Co", supportEmail: "support@example.com", final: true, lastUpdated: "3 November 2026",
  termsVersion: "terms-2026-11-03", privacyVersion: "privacy-2026-11-03" };

describe("legal identity", () => {
  it("is empty on main, so the site claims no seller, no new mailbox and no final terms before Preston decides", () => {
    expect(loadIdentity(ROOT)).toEqual({ seller: null, supportEmail: null, final: false, lastUpdated: null, termsVersion: null, privacyVersion: null });
    expect(apply(loadIdentity(ROOT), { root: ROOT, write: false })).toEqual([]);
  });

  it("refuses a config that would publish something half done", () => {
    expect(problems({ ...LIVE, seller: null })).toContain("final needs seller and supportEmail");
    expect(problems({ ...LIVE, supportEmail: "preston@unvibe.site" })).toContain("supportEmail must not be a person's own address");
    expect(problems({ ...LIVE, seller: "<b>x</b>" })).toContain("seller must be a plain one-line name");
    expect(problems({ ...LIVE, termsVersion: "terms-2026-10-31b".slice(0, 6) })).toHaveLength(1);
    expect(problems(LIVE)).toEqual([]);
  });

  it("on a copy of the repo: no DRAFT, no [Operator], no personal address, one consent version everywhere", () => {
    const root = copyRepo();
    const report = apply(LIVE, { root });
    expect(report.map((r) => r.name)).toContain("draft bar");
    const all = [...textOf(root, "site"), ...textOf(root, "apps/web/src"), ...textOf(root, "plugins"), ...textOf(root, ".claude-plugin"),
      ["packages/cli/package.json", readFileSync(join(root, "packages/cli/package.json"), "utf8")]];
    for (const [f, t] of all) {
      if (f.startsWith("site/legal-identity.json") || /\.test\.(mjs|ts)$/.test(f)) continue;
      expect(t, f).not.toContain("preston@unvibe.site");
      // buy.js keeps its "not open yet" message: it only shows while /api/health says checkout is off.
      expect(t, f).not.toMatch(/\(draft\)|DRAFT\.|draft-tag|Draft, pending lawyer review|\[Operator\]/);
    }
    const terms = readFileSync(join(root, "site/terms.html"), "utf8");
    expect(terms).toContain("between you and Example Seller LLC &amp; Co (\"we\")");
    expect(terms).toContain("Last updated: 3 November 2026.");
    expect(terms).not.toContain("nothing is for sale today");
    // Sign-in is still off: its sentence stays, only the draft words go.
    expect(readFileSync(join(root, "site/privacy.html"), "utf8")).toContain("<strong>Sign-in is not open yet.</strong> ");
    for (const f of ["apps/web/src/shared/agreement.ts", "site/api/_lib/agreement.js", "site/assets/buy.js", "site/account.html"]) {
      const t = readFileSync(join(root, f), "utf8");
      expect(t, f).toContain("terms-2026-11-03");
      expect(t, f).toContain("privacy-2026-11-03");
      expect(t, f).not.toMatch(/terms-2026-10-|privacy-2026-10-/);
    }
    expect(readFileSync(join(root, "docs/legal/TERMS.md"), "utf8")).toMatch(/^# Time Machine Terms of Service\n\nLast updated: 3 November 2026\.\n/);
  });

  it("writes nothing when a rule finds less than it should", () => {
    const root = copyRepo();
    const before = readFileSync(join(root, "site/terms.html"), "utf8");
    rmSync(join(root, "site/privacy.html"));
    cpSync(join(root, "site/index.html"), join(root, "site/privacy.html"));
    expect(() => apply(LIVE, { root })).toThrow(/matched \d+ times, expected at least/);
    expect(readFileSync(join(root, "site/terms.html"), "utf8")).toBe(before);
  });

  it("can change only the mailbox, leaving the drafts and versions alone", () => {
    const root = copyRepo();
    apply({ ...loadIdentity(ROOT), supportEmail: "support@example.com" }, { root });
    expect(readFileSync(join(root, "site/index.html"), "utf8")).not.toContain("preston@unvibe.site");
    expect(readFileSync(join(root, "site/terms.html"), "utf8")).toContain("DRAFT. Not in effect.");
    expect(readFileSync(join(root, "site/api/_lib/agreement.js"), "utf8")).toContain("terms-2026-10-31b");
  });
});
