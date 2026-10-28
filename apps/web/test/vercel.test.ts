// Vercel deploys on the timeline (ADR 0009). Read only, matched to save points by commit,
// never by time. Every test injects fetch, so nothing here touches the network.
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { setupDemo, tempDir } from "../../../fixtures/demo/setup.ts";
import { Credentials, type Cipher } from "../src/server/credentials.ts";
import { Engine } from "../src/server/engine.ts";
import { AppState } from "../src/server/state.ts";
import { matchDeployments, Vercel, vercelRequest, type FetchInit, type FetchLike, type VercelIo } from "../src/server/vercel.ts";
import { VERCEL_CONSENT_VERSION, type ProjectEntry, type VercelDeployment, type VercelLink } from "../src/shared/api.ts";
import { z } from "zod";
import { FakeEngine } from "../preview/fake.ts";

const TOKEN = "vercel_test_token_7f3a9c2e1b";
const LINK: VercelLink = { teamId: "team_abc123", projectId: "prj_xyz789", name: "marigold-tips" };
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

interface Sent {
  url: URL;
  init: FetchInit;
}

/** A fetch that answers by path and records every request. */
function fakeFetch(answers: Record<string, (url: URL) => { status?: number; body: unknown }>): { fetch: FetchLike; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetch: FetchLike = async (raw, init) => {
    const url = new URL(raw);
    sent.push({ url, init });
    const answer = answers[url.pathname];
    if (!answer) return { ok: false, status: 404, json: async () => ({}) };
    const { status = 200, body } = answer(url);
    return { ok: status < 400, status, json: async () => body };
  };
  return { fetch, sent };
}

function io(fetch: FetchLike, extra: Partial<VercelIo> = {}): VercelIo {
  return { token: () => TOKEN, fetch, ...extra };
}

function apiDeployment(uid: string, createdAt: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uid,
    url: `${uid.toLowerCase().replace("_", "-")}.vercel.app`,
    name: "marigold-tips",
    projectId: LINK.projectId,
    type: "LAMBDAS",
    created: createdAt,
    createdAt,
    readyState: "READY",
    creator: { uid: "usr_1", username: "sam", email: "sam@example.com" },
    inspectorUrl: `https://vercel.com/acme/marigold-tips/${uid}`,
    ...extra,
  };
}

function deployment(id: string, commit: string | null, extra: Partial<VercelDeployment> = {}): VercelDeployment {
  return {
    id, url: `https://${id}.vercel.app`, target: "preview", state: "READY", createdAt: "2026-10-16T10:00:00.000Z",
    creator: "sam", source: commit ? "git" : "cli", commit, branch: commit ? "main" : null, dirty: false, inspectorUrl: null, ...extra,
  };
}

describe("matching deploys to save points", () => {
  test("a deploy sits next to the save points whose recorded HEAD is its commit", () => {
    const points = [
      { id: "cp-0001", head: SHA_A, dirty: false },
      { id: "cp-0002", head: SHA_B, dirty: true },
      { id: "cp-0003", head: SHA_B, dirty: false },
    ];
    const prod = deployment("prod", SHA_A, { target: "production" });
    const preview = deployment("preview", SHA_B);
    const r = matchDeployments(LINK, points, [prod, preview], "2026-10-16T10:05:00.000Z");
    expect(r.matched).toEqual([
      { deployment: prod, savePoints: [{ id: "cp-0001", exact: true }] },
      // A save point with uncommitted changes shares the commit but holds more than was deployed.
      { deployment: preview, savePoints: [{ id: "cp-0002", exact: false }, { id: "cp-0003", exact: true }] },
    ]);
    expect(r.otherCommits).toEqual([]);
    expect(r.noCommit).toEqual([]);
    expect(r.link).toEqual(LINK);
  });

  test("deploys without Git data are listed apart, and a commit no save point recorded is never matched by time", () => {
    const points = [{ id: "cp-0001", head: SHA_A, dirty: false, createdAt: "2026-10-16T09:59:59.000Z" }];
    const cli = deployment("cli", null, { createdAt: "2026-10-16T10:00:00.000Z" });
    // Deployed one second after the save point, but from another commit.
    const other = deployment("other", SHA_C, { createdAt: "2026-10-16T10:00:00.000Z" });
    const r = matchDeployments(LINK, points, [cli, other], "2026-10-16T10:05:00.000Z");
    expect(r.matched).toEqual([]);
    expect(r.noCommit).toEqual([cli]);
    expect(r.otherCommits).toEqual([other]);
  });

  test("a deploy from a folder with uncommitted changes is never an exact match", () => {
    const r = matchDeployments(LINK, [{ id: "cp-0001", head: SHA_A, dirty: false }], [deployment("cli", SHA_A, { source: "cli", dirty: true })], "x");
    expect(r.matched[0]?.savePoints).toEqual([{ id: "cp-0001", exact: false }]);
  });

  test("save points that could not be read (no HEAD) match nothing", () => {
    const r = matchDeployments(LINK, [{ id: "cp-0001", head: null, dirty: false }], [deployment("d", SHA_A)], "x");
    expect(r.matched).toEqual([]);
    expect(r.otherCommits).toHaveLength(1);
  });
});

describe("reading deploys from Vercel", () => {
  test("reads the newest deploys of the linked project with GET, the token only in the header", async () => {
    const created = Date.UTC(2026, 9, 16, 10, 0, 0);
    const { fetch, sent } = fakeFetch({
      "/v7/deployments": () => ({
        body: {
          deployments: [
            apiDeployment("dpl_Prod1", created, { target: "production", source: "git", meta: { githubCommitSha: SHA_A, githubCommitRef: "main", githubCommitMessage: "Add dark mode" } }),
            apiDeployment("dpl_Prev1", created - 60_000, { target: null, source: "git", meta: { gitlabCommitSha: SHA_B, gitlabCommitRef: "feature" } }),
            apiDeployment("dpl_Cli1", created - 120_000, { source: "cli", url: null }),
            apiDeployment("dpl_Stg1", created - 180_000, { target: "staging", meta: { bitbucketCommitSha: SHA_C, gitDirty: "1" } }),
          ],
          pagination: { count: 4, next: null, prev: null },
        },
      }),
    });
    const list = (await new Vercel(io(fetch)).deployments(LINK)).value;
    expect(sent).toHaveLength(1);
    const [req] = sent;
    expect(req?.init.method).toBe("GET");
    expect(req?.init.redirect).toBe("error");
    expect(req?.init.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(req?.url.origin).toBe("https://api.vercel.com");
    expect(Object.fromEntries(req?.url.searchParams ?? [])).toEqual({ projectId: LINK.projectId, teamId: LINK.teamId, limit: "50" });
    expect(req?.url.toString()).not.toContain(TOKEN);
    expect(list).toEqual([
      { id: "dpl_Prod1", url: "https://dpl-prod1.vercel.app", target: "production", state: "READY", createdAt: "2026-10-16T10:00:00.000Z", creator: "sam", source: "git", commit: SHA_A, branch: "main", dirty: false, inspectorUrl: "https://vercel.com/acme/marigold-tips/dpl_Prod1" },
      { id: "dpl_Prev1", url: "https://dpl-prev1.vercel.app", target: "preview", state: "READY", createdAt: "2026-10-16T09:59:00.000Z", creator: "sam", source: "git", commit: SHA_B, branch: "feature", dirty: false, inspectorUrl: "https://vercel.com/acme/marigold-tips/dpl_Prev1" },
      { id: "dpl_Cli1", url: null, target: "preview", state: "READY", createdAt: "2026-10-16T09:58:00.000Z", creator: "sam", source: "cli", commit: null, branch: null, dirty: false, inspectorUrl: "https://vercel.com/acme/marigold-tips/dpl_Cli1" },
      { id: "dpl_Stg1", url: "https://dpl-stg1.vercel.app", target: "other", state: "READY", createdAt: "2026-10-16T09:57:00.000Z", creator: "sam", source: null, commit: SHA_C, branch: null, dirty: true, inspectorUrl: "https://vercel.com/acme/marigold-tips/dpl_Stg1" },
    ]);
    // The creator's email is never kept.
    expect(JSON.stringify(list)).not.toContain("example.com");
  });

  test("deploys are kept for a minute per project, then read again; forget clears them", async () => {
    let now = 1_000_000;
    const { fetch, sent } = fakeFetch({ "/v7/deployments": () => ({ body: { deployments: [], pagination: { count: 0, next: null, prev: null } } }) });
    const v = new Vercel(io(fetch, { now: () => now }));
    await v.deployments(LINK);
    now += 5_000;
    // A cached read says when it was really read.
    expect((await v.deployments(LINK)).at).toBe(1_000_000);
    expect(sent).toHaveLength(1);
    await v.deployments({ ...LINK, projectId: "prj_other" });
    expect(sent).toHaveLength(2);
    now += 61_000;
    await v.deployments(LINK);
    expect(sent).toHaveLength(3);
    v.forget();
    await v.deployments(LINK);
    expect(sent).toHaveLength(4);
  });

  test("the project picker lists every team's projects once, and personal projects", async () => {
    const { fetch, sent } = fakeFetch({
      "/v2/teams": () => ({ body: { teams: [{ id: "team_abc123", slug: "acme", name: "Acme" }, { id: "team_def456", slug: "side", name: null }], pagination: {} } }),
      "/v10/projects": (url) => {
        const team = url.searchParams.get("teamId");
        if (team === "team_abc123") return { body: { projects: [{ id: "prj_xyz789", name: "marigold-tips", link: { type: "github", org: "acme", repo: "marigold-tips" } }] } };
        if (team === "team_def456") return { body: { projects: [{ id: "prj_side1", name: "blog" }] } };
        // Personal scope also returns a team project; it keeps its team.
        return { body: { projects: [{ id: "prj_me1", name: "notes" }, { id: "prj_xyz789", name: "marigold-tips" }] } };
      },
    });
    const list = await new Vercel(io(fetch)).projects();
    expect(sent.every((s) => s.init.method === "GET")).toBe(true);
    expect(list).toEqual([
      { teamId: null, teamName: null, projectId: "prj_me1", name: "notes", repo: null },
      { teamId: "team_abc123", teamName: "Acme", projectId: "prj_xyz789", name: "marigold-tips", repo: "acme/marigold-tips" },
      { teamId: "team_def456", teamName: "side", projectId: "prj_side1", name: "blog", repo: null },
    ]);
  });

  test("a token made for one team still lists that team's projects when personal projects are off limits", async () => {
    const { fetch } = fakeFetch({
      "/v2/teams": () => ({ body: { teams: [{ id: "team_abc123", slug: "acme" }] } }),
      "/v10/projects": (url) => (url.searchParams.get("teamId") ? { body: { projects: [{ id: "prj_xyz789", name: "marigold-tips" }] } } : { status: 403, body: {} }),
    });
    expect((await new Vercel(io(fetch)).projects()).map((p) => p.projectId)).toEqual(["prj_xyz789"]);
  });
});

describe("read only", () => {
  test("anything but GET is refused before a request leaves the Mac", async () => {
    const { fetch, sent } = fakeFetch({ "/v7/deployments": () => ({ body: { deployments: [] } }) });
    for (const method of ["POST", "PATCH", "PUT", "DELETE", "get", "HEAD", "constructor"]) {
      await expect(vercelRequest(io(fetch), method, "/v7/deployments", {}, z.unknown())).rejects.toThrow("Time Machine only reads from Vercel. It never changes, promotes or rolls back a deploy.");
    }
    expect(sent).toEqual([]);
  });

  test("only the three read endpoints can be called", async () => {
    const { fetch, sent } = fakeFetch({});
    for (const path of ["/v13/deployments", "/v10/projects/prj_xyz789/promote/dpl_1", "/v9/projects/prj_xyz789/rollback/dpl_1", "/v1/user"]) {
      await expect(vercelRequest(io(fetch), "GET", path, {}, z.unknown())).rejects.toThrow("only reads teams, projects and deploys");
    }
    expect(sent).toEqual([]);
  });
});

describe("errors are plain sentences without the token", () => {
  const cases: [string, FetchLike, string][] = [
    ["rejected token", async () => ({ ok: false, status: 401, json: async () => ({ error: { message: `bad token ${TOKEN}` } }) }), "Vercel did not accept the token. Paste a new one in Settings."],
    ["missing project", async () => ({ ok: false, status: 404, json: async () => ({}) }), "Vercel could not find that project. Pick it again in Settings."],
    ["rate limit", async () => ({ ok: false, status: 429, json: async () => ({}) }), "Vercel asked Time Machine to slow down. Try again in a minute."],
    ["server error", async () => ({ ok: false, status: 502, json: async () => ({}) }), "Vercel answered with an error (status 502). Try again later."],
    ["network", async () => { throw new TypeError(`fetch failed for Bearer ${TOKEN}`); }, "Could not reach Vercel. Check the internet connection and try again."],
    ["timeout", async () => { throw new DOMException(`timed out ${TOKEN}`, "TimeoutError"); }, "Vercel did not answer within 10 seconds. Try again."],
    ["not JSON", async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError(TOKEN); } }), "Vercel sent an answer Time Machine did not expect, so no deploys are shown."],
  ];
  for (const [name, fetch, message] of cases) {
    test(name, async () => {
      const err: unknown = await new Vercel(io(fetch)).deployments(LINK).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe(message);
      expect(JSON.stringify(err) + String(err) + ((err as Error).stack ?? "")).not.toContain(TOKEN);
    });
  }

  test("without a token nothing is sent and the person is told where to add one", async () => {
    const { fetch, sent } = fakeFetch({});
    await expect(new Vercel(io(fetch, { token: () => null })).projects()).rejects.toThrow("Add a Vercel token in Settings to see deploys. Time Machine only reads from Vercel.");
    expect(sent).toEqual([]);
  });
});

describe("malformed answers are rejected, not shown", () => {
  const ok = apiDeployment("dpl_Ok1", 1_760_000_000_000);
  const bad: [string, unknown][] = [
    ["no deployments field", { pagination: {} }],
    ["createdAt as text", { deployments: [{ ...ok, createdAt: "yesterday" }] }],
    ["a commit that is not a sha", { deployments: [{ ...ok, meta: { githubCommitSha: "main; rm -rf /" } }] }],
    ["a url that is not a host name", { deployments: [{ ...ok, url: "javascript:alert(1)" }] }],
    ["an inspector link that is not https", { deployments: [{ ...ok, inspectorUrl: "http://vercel.com/x" }] }],
    ["an unknown state", { deployments: [{ ...ok, readyState: "MAYBE" }] }],
    ["an id with odd characters", { deployments: [{ ...ok, uid: "dpl/../../x" }] }],
    ["no creator", { deployments: [{ ...ok, creator: undefined }] }],
  ];
  for (const [name, body] of bad) {
    test(name, async () => {
      const { fetch } = fakeFetch({ "/v7/deployments": () => ({ body }) });
      await expect(new Vercel(io(fetch)).deployments(LINK)).rejects.toThrow("Vercel sent an answer Time Machine did not expect, so no deploys are shown.");
    });
  }

  test("a malformed answer is not cached", async () => {
    let body: unknown = { deployments: [{ ...ok, createdAt: "yesterday" }] };
    const { fetch, sent } = fakeFetch({ "/v7/deployments": () => ({ body }) });
    const v = new Vercel(io(fetch));
    await expect(v.deployments(LINK)).rejects.toThrow();
    body = { deployments: [ok] };
    expect((await v.deployments(LINK)).value).toHaveLength(1);
    expect(sent).toHaveLength(2);
  });
});

describe("project picker pagination", () => {
  test("follows team and project pages so projects beyond the first page can be picked", async () => {
    const { fetch, sent } = fakeFetch({
      "/v2/teams": (url) => ({
        body: url.searchParams.has("until")
          ? { teams: [{ id: "team_second", slug: "second" }], pagination: { next: null } }
          : { teams: [{ id: "team_first", slug: "first" }], pagination: { next: 123 } },
      }),
      "/v10/projects": (url) => {
        const team = url.searchParams.get("teamId");
        if (!team) return { body: { projects: [], pagination: { next: null } } };
        return {
          body: url.searchParams.has("from")
            ? { projects: [{ id: `prj_${team}_two`, name: "two", link: null }], pagination: { next: null } }
            : { projects: [{ id: `prj_${team}_one`, name: "one" }], pagination: { next: "cursor_two" } },
        };
      },
    });
    const projects = await new Vercel(io(fetch)).projects();
    expect(projects).toHaveLength(4);
    expect(projects.map((p) => p.projectId)).toContain("prj_team_second_two");
    expect(sent.filter((s) => s.url.searchParams.get("until") === "123")).toHaveLength(1);
    expect(sent.filter((s) => s.url.searchParams.get("from") === "cursor_two")).toHaveLength(2);
  });

  test("a repeated cursor is rejected, never looped forever", async () => {
    const { fetch, sent } = fakeFetch({
      "/v2/teams": () => ({ body: { teams: [], pagination: { next: 123 } } }),
    });
    await expect(new Vercel(io(fetch)).projects()).rejects.toThrow("Vercel sent an answer Time Machine did not expect");
    expect(sent).toHaveLength(2);
  });
});

describe("Vercel in the browser preview", () => {
  test("starts off, links explicitly, shows preview/production matches and a separate deploy from a computer, then unlinks", async () => {
    const fake = new FakeEngine();
    const projectId = fake.project.id;
    expect(await fake.call({ method: "deployments", projectId })).toEqual({ ok: true, data: null });
    const options = await fake.call({ method: "vercelProjects" });
    expect(options.ok).toBe(true);
    if (!options.ok) return;
    const option = options.data[0];
    expect(option).toBeDefined();
    if (!option) return;
    const link = { teamId: option.teamId, projectId: option.projectId, name: option.name };
    const set = await fake.call({ method: "setFeature", projectId, change: { feature: "vercel", link } });
    expect(set.ok).toBe(true);
    const read = await fake.call({ method: "deployments", projectId });
    expect(read.ok).toBe(true);
    if (!read.ok || !read.data) throw new Error("The preview did not return linked deployments.");
    expect(read.data.matched.map((m) => m.deployment.target)).toEqual(["preview", "production"]);
    expect(read.data.matched.map((m) => m.savePoints[0]?.id)).toEqual(["cp-0002", "cp-0003"]);
    expect(read.data.noCommit).toHaveLength(1);
    expect(read.data.noCommit[0]).toMatchObject({ source: "cli", commit: null });
    const timeline = await fake.call({ method: "timeline", projectId });
    if (!timeline.ok) throw new Error("The preview did not return a timeline.");
    for (const match of read.data.matched) {
      const point = timeline.data.checkpoints.find((c) => c.id === match.savePoints[0]?.id);
      expect(match.deployment.commit).toBe(point?.head);
    }
    await fake.call({ method: "setFeature", projectId, change: { feature: "vercel", link: null } });
    expect(await fake.call({ method: "deployments", projectId })).toEqual({ ok: true, data: null });
  });
});

describe("the engine records what was agreed when a project is linked", () => {
  const noCipher: Cipher = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => "" };

  test("a link from before consent records reads nothing from Vercel; linking again records the note's version and reads", async () => {
    const { dir, ctx } = await setupDemo();
    const appDir = join(tempDir("app"), "data");
    const state = new AppState(appDir);
    const entry: ProjectEntry = { id: "6e7f8091-2b3c-4d5e-9f0a-1b2c3d4e5f60", path: dir, name: "marigold", addedAt: "2026-10-16T00:00:00Z", demo: true, features: { ask: false, vercel: LINK, autoSave: "off" }, kind: "git", purpose: "code" };
    state.updateProjects((list) => [...list, entry]);
    const { fetch, sent } = fakeFetch({ "/v7/deployments": () => ({ body: { deployments: [], pagination: { count: 0, next: null, prev: null } } }) });
    // The engine hands its fetch only to the Vercel client here, which uses FetchLike's subset (ok, status, json).
    const engineFetch = fetch as unknown as typeof globalThis.fetch;
    const engine = new Engine(state, { candidates: ["false"], version: "9.9.9" }, { credentials: new Credentials(join(dir, "..", "credentials.json"), noCipher, { VERCEL_TOKEN: TOKEN }), fetch: engineFetch });
    const before = process.env.TM_HOME;
    process.env.TM_HOME = ctx.tmHome;
    try {
      // Linked in a file written before records existed: no request leaves the Mac.
      expect(await engine.run({ method: "deployments", projectId: entry.id })).toEqual({ ok: true, data: null });
      expect(sent).toHaveLength(0);
      // Linking again stores when and which note, read back from disk, and deploys are read.
      expect((await engine.run({ method: "setFeature", projectId: entry.id, change: { feature: "vercel", link: LINK } })).ok).toBe(true);
      const stored = new AppState(appDir).find(entry.id)?.features;
      expect(stored).toMatchObject({ vercel: LINK, vercelConsent: { version: VERCEL_CONSENT_VERSION } });
      expect(Number.isNaN(Date.parse(stored?.vercelConsent?.at ?? ""))).toBe(false);
      const read = await engine.run({ method: "deployments", projectId: entry.id });
      expect(read.ok && read.data).toMatchObject({ link: LINK });
      expect(sent.map((s) => s.url.pathname)).toEqual(["/v7/deployments"]);
      // Unlinking stops reads and keeps the record of the last agreement.
      await engine.run({ method: "setFeature", projectId: entry.id, change: { feature: "vercel", link: null } });
      expect(new AppState(appDir).find(entry.id)?.features).toMatchObject({ vercel: null, vercelConsent: { version: VERCEL_CONSENT_VERSION } });
      expect(await engine.run({ method: "deployments", projectId: entry.id })).toEqual({ ok: true, data: null });
      expect(sent).toHaveLength(1);
    } finally {
      if (before === undefined) delete process.env.TM_HOME;
      else process.env.TM_HOME = before;
    }
  });
});
