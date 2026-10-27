// Where the page is, kept for this tab, so a reload or the Reconnect button lands where you were (writer#29, dev#31).
// The browser bridge clears the address bar's fragment (it carries the token), so the route cannot live in the URL.

export const ROUTE_KEY = "tm.route";

export type RouteScreen = "welcome" | "overview" | "onboarding" | "history" | "agents" | "storage" | "settings" | "plan" | "sources";
export type Route = { screen: RouteScreen; projectId: string | null; drawer: boolean; selected: string | null };

const SCREENS: readonly string[] = ["welcome", "overview", "onboarding", "history", "agents", "storage", "settings", "plan", "sources"];

/**
 * The kept route as it can be shown now, or null to start as usual. A Rewind or Compare comes back as its project's
 * History (their steps are not kept), a project that was removed is not opened, and the detail opens again only with
 * the save point it showed.
 */
export function restoreRoute(saved: string | null, projectIds: readonly string[]): Route | null {
  let raw: unknown;
  try {
    raw = saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { screen?: unknown; projectId?: unknown; drawer?: unknown; selected?: unknown };
  const asked = r.screen === "rewind" || r.screen === "compare" ? "history" : r.screen;
  if (typeof asked !== "string" || !SCREENS.includes(asked)) return null;
  const projectId = typeof r.projectId === "string" && projectIds.includes(r.projectId) ? r.projectId : null;
  const screen = asked === "history" && !projectId ? "overview" : (asked as RouteScreen);
  if (!projectIds.length && screen !== "onboarding") return { screen: "welcome", projectId: null, drawer: false, selected: null };
  const selected = screen === "history" && r.drawer === true && typeof r.selected === "string" ? r.selected : null;
  return { screen, projectId, drawer: selected !== null, selected };
}
