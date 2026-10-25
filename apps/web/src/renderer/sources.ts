// Sources: where Time Machine can keep versions from. Built connectors first (Git projects, plain folders, Claude Code,
// Vercel deploys read-only), then well-known folders found on this computer, each one a folder of your own you can protect.
// Planned connectors (Codex, Gemini, Google Docs, Notion, Gmail, Slack) show only under Labs preview, each with sample
// data and "Planned, not connected". Nothing here signs in, asks for a key or calls the network.
import type { ProjectEntry, Purpose, SourceId, SourceRow } from "../shared/api.js";
import { esc, plural } from "../shared/format.js";
import type { Channel } from "./channels.js";

/** The Labs preview switch, kept in this browser only. */
export const LABS_KEY = "tm.labs";

/** What a found folder most likely holds, so the Add flow can start on it. Notes and cloud folders are documents; the
 *  Desktop could be anything, so it asks. */
export const SOURCE_PURPOSE: { [K in SourceId]: Purpose | null } = {
  icloud: "documents", dropbox: "documents", gdrive: "documents", onedrive: "documents", obsidian: "documents", documents: "documents", desktop: null,
};

/** A path with the home folder as ~. The page wraps it anywhere when the line is short; the full path is in the title. */
export const homePath = (path: string): string => path.replace(/^(\/Users|\/home)\/[^/]+(?=\/|$)/, "~");

/** A planned connector, with the sample its preview card shows. Never connected; the label always says so. */
export interface PlannedSource {
  name: string;
  kind: "agent" | "cloud";
  /** What it would keep versions of, in one line. */
  would: string;
  /** Sample rows for the preview card: a title and a quiet detail. Made up, and marked as a sample. */
  sample: [string, string][];
}

export const PLANNED_SOURCES: readonly PlannedSource[] = [
  { name: "Codex", kind: "agent", would: "Save before each Codex turn and check after it, like Claude Code.", sample: [["Turn: refactor the parser", "saved before, checked after"], ["Turn: add CSV export", "saved before"]] },
  { name: "Gemini", kind: "agent", would: "Save before each Gemini CLI turn and check after it.", sample: [["Turn: write the migration", "saved before, checked after"], ["Turn: fix flaky test", "saved before"]] },
  { name: "Google Docs", kind: "cloud", would: "Keep versions of the docs you pick, next to your local history.", sample: [["Grant proposal draft", "14 versions"], ["Lab meeting notes", "6 versions"]] },
  { name: "Notion", kind: "cloud", would: "Keep versions of the pages you pick.", sample: [["Experiment log", "22 versions"], ["Reading list", "3 versions"]] },
  { name: "Gmail", kind: "cloud", would: "Keep a copy of the drafts you pick before an agent edits them.", sample: [["Draft: reply to reviewers", "4 versions"], ["Draft: weekly update", "2 versions"]] },
  { name: "Slack", kind: "cloud", would: "Keep a copy of messages an agent drafts, before they are sent.", sample: [["#lab-updates draft", "3 versions"], ["Note to self", "1 version"]] },
];

export interface SourcesInput {
  projects: readonly ProjectEntry[];
  /** Null while they are read; "error" when they could not be. */
  sources: readonly SourceRow[] | null | "error";
  claude: Channel | null;
  labs: boolean;
  /** "On this Mac" on macOS, "On this computer" elsewhere. */
  platform: string;
  agentMark: (name: string) => string;
}

const ICONS = {
  git: '<circle cx="6" cy="5" r="1.8"/><circle cx="6" cy="15" r="1.8"/><circle cx="14" cy="8" r="1.8"/><path d="M6 6.8v6.4M14 9.8c0 2.6-3.4 2.4-7.2 4"/>',
  folder: '<path d="M3 6.6A1.6 1.6 0 0 1 4.6 5h3.1l1.7 1.8h6A1.6 1.6 0 0 1 17 8.4v6A1.6 1.6 0 0 1 15.4 16H4.6A1.6 1.6 0 0 1 3 14.4z"/>',
  cloud: '<path d="M6.2 15.5h8.1a3.2 3.2 0 0 0 .5-6.4 4.6 4.6 0 0 0-8.9.9 2.8 2.8 0 0 0 .3 5.5z"/>',
  notes: '<path d="M5 3.5h6.5L15 7v9.5H5z"/><path d="M11.5 3.5V7H15M7.5 10.5h5M7.5 13.5h3.5"/>',
  deploy: '<path d="M10 3.5 16.5 15h-13z"/>',
  mail: '<rect x="3" y="5" width="14" height="10" rx="1.8"/><path d="m3.6 6 6.4 5 6.4-5"/>',
  hash: '<path d="M8 3.5 6.5 16.5M13.5 3.5 12 16.5M4 7.5h12.5M3.5 12.5H16"/>',
} as const;
type IconName = keyof typeof ICONS;

function icon(name: IconName): string {
  return `<span class="pico" aria-hidden="true"><svg viewBox="0 0 20 20" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg></span>`;
}

const SOURCE_ICON: { [K in SourceId]: IconName } = { icloud: "cloud", dropbox: "cloud", gdrive: "cloud", onedrive: "cloud", obsidian: "notes", documents: "folder", desktop: "folder" };
const PLANNED_ICON: { [name: string]: IconName } = { "Google Docs": "notes", Notion: "notes", Gmail: "mail", Slack: "hash" };

/** The protected items inside a found folder, by name: a project whose path is that folder or under it. */
export function protectedIn(source: SourceRow, projects: readonly Pick<ProjectEntry, "path" | "name">[]): string[] {
  const base = source.path.replace(/\/+$/, "");
  return projects.filter((p) => p.path === base || p.path.startsWith(`${base}/`)).map((p) => p.name);
}

function row(mark: string, title: string, line: string, right: string, cls = ""): string {
  return `<div class="b9-row so-row${cls ? ` ${cls}` : ""}">${mark}<div class="b9-main"><p class="b9-t">${title}</p><p class="b9-sub">${line}</p></div>${right}</div>`;
}

function built(input: SourcesInput): string {
  const git = input.projects.filter((p) => p.kind === "git" && !p.demo).length;
  const folders = input.projects.filter((p) => p.kind === "folder").length;
  const vercel = input.projects.filter((p) => p.features.vercel).length;
  const on = (text: string): string => `<span class="b9-pill so-on">${esc(text)}</span>`;
  const c = input.claude;
  return [
    row(icon("git"), "Git projects", "Every commit, plus the work you have not committed yet. Recovery makes a new branch and a copy.", on(git ? `${plural(git, "project")}` : "Ready")),
    row(icon("folder"), "Folders", "Any folder of your own, no Git needed. Its history lives in the Time Machine store, so nothing is written in the folder.", on(folders ? `${plural(folders, "folder")}` : "Ready")),
    row(input.agentMark("Claude Code"), "Claude Code", esc(c ? c.line : "Reading connection…"), `<button class="btn quiet" data-act="agents">Open Agents</button>`),
    row(icon("deploy"), "Vercel deploys", esc(`${vercel ? `Linked in ${plural(vercel, "project")}. ` : ""}Read only: shows which deploy matches a save point. It never deploys, promotes or rolls back anything.`), `<button class="btn quiet" data-act="settings">${vercel ? "Manage" : "Link a project"}</button>`),
  ].join("");
}

function found(input: SourcesInput): string {
  const s = input.sources;
  if (s === null) return '<div class="b9-list b9-sk" role="status" aria-label="Loading"><div class="b9-row" aria-hidden="true"><i></i><i></i></div><div class="b9-row" aria-hidden="true"><i></i><i></i></div></div>';
  if (s === "error") return '<p class="b9-lede">We couldn’t look for these folders right now. Protect any folder from the Add flow instead.</p>';
  const here = s.filter((x) => x.found);
  const missing = s.filter((x) => !x.found).map((x) => x.label);
  const rows = here.map((x) => {
    const already = protectedIn(x, input.projects);
    const right = `<button class="btn" data-act="source-add" data-path="${esc(x.path)}" data-id="${esc(x.id)}">Protect a folder here</button>`;
    return row(icon(SOURCE_ICON[x.id]), esc(x.label), `<span class="mono so-path" title="${esc(x.path)}">${esc(homePath(x.path))}</span>${already.length ? `<span class="so-prot">${esc(`Protected here: ${already.join(", ")}`)}</span>` : ""}`, right);
  }).join("");
  return `${here.length ? `<div class="b9-list">${rows}</div>` : '<div class="empty-dir"><p>None of the usual folders are on this computer. Choose any folder to protect it.</p><button class="btn" data-act="add">Protect a folder</button></div>'}
    ${missing.length ? `<p class="so-miss">${esc(`Not found here: ${new Intl.ListFormat("en", { type: "conjunction" }).format(missing)}.`)}</p>` : ""}`;
}

function plannedCard(p: PlannedSource, agentMark: (name: string) => string): string {
  const mark = p.kind === "agent" ? agentMark(p.name) : icon(PLANNED_ICON[p.name] ?? "cloud");
  return `<li class="so-card"><div class="so-ch">${mark}<b>${esc(p.name)}</b><span class="so-planned">Planned, not connected</span></div>
    <p class="so-would">${esc(p.would)}</p>
    <div class="so-sample" role="img" aria-label="${esc(`Sample preview of ${p.name}. Not real data.`)}"><span class="so-sl">Sample</span>${p.sample.map(([t, d]) => `<span class="so-sr"><span>${esc(t)}</span><small>${esc(d)}</small></span>`).join("")}</div></li>`;
}

/** The Sources page. */
export function sourcesPage(input: SourcesInput): string {
  const where = input.platform === "darwin" ? "On this Mac" : "On this computer";
  const labs = input.labs
    ? `<ul class="so-cards">${PLANNED_SOURCES.map((p) => plannedCard(p, input.agentMark)).join("")}</ul>
      <p class="b9-lede so-labs-note">These are previews of planned connectors with sample data. None is built or connected. Nothing signs in and nothing leaves this computer.</p>`
    : "";
  return `<div class="page b9-page so-page" id="sources-page" tabindex="-1" role="region" aria-label="Sources"><div class="b9">
    <header class="b9-head"><h1>Sources</h1><p class="voice b9-voice">Where Time Machine keeps versions from. All of it on this computer.</p></header>
    <section aria-labelledby="so-built-h"><div class="b9-day"><h2 id="so-built-h">Connected</h2><span>Built and working today</span></div><div class="b9-list">${built(input)}</div></section>
    <section aria-labelledby="so-here-h"><div class="b9-day"><h2 id="so-here-h">${where}</h2><span>Folders we found. We only check that they exist.</span></div>${found(input)}</section>
    <section aria-labelledby="so-labs-h"><div class="b9-day so-labs-h"><h2 id="so-labs-h">Planned</h2><span class="so-switch"><span id="so-labs-l">Labs preview</span><button class="switch${input.labs ? " on" : ""}" role="switch" aria-checked="${input.labs}" aria-labelledby="so-labs-l" data-act="labs"></button></span></div>
      <p class="b9-lede">${input.labs ? "Planned connectors, shown with sample data." : "Codex, Gemini, Google Docs, Notion, Gmail and Slack are planned. Turn on Labs preview to see what each would show."}</p>${labs}</section>
  </div></div>`;
}
