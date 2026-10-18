// The only door between the app window and the main process. Exposes two functions.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AppEvent, TmBridge } from "../shared/api.js";

const bridge: TmBridge = {
  call: (call) => ipcRenderer.invoke("tm:call", call),
  onEvent: (cb) => {
    const fn = (_e: IpcRendererEvent, ev: AppEvent): void => cb(ev);
    ipcRenderer.on("tm:event", fn);
    return () => ipcRenderer.removeListener("tm:event", fn);
  },
};

contextBridge.exposeInMainWorld("tm", bridge);
