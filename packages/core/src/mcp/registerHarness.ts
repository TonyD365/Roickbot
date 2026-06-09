// Harness 工具：跨 session 的项目记忆（本地处理，不转发给插件）。
// init / session_start / session_end / status / feature_update —— 类比 npm init / "上次干到哪了" /
// git commit + handoff doc / git status / issue tracker。

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ToolContext, jsonResult, errorResult } from "../tools/types.js";

const statusEnum = z.enum(["planned", "in_progress", "completed", "blocked", "cancelled"]);
const priorityEnum = z.enum(["low", "medium", "high", "critical"]);

export function registerHarnessTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "harness_init",
    {
      title: "Initialize the project harness",
      description:
        "One-time project init (like `npm init`). Record game_name / genre / description as long-lived " +
        "project memory. Safe to call again to update the metadata. Call once when starting a new game project.",
      inputSchema: {
        game_name: z.string().optional().describe("The game's name."),
        genre: z.string().optional().describe('e.g. "obby", "tycoon", "simulator", "FPS".'),
        description: z.string().optional().describe("Short description of the game / goals."),
      },
    },
    async (args) => {
      try {
        const a = args as { game_name?: string; genre?: string; description?: string };
        const r = await ctx.harness.init({ gameName: a.game_name, genre: a.genre, description: a.description });
        return jsonResult(r);
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "harness_session_start",
    {
      title: "Start a dev session",
      description:
        "Begin a development session. Pass initial_goals; get back a session_id plus the current project " +
        'context — "where we left off": project metadata, still-open features, and the previous session\'s ' +
        "handoff notes + summary. Call this at the start of each working session.",
      inputSchema: {
        initial_goals: z.array(z.string()).optional().describe("What you intend to accomplish this session."),
      },
    },
    async (args) => {
      try {
        const a = args as { initial_goals?: string[] };
        const r = await ctx.harness.sessionStart({ initialGoals: a.initial_goals });
        return jsonResult(r);
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "harness_session_end",
    {
      title: "End a dev session",
      description:
        "Close a development session, leaving handoff_notes (array) + a summary for the next session (like a " +
        "git commit message + a handoff doc). Defaults to the most recent open session. Call this when you " +
        "finish working so the next session knows what happened.",
      inputSchema: {
        session_id: z.string().optional().describe("Which session to end (default: the latest open one)."),
        handoff_notes: z.array(z.string()).optional().describe("Bullet notes for the next session."),
        summary: z.string().optional().describe("Short summary of what was done."),
      },
    },
    async (args) => {
      try {
        const a = args as { session_id?: string; handoff_notes?: string[]; summary?: string };
        const r = await ctx.harness.sessionEnd({
          sessionId: a.session_id,
          handoffNotes: a.handoff_notes,
          summary: a.summary,
        });
        return jsonResult(r);
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "harness_status",
    {
      title: "Get project status",
      description:
        "Return the current project state: metadata, all features (with status/priority/tags), feature counts " +
        "by status, the session log, and which session is open (like `git status` for the project).",
      inputSchema: {},
    },
    async () => {
      try {
        return jsonResult(await ctx.harness.status());
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "harness_feature_update",
    {
      title: "Add or update a feature",
      description:
        "Add a feature (omit id, give a title) or update one (pass its id). Tracks status " +
        "(planned/in_progress/completed/blocked/cancelled), priority (low/medium/high/critical), tags, and " +
        "notes — a lightweight issue tracker for the project.",
      inputSchema: {
        id: z.string().optional().describe("Feature id to update (omit to create a new one)."),
        title: z.string().optional().describe("Feature title (required when creating)."),
        status: statusEnum.optional(),
        priority: priorityEnum.optional(),
        tags: z.array(z.string()).optional(),
        notes: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const a = args as {
          id?: string;
          title?: string;
          status?: z.infer<typeof statusEnum>;
          priority?: z.infer<typeof priorityEnum>;
          tags?: string[];
          notes?: string;
        };
        return jsonResult(await ctx.harness.featureUpdate(a));
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
