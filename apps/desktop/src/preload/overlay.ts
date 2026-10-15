// The overlay window can only receive what to show and report a button press.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { OverlayBridge, OverlayContent } from "../shared/api.js";

const bridge: OverlayBridge = {
  onContent: (cb) => {
    ipcRenderer.on("overlay:content", (_e: IpcRendererEvent, c: OverlayContent) => cb(c));
  },
  act: (a) => ipcRenderer.send("overlay:act", a),
  hover: (on) => ipcRenderer.send("overlay:hover", on),
};

contextBridge.exposeInMainWorld("tmOverlay", bridge);
