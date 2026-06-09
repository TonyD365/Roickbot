// Phase 2 工具：做图（建几何体 / 外观 / 地形 / 光照 / 贴图 / 模型 / GUI）。
// 与 Phase 1 一样，这些只是把请求转发给 Studio 插件执行；真正操作在 Luau 侧。

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ToolContext, forward } from "../tools/types.js";

const CAUTION =
  " Use dryRun:true to preview first when unsure; every action is one undo waypoint.";

const vec3 = z.array(z.number()).length(3);
const rgb = z.array(z.number()).length(3).describe("[r,g,b] 0-255");

export function registerPhase2Tools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "build_parts",
    {
      title: "Build parts (batch)",
      description:
        "Create one or more Parts in a single undo waypoint. Good for blocking out scenes/maps." + CAUTION,
      inputSchema: {
        parts: z
          .array(
            z.object({
              shape: z.enum(["Block", "Ball", "Cylinder", "Wedge", "CornerWedge"]).optional(),
              size: vec3.optional().describe("[x,y,z], default [4,1,2]"),
              position: vec3.optional().describe("[x,y,z]"),
              orientation: vec3.optional().describe("[rx,ry,rz] degrees"),
              color: rgb.optional(),
              material: z.string().optional().describe('e.g. "Plastic", "Wood", "Neon"'),
              anchored: z.boolean().optional().describe("default true"),
              name: z.string().optional(),
              parentPath: z.string().optional().describe("default Workspace"),
            }),
          )
          .min(1),
        dryRun: z.boolean().optional(),
      },
    },
    async (args) => forward(ctx, "build_parts", args, { dryRun: (args as { dryRun?: boolean }).dryRun }),
  );

  server.registerTool(
    "set_appearance",
    {
      title: "Set part appearance",
      description: "Set a BasePart's color / material / transparency / reflectance / shadow." + CAUTION,
      inputSchema: {
        path: z.string(),
        color: rgb.optional(),
        material: z.string().optional(),
        transparency: z.number().min(0).max(1).optional(),
        reflectance: z.number().min(0).max(1).optional(),
        castShadow: z.boolean().optional(),
        dryRun: z.boolean().optional(),
      },
    },
    async (args) => forward(ctx, "set_appearance", args, { dryRun: (args as { dryRun?: boolean }).dryRun }),
  );

  server.registerTool(
    "edit_terrain",
    {
      title: "Edit terrain",
      description:
        "Fill or clear Workspace.Terrain. ops: fillBlock {position,size}, fillBall {position,radius}, clear." +
        CAUTION,
      inputSchema: {
        op: z.enum(["fillBlock", "fillBall", "clear"]),
        position: vec3.optional(),
        size: vec3.optional(),
        radius: z.number().optional(),
        material: z.string().optional().describe('e.g. "Grass", "Rock", "Sand", "Water"'),
        dryRun: z.boolean().optional(),
      },
    },
    async (args) => forward(ctx, "edit_terrain", args, { dryRun: (args as { dryRun?: boolean }).dryRun }),
  );

  server.registerTool(
    "set_lighting",
    {
      title: "Set lighting / atmosphere",
      description:
        "Set Lighting properties (e.g. ClockTime, Brightness, Ambient, FogColor, Technology) and optionally " +
        "add an Atmosphere or clear lighting effects." + CAUTION,
      inputSchema: {
        properties: z.record(z.any()).optional().describe('e.g. { "ClockTime": 0, "Brightness": 2 }'),
        atmosphere: z.record(z.any()).optional().describe("Add an Atmosphere with these properties."),
        clearEffects: z.boolean().optional().describe("Remove existing Lighting child effects first."),
        dryRun: z.boolean().optional(),
      },
    },
    async (args) => forward(ctx, "set_lighting", args, { dryRun: (args as { dryRun?: boolean }).dryRun }),
  );

  server.registerTool(
    "insert_decal",
    {
      title: "Insert a decal/texture on a part",
      description: "Add a Decal (image) to a BasePart by asset id." + CAUTION,
      inputSchema: {
        path: z.string(),
        assetId: z.union([z.string(), z.number()]),
        face: z.enum(["Top", "Bottom", "Front", "Back", "Left", "Right"]).optional(),
        dryRun: z.boolean().optional(),
      },
    },
    async (args) => forward(ctx, "insert_decal", args, { dryRun: (args as { dryRun?: boolean }).dryRun }),
  );

  server.registerTool(
    "insert_model",
    {
      title: "Insert a model by asset id",
      description:
        "Insert a model/asset via InsertService:LoadAsset. The asset must be owned by you or free/public." +
        CAUTION,
      inputSchema: {
        assetId: z.union([z.string(), z.number()]),
        parentPath: z.string().optional().describe("default Workspace"),
        position: vec3.optional().describe("Pivot the inserted model to this position."),
        dryRun: z.boolean().optional(),
      },
    },
    async (args) => forward(ctx, "insert_model", args, { dryRun: (args as { dryRun?: boolean }).dryRun }),
  );

  server.registerTool(
    "build_gui",
    {
      title: "Build a GUI tree",
      description:
        "Instantiate a declarative GUI tree (ScreenGui/Frame/TextLabel/…) under a parent (default StarterGui). " +
        "Each node: { className, name?, properties?, children? }." + CAUTION,
      inputSchema: {
        tree: z
          .object({
            className: z.string(),
            name: z.string().optional(),
            properties: z.record(z.any()).optional(),
            children: z.array(z.any()).optional(),
          })
          .describe("Root GUI node; children recurse with the same shape."),
        parentPath: z.string().optional().describe("default StarterGui"),
        dryRun: z.boolean().optional(),
      },
    },
    async (args) => forward(ctx, "build_gui", args, { dryRun: (args as { dryRun?: boolean }).dryRun }),
  );
}
