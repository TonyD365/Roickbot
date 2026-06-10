// 查询 / 标签 / 行级脚本编辑工具。都转发给 Studio 插件执行。
//   - edit_script_lines  : 改脚本指定行区间（不必整源替换）
//   - find_instances     : 按名称/类名搜索实例
//   - search_by_property : 按属性值搜索实例
//   - get_tagged/get_tags/add_tag/remove_tag : CollectionService 标签读写

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ToolContext, forward } from "../tools/types.js";

const CAUTION =
  " Be careful: inspect first when unsure, and use dryRun:true to preview changes. Actions are undoable.";

export function registerQueryTools(server: McpServer, ctx: ToolContext): void {
  // ---- 行级脚本编辑 ----
  server.registerTool(
    "edit_script_lines",
    {
      title: "Edit script line range",
      description:
        "Edit a specific line range of a Script/LocalScript/ModuleScript instead of replacing the whole source. " +
        "Replaces lines startLine..endLine (1-based, inclusive) with `replacement`. Use mode:'insert' to insert " +
        "before startLine without removing, or mode:'delete' to remove the range. Prefer this for surgical edits." +
        CAUTION,
      inputSchema: {
        path: z.string(),
        startLine: z.number().int().min(1).describe("First line of the range (1-based)."),
        endLine: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Last line of the range (inclusive). Defaults to startLine."),
        replacement: z.string().optional().describe("New text for the range (omit for mode:'delete')."),
        mode: z
          .enum(["replace", "insert", "delete"])
          .optional()
          .describe("replace (default) | insert before startLine | delete the range."),
        dryRun: z.boolean().optional(),
      },
    },
    async (args) => forward(ctx, "edit_script_lines", args, { dryRun: (args as { dryRun?: boolean }).dryRun }),
  );

  // ---- 脚本"文件"检索 / 查看（调试用，运行时也可用，因为是只读） ----
  server.registerTool(
    "search_scripts",
    {
      title: "Search across script source (grep)",
      description:
        "Grep across all Script/LocalScript/ModuleScript sources for a text query, returning each matching " +
        "script with the matching line numbers + line text. Great for debugging — find where a function, " +
        "variable, or string is used. Read-only, so it also works while the game is running (during a test).",
      inputSchema: {
        query: z.string().describe("Text to search for."),
        rootPath: z.string().optional().describe("Limit to this subtree (default: whole game)."),
        caseSensitive: z.boolean().optional().describe("Case-sensitive match (default false)."),
        maxResults: z.number().int().min(1).optional().describe("Max matching lines per page (default 200)."),
        cursor: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Skip this many matches (pagination). Use nextCursor from a prior call for the next page."),
      },
    },
    async (args) => forward(ctx, "search_scripts", args),
  );

  server.registerTool(
    "get_script_info",
    {
      title: "Get a script file's info / properties",
      description:
        "Inspect a Script/LocalScript/ModuleScript as a 'file': class, path, line/char count, Enabled/Disabled, " +
        "RunContext, and attributes — without returning the full source. Read-only; works while running. " +
        "Use it to debug why a script isn't executing (e.g. Disabled or wrong RunContext).",
      inputSchema: { path: z.string() },
    },
    async (args) => forward(ctx, "get_script_info", args),
  );

  // ---- 搜索 ----
  server.registerTool(
    "find_instances",
    {
      title: "Find instances by name / class",
      description:
        "Search the DataModel for instances matching a name and/or className. Use matchMode 'contains' (default) " +
        "or 'exact' for the name. Optionally limit to a rootPath subtree and cap results with limit.",
      inputSchema: {
        name: z.string().optional().describe("Name to match."),
        className: z.string().optional().describe('Class to match (uses :IsA, e.g. "BasePart").'),
        rootPath: z.string().optional().describe("Limit search to this subtree (default: whole game)."),
        matchMode: z.enum(["contains", "exact"]).optional().describe("Name match mode (default contains)."),
        caseSensitive: z.boolean().optional().describe("Case-sensitive name match (default false)."),
        limit: z.number().int().min(1).optional().describe("Max results per page (default 200)."),
        cursor: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Skip this many matches (pagination). Use nextCursor from a prior call to get the next page."),
      },
    },
    async (args) => forward(ctx, "find_instances", args),
  );

  server.registerTool(
    "search_by_property",
    {
      title: "Search instances by property value",
      description:
        "Find instances whose property equals (or contains) a value, e.g. property 'Anchored' = false, or " +
        "property 'Material' = 'Neon'. Values are compared as strings (tostring). Optionally scope by className " +
        "and rootPath.",
      inputSchema: {
        property: z.string().describe('Property name, e.g. "Anchored", "Material", "BrickColor".'),
        value: z.union([z.string(), z.number(), z.boolean()]).describe("Value to match (compared as a string)."),
        op: z.enum(["equals", "contains"]).optional().describe("Comparison (default equals)."),
        className: z.string().optional().describe("Restrict to this class (:IsA)."),
        rootPath: z.string().optional().describe("Limit to this subtree (default: whole game)."),
        limit: z.number().int().min(1).optional().describe("Max results (default 200)."),
      },
    },
    async (args) => forward(ctx, "search_by_property", args),
  );

  // ---- CollectionService 标签 ----
  server.registerTool(
    "get_tagged",
    {
      title: "Get instances with a tag",
      description: "Return all instances that have the given CollectionService tag.",
      inputSchema: { tag: z.string() },
    },
    async (args) => forward(ctx, "get_tagged", args),
  );

  server.registerTool(
    "get_tags",
    {
      title: "Get an instance's tags",
      description: "Return the CollectionService tags on an instance.",
      inputSchema: { path: z.string() },
    },
    async (args) => forward(ctx, "get_tags", args),
  );

  server.registerTool(
    "add_tag",
    {
      title: "Add a tag to an instance",
      description: "Add a CollectionService tag to an instance." + CAUTION,
      inputSchema: { path: z.string(), tag: z.string(), dryRun: z.boolean().optional() },
    },
    async (args) => forward(ctx, "add_tag", args, { dryRun: (args as { dryRun?: boolean }).dryRun }),
  );

  server.registerTool(
    "remove_tag",
    {
      title: "Remove a tag from an instance",
      description: "Remove a CollectionService tag from an instance." + CAUTION,
      inputSchema: { path: z.string(), tag: z.string(), dryRun: z.boolean().optional() },
    },
    async (args) => forward(ctx, "remove_tag", args, { dryRun: (args as { dryRun?: boolean }).dryRun }),
  );
}
