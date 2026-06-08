// Preload：通过 contextBridge 暴露受限 API 给渲染进程。

import { contextBridge, ipcRenderer } from "electron";

const api = {
  getStatus: () => ipcRenderer.invoke("get-status"),
  getToken: () => ipcRenderer.invoke("get-token"),
  start: () => ipcRenderer.invoke("start-service"),
  stop: () => ipcRenderer.invoke("stop-service"),
  rotateToken: () => ipcRenderer.invoke("rotate-token"),
  checkConfig: () => ipcRenderer.invoke("check-config"),
  writeConfig: () => ipcRenderer.invoke("write-config"),
  installPlugin: () => ipcRenderer.invoke("install-plugin"),
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
  onStatus: (cb: (status: unknown) => void) =>
    ipcRenderer.on("status", (_e, status) => cb(status)),
  onHandshake: (cb: (info: unknown) => void) =>
    ipcRenderer.on("handshake", (_e, info) => cb(info)),
};

contextBridge.exposeInMainWorld("api", api);

export type DesktopApi = typeof api;
