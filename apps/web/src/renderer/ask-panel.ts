// Ask about your history: the panel beside the journal. Off until the person turns it on for
// the project, after reading exactly what is sent (shared/ask.ts, ADR 0008). Every word that
// comes back from the model is escaped before it touches the page.
import type { TimelineEntry } from "@timetm/core";
import type { AskResult, Verdict } from "../shared/api.js";
import { ASK_CONSENT, ASK_EXAMPLES } from "../shared/ask.js";
import { esc, plural, verdictKey, verdictWord, when } from "../shared/format.js";
import { announceFeatures, errorText, FEATURES_CHANGED, isolateTyping, patch, type FeatureApi } from "./feature-dom.js";

export interface AskPanelOptions {
  projectId: string;
  api: FeatureApi;
  /** Called with a save point id when a cited time is clicked. */
  onCite: (checkpointId: string) => void;
  /** Opens Settings > Features. Without it the panel names the place in words only. */
  onOpenSettings?: () => void;
}

/** What a cite chip needs to know about a save point. */
export interface CitedPoint {
  verdict: Verdict | null;
  createdAt: string;
}

export interface AskTurn {
  question: string;
  status: "asking" | "answered" | "failed";
  result: AskResult | null;
  error: string | null;
}

export interface AskView {
  phase: "loading" | "off" | "on" | "unavailable";
  /** Whether a Gemini API key is set. Never the key. */
  hasKey: boolean;
  turns: AskTurn[];
  points: ReadonlyMap<string, CitedPoint>;
  menuOpen: boolean;
  busy: boolean;
  /** A plain sentence about the last thing that went wrong outside a question. */
  problem: string | null;
  canOpenSettings: boolean;
}

const CANT_TELL = "I can't tell from the history";

/** One cited save point as a time chip: verdict glyph and time. Unknown ids get no chip. */
export function citeChip(id: string, point: CitedPoint | undefined): string {
  if (!point) return "";
  const time = when(point.createdAt);
  const label = `Save point at ${time}, ${verdictWord(point.verdict)}. Show it in the journal.`;
  return `<button type="button" class="ft-cite" data-fa="cite" data-id="${esc(id)}" aria-label="${esc(label)}" title="${esc(label)}"><i class="g v-${verdictKey(point.verdict)}" aria-hidden="true"></i>${esc(time)}</button>`;
}

/** Model text as escaped paragraphs. Blank lines start a paragraph, single line breaks stay. */
function paragraphs(text: string): string {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => `<p>${p.split("\n").map(esc).join("<br>")}</p>`)
    .join("");
}

/** An answer: escaped model text, the cited save points as chips, and what it was based on. */
export function answerHtml(result: AskResult, points: ReadonlyMap<string, CitedPoint>): string {
  const cantTell = result.answer.trim().startsWith(CANT_TELL);
  const chips = result.cites.map((id) => citeChip(id, points.get(id))).filter(Boolean);
  const basis = `Based on ${plural(result.basis, "save point")}.`;
  const caution = chips.length ? "Check the cited points before you rely on this." : "Check the save points yourself before you rely on this.";
  return `<div class="ft-a${cantTell ? " ft-cant" : ""}">${paragraphs(result.answer)}${
    chips.length ? `<div class="ft-cites"><span class="ft-cites-l">Cited</span>${chips.join("")}</div>` : ""
  }<div class="ft-basis">${esc(basis)} ${esc(caution)} <span class="ft-aitag" title="Written by Google Gemini">AI</span></div></div>`;
}

function suggestions(v: AskView): string {
  const asked = new Set(v.turns.map((t) => t.question.trim().toLowerCase()));
  const left = ASK_EXAMPLES.filter((q) => !asked.has(q.toLowerCase()));
  if (v.busy || !v.hasKey || !left.length) return "";
  return `<div class="ft-sugg" aria-label="Suggested questions">${left.map((q) => `<button type="button" data-fa="suggest" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>`;
}

function turnHtml(t: AskTurn, k: number, points: ReadonlyMap<string, CitedPoint>): string {
  const q = `<div class="ft-q">${esc(t.question)}</div>`;
  if (t.status === "asking") return `${q}<div class="ft-a ft-wait" role="status"><span class="spin" aria-hidden="true"></span>Asking Gemini about the history…</div>`;
  if (t.status === "failed") {
    return `${q}<div class="ft-err" role="alert"><span>${esc(t.error ?? "Something went wrong. Try again.")}</span><button type="button" class="btn ghost" data-fa="retry" data-k="${k}">Try again</button></div>`;
  }
  return t.result ? `${q}${answerHtml(t.result, points)}` : q;
}

function settingsPointer(v: AskView, sentence: string): string {
  const link = v.canOpenSettings ? ` <button type="button" class="ft-link" data-fa="settings">Open Settings &gt; Features</button>` : "";
  return `<p class="ft-note">${esc(sentence)}${link}</p>`;
}

function consentCard(v: AskView): string {
  const list = (items: readonly string[], cls: string): string => `<ul class="${cls}">${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  return `<div class="ft-consent">
    <h3>${esc(ASK_CONSENT.title)}</h3>
    <p>${esc(ASK_CONSENT.summary)}</p>
    <h4>What is sent</h4>${list(ASK_CONSENT.sent, "ft-yes")}
    <h4>Never sent</h4>${list(ASK_CONSENT.neverSent, "ft-no")}
    <p>${esc(ASK_CONSENT.where)}</p>
    <p>${esc(ASK_CONSENT.freeTier)} <button type="button" class="ft-link" data-fa="terms">Read Google’s Gemini API terms</button></p>
    <p class="ft-muted">${esc(ASK_CONSENT.accuracy)} ${esc(ASK_CONSENT.off)}</p>
    ${v.hasKey ? "" : settingsPointer(v, "There is no Gemini API key on this Mac yet. Add your own key in Settings > Features before you ask.")}
    <button type="button" class="btn dark big" data-fa="on"${v.busy ? " disabled" : ""}>Turn on Ask for this project</button>
  </div>`;
}

/** The whole panel for one state. Pure, so it can be tested without a window. */
export function askPanelHtml(v: AskView): string {
  const problem = v.problem ? `<p class="ft-err" role="alert">${esc(v.problem)}</p>` : "";
  if (v.phase === "loading") return `<div class="ft-thread"><span class="spin" role="status" aria-label="Loading"></span></div>`;
  if (v.phase === "unavailable") return `<div class="ft-thread">${problem}<button type="button" class="btn" data-fa="reload">Try again</button></div>`;
  if (v.phase === "off") return `<div class="ft-thread">${problem}${consentCard(v)}</div>`;
  const bar = `<div class="ft-ask-bar"><span>On for this project</span><span class="ft-sp"></span><div class="ft-menu-wrap"><button type="button" class="btn ghost ft-menu-btn" data-fa="menu" aria-label="Ask menu" aria-haspopup="menu" aria-expanded="${v.menuOpen}">⋯</button>${
    v.menuOpen ? `<div class="ft-menu" role="menu"><button type="button" role="menuitem" data-fa="off">Turn off Ask for this project</button></div>` : ""
  }</div></div>`;
  const intro = v.turns.length ? "" : `<p class="ft-intro">Ask a question about this project’s save points. Gemini answers from the history only, and can be wrong.</p>`;
  const noKey = v.hasKey ? "" : settingsPointer(v, "Add a Gemini API key in Settings > Features before you ask.");
  const disabled = v.busy || !v.hasKey ? " disabled" : "";
  return `${bar}
    <div class="ft-thread" aria-live="polite">${intro}${v.turns.map((t, k) => turnHtml(t, k, v.points)).join("")}${problem}${noKey}${suggestions(v)}</div>
    <form class="ft-ask-in"><textarea data-keep="ask-q" maxlength="500" rows="2" placeholder="Ask about this project’s history…" aria-label="Ask about this project’s history"${disabled}></textarea><button type="submit" class="btn dark"${disabled}>Ask</button></form>
    <p class="ft-ask-foot">Sent to Google Gemini with your own key. File contents and check logs are not read for Ask. Known secrets are filtered; do not include secrets in your question.</p>`;
}

/** Mounts the Ask panel for one project in host. Returns a function that removes it. */
export function renderAskPanel(host: HTMLElement, { projectId, api, onCite, onOpenSettings }: AskPanelOptions): () => void {
  let alive = true;
  const v: AskView = { phase: "loading", hasKey: false, turns: [], points: new Map(), menuOpen: false, busy: false, problem: null, canOpenSettings: !!onOpenSettings };
  host.classList.add("ft-ask");

  const draw = (): void => {
    if (!alive) return;
    patch(host, askPanelHtml(v));
    const thread = host.querySelector(".ft-thread");
    if (thread) thread.scrollTop = thread.scrollHeight;
  };

  const loadPoints = async (): Promise<void> => {
    const t = await api.call({ method: "timeline", projectId });
    if (!t.ok) throw new Error(t.error.message);
    v.points = new Map(t.data.checkpoints.map((c: TimelineEntry) => [c.id, { verdict: c.verdict, createdAt: c.createdAt }]));
  };

  const load = async (): Promise<void> => {
    const [boot, creds] = await Promise.all([api.call({ method: "bootstrap" }), api.call({ method: "credentials" })]);
    if (!alive) return;
    const p = boot.ok ? boot.data.projects.find((x) => x.id === projectId) : undefined;
    if (!boot.ok || !creds.ok || !p) {
      v.phase = "unavailable";
      v.problem = !boot.ok ? boot.error.message : !creds.ok ? creds.error.message : "That project is no longer in the list.";
      return draw();
    }
    v.hasKey = creds.data.gemini;
    v.phase = p.features.ask ? "on" : "off";
    v.problem = null;
    draw();
    if (v.phase === "on") {
      try {
        await loadPoints();
      } catch (e) {
        v.problem = `Couldn’t read the save points: ${errorText(e)}`;
      }
      draw();
    }
  };

  const ask = async (turn: AskTurn): Promise<void> => {
    turn.status = "asking";
    turn.error = null;
    v.busy = true;
    draw();
    const r = await api.call({ method: "ask", projectId, question: turn.question });
    if (!alive) return;
    v.busy = false;
    if (r.ok) {
      turn.status = "answered";
      turn.result = r.data;
      // A save point made after the panel opened may be cited. Read the list again once.
      if (r.data.cites.some((id) => !v.points.has(id))) await loadPoints().catch(() => undefined);
    } else {
      turn.status = "failed";
      turn.error = r.error.message;
    }
    draw();
    host.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  };

  const submit = (question: string): void => {
    const q = question.trim().slice(0, 500);
    if (!q || v.busy || !v.hasKey) return;
    const field = host.querySelector<HTMLTextAreaElement>("textarea");
    if (field) field.value = "";
    const turn: AskTurn = { question: q, status: "asking", result: null, error: null };
    v.turns.push(turn);
    void ask(turn);
  };

  const setAsk = async (enabled: boolean): Promise<void> => {
    v.busy = true;
    v.menuOpen = false;
    draw();
    const r = await api.call({ method: "setFeature", projectId, change: { feature: "ask", enabled } });
    if (!alive) return;
    v.busy = false;
    if (!r.ok) {
      v.problem = r.error.message;
      return draw();
    }
    v.turns = enabled ? v.turns : [];
    announceFeatures(projectId);
  };

  const onClick = (e: MouseEvent): void => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-fa]");
    if (!el || (el instanceof HTMLButtonElement && el.disabled)) {
      if (v.menuOpen) {
        v.menuOpen = false;
        draw();
      }
      return;
    }
    switch (el.dataset.fa) {
      case "cite":
        if (el.dataset.id) onCite(el.dataset.id);
        return;
      case "suggest":
        return submit(el.dataset.q ?? "");
      case "retry": {
        const turn = v.turns[Number(el.dataset.k)];
        if (turn && !v.busy) void ask(turn);
        return;
      }
      case "menu":
        v.menuOpen = !v.menuOpen;
        return draw();
      case "off":
        return void setAsk(false);
      case "on":
        return void setAsk(true);
      case "terms":
        return void api.call({ method: "openExternal", url: ASK_CONSENT.termsUrl });
      case "settings":
        return onOpenSettings?.();
      case "reload":
        v.phase = "loading";
        draw();
        return void load();
    }
  };

  const onSubmit = (e: SubmitEvent): void => {
    e.preventDefault();
    submit(host.querySelector<HTMLTextAreaElement>("textarea")?.value ?? "");
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && v.menuOpen) {
      e.stopPropagation();
      v.menuOpen = false;
      draw();
      host.querySelector<HTMLButtonElement>('[data-fa="menu"]')?.focus();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.target instanceof HTMLTextAreaElement) {
      e.preventDefault();
      submit(e.target.value);
    }
    isolateTyping(e);
  };

  const onChanged = (e: Event): void => {
    if ((e as CustomEvent<{ projectId: string }>).detail.projectId === projectId) void load();
  };

  host.addEventListener("click", onClick);
  host.addEventListener("submit", onSubmit);
  host.addEventListener("keydown", onKey);
  document.addEventListener(FEATURES_CHANGED, onChanged);
  draw();
  void load();

  return () => {
    alive = false;
    host.removeEventListener("click", onClick);
    host.removeEventListener("submit", onSubmit);
    host.removeEventListener("keydown", onKey);
    document.removeEventListener(FEATURES_CHANGED, onChanged);
    host.classList.remove("ft-ask");
    host.innerHTML = "";
  };
}
