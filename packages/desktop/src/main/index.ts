// Electron 主进程：启停核心服务、管理 UI、处理 IPC、后台自动更新。
// 主进程为 CommonJS；核心包是 ESM-only，故通过动态 import 加载。

import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import { join } from "node:path";
import { copyFile } from "node:fs/promises";
// electron-updater 是 CommonJS 具名导出，必须具名导入（它没有 default 导出）。
import { autoUpdater } from "electron-updater";

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

/** 调试开关：打包后默认关闭 DevTools；设 CLAUDE_RBX_DEBUG=1 可强制打开。 */
const DEBUG = process.env.CLAUDE_RBX_DEBUG === "1" || !app.isPackaged;

/** 预编译插件 .rbxmx 的位置（打包后在 resources/，开发时在仓库 dist/）。 */
function pluginArtifactPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, "ClaudeBridge.rbxmx");
  return join(app.getAppPath(), "..", "..", "dist", "ClaudeBridge.rbxmx");
}

function createWindow(): void {
  const preloadPath = join(__dirname, "..", "preload", "index.js");
  console.log("[main] preload path:", preloadPath);

  win = new BrowserWindow({
    width: 540,
    height: 700,
    title: "Claude for Roblox Studio",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      // 关闭沙箱，确保 CommonJS preload 能正常注入 window.api。
      sandbox: false,
    },
  });

  // 把渲染进程的报错/日志转发到主进程 stdout，这样终端里也能看到。
  win.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error(`[main] did-fail-load ${code} ${desc} ${url}`);
  });
  win.webContents.on("preload-error", (_e, preloadPath2, error) => {
    console.error(`[main] preload-error in ${preloadPath2}:`, error);
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    console.error("[main] render-process-gone:", details);
  });

  void win.loadFile(join(__dirname, "..", "renderer", "index.html"));
  if (DEBUG) win.webContents.openDevTools({ mode: "detach" });
}

function registerIpc(): void {
  const needService = () => {
    if (!service) throw new Error("Core service is not loaded yet — check the terminal/DevTools for errors.");
    return service;
  };

  ipcMain.handle("get-status", (): CoreStatus | null => (service ? service.getStatus() : null));
  ipcMain.handle("get-token", (): string => (service ? service.getToken() : ""));

  ipcMain.handle("start-service", async () => {
    await needService().start();
    return service.getStatus();
  });
  ipcMain.handle("stop-service", async () => {
    await needService().stop();
    return service.getStatus();
  });
  ipcMain.handle("rotate-token", async () => needService().rotateToken());

  // "Install MCP config"：给两个选项 —— ① 自动写入用户配置；② 手动选择文件位置。
  ipcMain.handle("write-config", async () => {
    const s = needService();
    if (!s.isRunning()) await s.start();

    const choice = await dialog.showMessageBox(win!, {
      type: "question",
      buttons: ["Auto-install", "Choose location…", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      message: "Install the Claude Code MCP config",
      detail:
        "Auto-install writes the server entry to your user config (~/.claude.json).\n" +
        "Or choose a specific .mcp.json location (e.g. a project folder).",
    });
    if (choice.response === 2) return { written: false, cancelled: true };

    let target: string;
    if (choice.response === 0) {
      target = core.userConfigPath();
    } else {
      const r = await dialog.showSaveDialog(win!, {
        title: "Save MCP config",
        defaultPath: ".mcp.json",
        filters: [{ name: "MCP config", extensions: ["json"] }],
      });
      if (r.canceled || !r.filePath) return { written: false, cancelled: true };
      target = r.filePath;
    }

    await core.writeMcpConfig(target, s.port, s.getToken());
    return { written: true, path: target };
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
  ipcMain.handle("restart-to-update", () => autoUpdater.quitAndInstall());
}

/** 后台检查更新（每次启动时）。mac 未签名时无法自动安装，仅记录日志。 */
function startAutoUpdate(): void {
  if (!app.isPackaged) {
    console.log("[updater] skipped (not packaged)");
    return;
  }
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    // 现在的 Release 标记为 pre-release，需允许更新器识别预发布版本。
    autoUpdater.allowPrerelease = true;
    autoUpdater.on("error", (err) => console.error("[updater] error:", err));
    autoUpdater.on("checking-for-update", () => console.log("[updater] checking for updates..."));
    autoUpdater.on("update-available", (info) => console.log("[updater] update available:", info.version));
    autoUpdater.on("update-not-available", () => console.log("[updater] already up to date"));
    autoUpdater.on("update-downloaded", (info) => {
      console.log("[updater] downloaded:", info.version);
      win?.webContents.send("update-ready", info.version);
    });
    // .catch 避免未处理的 Promise 拒绝（例如仓库私有/无网络时的 404）。
    autoUpdater.checkForUpdates().catch((e) => console.error("[updater] check failed:", e?.message ?? e));
  } catch (e) {
    console.error("[updater] failed to start:", e);
  }
}

void app.whenReady().then(async () => {
  // 先建窗口 + 注册 IPC，保证即使 core 加载失败也有界面和报错可看。
  registerIpc();
  createWindow();

  try {
    core = await import("@claude-roblox/core");
    service = new core.CoreService({ tokenPath: join(app.getPath("userData"), "token") });
    service.on("status", (s: CoreStatus) => win?.webContents.send("status", s));
    service.on("handshake", (info: unknown) => win?.webContents.send("handshake", info));
    console.log("[main] core service loaded");
  } catch (e) {
    console.error("[main] failed to load core service:", e);
    dialog.showErrorBox("Failed to start", String(e));
  }

  startAutoUpdate();

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
