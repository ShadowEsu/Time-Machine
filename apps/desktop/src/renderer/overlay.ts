// The overlay window: one card or the timeline strip at a time. It never takes focus.
import type { OverlayBridge } from "../shared/api.js";
import { mountOverlay } from "./overlay-view.js";

declare global {
  interface Window {
    tmOverlay: OverlayBridge;
  }
}

const host = document.getElementById("overlay");
const bridge = window.tmOverlay;
let close: (() => void) | null = null;
if (host && bridge) {
  bridge.onContent((c) => {
    close?.();
    close = mountOverlay(host, c, { act: (a) => bridge.act(a), hover: (on) => bridge.hover(on) });
  });
}
