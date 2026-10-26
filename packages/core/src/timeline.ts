import { existsSync } from "node:fs";
import { summarize } from "./checkpoint.js";
import { describeSummary } from "./folder.js";
import { TmError } from "./errors.js";
import { gitTry, splitZ } from "./git.js";
import type { Manifest } from "./manifest.js";
import { goneFromStore, refProblem } from "./materialize.js";
import { resolveProject, type Project } from "./project.js";
import { blobPath, listIds, readManifest } from "./store.js";
import type { Ctx, TimelineEntry, TimelineResult } from "./types.js";
import { latestVerdicts } from "./verdicts.js";

/** Every refs/tm/ ref and the commit it points at, in one Git call. Null when Git can't be asked (a Git project's folder is gone). */
export function tmRefs(p: Project): Map<string, string> | null {
  const r = gitTry(p.root, p.env, ["for-each-ref", "--format=%(refname)%00%(objectname)", "refs/tm/"]);
  if (r.code !== 0) return null;
  const out = new Map<string, string>();
  for (const line of r.stdout.split("\n")) {
    const [ref, sha] = line.split("\0");
    if (ref?.startsWith("refs/tm/") && sha) out.set(ref.slice(8), sha);
  }
  return out;
}

/**
 * Why a readable save point is damaged, or null: its pinned ref was moved or is gone, or saved copies of
 * its files are gone from the store. `blobs` caches which saved copies exist, across save points.
 */
export function damage(p: Project, m: Manifest, refs: Map<string, string> | null, blobs: Map<string, boolean>): string | null {
  const ref = refs ? refProblem(m, refs.get(m.id)) : null;
  if (ref) return ref.message;
  const gone = m.files.filter((f) => {
    let there = blobs.get(f.sha256);
    if (there === undefined) blobs.set(f.sha256, (there = existsSync(blobPath(p, f.sha256))));
    return !there;
  });
  if (!gone.length) return null;
  const first = gone[0]?.path ?? "";
  const sentence = goneFromStore(first);
  return gone.length === 1 ? `${sentence[0]?.toUpperCase()}${sentence.slice(1)}.` : `The saved copies of ${first} and ${gone.length - 1} more file${gone.length === 2 ? "" : "s"} are gone from the store.`;
}

/** The subject line of each commit, for Git projects. Commits Git no longer has are left out. */
function subjects(p: Project, heads: string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (p.kind !== "git" || !heads.length) return out;
  const r = gitTry(p.root, p.env, ["log", "--no-walk", "--ignore-missing", "-z", "--format=%H%x01%s", ...heads, "--"]);
  if (r.code !== 0) return out;
  for (const rec of splitZ(r.stdout)) {
    const [sha, subject] = rec.split("\x01");
    if (sha && subject !== undefined) out.set(sha.trim(), subject);
  }
  return out;
}

export async function timeline(ctx: Ctx): Promise<TimelineResult> {
  const p = resolveProject(ctx);
  const verdicts = latestVerdicts(p);
  const refs = tmRefs(p);
  const blobs = new Map<string, boolean>();
  const read = listIds(p).map((id): Manifest | { id: string; error: string } => {
    try {
      return readManifest(p, id);
    } catch (e) {
      return { id, error: e instanceof TmError ? e.message : String(e) };
    }
  });
  const heads = [...new Set(read.flatMap((m) => ("git" in m && m.git.head ? [m.git.head] : [])))];
  const subjectOf = subjects(p, heads);
  const checkpoints: TimelineEntry[] = read.map((m) => {
    if ("error" in m) {
      return {
        id: m.id, createdAt: "", note: m.error, trigger: "", agent: null, commit: "", head: null, branch: null, dirty: false, files: 0,
        coverage: { captured: [], restorable: [], missing: [], manual: [] }, verdict: "ERROR", isolation: null, damaged: m.error,
      };
    }
    const v = verdicts.get(m.id);
    const damaged = damage(p, m, refs, blobs);
    return {
      ...describeSummary(p, summarize(m)),
      verdict: v?.verdict ?? null,
      isolation: v?.isolation ?? null,
      ...(damaged ? { damaged } : {}),
      ...(p.kind === "git" ? { subject: m.git.head ? (subjectOf.get(m.git.head) ?? null) : null } : {}),
    };
  });
  return { project: p.root, kind: p.kind, missing: p.missing, checkpoints };
}
