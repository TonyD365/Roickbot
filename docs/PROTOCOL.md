# Bridge protocol

The desktop app hosts one HTTP server on `127.0.0.1:<port>` (default `7331`). Every endpoint is
behind the auth middleware described in [SECURITY.md](SECURITY.md).

## Endpoints

| Method | Path | Caller | Purpose |
| --- | --- | --- | --- |
| any | `/mcp` | Claude Code | MCP Streamable HTTP endpoint (stateful sessions). |
| GET | `/poll?sessionId=<id>` | Studio plugin | Long-poll for the next command. `200` + envelope, or `204` after ~25s. |
| POST | `/response` | Studio plugin | Return a command result. |
| POST | `/handshake` | Studio plugin | Pair / announce. Returns protocol + server version. |
| GET | `/health` | diagnostics | `{ ok, serverVersion, pluginConnected, queueDepth }`. |

## Command envelope (server → plugin)

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

## Response envelope (plugin → server)

```json
{ "id": "uuid", "ok": true, "result": { "path": "Workspace/Part", "className": "Part" } }
```
or
```json
{ "id": "uuid", "ok": false, "error": { "code": "PATH_DENIED", "message": "..." } }
```

## Concurrency & timeouts

- Commands run **serially** in the plugin (the DataModel is single-threaded and HttpService
  allows only ~3 in-flight requests). The server keeps a FIFO queue and an in-flight map.
- One outstanding `/poll` per session; on `204` the plugin re-polls immediately (this doubles as
  a heartbeat — no poll for >40s marks the plugin offline).
- Each command has a server-side deadline (default 15s, longer for `run_luau`); late responses are
  dropped.

## Error codes

`PATH_DENIED`, `PATH_NOT_FOUND`, `INVALID_CLASS`, `PROP_ERROR`, `INVALID_ARGS`,
`UNKNOWN_TOOL`, `LUAU_ERROR`.
