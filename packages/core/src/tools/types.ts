// MCP 工具共享类型与响应辅助函数。

import { CommandFailure, CommandQueue } from "../bridge/commandQueue.js";
import { ConfirmStore } from "../safety/confirm.js";
import type { Harness } from "../harness/harness.js";

export interface ToolContext {
  queue: CommandQueue;
  confirm: ConfirmStore;
  harness: Harness;
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
  opts: { dryRun?: boolean; deadlineMs?: number } = {},
): Promise<ToolResult> {
  if (!ctx.queue.isPluginConnected()) {
    return {
      content: [
        {
          type: "text",
          text:
            "The Roblox Studio plugin is not connected. Open Studio, install/enable the Claude Bridge plugin, " +
            "and connect it using the token shown in the desktop app.",
        },
      ],
      isError: true,
    };
  }
  try {
    const result = await ctx.queue.dispatch(tool, args, opts);
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
