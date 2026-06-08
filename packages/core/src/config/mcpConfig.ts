// 读写 / 检测 Claude Code 的 MCP 配置（让桌面 App 能一键接入并检测连接状态）。

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const MCP_SERVER_KEY = "roblox-studio";

export interface McpHttpEntry {
  type: "http";
  url: string;
  headers: Record<string, string>;
}

/** 生成本服务对应的 Claude Code MCP 条目。 */
export function buildMcpEntry(port: number, token: string): McpHttpEntry {
  return {
    type: "http",
    url: `http://127.0.0.1:${port}/mcp`,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Roblox-MCP": "1",
    },
  };
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

/** 检测某配置文件里是否已含本服务条目（不校验 token 是否最新）。 */
export async function isConfigured(path: string): Promise<boolean> {
  const cfg = await readJson(path);
  const servers = cfg.mcpServers as Record<string, unknown> | undefined;
  return !!servers && Object.prototype.hasOwnProperty.call(servers, MCP_SERVER_KEY);
}

/**
 * 把本服务条目写入配置文件（合并已有内容；先备份）。
 * 返回写入后的完整配置对象。
 */
export async function writeMcpConfig(
  path: string,
  port: number,
  token: string,
): Promise<Record<string, unknown>> {
  const cfg = await readJson(path);
  const servers = (cfg.mcpServers as Record<string, unknown> | undefined) ?? {};
  servers[MCP_SERVER_KEY] = buildMcpEntry(port, token);
  cfg.mcpServers = servers;

  await fs.mkdir(dirname(path), { recursive: true });
  // 若已存在则备份。
  try {
    await fs.copyFile(path, `${path}.bak`);
  } catch {
    // 原文件不存在，跳过备份。
  }
  await fs.writeFile(path, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  return cfg;
}
