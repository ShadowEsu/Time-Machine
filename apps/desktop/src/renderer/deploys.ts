// Vercel deploys beside the save points they were built from (ADR 0009). Read only: a chip only
// appears when the deploy's Git commit is the recorded HEAD of that save point, never by time.
// Links open in the browser through the app's allow-listed openExternal call.
import type { TimelineEntry } from "@timetm/core";
import type { DeploymentsResult, VercelDeployment } from "../shared/api.js";
import { esc, plural, when } from "../shared/format.js";
import { isAllowedExternal } from "../shared/links.js";
import { FEATURES_CHANGED, type FeatureApi } from "./feature-dom.js";

const TARGET: Record<VercelDeployment["target"], string> = { production: "Production", preview: "Preview", other: "Custom environment" };

const STATE: Record<VercelDeployment["state"], string> = {
  READY: "Ready",
  BUILDING: "Building",
  INITIALIZING: "Building",
  QUEUED: "Queued",
  ERROR: "Build failed",
  CANCELED: "Canceled",
  BLOCKED: "Blocked",
  DELETED: "Deleted",
};

/** The page a deploy link opens: the deploy itself, else its page on vercel.com. Null when neither is allowed. */
export function deployLink(d: VercelDeployment): string | null {
  return [d.url, d.inspectorUrl].find((u): u is string => !!u && isAllowedExternal(u)) ?? null;
}

/** One deploy as a chip, for example "Vercel Production · Ready". Neutral colours: a Vercel state is not a check result. */
export function deployChip(d: VercelDeployment, exact: boolean): string {
  const text = `Vercel ${TARGET[d.target]} · ${STATE[d.state]}`;
  const fit = exact ? "Built from this save point’s commit." : "Built from this save point’s commit. This save point also held changes that were not committed, so the deploy may differ.";
  const label = `${text}. ${fit} Read only. Time Machine never deploys, promotes or rolls back.`;
  const url = deployLink(d);
  const body = `<i aria-hidden="true">▲</i>${esc(text)}<span class="ft-ro">read only</span>`;
  const cls = `ft-deploy ft-deploy-${d.state.toLowerCase()}`;
  return url
    ? `<button type="button" class="${cls}" data-fa="open-deploy" data-url="${esc(url)}" title="${esc(label)}" aria-label="${esc(`${label} Opens in the browser.`)}">${body}</button>`
    : `<span class="${cls}" title="${esc(label)}">${body}</span>`;
}

/** Save point id to chip markup, newest deploy first, for the save points in entries only. */
export function chipsByCheckpoint(result: DeploymentsResult | null, entries: readonly Pick<TimelineEntry, "id">[]): Map<string, string> {
  const out = new Map<string, string>();
  if (!result) return out;
  const shown = new Set(entries.map((e) => e.id));
  const per = new Map<string, { d: VercelDeployment; exact: boolean }[]>();
  for (const m of result.matched) {
    for (const sp of m.savePoints) {
      if (!shown.has(sp.id)) continue;
      per.set(sp.id, [...(per.get(sp.id) ?? []), { d: m.deployment, exact: sp.exact }]);
    }
  }
  for (const [id, list] of per) {
    list.sort((a, b) => b.d.createdAt.localeCompare(a.d.createdAt));
    out.set(id, list.map((x) => deployChip(x.d, x.exact)).join(""));
  }
  return out;
}

/** Opens deploy links from chips anywhere in the window. Capture phase, so the row under a chip is not also selected. */
const bound = new WeakSet<FeatureApi>();
function bindLinks(api: FeatureApi): void {
  if (bound.has(api)) return;
  bound.add(api);
  document.addEventListener(
    "click",
    (e) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-fa="open-deploy"]');
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      const url = el.dataset.url;
      if (url && isAllowedExternal(url)) void api.call({ method: "openExternal", url });
    },
    true,
  );
}

/**
 * Chip markup per save point, for the save points in entries. Empty when the project is not
 * linked to Vercel or Vercel can't be read: the timeline then shows nothing, and the list under
 * the journal says why.
 */
export async function renderDeployChips(projectId: string, entries: readonly Pick<TimelineEntry, "id">[], api: FeatureApi): Promise<Map<string, string>> {
  bindLinks(api);
  const r = await api.call({ method: "deployments", projectId });
  return r.ok ? chipsByCheckpoint(r.data, entries) : new Map();
}

/** The list under the journal: deploys from a computer that no save point can be linked to. */
export function unlinkedHtml(result: DeploymentsResult | null, problem: string | null): string {
  if (problem) return `<div class="ft-unlinked"><p class="ft-note">Couldn’t read deploys from Vercel. ${esc(problem)}</p></div>`;
  if (!result || (!result.noCommit.length && !result.otherCommits.length)) return "";
  const rows = result.noCommit
    .map((d) => {
      const url = deployLink(d);
      const who = d.creator ? ` by ${esc(d.creator)}` : "";
      const open = url ? `<button type="button" class="ft-link" data-fa="open-deploy" data-url="${esc(url)}">Open on Vercel</button>` : "";
      return `<li><span class="ft-deploy ft-deploy-${d.state.toLowerCase()}"><i aria-hidden="true">▲</i>${esc(`${TARGET[d.target]} · ${STATE[d.state]}`)}</span><span class="ft-muted">${esc(when(d.createdAt))}${who}</span>${open}</li>`;
    })
    .join("");
  const other = result.otherCommits.length
    ? `<p class="ft-muted">${esc(`${plural(result.otherCommits.length, "other deploy")} came from Git commits that no save point recorded.`)}</p>`
    : "";
  const head = result.noCommit.length
    ? `<h3>Deployed from your computer, not linked to a save point</h3><p class="ft-muted">These deploys have no Git commit, so Time Machine can’t tell which save point they came from. Read only.</p><ul>${rows}</ul>`
    : "";
  return `<div class="ft-unlinked">${head}${other}</div>`;
}

/** Fills host with the deploys that are not linked to a save point. Returns a function that removes it. */
export function renderUnlinkedDeploys(host: HTMLElement, projectId: string, api: FeatureApi): () => void {
  let alive = true;
  bindLinks(api);
  const load = async (): Promise<void> => {
    const r = await api.call({ method: "deployments", projectId });
    if (alive) host.innerHTML = r.ok ? unlinkedHtml(r.data, null) : unlinkedHtml(null, r.error.message);
  };
  const onChanged = (e: Event): void => {
    if ((e as CustomEvent<{ projectId: string }>).detail.projectId === projectId) void load();
  };
  document.addEventListener(FEATURES_CHANGED, onChanged);
  void load();
  return () => {
    alive = false;
    document.removeEventListener(FEATURES_CHANGED, onChanged);
    host.innerHTML = "";
  };
}
