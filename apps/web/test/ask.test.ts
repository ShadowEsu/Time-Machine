// Ask about your history (ADR 0008): what is sent to Gemini, opt-in, keys, and every way the
// reply can fail. No network: fetch is always a stand-in.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import * as tm from "@timetm/core";
import { FAKE_SECRET } from "../../../packages/core/src/demo-project.ts";
import { setupDemo, tempDir } from "../../../fixtures/demo/setup.ts";
import { ANTHROPIC_MODEL, ANTHROPIC_URL, askHistory, buildContext, gatherFacts, GEMINI_MODEL, GEMINI_URL, MAX_POINTS, parseAnswer, type AskDeps } from "../src/server/ask.ts";
import { Credentials, readDevEnv, type Cipher } from "../src/server/credentials.ts";
import { Engine } from "../src/server/engine.ts";
import { AppState } from "../src/server/state.ts";
import { CallSchema, type ProjectEntry } from "../src/shared/api.ts";
import { ASK_CONSENT, ASK_CONSENT_ANTHROPIC, ASK_CONSENT_VERSION, ASK_EXAMPLES, askConsentText, askConsentValid } from "../src/shared/ask.ts";
import { createHash } from "node:crypto";
import { FakeEngine } from "../preview/fake.ts";

const KEY = "test-gemini-key-not-real";
const ANTHROPIC_KEY = "test-anthropic-key-not-real";
/** A value that does not look like a key. Only the project's .env says it is secret. */
const ENV_VALUE = "marigold-river-otter";
const CONTENT = "CONTENT-MARKER-42";

interface Seeded {
  dir: string;
  ctx: tm.Ctx;
  entry: ProjectEntry;
}
let shared: Promise<Seeded> | null = null;

/**
 * A demo project with a secret value in .env, a note and a file that would leak it, and a
 * checked save point. Built once: every test only reads it.
 */
function seeded(): Promise<Seeded> {
  shared ??= (async () => {
    const { dir, ctx } = await setupDemo();
    writeFileSync(join(dir, ".env"), `PORT=3000\nDB_HINT=${ENV_VALUE}\nSTRIPE_SECRET_KEY=${FAKE_SECRET}\n`);
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(join(dir, "docs", "notes.txt"), `${CONTENT}\n`);
    await tm.checkpoint(ctx, { note: `Pointed the app at ${ENV_VALUE}` });
    await tm.verify(ctx, "cp-0003");
    const entry: ProjectEntry = { id: "5d6e7f80-1a2b-4c3d-8e9f-0a1b2c3d4e5f", path: dir, name: "marigold", addedAt: "2026-10-16T00:00:00Z", demo: true, features: { ask: true, askConsent: { at: "2026-10-27T00:00:00Z", version: ASK_CONSENT_VERSION, provider: "gemini" }, vercel: null, autoSave: "off" }, kind: "git", purpose: "code" };
    return { dir, ctx, entry };
  })();
  return shared;
}

/** The same project, agreed to for Claude instead of Gemini. */
const forClaude = (e: ProjectEntry): ProjectEntry => ({ ...e, features: { ...e.features, askConsent: { at: "2026-10-27T00:00:00Z", version: ASK_CONSENT_VERSION, provider: "anthropic" } } });

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function fakeFetch(respond: (init: RequestInit) => Response | Promise<Response>): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const f = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    sent.push({ url: String(input), headers: Object.fromEntries(new Headers(init.headers).entries()), body: typeof init.body === "string" ? init.body : "" });
    return respond(init);
  };
  return { fetch: f as typeof fetch, sent };
}

function interaction(text: string, status = "completed"): Response {
  const body = { id: "v1_x", status, steps: [{ type: "thought" }, { type: "model_output", content: [{ type: "text", text }] }] };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

const answer = (a: string, cites: string[]): Response => interaction(JSON.stringify({ answer: a, cites }));

describe("the history sent to Gemini", () => {
  test("has times, titles, agents, checks and changed paths, and never secrets, file contents or check output", async () => {
    const { ctx, entry } = await seeded();
    const { text, ids } = buildContext(await gatherFacts(ctx, entry.name));
    expect(ids).toEqual(["cp-0001", "cp-0002", "cp-0003", "cp-0004", "cp-0005", "cp-0006", "cp-0007"]);
    expect(text).toContain("id cp-0003");
    expect(text).toContain("title: Added dark mode");
    expect(text).toContain("result: PASS | check: node --test, exit code 0");
    expect(text).toContain("result: not checked");
    expect(text).toMatch(/changed since cp-0006: \d+ files? \([^)]*added docs\/notes\.txt/);
    expect(text).toContain("not saved:");
    // The note held a secret value from .env, so it is left out. The save point itself stays.
    expect(text).toContain("id cp-0007");
    expect(text).not.toContain(ENV_VALUE);
    expect(text).not.toContain(FAKE_SECRET);
    expect(text).not.toContain(CONTENT);
    expect(text).not.toMatch(/# pass|# fail|# tests/);
  });

  test("drops agent prompts, notes, commands and paths that look like secrets, even if they got past the engine", async () => {
    const { ctx, entry } = await seeded();
    const facts = await gatherFacts(ctx, entry.name);
    const [first, ...rest] = facts.checkpoints;
    if (!first) throw new Error("no save points");
    const leaky = { ...first, note: `deploy with ${FAKE_SECRET}`, agent: { name: "Claude Code", prompt: `use ${ENV_VALUE} for the db` } };
    const checks = new Map(facts.checks).set(first.id, { command: `API_TOKEN=${FAKE_SECRET} npm test`, exitCode: 0 });
    const diffs = new Map(facts.diffs);
    const second = rest[0];
    if (second) diffs.set(second.id, { a: first.id, b: second.id, code: [{ status: "A", path: `keys/${FAKE_SECRET}.txt` }, { status: "M", path: "src/tips.js" }], files: { added: [], removed: [], changed: [] }, config: { added: [], removed: [], changed: [] }, dependencies: { changed: [] }, environment: { changed: [] } });
    const { text } = buildContext({ ...facts, checkpoints: [leaky, ...rest], checks, diffs });
    expect(text).not.toContain(FAKE_SECRET);
    expect(text).not.toContain(ENV_VALUE);
    expect(text).toContain("check: (command hidden), exit code 0");
    expect(text).toContain("changed since cp-0001: 2 files (changed src/tips.js, and 1 more)");
  });

  test(`sends only the newest ${MAX_POINTS} save points`, async () => {
    const { ctx, entry } = await seeded();
    const facts = await gatherFacts(ctx, entry.name);
    const base = facts.checkpoints[0];
    if (!base) throw new Error("no save points");
    const many = Array.from({ length: 60 }, (_, i) => ({ ...base, id: `cp-${String(i + 1).padStart(4, "0")}` }));
    const { text, ids } = buildContext({ ...facts, total: 60, checkpoints: many });
    expect(ids).toHaveLength(MAX_POINTS);
    expect(text).toContain(`the newest ${MAX_POINTS} of 60`);
  });
});

describe("asking", () => {
  test("refuses unless Ask is on for the project, and sends nothing", async () => {
    const { ctx, entry } = await seeded();
    const { fetch, sent } = fakeFetch(() => answer("x", []));
    await expect(askHistory({ ...entry, features: { ask: false, vercel: null, autoSave: "off" } }, ctx, "When did it last work?", { key: KEY, fetch })).rejects.toThrow(/off for marigold/);
    await expect(askHistory(entry, ctx, "When did it last work?", { key: null, anthropicKey: null, fetch })).rejects.toThrow(/Add a Gemini API key in Settings, or set GEMINI_API_KEY or ANTHROPIC_API_KEY/);
    expect(sent).toHaveLength(0);
  });

  test("refuses a question that holds a secret value, and sends nothing", async () => {
    const { ctx, entry } = await seeded();
    const { fetch, sent } = fakeFetch(() => answer("x", []));
    await expect(askHistory(entry, ctx, `Did ${ENV_VALUE} change?`, { key: KEY, fetch })).rejects.toThrow(/holds a secret/);
    expect(sent).toHaveLength(0);
  });

  test("sends one request to the documented endpoint and returns the answer with known cites", async () => {
    const { ctx, entry } = await seeded();
    const { fetch, sent } = fakeFetch(() => answer("It last worked at the save at 10:42, Added dark mode \u2014 its check passed.", ["cp-0003", "cp-9999", "cp-0001", "cp-0003"]));
    const r = await askHistory(entry, ctx, "When did it last work?", { key: KEY, fetch });
    expect(r).toEqual({ answer: "It last worked at the save at 10:42, Added dark mode, its check passed.", cites: ["cp-0001", "cp-0003"], basis: 7 });
    expect(sent).toHaveLength(1);
    const req = sent[0];
    if (!req) throw new Error("no request");
    expect(req.url).toBe(GEMINI_URL);
    expect(req.headers["x-goog-api-key"]).toBe(KEY);
    const body: unknown = JSON.parse(req.body);
    expect(body).toMatchObject({ model: GEMINI_MODEL, store: false, input: expect.stringMatching(/Question: When did it last work\?$/), response_format: { type: "text", mime_type: "application/json" } });
    expect(req.body).not.toContain(KEY);
    expect(req.body).not.toContain(ENV_VALUE);
    expect(req.body).not.toContain(FAKE_SECRET);
    expect(req.body).not.toContain(CONTENT);
  });

  test.each([
    [401, /did not accept the API key/],
    [403, /did not accept the API key/],
    [429, /reached its limit/],
    [503, /having trouble/],
    [418, /HTTP 418/],
  ])("HTTP %i becomes a plain sentence", async (status, message) => {
    const { ctx, entry } = await seeded();
    const { fetch } = fakeFetch(() => new Response(JSON.stringify({ error: { message: `raw details for ${KEY}` } }), { status }));
    const err = await askHistory(entry, ctx, "What changed?", { key: KEY, fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(tm.TmError);
    const text = err instanceof Error ? err.message : "";
    expect(text).toMatch(message);
    expect(text).not.toContain(KEY);
  });

  test("with only an Anthropic key: one Messages request with the same history and redaction, and the JSON in the reply is read", async () => {
    const { ctx, entry } = await seeded();
    const reply = { id: "msg_x", type: "message", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: '```json\n{"answer": "It last worked at the save at 10:42.", "cites": ["cp-0003"]}\n```' }] };
    const { fetch, sent } = fakeFetch(() => new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } }));
    const r = await askHistory(forClaude(entry), ctx, "When did it last work?", { key: null, anthropicKey: ANTHROPIC_KEY, fetch });
    expect(r).toEqual({ answer: "It last worked at the save at 10:42.", cites: ["cp-0003"], basis: 7 });
    const req = sent[0];
    if (!req) throw new Error("no request");
    expect(sent).toHaveLength(1);
    expect(req.url).toBe(ANTHROPIC_URL);
    expect(req.headers).toMatchObject({ "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" });
    const body: unknown = JSON.parse(req.body);
    expect(body).toMatchObject({ model: ANTHROPIC_MODEL, max_tokens: 2048, system: expect.stringContaining("Answer only from the history"), messages: [{ role: "user", content: expect.stringMatching(/Question: When did it last work\?$/) }] });
    for (const leak of [ANTHROPIC_KEY, ENV_VALUE, FAKE_SECRET, CONTENT]) expect(req.body).not.toContain(leak);
    // The same facts as the Gemini request: only the envelope differs.
    const gemini = fakeFetch(() => answer("x", []));
    await askHistory(entry, ctx, "When did it last work?", { key: KEY, anthropicKey: ANTHROPIC_KEY, fetch: gemini.fetch });
    expect(gemini.sent[0]?.url).toBe(GEMINI_URL);
    const claudeInput = z.object({ messages: z.array(z.object({ content: z.string() })).length(1) }).parse(body).messages[0]?.content;
    expect(JSON.parse(gemini.sent[0]?.body ?? "{}")).toMatchObject({ input: claudeInput });
  });

  test("TM_ASK_MODEL picks the Claude model, and Anthropic errors are plain sentences without the key", async () => {
    const { ctx, entry } = await seeded();
    const missing = fakeFetch(() => new Response(JSON.stringify({ type: "error", error: { message: `bad ${ANTHROPIC_KEY}` } }), { status: 404 }));
    const err = await askHistory(forClaude(entry), ctx, "What changed?", { key: null, anthropicKey: ANTHROPIC_KEY, anthropicModel: "claude-haiku-4-5", fetch: missing.fetch }).catch((e: unknown) => e);
    expect(JSON.parse(missing.sent[0]?.body ?? "{}")).toMatchObject({ model: "claude-haiku-4-5" });
    expect(err instanceof Error && err.message).toBe("Claude does not offer the model claude-haiku-4-5. Check TM_ASK_MODEL, or unset it to use claude-sonnet-4-5.");
    const denied = fakeFetch(() => new Response("{}", { status: 401 }));
    await expect(askHistory(forClaude(entry), ctx, "What changed?", { key: null, anthropicKey: ANTHROPIC_KEY, fetch: denied.fetch })).rejects.toThrow("Claude did not accept the API key. Check ANTHROPIC_API_KEY.");
    const cut = fakeFetch(() => new Response(JSON.stringify({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"answer": "It' }] }), { status: 200 }));
    await expect(askHistory(forClaude(entry), ctx, "What changed?", { key: null, anthropicKey: ANTHROPIC_KEY, fetch: cut.fetch })).rejects.toThrow(/Claude stopped before the answer was finished/);
  });

  test("consent is per service and per consent text: anything else sends nothing", async () => {
    const { ctx, entry } = await seeded();
    const { fetch, sent } = fakeFetch(() => answer("x", []));
    const refused = /changed since Ask was turned on for marigold\. Nothing was sent\./;
    // Agreed for Gemini, but only an Anthropic key is set now.
    await expect(askHistory(entry, ctx, "What changed?", { key: null, anthropicKey: ANTHROPIC_KEY, fetch })).rejects.toThrow(refused);
    // Agreed to an older consent text.
    const old = { ...entry, features: { ...entry.features, askConsent: { at: "2026-01-01T00:00:00Z", version: "2026-01-01", provider: "gemini" as const } } };
    await expect(askHistory(old, ctx, "What changed?", { key: KEY, fetch })).rejects.toThrow(refused);
    // Turned on before consent records existed.
    const { askConsent: _drop, ...before } = entry.features;
    await expect(askHistory({ ...entry, features: before }, ctx, "What changed?", { key: KEY, fetch })).rejects.toThrow(refused);
    expect(sent).toHaveLength(0);
  });

  test("the consent screen names the service Ask would use", () => {
    expect(askConsentText("anthropic")).toMatchObject({ where: ASK_CONSENT_ANTHROPIC.where, termsUrl: ASK_CONSENT_ANTHROPIC.termsUrl, sent: ASK_CONSENT.sent });
    expect(askConsentText("gemini").where).toBe(ASK_CONSENT.where);
    expect(askConsentText(null).termsUrl).toBe(ASK_CONSENT.termsUrl);
    expect(askConsentValid({ ask: false, askConsent: { at: "x", version: ASK_CONSENT_VERSION, provider: "gemini" } }, "gemini")).toBe(false);
  });

  test("changing the consent text means raising ASK_CONSENT_VERSION", () => {
    // If this fails, the words people agree to changed: raise ASK_CONSENT_VERSION, then update both values here.
    const digest = createHash("sha256").update(JSON.stringify([ASK_CONSENT, ASK_CONSENT_ANTHROPIC])).digest("hex").slice(0, 16);
    expect({ version: ASK_CONSENT_VERSION, digest }).toEqual({ version: "2026-10-27", digest: "df2eeeb9841c11f8" });
  });

  test("a request that takes too long is stopped", async () => {
    const { ctx, entry } = await seeded();
    const { fetch } = fakeFetch(
      (init) => new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
    );
    const deps: AskDeps = { key: KEY, fetch, timeoutMs: 50 };
    await expect(askHistory(entry, ctx, "What changed?", deps)).rejects.toThrow(/did not answer within/);
  });

  test("no connection becomes a plain sentence", async () => {
    const { ctx, entry } = await seeded();
    const { fetch } = fakeFetch(() => Promise.reject(new TypeError("fetch failed")));
    await expect(askHistory(entry, ctx, "What changed?", { key: KEY, fetch })).rejects.toThrow(/Could not reach Gemini/);
  });

  test.each([
    ["a reply that is not JSON", () => interaction("Sure! It worked at 10:42.")],
    ["JSON without cites", () => interaction(JSON.stringify({ answer: "It worked." }))],
    ["an empty answer", () => answer("  ", [])],
    ["a body that is not an interaction", () => new Response(JSON.stringify({ hello: "world" }), { status: 200 })],
    ["a body that is not JSON", () => new Response("<html>oops</html>", { status: 200 })],
  ])("%s is never shown raw", async (_name, respond) => {
    const { ctx, entry } = await seeded();
    const { fetch } = fakeFetch(respond);
    await expect(askHistory(entry, ctx, "What changed?", { key: KEY, fetch })).rejects.toThrow(/could not read, so nothing is shown/);
  });

  test("an unfinished answer says so", async () => {
    const { ctx, entry } = await seeded();
    const { fetch } = fakeFetch(() => interaction('{"answer": "It', "incomplete"));
    await expect(askHistory(entry, ctx, "What changed?", { key: KEY, fetch })).rejects.toThrow(/stopped before the answer was finished/);
  });

  test("parseAnswer keeps cites in history order and drops ids that were not sent", () => {
    expect(parseAnswer(JSON.stringify({ answer: "I can't tell from the history.", cites: [] }), ["cp-0001"])).toEqual({ answer: "I can't tell from the history.", cites: [], basis: 1 });
    expect(parseAnswer(JSON.stringify({ answer: "a", cites: ["cp-0002", "cp-0001", "nope"] }), ["cp-0001", "cp-0002"]).cites).toEqual(["cp-0001", "cp-0002"]);
  });
});

describe("the engine", () => {
  const noCipher: Cipher = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => "" };

  test("ask goes through opt-in, uses the stored key and never returns it", async () => {
    const { dir, ctx, entry } = await seeded();
    const appDir = join(tempDir("app"), "data");
    const state = new AppState(appDir);
    state.updateProjects((list) => [...list, { ...entry, features: { ask: false, vercel: null, autoSave: "off" } }]);
    const { fetch, sent } = fakeFetch(() => answer("It last worked at the save at 10:42, Added dark mode.", ["cp-0003"]));
    const engine = new Engine(state, { candidates: ["false"], version: "9.9.9" }, { credentials: new Credentials(join(dir, "..", "credentials.json"), noCipher, { GEMINI_API_KEY: KEY }), fetch });
    const before = process.env.TM_HOME;
    process.env.TM_HOME = ctx.tmHome;
    try {
      const off = await engine.run({ method: "ask", projectId: entry.id, question: "When did it last work?" });
      expect(off).toMatchObject({ ok: false, error: { kind: "usage" } });
      expect(sent).toHaveLength(0);
      const on = await engine.run({ method: "setFeature", projectId: entry.id, change: { feature: "ask", enabled: true } });
      expect(on.ok && on.data).toMatchObject({ features: { ask: true, vercel: null } });
      // Turning it on stores what was agreed: the consent text's version and the service the key is for, read back from disk.
      const stored = new AppState(appDir).find(entry.id)?.features;
      expect(stored).toMatchObject({ ask: true, askConsent: { version: ASK_CONSENT_VERSION, provider: "gemini" } });
      expect(Number.isNaN(Date.parse(stored?.askConsent?.at ?? ""))).toBe(false);
      const r = await engine.run({ method: "ask", projectId: entry.id, question: "When did it last work?" });
      expect(r).toEqual({ ok: true, data: { answer: "It last worked at the save at 10:42, Added dark mode.", cites: ["cp-0003"], basis: 7 } });
      expect(await engine.run({ method: "credentials" })).toEqual({ ok: true, data: { gemini: true, anthropic: false, vercel: false, provider: "gemini" } });
      // Turning it off keeps the record of the last agreement, and Ask refuses again.
      await engine.run({ method: "setFeature", projectId: entry.id, change: { feature: "ask", enabled: false } });
      expect(new AppState(appDir).find(entry.id)?.features).toMatchObject({ ask: false, askConsent: { version: ASK_CONSENT_VERSION, provider: "gemini" } });
      expect(await engine.run({ method: "ask", projectId: entry.id, question: "When?" })).toMatchObject({ ok: false, error: { kind: "usage" } });
      expect(sent).toHaveLength(1);
    } finally {
      if (before === undefined) delete process.env.TM_HOME;
      else process.env.TM_HOME = before;
    }
  });

  test("with only an Anthropic key, turning Ask on records Anthropic as the service agreed to (Security T-L1)", async () => {
    const { dir, entry } = await seeded();
    const appDir = join(tempDir("app"), "data");
    const state = new AppState(appDir);
    state.updateProjects((list) => [...list, { ...entry, features: { ask: false, vercel: null, autoSave: "off" } }]);
    const engine = new Engine(state, { candidates: ["false"], version: "9.9.9" }, { credentials: new Credentials(join(dir, "..", "credentials.json"), noCipher, { ANTHROPIC_API_KEY: ANTHROPIC_KEY }), fetch: fakeFetch(() => answer("x", [])).fetch });
    await engine.run({ method: "setFeature", projectId: entry.id, change: { feature: "ask", enabled: true } });
    expect(new AppState(appDir).find(entry.id)?.features.askConsent).toMatchObject({ version: ASK_CONSENT_VERSION, provider: "anthropic" });
  });
});

describe("keys", () => {
  /** Reversible but not plain text, enough to prove the file never holds the key as written. */
  const cipher: Cipher = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s, "utf8").reverse(),
    decryptString: (b) => Buffer.from(b).reverse().toString("utf8"),
  };

  test("are stored encrypted, read back, removed, and the environment wins", () => {
    const file = join(tempDir("keys"), "credentials.json");
    const c = new Credentials(file, cipher, {});
    expect(c.status()).toEqual({ gemini: false, anthropic: false, vercel: false, provider: null });
    c.set("gemini", KEY);
    expect(readFileSync(file, "utf8")).not.toContain(KEY);
    expect(c.get("gemini")).toBe(KEY);
    expect(c.status()).toEqual({ gemini: true, anthropic: false, vercel: false, provider: "gemini" });
    expect(new Credentials(file, cipher, { GEMINI_API_KEY: "from-env" }).get("gemini")).toBe("from-env");
    c.set("gemini", null);
    expect(c.get("gemini")).toBeNull();
  });

  test("ANTHROPIC_API_KEY is read too; Ask uses it when no Gemini key is set", () => {
    const file = join(tempDir("keys"), "credentials.json");
    const c = new Credentials(file, cipher, { ANTHROPIC_API_KEY: ANTHROPIC_KEY });
    expect(c.get("anthropic")).toBe(ANTHROPIC_KEY);
    expect(c.status()).toEqual({ gemini: false, anthropic: true, vercel: false, provider: "anthropic" });
    expect(new Credentials(file, cipher, { ANTHROPIC_API_KEY: ANTHROPIC_KEY, GEMINI_API_KEY: KEY }).status().provider).toBe("gemini");
  });

  test("are not saved when this Mac can't encrypt them", () => {
    const file = join(tempDir("keys"), "credentials.json");
    const c = new Credentials(file, { ...cipher, isEncryptionAvailable: () => false }, {});
    expect(() => c.set("vercel", "tok_123456")).toThrow(/can't encrypt the Vercel token/);
    expect(c.get("vercel")).toBeNull();
  });

  test("a broken key file is set aside", () => {
    const file = join(tempDir("keys"), "credentials.json");
    writeFileSync(file, "{ not json");
    expect(new Credentials(file, cipher, {}).get("gemini")).toBeNull();
  });

  test("the development .env is read without touching process.env", () => {
    const file = join(tempDir("env"), ".env");
    writeFileSync(file, `# comment\nexport GEMINI_API_KEY="quoted-value"\nVERCEL_TOKEN=plain # note\nEMPTY=\n`);
    expect(readDevEnv(file)).toEqual({ GEMINI_API_KEY: "quoted-value", VERCEL_TOKEN: "plain", EMPTY: "" });
    expect(readDevEnv(join(tempDir("env"), "missing"))).toEqual({});
    expect(process.env.VERCEL_TOKEN === "plain").toBe(false);
  });
});

describe("the browser preview", () => {
  test("requires opt-in and answers each sample question with real demo cites, then turns off", async () => {
    const fake = new FakeEngine();
    const projectId = fake.project.id;
    const first = ASK_EXAMPLES[0];
    expect(await fake.call({ method: "ask", projectId, question: first })).toMatchObject({ ok: false });
    await fake.call({ method: "setFeature", projectId, change: { feature: "ask", enabled: true } });
    for (const question of ASK_EXAMPLES) {
      const r = await fake.call({ method: "ask", projectId, question });
      if (!r.ok) throw new Error(r.error.message);
      expect(r.data.answer.length).toBeGreaterThan(20);
      expect(r.data.cites.length).toBeGreaterThan(0);
      for (const id of r.data.cites) expect(fake.timelineEntries().some((c) => c.id === id)).toBe(true);
    }
    await fake.call({ method: "setFeature", projectId, change: { feature: "ask", enabled: false } });
    expect(await fake.call({ method: "ask", projectId, question: first })).toMatchObject({ ok: false });
  });
});

describe("contract", () => {
  test("projects saved before features existed load with everything off", () => {
    const dir = tempDir("old-projects");
    const old = { version: 1, projects: [{ id: "5d6e7f80-1a2b-4c3d-8e9f-0a1b2c3d4e5f", path: "/Users/you/code/acme", name: "acme", addedAt: "2026-10-01T00:00:00Z", demo: false }] };
    writeFileSync(join(dir, "projects.json"), JSON.stringify(old));
    const state = new AppState(dir);
    expect(state.projects).toHaveLength(1);
    expect(state.projects[0]?.features).toEqual({ ask: false, vercel: null, autoSave: "off" });
  });

  test("calls are validated before they reach the engine", () => {
    const projectId = "5d6e7f80-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
    const ok = (x: unknown): boolean => CallSchema.safeParse(x).success;
    expect(ok({ method: "ask", projectId, question: "When did it last work?" })).toBe(true);
    expect(ok({ method: "ask", projectId, question: " " })).toBe(false);
    expect(ok({ method: "ask", projectId, question: "x".repeat(501) })).toBe(false);
    expect(ok({ method: "setFeature", projectId, change: { feature: "ask", enabled: true } })).toBe(true);
    expect(ok({ method: "setFeature", projectId, change: { feature: "ask", enabled: "yes" } })).toBe(false);
    expect(ok({ method: "setFeature", projectId, change: { feature: "vercel", link: { teamId: null, projectId: "prj_abc", name: "web" } } })).toBe(true);
    expect(ok({ method: "setFeature", projectId, change: { feature: "vercel", link: { teamId: null, projectId: "../x", name: "web" } } })).toBe(false);
    expect(ok({ method: "setCredential", name: "gemini", value: "abc123" })).toBe(true);
    expect(ok({ method: "setCredential", name: "gemini", value: "abc 123" })).toBe(false);
    expect(ok({ method: "setCredential", name: "openai", value: "abc123" })).toBe(false);
    expect(ok({ method: "setCredential", name: "vercel", value: null })).toBe(true);
  });
});
