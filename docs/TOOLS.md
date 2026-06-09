# MCP tools

All mutating tools accept `dryRun: true`, which executes inside a ChangeHistory recording and
then rolls back, returning a preview instead of applying. Every applied change is a single undo
waypoint (Ctrl+Z) named `Claude: <tool>`.

Paths are slash-separated from a service, e.g. `Workspace/Model/Part` (a leading `game/` is
optional).

## Phase 1 — core

| Tool | Purpose |
| --- | --- |
| `health` | Server + plugin connection status. Call first. |
| `get_tree` | Instance tree under a path (`rootPath`, `maxDepth`, `classWhitelist`). |
| `get_children` | Direct children of an instance (lazy expansion). |
| `view_elements` | Detailed view of specific elements by `paths` or `classNameFilter` (+ `includeSource` for scripts). |
| `get_properties` / `set_properties` | Read / write properties. |
| `create_instance` | Create an instance under a parent. |
| `delete_instance` | Delete instance(s). Destructive: returns a preview + confirm token first. |
| `clone_instance` / `reparent_instance` | Clone or move instances. |
| `get_script_source` / `set_script_source` | Read / write script source via `ScriptEditorService`. |
| `get_selection` / `set_selection` | Read / set the Studio selection. |

## Run / test

| Tool | Purpose |
| --- | --- |
| `start_test` / `stop_test` / `pause_test` | Start/stop/pause a play-test via `RunService:Run/Stop/Pause` (Run mode — physics live, no avatar; drive a Bot as the player). |
| `get_run_state` | Edit / Running / Paused. |
| `get_console_output` | Recent Studio Output (prints/warnings/errors) via `LogService`; `count` + `includeTypes` filters. |

> Full Play mode (F5, with a player character) has no clean plugin API, so `start_test` uses Run
> mode + a Bot (Phase 3) as the player.
>
> **Runtime lock:** while a test is running, all project-**editing** tools are blocked with
> `RUNTIME_LOCKED` (the run phase is read-only). Allowed while running: all reads,
> `get_console_output`, `start_test`/`stop_test`/`pause_test`, `run_luau`, and all `bot_*`. Call
> `stop_test` before editing again.

## Universal escape hatch

| Tool | Purpose |
| --- | --- |
| `run_luau` | Run arbitrary Luau in Studio and return the result + prints. Covers anything the other tools don't. Effects are undoable. |

## Safety

- Mutations are restricted to `Workspace`, `ServerStorage`, `ReplicatedStorage`,
  `ReplicatedFirst`, `ServerScriptService`, `StarterGui`, `StarterPack`, `StarterPlayer`,
  `Lighting`, `SoundService`, `Teams`.
- `CoreGui`, `CorePackages`, `RobloxPluginGuiService` and similar are never readable/mutable.
- There are **no artificial size limits** — large projects are supported. Use `maxDepth` /
  `get_children` / `view_elements` filters to control how much data you pull back.

## Phase 2 — make-graphics

| Tool | Purpose |
| --- | --- |
| `build_parts` | Batch-create Parts (shape/size/position/orientation/color/material/anchored) in one undo waypoint. |
| `set_appearance` | Set a BasePart's color / material / transparency / reflectance / shadow. |
| `edit_terrain` | `fillBlock` / `fillBall` / `clear` on `Workspace.Terrain`. |
| `set_lighting` | Set Lighting properties (ClockTime, Brightness, Ambient, FogColor, …), add an Atmosphere, or clear effects. |
| `insert_decal` | Add a Decal (image) to a BasePart by asset id. |
| `insert_model` | Insert a model/asset via `InsertService:LoadAsset` (must be yours or public). |
| `build_gui` | Instantiate a declarative GUI tree under a parent (default StarterGui). |

All accept `dryRun` and obey the same path allow/deny list.

## Phase 3 — Bot vision & self-test loop

| Tool | Purpose |
| --- | --- |
| `bot_spawn` | Spawn a controllable "ClaudeBot" rig in Workspace to act as the player (`rig: humanoid` walkable, or `part` sensor). |
| `bot_despawn` | Remove the Bot (destructive → preview + confirm token). |
| `bot_move` | Walk to `to` (Humanoid:MoveTo while running), `by` (relative), or `teleport`. |
| `bot_look` | Aim the Bot's view (`lookAt` / `yawDeg` / `pitchDeg`) — used by `bot_see`. |
| `bot_state` | Bot position, look direction, pitch, humanoid state. |
| `bot_see` | Structured perception: ray fan over the FOV + nearby query → visible objects (name/class/position/color/material/distance) + nearby list + summary. Not pixels. |

Bot tools are **not** blocked by the runtime lock (they're how you test).

### Self-test loop (AI-orchestrated)

```
bot_spawn → start_test → (bot_move / bot_look / bot_see + get_console_output, repeat) → diagnose
→ stop_test → edit the project → start_test again … until it passes
```
