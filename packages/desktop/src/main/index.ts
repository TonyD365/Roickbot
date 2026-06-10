// Electron 主进程：启停核心服务、管理 UI、处理 IPC、后台自动更新。
// 主进程为 CommonJS；核心包是 ESM-only，故通过动态 import 加载。

import { app, BrowserWindow, ipcMain, dialog, shell, net } from "electron";
import { join } from "node:path";
import { copyFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
// electron-updater 是 CommonJS 具名导出，必须具名导入（它没有 default 导出）。
import { autoUpdater } from "electron-updater";

const REPO = "TonyD365/Claude-for-Roblox-Studio";
const isMac = process.platform === "darwin";

// core 是 ESM-only 包，从 CommonJS 主进程通过动态 import 加载，故这里用宽松类型。
type McpClient = "claude" | "cursor" | "gemini" | "cline" | "vscode";

interface CoreStatus {
  running: boolean;
  port: number;
  pluginConnected: boolean;
  agentConnected: boolean;
  claudeConnected: boolean;
  mcpClient: string | null;
  queueDepth: number;
}

let win: BrowserWindow | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let core: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let service: any;

/** 调试开关：打包后默认关闭 DevTools；设 CLAUDE_RBX_DEBUG=1 可强制打开。 */
const DEBUG = process.env.CLAUDE_RBX_DEBUG === "1" || !app.isPackaged;

// 兜底：electron-updater 内部下载失败等会抛出未捕获的 Promise 拒绝，记录而非让它变成警告噪音。
process.on("unhandledRejection", (reason) => {
  console.error("[main] unhandledRejection:", reason instanceof Error ? reason.message : reason);
});

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
    // 版本号放进标题栏：即使渲染层出问题，也能一眼看出是不是新版本实例。
    title: `Claude for Roblox Studio v${app.getVersion()}`,
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

  ipcMain.handle("get-version", () => app.getVersion());
  ipcMain.handle("get-status", (): CoreStatus | null => (service ? service.getStatus() : null));
  ipcMain.handle("get-token", (): string => (service ? service.getToken() : ""));

  ipcMain.handle("start-service", async () => {
    try {
      await needService().start();
    } catch (e: unknown) {
      if (e && (e as { code?: string }).code === "EADDRINUSE") {
        throw new Error(`Port ${service.port} is already in use — another instance may be running.`);
      }
      throw e;
    }
    return service.getStatus();
  });
  ipcMain.handle("stop-service", async () => {
    await needService().stop();
    return service.getStatus();
  });
  ipcMain.handle("rotate-token", async () => needService().rotateToken());
  ipcMain.handle("get-activity", (_e, limit?: number) =>
    service ? service.getRecentActivity(limit ?? 30) : { commands: [], events: [] },
  );

  // "Install MCP config"：按所选客户端的正确格式写入。
  // 路径固定的客户端(Claude/Cursor/Gemini)给「自动安装 / 选位置」二选一；
  // 路径不固定的(Cline/VS Code)直接弹保存框，但内容仍按该客户端格式生成。
  ipcMain.handle("write-config", async (_e, clientId?: string) => {
    const s = needService();
    if (!s.isRunning()) await s.start();

    const client = (clientId as McpClient) || "claude";
    const info = core.clientInfo(client);

    let target: string | undefined;
    if (info.defaultPath) {
      const choice = await dialog.showMessageBox(win!, {
        type: "question",
        buttons: ["Auto-install", "Choose location…", "Cancel"],
        defaultId: 0,
        cancelId: 2,
        message: `Install the ${info.label} MCP config`,
        detail:
          `Auto-install writes the server entry to ${info.defaultPath}.\n` +
          `Or choose a specific config file location.\n\n${info.note}`,
      });
      if (choice.response === 2) return { written: false, cancelled: true };
      if (choice.response === 0) target = info.defaultPath;
    }

    if (!target) {
      const r = await dialog.showSaveDialog(win!, {
        title: `Save ${info.label} MCP config`,
        defaultPath: defaultConfigFilename(client),
        filters: [{ name: "MCP config", extensions: ["json"] }],
      });
      if (r.canceled || !r.filePath) return { written: false, cancelled: true };
      target = r.filePath;
    }

    const res = await core.writeClientConfig(client, target, s.port, s.getToken());
    return { written: true, path: res.path, client };
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

  // macOS 半自动更新：把 dmg 下载到桌面并打开，用户自行拖进 Applications。
  ipcMain.handle("download-update", async (_e, url: string) => {
    const name = url.split("/").pop() || "Claude-for-Roblox-Studio.dmg";
    const dest = join(app.getPath("desktop"), name);
    await downloadFile(url, dest);
    await shell.openPath(dest);
    return { path: dest };
  });
}

/** 没有固定路径时，给保存框一个合理的默认文件名。 */
function defaultConfigFilename(client: McpClient): string {
  if (client === "cline") return "cline_mcp_settings.json";
  if (client === "vscode") return "mcp.json";
  return ".mcp.json";
}

/** 用 Electron net 下载文件（自动跟随重定向）到本地路径。 */
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = net.request(url);
    request.on("response", (response) => {
      const status = response.statusCode;
      if (status >= 400) {
        reject(new Error(`Download failed: HTTP ${status}`));
        return;
      }
      const file = createWriteStream(dest);
      response.on("data", (chunk) => file.write(chunk));
      response.on("end", () => file.end(() => resolve()));
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end();
  });
}

/** 后台检查更新（每次启动时）。mac 未签名时无法自动安装，仅记录日志。 */
function startAutoUpdate(): void {
  if (!app.isPackaged) {
    console.log("[updater] skipped (not packaged)");
    return;
  }
  try {
    // macOS 未签名无法用 Squirrel 自动安装，改为"下载 dmg 到桌面并打开，用户手动拖入"。
    // Windows 走 electron-updater 全自动下载 + 重启安装。
    autoUpdater.autoDownload = !isMac;
    autoUpdater.autoInstallOnAppQuit = !isMac;
    // 只更新到最新的“正式版”(GitHub 的 Latest release，非 pre-release)。
    // 这样发 pre-release 测试版不会打扰用户；只有把正式 Latest 升到新版本才提示更新。
    autoUpdater.allowPrerelease = false;
    autoUpdater.on("error", (err) => console.error("[updater] error:", err));
    autoUpdater.on("checking-for-update", () => console.log("[updater] checking for updates..."));
    autoUpdater.on("update-not-available", () => console.log("[updater] already up to date"));
    autoUpdater.on("update-available", (info) => {
      console.log("[updater] update available:", info.version);
      if (isMac) {
        const arch = process.arch === "arm64" ? "arm64" : "x64";
        const file = `Claude-for-Roblox-Studio-${info.version}-${arch}.dmg`;
        const url = `https://github.com/${REPO}/releases/download/v${info.version}/${file}`;
        win?.webContents.send("update-manual", { version: info.version, url });
      }
    });
    autoUpdater.on("update-downloaded", (info) => {
      console.log("[updater] downloaded:", info.version);
      win?.webContents.send("update-ready", info.version);
    });
    // .catch 避免未处理的 Promise 拒绝（例如无网络/404）。
    autoUpdater.checkForUpdates().catch((e) => console.error("[updater] check failed:", e?.message ?? e));
  } catch (e) {
    console.error("[updater] failed to start:", e);
  }
}

// 单实例锁：杜绝多开（多开会争抢 127.0.0.1:7331 导致 EADDRINUSE，并造成新旧窗口混淆）。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

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
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async () => {
  await service?.stop();
});
