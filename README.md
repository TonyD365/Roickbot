# Claude for Roblox Studio

A desktop app + MCP server that lets **Claude / Claude Code** control **Roblox Studio**:
read and edit scripts, build and modify scenes and models, run the simulation, and (in later
phases) drive an in-game Bot that reports what it "sees" as structured data.

> Status: Phase 1 (core) — a working bridge with script, instance, property, selection and
> run/test tools, plus a universal `run_luau` escape hatch. Make-graphics and Bot-vision are
> planned for Phase 2 / 3.

## How it works

```
Claude Code (VSCode)
   │  MCP over local HTTP/SSE  (127.0.0.1, Bearer token)
   ▼
Desktop app (Electron)
   ├─ MCP server  (@modelcontextprotocol/sdk)
   ├─ Studio bridge (127.0.0.1 HTTP, long-polling)
   └─ token / pairing / auth
   ▲  GET /poll  +  POST /response
   ▼
Roblox Studio plugin (Luau)  — runs commands on the DataModel
```

Roblox Studio plugins cannot accept inbound connections, so the plugin **long-polls** the local
bridge for commands and posts results back. The desktop app owns the service lifecycle and helps
you wire up Claude Code.

## Repository layout

| Path | What |
| --- | --- |
| `packages/core` | MCP server + HTTP bridge + security (TypeScript) |
| `packages/desktop` | Electron desktop app (start/stop service, pairing, install helpers) |
| `plugin` | Roblox Studio plugin (Luau, built with Rojo) |
| `docs` | Install, protocol, tools and security docs |

## Quick start (development)

```bash
npm install
npm run build:core
npm test
node smoke.mjs          # end-to-end bridge smoke test (no Studio needed)
```

To run the desktop app from source you also need the Electron binary
(`npm install` without `ELECTRON_SKIP_BINARY_DOWNLOAD`) and a built plugin:

```bash
npm run build:plugin    # requires Rojo (see plugin/aftman.toml) -> dist/ClaudeBridge.rbxmx
npm run build:desktop
npm start --workspace packages/desktop
```

See [docs/INSTALL.md](docs/INSTALL.md) for the full end-user setup and
[docs/SECURITY.md](docs/SECURITY.md) for the auth model.

## Security in one line

The bridge listens only on `127.0.0.1`, requires a random Bearer token (shown in the app, pasted
once into the Studio plugin), validates the `Host` header and rejects any browser `Origin` — so a
malicious web page cannot drive it. See [docs/SECURITY.md](docs/SECURITY.md).

## License

MIT
