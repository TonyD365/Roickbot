// MCP 工具共享类型与响应辅助函数。

import { CommandFailure, CommandQueue } from "../bridge/commandQueue.js";
import { ConfirmStore } from "../safety/confirm.js";
import type { Harness } from "../harness/harness.js";
import type { EventBus } from "../bridge/events.js";

export interface ToolContext {
  /** 插件通道（编辑态工具）。 */
  queue: CommandQueue;
  /** 运行时 server-agent 通道（运行中游戏内的 server 上下文）。 */
  agentQueue: CommandQueue;
  confirm: ConfirmStore;
  harness: Harness;
  events: EventBus;
  /** 服务器自身信息（用于把连接信息传给注入的 agent）。 */
  serverInfo: { port: number; token: string };
}

/** MCP 工具返回的内容块（仅用到文本）。 */
export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

/** 把任意 JSON 结果包成 MCP 文本响应。 */
export function jsonResult(data: unknown): ToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

/** 把错误包成 MCP 错误响应（Claude 可读到原因）。 */
export function errorResult(e: unknown): ToolResult {
  let text: string;
  if (e instanceof CommandFailure) {
    text = `Error [${e.code}]: ${e.message}`;
  } else if (e instanceof Error) {
    text = `Error: ${e.message}`;
  } else {
    text = `Error: ${String(e)}`;
  }
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * 把工具调用转发给 Studio 插件并格式化结果。
 */
export async function forward(
  ctx: ToolContext,
  tool: string,
  args: unknown,
  opts: { dryRun?: boolean; deadlineMs?: number; context?: "plugin" | "server" } = {},
): Promise<ToolResult> {
  const useAgent = opts.context === "server";
  const queue = useAgent ? ctx.agentQueue : ctx.queue;

  if (!queue.isPluginConnected()) {
    const text = useAgent
      ? "The server runtime agent is not connected. Call start_test first — it injects an agent into the " +
        "running game so server-context tools can run. (The agent only exists while a test is running.)"
      : "The Roblox Studio plugin is not connected. Open Studio, install/enable the Brickbot plugin, " +
        "and connect it using the token shown in the desktop app.";
    return { content: [{ type: "text", text }], isError: true };
  }
  if (!useAgent && !ctx.queue.supportsTool(tool)) {
    return {
      content: [
        {
          type: "text",
          text:
            `The connected Studio plugin doesn't implement "${tool}". The installed plugin is older than this ` +
            `app — reinstall it via the desktop app's "Install plugin" button, then reconnect in Studio.`,
        },
      ],
      isError: true,
    };
  }
  try {
    const result = await queue.dispatch(tool, args, opts);
    return jsonResult(result);
  } catch (e) {
    return errorResult(e);
  }
}

/**
 * 破坏性工具：未带有效 confirm 时，先返回 dryRun 预览 + 一次性 confirmToken；
 * 带有效 token 时才真正执行。
 */
export async function forwardDestructive(
  ctx: ToolContext,
  tool: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (!ctx.queue.isPluginConnected()) {
    return forward(ctx, tool, args); // 复用上面的离线提示。
  }
  const confirm = typeof args.confirm === "string" ? args.confirm : undefined;
  if (confirm && ctx.confirm.consume(confirm, args)) {
    return forward(ctx, tool, args);
  }
  // 生成预览。
  let preview: unknown;
  try {
    preview = await ctx.queue.dispatch(tool, args, { dryRun: true });
  } catch (e) {
    return errorResult(e);
  }
  const token = ctx.confirm.issue(args);
  return jsonResult({
    requiresConfirmation: true,
    confirmToken: token,
    preview,
    note:
      "This is a destructive operation. Review the preview above, then call this tool again " +
      "with the same arguments plus `confirm` set to confirmToken to actually apply it. " +
      "(Think before acting / 三思而后行.)",
  });
}
