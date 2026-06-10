// Phase 1 核心工具 + 运行/测试工具的注册。
// 这些工具大多只是把请求转发给 Studio 插件执行；真正的 DataModel 操作在 Luau 侧。

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PROTOCOL_VERSION } from "../bridge/envelope.js";
import {
  ToolContext,
  forward,
  forwardDestructive,
  jsonResult,
} from "../tools/types.js";

const CAUTION =
  " Be careful: prefer narrow paths, inspect first with get_tree/view_elements/get_properties when unsure, " +
  "and use dryRun:true to preview changes before applying. Every action is wrapped in an undo waypoint.";

const RUN_LUAU_DEADLINE_MS = 30_000;

export function registerPhase1Tools(server: McpServer, ctx: ToolContext): void {
  // ---- 连接 ----
  server.registerTool(
    "health",
    {
      title: "Health / connection status",
      description:
        "Report whether the bridge server and the Roblox Studio plugin are connected. Call this first.",
      inputSchema: {},
    },
    async () =>
      jsonResult({
        server: "ok",
        protocol: PROTOCOL_VERSION,
        pluginConnected: ctx.queue.isPluginConnected(),
        queueDepth: ctx.queue.queueDepth,
      }),
  );

  // ---- 读取数据模型 ----
  server.registerTool(
    "get_tree",
    {
      title: "Get DataModel tree",
      description:
        "Return the instance tree under a path (default: the whole game). Use maxDepth and get_children " +
        "to expand large projects lazily.",
      inputSchema: {
        rootPath: z.string().optional().describe('e.g. "Workspace" or "Workspace/Model". Omit for game root.'),
        maxDepth: z.number().int().min(1).optional().describe("How many levels deep to expand (default 3)."),
        classWhitelist: z.array(z.string()).optional().describe("Only include these class names."),
        excludeClassWhitelist: z
          .array(z.string())
          .optional()
          .describe('Skip these classes and their subtrees (e.g. ["Model"]) to avoid huge payloads on big maps.'),
      },
    },
    async (args) => forward(ctx, "get_tree", args),
  );

  server.registerTool(
    "get_children",
    {
      title: "Get children of an instance",
      description: "List the direct children of an instance. Use for lazy expansion of large trees.",
      inputSchema: { path: z.string() },
    },
    async (args) => forward(ctx, "get_children", args),
  );

  server.registerTool(
    "view_elements",
    {
      title: "View specific elements in detail",
      description:
        "Inspect specific scene elements (Parts, Scripts, Models, etc.) in full detail. Select by explicit " +
        "paths, or by classNameFilter within an optional rootPath subtree. Returns each element's properties, " +
        "geometry (size/CFrame/color/material) and parent. Set includeSource:true to also return script source.",
      inputSchema: {
        paths: z.array(z.string()).optional().describe("Explicit element paths to inspect."),
        rootPath: z.string().optional().describe("Limit className search to this subtree."),
        classNameFilter: z.string().optional().describe('e.g. "Part" or "Script".'),
        includeSource: z.boolean().optional().describe("Include source for Script/LocalScript/ModuleScript."),
        props: z.array(z.string()).optional().describe("Restrict returned properties to this list."),
      },
    },
    async (args) => forward(ctx, "view_elements", args),
  );

  server.registerTool(
    "get_properties",
    {
      title: "Get instance properties",
      description: "Read properties of one instance. Omit props for a curated common set.",
      inputSchema: {
        path: z.string(),
        props: z.array(z.string()).optional(),
      },
    },
    async (args) => forward(ctx, "get_properties", args),
  );

  // ---- 修改数据模型 ----
  server.registerTool(
    "set_properties",
    {
      title: "Set instance properties",
      description: "Set one or more properties on an instance." + CAUTION,
      inputSchema: {
        path: z.string(),
        properties: z.record(z.any()).describe('e.g. { "Anchored": true, "BrickColor": "Bright red" }'),
        dryRun: z.boolean().optional(),
      },
    },
    async (args) => forward(ctx, "set_properties", args, { dryRun: (args as { dryRun?: boolean }).dryRun }),
  );

  server.registerTool(
    "create_instance",
    {
      title: "Create an instance",
      description: "Create a new instance under a parent and optionally set properties." + CAUTION,
      inputSchema: {
        className: z.string().describe('e.g. "Part", "Folder", "Script".'),
        parentPath: z.string(),
        name: z.string().optional(),
        properties: z.record(z.any()).optional(),
        dryRun: z.boolean().optional(),
      },
    },
    async (args) => forward(ctx, "create_instance", args, { dryRun: (args as { dryRun?: boolean }).dryRun }),
  );

  server.registerTool(
    "delete_instance",
    {
      title: "Delete instance(s)",
      description:
        "DESTRUCTIVE. Delete one or more instances. Calling without a valid `confirm` token returns a dry-run " +
        "preview plus a one-time confirmToken; call again with confirm set to that token to apply." + CAUTION,
      inputSchema: {
        path: z.union([z.string(), z.array(z.string())]),
        confirm: z.string().optional().describe("confirmToken from a prior preview call."),
        dryRun: z.boolean().optional(),
      },
    },
    async (args) => {
      const a = args as Record<string, unknown> & { dryRun?: boolean };
      if (a.dryRun) return forward(ctx, "delete_instance", args, { dryRun: true });
      return forwardDestructive(ctx, "delete_instance", a);
    },
  );

  server.registerTool(
    "clone_instance",
    {
      title: "Clone an instance",
      description: "Clone an instance, optionally into a different parent." + CAUTION,
      inputSchema: {
        path: z.string(),
        parentPath: z.string().optional().describe("Defaults to the source's parent."),
        dryRun: z.boolean().optional(),
      },
    },
    async (args) => forward(ctx, "clone_instance", args, { dryRun: (args as { dryRun?: boolean }).dryRun }),
  );

  server.registerTool(
    "reparent_instance",
    {
      title: "Reparent an instance",
      description: "Move an instance to a new parent." + CAUTION,
      inputSchema: {
        path: z.string(),
        newParentPath: z.string(),
        dryRun: z.boolean().optional(),
      },
    },
    async (args) => forward(ctx, "reparent_instance", args, { dryRun: (args as { dryRun?: boolean }).dryRun }),
  );

  // ---- 脚本 ----
  server.registerTool(
    "get_script_source",
    {
      title: "Get script source",
      description: "Read the source of a Script / LocalScript / ModuleScript.",
      inputSchema: { path: z.string() },
    },
    async (args) => forward(ctx, "get_script_source", args),
  );

  server.registerTool(
    "set_script_source",
    {
      title: "Set script source",
      description: "Replace the source of a Script / LocalScript / ModuleScript." + CAUTION,
      inputSchema: {
        path: z.string(),
        source: z.string(),
        dryRun: z.boolean().optional(),
      },
    },
    async (args) => forward(ctx, "set_script_source", args, { dryRun: (args as { dryRun?: boolean }).dryRun }),
  );

  // ---- 选择 ----
  server.registerTool(
    "get_selection",
    {
      title: "Get selection",
      description: "Return the paths of instances currently selected in Studio.",
      inputSchema: {},
    },
    async () => forward(ctx, "get_selection", {}),
  );

  server.registerTool(
    "set_selection",
    {
      title: "Set selection",
      description: "Select the given instances in Studio.",
      inputSchema: { paths: z.array(z.string()) },
    },
    async (args) => forward(ctx, "set_selection", args),
  );

  // ---- 运行 / 测试 ----
  server.registerTool(
    "start_test",
    {
      title: "Start a play-test (Run mode)",
      description:
        "Start the game with RunService:Run() — physics runs live (no avatar; drive a Bot as the player). " +
        "Full Play mode (F5, with a real character) has no clean plugin API, so this uses Run mode. " +
        "IMPORTANT: while the game is running, all project-EDITING tools are locked (RUNTIME_LOCKED); " +
        "only reads, get_console_output, bot_* and run_luau work. Call stop_test before editing again.",
      inputSchema: {},
    },
    async () => forward(ctx, "start_test", {}),
  );

  server.registerTool(
    "stop_test",
    {
      title: "Stop the play-test",
      description: "Stop the running game (RunService:Stop) and return to Edit — editing is unlocked again.",
      inputSchema: {},
    },
    async () => forward(ctx, "stop_test", {}),
  );

  server.registerTool(
    "pause_test",
    {
      title: "Pause the play-test",
      description: "Pause the running game (RunService:Pause).",
      inputSchema: {},
    },
    async () => forward(ctx, "pause_test", {}),
  );

  server.registerTool(
    "get_run_state",
    {
      title: "Get run state",
      description: "Return whether Studio is in Edit, Running, or Paused state.",
      inputSchema: {},
    },
    async () => forward(ctx, "get_run_state", {}),
  );

  // ---- 控制台 / 输出 ----
  server.registerTool(
    "get_console_output",
    {
      title: "Get console / output log",
      description:
        "Return recent Studio Output messages (prints, info, warnings, errors) from LogService. " +
        "Use after run_luau or after running the game to see what was logged and to debug errors.",
      inputSchema: {
        count: z.number().int().min(1).optional().describe("Max recent messages to return (default 100)."),
        order: z
          .enum(["newest", "oldest"])
          .optional()
          .describe('Result order (default "newest" — most recent first, best for spotting fresh errors).'),
        includeTypes: z
          .array(z.enum(["Output", "Info", "Warning", "Error"]))
          .optional()
          .describe("Only include these message types, e.g. [\"Warning\",\"Error\"]."),
      },
    },
    async (args) => forward(ctx, "get_console_output", args),
  );

  // ---- 万能逃生舱 ----
  server.registerTool(
    "run_luau",
    {
      title: "Run arbitrary Luau",
      description:
        "Run arbitrary Luau code inside Studio and return its result + captured prints. This is the universal " +
        'escape hatch that can do anything the other tools do not cover (use `return <expr>` or returnExpression). ' +
        "Multi-line code and top-level `local` are fully supported. NOTE: it runs in the PLUGIN context, not a " +
        "server/client runtime — so RunService:IsServer() is false and IsRunning() reflects the edit DataModel. " +
        "For true server-runtime behavior, use start_test + the bot_* tools. Effects are wrapped in an undo waypoint." +
        CAUTION,
      inputSchema: {
        source: z.string(),
        returnExpression: z.boolean().optional().describe("If true, treat source as an expression to return."),
        dryRun: z.boolean().optional(),
        timeoutMs: z.number().int().optional(),
      },
    },
    async (args) =>
      forward(ctx, "run_luau", args, {
        dryRun: (args as { dryRun?: boolean }).dryRun,
        deadlineMs: (args as { timeoutMs?: number }).timeoutMs ?? RUN_LUAU_DEADLINE_MS,
      }),
  );
}
