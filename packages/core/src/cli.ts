#!/usr/bin/env node
// 独立运行核心服务（不依赖 Electron）。打印 token，供用户粘贴进 Studio 插件 / Claude Code 配置。

import { join } from "node:path";
import { homedir } from "node:os";
import { CoreService, buildMcpEntry } from "./index.js";

async function main(): Promise<void> {
  const service = new CoreService({
    tokenPath: join(homedir(), ".roblox-mcp", "token"),
  });

  service.on("handshake", (info) => {
    console.log(`[bridge] Studio plugin connected (session ${info.sessionId}, plugin v${info.pluginVersion}).`);
  });

  await service.start();

  console.log("Claude-for-Roblox-Studio bridge is running.");
  console.log(`  MCP endpoint : http://127.0.0.1:${service.port}/mcp`);
  console.log(`  Token        : ${service.getToken()}`);
  console.log("");
  console.log("Add this to your Claude Code .mcp.json:");
  console.log(JSON.stringify({ mcpServers: { "roblox-studio": buildMcpEntry(service.port, service.getToken()) } }, null, 2));
  console.log("");
  console.log("Then paste the token into the Claude Bridge plugin in Roblox Studio and click Connect.");

  const shutdown = async () => {
    console.log("\nShutting down...");
    await service.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
