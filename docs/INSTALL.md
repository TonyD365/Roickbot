# Install & setup

## 1. Install the desktop app

Download the installer for your platform from the
[Releases](https://github.com/tonyd365/roickbot/releases) page:

- **Windows**: `.exe` (x64 / arm64)
- **macOS**: `.dmg` (Apple Silicon arm64 / Intel x64)

The apps are not yet code-signed, so on first launch you may need to bypass Gatekeeper (macOS:
right-click → Open) or SmartScreen (Windows: More info → Run anyway).

## 2. Start the service and connect Claude Code

1. Open the app and click **Start service**.
2. Click **Install MCP config** — this writes the `roickbot` server into your Claude Code
   config (`~/.claude.json`) pointing at `http://127.0.0.1:7331/mcp` with your token.
3. Restart Claude Code so it picks up the new MCP server.

You can also configure it manually; see [`.mcp.json.example`](../.mcp.json.example).

## 3. Install the Studio plugin

1. In the app, if the plugin is offline, click **Install plugin** and choose where to save
   `Roickbot.rbxmx`. The simplest location is your Studio **Plugins** folder:
   - Windows: `%LOCALAPPDATA%\Roblox\Plugins`
   - macOS: `~/Documents/Roblox/Plugins`
   (Or in Studio, right-click the model and choose *Save as Local Plugin*.)
2. Restart Studio (or it will load on next launch).

## 4. Enable HTTP and pair

1. In Studio's **Command Bar**, run once per place:
   ```lua
   game:GetService("HttpService").HttpEnabled = true
   ```
2. Open the **Roickbot** plugin panel (toolbar button).
3. Copy the **token** from the desktop app, paste it into the plugin, and click **Connect**.
   The plugin remembers the token and auto-connects next time.

## 5. Verify

In Claude Code, ask it to call the `health` tool — it should report
`pluginConnected: true`. Then try `get_tree` on `Workspace`.

## Running from source

```bash
npm install
npm run build:plugin     # needs Rojo (plugin/aftman.toml)
npm run build:core
npm run build:desktop
npm start --workspace packages/desktop
```
