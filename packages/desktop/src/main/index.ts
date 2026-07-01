// Electron 主进程：启停核心服务、管理 UI、处理 IPC、后台自动更新。
// 主进程为 CommonJS；核心包是 ESM-only，故通过动态 import 加载。

import { app, BrowserWindow, ipcMain, dialog, shell, net, Tray, Menu, nativeImage, clipboard } from "electron";
import type { MenuItemConstructorOptions } from "electron";
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
let tray: Tray | null = null;

interface PendingUpdate {
  version: string;
  notes: string; // GitHub release body (markdown)
  kind: "win" | "mac";
  url?: string; // mac: the .dmg url to download
}
let pendingUpdate: PendingUpdate | null = null;
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

  // 开发用：CLAUDE_RBX_SCREENSHOT=<path> 时，加载后截图保存（供 UI 迭代验证）。
  if (process.env.CLAUDE_RBX_SCREENSHOT) {
    win.webContents.on("did-finish-load", () => {
      setTimeout(() => {
        void win!.webContents
          .capturePage()
          .then(async (img) => {
            const { writeFileSync } = await import("node:fs");
            writeFileSync(process.env.CLAUDE_RBX_SCREENSHOT!, img.toPNG());
            console.log("[main] screenshot saved");
          })
          .catch((e) => console.error("[main] screenshot failed:", e));
      }, 700);
    });
  }
}

/** 显示（或新建）主窗口并聚焦。 */
function showWindow(): void {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---- 共享动作（IPC 与 托盘/Dock 菜单都用这些） ----
const MCP_CLIENT_MENU: { id: McpClient; label: string }[] = [
  { id: "claude", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
  { id: "gemini", label: "Gemini CLI" },
  { id: "cline", label: "Cline" },
  { id: "vscode", label: "VS Code" },
];

function requireService(): NonNullable<typeof service> {
  if (!service) throw new Error("Core service is not loaded yet — check the terminal/DevTools for errors.");
  return service;
}
/** 弹窗需要的父窗口（窗口已关则返回 undefined，让对话框成为应用级模态）。 */
function parentWin(): BrowserWindow | undefined {
  return win && !win.isDestroyed() ? win : undefined;
}
// 有窗口就带父窗口弹，否则弹应用级对话框（从托盘/Dock 菜单触发时窗口可能已关）。
function showSave(options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> {
  const p = parentWin();
  return p ? dialog.showSaveDialog(p, options) : dialog.showSaveDialog(options);
}
function showMessage(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  const p = parentWin();
  return p ? dialog.showMessageBox(p, options) : dialog.showMessageBox(options);
}

async function startService(): Promise<CoreStatus> {
  const s = requireService();
  try {
    await s.start();
  } catch (e: unknown) {
    if (e && (e as { code?: string }).code === "EADDRINUSE") {
      throw new Error(`Port ${s.port} is already in use — another instance may be running.`);
    }
    throw e;
  }
  return s.getStatus();
}
async function stopService(): Promise<CoreStatus> {
  const s = requireService();
  await s.stop();
  return s.getStatus();
}
function copyToken(): boolean {
  const t = service ? service.getToken() : "";
  if (t) clipboard.writeText(t);
  return !!t;
}
async function rotateToken(): Promise<string> {
  const t = await requireService().rotateToken();
  updateMenus();
  return t;
}
/** 弹保存框把内置插件写到用户选择的位置。 */
async function installPlugin(): Promise<{ saved: boolean; path?: string }> {
  const result = await showSave({
    title: "Save Claude Bridge plugin",
    defaultPath: "ClaudeBridge.rbxmx",
    filters: [{ name: "Roblox plugin", extensions: ["rbxmx"] }],
  });
  if (result.canceled || !result.filePath) return { saved: false };
  await copyFile(pluginArtifactPath(), result.filePath);
  return { saved: true, path: result.filePath };
}
/** 按所选客户端格式写入 MCP 配置（自动/选位置）。 */
async function writeConfig(clientId?: string): Promise<{ written: boolean; cancelled?: boolean; path?: string; client?: McpClient }> {
  const s = requireService();
  if (!s.isRunning()) await s.start();
  const client = (clientId as McpClient) || "claude";
  const info = core.clientInfo(client);

  let target: string | undefined;
  if (info.defaultPath) {
    const choice = await showMessage({
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
    const r = await showSave({
      title: `Save ${info.label} MCP config`,
      defaultPath: defaultConfigFilename(client),
      filters: [{ name: "MCP config", extensions: ["json"] }],
    });
    if (r.canceled || !r.filePath) return { written: false, cancelled: true };
    target = r.filePath;
  }
  const res = await core.writeClientConfig(client, target, s.port, s.getToken());
  return { written: true, path: res.path, client };
}

/** 菜单点击包装：捕获错误弹到对话框，避免未处理异常。 */
function menuAction(fn: () => unknown | Promise<unknown>): () => void {
  return () => {
    Promise.resolve()
      .then(fn)
      .catch((e) => dialog.showErrorBox("Claude for Roblox Studio", String((e as Error)?.message ?? e)));
  };
}

/** 托盘 / Dock 菜单模板（随服务状态动态变化）。 */
function menuTemplate(): MenuItemConstructorOptions[] {
  const running = service?.isRunning() ?? false;
  const hasToken = !!(service && service.getToken());
  return [
    { label: "Open Claude for Roblox Studio", click: () => showWindow() },
    { type: "separator" },
    {
      label: running ? "Stop service" : "Start service",
      click: menuAction(() => (running ? stopService() : startService())),
    },
    { type: "separator" },
    { label: "Install Studio plugin…", click: menuAction(installPlugin) },
    {
      label: "Install MCP config",
      submenu: MCP_CLIENT_MENU.map((c) => ({ label: c.label, click: menuAction(() => writeConfig(c.id)) })),
    },
    { type: "separator" },
    { label: "Copy connection token", enabled: hasToken, click: () => void copyToken() },
    { label: "Rotate token…", enabled: hasToken, click: menuAction(rotateToken) },
    { type: "separator" },
    { label: `Version ${app.getVersion()}`, enabled: false },
    { label: "Quit", role: "quit" },
  ];
}

/** 重建并应用托盘 + macOS Dock 的右键菜单。 */
function updateMenus(): void {
  try {
    const menu = Menu.buildFromTemplate(menuTemplate());
    if (tray && !tray.isDestroyed()) tray.setContextMenu(menu);
    if (isMac && app.dock) app.dock.setMenu(menu);
  } catch (e) {
    console.error("[main] failed to update menus:", e);
  }
}

/** 创建菜单栏 / 系统托盘图标（macOS 用模板图，自动适配深浅色）。 */
function createTray(): void {
  if (tray) return;
  try {
    const assetPath = (name: string) => join(__dirname, "..", "assets", name);
    const image = isMac
      ? nativeImage.createFromPath(assetPath("trayTemplate.png"))
      : nativeImage.createFromPath(assetPath("tray.png"));
    if (isMac) image.setTemplateImage(true);
    // 图标缺失时 image 为空 —— 此时跳过，避免出现一个不可见/占位的托盘项。
    if (image.isEmpty()) {
      console.warn("[main] tray image missing; skipping tray");
    } else {
      tray = new Tray(image);
      tray.setToolTip(`Claude for Roblox Studio v${app.getVersion()}`);
      tray.on("click", () => showWindow());
    }
  } catch (e) {
    console.error("[main] failed to create tray:", e);
  }
  updateMenus(); // 同时设置 Dock 菜单（即便托盘创建失败）。
}

function registerIpc(): void {
  ipcMain.handle("get-version", () => app.getVersion());
  ipcMain.handle("get-status", (): CoreStatus | null => (service ? service.getStatus() : null));
  ipcMain.handle("get-token", (): string => (service ? service.getToken() : ""));
  ipcMain.handle("get-activity", (_e, limit?: number) =>
    service ? service.getRecentActivity(limit ?? 30) : { commands: [], events: [] },
  );

  // 服务/配置动作复用 tray/Dock 菜单同一套函数。
  ipcMain.handle("start-service", () => startService());
  ipcMain.handle("stop-service", () => stopService());
  ipcMain.handle("rotate-token", () => rotateToken());
  ipcMain.handle("write-config", (_e, clientId?: string) => writeConfig(clientId));
  ipcMain.handle("install-plugin", () => installPlugin());

  ipcMain.handle("open-external", (_e, url: string) => shell.openExternal(url));
  ipcMain.handle("restart-to-update", () => autoUpdater.quitAndInstall());
  ipcMain.handle("get-pending-update", (): PendingUpdate | null => pendingUpdate);

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

/** 从 GitHub 抓某个版本的 Release 说明（changelog / body）。失败返回空串。 */
function fetchChangelog(version: string): Promise<string> {
  return new Promise((resolve) => {
    const request = net.request(`https://api.github.com/repos/${REPO}/releases/tags/v${version}`);
    request.setHeader("User-Agent", "Claude-for-Roblox-Studio");
    request.setHeader("Accept", "application/vnd.github+json");
    let body = "";
    request.on("response", (response) => {
      if ((response.statusCode ?? 0) >= 400) {
        response.on("data", () => {});
        response.on("end", () => resolve(""));
        return;
      }
      response.on("data", (c) => (body += c.toString()));
      response.on("end", () => {
        try {
          resolve((JSON.parse(body) as { body?: string }).body ?? "");
        } catch {
          resolve("");
        }
      });
    });
    request.on("error", () => resolve(""));
    request.end();
  });
}

/** 记录待安装更新并通知渲染进程弹出更新日志界面。 */
async function announceUpdate(version: string, kind: "win" | "mac", url?: string): Promise<void> {
  const notes = await fetchChangelog(version);
  pendingUpdate = { version, notes, kind, url };
  win?.webContents.send("update-available", pendingUpdate);
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
        // mac 未签名：按需下载 dmg，先弹更新日志（附下载按钮）。
        const arch = process.arch === "arm64" ? "arm64" : "x64";
        const file = `Claude-for-Roblox-Studio-${info.version}-${arch}.dmg`;
        const url = `https://github.com/${REPO}/releases/download/v${info.version}/${file}`;
        void announceUpdate(info.version, "mac", url);
      }
    });
    autoUpdater.on("update-downloaded", (info) => {
      // Windows：electron-updater 已在后台下好，弹更新日志（附重启安装按钮）。
      console.log("[updater] downloaded:", info.version);
      void announceUpdate(info.version, "win");
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
  app.on("second-instance", () => showWindow());

  void app.whenReady().then(async () => {
    // 先建窗口 + 注册 IPC，保证即使 core 加载失败也有界面和报错可看。
    registerIpc();
    createWindow();
    createTray();

    // 开发用：CLAUDE_RBX_FAKE_UPDATE=1 时注入一个假的待安装更新，便于预览更新弹窗。
    if (process.env.CLAUDE_RBX_FAKE_UPDATE) {
      pendingUpdate = {
        version: "9.9.9",
        kind: isMac ? "mac" : "win",
        url: "https://example.invalid/app.dmg",
        notes:
          "## What's new\n\n" +
          "- **WebSocket** transport for the Studio bridge (no more polling)\n" +
          "- New app icon + a menu-bar / Dock menu with all actions\n" +
          "- Redesigned desktop and Studio-plugin UI\n" +
          "- `fire_signal` can now pass instances via `{\"$path\":\"…\"}`\n\n" +
          "### Fixes\n\n" +
          "- No more false disconnects during long commands\n" +
          "- Reliable handshake with retries\n\n" +
          "See the [full release notes](https://github.com/TonyD365/Claude-for-Roblox-Studio/releases) for details.",
      };
    }

    try {
      core = await import("@claude-roblox/core");
      service = new core.CoreService({ tokenPath: join(app.getPath("userData"), "token") });
      service.on("status", (s: CoreStatus) => {
        win?.webContents.send("status", s);
        updateMenus(); // Start/Stop 标签、token 相关项随状态刷新
      });
      service.on("handshake", (info: unknown) => win?.webContents.send("handshake", info));
      console.log("[main] core service loaded");
      updateMenus(); // core 加载后 token 已可用 → 刷新菜单可用项
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
