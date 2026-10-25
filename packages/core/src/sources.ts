// Sources: well-known synced and local folders on this computer, so the app can offer to protect one.
// Only fixed paths under the home folder are checked, with stat. ~/Library/CloudStorage is listed
// once, by name, to find drives whose folder name carries an account (GoogleDrive-you@example.com).
// No file is ever opened or read, and nothing is listed inside any of these folders.
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SourceId, SourceRow } from "./types.js";

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Which well-known folders exist under the home folder in `env` (HOME), in a fixed order. */
export function sources(env: NodeJS.ProcessEnv = process.env): SourceRow[] {
  const home = env.HOME || homedir();
  const cloud = join(home, "Library", "CloudStorage");
  let names: string[] = [];
  try {
    names = readdirSync(cloud).sort();
  } catch {
    // No CloudStorage folder: no drive is installed the new way.
  }
  /** The folders in CloudStorage whose name starts with `prefix`, by name. */
  const inCloud = (prefix: string): string[] => names.filter((n) => n.startsWith(prefix)).map((n) => join(cloud, n));
  const icloud = join(home, "Library", "Mobile Documents");
  const candidates: [SourceId, string, string[]][] = [
    ["icloud", "iCloud Drive", [join(icloud, "com~apple~CloudDocs")]],
    ["dropbox", "Dropbox", [join(home, "Dropbox"), ...inCloud("Dropbox")]],
    ["gdrive", "Google Drive", inCloud("GoogleDrive")],
    ["onedrive", "OneDrive", inCloud("OneDrive")],
    ["obsidian", "Obsidian", [join(home, "Documents", "Obsidian"), join(icloud, "iCloud~md~obsidian")]],
    ["documents", "Documents", [join(home, "Documents")]],
    ["desktop", "Desktop", [join(home, "Desktop")]],
  ];
  const usual: Record<SourceId, string> = {
    icloud: join(icloud, "com~apple~CloudDocs"),
    dropbox: join(home, "Dropbox"),
    gdrive: join(cloud, "GoogleDrive"),
    onedrive: join(cloud, "OneDrive"),
    obsidian: join(home, "Documents", "Obsidian"),
    documents: join(home, "Documents"),
    desktop: join(home, "Desktop"),
  };
  return candidates.map(([id, label, paths]) => {
    const found = paths.find(isDir);
    return { id, label, path: found ?? usual[id], found: found !== undefined };
  });
}
