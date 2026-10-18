// The app window. The bridge comes from the preload script.
import type { TmBridge } from "../shared/api.js";
import { start } from "./app.js";

declare global {
  interface Window {
    tm: TmBridge;
  }
}

start(window.tm, { preview: false });
