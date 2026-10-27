import { z } from "zod";
import { isSafeRelPath } from "./paths.js";

const SafePath = z.string().refine(isSafeRelPath, "path must stay inside the project");

const CoverageSchema = z.object({
  captured: z.array(z.string()),
  restorable: z.array(z.string()),
  missing: z.array(z.string()),
  manual: z.array(z.string()),
});

/** The largest time, in ms either side of 1970, that a Date can hold. */
const MAX_DATE_MS = 8.64e15;

export const ManifestSchema = z.object({
  storeVersion: z.literal(1),
  id: z.string().regex(/^cp-\d{4,}$/),
  createdAt: z.string(),
  note: z.string(),
  trigger: z.string(),
  /** Which agent made this save point, and the prompt it was working on. Older manifests have none. */
  agent: z.object({ name: z.string().max(60), prompt: z.string().max(200).optional() }).optional(),
  project: z.object({ root: z.string(), name: z.string() }),
  git: z.object({
    head: z.string().nullable(),
    branch: z.string().nullable(),
    remote: z.string().nullable(),
    snapshot: z.string(),
    changedTracked: z.number().int(),
    dirty: z.boolean(),
  }),
  /** mtimeMs: the file's modified time when saved, given back to copies. Older manifests have none, and still read. A save records
   *  only the permission bits and a real date, so set-id bits or a time outside what a Date holds mean a changed file (Security F5). */
  files: z.array(
    z.object({
      path: SafePath,
      sha256: z.string(),
      size: z.number(),
      mode: z.number().int().min(0).max(0o777),
      mtimeMs: z.number().min(-MAX_DATE_MS).max(MAX_DATE_MS).optional(),
    }),
  ),
  config: z.array(
    z.object({
      file: SafePath,
      keys: z.array(
        z.object({
          name: z.string(),
          kind: z.enum(["plain", "secret"]),
          value: z.string().optional(),
          fingerprint: z.string(),
        }),
      ),
    }),
  ),
  environment: z.object({
    runtimes: z.record(z.string(), z.string()),
    lockfiles: z.array(z.object({ path: SafePath, sha256: z.string() })),
    definitions: z.array(z.object({ path: SafePath, sha256: z.string() })),
  }),
  coverage: CoverageSchema,
  bundle: z.string().nullable(),
  integrity: z.string(),
});

export type Manifest = z.infer<typeof ManifestSchema>;
