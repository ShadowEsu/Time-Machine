// Sources: which well-known synced and local folders exist on this computer. Fixed paths under the home
// folder are checked with stat only; ~/Library/CloudStorage is listed once, by name. No file is read.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import * as tm from "@timetm/core";
import { tempDir } from "../../../fixtures/demo/setup.ts";

describe("sources", () => {
  test("an empty home finds nothing and names where each folder usually is", () => {
    const home = tempDir("home-empty");
    const rows = tm.sources({ HOME: home });
    expect(rows.map((r) => r.id)).toEqual(["icloud", "dropbox", "gdrive", "onedrive", "obsidian", "documents", "desktop"]);
    expect(rows.every((r) => !r.found)).toBe(true);
    expect(rows.find((r) => r.id === "icloud")?.path).toBe(join(home, "Library/Mobile Documents/com~apple~CloudDocs"));
    expect(rows.find((r) => r.id === "documents")).toEqual({ id: "documents", label: "Documents", path: join(home, "Documents"), found: false });
  });

  test("finds iCloud, Obsidian in iCloud, cloud drives by name in CloudStorage, Documents and Desktop", () => {
    const home = tempDir("home-full");
    for (const d of [
      "Library/Mobile Documents/com~apple~CloudDocs",
      "Library/Mobile Documents/iCloud~md~obsidian",
      "Library/CloudStorage/GoogleDrive-you@example.com",
      "Library/CloudStorage/OneDrive-Personal",
      "Library/CloudStorage/Dropbox",
      "Documents",
      "Desktop",
    ]) mkdirSync(join(home, d), { recursive: true });
    // A file with a matching name is not a folder.
    writeFileSync(join(home, "Library/CloudStorage/OneDrive-Notes.txt"), "x");
    const byId = Object.fromEntries(tm.sources({ HOME: home }).map((r) => [r.id, r]));
    expect(byId.icloud).toMatchObject({ label: "iCloud Drive", found: true });
    expect(byId.obsidian).toMatchObject({ label: "Obsidian", found: true, path: join(home, "Library/Mobile Documents/iCloud~md~obsidian") });
    expect(byId.gdrive).toMatchObject({ label: "Google Drive", found: true, path: join(home, "Library/CloudStorage/GoogleDrive-you@example.com") });
    expect(byId.onedrive).toMatchObject({ found: true, path: join(home, "Library/CloudStorage/OneDrive-Personal") });
    expect(byId.dropbox).toMatchObject({ found: true, path: join(home, "Library/CloudStorage/Dropbox") });
    expect(byId.documents).toMatchObject({ found: true });
    expect(byId.desktop).toMatchObject({ found: true });
  });

  test("prefers ~/Dropbox and ~/Documents/Obsidian when they exist", () => {
    const home = tempDir("home-classic");
    mkdirSync(join(home, "Dropbox"), { recursive: true });
    mkdirSync(join(home, "Documents/Obsidian"), { recursive: true });
    const byId = Object.fromEntries(tm.sources({ HOME: home }).map((r) => [r.id, r]));
    expect(byId.dropbox).toMatchObject({ found: true, path: join(home, "Dropbox") });
    expect(byId.obsidian).toMatchObject({ found: true, path: join(home, "Documents/Obsidian") });
    expect(byId.icloud?.found).toBe(false);
  });
});
