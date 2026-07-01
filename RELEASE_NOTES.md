## Brickbot v0.1.0 — Phase 1: the core bridge

The first release. This is a working, secured bridge that lets **Claude / Claude Code** control a
Roblox Studio session in natural language — read and edit scripts, inspect and modify the scene,
run the simulation, and run arbitrary Luau.

### Highlights

- **Edit anything** — create / delete / clone / reparent instances, read & write properties, and
  edit script source via `ScriptEditorService`.
- **Inspect the scene** — `get_tree`, `get_children`, and `view_elements` for detailed, structured
  views of specific Parts, Scripts, and more.
- **Run & test** — start / stop / pause the physics simulation and query the run state.
- **Universal escape hatch** — `run_luau` runs arbitrary Luau for anything the typed tools don't
  cover; effects are undoable.
- **Safe by design** — every change is a single undo waypoint; destructive operations return a
  dry-run preview + one-time confirm token (Claude-facing, no user pop-ups); Core services are never
  mutable.
- **Secure local bridge** — loopback-only, random per-session Bearer token, `Host`/`Origin`
  validation, and a required custom header to defend against malicious web pages.
- **Desktop app** — start/stop the service, show the pairing token, install the plugin, and write
  the Claude Code MCP config.

### Downloads

| File | For |
| --- | --- |
| `Claude.for.Roblox.Studio-*-arm64.dmg` / `-x64.dmg` | macOS desktop app (Apple Silicon / Intel) |
| `Claude.for.Roblox.Studio-*-x64.exe` / `-arm64.exe` | Windows desktop app |
| `Brickbot.rbxmx` | The Roblox Studio plugin (drop into your Studio Plugins folder) |
| `SHA256SUMS` | Checksums for the files above |

### Getting started

1. Install the desktop app, click **Start service**, then **Install MCP config**, and restart
   Claude Code.
2. Install `Brickbot.rbxmx` into Studio, enable HTTP
   (`game:GetService("HttpService").HttpEnabled = true`), paste the token into the plugin, and click
   **Connect**.
3. Ask Claude to call the `health` tool — it should report `pluginConnected: true`.

Full guide: [docs/INSTALL.md](docs/INSTALL.md) · Tools: [docs/TOOLS.md](docs/TOOLS.md) · Security:
[docs/SECURITY.md](docs/SECURITY.md)

### Known limitations

- The desktop installers are **not code-signed** yet — on first launch bypass macOS Gatekeeper
  (right-click → Open) or Windows SmartScreen (More info → Run anyway).
- Full Play mode (F5, with a player character) has no clean plugin API; use Run + a Bot instead.
- Make-graphics (Phase 2) and Bot vision (Phase 3) are not in this release.

### 中文摘要

首个版本，第一阶段核心：让 Claude / Claude Code 用自然语言操控 Roblox Studio —— 读写脚本、查看与修改
场景、运行仿真、执行任意 Luau。安全方面只绑回环、随机 token、`Host`/`Origin` 校验、必需自定义头，防御
恶意网页；破坏性操作先 dry-run 预览 + 确认，所有更改可撤销。下载桌面应用（Win/macOS，arm64+x64）和插件
`Brickbot.rbxmx`，按 [docs/INSTALL.md](docs/INSTALL.md) 配置即可。安装包暂未签名，首次打开需绕过
Gatekeeper / SmartScreen。
