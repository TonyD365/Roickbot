// 读写 / 检测各 MCP 客户端的配置文件（让桌面 App 能一键接入并检测连接状态）。
// 不同客户端的 type 字段 / 包裹键 / 默认路径都不同，这里集中按各自正确格式生成，
// 这样用户不用手动配置，也不会因为写错 type（如 Cline 必须 streamableHttp）而连不上。

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const MCP_SERVER_KEY = "roickbot";

/** 受支持的 MCP 客户端。 */
export type McpClient = "claude" | "cursor" | "gemini" | "cline" | "vscode";

export interface McpClientInfo {
  id: McpClient;
  label: string;
  /** 固定的默认配置文件路径；为 null 表示路径因项目而异，需要用户用保存框选择。 */
  defaultPath: string | null;
  /** 配置文件里包裹服务条目的键（Claude/Cursor/Gemini/Cline 用 mcpServers，VS Code 用 servers）。 */
  serversKey: "mcpServers" | "servers";
  /** 给用户看的备注（写在 UI / 文档里）。 */
  note: string;
}

/** 客户端清单（顺序即 UI 下拉顺序）。 */
export const MCP_CLIENTS: McpClientInfo[] = [
  {
    id: "claude",
    label: "Claude Code",
    defaultPath: join(homedir(), ".claude.json"),
    serversKey: "mcpServers",
    note: "User-level config at ~/.claude.json.",
  },
  {
    id: "cursor",
    label: "Cursor",
    defaultPath: join(homedir(), ".cursor", "mcp.json"),
    serversKey: "mcpServers",
    note: "User-level config at ~/.cursor/mcp.json.",
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    defaultPath: join(homedir(), ".gemini", "settings.json"),
    serversKey: "mcpServers",
    note: "Uses the httpUrl key at ~/.gemini/settings.json.",
  },
  {
    id: "cline",
    label: "Cline (VS Code ext.)",
    defaultPath: null,
    serversKey: "mcpServers",
    note: "Requires type \"streamableHttp\". Path varies — choose your cline_mcp_settings.json.",
  },
  {
    id: "vscode",
    label: "VS Code (native MCP)",
    defaultPath: null,
    serversKey: "servers",
    note: "Uses the servers key in .vscode/mcp.json — choose the file.",
  },
];

export function clientInfo(client: McpClient): McpClientInfo {
  const info = MCP_CLIENTS.find((c) => c.id === client);
  if (!info) throw new Error(`Unknown MCP client: ${client}`);
  return info;
}

/** 该客户端的默认配置路径（无固定路径时为 null）。 */
export function clientDefaultPath(client: McpClient): string | null {
  return clientInfo(client).defaultPath;
}

/**
 * 按客户端的正确格式生成本服务的 MCP 条目。
 * - Claude Code / Cursor(VS Code 兼容) → type:"http"
 * - Gemini CLI → 用 httpUrl 键（无 type）
 * - Cline → type:"streamableHttp" + disabled/autoApprove
 */
export function buildClientEntry(
  client: McpClient,
  port: number,
  token: string,
): Record<string, unknown> {
  const url = `http://127.0.0.1:${port}/mcp`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "X-Roblox-MCP": "1",
  };

  switch (client) {
    case "gemini":
      // Gemini CLI 用 httpUrl 键标识 Streamable HTTP 服务。
      return { httpUrl: url, headers };
    case "cline":
      // Cline 必须显式 type:"streamableHttp"，否则报错连不上。
      return { type: "streamableHttp", url, headers, disabled: false, autoApprove: [] };
    case "vscode":
    case "cursor":
    case "claude":
    default:
      // Claude Code / Cursor / VS Code(native) 都接受 type:"http"。
      return { type: "http", url, headers };
  }
}

/** 兼容旧调用：默认返回 Claude Code 的条目。 */
export function buildMcpEntry(port: number, token: string): Record<string, unknown> {
  return buildClientEntry("claude", port, token);
}

/** 用户级 Claude Code 配置文件路径（~/.claude.json）。 */
export function userConfigPath(): string {
  return join(homedir(), ".claude.json");
}

/** 项目级 .mcp.json 路径。 */
export function projectConfigPath(projectDir: string): string {
  return join(projectDir, ".mcp.json");
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(path, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 检测某配置文件里是否已含本服务条目（mcpServers 或 servers 任一键下）。 */
export async function isConfigured(path: string): Promise<boolean> {
  const cfg = await readJson(path);
  for (const key of ["mcpServers", "servers"] as const) {
    const servers = cfg[key] as Record<string, unknown> | undefined;
    if (servers && Object.prototype.hasOwnProperty.call(servers, MCP_SERVER_KEY)) {
      return true;
    }
  }
  return false;
}

/**
 * 把本服务条目按指定客户端的格式写入配置文件（合并已有内容；先备份）。
 * 返回 { path, config } —— 实际写入路径与写入后的完整配置对象。
 */
export async function writeClientConfig(
  client: McpClient,
  path: string,
  port: number,
  token: string,
): Promise<{ path: string; config: Record<string, unknown> }> {
  const info = clientInfo(client);
  const cfg = await readJson(path);
  const servers = (cfg[info.serversKey] as Record<string, unknown> | undefined) ?? {};
  servers[MCP_SERVER_KEY] = buildClientEntry(client, port, token);
  cfg[info.serversKey] = servers;

  await fs.mkdir(dirname(path), { recursive: true });
  // 若已存在则备份。
  try {
    await fs.copyFile(path, `${path}.bak`);
  } catch {
    // 原文件不存在，跳过备份。
  }
  await fs.writeFile(path, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  return { path, config: cfg };
}

/** 兼容旧调用：以 Claude Code 格式写入。 */
export async function writeMcpConfig(
  path: string,
  port: number,
  token: string,
): Promise<Record<string, unknown>> {
  const { config } = await writeClientConfig("claude", path, port, token);
  return config;
}
