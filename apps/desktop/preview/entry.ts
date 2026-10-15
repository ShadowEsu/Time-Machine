// Browser preview: the real app renderer with the engine swapped for an in-memory demo.
// The overlay card and the timeline strip are simulated inside the page.
import type { OverlayAction, OverlayContent } from "../src/shared/api.js";
import { verdictCard } from "../src/shared/cards.js";
import { start } from "../src/renderer/app.js";
import { mountOverlay } from "../src/renderer/overlay-view.js";
import { FakeEngine } from "./fake.js";

const fake = new FakeEngine();
const projectId = fake.project.id;
let closeCurrent: (() => void) | null = null;

function host(cls: string): HTMLElement {
  document.querySelectorAll(".sim-overlay, .sim-strip").forEach((n) => n.remove());
  const el = document.createElement("div");
  el.className = cls;
  document.body.appendChild(el);
  return el;
}

function act(a: OverlayAction): void {
  document.querySelectorAll(".sim-overlay, .sim-strip").forEach((n) => n.remove());
  if (a.kind === "rewind") fake.navigate({ type: "navigate", projectId: a.projectId, screen: "rewind", target: a.target });
  else if (a.kind === "compare") fake.navigate({ type: "navigate", projectId: a.projectId, screen: "compare", a: a.a, b: a.b });
  else if (a.kind === "history") fake.navigate({ type: "navigate", projectId: a.projectId, screen: "history", ...(a.target ? { target: a.target } : {}) });
}

function show(content: OverlayContent, cls: string): void {
  closeCurrent?.();
  const el = host(cls);
  const label = document.createElement("div");
  label.className = "sim-label";
  label.textContent = content.kind === "card" ? "Overlay card, simulated. In the app it floats over other apps." : "";
  const inner = document.createElement("div");
  el.append(label, inner);
  closeCurrent = mountOverlay(inner, content, { act: (a) => act(a), hover: () => undefined });
}

function showCard(): void {
  const points = fake.timelineEntries().map((c) => ({ id: c.id, verdict: c.verdict, note: c.note, createdAt: c.createdAt }));
  const card = verdictCard(projectId, fake.project.name, points, null);
  if (card) show({ ...card, hideAfterMs: 30000 }, "sim-overlay");
}

function showStrip(): void {
  const points = fake.timelineEntries().map((c) => ({ id: c.id, verdict: c.verdict, note: c.note, createdAt: c.createdAt }));
  show({ kind: "strip", projectId, projectName: fake.project.name, points, hideAfterMs: 15000 }, "sim-strip");
}

void start(fake, {
  preview: true,
  onStrip: () => showStrip(),
  previewActions: [
    { label: "Show the overlay card", run: showCard },
    { label: "Show the timeline strip (⌘⇧T)", run: showStrip },
  ],
}).then(() => setTimeout(showCard, 1800));
