// What a protected item is for, and what kind of folder it is, in plain words and one small line icon each.
// Purpose only changes words and defaults in the app, never what is saved.
import type { ProjectKind, Purpose } from "../shared/api.js";

export interface PurposeWords {
  /** The choice in the Add flow and the label on Overview: "Research and experiments". */
  label: string;
  /** One line under the choice, in the user's words. */
  hint: string;
  /** What one save point is called in this project's labels: research calls them runs. */
  unit: string;
  units: string;
}

export const PURPOSES: { [P in Purpose]: PurposeWords } = {
  code: { label: "Code project", hint: "An app, a site or a library. Add a check that tells you it works, or only save versions.", unit: "save point", units: "save points" },
  documents: { label: "Documents and notes", hint: "Writing, notes, a thesis, an Obsidian vault.", unit: "save point", units: "save points" },
  research: { label: "Research and experiments", hint: "Analysis scripts, data and trial-run outputs.", unit: "run", units: "runs" },
  agents: { label: "AI agent workspace", hint: "A folder an agent works in, so you can see what it changed and go back.", unit: "save point", units: "save points" },
  other: { label: "Something else", hint: "Any folder of your own files.", unit: "save point", units: "save points" },
};

/** The four choices the Add flow offers, in order. "other" stays for older entries. */
export const ADD_PURPOSES: readonly Purpose[] = ["code", "documents", "research", "agents"];

/** "Git project" or "Folder". */
export const kindLabel = (kind: ProjectKind): string => (kind === "git" ? "Git project" : "Folder");

/** The line under a project's name: "Git project" for code, else the kind and what it is for, "Folder · Documents and notes". */
export function projectMeta(p: { kind: ProjectKind; purpose: Purpose }): string {
  return p.purpose === "code" ? kindLabel(p.kind) : `${kindLabel(p.kind)} · ${PURPOSES[p.purpose].label}`;
}

/** "1 run", "3 save points": a count in this purpose's word. */
export function unitCount(purpose: Purpose, n: number): string {
  const w = PURPOSES[purpose];
  return `${n} ${n === 1 ? w.unit : w.units}`;
}

/** A check is recommended for a code project. Every purpose may skip it and only save versions (a project with no tests yet). */
export const checkRecommended = (purpose: Purpose): boolean => purpose === "code";

/**
 * Whether a project has a check: whether a check command is set now, once that is known. Until it is read, a project
 * that has ever been checked counts as having one. Without one the app says when it was saved, never "Not checked yet",
 * and never offers to check it; old verdicts stay as history (Design re-check 1).
 */
export function hasCheck(commandSet: boolean | null, everChecked: boolean): boolean {
  return commandSet ?? everChecked;
}

const ICONS: { [P in Purpose]: string } = {
  code: '<path d="M7.5 6 3.5 10l4 4M12.5 6l4 4-4 4"/>',
  documents: '<path d="M5 3.5h6.5L15 7v9.5H5z"/><path d="M11.5 3.5V7H15M7.5 10.5h5M7.5 13.5h3.5"/>',
  research: '<path d="M8 3.5h4M8.8 3.5v4.6L4.7 15a1.2 1.2 0 0 0 1 1.8h8.6a1.2 1.2 0 0 0 1-1.8l-4.1-6.9V3.5"/><path d="M6.5 12.5h7"/>',
  agents: '<circle cx="10" cy="5" r="2"/><circle cx="4.8" cy="15" r="2"/><circle cx="15.2" cy="15" r="2"/><path d="M9 6.8 5.8 13.2M11 6.8l3.2 6.4M6.8 15h6.4"/>',
  other: '<path d="M3 6.6A1.6 1.6 0 0 1 4.6 5h3.1l1.7 1.8h6A1.6 1.6 0 0 1 17 8.4v6A1.6 1.6 0 0 1 15.4 16H4.6A1.6 1.6 0 0 1 3 14.4z"/>',
};

/** A purpose as a small line icon on a paper tile. Decorative: the label is always written beside it. */
export function purposeIcon(purpose: Purpose, cls = ""): string {
  return `<span class="pico pico-${purpose}${cls ? ` ${cls}` : ""}" aria-hidden="true"><svg viewBox="0 0 20 20" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[purpose]}</svg></span>`;
}
