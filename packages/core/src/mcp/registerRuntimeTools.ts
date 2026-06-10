// 运行时工具：依赖 start_test 注入的 server-agent（运行中游戏的 server 上下文）+ 事件总线。
//   - fire_signal     : 在 server 上下文里对某实例调用方法（FireAllClients / Fire / InputHoldBegin / SetNetworkOwner …）
//   - wait_for_event  : 长等下一个桥事件（如运行状态变化 / 测试结束），免去反复轮询

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ToolContext, forward, jsonResult, errorResult } from "../tools/types.js";

const WAIT_EVENT_MAX_MS = 120_000;

export function registerRuntimeTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "fire_signal",
    {
      title: "Fire a signal / call a method (server context)",
      description:
        "Run inside the live game's SERVER context (needs start_test): call a method on an instance to simulate " +
        "events or drive runtime behaviour. Examples: a RemoteEvent's FireAllClients/FireClient, a BindableEvent's " +
        "Fire, a ProximityPrompt's InputHoldBegin/InputHoldEnd, or BasePart:SetNetworkOwner. Use this (or " +
        "run_luau with context:'server') to trigger server-side listeners that the plugin context can't reach.",
      inputSchema: {
        path: z.string().describe("Instance path, e.g. ReplicatedStorage/Remotes/BuyCar."),
        method: z
          .string()
          .describe('Method to call, e.g. "FireAllClients", "Fire", "FireClient", "InputHoldBegin".'),
        args: z.array(z.any()).optional().describe("Arguments to pass to the method (JSON-serialized values)."),
      },
    },
    async (args) => forward(ctx, "fire_signal", args, { context: "server" }),
  );

  server.registerTool(
    "wait_for_event",
    {
      title: "Wait for the next bridge event",
      description:
        "Block until the next event is pushed by Studio (e.g. run-state changes / the test stopping), instead of " +
        "polling get_run_state in a loop. Returns the event, or {timedOut:true} after timeoutMs. Typical use: after " +
        "start_test, wait_for_event for type 'runState' to know when the test ends (crash / error / user stop).",
      inputSchema: {
        types: z.array(z.string()).optional().describe('Only return these event types, e.g. ["runState"].'),
        timeoutMs: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Max time to wait in ms (default 30000, max 120000)."),
      },
    },
    async (args) => {
      try {
        const a = args as { types?: string[]; timeoutMs?: number };
        const timeout = Math.min(a.timeoutMs ?? 30_000, WAIT_EVENT_MAX_MS);
        const ev = await ctx.events.wait(a.types, timeout);
        return jsonResult(ev ?? { timedOut: true });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
