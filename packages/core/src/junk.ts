// Files the system or an editor makes on its own: Finder and Explorer folder settings, Office and
// Emacs lock files, Vim swap files. Auto save does not wake for them, and a save never keeps them.
import { basename } from "node:path";

/** Exact names that are never saved. */
export const JUNK_FILE_NAMES: readonly string[] = [".DS_Store", "Thumbs.db", "desktop.ini"];

/** True for a system or editor file at `rel` (any folder): a name in JUNK_FILE_NAMES, an Office (~$) or Emacs (.#) lock, a Vim .swp. */
export function isJunkFile(rel: string): boolean {
  const name = basename(rel);
  return JUNK_FILE_NAMES.includes(name) || name.startsWith("~$") || name.startsWith(".#") || name.endsWith(".swp");
}
