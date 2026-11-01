import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// One refund rule (Security, 31 Oct): a full refund within 14 days, then only where the law requires. The site's Terms
// and their source in docs/legal/TERMS.md say the same thing, and both say what a refund does to the key.
const HTML = readFileSync(new URL("../../terms.html", import.meta.url), "utf8");
const MD = readFileSync(new URL("../../../docs/legal/TERMS.md", import.meta.url), "utf8");
const htmlRefund = HTML.match(/<li><strong>Refund\.<\/strong>([\s\S]*?)<\/li>/)?.[1] ?? "";
const mdRefund = MD.match(/\*\*Refunds\.\*\*([^\n]*)/)?.[1] ?? "";
const text = (html) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

describe("Terms refund rule", () => {
  it.each([["site/terms.html", () => text(htmlRefund)], ["docs/legal/TERMS.md", () => mdRefund]])("%s states one rule and what a refund does to the key", (_where, get) => {
    const words = get();
    expect(words).toMatch(/within 14 days/);
    expect(words).toMatch(/After that, payments are not refundable except where the law says otherwise\./);
    expect(words).not.toMatch(/activate/i);
    expect(words).toMatch(/Once a purchase is refunded, the website no longer shows its key\./);
    expect(words).toMatch(/A key already saved on a computer keeps working, because keys are checked on that computer and cannot be taken back\./);
  });
});
