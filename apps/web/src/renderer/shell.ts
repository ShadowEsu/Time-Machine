// The Calm shell (B6a, Design's B6 spec §1): the sidebar's width and its Recent list, the header's More menu, the one All ▾
// filter menu, Settings' own sections and its Back row, and the keys of a menu and of the phone's drawer. Pure, so the rules
// are tested without a window; app.ts draws the shell from them.
import type { Purpose } from "../shared/api.js";
import { esc } from "../shared/format.js";
import { pinIcon, unitWords, type JournalFilter } from "./runs.js";

/** The sidebar's width beside the page (S1). Below 861 px it is the drawer instead. */
export const SIDEBAR_WIDTH = 248;
/** How many save points the sidebar's Recent keeps (S1). */
export const RECENT_MAX = 5;

/** A save point someone opened or brought back in this window, as Recent names it. */
export interface RecentItem {
  projectId: string;
  id: string;
  label: string;
}

/** Recent with `item` on top: newest first, each save point once (its newest label wins), at most RECENT_MAX. */
export function addRecent(list: readonly RecentItem[], item: RecentItem): RecentItem[] {
  return [item, ...list.filter((x) => x.projectId !== item.projectId || x.id !== item.id)].slice(0, RECENT_MAX);
}

/** How many save points each filter shows. `works` is null for a project with no check, which has no Works filter. */
export interface FilterCounts {
  all: number;
  works: number | null;
  named: number;
  pinned: number;
}

/** One choice in the All ▾ menu. */
export interface FilterChoice {
  v: JournalFilter;
  label: string;
  count: number;
  on: boolean;
}

/** All, Works, Named and Pinned with their counts (S3); no Works for a project with no check. */
export function filterChoices(filter: JournalFilter, c: FilterCounts): FilterChoice[] {
  const all: Omit<FilterChoice, "on">[] = [
    { v: "all", label: "All", count: c.all },
    ...(c.works === null ? [] : [{ v: "works" as const, label: "Works", count: c.works }]),
    { v: "named", label: "Named", count: c.named },
    { v: "pinned", label: "Pinned", count: c.pinned },
  ];
  return all.map((x) => ({ ...x, on: x.v === filter }));
}

/** History's one filter control (S3): a button that names the choice in force, and, open, a menu of the four with counts.
 *  It is a ⋯-style menu of app.ts (key "filter"), so Esc and a press outside close it the same way. */
export function filterMenu(filter: JournalFilter, counts: FilterCounts, purpose: Purpose, open: boolean, enter = ""): string {
  const u = unitWords(purpose);
  const choices = filterChoices(filter, counts);
  const cur = choices.find((x) => x.on) ?? choices[0]!;
  const n = (k: number): string => `<span class="jf-n">${k}</span>`;
  const chev = '<svg class="fm-chev" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const button = `<button class="mn-b fm-b" data-act="menu" data-v="filter" aria-haspopup="menu" aria-expanded="${open}" aria-label="${esc(`Show: ${cur.label}, ${cur.count} ${cur.count === 1 ? u.one : u.many}`)}"><span>${esc(cur.label)}</span>${n(cur.count)}${chev}</button>`;
  const items = choices.map((x) => `<button role="menuitemradio" aria-checked="${x.on}" data-act="journal-filter" data-v="${x.v}">${x.v === "pinned" ? pinIcon(true) : ""}<span class="fm-l">${esc(x.label)}</span>${n(x.count)}</button>`).join("");
  return `<span class="mn fm">${button}${open ? `<div class="mn-l fm-menu${enter ? ` ${enter}` : ""}" role="menu" aria-label="${esc(`Show ${u.many}`)}">${items}</div>` : ""}</span>`;
}

/** Where ↑, ↓, Home and End move inside a menu of `n` items from item `at`; ↑ and ↓ wrap round. Null for any other key. */
export function menuStep(key: string, at: number, n: number): number | null {
  if (n <= 0) return null;
  if (key === "ArrowDown") return (at + 1) % n;
  if (key === "ArrowUp") return (at - 1 + n) % n;
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  return null;
}

/** An item of the header's More menu. */
export interface MoreItem {
  act: string;
  label: string;
  /** The save point or project it acts on. */
  id?: string;
  /** Its shortcut, in the app's "Mod+J" form. */
  key?: string;
}

export interface MoreView {
  /** The open project's id; null away from a project. */
  project: string | null;
  askOpen: boolean;
  /** The save point History has selected, named as in a sentence. */
  selected: { id: string; name: string; pinned: boolean } | null;
}

/** What the header's More holds first (S2): Ask, Pin and Rename for the selected save point, then the project's settings. */
export function moreItems(v: MoreView): MoreItem[] {
  if (!v.project) return [];
  const s = v.selected;
  return [
    { act: "ask-toggle", label: v.askOpen ? "Hide Ask" : "Ask", key: "Mod+J" },
    ...(s ? [{ act: "pin", label: `${s.pinned ? "Unpin" : "Pin"} ${s.name}`, id: s.id }, { act: "rename", label: `Rename ${s.name}`, id: s.id, key: "F2" }] : []),
    { act: "project-settings", label: "Project settings", id: v.project },
  ];
}

/** Settings' own sections, in its sidebar under ← Back (S8). Storage is its own page, drawn under the same sidebar. */
export const SETTINGS_SECTIONS: readonly { id: "license" | "storage" | "appearance" | "agents" | "about"; label: string }[] = [
  { id: "license", label: "Plan and license" },
  { id: "storage", label: "Storage" },
  { id: "appearance", label: "Appearance" },
  { id: "agents", label: "Agents" },
  { id: "about", label: "About" },
];

/** The screens Settings' sidebar stands for: Back never goes to one of them. */
const SETTINGS_SCREENS: Record<string, true> = { settings: true, storage: true };

/** Where ← Back goes: the screen Settings was opened from, else the app's first page. */
export function settingsBack(from: string | null, hasProjects: boolean): string {
  const home = hasProjects ? "overview" : "welcome";
  if (!from || SETTINGS_SCREENS[from] || from === "welcome" || from === "overview") return home;
  return from;
}

/** Tab inside a modal (the drawer, a confirm) from control `at` of `n` (-1: focus is outside it, or on the modal itself): the
 *  next, or the previous with Shift, round. DialogFocus uses it. */
export function trapStep(n: number, at: number, shift: boolean): number {
  if (at < 0) return shift ? n - 1 : 0;
  return shift ? (at - 1 + n) % n : (at + 1) % n;
}
