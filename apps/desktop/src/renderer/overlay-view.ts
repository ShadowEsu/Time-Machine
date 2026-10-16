// Draws the corner card and the timeline strip. Used by the overlay window and by the
// browser preview, which simulates the overlay inside the page.
import type { OverlayAction, OverlayContent } from "../shared/api.js";
import { esc, verdictKey, verdictWord, when } from "../shared/format.js";

export interface OverlayHooks {
  act(a: OverlayAction): void;
  hover(on: boolean): void;
}

function glyph(v: Parameters<typeof verdictKey>[0]): string {
  return `<i class="g v-${verdictKey(v)}" aria-hidden="true"></i>`;
}

export function mountOverlay(host: HTMLElement, content: OverlayContent, hooks: OverlayHooks): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const actions = new Map<string, OverlayAction>();
  const id = (a: OverlayAction): string => {
    const k = String(actions.size);
    actions.set(k, a);
    return k;
  };
  const dismiss: OverlayAction = { kind: "dismiss" };

  if (content.kind === "pill") {
    // No timer and no close button: it lives exactly as long as the agent turn.
    host.innerHTML = `<button class="ov-pill" role="status" aria-live="polite" title="Open the History of ${esc(content.projectName)}"><span class="breath" aria-hidden="true"></span>${esc(content.agent)} is working · ${esc(content.projectName)}</button>`;
    const open: OverlayAction = { kind: "history", projectId: content.projectId };
    host.querySelector("button")?.addEventListener("click", () => hooks.act(open));
    return () => {
      host.innerHTML = "";
    };
  }

  if (content.kind === "card") {
    const btn = (b: typeof content.primary, dark: boolean): string =>
      b ? `<button class="btn${dark ? " dark" : ""}" data-ov="${id(b.action)}">${esc(b.label)}</button>` : "";
    const word = content.verdict ? verdictWord(content.verdict) : "";
    host.innerHTML = `<div class="ov-wrap"><div class="ov-card" role="status" aria-live="polite">
      <button class="x" data-ov="${id(dismiss)}" aria-label="Close card">✕</button>
      <div class="top"><span class="ic v-${verdictKey(content.verdict)}" title="${esc(word)}">${glyph(content.verdict)}</span>
        <div><div class="proj">${esc(content.projectName)}${word ? ` · ${esc(word)}` : ""}</div><b>${esc(content.title)}</b><p class="s">${esc(content.body)}</p></div></div>
      ${content.primary || content.secondary ? `<div class="row-btns">${btn(content.primary, true)}${btn(content.secondary, false)}</div>` : ""}
    </div></div>`;
  } else {
    const pts = content.points;
    const newest = pts.at(-1);
    const working = [...pts].reverse().find((p) => p.verdict === "PASS" && p.id !== newest?.id);
    const ticks = pts
      .map((p) => `<button class="tk" data-ov="${id({ kind: "history", projectId: content.projectId, target: p.id })}" data-tip="${esc(`${when(p.createdAt)} · ${p.note} · ${verdictWord(p.verdict)}`)}" aria-label="${esc(`${when(p.createdAt)}, ${p.note}, ${verdictWord(p.verdict)}`)}">${glyph(p.verdict)}</button>`)
      .join("");
    host.innerHTML = `<div class="ov-strip" role="dialog" aria-label="Timeline">
      <div class="hd">${esc(content.projectName)} <span class="muted">${pts.length ? `${pts.length} save points, newest on the right` : "No save points yet"}</span>
        ${working && newest?.verdict !== "PASS" ? `<button class="btn dark" data-ov="${id({ kind: "rewind", projectId: content.projectId, target: working.id })}"><span class="tri"></span>Go back to the ${esc(when(working.createdAt))} version</button>` : ""}
        <button class="btn ghost x" data-ov="${id(dismiss)}" aria-label="Close timeline">Close</button></div>
      <div class="ticks">${ticks}</div>
      <div class="tip">Hover a save point to see it. Click to open it in the app.</div>
    </div>`;
    const tip = host.querySelector<HTMLElement>(".tip");
    host.querySelectorAll<HTMLElement>(".tk").forEach((t) => t.addEventListener("mouseenter", () => tip && (tip.textContent = t.dataset.tip ?? "")));
  }

  const close = (): void => {
    clearTimeout(timer);
    host.innerHTML = "";
  };
  const arm = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      close();
      hooks.act(dismiss);
    }, content.hideAfterMs);
  };
  const root = host.firstElementChild;
  root?.addEventListener("mouseenter", () => {
    clearTimeout(timer);
    hooks.hover(true);
  });
  root?.addEventListener("mouseleave", () => {
    hooks.hover(false);
    arm();
  });
  host.querySelectorAll<HTMLElement>("[data-ov]").forEach((el) =>
    el.addEventListener("click", () => {
      const a = actions.get(el.dataset.ov ?? "");
      if (!a) return;
      close();
      hooks.act(a);
    }),
  );
  arm();
  return close;
}
