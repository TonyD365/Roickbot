// Electron 主进程：启停核心服务、管理 UI、处理 IPC。
// 主进程为 CommonJS；核心包是 ESM-only，故通过动态 import 加载。

import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import { join } from "node:path";
import { copyFile } from "node:fs/promises";

// core 是 ESM-only 包，从 CommonJS 主进程通过动态 import 加载，故这里用宽松类型。
interface CoreStatus {
  running: boolean;
  port: number;
  pluginConnected: boolean;
  claudeConnected: boolean;
  queueDepth: number;
}

let win: BrowserWindow | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let core: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let service: any;

/** 预编译插件 .rbxmx 的位置（打包后在 resources/，开发时在仓库 dist/）。 */
function pluginArtifactPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, "ClaudeBridge.rbxmx");
  return join(app.getAppPath(), "..", "..", "dist", "ClaudeBridge.rbxmx");
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 540,
    height: 680,
    title: "Claude for Roblox Studio",
    webPreferences: {
      preload: join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  void win.loadFile(join(__dirname, "..", "renderer", "index.html"));
}

function registerIpc(): void {
  ipcMain.handle("get-status", (): CoreStatus => service.getStatus());
  ipcMain.handle("get-token", (): string => service.getToken());

  ipcMain.handle("start-service", async () => {
    await service.start();
    return service.getStatus();
  });
  ipcMain.handle("stop-service", async () => {
    await service.stop();
    return service.getStatus();
  });
  ipcMain.handle("rotate-token", async () => service.rotateToken());

  ipcMain.handle("check-config", async () => {
    const userPath = core.userConfigPath();
    return { userConfigured: await core.isConfigured(userPath), userPath };
  });

  ipcMain.handle("write-config", async () => {
    if (!service.isRunning()) await service.start();
    const userPath = core.userConfigPath();
    await core.writeMcpConfig(userPath, service.port, service.getToken());
    return { written: true, path: userPath };
  });

  // "Install Plugin"：弹文件保存框，用户自选位置，把内置插件写过去。
  ipcMain.handle("install-plugin", async () => {
    const result = await dialog.showSaveDialog(win!, {
      title: "Save Claude Bridge plugin",
      defaultPath: "ClaudeBridge.rbxmx",
      filters: [{ name: "Roblox plugin", extensions: ["rbxmx"] }],
    });
    if (result.canceled || !result.filePath) return { saved: false };
    await copyFile(pluginArtifactPath(), result.filePath);
    return { saved: true, path: result.filePath };
  });

  ipcMain.handle("open-external", (_e, url: string) => shell.openExternal(url));
}

void app.whenReady().then(async () => {
  core = await import("@claude-roblox/core");
  service = new core.CoreService({ tokenPath: join(app.getPath("userData"), "token") });
  service.on("status", (s: CoreStatus) => win?.webContents.send("status", s));
  service.on("handshake", (info: unknown) => win?.webContents.send("handshake", info));

  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async () => {
  await service?.stop();
});
