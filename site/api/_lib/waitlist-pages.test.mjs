import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FEEDBACK_CONSENT_VERSION, WAITLIST_CONSENT_VERSION } from "./waitlist.js";

// Consent is only what the person ticked (ledger 299, Security T1): every waitlist form on the site carries its own
// unticked, required consent box. waitlist.js refuses to send from a form without one.
const SITE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function pages(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return d.name === "api" || d.name === "assets" || d.name === "node_modules" ? [] : pages(p);
    return d.name.endsWith(".html") ? [p] : [];
  });
}

const forms = pages(SITE).flatMap((file) =>
  [...readFileSync(file, "utf8").matchAll(/<form\b[^>]*\bdata-waitlist\b[^>]*>([\s\S]*?)<\/form>/g)].map((m) => ({ page: relative(SITE, file), body: m[1] ?? "" })),
);

describe("waitlist forms", () => {
  it("exist on the home page and the other pages", () => {
    expect(forms.map((f) => f.page)).toContain("index.html");
    expect(forms.length).toBeGreaterThan(1);
  });

  it.each(forms.map((f) => [f.page, f.body]))("%s has one unticked, required consent box that names what it is for", (_page, body) => {
    const boxes = [...body.matchAll(/<input\b[^>]*\bname="consent"[^>]*>/g)].map((m) => m[0]);
    expect(boxes).toHaveLength(1);
    const box = boxes[0] ?? "";
    expect(box).toContain('type="checkbox"');
    expect(box).toMatch(/\brequired\b/);
    expect(box).not.toMatch(/\bchecked\b/);
    // The value is the wording's version the server accepts, so a tick is recorded against these words (T2).
    expect(box).toContain(`value="${WAITLIST_CONSENT_VERSION}"`);
    expect(body).toMatch(/<label class="wl-consent"><input\b[^>]*name="consent"[^>]*><span>Email me when the CLI is on npm\. Nothing else\.<\/span><\/label>/);
  });

  it.each(forms.map((f) => [f.page, f.body]))("%s has a second, separate, unticked and optional feedback box after the npm box", (_page, body) => {
    const boxes = [...body.matchAll(/<input\b[^>]*\bname="feedback"[^>]*>/g)].map((m) => m[0]);
    expect(boxes).toHaveLength(1);
    const box = boxes[0] ?? "";
    expect(box).toContain('type="checkbox"');
    expect(box).not.toMatch(/\brequired\b/);
    expect(box).not.toMatch(/\bchecked\b/);
    expect(box).toContain(`value="${FEEDBACK_CONSENT_VERSION}"`);
    const label = /<label class="wl-consent"><input\b[^>]*name="feedback"[^>]*><span>You may email me to ask for feedback\.<\/span><\/label>/;
    expect(body).toMatch(label);
    // Its own label, after the npm box's, never inside it.
    expect(body.search(label)).toBeGreaterThan(body.indexOf('name="consent"'));
  });
});
