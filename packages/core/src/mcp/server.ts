// 构建一个注册好工具的 McpServer 实例。

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPhase1Tools } from "./registerPhase1.js";
import { registerPhase2Tools } from "./registerPhase2.js";
import { registerPhase3Tools } from "./registerPhase3.js";
import { registerQueryTools } from "./registerQueryTools.js";
import { registerHarnessTools } from "./registerHarness.js";
import { registerRuntimeTools } from "./registerRuntimeTools.js";
import type { ToolContext } from "../tools/types.js";

export const SERVER_NAME = "claude-for-roblox-studio";
export const SERVER_VERSION = "0.2.0";

/** 创建并返回一个新的 McpServer（Phase 1 + Phase 2 工具已注册）。 */
export function buildMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });
  registerPhase1Tools(server, ctx);
  registerPhase2Tools(server, ctx); // 做图
  registerPhase3Tools(server, ctx); // Bot 视觉 + 自我测试闭环
  registerQueryTools(server, ctx); // 搜索 / 标签 / 行级脚本编辑
  registerHarnessTools(server, ctx); // 跨 session 项目记忆（本地处理）
  registerRuntimeTools(server, ctx); // 运行时 server-agent + 事件
  return server;
}
