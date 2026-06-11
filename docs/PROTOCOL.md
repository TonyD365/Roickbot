# Bridge protocol

The desktop app hosts one server on `127.0.0.1:<port>` (default `7331`): an HTTP endpoint for the
MCP client, and a **WebSocket** endpoint for the Studio plugin / runtime agent. Both are behind the
auth middleware described in [SECURITY.md](SECURITY.md).

The Studio side connects over WebSocket via `HttpService:CreateWebStreamClient(Enum.WebStreamClientType.WebSocket, …)`
(a persistent, bidirectional channel — replaces the old HTTP long-poll). The auth token and
`X-Roblox-MCP` header are sent in the WebSocket upgrade request headers, so the same auth/origin/host
checks apply.

## Endpoints

| Kind | Path | Caller | Purpose |
| --- | --- | --- | --- |
| HTTP | `/mcp` | MCP client (Claude Code, …) | MCP Streamable HTTP endpoint (stateful sessions). |
| WS | `/ws` | Studio plugin | Persistent command/response/event channel. |
| WS | `/ws?role=agent` | Runtime server agent | Same channel for server-context tools (during a test). |
| HTTP GET | `/health` | diagnostics | `{ ok, serverVersion, pluginConnected, agentConnected, queueDepth }`. |

## WebSocket messages

Plugin → server: `{ "type": "handshake", "pluginVersion", "sessionId", "tools": [...], "role"? }`,
`{ "type": "response", "id", "ok", "result"|"error" }`, `{ "type": "event", "event": { "type": "runState"|"output"|... } }`.

Server → plugin: `{ "type": "command", "payload": <envelope> }`, `{ "type": "handshake_ok", "protocol", "serverVersion" }`.

### Command envelope (inside `payload`)

```json
{
  "id": "uuid",
  "tool": "create_instance",
  "args": { "className": "Part", "parentPath": "Workspace" },
  "dryRun": false,
  "deadlineMs": 15000,
  "protocol": 1
}
```

### Response

```json
{ "type": "response", "id": "uuid", "ok": true, "result": { "path": "Workspace/Part" } }
```
or
```json
{ "type": "response", "id": "uuid", "ok": false, "error": { "code": "PATH_DENIED", "message": "..." } }
```

## Concurrency & timeouts

- Commands run **serially** in the plugin (the DataModel is single-threaded). The server keeps a FIFO
  queue and an in-flight map; one push loop per WebSocket connection delivers commands.
- The WebSocket connection's liveness is authoritative (no polling gap). A closed socket immediately
  marks the plugin offline; an in-flight command also counts as "connected" (the plugin is just busy).
- Each command has a server-side deadline (default 15s, longer for `run_luau`); late responses are
  dropped.

> If the Studio build lacks WebSocket support (`CreateWebStreamClient` missing), the plugin reports
> it and asks the user to enable it in **File ▸ Beta Features** — there is no API to enable a Studio
> beta feature from code.

## Error codes

`PATH_DENIED`, `PATH_NOT_FOUND`, `INVALID_CLASS`, `PROP_ERROR`, `INVALID_ARGS`,
`UNKNOWN_TOOL`, `LUAU_ERROR`.
