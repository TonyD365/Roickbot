// Phase 3 工具：可控 Bot（充当玩家的测试替身）+ 结构化"视觉"。
// 与游戏运行配合形成自我测试闭环：bot_spawn → start_test → bot_move/look/see + get_console_output → 诊断 → stop_test → 改 → 再来。
// Bot 工具不受运行时锁限制（它们是测试手段，不是工程编辑）。

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ToolContext, forward, forwardDestructive } from "../tools/types.js";

const vec3 = z.array(z.number()).length(3);

export function registerPhase3Tools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "bot_spawn",
    {
      title: "Spawn the test Bot",
      description:
        "Spawn a controllable Bot (a 'ClaudeBot' rig in Workspace) that acts as the player during a test. " +
        "Spawn it, then start_test, then drive it with bot_move/bot_look and observe with bot_see. " +
        "Set asPlayer:true to tag it 'ClaudePlayer' + set an OwnerUserId attribute for player-based systems " +
        "(note: Run mode has no real client, so it won't appear in Players:GetPlayers() — systems should match " +
        "the tag, or use run_luau(context:'server') for ownership logic).",
      inputSchema: {
        position: vec3.optional().describe("Spawn position [x,y,z] (default ~[0,5,0])."),
        lookAt: vec3.optional().describe("Face this point on spawn."),
        rig: z.enum(["humanoid", "part"]).optional().describe("humanoid = walkable rig (default); part = a single sensor part."),
        asPlayer: z.boolean().optional().describe("Tag as 'ClaudePlayer' + set OwnerUserId for player-based systems."),
        userId: z.number().optional().describe("OwnerUserId attribute value when asPlayer (default -1)."),
      },
    },
    async (args) => forward(ctx, "bot_spawn", args),
  );

  server.registerTool(
    "bot_despawn",
    {
      title: "Despawn the test Bot",
      description: "Remove the ClaudeBot. Destructive: returns a preview + confirm token first.",
      inputSchema: {
        confirm: z.string().optional().describe("confirmToken from a prior preview call."),
      },
    },
    async (args) => forwardDestructive(ctx, "bot_despawn", args as Record<string, unknown>),
  );

  server.registerTool(
    "bot_move",
    {
      title: "Move the Bot",
      description:
        "Move the Bot. Use `to` (walk to a point via Humanoid:MoveTo during a running test), `by` (relative), " +
        "or `teleport:true` (instantly set position). Walking needs the game running (start_test).",
      inputSchema: {
        to: vec3.optional().describe("Absolute target [x,y,z]."),
        by: vec3.optional().describe("Relative offset [x,y,z]."),
        teleport: z.boolean().optional().describe("Teleport instead of walk."),
      },
    },
    async (args) => forward(ctx, "bot_move", args),
  );

  server.registerTool(
    "bot_look",
    {
      title: "Aim the Bot's view",
      description: "Point the Bot's facing/look direction, used by bot_see. Give lookAt, or yawDeg, and/or pitchDeg.",
      inputSchema: {
        lookAt: vec3.optional().describe("Look toward this point [x,y,z]."),
        yawDeg: z.number().optional().describe("Absolute yaw in degrees."),
        pitchDeg: z.number().optional().describe("Vertical look angle in degrees (stored for bot_see)."),
      },
    },
    async (args) => forward(ctx, "bot_look", args),
  );

  server.registerTool(
    "bot_state",
    {
      title: "Get the Bot's state",
      description: "Return the Bot's position, look direction, pitch, and humanoid state.",
      inputSchema: {},
    },
    async () => forward(ctx, "bot_state", {}),
  );

  server.registerTool(
    "bot_see",
    {
      title: "Bot vision (structured)",
      description:
        "What the Bot 'sees': casts a fan of rays over its field of view + a nearby-objects query, and returns " +
        "structured perception (visible objects with name/class/position/color/material/distance, plus a nearby list " +
        "and a summary). Roblox can't give real pixels, so this is structured data, not an image.",
      inputSchema: {
        fovDeg: z.number().optional().describe("Field of view in degrees (default 90)."),
        range: z.number().optional().describe("Max ray distance in studs (default 100)."),
        hRays: z.number().int().optional().describe("Horizontal ray count (default 24)."),
        vRays: z.number().int().optional().describe("Vertical ray count (default 12)."),
        includeProps: z.array(z.string()).optional().describe("Extra properties to include per visible object."),
      },
    },
    async (args) => forward(ctx, "bot_see", args),
  );
}
