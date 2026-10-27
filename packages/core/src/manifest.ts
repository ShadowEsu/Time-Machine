import { z } from "zod";
import { isSafeRelPath } from "./paths.js";

const SafePath = z.string().refine(isSafeRelPath, "path must stay inside the project");

const CoverageSchema = z.object({
  captured: z.array(z.string()),
  restorable: z.array(z.string()),
  missing: z.array(z.string()),
  manual: z.array(z.string()),
});

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
  files: z.array(z.object({ path: SafePath, sha256: z.string(), size: z.number(), mode: z.number() })),
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
