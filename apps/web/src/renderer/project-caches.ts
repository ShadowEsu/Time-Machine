// What the app keeps for the open project, much of it by save point id. Ids restart at cp-0001 in every project, so all
// of it is dropped whenever the open project changes, or another project's files, checks, notes and deploy chips would
// show on these rows (Design gate MF3). Every path that changes the open project goes through resetProjectCaches.
import type { TimelineResult, VerdictRecord } from "@timetm/core";
import type { RunNote } from "../shared/api.js";
import type { JournalFilter, NoteDraft } from "./runs.js";

export interface ProjectCaches {
  projectId: string | null;
  timeline: TimelineResult | null;
  selected: string | null;
  drawer: boolean;
  changes: Map<string, string[]>;
  storedChecks: Map<string, VerdictRecord | null>;
  deployChips: Map<string, string>;
  notes: Map<string, RunNote>;
  journalFilter: JournalFilter;
  /** History's opened folds of quiet save points, by the fold's newest id, and the fold the list's keys are on (null: the selected row). */
  folds: Set<string>;
  foldAt: string | null;
  noteDraft: NoteDraft | null;
  /** The project and newest save point whose changes were last read, so a read is not repeated. */
  changesFor: string;
}

/** Opens `id` (null when none is left). True when it is another project, and everything kept for the last one was dropped. */
export function resetProjectCaches(s: ProjectCaches, id: string | null): boolean {
  if (s.projectId === id) return false;
  s.projectId = id;
  s.timeline = null;
  s.selected = null;
  s.drawer = false;
  s.changes = new Map();
  s.storedChecks = new Map();
  s.deployChips = new Map();
  s.notes = new Map();
  s.journalFilter = "all";
  s.folds = new Set();
  s.foldAt = null;
  s.noteDraft = null;
  s.changesFor = "";
  return true;
}
