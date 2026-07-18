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
| `get_tree` | Instance tree under a path (`rootPath`, `maxDepth`, `classWhitelist`, `excludeClassWhitelist` to skip e.g. heavy `Model` subtrees, `maxNodes` safety cap → `truncated:true`). Returns `{root, nodeCount, truncated}`. |
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
| `start_test` / `stop_test` / `pause_test` | Start/stop/pause a play-test via `RunService:Run/Stop/Pause` (Run mode — physics live, no avatar; drive a Bot as the player). `start_test` reads the state back and returns `ok:false` + a `warning` if the place didn't actually enter Running — verify with `get_run_state`. |
| `get_run_state` | Edit / Running / Paused. |
| `get_console_output` | Recent Studio Output (prints/warnings/errors) via `LogService`; `count`, `order` (`newest` default), `includeTypes` filters. |

> Full Play mode (F5, with a player character) has no clean plugin API, so `start_test` uses Run
> mode + a Bot (Phase 3) as the player.
>
> **Runtime lock:** while a test is running, all project-**editing** tools are blocked with
> `RUNTIME_LOCKED` (the run phase is read-only). Allowed while running: all reads,
> `get_console_output`, `start_test`/`stop_test`/`pause_test`, `run_luau`, `fire_signal`, and all
> `bot_*`. Call `stop_test` before editing again.

## Runtime server agent & events

On `start_test`, the plugin injects a small **server agent** Script into the running game. It runs in
the game's real **server** context and connects back to the bridge on a separate channel, so these
tools can act as the server (which the plugin context can't):

| Tool | Purpose |
| --- | --- |
| `run_luau` with `context:"server"` | Run Luau **in the running game's server context** (real `IsServer()`/`IsRunning()`). Needs `start_test`. Default `context:"plugin"` runs in the edit/plugin VM as before. |
| `fire_signal` | Call a method on an instance in server context — e.g. a RemoteEvent's `FireAllClients`/`FireClient`, a BindableEvent's `Fire`, a `ProximityPrompt`'s `InputHoldBegin`/`InputHoldEnd`, or `BasePart:SetNetworkOwner`. Pass instances as `{"$path":"Players/Foo"}` and Vector3 as `{"$Vector3":[x,y,z]}` in `args`. Use it to trigger server-side listeners. |
| `wait_for_event` | Block until Studio pushes the next event, instead of polling. Event `types`: `runState` (Edit/Running/Paused changes — catches the test stopping), `output` (runtime `Error` messages), `agentState` (runtime agent online). Returns the event or `{timedOut:true}`. |

> The agent only exists **while a test is running** and is removed on `stop_test`. `context:"server"`
> tools return a clear error if no test is running. There is **no client context** in Run mode (no
> real player/client), so client-only input can't be simulated from here — drive client-facing flows
> server-side via `fire_signal`/`run_luau(context:"server")`.

> **Bot as a player:** `bot_spawn { asPlayer: true }` tags the Bot `ClaudePlayer` and sets an
> `OwnerUserId` attribute. A real `Players` entry can't exist in Run mode (no client), so
> `Players:GetPlayers()` won't include it — have player systems match the tag, or set network
> ownership via `run_luau(context:"server")`.

## Search, tags & surgical edits

| Tool | Purpose |
| --- | --- |
| `edit_script_lines` | Edit a line range of a script (`replace` / `insert` / `delete`) instead of replacing the whole source. |
| `find_instances` | Search the DataModel by `name` (contains/exact) and/or `className` (`:IsA`), optional `rootPath`/`limit`/`cursor`. Paged: returns `nextCursor` when `truncated`. |
| `search_by_property` | Find instances where a `property` equals/contains a `value` (e.g. `Anchored=false`, `Material=Neon`). |
| `search_scripts` | Grep across all script sources for a `query`; returns matching scripts + line numbers + line text. Paged via `maxResults`/`cursor` → `nextCursor`. |
| `get_script_info` | A script "file"'s info: class, path, line/char count, `Enabled`/`Disabled`, `RunContext`, attributes (no source). |
| `get_tagged` / `get_tags` | List instances with a CollectionService tag / list an instance's tags. |
| `add_tag` / `remove_tag` | Add / remove a CollectionService tag (mutating, undoable). |

> `search_scripts` and `get_script_info` are **read-only**, so they work **while the game is
> running** — handy for debugging a live play-test (e.g. find where an error message comes from, or
> check whether a script is `Disabled` / has the wrong `RunContext`).

## Project harness (cross-session memory)

Handled **locally by the app** (persisted to a JSON file next to the token) — these don't touch
Studio, so they work even with the plugin offline. They give the AI a persistent project memory
across sessions.

| Tool | Purpose | Analogy |
| --- | --- | --- |
| `harness_init` | One-time project init (`game_name`, `genre`, `description`). | `npm init` |
| `harness_session_start` | Start a session with `initial_goals`; returns a `session_id` + "where we left off" (open features + last session's handoff). | "what did I do last time" |
| `harness_session_end` | End a session, leaving `handoff_notes` + `summary` for the next one. | commit message + handoff doc |
| `harness_status` | Current project state (features + sessions). | `git status` |
| `harness_feature_update` | Add/update a feature: status, priority, tags. | issue tracker |

## Universal escape hatch

| Tool | Purpose |
| --- | --- |
| `run_luau` | Run arbitrary Luau in Studio and return the result + prints. Multi-line code and top-level `local` work (executed via a temp ModuleScript, not `loadstring`, so it also works in Run mode). Covers anything the other tools don't. Effects are undoable. |

> **`run_luau` context:** it runs in the **plugin** VM, not a server/client runtime. So
> `RunService:IsServer()` is `false` and `RunService:IsRunning()` reflects the **edit** DataModel.
> For real server-runtime behaviour during a test, use `start_test` + the `bot_*` tools.

> **Plugin / app version skew:** if the desktop app is newer than the installed Studio plugin, a
> tool may exist in the app but not in the plugin. The plugin reports its tool list at handshake, so
> the server returns a clear "reinstall the plugin" message instead of a cryptic error. Reinstall via
> the app's **Install plugin** button and reconnect.

## Safety

- Mutations are restricted to `Workspace`, `ServerStorage`, `ReplicatedStorage`,
  `ReplicatedFirst`, `ServerScriptService`, `StarterGui`, `StarterPack`, `StarterPlayer`,
  `Lighting`, `SoundService`, `Teams`.
- `CoreGui`, `CorePackages`, `RobloxPluginGuiService` and similar are never readable/mutable.
- Read tools apply safe defaults and hard caps to keep Studio responsive. Use `maxDepth`, `maxNodes`,
  `limit`, and pagination (`cursor` / `nextCursor`) to inspect large projects incrementally.

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

## Assets & selection

| Tool | Purpose |
| --- | --- |
| `toolbox_search` | Search Roblox's **free** Models/Decals by keyword via `InsertService:GetFreeModels`/`GetFreeDecals` (no internet/login needed — it runs inside Studio). Returns `assetId`, `name`, `creator`. With `inspect:true` (default) each result is loaded off-scene and analyzed: **`hasScripts`**, `scriptCount`, `scriptNames`, `partCount`, class breakdown, bounding `size` — so you can skip models with unwanted/unsafe scripts before inserting one with `insert_model`. |
| `inspect_asset` | Load one `assetId` off-scene and report the same contents (scripts / parts / classes / size). Safety-check a model before inserting. |
| `view_selection` | The instances the user has currently selected in Studio, each with details (class, path, properties, `hasScripts`/`scriptCount`, child count; `includeSource` for scripts). Richer than `get_selection` (paths only). |

> These are read-only (they load assets into a throwaway container and destroy it — nothing is added to your scene until you call `insert_model`/`insert_decal`).

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
