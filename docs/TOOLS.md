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
| `run_simulation` / `stop_simulation` / `pause_simulation` | `RunService:Run/Stop/Pause` — physics simulation (no local player). |
| `get_run_state` | Edit / Running / Paused. |

> Full Play mode (F5, with a player character) has no clean plugin API, so use Run + a Bot
> (Phase 3) instead.

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

## Planned

- **Phase 2 (make-graphics)**: `build_parts`, `set_appearance`, `edit_terrain`, `set_lighting`,
  `insert_decal_texture`, `build_gui`, `insert_model`.
- **Phase 3 (Bot vision)**: `bot_spawn/despawn/move/look/state`, `bot_see` (structured
  raycast-based perception).
