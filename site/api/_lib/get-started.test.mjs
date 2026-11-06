import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// /get-started is where "Install from source" lands. Its Copy button must copy exactly the install.md command (the
// CLI is not on npm, so a stale command there fails people's first step), the page can't rely on inline script (the
// CSP allows only files from the site), and the home button must reach it.
const SITE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => readFileSync(join(SITE, f), "utf8");
const page = read("get-started.html");
const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
// What copy.js puts on the clipboard: the target's text, trailing whitespace trimmed.
const copied = (id) => {
  const m = page.match(new RegExp(`<(pre|p)\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</\\1>`));
  expect(m, `#${id} exists`).toBeTruthy();
  expect(page, `a Copy button for #${id}`).toMatch(new RegExp(`<button\\b[^>]*data-copy="${id}"`));
  return decode((m?.[2] ?? "").replace(/<[^>]+>/g, "")).replace(/\s+$/, "");
};

describe("get-started page", () => {
  it("copies the exact install command from install.md", () => {
    const section = read("install.md").split("## 1. Install from source")[1] ?? "";
    const cmd = (section.match(/```sh\n([\s\S]*?)```/) ?? [])[1]?.replace(/\s+$/, "");
    expect(cmd).toContain("npm install -g ./packages/cli");
    expect(copied("gs-install")).toBe(cmd);
  });

  it("copies tm ui, and the home page's Claude Code prompt on the vercel.app host (Security SHOULD-TD3)", () => {
    expect(copied("gs-ui")).toBe("tm ui");
    const home = (read("index.html").match(/<p id="agent-prompt"[^>]*>([^<]*)<\/p>/) ?? [])[1];
    expect(home).toContain("https://time-machine.company/install.md");
    expect(copied("gs-agent")).toBe(decode(home ?? "").replace("https://time-machine.company/", "https://time-machine-site.vercel.app/"));
  });

  it("has no inline script and loads copy.js", () => {
    const scripts = [...page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    for (const [, attrs, body] of scripts) {
      expect(attrs, "every script is a file").toMatch(/\bsrc="assets\/[a-z-]+\.js"/);
      expect(body.trim()).toBe("");
    }
    expect(page).toContain('<script src="assets/copy.js" defer></script>');
    expect(page).not.toMatch(/\son[a-z]+="/);
  });

  it("is where the home page's Install from source goes, and its FAQ link has a target", () => {
    const home = read("index.html");
    expect(home).toMatch(/<a href="\/get-started">Install from source<\/a>/);
    expect(existsSync(join(SITE, "get-started.html"))).toBe(true);
    expect(page).toContain('<a href="/#faq">');
    expect(home).toMatch(/\bid="faq"/);
  });
});
