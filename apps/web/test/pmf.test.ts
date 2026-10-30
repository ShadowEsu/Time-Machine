// The four-question survey (shared/pmf.ts): when the card shows, what the sheet says, and that Send, and only Send, posts
// exactly the listed fields to the site. No network: fetch is always a stand-in.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { setupDemo, tempDir } from "../../../fixtures/demo/setup.ts";
import type { AccountFetchInit } from "../src/server/account.ts";
import { Credentials, type Cipher } from "../src/server/credentials.ts";
import { Engine } from "../src/server/engine.ts";
import { AppState } from "../src/server/state.ts";
import { CallSchema, SettingsSchema, type Settings } from "../src/shared/api.ts";
import { daysSince, PMF_Q1, PMF_Q2, PMF_Q3, PMF_Q4, PMF_SENDS, pmfCardShown, pmfPayload, type PmfSettings } from "../src/shared/pmf.ts";
import { emptyPmf, pmfCardHtml, pmfSheetHtml, type PmfView } from "../src/renderer/pmf.ts";
import { FakeEngine } from "../preview/fake.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);
const FIELDS = ["appVersion", "installId", "q1", "q2", "q3", "q4"];
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const noCipher: Cipher = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => "" };

const settings = (extra: Partial<PmfSettings> = {}): PmfSettings => ({ firstUseAt: new Date(NOW - DAY).toISOString(), askCount: 0, pmf: {}, ...extra });
const free = { session: false, blocked: false };

describe("when the card shows", () => {
  test("after the 5th successful Ask, not the 4th", () => {
    expect(pmfCardShown(settings({ askCount: 4 }), NOW, free)).toBe(false);
    expect(pmfCardShown(settings({ askCount: 5 }), NOW, free)).toBe(true);
  });

  test("7 days after first use, not 6, whichever comes first", () => {
    expect(pmfCardShown(settings({ firstUseAt: new Date(NOW - 6.9 * DAY).toISOString() }), NOW, free)).toBe(false);
    expect(pmfCardShown(settings({ firstUseAt: new Date(NOW - 7 * DAY).toISOString() }), NOW, free)).toBe(true);
    expect(pmfCardShown(settings({ firstUseAt: null }), NOW, free)).toBe(false);
    expect(daysSince(new Date(NOW + DAY).toISOString(), NOW)).toBe(0);
  });

  test("once: it stays for the session it first showed in, and never comes back in a later one", () => {
    const shown = settings({ askCount: 5, pmf: { shownAt: new Date(NOW - 60_000).toISOString() } });
    expect(pmfCardShown(shown, NOW, { session: true, blocked: false })).toBe(true);
    expect(pmfCardShown(shown, NOW + 30 * DAY, { session: false, blocked: false })).toBe(false);
  });

  test("No thanks and Send close it for good, in this session too", () => {
    for (const pmf of [{ closedAt: new Date(NOW).toISOString() }, { sentAt: new Date(NOW).toISOString() }]) {
      expect(pmfCardShown(settings({ askCount: 9, pmf }), NOW, { session: true, blocked: false })).toBe(false);
    }
  });

  test("never while work is in progress or a sheet is open", () => {
    expect(pmfCardShown(settings({ askCount: 5 }), NOW, { session: false, blocked: true })).toBe(false);
    expect(pmfCardShown(settings({ askCount: 5 }), NOW, { session: true, blocked: true })).toBe(false);
  });

  test("the window draws it only where it is not blocked, and records shownAt the first time", () => {
    const app = readFileSync(new URL("../src/renderer/app.ts", import.meta.url), "utf8");
    const card = app.slice(app.indexOf("function pmfCard(): string {"), app.indexOf("async function sendPmf"));
    for (const flag of ["st.busy", "st.rewind", "st.check", "st.hookSheet", "st.confirm", "st.palette", "st.keysSheet", "st.navOpen", "st.demoBusy", 'st.screen === "onboarding"']) expect(card).toContain(flag);
    expect(card).toContain("shownAt");
    // Inline on History and Overview, never over the page.
    expect(app).toContain("${coachView()}${pmfCard()}");
    expect(app).toContain("notice: pmfCard()");
  });
});

describe("the card and the sheet", () => {
  const view = (extra: Partial<PmfView> = {}): PmfView => ({ ...emptyPmf(), open: true, ...extra });

  test("the card is inline, with Answer 4 questions and a one-click No thanks", () => {
    const html = pmfCardHtml();
    expect(html).not.toContain("scrim");
    expect(html).not.toContain('role="dialog"');
    expect(html).toContain('data-act="pmf-open">Answer 4 questions</button>');
    expect(html).toContain('data-act="pmf-no">No thanks</button>');
  });

  test("the sheet asks the four questions in the exact wording, Q1 with its four answers, Q2 to Q4 optional and capped", () => {
    expect([PMF_Q1, PMF_Q2, PMF_Q3, PMF_Q4]).toEqual([
      "How would you feel if you could no longer use Time Machine?",
      "What type of people do you think would most benefit from Time Machine?",
      "What is the main benefit you receive from Time Machine?",
      "How can we improve Time Machine for you?",
    ]);
    const html = pmfSheetHtml(view(), "", undefined);
    for (const q of [PMF_Q1, PMF_Q2, PMF_Q3, PMF_Q4]) expect(html).toContain(q);
    for (const a of ["Very disappointed", "Somewhat disappointed", "Not disappointed", "N/A, I no longer use it"]) expect(html).toContain(`<div class="t">${a}</div>`);
    expect(html.match(/type="radio"/g)).toHaveLength(4);
    expect(html.match(/<textarea\b[^>]*maxlength="2000"/g)).toHaveLength(3);
    expect(html.match(/Optional/g)).toHaveLength(3);
    expect(html).not.toMatch(/\bchecked\b/);
  });

  test("the consent line next to Send names exactly what is sent, that nothing else is, and what to leave out", () => {
    expect(PMF_SENDS).toBe(
      "Send shares your answers, the app version and a random survey ID made for this computer (not taken from your hardware, your name or your folders) with the Time Machine team. Nothing is sent until you press Send, and nothing else is sent. Closing this sends nothing. Don’t include passwords, keys or other people’s personal details.",
    );
    expect(PMF_SENDS).not.toContain("—");
    const html = pmfSheetHtml(view(), "", undefined);
    const consent = html.indexOf('id="pmf-consent"');
    const send = html.indexOf(">Send</button>");
    expect(consent).toBeGreaterThan(0);
    expect(send).toBeGreaterThan(consent);
    expect(html).toContain('aria-describedby="pmf-consent"');
  });

  test("typed answers come back escaped, an error keeps them, and a sent sheet only thanks", () => {
    const attack = `<img src=x onerror="alert(1)">`;
    const html = pmfSheetHtml(view({ draft: { q1: "somewhat", q2: attack, q3: "", q4: "" }, error: "Could not reach the Time Machine site." }), "", undefined);
    expect(html).not.toContain(attack);
    expect(html).toContain("&lt;img src=x");
    expect(html).toMatch(/id="pmf-q1-somewhat"[^>]*checked/);
    expect(html).toContain('role="alert">Could not reach the Time Machine site.');
    const thanks = pmfSheetHtml(view({ sent: true }), "", "11111111-1111-4111-8111-111111111111");
    expect(thanks).toContain("Your answers were sent.");
    // The survey ID, so it can be quoted to have the answers deleted.
    expect(thanks).toContain('<code class="mono sel-text pmf-id">11111111-1111-4111-8111-111111111111</code>');
    expect(thanks).toContain("To have your answers deleted, email this ID");
    expect(thanks).not.toContain("<textarea");
    expect(pmfSheetHtml(view({ open: false }), "", undefined)).toBe("");
    const app = readFileSync(new URL("../src/renderer/app.ts", import.meta.url), "utf8");
    expect(app).toContain('setRow("Survey answers", `Sent ${esc(when(s.pmf.sentAt))}. ${pmfIdHtml(s.pmf.installId)}`)');
  });
});

describe("what Send posts", () => {
  test("pmfPayload has exactly the four answers, the survey ID and the app version, answers trimmed and cut to 2000 characters", () => {
    const p = pmfPayload({ q1: "very", q2: `  ${"a".repeat(2200)} `, q3: " fast ", q4: "" }, { installId: "11111111-1111-4111-8111-111111111111", appVersion: "0.1.0" });
    expect(Object.keys(p).sort()).toEqual(FIELDS);
    expect(p.q2).toHaveLength(2000);
    expect(p.q3).toBe("fast");
  });

  test("the call takes Q1 and three answers of at most 2000 characters, nothing else", () => {
    const ok = { method: "sendFeedback", answers: { q1: "na", q2: "", q3: "", q4: "x".repeat(2000) } };
    expect(CallSchema.safeParse(ok).success).toBe(true);
    expect(CallSchema.safeParse({ ...ok, answers: { ...ok.answers, q4: "x".repeat(2001) } }).success).toBe(false);
    expect(CallSchema.safeParse({ ...ok, answers: { ...ok.answers, q1: "love" } }).success).toBe(false);
    expect(CallSchema.safeParse({ ...ok, answers: { ...ok.answers, installId: "x" } }).success).toBe(false);
    expect(CallSchema.safeParse({ ...ok, askCount: 3 }).success).toBe(false);
  });

  function setup(respond: () => Response | Promise<Response>) {
    const dir = tempDir("pmf");
    const site = "http://localhost:3000";
    const before = process.env.TM_SITE_ORIGIN;
    process.env.TM_SITE_ORIGIN = site;
    const fetch = vi.fn(async (_url: string, _init: AccountFetchInit) => respond());
    const state = new AppState(join(dir, "data"));
    const engine = new Engine(state, { candidates: ["false"], version: "0.1.0" }, { credentials: new Credentials(join(dir, "credentials.json"), noCipher, {}), fetch: fetch as unknown as typeof globalThis.fetch });
    const restore = () => {
      if (before === undefined) delete process.env.TM_SITE_ORIGIN;
      else process.env.TM_SITE_ORIGIN = before;
    };
    return { dir, site, fetch, state, engine, restore };
  }
  const answers = { q1: "very" as const, q2: " people who ship with Claude Code ", q3: "I get my working version back", q4: "" };

  test("Send posts exactly the answers, the survey ID and the app version, to /api/feedback on the site, then records sentAt", async () => {
    const { dir, site, fetch, state, engine, restore } = setup(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    try {
      state.markFirstUse(new Date(Date.now() - 8 * DAY));
      state.countAsk();
      state.countAsk();
      const events: Settings[] = [];
      engine.onEvent((e) => e.type === "settings" && events.push(e.settings));
      // Nothing is sent before Send: reading statuses and the counts that trigger the card never reach the site.
      await engine.run({ method: "statuses" });
      expect(fetch).not.toHaveBeenCalled();
      const r = await engine.run({ method: "sendFeedback", answers });
      expect(r.ok).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = fetch.mock.calls[0]!;
      expect(url).toBe(`${site}/api/feedback`);
      expect(init.method).toBe("POST");
      expect(init.headers.origin).toBe(site);
      expect(init.headers.authorization).toBeUndefined();
      const body = z.record(z.string(), z.unknown()).parse(JSON.parse(init.body ?? "{}"));
      expect(Object.keys(body).sort()).toEqual(FIELDS);
      const saved = new AppState(join(dir, "data")).settings;
      // The Ask count and the first-use date stay on this computer.
      expect(body).toEqual({ q1: "very", q2: "people who ship with Claude Code", q3: "I get my working version back", q4: "", installId: saved.pmf.installId, appVersion: "0.1.0" });
      expect(saved.pmf.installId).toMatch(UUID_V4);
      expect(Number.isNaN(Date.parse(saved.pmf.sentAt ?? ""))).toBe(false);
      expect(events.at(-1)?.pmf.sentAt).toBe(saved.pmf.sentAt);
      // Once sent, never again.
      expect(await engine.run({ method: "sendFeedback", answers })).toMatchObject({ ok: false, error: { kind: "usage" } });
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  test("a failed Send says so honestly, records no sentAt, and a retry sends the same random ID", async () => {
    let status = 502;
    const { fetch, state, engine, restore } = setup(() => new Response(JSON.stringify(status === 200 ? { ok: true } : { ok: false, error: status === 409 ? "already_answered" : "upstream" }), { status }));
    try {
      const fail = await engine.run({ method: "sendFeedback", answers });
      expect(fail).toEqual({ ok: false, error: { kind: "usage", message: "The Time Machine site had a problem. Try again in a minute." } });
      expect(state.readSettings().pmf.sentAt).toBeUndefined();
      const id = state.readSettings().pmf.installId;
      expect(id).toMatch(UUID_V4);
      status = 409;
      expect(await engine.run({ method: "sendFeedback", answers })).toMatchObject({ ok: false, error: { message: "This computer already sent answers in the last 90 days, so these were not sent." } });
      status = 200;
      expect((await engine.run({ method: "sendFeedback", answers })).ok).toBe(true);
      const ids = fetch.mock.calls.map(([, init]) => z.object({ installId: z.string() }).parse(JSON.parse(init.body ?? "{}")).installId);
      expect(ids).toEqual([id, id, id]);
    } finally {
      restore();
    }
  });

  test("an answer that looks like a key or password blocks Send before anything leaves", async () => {
    const { fetch, state, engine, restore } = setup(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    try {
      // Built at run time, so no key-shaped text sits in the source for scanners to flag.
      const leaks = [`my key is ${["sk", "live", "0123456789abcdefABCD"].join("_")}`, `export ${"API"}_${"KEY"}=abc123xyz789`, `postgres://app:${"hunter22"}@db.example.test/app`, `${"AK"}IA${"ABCDEFGHIJKLMNOP"}`];
      for (const leak of leaks) {
        for (const q of ["q2", "q3", "q4"] as const) {
          const r = await engine.run({ method: "sendFeedback", answers: { ...answers, [q]: leak } });
          expect(r).toEqual({ ok: false, error: { kind: "usage", message: "That looks like a key or password. Take it out and try again." } });
        }
      }
      expect(fetch).not.toHaveBeenCalled();
      expect(state.readSettings().pmf).toEqual({});
    } finally {
      restore();
    }
  });

  test("an answer holding a secret value from a project's config files blocks Send too", async () => {
    const { fetch, state, engine, restore } = setup(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const { dir, ctx } = await setupDemo();
    const before = process.env.TM_HOME;
    process.env.TM_HOME = ctx.tmHome;
    try {
      // Not shaped like a key: only the project's .env says it is secret.
      writeFileSync(join(dir, ".env"), "DB_HINT=marigold-river-otter\n");
      state.updateProjects(() => [{ id: "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b", path: dir, name: "demo", addedAt: new Date().toISOString(), demo: false, features: { ask: false, vercel: null, autoSave: "off" }, kind: "git", purpose: "code" }]);
      const r = await engine.run({ method: "sendFeedback", answers: { ...answers, q4: "it broke when the hint was marigold-river-otter" } });
      expect(r).toMatchObject({ ok: false, error: { message: "That looks like a key or password. Take it out and try again." } });
      expect(fetch).not.toHaveBeenCalled();
      expect((await engine.run({ method: "sendFeedback", answers })).ok).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      if (before === undefined) delete process.env.TM_HOME;
      else process.env.TM_HOME = before;
      restore();
    }
  });

  test("No thanks and marking the card shown make 0 site calls of any kind", async () => {
    const { fetch, state, engine, restore } = setup(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const global = vi.spyOn(globalThis, "fetch");
    try {
      // The window's only calls for the card are setSettings with shownAt, then with closedAt; tm ui's server answers
      // them with state.updateSettings (packages/cli/src/ui/server.ts), which writes a local file and nothing else.
      state.updateSettings({ pmf: { shownAt: new Date().toISOString() } });
      state.updateSettings({ pmf: { closedAt: new Date().toISOString() } });
      await engine.run({ method: "statuses" });
      expect(state.readSettings().pmf.closedAt).toBeDefined();
      // Neither the site client's fetch nor the process's fetch saw any request, to any path.
      expect(fetch).toHaveBeenCalledTimes(0);
      expect(global).toHaveBeenCalledTimes(0);
    } finally {
      global.mockRestore();
      restore();
    }
  });

  test("closing the sheet (Cancel or Close, Esc, a click outside) makes no call at all, so 0 site calls", () => {
    const app = readFileSync(new URL("../src/renderer/app.ts", import.meta.url), "utf8");
    const close = app.slice(app.indexOf('case "pmf-close":'), app.indexOf('case "pmf-q1":'));
    const esc = app.slice(app.indexOf("else if (st.pmf.open) {"), app.indexOf("else if (st.check && (st.check.phase"));
    const scrimAt = app.indexOf('if (target.classList.contains("scrim") && st.pmf.open) {');
    const scrim = app.slice(scrimAt, app.indexOf("return;\n    }", scrimAt));
    for (const block of [close, esc, scrim]) {
      expect(block).toContain("st.pmf.open = false;");
      expect(block).not.toMatch(/\b(?:call|setSetting|sendPmf|fetch|bridge)\s*\(/);
    }
  });

  test("the preview sends nothing", async () => {
    const r = await new FakeEngine().call({ method: "sendFeedback", answers });
    expect(r).toMatchObject({ ok: false });
  });
});

describe("settings", () => {
  test("a settings file from before the survey still loads, keeps its choices, and gets the new keys' defaults", () => {
    const dir = join(tempDir("pmf-old"), "data");
    new AppState(dir);
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ showGitDetails: true, theme: "dark", onboarded: true, simpleRewind: false, verdictTipSeen: true, setupHidden: [], reduceMotion: false }));
    const s = new AppState(dir).settings;
    expect(s).toMatchObject({ showGitDetails: true, theme: "dark", verdictTipSeen: true, firstUseAt: null, askCount: 0, pmf: {} });
  });

  test("firstUseAt is set once, by the first start", () => {
    const state = new AppState(join(tempDir("pmf-first"), "data"));
    const first = state.markFirstUse(new Date(NOW)).firstUseAt;
    expect(first).toBe(new Date(NOW).toISOString());
    expect(state.markFirstUse(new Date(NOW + 10 * DAY)).firstUseAt).toBe(first);
  });

  test("the window may mark the survey shown or closed, never sent, and a mark keeps the ID", () => {
    const state = new AppState(join(tempDir("pmf-marks"), "data"));
    state.updateSettings({ pmf: { installId: "11111111-1111-4111-8111-111111111111" } });
    const patch = { pmf: { shownAt: new Date(NOW).toISOString() } };
    expect(CallSchema.safeParse({ method: "setSettings", patch }).success).toBe(true);
    expect(state.updateSettings(patch).pmf).toEqual({ installId: "11111111-1111-4111-8111-111111111111", shownAt: new Date(NOW).toISOString() });
    for (const bad of [{ pmf: { sentAt: new Date(NOW).toISOString() } }, { pmf: { installId: "11111111-1111-4111-8111-111111111111" } }, { firstUseAt: null }, { askCount: 0 }]) {
      expect(CallSchema.safeParse({ method: "setSettings", patch: bad }).success).toBe(false);
    }
    expect(SettingsSchema.safeParse({ pmf: { installId: "not-a-uuid" } }).success).toBe(false);
  });
});
