// Small DOM helpers shared by the Ask panel, the deploy list and the feature settings.
import type { TmBridge } from "../shared/api.js";
import { homeHtml } from "../shared/format.js";

/** The bridge the feature views call. Only call is used, so tests and the preview can pass a fake. */
export type FeatureApi = Pick<TmBridge, "call">;

/** Fired on document after a feature or key changes, so every mounted view reloads. */
export const FEATURES_CHANGED = "tm-features-changed";

export function announceFeatures(projectId: string): void {
  document.dispatchEvent(new CustomEvent(FEATURES_CHANGED, { detail: { projectId } }));
}

/**
 * Replaces the host's markup but keeps what the person was typing. Fields marked data-keep
 * carry their value, focus and caret over by key. Values move between DOM nodes only and
 * never go into markup, so a pasted key is never written into HTML. Paths read ~ for the
 * home folder (homeHtml), as on the rest of the page.
 */
export function patch(host: HTMLElement, html: string): void {
  const kept = new Map<string, { value: string; focused: boolean; start: number | null; end: number | null }>();
  for (const el of host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[data-keep]")) {
    const key = el.dataset.keep ?? "";
    const text = el instanceof HTMLSelectElement ? null : el;
    kept.set(key, { value: el.value, focused: document.activeElement === el, start: text?.selectionStart ?? null, end: text?.selectionEnd ?? null });
  }
  host.innerHTML = homeHtml(html);
  for (const el of host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[data-keep]")) {
    const k = kept.get(el.dataset.keep ?? "");
    if (!k) continue;
    if (k.value && !(el instanceof HTMLSelectElement && ![...el.options].some((o) => o.value === k.value))) el.value = k.value;
    if (!k.focused || el.disabled) continue;
    el.focus();
    if (!(el instanceof HTMLSelectElement) && k.start !== null) el.setSelectionRange(k.start, k.end ?? k.start);
  }
}

/**
 * Keeps plain keys typed in the host's fields away from the app's single-key shortcuts on window.
 * Shortcuts with Command or Control still reach the app.
 */
export function isolateTyping(e: KeyboardEvent): void {
  const t = e.target;
  const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
  if (typing && !e.metaKey && !e.ctrlKey && e.key !== "Escape") e.stopPropagation();
}

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
