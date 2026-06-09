# Use with other AI clients

This is a standard **MCP (Model Context Protocol)** server, so it isn't tied to Claude — it works
with **any MCP client that can connect to a remote (HTTP) MCP server and send custom headers**
(Claude Code, Gemini CLI, Cursor, VS Code / Copilot, Cline, Windsurf, Zed, …).

The connection is always the same:

- **Endpoint:** `http://127.0.0.1:7331/mcp`
- **Headers:** `Authorization: Bearer <token>` and `X-Roblox-MCP: 1`
- **Token:** shown in the desktop app (copy it there)

> First do the one-time setup in [INSTALL.md](INSTALL.md): start the service, install the Studio
> plugin, enable HTTP, and pair. Then point any client below at the endpoint above.

---

## Google Gemini (free tier) — recommended free option

The **Gemini CLI** is free, has a generous free tier, and is good at tool use.

1. Install the Gemini CLI (`npm install -g @google/gemini-cli`) and sign in.
2. Add the server to `~/.gemini/settings.json` (global) or `.gemini/settings.json` (per project):

```json
{
  "mcpServers": {
    "roblox-studio": {
      "httpUrl": "http://127.0.0.1:7331/mcp",
      "headers": {
        "Authorization": "Bearer PASTE_TOKEN_FROM_THE_APP",
        "X-Roblox-MCP": "1"
      }
    }
  }
}
```

3. Restart Gemini CLI, then ask it to call the `health` tool — it should report
   `pluginConnected: true`.

## Cursor

Add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

```json
{
  "mcpServers": {
    "roblox-studio": {
      "url": "http://127.0.0.1:7331/mcp",
      "headers": { "Authorization": "Bearer PASTE_TOKEN", "X-Roblox-MCP": "1" }
    }
  }
}
```

## VS Code (GitHub Copilot agent mode)

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "roblox-studio": {
      "type": "http",
      "url": "http://127.0.0.1:7331/mcp",
      "headers": { "Authorization": "Bearer PASTE_TOKEN", "X-Roblox-MCP": "1" }
    }
  }
}
```

## Claude Code / Claude Desktop

Use the app's **Install MCP config** button, or add it manually (see
[`.mcp.json.example`](../.mcp.json.example)):

```json
{
  "mcpServers": {
    "roblox-studio": {
      "type": "http",
      "url": "http://127.0.0.1:7331/mcp",
      "headers": { "Authorization": "Bearer PASTE_TOKEN", "X-Roblox-MCP": "1" }
    }
  }
}
```

## Cline / Roo Code / Continue (VS Code) — works with free local models

These free extensions support MCP and can be driven by **free local models via Ollama**
(e.g. `qwen2.5-coder`, `llama3.1`) or a free API tier. Add a remote/SSE MCP server pointing at the
endpoint + headers above (the exact field names vary by extension; use `url` + `headers`).

---

## Free model options

| Option | Cost | Notes |
| --- | --- | --- |
| **Gemini CLI** (Gemini 2.x Flash) | Free tier | Best free pick — capable at multi-step tool use. |
| **Ollama** (local) via Cline/Continue/Roo | 100% free | Private, no quota; needs decent hardware; bigger coder models do tool use far better. |
| **GitHub Copilot Free** | Free tier | Agent mode + MCP; limited monthly requests. |
| **OpenRouter** `:free` models | Free | Quality varies. |

These tools are multi-step and need precise tool calls, so **stronger models behave more
reliably**. Among free choices, Gemini's free tier is the sweet spot.

## Compatibility note

This server uses **Streamable HTTP** transport with a Bearer token and a required custom header.

- ✅ Clients that support remote/HTTP MCP **and** custom headers (Claude Code, Gemini CLI, Cursor,
  VS Code, …) connect directly.
- ⚠️ Clients that **only** support stdio MCP, or can't set custom headers, can't connect yet — open
  an issue if you need a stdio adapter.
