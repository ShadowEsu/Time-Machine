import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Google sees one URL per page: every page listed in sitemap.xml exists, is not noindex, and names itself as the
// canonical (so the vercel.app mirror and the .html form both point at the clean time-machine.company URL). Every
// page that is noindex stays out of the sitemap. One <title>, one <h1>, one description per page.
const SITE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORIGIN = "https://time-machine.company";

function pages(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return d.name === "api" || d.name === "assets" || d.name === "node_modules" ? [] : pages(p);
    return d.name.endsWith(".html") ? [p] : [];
  });
}

const sitemapUrls = [...readFileSync(join(SITE, "sitemap.xml"), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const attr = (html, re) => (html.match(re) ?? [])[1];
const cleanPath = (file) => {
  const rel = "/" + relative(SITE, file).replace(/\\/g, "/").replace(/\.html$/, "");
  return rel.endsWith("/index") ? rel.slice(0, -"index".length).replace(/\/$/, "") || "/" : rel;
};
const fileFor = (url) => {
  const path = url.slice(ORIGIN.length) || "/";
  const base = join(SITE, path === "/" ? "index" : path);
  return existsSync(base + ".html") ? base + ".html" : join(base, "index.html");
};

describe("indexability", () => {
  it("lists only real, indexable pages in sitemap.xml", () => {
    expect(sitemapUrls.length).toBeGreaterThan(0);
    for (const url of sitemapUrls) {
      expect(url, "sitemap URLs use the canonical origin").toMatch(new RegExp(`^${ORIGIN}(/|$)`));
      const path = url.slice(ORIGIN.length);
      expect(path, "sitemap URLs are clean (no .html, no trailing slash)").not.toMatch(/\.html$|.\/$/);
      const f = fileFor(url);
      expect(existsSync(f), `${url} has a file`).toBe(true);
      expect(readFileSync(f, "utf8"), `${url} is not noindex`).not.toMatch(/name="robots" content="[^"]*noindex/);
    }
  });

  for (const file of pages(SITE)) {
    const rel = relative(SITE, file);
    const html = readFileSync(file, "utf8");
    const noindex = /name="robots" content="[^"]*noindex/.test(html);
    const url = ORIGIN + (cleanPath(file) === "/" ? "/" : cleanPath(file));
    it(`${rel}: one title, one h1, one description`, () => {
      expect(html.match(/<title>/g)?.length ?? 0).toBe(1);
      expect(html.match(/<h1[\s>]/g)?.length ?? 0).toBe(1);
      expect(html.match(/name="description"/g)?.length ?? 0).toBe(1);
    });
    if (noindex) {
      it(`${rel}: noindex, so not in the sitemap`, () => {
        expect(sitemapUrls).not.toContain(url);
      });
    } else {
      it(`${rel}: indexable, so in the sitemap with a self canonical and og:url`, () => {
        expect(sitemapUrls, `${url} in sitemap`).toContain(url);
        expect(attr(html, /<link rel="canonical" href="([^"]+)">/), "canonical").toBe(url);
        expect(attr(html, /<meta property="og:url" content="([^"]+)">/), "og:url").toBe(url);
      });
      it(`${rel}: JSON-LD parses, names this page, and claims no rating or review (Security rule)`, () => {
        const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
        for (const b of blocks) {
          expect(JSON.stringify(b)).not.toMatch(/aggregateRating|"review"|ratingValue/);
          if (b["@type"] === "BlogPosting") {
            expect(b.url).toBe(url);
            expect(b.mainEntityOfPage).toBe(url);
            expect(b.headline).toBe(attr(html, /<meta property="og:title" content="([^"]+)">/));
            expect(b.datePublished).toBe(attr(html, /<meta property="article:published_time" content="([^"]+)">/));
          }
        }
        if (rel.startsWith("blog/") && rel !== "blog/index.html") expect(blocks.some((b) => b["@type"] === "BlogPosting"), "post has BlogPosting").toBe(true);
      });
    }
  }
  // cleanUrls answers every *.html with a 308, so a link to one costs each click a round trip (Unvibe QA, 4 Nov).
  it("links to its own pages by clean path, never by .html", () => {
    const own = /\bhref="(?!https?:|\/\/|mailto:|#)[^"#?]*\.html[#?"]/;
    for (const file of [...pages(SITE), join(SITE, "assets", "buy.js")]) {
      const text = readFileSync(file, "utf8");
      expect(text.match(own)?.[0], `${relative(SITE, file)} links a .html path`).toBeUndefined();
      expect(text.match(/\blink\("[^"]*\.html/)?.[0], `${relative(SITE, file)} builds a .html link`).toBeUndefined();
    }
  });
});
