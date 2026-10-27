// Settings > <project>: the check (command, setup, time limit, network), saving when files change, Ask on or off, the
// Gemini API key, the Vercel token and which Vercel project is linked. Keys go straight to the main process. The window
// only ever learns whether each one is set, and a pasted key is never written into markup.
import type { AutoSave, CredentialName, ProjectCheckConfig, Purpose, VercelLink, VercelProjectOption } from "../shared/api.js";
import { ASK_CONSENT } from "../shared/ask.js";
import { esc } from "../shared/format.js";
import { AUTO_SAVE_LABEL, AUTO_SAVE_NOTE } from "./add-flow.js";
import { announceFeatures, errorText, FEATURES_CHANGED, isolateTyping, patch, type FeatureApi } from "./feature-dom.js";
import { checkRecommended } from "./purpose.js";

export interface FeatureSettingsView {
  phase: "loading" | "ready" | "unavailable";
  ask: boolean;
  /** "change": the engine saves when files change, while Time Machine is open. */
  autoSave: AutoSave;
  link: VercelLink | null;
  keys: Record<CredentialName, boolean>;
  /** Vercel projects the token can see, once the person asked to choose one. */
  options: VercelProjectOption[] | null;
  busy: boolean;
  /** A plain sentence about what just happened. */
  status: string | null;
  problem: string | null;
  /** The project's check settings; null while they are read. */
  check: ProjectCheckConfig | null;
  /** Why the check settings could not be read, when they could not. */
  checkProblem?: string | null;
  /** What the folder is for: it decides the words, whether a check is optional, and whether Vercel is offered. */
  purpose: Purpose;
  /** Browser credentials are inherited from the tm ui process, never persisted from a form. */
  runtime?: "browser" | "desktop";
  /** The project these rows belong to: its id is in every element id, since several projects' rows can be in the page. */
  projectId: string;
  /** What saving the check form did, shown under its Save button. `field` marks the input it is about. */
  checkMessage?: { kind: "ok" | "error"; text: string; field?: "timeout" } | null;
}

const KEY_LABEL: Record<CredentialName, string> = { gemini: "Gemini API key", anthropic: "Anthropic API key", vercel: "Vercel token" };
const ENV_NAME: Record<CredentialName, string> = { gemini: "GEMINI_API_KEY", anthropic: "ANTHROPIC_API_KEY", vercel: "VERCEL_TOKEN" };
const TOKENS_URL = "https://vercel.com/account/tokens";

/** The check, editable after setup (dev#11): the command, what installs first, the time limit, and the internet during checks. */
function checkRows(v: FeatureSettingsView): string {
  const c = v.check;
  if (!c) return v.checkProblem ? `<p class="ft-err">${esc(`Couldn’t read the check settings. ${v.checkProblem}`)}</p>` : `<p class="ft-muted" aria-busy="true">Reading the check settings…</p>`;
  const dis = v.busy ? " disabled" : "";
  const code = v.purpose === "code";
  const optional = checkRecommended(v.purpose) ? " Leave it empty to only save versions; then no save point is called Works or Broken." : " Optional here. Leave it empty to only save versions.";
  const net = c.network === "allow";
  // Every project's Settings section can be in the page at once, so each id carries the project id (Design re-check 3).
  const id = (k: string): string => `${k}-${v.projectId}`;
  const msg = v.checkMessage;
  const badTime = msg?.field === "timeout";
  const said = msg ? `<p class="ft-check-msg ${msg.kind === "error" ? "ft-err" : "ft-status"}" id="${id("ck-msg")}" role="${msg.kind === "error" ? "alert" : "status"}">${esc(msg.text)}</p>` : "";
  return `<form class="ft-check" data-check-form novalidate>
    <div class="setrow"><label class="l" for="${id("ck-command")}">Command</label><div class="ft-stack">
      <input class="field mono" id="${id("ck-command")}" data-keep="ck-command" type="text" maxlength="500" value="${esc(c.command)}" placeholder="${code ? "for example: npm test" : "for example: ./check.sh"}" autocomplete="off" autocapitalize="none" spellcheck="false" aria-describedby="${id("ck-command-d")}"${dis}>
      <span class="ft-muted" id="${id("ck-command-d")}">${esc(`If it ends without an error, the version works. It runs in a copy, never in your folder.${optional}`)}</span>
    </div></div>
    <div class="setrow"><label class="l" for="${id("ck-setup")}">First, install</label><div class="ft-stack">
      <input class="field mono" id="${id("ck-setup")}" data-keep="ck-setup" type="text" maxlength="500" value="${esc(c.setup)}" placeholder="${code ? "for example: npm ci" : "Nothing"}" autocomplete="off" autocapitalize="none" spellcheck="false" aria-describedby="${id("ck-setup-d")}"${dis}>
      <span class="ft-muted" id="${id("ck-setup-d")}">Runs in the copy before the check, because the copy starts empty of installed things. Empty for none.</span>
    </div></div>
    <div class="setrow"><label class="l" for="${id("ck-timeout")}">Time limit</label><div class="ft-stack">
      <span class="ft-inline"><input class="field ft-num" id="${id("ck-timeout")}" data-keep="ck-timeout" type="number" inputmode="numeric" min="1" max="86400" step="1" value="${c.timeoutSeconds}" aria-describedby="${id("ck-timeout-d")}${badTime ? ` ${id("ck-msg")}` : ""}"${badTime ? ' aria-invalid="true"' : ""}${dis}><span>seconds</span></span>
      <span class="ft-muted" id="${id("ck-timeout-d")}">A check still running then is stopped and called Couldn’t check.</span>
    </div></div>
    <div class="row-btns"><button type="submit" class="btn"${dis}>Save check settings</button></div>
    ${said}
  </form>
  <div class="setrow"><span class="l">Internet</span><div class="ft-stack">
    <div class="toggle"><button type="button" class="switch ${net ? "on" : ""}" role="switch" aria-checked="${net}" aria-label="Internet during checks" data-fa="check-network"${dis}></button><span class="ft-muted">${net ? "On during checks." : "Off during checks."}</span></div>
    <span class="ft-muted">Off keeps a check from reaching the network, where this computer can do that.</span>
  </div></div>`;
}

/** Reads the check form: a patch with only what changed, or the reason it can't be saved. */
export function checkPatch(c: ProjectCheckConfig, form: { command: string; setup: string; timeout: string }): Partial<ProjectCheckConfig> | { error: string } {
  const seconds = Number(form.timeout.trim());
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86_400) return { error: "Enter a time limit from 1 to 86400 seconds." };
  const next = { command: form.command.trim(), setup: form.setup.trim(), timeoutSeconds: seconds };
  return Object.fromEntries(Object.entries(next).filter(([k, x]) => c[k as keyof typeof next] !== x));
}

function keyRow(v: FeatureSettingsView, name: CredentialName, help: string): string {
  const set = v.keys[name];
  const dis = v.busy ? " disabled" : "";
  const label = KEY_LABEL[name];
  if (v.runtime === "browser") return `<div class="setrow"><span class="l">${label}</span><div class="ft-stack">
    <div class="ft-keystate">${set ? "Available from the local server environment." : "Not set in the local server environment."}</div>
    <p class="ft-muted">Set <span class="mono nowrap">${ENV_NAME[name]}</span> in the environment of the terminal that launches <span class="mono nowrap">tm ui</span>, then restart it. The browser cannot save or remove credentials. Never paste a secret into a command you share.</p>
    <span class="ft-muted">${help}</span>
  </div></div>`;
  return `<div class="setrow"><span class="l">${label}</span><div class="ft-stack">
    <div class="ft-keystate">${set ? `<i class="ft-dot on" aria-hidden="true"></i>Set on this computer. Used for every project.` : `<i class="ft-dot" aria-hidden="true"></i>Not set.`}</div>
    <form class="row-btns" data-key-form="${name}">
      <input class="field" type="password" data-keep="key-${name}" autocomplete="off" spellcheck="false" aria-label="${esc(`Paste a ${label}`)}" placeholder="${set ? "Paste a new one to replace it" : `Paste your ${label}`}"${dis}>
      <button type="submit" class="btn"${dis}>Save</button>
      ${set ? `<button type="button" class="btn ghost" data-fa="remove-key" data-name="${name}"${dis}>Remove</button>` : ""}
    </form>
    <span class="ft-muted">${help} Stored encrypted on this computer and never shown again.</span>
  </div></div>`;
}

function consentDetails(open: boolean): string {
  const list = (items: readonly string[]): string => `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  return `<details class="ft-details"${open ? " open" : ""}><summary>What is sent and what is never sent</summary>
    <h3>What is sent</h3>${list(ASK_CONSENT.sent)}
    <h3>Never sent</h3>${list(ASK_CONSENT.neverSent)}
    <p>${esc(ASK_CONSENT.where)}</p>
    <p>${esc(ASK_CONSENT.freeTier)} <button type="button" class="ft-link" data-fa="terms">Read Google’s Gemini API terms</button></p>
    <p>${esc(ASK_CONSENT.accuracy)}</p>
  </details>`;
}

function optionLabel(o: VercelProjectOption): string {
  return [o.name, o.teamName ?? "Personal", o.repo].filter(Boolean).join(" · ");
}

function vercelProjectRow(v: FeatureSettingsView): string {
  const dis = v.busy ? " disabled" : "";
  let body: string;
  if (v.link) {
    body = `<div>Linked to <b>${esc(v.link.name)}</b>. Its deploys show next to the save point whose Git commit they were built from.</div>
      <div class="row-btns"><button type="button" class="btn" data-fa="unlink"${dis}>Unlink</button></div>`;
  } else {
    const how = `<span class="ft-muted">Not linked, so no deploys show on the timeline. Link the Vercel project this folder deploys to. Each deploy then shows next to the save point whose Git commit it was built from. Deploys are never matched by time.</span>`;
    if (!v.keys.vercel) body = `${how}<span class="ft-muted">${v.runtime === "browser" ? "Set VERCEL_TOKEN in the tm ui environment first, then restart it." : "Add a Vercel token above first."}</span>`;
    else if (!v.options) body = `${how}<div class="row-btns"><button type="button" class="btn" data-fa="pick"${dis}>Choose a Vercel project</button></div>`;
    else if (!v.options.length) body = `${how}<span class="ft-muted">This token can’t see any Vercel projects.</span>`;
    else {
      body = `${how}<div class="row-btns"><select class="field" data-keep="vercel-project" aria-label="Vercel project"${dis}>${v.options
        .map((o, i) => `<option value="${i}">${esc(optionLabel(o))}</option>`)
        .join("")}</select><button type="button" class="btn dark" data-fa="link"${dis}>Link</button></div>`;
    }
  }
  return `<div class="setrow"><span class="l">Vercel project</span><div class="ft-stack">${body}</div></div>`;
}

/** The rows for one state. Pure, so it can be tested without a window. */
export function featureSettingsHtml(v: FeatureSettingsView): string {
  if (v.phase === "loading") return `<span class="spin" role="status" aria-label="Loading"></span>`;
  if (v.phase === "unavailable") return `<p class="ft-err" role="alert">${esc(v.problem ?? "Couldn’t read the settings.")}</p><button type="button" class="btn" data-fa="reload">Try again</button>`;
  const dis = v.busy ? " disabled" : "";
  const status = v.problem ? `<p class="ft-err" role="alert">${esc(v.problem)}</p>` : v.status ? `<p class="ft-status" role="status">${esc(v.status)}</p>` : "";
  const code = v.purpose === "code";
  // A documents or research folder hears what Ask does in one plain sentence; the details stay one click away.
  const askSaid = code ? ASK_CONSENT.summary : "Ask answers questions about this folder’s saved versions with your own AI key: it sends their times, names, notes and the names of changed files, never what is in your files.";
  // Vercel deploys come from Git commits, so only a code project is offered them.
  const vercel = code ? `<h3 class="ft-sec">Vercel deploys</h3>
    <p class="ft-ro-note">Read only. Time Machine reads deploys from Vercel to show them next to your save points. It never deploys, promotes or rolls back anything.</p>
    ${keyRow(v, "vercel", `A token from <button type="button" class="ft-link" data-fa="tokens">vercel.com/account/tokens</button>. It is only used to read projects and deploys.`)}
    ${vercelProjectRow(v)}` : "";
  return `<div class="ft-settings">
    <h3 class="ft-sec" id="ft-check-${v.projectId}">Check</h3>
    ${checkRows(v)}
    <h3 class="ft-sec">Saving</h3>
    <div class="setrow"><span class="l">On change</span><div class="ft-stack">
      <div class="toggle"><button type="button" class="switch ${v.autoSave === "change" ? "on" : ""}" role="switch" aria-checked="${v.autoSave === "change"}" aria-label="${esc(AUTO_SAVE_LABEL)}" data-fa="autosave"${dis}></button><span class="ft-muted">${esc(AUTO_SAVE_LABEL)}.</span></div>
      <span class="ft-muted">${esc(AUTO_SAVE_NOTE)} Save now always works.</span>
    </div></div>
    <h3 class="ft-sec" id="ft-ask-${v.projectId}" tabindex="-1">Ask about your history</h3>
    <div class="setrow"><span class="l">Ask</span><div class="ft-stack">
      <div class="toggle"><button type="button" class="switch ${v.ask ? "on" : ""}" role="switch" aria-checked="${v.ask}" aria-label="Ask about your history for this project" data-fa="ask"${dis}></button><span class="ft-muted">${esc(askSaid)}</span></div>
      ${consentDetails(!v.ask)}
      <span class="ft-muted">${esc(ASK_CONSENT.off)}</span>
    </div></div>
    ${keyRow(v, "gemini", "Your own key from Google AI Studio. Questions go from this computer straight to Google.")}
    ${vercel}
    ${status}
  </div>`;
}

/** Fills host with the feature rows for one project. Returns a function that removes them. */
export function renderFeatureSettings(host: HTMLElement, projectId: string, api: FeatureApi): () => void {
  let alive = true;
  const v: FeatureSettingsView = { phase: "loading", ask: false, autoSave: "off", link: null, keys: { gemini: false, anthropic: false, vercel: false }, options: null, busy: false, status: null, problem: null, check: null, purpose: "code", projectId, checkMessage: null };
  const draw = (): void => {
    if (alive) patch(host, featureSettingsHtml(v));
  };

  const load = async (): Promise<void> => {
    const [boot, creds, config] = await Promise.all([api.call({ method: "bootstrap" }), api.call({ method: "credentials" }), api.call({ method: "projectConfig", projectId })]);
    if (!alive) return;
    const p = boot.ok ? boot.data.projects.find((x) => x.id === projectId) : undefined;
    if (!boot.ok || !creds.ok || !p) {
      v.phase = "unavailable";
      v.problem = !boot.ok ? boot.error.message : !creds.ok ? creds.error.message : "That project is no longer in the list.";
      return draw();
    }
    // A check that can't be read (a moved folder, a broken settings file) leaves the other rows working; its row says so.
    Object.assign(v, { phase: "ready", ask: p.features.ask, autoSave: p.features.autoSave, link: p.features.vercel, keys: creds.data, runtime: "browser", purpose: p.purpose, check: config.ok ? config.data : null, checkProblem: config.ok ? null : config.error.message });
    if (v.link || !v.keys.vercel) v.options = null;
    drawKeep();
  };

  /** Saves the check form: only what changed. The fields show the new values while it saves. */
  const saveCheck = (form: HTMLFormElement): void => {
    const c = v.check;
    if (!c || v.busy) return;
    const value = (key: string): string => form.querySelector<HTMLInputElement>(`[data-keep="${key}"]`)?.value ?? "";
    const change = checkPatch(c, { command: value("ck-command"), setup: value("ck-setup"), timeout: value("ck-timeout") });
    // What saving did is said under Save check settings, where the person is looking (Design re-check P2 2).
    if ("error" in change) {
      v.checkMessage = { kind: "error", text: String(change.error), field: "timeout" };
      drawKeep();
      // Under Save, which can sit at the bottom edge on a phone: brought into view, focus stays on Save.
      host.querySelector<HTMLElement>(".ft-check-msg")?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (!Object.keys(change).length) {
      v.checkMessage = { kind: "ok", text: "Nothing changed." };
      return draw();
    }
    v.check = { ...c, ...change };
    v.checkMessage = null;
    void run(async () => {
      const r = await api.call({ method: "setProjectConfig", projectId, patch: change });
      if (!r.ok) {
        v.check = c;
        v.checkMessage = { kind: "error", text: r.error.message };
        return null;
      }
      v.check = r.data;
      v.checkMessage = { kind: "ok", text: r.data.command.trim() ? "Check settings saved. The next check uses them." : "Saved with no check: new save points are only saved, never called Works or Broken." };
      return null;
    });
  };

  /** A selector for the control that has focus in these rows, so focus comes back to it after a busy redraw disabled it. */
  const focusedKey = (): string | null => {
    const a = document.activeElement;
    if (!(a instanceof HTMLElement) || !host.contains(a)) return null;
    if (a.dataset.fa) return `[data-fa="${CSS.escape(a.dataset.fa)}"]${a.dataset.name ? `[data-name="${CSS.escape(a.dataset.name)}"]` : ""}`;
    if (a.dataset.keep) return `[data-keep="${CSS.escape(a.dataset.keep)}"]`;
    if (a.matches("[data-check-form] [type=submit]")) return "[data-check-form] [type=submit]";
    return null;
  };

  /** Draws, then gives focus back to the control that had it, if the redraw (a disabled button, a replaced row) took it. */
  const drawKeep = (back = focusedKey()): void => {
    draw();
    if (back && (document.activeElement === document.body || document.activeElement === null)) host.querySelector<HTMLElement>(back)?.focus({ preventScroll: true });
  };

  /** Runs one change, then says how it went. Every view of this project reloads after a change. */
  const run = async (work: () => Promise<string | null>): Promise<void> => {
    const back = focusedKey();
    v.busy = true;
    v.status = null;
    v.problem = null;
    draw();
    try {
      v.status = await work();
    } catch (e) {
      v.problem = errorText(e);
    }
    v.busy = false;
    if (!alive) return;
    drawKeep(back);
    announceFeatures(projectId);
  };

  const saveKey = (name: CredentialName): void => {
    const field = host.querySelector<HTMLInputElement>(`[data-keep="key-${name}"]`);
    const value = field?.value.trim() ?? "";
    if (field) field.value = "";
    if (!value) {
      v.problem = `Paste a ${KEY_LABEL[name]} first.`;
      return draw();
    }
    void run(async () => {
      const r = await api.call({ method: "setCredential", name, value });
      if (!r.ok) throw new Error(r.error.message);
      return `${KEY_LABEL[name]} saved.`;
    });
  };

  const onClick = (e: MouseEvent): void => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-fa]");
    if (!el || (el instanceof HTMLButtonElement && el.disabled)) return;
    switch (el.dataset.fa) {
      case "check-network": {
        const network = v.check?.network === "allow" ? "deny" : "allow";
        return void run(async () => {
          const r = await api.call({ method: "setProjectConfig", projectId, patch: { network } });
          if (!r.ok) throw new Error(r.error.message);
          v.check = r.data;
          return r.data.network === "allow" ? "The internet is on during checks." : "The internet is off during checks.";
        });
      }
      case "autosave":
        return void run(async () => {
          const r = await api.call({ method: "setFeature", projectId, change: { feature: "autoSave", autoSave: v.autoSave === "change" ? "off" : "change" } });
          if (!r.ok) throw new Error(r.error.message);
          return r.data.features.autoSave === "change" ? "Saving when files change, while Time Machine is open." : "Saving only when you press Save now.";
        });
      case "ask":
        return void run(async () => {
          const r = await api.call({ method: "setFeature", projectId, change: { feature: "ask", enabled: !v.ask } });
          if (!r.ok) throw new Error(r.error.message);
          return r.data.features.ask ? "Ask is on for this project." : "Ask is off for this project. Nothing more is sent.";
        });
      case "remove-key": {
        const name = el.dataset.name === "vercel" ? "vercel" : "gemini";
        return void run(async () => {
          const r = await api.call({ method: "setCredential", name, value: null });
          if (!r.ok) throw new Error(r.error.message);
          return r.data.configured
            ? `Removed from this computer. ${ENV_NAME[name]} is still set in the environment, so that key is still used.`
            : `${KEY_LABEL[name]} removed from this computer.`;
        });
      }
      case "pick":
        return void run(async () => {
          const r = await api.call({ method: "vercelProjects" });
          if (!r.ok) throw new Error(r.error.message);
          v.options = r.data;
          return null;
        });
      case "link": {
        const select = host.querySelector<HTMLSelectElement>('[data-keep="vercel-project"]');
        const o = v.options?.[Number(select?.value)];
        if (!o) return;
        const link: VercelLink = { teamId: o.teamId, projectId: o.projectId, name: o.name };
        return void run(async () => {
          const r = await api.call({ method: "setFeature", projectId, change: { feature: "vercel", link } });
          if (!r.ok) throw new Error(r.error.message);
          return `Linked to ${o.name}. Time Machine only reads from it.`;
        });
      }
      case "unlink":
        return void run(async () => {
          const r = await api.call({ method: "setFeature", projectId, change: { feature: "vercel", link: null } });
          if (!r.ok) throw new Error(r.error.message);
          v.options = null;
          return "Unlinked. Deploys no longer show on the timeline.";
        });
      case "terms":
        return void api.call({ method: "openExternal", url: ASK_CONSENT.termsUrl });
      case "tokens":
        return void api.call({ method: "openExternal", url: TOKENS_URL });
      case "reload":
        v.phase = "loading";
        draw();
        return void load();
    }
  };

  const onSubmit = (e: SubmitEvent): void => {
    const target = e.target as HTMLElement;
    const checkForm = target.closest<HTMLFormElement>("[data-check-form]");
    if (checkForm) {
      e.preventDefault();
      return saveCheck(checkForm);
    }
    const form = target.closest<HTMLFormElement>("[data-key-form]");
    if (!form) return;
    e.preventDefault();
    saveKey(form.dataset.keyForm === "vercel" ? "vercel" : "gemini");
  };

  const onChanged = (e: Event): void => {
    if ((e as CustomEvent<{ projectId: string }>).detail.projectId === projectId && !v.busy) void load();
  };

  host.addEventListener("click", onClick);
  host.addEventListener("submit", onSubmit);
  host.addEventListener("keydown", isolateTyping);
  document.addEventListener(FEATURES_CHANGED, onChanged);
  draw();
  void load();

  return () => {
    alive = false;
    host.removeEventListener("click", onClick);
    host.removeEventListener("submit", onSubmit);
    host.removeEventListener("keydown", isolateTyping);
    document.removeEventListener(FEATURES_CHANGED, onChanged);
    host.innerHTML = "";
  };
}
