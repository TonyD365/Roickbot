// Preload：通过 contextBridge 暴露受限 API 给渲染进程。

import { contextBridge, ipcRenderer } from "electron";

const api = {
  getVersion: () => ipcRenderer.invoke("get-version"),
  getStatus: () => ipcRenderer.invoke("get-status"),
  getToken: () => ipcRenderer.invoke("get-token"),
  start: () => ipcRenderer.invoke("start-service"),
  stop: () => ipcRenderer.invoke("stop-service"),
  rotateToken: () => ipcRenderer.invoke("rotate-token"),
  writeConfig: (client?: string) => ipcRenderer.invoke("write-config", client),
  installPlugin: () => ipcRenderer.invoke("install-plugin"),
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
  restartToUpdate: () => ipcRenderer.invoke("restart-to-update"),
  downloadUpdate: (url: string) => ipcRenderer.invoke("download-update", url),
  onStatus: (cb: (status: unknown) => void) =>
    ipcRenderer.on("status", (_e, status) => cb(status)),
  onHandshake: (cb: (info: unknown) => void) =>
    ipcRenderer.on("handshake", (_e, info) => cb(info)),
  onUpdateReady: (cb: (version: string) => void) =>
    ipcRenderer.on("update-ready", (_e, version) => cb(version)),
  onUpdateManual: (cb: (info: { version: string; url: string }) => void) =>
    ipcRenderer.on("update-manual", (_e, info) => cb(info)),
};

try {
  contextBridge.exposeInMainWorld("api", api);
  // 便于在终端确认 preload 注入成功。
  console.log("[preload] api exposed");
} catch (e) {
  console.error("[preload] failed to expose api:", e);
}

export type DesktopApi = typeof api;
