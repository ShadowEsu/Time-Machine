// The opt-in feature views: the Ask panel, Vercel deploy chips and Settings > Features. The
// markup builders are pure, so they are tested here without a window. Model text must always
// come out escaped, and only allow-listed pages may open in the browser.
import { afterEach, describe, expect, test, vi } from "vitest";
import { CallSchema, type AskResult, type DeploymentsResult, type VercelDeployment } from "../src/shared/api.ts";
import { ASK_CONSENT, ASK_EXAMPLES } from "../src/shared/ask.ts";
import { esc, when } from "../src/shared/format.ts";
import { isAllowedExternal } from "../src/shared/links.ts";
import { answerHtml, askPanelHtml, citeChip, type AskView, type CitedPoint } from "../src/renderer/ask-panel.ts";
import { chipsByCheckpoint, deployChip, deployLink, renderDeployChips, unlinkedHtml } from "../src/renderer/deploys.ts";
import { featureSettingsHtml, type FeatureSettingsView } from "../src/renderer/feature-settings.ts";
import { FakeEngine, previewStory } from "../preview/fake.ts";

const PROJECT = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const T1 = "2026-10-16T10:42:00.000Z";
const T2 = "2026-10-16T11:05:00.000Z";
const POINTS: ReadonlyMap<string, CitedPoint> = new Map([
  ["cp-0003", { verdict: "PASS", createdAt: T1 }],
  ["cp-0006", { verdict: "FAIL", createdAt: T2 }],
]);
const ATTACK = `<img src=x onerror="alert(1)"><script>alert('x')</script>`;

function view(extra: Partial<AskView> = {}): AskView {
  return { phase: "on", hasKey: true, turns: [], points: POINTS, menuOpen: false, busy: false, problem: null, canOpenSettings: true, ...extra };
}

function deployment(id: string, extra: Partial<VercelDeployment> = {}): VercelDeployment {
  return {
    id, url: `https://${id.replace("_", "-")}.vercel.app`, target: "preview", state: "READY", createdAt: T1, creator: "sam", source: "git",
    commit: "a".repeat(40), branch: "main", dirty: false, inspectorUrl: `https://vercel.com/acme/marigold/${id}`, ...extra,
  };
}

describe("pages the app opens in the browser", () => {
  test("allows Vercel deploys, vercel.com and the Gemini terms", () => {
    for (const ok of ["https://marigold-git-main-acme.vercel.app", "https://marigold-preview.vercel.app/checkout?x=1", "https://vercel.com/acme/marigold/dpl_1", "https://vercel.com/account/tokens", ASK_CONSENT.termsUrl]) {
      expect(isAllowedExternal(ok), ok).toBe(true);
    }
  });

  test("refuses everything else, including look-alikes, logins, ports and other schemes", () => {
    for (const bad of [
      "http://marigold.vercel.app", "https://vercel.app", "https://marigold.vercel.app.evil.com", "https://vercel.com.evil.com/x",
      "https://evil.com/?u=https://vercel.com", "https://user:pw@marigold.vercel.app", "https://marigold.vercel.app:8443", "https://www.vercel.com/x",
      "javascript:alert(1)", "file:///etc/passwd", "https://ai.google.dev/other", "https://-bad.vercel.app", "not a url", "",
    ]) {
      expect(isAllowedExternal(bad), bad).toBe(false);
    }
  });

  test("the openExternal call is validated by the same allow list", () => {
    expect(CallSchema.safeParse({ method: "openExternal", url: "https://marigold.vercel.app" }).success).toBe(true);
    expect(CallSchema.safeParse({ method: "openExternal", url: "https://evil.com" }).success).toBe(false);
    expect(CallSchema.safeParse({ method: "openExternal", url: "https://marigold.vercel.app", extra: 1 }).success).toBe(false);
  });

  test("the preview refuses the same pages", async () => {
    const r = await new FakeEngine().call({ method: "openExternal", url: "https://evil.com" });
    expect(r).toMatchObject({ ok: false, error: { message: expect.stringMatching(/Only Vercel pages/) } });
  });
});

describe("Ask answers", () => {
  test("model text is escaped and never becomes markup", () => {
    const html = answerHtml({ answer: `It broke.\n${ATTACK}\n\nThen "it" worked & stopped.`, cites: [], basis: 2 }, POINTS);
    expect(html).not.toMatch(/<img|<script/);
    expect(html).toContain(esc(ATTACK));
    expect(html).toContain("&quot;it&quot; worked &amp; stopped.");
    // Blank lines start a paragraph; single line breaks stay.
    expect(html).toContain("<p>It broke.<br>");
    expect(html.match(/<p>/g)).toHaveLength(2);
  });

  test("cited save points become time chips with their verdict glyph, unknown ids are left out", () => {
    const result: AskResult = { answer: "It last worked at 10:42.", cites: ["cp-0003", "cp-9999", "cp-0006"], basis: 7 };
    const html = answerHtml(result, POINTS);
    expect(html).toContain('data-fa="cite" data-id="cp-0003"');
    expect(html).toContain('data-id="cp-0006"');
    expect(html).not.toContain("cp-9999");
    expect(html).toContain('class="g v-pass"');
    expect(html).toContain('class="g v-fail"');
    expect(html).toContain(`>${esc(when(T1))}</button>`);
    expect(html).toContain("Works");
    expect(html).toContain("Broken");
    expect(html).toContain("Based on 7 save points. Check the cited points before you rely on this.");
    expect(html).toContain('class="ft-aitag"');
  });

  test("a cite chip escapes its id and says what it is", () => {
    expect(citeChip(`cp-1"><b>`, { verdict: null, createdAt: T1 })).not.toContain("<b>");
    expect(citeChip("cp-0003", POINTS.get("cp-0003"))).toContain(`aria-label="Save point at ${esc(when(T1))}, Works. Show it in the journal."`);
    expect(citeChip("cp-0001", undefined)).toBe("");
  });

  test("'I can't tell from the history' is its own calm state with no cites", () => {
    const html = answerHtml({ answer: "I can't tell from the history.", cites: [], basis: 1 }, POINTS);
    expect(html).toContain("ft-a ft-cant");
    expect(html).not.toContain("ft-cites");
    expect(html).toContain("Based on 1 save point.");
  });
});

describe("the Ask panel", () => {
  test("off: the consent card has every line from shared/ask.ts, the terms link and one turn-on button", () => {
    const html = askPanelHtml(view({ phase: "off" }));
    for (const line of [ASK_CONSENT.summary, ...ASK_CONSENT.sent, ...ASK_CONSENT.neverSent, ASK_CONSENT.where, ASK_CONSENT.freeTier, ASK_CONSENT.off]) expect(html).toContain(esc(line));
    expect(html).toContain('data-fa="terms"');
    expect(html.match(/data-fa="on"/g)).toHaveLength(1);
    expect(html).toContain("Turn on Ask for this project");
    expect(html).not.toContain("<textarea");
  });

  test("off without a key says so and points to Settings > Features", () => {
    expect(askPanelHtml(view({ phase: "off", hasKey: false }))).toContain("There is no Gemini API key on this Mac yet.");
    expect(askPanelHtml(view({ phase: "off", hasKey: false }))).toContain('data-fa="settings"');
    expect(askPanelHtml(view({ phase: "off", hasKey: false, canOpenSettings: false }))).not.toContain('data-fa="settings"');
  });

  test("on: question box, the three suggested questions and a menu to turn it off", () => {
    const html = askPanelHtml(view());
    expect(html).toContain("<textarea");
    for (const q of ASK_EXAMPLES) expect(html).toContain(`data-q="${esc(q)}"`);
    expect(askPanelHtml(view({ menuOpen: true }))).toContain("Turn off Ask for this project");
  });

  test("on without a key: the box is disabled and Settings is named", () => {
    const html = askPanelHtml(view({ hasKey: false }));
    expect(html).toMatch(/<textarea[^>]*disabled/);
    expect(html).toContain("Settings &gt; Features");
    expect(html).not.toContain('data-fa="suggest"');
  });

  test("loading, error and asked questions are escaped", () => {
    const asking = askPanelHtml(view({ busy: true, turns: [{ question: ATTACK, status: "asking", result: null, error: null }] }));
    expect(asking).toContain("Asking Gemini");
    expect(asking).not.toMatch(/<img|<script/);
    expect(asking).not.toContain('data-fa="suggest"');
    const failed = askPanelHtml(view({ turns: [{ question: "When?", status: "failed", result: null, error: `Gemini is having trouble ${ATTACK}` }] }));
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('data-fa="retry"');
    expect(failed).not.toMatch(/<img|<script/);
  });

  test("asked suggestions are not offered again", () => {
    const first = ASK_EXAMPLES[0];
    const html = askPanelHtml(view({ turns: [{ question: first, status: "answered", result: { answer: "a", cites: [], basis: 1 }, error: null }] }));
    expect(html).not.toContain(`data-q="${esc(first)}"`);
    expect(html).toContain(`data-q="${esc(ASK_EXAMPLES[1])}"`);
  });
});

describe("Vercel deploy chips", () => {
  test("map each matched save point to Production or Preview with its state, newest first", () => {
    const result: DeploymentsResult = {
      link: { teamId: null, projectId: "prj_1", name: "marigold" },
      matched: [
        { deployment: deployment("dpl_old", { target: "production", createdAt: T1 }), savePoints: [{ id: "cp-0003", exact: true }] },
        { deployment: deployment("dpl_new", { state: "BUILDING", createdAt: T2 }), savePoints: [{ id: "cp-0003", exact: true }, { id: "cp-0009", exact: true }] },
      ],
      otherCommits: [], noCommit: [deployment("dpl_cli", { commit: null })], fetchedAt: T2,
    };
    const chips = chipsByCheckpoint(result, [{ id: "cp-0003" }, { id: "cp-0004" }]);
    expect([...chips.keys()]).toEqual(["cp-0003"]);
    const html = chips.get("cp-0003") ?? "";
    expect(html.indexOf("Vercel Preview · Building")).toBeLessThan(html.indexOf("Vercel Production · Ready"));
    expect(html).toContain('data-url="https://dpl-new.vercel.app"');
    expect(html).toContain("read only");
    expect(html).not.toContain("dpl_cli");
    expect(chipsByCheckpoint(null, [{ id: "cp-0003" }]).size).toBe(0);
  });

  test("a deploy link is the deploy, then its vercel.com page, and never anything off the allow list", () => {
    expect(deployLink(deployment("dpl_a"))).toBe("https://dpl-a.vercel.app");
    expect(deployLink(deployment("dpl_u", { url: "https://dpl_u.vercel.app" }))).toBe("https://vercel.com/acme/marigold/dpl_u");
    expect(deployLink(deployment("dpl_b", { url: null }))).toBe("https://vercel.com/acme/marigold/dpl_b");
    const evil = deployment("dpl_c", { url: "https://evil.com", inspectorUrl: "javascript:alert(1)" });
    expect(deployLink(evil)).toBeNull();
    expect(deployChip(evil, true)).not.toContain("data-url");
    expect(deployChip(evil, true)).toMatch(/^<span/);
  });

  test("a save point with uncommitted changes says the deploy may differ", () => {
    expect(deployChip(deployment("dpl_a"), false)).toContain("may differ");
    expect(deployChip(deployment("dpl_a"), true)).not.toContain("may differ");
  });

  test("deploys from a computer are listed apart, and nothing shows when not linked", () => {
    const result: DeploymentsResult = { link: { teamId: null, projectId: "prj_1", name: "m" }, matched: [], otherCommits: [deployment("dpl_x")], noCommit: [deployment("dpl_cli", { commit: null, creator: `<b>sam</b>` })], fetchedAt: T2 };
    const html = unlinkedHtml(result, null);
    expect(html).toContain("Deployed from your computer, not linked to a save point");
    expect(html).toContain("1 other deploy came from Git commits that no save point recorded.");
    expect(html).not.toContain("<b>sam</b>");
    expect(unlinkedHtml(null, null)).toBe("");
    expect(unlinkedHtml(null, "Vercel did not accept the token.")).toContain("Couldn’t read deploys from Vercel. Vercel did not accept the token.");
  });

  describe("renderDeployChips", () => {
    afterEach(() => vi.unstubAllGlobals());

    test("asks the bridge, and gives no chips when not linked or Vercel can't be read", async () => {
      vi.stubGlobal("document", { addEventListener: () => undefined });
      const linked = new FakeEngine("broken", "on");
      const entries = linked.timelineEntries();
      const chips = await renderDeployChips(linked.project.id, entries, linked);
      expect([...chips.keys()].sort()).toEqual(["cp-0002", "cp-0003"]);
      expect(chips.get("cp-0003")).toContain("Vercel Production · Ready");
      expect(chips.get("cp-0002")).toContain("Vercel Preview · Ready");
      expect((await renderDeployChips(PROJECT, entries, new FakeEngine("broken", "no-vercel"))).size).toBe(0);
      const failing = { call: async () => ({ ok: false as const, error: { kind: "usage", message: "Add a Vercel token in Settings to see deploys." } }) };
      expect((await renderDeployChips(PROJECT, entries, failing)).size).toBe(0);
    });
  });
});

describe("Settings > Features", () => {
  const base: FeatureSettingsView = { phase: "ready", ask: false, link: null, keys: { gemini: false, vercel: false }, options: null, busy: false, status: null, problem: null };

  test("key fields are password inputs that never carry a value", () => {
    const html = featureSettingsHtml({ ...base, keys: { gemini: true, vercel: true } });
    const inputs = html.match(/<input[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(2);
    for (const i of inputs) {
      expect(i).toContain('type="password"');
      expect(i).not.toMatch(/\svalue=/);
    }
    expect(html).toContain("Set on this Mac.");
    expect(html.match(/data-fa="remove-key"/g)).toHaveLength(2);
  });

  test("says Vercel access is read only and nothing is deployed, promoted or rolled back", () => {
    const html = featureSettingsHtml(base);
    expect(html).toContain("Read only.");
    expect(html).toContain("It never deploys, promotes or rolls back anything.");
  });

  test("not linked explains how to link; linked offers Unlink; project names are escaped", () => {
    expect(featureSettingsHtml(base)).toContain("Not linked, so no deploys show on the timeline.");
    expect(featureSettingsHtml(base)).toContain("Add a Vercel token above first.");
    const picking = featureSettingsHtml({ ...base, keys: { gemini: false, vercel: true }, options: [{ teamId: null, teamName: null, projectId: "prj_1", name: "<i>x</i>", repo: "acme/x" }] });
    expect(picking).toContain("&lt;i&gt;x&lt;/i&gt; · Personal · acme/x");
    expect(picking).toContain('data-fa="link"');
    const linked = featureSettingsHtml({ ...base, link: { teamId: null, projectId: "prj_1", name: "marigold" } });
    expect(linked).toContain("Linked to <b>marigold</b>");
    expect(linked).toContain('data-fa="unlink"');
  });

  test("the Ask switch shows the consent details while it is off", () => {
    expect(featureSettingsHtml(base)).toMatch(/<details class="ft-details" open>/);
    expect(featureSettingsHtml({ ...base, ask: true })).toMatch(/<details class="ft-details">/);
    expect(featureSettingsHtml({ ...base, ask: true })).toContain('aria-checked="true"');
  });
});

describe("preview stories", () => {
  test("?state= picks the story and the feature state", () => {
    expect(previewStory(null)).toEqual({ scenario: "broken", features: "on" });
    expect(previewStory("works")).toEqual({ scenario: "works", features: "on" });
    expect(previewStory("ask-off")).toEqual({ scenario: "broken", features: "ask-off" });
    expect(previewStory("no-vercel")).toEqual({ scenario: "broken", features: "no-vercel" });
    expect(previewStory("nonsense")).toEqual({ scenario: "broken", features: "on" });
  });

  test("each feature story behaves as labelled", async () => {
    const on = new FakeEngine("broken", "on");
    const answer = await on.call({ method: "ask", projectId: on.project.id, question: ASK_EXAMPLES[0] });
    expect(answer).toMatchObject({ ok: true, data: { basis: 6 } });
    const unknown = await on.call({ method: "ask", projectId: on.project.id, question: "Why is the sky blue?" });
    expect(unknown.ok && unknown.data.answer).toMatch(/^I can't tell from the history\./);

    const off = new FakeEngine("broken", "ask-off");
    expect(off.project.features.ask).toBe(false);

    const noKey = new FakeEngine("broken", "no-key");
    expect(await noKey.call({ method: "credentials" })).toMatchObject({ ok: true, data: { gemini: false } });

    const failing = new FakeEngine("broken", "ask-error");
    expect(await failing.call({ method: "ask", projectId: failing.project.id, question: ASK_EXAMPLES[0] })).toMatchObject({ ok: false, error: { message: expect.stringMatching(/Could not reach Gemini/) } });

    const noVercel = new FakeEngine("broken", "no-vercel");
    expect(await noVercel.call({ method: "deployments", projectId: noVercel.project.id })).toEqual({ ok: true, data: null });
    expect(await noVercel.call({ method: "vercelProjects" })).toMatchObject({ ok: false });
  });
});
