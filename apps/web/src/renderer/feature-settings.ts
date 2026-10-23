// Settings > Features for one project: Ask on or off, the Gemini API key, the Vercel token and
// which Vercel project is linked. Keys go straight to the main process. The window only ever
// learns whether each one is set, and a pasted key is never written into markup.
import type { CredentialName, VercelLink, VercelProjectOption } from "../shared/api.js";
import { ASK_CONSENT } from "../shared/ask.js";
import { esc } from "../shared/format.js";
import { announceFeatures, errorText, FEATURES_CHANGED, isolateTyping, patch, type FeatureApi } from "./feature-dom.js";

export interface FeatureSettingsView {
  phase: "loading" | "ready" | "unavailable";
  ask: boolean;
  link: VercelLink | null;
  keys: Record<CredentialName, boolean>;
  /** Vercel projects the token can see, once the person asked to choose one. */
  options: VercelProjectOption[] | null;
  busy: boolean;
  /** A plain sentence about what just happened. */
  status: string | null;
  problem: string | null;
  /** Browser credentials are inherited from the tm ui process, never persisted from a form. */
  runtime?: "browser" | "desktop";
}

const KEY_LABEL: Record<CredentialName, string> = { gemini: "Gemini API key", vercel: "Vercel token" };
const ENV_NAME: Record<CredentialName, string> = { gemini: "GEMINI_API_KEY", vercel: "VERCEL_TOKEN" };
const TOKENS_URL = "https://vercel.com/account/tokens";

function keyRow(v: FeatureSettingsView, name: CredentialName, help: string): string {
  const set = v.keys[name];
  const dis = v.busy ? " disabled" : "";
  const label = KEY_LABEL[name];
  if (v.runtime === "browser") return `<div class="setrow"><span class="l">${label}</span><div class="ft-stack">
    <div class="ft-keystate">${set ? "Available from the local server environment." : "Not set in the local server environment."}</div>
    <p class="ft-muted">Set <span class="mono">${ENV_NAME[name]}</span> in the environment of the terminal that launches <span class="mono">tm ui</span>, then restart it. The browser cannot save or remove credentials. Never paste a secret into a command you share.</p>
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
  return `<div class="ft-settings">
    <h4 class="ft-sec">Ask about your history</h4>
    <div class="setrow"><span class="l">Ask</span><div class="ft-stack">
      <div class="toggle"><button type="button" class="switch ${v.ask ? "on" : ""}" role="switch" aria-checked="${v.ask}" aria-label="Ask about your history for this project" data-fa="ask"${dis}></button><span class="ft-muted">${esc(ASK_CONSENT.summary)}</span></div>
      ${consentDetails(!v.ask)}
      <span class="ft-muted">${esc(ASK_CONSENT.off)}</span>
    </div></div>
    ${keyRow(v, "gemini", "Your own key from Google AI Studio. Questions go from this computer straight to Google.")}
    <h3 class="ft-sec">Vercel deploys</h3>
    <p class="ft-ro-note">Read only. Time Machine reads deploys from Vercel to show them next to your save points. It never deploys, promotes or rolls back anything.</p>
    ${keyRow(v, "vercel", `A token from <button type="button" class="ft-link" data-fa="tokens">vercel.com/account/tokens</button>. It is only used to read projects and deploys.`)}
    ${vercelProjectRow(v)}
    ${status}
  </div>`;
}

/** Fills host with the feature rows for one project. Returns a function that removes them. */
export function renderFeatureSettings(host: HTMLElement, projectId: string, api: FeatureApi): () => void {
  let alive = true;
  const v: FeatureSettingsView = { phase: "loading", ask: false, link: null, keys: { gemini: false, vercel: false }, options: null, busy: false, status: null, problem: null };
  const draw = (): void => {
    if (alive) patch(host, featureSettingsHtml(v));
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
    Object.assign(v, { phase: "ready", ask: p.features.ask, link: p.features.vercel, keys: creds.data, runtime: "browser" });
    if (v.link || !v.keys.vercel) v.options = null;
    draw();
  };

  /** Runs one change, then says how it went. Every view of this project reloads after a change. */
  const run = async (work: () => Promise<string | null>): Promise<void> => {
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
    draw();
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
    const form = (e.target as HTMLElement).closest<HTMLFormElement>("[data-key-form]");
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
