# Claude for Roblox Studio

[![CI](https://github.com/TonyD365/Claude-for-Roblox-Studio/actions/workflows/ci.yml/badge.svg)](https://github.com/TonyD365/Claude-for-Roblox-Studio/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/TonyD365/Claude-for-Roblox-Studio?sort=semver)](https://github.com/TonyD365/Claude-for-Roblox-Studio/releases/latest)
[![Downloads total](https://img.shields.io/github/downloads/TonyD365/Claude-for-Roblox-Studio/total?label=downloads)](https://github.com/TonyD365/Claude-for-Roblox-Studio/releases)
[![Downloads latest](https://img.shields.io/github/downloads/TonyD365/Claude-for-Roblox-Studio/latest/total?label=downloads%40latest)](https://github.com/TonyD365/Claude-for-Roblox-Studio/releases/latest)
[![Stars](https://img.shields.io/github/stars/TonyD365/Claude-for-Roblox-Studio?style=flat)](https://github.com/TonyD365/Claude-for-Roblox-Studio/stargazers)
[![Last commit](https://img.shields.io/github/last-commit/TonyD365/Claude-for-Roblox-Studio)](https://github.com/TonyD365/Claude-for-Roblox-Studio/commits)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A desktop app + MCP server that lets **Claude Code — and any other MCP client (Gemini, Cursor,
VS Code, …)** — control **Roblox Studio**. Your AI can
read and edit scripts, inspect and modify the scene and models, run the simulation, and — in later
phases — build graphics and drive an in-game **Bot** that reports what it "sees" as structured data,
all through natural language from your editor.

> **Status:** v1.0.0 released. Phase 1 (core) and Phase 2 (make-graphics) are complete — a
> working, secured bridge with tools for scripts, instances, properties, selection, run/test,
> and building scenes (parts, terrain, lighting, decals, models, GUI), plus a universal
> `run_luau` escape hatch. Phase 3 (Bot vision) is next. Cross-platform installers with
> auto-update are published on the [Releases](https://github.com/TonyD365/Claude-for-Roblox-Studio/releases) page.

*(中文版见下方 / Chinese version below.)*

---

## Table of contents

- [Features](#features)
- [How it works](#how-it-works)
- [Repository layout](#repository-layout)
- [Installation (end user)](#installation-end-user)
- [Development](#development)
- [Available tools](#available-tools)
- [Use with other AI clients](#use-with-other-ai-clients)
- [Security](#security)
- ["Think before acting"](#think-before-acting-三思而后行)
- [Roadmap](#roadmap)
- [License](#license)

## Features

- **Edit anything in Studio** — create / delete / clone / reparent instances, read and write any
  property, and edit script source via `ScriptEditorService`.
- **Inspect the scene** — walk the DataModel tree, lazily expand large places, and pull detailed,
  structured views of specific elements (Parts, Scripts, …).
- **Run & test** — start / stop / pause the physics simulation (`RunService`) and query the run
  state.
- **Universal escape hatch** — `run_luau` executes arbitrary Luau in Studio for anything the typed
  tools don't cover; effects are undoable.
- **Safe by design** — every change is a single undo waypoint, destructive ops require a dry-run
  preview + confirmation (Claude-facing, no user pop-ups), and Core services are never mutable.
- **Secure local bridge** — loopback-only, random per-session Bearer token, `Host`/`Origin`
  validation, and a required custom header to defend against malicious web pages.
- **One-click setup** — a desktop app starts the service, shows the pairing token, installs the
  plugin, and writes the Claude Code MCP config for you.
- **Works with any MCP client** — not just Claude: Gemini, Cursor, VS Code/Copilot, Cline, etc.
  (incl. free options). See [docs/CLIENTS.md](docs/CLIENTS.md).
- **Cross-platform releases** — CI packages installers for Windows and macOS (arm64 + x64).

## How it works

```
Claude Code (VSCode)
   │  MCP over local HTTP/SSE  (127.0.0.1, Bearer token)
   ▼
Desktop app (Electron)
   ├─ MCP server  (@modelcontextprotocol/sdk, Streamable HTTP)
   ├─ Studio bridge (127.0.0.1 HTTP, long-polling)
   └─ token / pairing / auth
   ▲  GET /poll  +  POST /response
   ▼
Roblox Studio plugin (Luau)  — runs commands on the DataModel
```

Roblox Studio plugins **cannot accept inbound connections**, so the plugin **long-polls** the local
bridge for the next command and posts the result back. The desktop app owns the service lifecycle,
hosts both the MCP endpoint (for Claude Code) and the bridge (for the plugin), and helps you connect
everything. Because Luau also cannot read real screen pixels, "vision" (Phase 3) is delivered as
structured data (raycast hits + nearby objects), not images.

See [docs/PROTOCOL.md](docs/PROTOCOL.md) for the full wire protocol.

## Repository layout

| Path | What |
| --- | --- |
| `packages/core` | MCP server + HTTP bridge + security + command queue (TypeScript) |
| `packages/desktop` | Electron desktop app (start/stop service, pairing, install helpers) |
| `plugin` | Roblox Studio plugin (Luau, built with Rojo) |
| `docs` | [Install](docs/INSTALL.md), [protocol](docs/PROTOCOL.md), [tools](docs/TOOLS.md), [security](docs/SECURITY.md) |
| `smoke.mjs` | End-to-end bridge smoke test (no Studio required) |

## Installation (end user)

1. **Install the desktop app** from the
   [Releases](https://github.com/TonyD365/Claude-for-Roblox-Studio/releases) page (Windows `.exe`
   or macOS `.dmg`, arm64 / x64).
2. **Start the service** in the app, pick your client from the dropdown (Claude Code, Cursor,
   Gemini CLI, Cline, VS Code) and click **Install MCP config** — the app writes the `roblox-studio`
   server in that client's exact format and location for you. Then restart the client.
3. **Install the plugin**: if it shows offline, click **Install plugin** and save
   `ClaudeBridge.rbxmx` into your Studio Plugins folder.
4. **Enable HTTP** in Studio's Command Bar (once per place):
   `game:GetService("HttpService").HttpEnabled = true`
5. **Pair**: copy the token from the app, paste it into the Claude Bridge plugin panel in Studio,
   and click **Connect**.
6. **Verify**: ask Claude to call the `health` tool — it should report `pluginConnected: true`.

Full steps: [docs/INSTALL.md](docs/INSTALL.md).

## Development

```bash
npm install
npm run build:core
npm test                 # unit tests
node smoke.mjs           # end-to-end bridge smoke test (no Studio needed)
```

To run the desktop app from source you also need the Electron binary (run `npm install` **without**
`ELECTRON_SKIP_BINARY_DOWNLOAD`) and a built plugin:

```bash
npm run build:plugin     # requires Rojo (see plugin/aftman.toml) -> dist/ClaudeBridge.rbxmx
npm run build:desktop
npm start --workspace packages/desktop
```

## Available tools

**Phase 1 (core):** `health`, `get_tree`, `get_children`, `view_elements`, `get_properties`,
`set_properties`, `create_instance`, `delete_instance`, `clone_instance`, `reparent_instance`,
`get_script_source`, `set_script_source`, `get_selection`, `set_selection`.

**Run / test:** `start_test`, `stop_test`, `pause_test`, `get_run_state`, `get_console_output`.

**Phase 2 (make-graphics):** `build_parts`, `set_appearance`, `edit_terrain`, `set_lighting`,
`insert_decal`, `insert_model`, `build_gui`.

**Phase 3 (Bot vision & self-test):** `bot_spawn`, `bot_despawn`, `bot_move`, `bot_look`,
`bot_state`, `bot_see`. While a test is running, project-editing tools are locked (`RUNTIME_LOCKED`) —
the run phase is read-only; reads, `bot_*`, `run_luau` and `get_console_output` stay available.

**Search, tags & surgical edits:** `edit_script_lines` (line-range edits), `find_instances`,
`search_by_property`, `search_scripts` (grep all script source) and `get_script_info` (inspect a
script "file" — class/lines/`Disabled`/`RunContext`/attributes), plus `get_tagged` / `get_tags` /
`add_tag` / `remove_tag`. `search_scripts` and `get_script_info` are read-only, so they work **while
the game is running** — built for debugging a live play-test.

**Project harness (cross-session memory):** `harness_init`, `harness_session_start`,
`harness_session_end`, `harness_status`, `harness_feature_update` — a persistent project memory
(metadata + features + session handoffs) handled locally by the app, so the AI remembers the project
across sessions even with Studio offline.

**Universal:** `run_luau`.

All mutating tools accept `dryRun: true` to preview without applying. There are **no artificial size
limits** — use `maxDepth` / `get_children` / `view_elements` filters to control payload size on
large projects. Full reference: [docs/TOOLS.md](docs/TOOLS.md).

## Use with other AI clients

It's a standard MCP server, so it works with any client that supports remote (HTTP) MCP servers
with custom headers — **not just Claude**. Point the client at `http://127.0.0.1:7331/mcp` with the
`Authorization: Bearer <token>` and `X-Roblox-MCP: 1` headers (the token is shown in the app).

**No manual editing needed:** pick your client (Claude Code, Cursor, Gemini CLI, Cline, VS Code) in
the app's dropdown and click **Install MCP config** — it writes the right `type`/key/path for that
client automatically (each one differs slightly, e.g. Cline needs `streamableHttp`, Gemini uses
`httpUrl`).

**Google Gemini (free tier)** — add to `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "roblox-studio": {
      "httpUrl": "http://127.0.0.1:7331/mcp",
      "headers": { "Authorization": "Bearer PASTE_TOKEN", "X-Roblox-MCP": "1" }
    }
  }
}
```

Cursor, VS Code/Copilot, Cline + local Ollama (free), and other clients are covered — including
**free model options** — in **[docs/CLIENTS.md](docs/CLIENTS.md)**.

## Security

The bridge runs on your machine, so **any web page you open could try to reach `127.0.0.1`**. The
bridge defends against this with several independent checks on every request:

- **Loopback only** — binds `127.0.0.1`, never `0.0.0.0`.
- **Random Bearer token** — 256-bit, shown only in the native app, compared in constant time.
- **Studio-side pairing** — you paste the token into the plugin; a web page can never obtain it.
- **`Host` validation** — blocks DNS-rebinding.
- **`Origin` rejection** — any request with a browser `Origin` is refused.
- **Required custom header** — `X-Roblox-MCP: 1`, with no permissive CORS.

Details and threat model: [docs/SECURITY.md](docs/SECURITY.md).

## "Think before acting" (三思而后行)

Separately from authentication, the tools are designed so Claude is careful — and **without
interrupting you**. Destructive operations first return a dry-run preview and a one-time confirm
token (Claude re-calls to apply); every applied change is a single undo waypoint you can Ctrl+Z; and
Core services (`CoreGui`, `CorePackages`, …) can never be mutated.

## Roadmap

- **Phase 1 — core** ✅ scripts, instances, properties, selection, run/test, `run_luau`.
- **Phase 2 — make-graphics** ✅ `build_parts`, `set_appearance`, `edit_terrain`, `set_lighting`,
  `insert_decal`, `insert_model`, `build_gui`.
- **Phase 3 — Bot vision & self-test loop** ✅ `bot_spawn/despawn/move/look/state`, `bot_see`
  (structured, raycast-based perception); `start_test/stop_test/pause_test`; a runtime lock that
  makes the project read-only while the game is running.

## License

MIT

<br>

---
---

<br>

# Claude for Roblox Studio（中文）

[![CI](https://github.com/TonyD365/Claude-for-Roblox-Studio/actions/workflows/ci.yml/badge.svg)](https://github.com/TonyD365/Claude-for-Roblox-Studio/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/TonyD365/Claude-for-Roblox-Studio?sort=semver)](https://github.com/TonyD365/Claude-for-Roblox-Studio/releases/latest)
[![Downloads total](https://img.shields.io/github/downloads/TonyD365/Claude-for-Roblox-Studio/total?label=downloads)](https://github.com/TonyD365/Claude-for-Roblox-Studio/releases)
[![Downloads latest](https://img.shields.io/github/downloads/TonyD365/Claude-for-Roblox-Studio/latest/total?label=downloads%40latest)](https://github.com/TonyD365/Claude-for-Roblox-Studio/releases/latest)
[![Stars](https://img.shields.io/github/stars/TonyD365/Claude-for-Roblox-Studio?style=flat)](https://github.com/TonyD365/Claude-for-Roblox-Studio/stargazers)
[![Last commit](https://img.shields.io/github/last-commit/TonyD365/Claude-for-Roblox-Studio)](https://github.com/TonyD365/Claude-for-Roblox-Studio/commits)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

一个桌面应用 + MCP 服务器，让 **Claude Code —— 以及任何其它 MCP 客户端（Gemini、Cursor、VS Code…）**
直接操控 **Roblox Studio**。你的 AI 可以读写脚本、
查看和修改场景与模型、运行仿真，并在后续阶段构建图形、驱动一个游戏内 **Bot** 并以结构化数据的形式"看到"
世界 —— 全程在你的编辑器里用自然语言完成。

> **状态：** v1.0.0 已发布。第一阶段（核心）与第二阶段（做图）均已完成 —— 一条可用且带安全鉴权的桥，
> 涵盖脚本、实例、属性、选择、运行/测试，以及搭建场景（Part、地形、光照、贴图、模型、GUI），外加万能的
> `run_luau` 逃生舱。第三阶段（Bot 视觉）进行中。带自动更新的跨平台安装包见
> [Releases](https://github.com/TonyD365/Claude-for-Roblox-Studio/releases) 页面。

## 目录

- [功能特性](#功能特性)
- [工作原理](#工作原理)
- [仓库结构](#仓库结构)
- [安装（最终用户）](#安装最终用户)
- [开发](#开发)
- [可用工具](#可用工具)
- [用在其它 AI 客户端](#用在其它-ai-客户端)
- [安全](#安全-1)
- [三思而后行](#三思而后行)
- [路线图](#路线图)
- [许可](#许可)

## 功能特性

- **在 Studio 里做任何修改** —— 创建/删除/克隆/移动实例，读写任意属性，通过 `ScriptEditorService` 编辑脚本源码。
- **查看场景** —— 遍历 DataModel 树，对大型工程按需懒展开，并拉取特定元素（Part、Script…）的详细结构化信息。
- **运行与测试** —— 启动/停止/暂停物理仿真（`RunService`），查询运行状态。
- **万能逃生舱** —— `run_luau` 在 Studio 里执行任意 Luau，覆盖封装工具未涉及的一切；效果可撤销。
- **设计上安全** —— 每次更改都是一个可撤销的 waypoint；破坏性操作需先 dry-run 预览 + 确认（面向 Claude，
  不弹用户）；Core 服务永不可改。
- **安全的本地桥** —— 只绑回环、每会话随机 Bearer token、`Host`/`Origin` 校验、必需自定义头，防御恶意网页。
- **一键配置** —— 桌面应用负责启动服务、显示配对 token、安装插件，并为你写入 Claude Code 的 MCP 配置。
- **兼容任意 MCP 客户端** —— 不止 Claude：Gemini、Cursor、VS Code/Copilot、Cline 等（含免费方案），
  见 [docs/CLIENTS.md](docs/CLIENTS.md)。
- **跨平台发布** —— CI 打包 Windows 与 macOS 安装包（arm64 + x64）。

## 工作原理

```
Claude Code (VSCode)
   │  通过本地 HTTP/SSE 的 MCP  (127.0.0.1, Bearer token)
   ▼
桌面应用 (Electron)
   ├─ MCP 服务器  (@modelcontextprotocol/sdk, Streamable HTTP)
   ├─ Studio 桥 (127.0.0.1 HTTP, 长轮询)
   └─ token / 配对 / 鉴权
   ▲  GET /poll  +  POST /response
   ▼
Roblox Studio 插件 (Luau)  —— 在 DataModel 上执行命令
```

Roblox Studio 插件**无法接收入站连接**，因此插件**长轮询**本地桥来获取下一条命令并回传结果。桌面应用持有
服务的生命周期，同时托管 MCP 端点（给 Claude Code）和桥（给插件），并帮你把各端连起来。由于 Luau 也读不到
真实屏幕像素，所以"视觉"（第三阶段）以结构化数据（射线命中 + 邻近物体）而非图片的形式提供。

完整通信协议见 [docs/PROTOCOL.md](docs/PROTOCOL.md)。

## 仓库结构

| 路径 | 内容 |
| --- | --- |
| `packages/core` | MCP 服务器 + HTTP 桥 + 安全 + 命令队列（TypeScript） |
| `packages/desktop` | Electron 桌面应用（启停服务、配对、安装助手） |
| `plugin` | Roblox Studio 插件（Luau，用 Rojo 构建） |
| `docs` | [安装](docs/INSTALL.md)、[协议](docs/PROTOCOL.md)、[工具](docs/TOOLS.md)、[安全](docs/SECURITY.md) |
| `smoke.mjs` | 端到端桥烟雾测试（无需 Studio） |

## 安装（最终用户）

1. 从 [Releases](https://github.com/TonyD365/Claude-for-Roblox-Studio/releases) 页面**下载桌面应用**
   （Windows `.exe` 或 macOS `.dmg`，arm64 / x64）。
2. 在应用里**启动服务**，从下拉框选择你的客户端（Claude Code、Cursor、Gemini CLI、Cline、VS Code）
   再点 **Install MCP config** —— 应用会按该客户端正确的格式与路径自动写入 `roblox-studio` 服务，
   然后重启对应客户端。
3. **安装插件**：若显示离线，点 **Install plugin**，把 `ClaudeBridge.rbxmx` 保存到 Studio 的 Plugins 目录。
4. 在 Studio 命令栏**启用 HTTP**（每个 place 一次）：
   `game:GetService("HttpService").HttpEnabled = true`
5. **配对**：从应用复制 token，粘贴进 Studio 里的 Claude Bridge 插件面板，点 **Connect**。
6. **验证**：让 Claude 调用 `health` 工具 —— 应返回 `pluginConnected: true`。

完整步骤见 [docs/INSTALL.md](docs/INSTALL.md)。

## 开发

```bash
npm install
npm run build:core
npm test                 # 单元测试
node smoke.mjs           # 端到端桥烟雾测试（无需 Studio）
```

若要从源码运行桌面应用，还需 Electron 二进制（运行 `npm install` 时**不要**设置
`ELECTRON_SKIP_BINARY_DOWNLOAD`）以及构建好的插件：

```bash
npm run build:plugin     # 需要 Rojo（见 plugin/aftman.toml） -> dist/ClaudeBridge.rbxmx
npm run build:desktop
npm start --workspace packages/desktop
```

## 可用工具

**第一阶段（核心）：** `health`、`get_tree`、`get_children`、`view_elements`、`get_properties`、
`set_properties`、`create_instance`、`delete_instance`、`clone_instance`、`reparent_instance`、
`get_script_source`、`set_script_source`、`get_selection`、`set_selection`。

**运行 / 测试：** `start_test`、`stop_test`、`pause_test`、`get_run_state`、`get_console_output`。

**第二阶段（做图）：** `build_parts`、`set_appearance`、`edit_terrain`、`set_lighting`、
`insert_decal`、`insert_model`、`build_gui`。

**第三阶段（Bot 视觉 + 自我测试）：** `bot_spawn`、`bot_despawn`、`bot_move`、`bot_look`、
`bot_state`、`bot_see`。游戏运行时,工程编辑类工具被锁(`RUNTIME_LOCKED`)——运行态只读;读取、
`bot_*`、`run_luau`、`get_console_output` 仍可用。

**搜索 / 标签 / 行级编辑：** `edit_script_lines`（按行区间改脚本）、`find_instances`、
`search_by_property`、`search_scripts`（grep 所有脚本源码）、`get_script_info`（查看脚本"文件"属性——
类名/行数/`Disabled`/`RunContext`/属性），以及 `get_tagged` / `get_tags` / `add_tag` / `remove_tag`。
其中 `search_scripts` 与 `get_script_info` 是只读的，**游戏运行时也能用** —— 专为调试运行中的测试而设。

**项目 harness（跨 session 记忆）：** `harness_init`、`harness_session_start`、`harness_session_end`、
`harness_status`、`harness_feature_update` —— 由应用本地维护的项目记忆（元信息 + features + session 交接），
让 AI 跨 session 记住项目进度，即使 Studio 没连也能用。

**万能：** `run_luau`。

所有变更类工具都支持 `dryRun: true` 以仅预览不落地。**没有任何人为尺寸上限** —— 在大型工程上用
`maxDepth` / `get_children` / `view_elements` 的筛选来控制返回量。完整参考见 [docs/TOOLS.md](docs/TOOLS.md)。

## 用在其它 AI 客户端

它是标准 MCP 服务器，**不止 Claude** —— 任何支持"远程(HTTP) MCP + 自定义请求头"的客户端都能用。把客户端
指向 `http://127.0.0.1:7331/mcp`，带上 `Authorization: Bearer <token>` 和 `X-Roblox-MCP: 1`（token 在 App 里）。

**无需手动改配置：** 在 App 下拉框选好客户端（Claude Code / Cursor / Gemini CLI / Cline / VS Code）再点
**Install MCP config**，应用会按各客户端正确的 `type`/键/路径自动写好（每个略有不同，例如 Cline 必须
`streamableHttp`、Gemini 用 `httpUrl`）。

**Google Gemini（免费额度）** —— 加到 `~/.gemini/settings.json`：

```json
{
  "mcpServers": {
    "roblox-studio": {
      "httpUrl": "http://127.0.0.1:7331/mcp",
      "headers": { "Authorization": "Bearer 粘贴你的token", "X-Roblox-MCP": "1" }
    }
  }
}
```

Cursor、VS Code/Copilot、Cline + 本地 Ollama（免费）等客户端及**免费模型选项**，详见
**[docs/CLIENTS.md](docs/CLIENTS.md)**。

## 安全

桥运行在你的机器上，因此**任何你打开的网页都可能尝试访问 `127.0.0.1`**。桥对每个请求做多重独立校验来防御：

- **只绑回环** —— 绑定 `127.0.0.1`，绝不 `0.0.0.0`。
- **随机 Bearer token** —— 256 位，仅显示在原生应用中，常量时间比较。
- **Studio 端配对** —— 你把 token 粘贴进插件；网页永远拿不到它。
- **`Host` 校验** —— 阻止 DNS-rebinding。
- **拒绝 `Origin`** —— 任何带浏览器 `Origin` 的请求都被拒。
- **必需自定义头** —— `X-Roblox-MCP: 1`，且不开放宽松 CORS。

细节与威胁模型见 [docs/SECURITY.md](docs/SECURITY.md)。

## 三思而后行

除了鉴权之外，工具本身的设计也让 Claude 保持谨慎，**且不打扰你**。破坏性操作会先返回 dry-run 预览和一次性
确认 token（Claude 再次调用才真正执行）；每次落地的更改都是一个可 Ctrl+Z 撤销的 waypoint；Core 服务
（`CoreGui`、`CorePackages`…）永远不可改。

## 路线图

- **第一阶段 —— 核心** ✅ 脚本、实例、属性、选择、运行/测试、`run_luau`。
- **第二阶段 —— 做图** ✅ `build_parts`、`set_appearance`、`edit_terrain`、`set_lighting`、
  `insert_decal`、`insert_model`、`build_gui`。
- **第三阶段 —— Bot 视觉 + 自我测试闭环** ✅ `bot_spawn/despawn/move/look/state`、`bot_see`（基于射线的结构化感知）；`start_test/stop_test/pause_test`；运行时锁（运行中工程只读）。

## 许可

MIT
