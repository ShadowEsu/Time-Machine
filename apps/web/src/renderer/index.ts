// The app window. The bridge comes from the preload script.
import type { TmBridge } from "../shared/api.js";
import { start } from "./app.js";
import { mountSplash } from "./splash.js";

declare global {
  interface Window {
    tm: TmBridge;
  }
}

// start() resolves once the settings, the projects and the first page are drawn, or it failed.
// Either way the launch splash can go.
const splash = mountSplash();
void start(window.tm, { preview: false }).finally(() => splash.ready());
