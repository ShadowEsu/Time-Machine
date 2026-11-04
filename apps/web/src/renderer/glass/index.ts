// Glass on the app's floating surfaces (glass.css). The level is on <html data-glass>: "subtle" or "full".
// Each surface gets .lg-glass when it appears and attachGlass's rim and lens; both go when it leaves.
import { attachGlass } from "./refraction.js";

export type GlassLevel = "subtle" | "full";

const SUBTLE = ".sheet, .pal, .toast, .side.mobile-side";
const FULL = `${SUBTLE}, .toolbar, .side, .panel`;

/** Asking for less transparency, more contrast or forced colours keeps every surface solid. */
const solid = (): boolean =>
  matchMedia("(prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)").matches;

export function startGlass(level: GlassLevel, root: HTMLElement = document.body): () => void {
  document.documentElement.setAttribute("data-glass", level);
  if (solid()) return () => document.documentElement.removeAttribute("data-glass");
  const selector = level === "full" ? FULL : SUBTLE;
  const attached = new Map<HTMLElement, () => void>();
  const add = (element: HTMLElement) => {
    if (attached.has(element)) return;
    element.classList.add("lg-glass");
    attached.set(element, attachGlass(element));
  };
  const scan = (node: Node) => {
    if (!(node instanceof HTMLElement)) return;
    if (node.matches(selector)) add(node);
    node.querySelectorAll<HTMLElement>(selector).forEach(add);
  };
  const sweep = () => {
    for (const [element, stop] of attached) {
      if (element.isConnected) continue;
      stop();
      attached.delete(element);
    }
  };
  scan(root);
  const observer = new MutationObserver((records) => {
    for (const record of records) record.addedNodes.forEach(scan);
    sweep();
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    for (const [element, stop] of attached) {
      stop();
      element.classList.remove("lg-glass");
    }
    attached.clear();
    document.documentElement.removeAttribute("data-glass");
  };
}
