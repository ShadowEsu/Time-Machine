// Vercel deploys on the timeline (ADR 0009). Read only: the only method allowed is GET, to
// three endpoints. Every answer is checked with Zod. The token goes in one header and never
// into a result, an error or a log.
import * as tm from "@timetm/core";
import { z } from "zod";
import { VercelLinkSchema, type DeploymentsResult, type VercelDeployment, type VercelLink, type VercelProjectOption } from "../shared/api.js";

const API = "https://api.vercel.com";
/** The only HTTP methods this app ever sends to Vercel. */
export const READ_METHODS: Readonly<Record<string, true>> = { GET: true };
const PATHS: Readonly<Record<string, true>> = { "/v2/teams": true, "/v10/projects": true, "/v7/deployments": true };
const TTL_MS = 60_000;
const DEPLOYMENTS_LIMIT = "50";

/** What was read from Vercel, and when, in milliseconds since 1970. */
export interface Fetched<T> {
  at: number;
  value: T;
}

export interface FetchInit {
  method: string;
  headers: Record<string, string>;
  signal: AbortSignal;
  redirect: "error";
}
export interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponse>;

export interface VercelIo {
  /** The token from Settings or VERCEL_TOKEN, or null when there is none. */
  token: () => string | null;
  fetch: FetchLike;
  now?: () => number;
  timeoutMs?: number;
}

const Id = VercelLinkSchema.shape.projectId;
const Sha = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
const Ref = z.string().min(1).max(255);
const Host = z.string().max(253).regex(/^[a-z0-9.-]+$/i);
const State = z.enum(["BLOCKED", "BUILDING", "CANCELED", "DELETED", "ERROR", "INITIALIZING", "QUEUED", "READY"]);
const Pagination = z.object({ next: z.union([z.string().min(1).max(200), z.number().int().nonnegative()]).nullable().optional() }).optional();

const TeamsSchema = z.object({
  teams: z.array(z.object({ id: Id, slug: z.string().max(200), name: z.string().max(200).nullable().optional() })),
  pagination: Pagination,
});

const ProjectsSchema = z.object({
  projects: z.array(
    z.object({
      id: Id,
      name: z.string().min(1).max(200),
      link: z.object({ org: z.string().max(200).optional(), repo: z.string().max(200).optional() }).nullable().optional(),
    }),
  ),
  pagination: Pagination,
});

const DeploymentsSchema = z.object({
  deployments: z.array(
    z.object({
      uid: Id,
      /** A host name such as my-app-abc123.vercel.app. Null while the upload is not finished. */
      url: Host.nullable(),
      createdAt: z.number().int().nonnegative().max(8_640_000_000_000_000),
      readyState: State,
      /** Null means a preview deploy. */
      target: z.string().max(100).nullable().optional(),
      source: z.string().max(60).optional(),
      creator: z.object({ uid: z.string().max(100), username: z.string().max(100).optional() }),
      inspectorUrl: z.url({ protocol: /^https$/ }).nullable().optional(),
      meta: z
        .object({
          githubCommitSha: Sha.optional(),
          gitlabCommitSha: Sha.optional(),
          bitbucketCommitSha: Sha.optional(),
          githubCommitRef: Ref.optional(),
          gitlabCommitRef: Ref.optional(),
          bitbucketCommitRef: Ref.optional(),
          gitDirty: z.string().max(10).optional(),
        })
        .optional(),
    }),
  ),
});

const NO_TOKEN = "Add a Vercel token in Settings to see deploys. Time Machine only reads from Vercel.";
const MALFORMED = "Vercel sent an answer Time Machine did not expect, so no deploys are shown.";

class StatusError extends tm.TmError {
  constructor(readonly status: number) {
    super("usage", statusSentence(status));
  }
}

function statusSentence(status: number): string {
  if (status === 401 || status === 403) return "Vercel did not accept the token. Paste a new one in Settings.";
  if (status === 404) return "Vercel could not find that project. Pick it again in Settings.";
  if (status === 429) return "Vercel asked Time Machine to slow down. Try again in a minute.";
  return `Vercel answered with an error (status ${status}). Try again later.`;
}

/** One read from the Vercel API. Anything but GET to a known endpoint is refused before it leaves the Mac. */
export async function vercelRequest<T>(io: VercelIo, method: string, path: string, query: Record<string, string>, schema: z.ZodType<T>): Promise<T> {
  if (!Object.hasOwn(READ_METHODS, method)) throw new tm.TmError("usage", "Time Machine only reads from Vercel. It never changes, promotes or rolls back a deploy.");
  if (!Object.hasOwn(PATHS, path)) throw new tm.TmError("usage", "Time Machine only reads teams, projects and deploys from Vercel.");
  const token = io.token();
  if (!token) throw new tm.TmError("usage", NO_TOKEN);
  const url = new URL(path, API);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const timeoutMs = io.timeoutMs ?? 10_000;
  let res: FetchResponse;
  try {
    res = await io.fetch(url.toString(), {
      method,
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  } catch (e) {
    // The underlying error is dropped on purpose: its text is not ours to show.
    if (e instanceof Error && e.name === "TimeoutError") throw new tm.TmError("internal", `Vercel did not answer within ${Math.round(timeoutMs / 1000)} seconds. Try again.`);
    throw new tm.TmError("internal", "Could not reach Vercel. Check the internet connection and try again.");
  }
  if (!res.ok) throw new StatusError(res.status);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new tm.TmError("internal", MALFORMED);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new tm.TmError("internal", MALFORMED);
  return parsed.data;
}

/** Reads a Vercel account for the project picker and a project's recent deploys, each kept for a minute. */
export class Vercel {
  private readonly projectsCache = new Map<string, Fetched<VercelProjectOption[]>>();
  private readonly deploymentsCache = new Map<string, Fetched<VercelDeployment[]>>();

  constructor(private readonly io: VercelIo) {}

  private async cached<T>(store: Map<string, Fetched<T>>, key: string, load: () => Promise<T>): Promise<Fetched<T>> {
    const now = this.io.now ?? Date.now;
    const hit = store.get(key);
    if (hit && now() - hit.at < TTL_MS) return hit;
    const fresh = { value: await load(), at: now() };
    store.set(key, fresh);
    return fresh;
  }

  /** Forgets what was read, after the token or a project's link changes. */
  forget(): void {
    this.projectsCache.clear();
    this.deploymentsCache.clear();
  }

  private get<T>(path: string, query: Record<string, string>, schema: z.ZodType<T>): Promise<T> {
    return vercelRequest(this.io, "GET", path, query, schema);
  }

  private async teams(): Promise<z.infer<typeof TeamsSchema>["teams"]> {
    const teams: z.infer<typeof TeamsSchema>["teams"] = [];
    const query: Record<string, string> = { limit: "100" };
    const seen = new Set<string>();
    for (;;) {
      const page = await this.get("/v2/teams", query, TeamsSchema);
      teams.push(...page.teams);
      const next = page.pagination?.next;
      if (next === null || next === undefined) return teams;
      const cursor = String(next);
      if (seen.has(cursor)) throw new tm.TmError("internal", MALFORMED);
      seen.add(cursor);
      query.until = cursor;
    }
  }

  private async projectsIn(teamId: string | null): Promise<z.infer<typeof ProjectsSchema>> {
    const projects: z.infer<typeof ProjectsSchema>["projects"] = [];
    const query: Record<string, string> = { limit: "100" };
    if (teamId) query.teamId = teamId;
    const seen = new Set<string>();
    for (;;) {
      const page = await this.get("/v10/projects", query, ProjectsSchema);
      projects.push(...page.projects);
      const next = page.pagination?.next;
      if (next === null || next === undefined) return { projects };
      const cursor = String(next);
      if (seen.has(cursor)) throw new tm.TmError("internal", MALFORMED);
      seen.add(cursor);
      query.from = cursor;
    }
  }

  /** The projects the token can see, in every team, for picking one. */
  async projects(): Promise<VercelProjectOption[]> {
    const fetched = await this.cached(this.projectsCache, "projects", async () => {
      const teams = await this.teams();
      // Older personal accounts keep projects outside any team. A token made for one team may not read them.
      const personal = this.projectsIn(null).catch((e: unknown) => {
        if (e instanceof StatusError && e.status === 403) return { projects: [] };
        throw e;
      });
      const options = (team: { id: string; slug: string; name?: string | null } | null, r: z.infer<typeof ProjectsSchema>): VercelProjectOption[] =>
        r.projects.map((p) => ({
          teamId: team?.id ?? null,
          teamName: team ? (team.name ?? team.slug) : null,
          projectId: p.id,
          name: p.name,
          repo: p.link?.repo ? (p.link.org ? `${p.link.org}/${p.link.repo}` : p.link.repo) : null,
        }));
      const [own = [], ...inTeams] = await Promise.all([
        personal.then((r) => options(null, r)),
        ...teams.map((team) => this.projectsIn(team.id).then((r) => options(team, r))),
      ]);
      // Teams first, so a project both lists show keeps its team.
      const seen = new Map<string, VercelProjectOption>();
      for (const o of [...inTeams.flat(), ...own]) if (!seen.has(o.projectId)) seen.set(o.projectId, o);
      return [...seen.values()].sort((a, b) => (a.teamName ?? "").localeCompare(b.teamName ?? "") || a.name.localeCompare(b.name));
    });
    return fetched.value;
  }

  /** The newest deploys of one Vercel project, and when they were read. */
  deployments(link: VercelLink): Promise<Fetched<VercelDeployment[]>> {
    return this.cached(this.deploymentsCache, `${link.teamId ?? ""}:${link.projectId}`, async () => {
      const query: Record<string, string> = { projectId: link.projectId, limit: DEPLOYMENTS_LIMIT };
      if (link.teamId) query.teamId = link.teamId;
      const { deployments } = await this.get("/v7/deployments", query, DeploymentsSchema);
      return deployments.map((d): VercelDeployment => {
        const m = d.meta ?? {};
        return {
          id: d.uid,
          url: d.url ? `https://${d.url}` : null,
          target: d.target === "production" ? "production" : d.target ? "other" : "preview",
          state: d.readyState,
          createdAt: new Date(d.createdAt).toISOString(),
          creator: d.creator.username ?? null,
          source: d.source ?? null,
          commit: m.githubCommitSha ?? m.gitlabCommitSha ?? m.bitbucketCommitSha ?? null,
          branch: m.githubCommitRef ?? m.gitlabCommitRef ?? m.bitbucketCommitRef ?? null,
          dirty: m.gitDirty === "1",
          inspectorUrl: d.inspectorUrl ?? null,
        };
      });
    });
  }
}

/**
 * Puts each deploy next to the save points whose recorded Git HEAD is the deploy's commit.
 * Only an exact commit match counts. Times are never used to guess.
 */
export function matchDeployments(
  link: VercelLink,
  checkpoints: readonly { id: string; head: string | null; dirty: boolean }[],
  deployments: readonly VercelDeployment[],
  fetchedAt: string,
): DeploymentsResult {
  const byHead = new Map<string, { id: string; dirty: boolean }[]>();
  for (const c of checkpoints) {
    if (!c.head) continue;
    const list = byHead.get(c.head) ?? [];
    list.push({ id: c.id, dirty: c.dirty });
    byHead.set(c.head, list);
  }
  const result: DeploymentsResult = { link, matched: [], otherCommits: [], noCommit: [], fetchedAt };
  for (const d of deployments) {
    const points = d.commit ? byHead.get(d.commit) : undefined;
    if (!d.commit) result.noCommit.push(d);
    else if (!points) result.otherCommits.push(d);
    else result.matched.push({ deployment: d, savePoints: points.map((p) => ({ id: p.id, exact: !p.dirty && !d.dirty })) });
  }
  return result;
}
