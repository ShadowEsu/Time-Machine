// Run notes: a title, a note and a pin a person puts on a save point, for research and trial runs.
// They live in one sidecar file in the project's store, never in a save point (its manifest is
// sealed) and never in the project folder. Text that looks like a secret is refused.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { audit } from "./audit.js";
import { TmError } from "./errors.js";
import { privateDir } from "./paths.js";
import { resolveProject, type Project } from "./project.js";
import { looksSecret, NOTE_LOOKS_SECRET } from "./secret-patterns.js";
import { listIds } from "./store.js";
import type { Ctx, RunNote } from "./types.js";

const NOTES_FILE = "notes.json";
const CHECKPOINT_ID = /^cp-\d{4,}$/;

const RunNoteSchema = z.strictObject({
  title: z.string().max(80).optional(),
  note: z.string().max(2000).optional(),
  pinned: z.boolean(),
  updated: z.string(),
});

const NotesFileSchema = z.strictObject({
  version: z.literal(1),
  notes: z.record(z.string().regex(CHECKPOINT_ID), RunNoteSchema),
});

const NoteChangeSchema = z.strictObject({
  id: z.string(),
  title: z.string().trim().max(80, "A title can be at most 80 characters.").optional(),
  note: z.string().max(2000, "A note can be at most 2000 characters.").optional(),
  pinned: z.boolean().optional(),
});

/** A change to one save point's note. A field left out keeps its value; an empty title or note clears it. */
export type NoteChange = z.input<typeof NoteChangeSchema>;

function read(p: Project): Record<string, RunNote> {
  const path = join(p.store, NOTES_FILE);
  if (!existsSync(path)) return {};
  try {
    return NotesFileSchema.parse(JSON.parse(readFileSync(path, "utf8"))).notes;
  } catch {
    throw new TmError("integrity", `The run notes file (${path}) is damaged, so Time Machine left it alone. Move it aside to start over.`);
  }
}

/** Writes a temp file next to the notes, then renames it over them, so a crash never leaves half a file. */
function write(p: Project, notes: Record<string, RunNote>): void {
  privateDir(p.store);
  const path = join(p.store, NOTES_FILE);
  const tmp = `${path}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify({ version: 1, notes }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** Every run note of the project at ctx.cwd, by save point id. Save points with no note are left out. */
export function notes(ctx: Ctx): Record<string, RunNote> {
  return read(resolveProject(ctx));
}

/** Sets, changes or clears one save point's note and returns it. A note with no title, no text and no pin is removed. */
export function setNote(ctx: Ctx, change: NoteChange): RunNote {
  const parsed = NoteChangeSchema.safeParse(change);
  if (!parsed.success) throw new TmError("usage", parsed.error.issues[0]?.message ?? "That note is not valid.");
  const { id, title, note, pinned } = parsed.data;
  if (!CHECKPOINT_ID.test(id)) throw new TmError("usage", `"${id}" is not a checkpoint ID. IDs look like cp-0003.`);
  if ([title, note].some((t) => t !== undefined && looksSecret(t))) throw new TmError("usage", NOTE_LOOKS_SECRET);
  const p = resolveProject(ctx);
  if (!listIds(p).includes(id)) throw new TmError("not_found", `There is no checkpoint ${id}. Run tm timeline to see them.`);
  const all = read(p);
  const before = all[id];
  const nextTitle = title ?? before?.title ?? "";
  const nextNote = note ?? before?.note ?? "";
  const next: RunNote = {
    ...(nextTitle ? { title: nextTitle } : {}),
    ...(nextNote.trim() ? { note: nextNote } : {}),
    pinned: pinned ?? before?.pinned ?? false,
    updated: new Date().toISOString(),
  };
  if (next.title === undefined && next.note === undefined && !next.pinned) delete all[id];
  else all[id] = next;
  write(p, all);
  audit(p, "note", id, all[id] ? (next.pinned ? "noted, pinned" : "noted") : "note cleared");
  return next;
}
