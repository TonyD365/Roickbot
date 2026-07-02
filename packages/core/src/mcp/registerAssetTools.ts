// 素材库工具：搜索免费模型/贴图、体检资源、查看当前选择。都转发给 Studio 插件
// （搜索用 InsertService，无需联网/登录；体检会加载资源看内部是否有脚本等）。

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ToolContext, forward } from "../tools/types.js";

// 体检要加载资源（网络 + 解析），给足超时。
const SEARCH_DEADLINE_MS = 60_000;

export function registerAssetTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "toolbox_search",
    {
      title: "Search the Roblox free-asset library",
      description:
        "Search Roblox's free Models/Decals by keyword (via InsertService — no internet/login needed). " +
        "Returns candidates with assetId, name, creator. With inspect:true (default) each result is loaded and " +
        "analyzed WITHOUT adding it to the scene, reporting hasScripts, scriptCount, scriptNames, partCount, " +
        "class breakdown and bounding size — so you can avoid models with unwanted/unsafe scripts before " +
        "inserting one with insert_model / insert_decal.",
      inputSchema: {
        query: z.string().describe("Search keyword, e.g. 'medieval sword', 'grass texture'."),
        category: z.enum(["model", "decal"]).optional().describe("What to search (default model)."),
        limit: z.number().int().min(1).max(30).optional().describe("Max results to return (default 10)."),
        page: z.number().int().min(0).optional().describe("Result page (default 0)."),
        inspect: z
          .boolean()
          .optional()
          .describe("Load & analyze each result for scripts/parts/size (default true; false = faster, metadata only)."),
      },
    },
    async (args) => forward(ctx, "toolbox_search", args, { deadlineMs: SEARCH_DEADLINE_MS }),
  );

  server.registerTool(
    "inspect_asset",
    {
      title: "Inspect an asset's contents",
      description:
        "Load a specific assetId WITHOUT adding it to the scene and report what's inside: hasScripts, scriptCount, " +
        "scriptNames, partCount, instanceCount, class breakdown, bounding size. Use it to safety-check a model " +
        "(scripts?) before insert_model.",
      inputSchema: { assetId: z.union([z.number(), z.string()]).describe("The Roblox asset id.") },
    },
    async (args) => forward(ctx, "inspect_asset", args, { deadlineMs: SEARCH_DEADLINE_MS }),
  );

  server.registerTool(
    "view_selection",
    {
      title: "View the current Studio selection (with details)",
      description:
        "Return the instances the user currently has selected in Studio, each with details: class, path, " +
        "properties, whether it contains scripts (hasScripts/scriptCount), and child count. Richer than " +
        "get_selection (which returns only paths). Set includeSource to include script source for selected scripts.",
      inputSchema: {
        props: z.array(z.string()).optional().describe("Restrict returned properties to this list."),
        includeSource: z.boolean().optional().describe("Include source for selected Script/LocalScript/ModuleScript."),
      },
    },
    async (args) => forward(ctx, "view_selection", args),
  );
}
