import { describe, expect, test } from "vitest";
import type { ProjectEntry, SourceRow } from "../src/shared/api.ts";
import { homePath, PLANNED_SOURCES, protectedIn, SOURCE_PURPOSE, sourcesPage, type SourcesInput } from "../src/renderer/sources.ts";

const rows: SourceRow[] = [
  { id: "icloud", label: "iCloud Drive", path: "/Users/you/Library/Mobile Documents/com~apple~CloudDocs", found: true },
  { id: "dropbox", label: "Dropbox", path: "/Users/you/Dropbox", found: false },
  { id: "documents", label: "Documents", path: "/Users/you/Documents", found: true },
];
const project = (name: string, path: string, kind: ProjectEntry["kind"] = "folder"): ProjectEntry => ({
  id: "0b8f2f5e-3f7c-4a59-9a43-1d2f6c1b2a10", path, name, addedAt: "2026-10-24T00:00:00Z", demo: false, features: { ask: false, vercel: null, autoSave: "off" }, kind, purpose: "documents",
});
const input = (over: Partial<SourcesInput> = {}): SourcesInput => ({
  projects: [project("thesis-notes", "/Users/you/Documents/thesis-notes")], sources: rows, claude: null, labs: false, platform: "darwin", agentMark: (n) => `<i>${n}</i>`, ...over,
});

describe("Sources", () => {
  test("lists the built connectors, then each found folder with Protect a folder here, and names the ones not found", () => {
    const html = sourcesPage(input());
    for (const built of ["Git projects", "Folders", "Claude Code", "Vercel deploys"]) expect(html).toContain(built);
    expect(html).toContain("It never deploys, promotes or rolls back anything.");
    expect(html).toContain("On this Mac");
    expect(html.match(/data-act="source-add"/g)).toHaveLength(2);
    expect(html).toContain('data-path="/Users/you/Documents"');
    expect(html).toContain("Protected here: thesis-notes");
    expect(html).toContain("Not found here: Dropbox.");
    expect(sourcesPage(input({ platform: "linux" }))).toContain("On this computer");
  });

  test("planned connectors show only under Labs preview, each labelled Planned, not connected, with sample data", () => {
    const off = sourcesPage(input());
    expect(off).not.toContain("Planned, not connected");
    expect(off).toContain('aria-checked="false"');
    const on = sourcesPage(input({ labs: true }));
    expect(on.match(/Planned, not connected/g)).toHaveLength(PLANNED_SOURCES.length);
    expect(PLANNED_SOURCES.map((p) => p.name)).toEqual(["Codex", "Gemini", "Google Docs", "Notion", "Gmail", "Slack"]);
    expect(on).toContain("Not real data.");
    // A preview never offers to connect or sign in.
    expect(on).not.toMatch(/sign in|connect now|oauth|api key/i);
  });

  test("a folder counts as protected inside a source only at or under its path", () => {
    const docs = rows[2]!;
    expect(protectedIn(docs, [project("a", "/Users/you/Documents"), project("b", "/Users/you/Documents/b"), project("c", "/Users/you/DocumentsOld/c")])).toEqual(["a", "b"]);
  });

  test("a path shows ~ for home, whole, in one element that wraps, with the full path in its title", () => {
    expect(homePath("/Users/you/Library/Mobile Documents/com~apple~CloudDocs")).toBe("~/Library/Mobile Documents/com~apple~CloudDocs");
    expect(homePath("/home/you/Dropbox")).toBe("~/Dropbox");
    expect(homePath("/Volumes/Work/notes")).toBe("/Volumes/Work/notes");
    const html = sourcesPage(input());
    expect(html).toContain('<span class="mono so-path" title="/Users/you/Library/Mobile Documents/com~apple~CloudDocs">~/Library/Mobile Documents/com~apple~CloudDocs</span>');
  });

  test("Protect a folder here starts on the purpose that fits: notes and cloud folders are documents, the Desktop asks", () => {
    expect(SOURCE_PURPOSE.obsidian).toBe("documents");
    expect(SOURCE_PURPOSE.documents).toBe("documents");
    expect(SOURCE_PURPOSE.icloud).toBe("documents");
    expect(SOURCE_PURPOSE.desktop).toBeNull();
  });

  test("a failed look says so instead of an empty list", () => {
    expect(sourcesPage(input({ sources: "error" }))).toContain("We couldn’t look for these folders right now.");
  });
});
