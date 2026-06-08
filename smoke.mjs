// 烟雾测试：验证桥服务器的鉴权、配对、插件在线检测、以及 MCP initialize。
import { CoreService } from "./packages/core/dist/index.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 7355;
const tokenPath = join(mkdtempSync(join(tmpdir(), "rbxmcp-")), "token");
const svc = new CoreService({ port: PORT, tokenPath });
await svc.start();
const token = svc.getToken();
const base = `http://127.0.0.1:${PORT}`;
const authHeaders = { Authorization: `Bearer ${token}`, "X-Roblox-MCP": "1", "Content-Type": "application/json" };

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  - ${name}`); }
  else { fail++; console.log(`  FAIL- ${name}`); }
}

// 1. 无 token -> 401
let r = await fetch(`${base}/health`, { headers: { "X-Roblox-MCP": "1" } });
check("rejects missing token with 401", r.status === 401);

// 2. 带浏览器 Origin -> 403
r = await fetch(`${base}/health`, { headers: { ...authHeaders, Origin: "https://evil.example" } });
check("rejects browser Origin with 403", r.status === 403);

// 3. 合法 health -> 200, plugin 未连接
r = await fetch(`${base}/health`, { headers: authHeaders });
let body = await r.json();
check("health ok with valid token", r.status === 200 && body.ok === true);
check("plugin not connected before handshake", body.pluginConnected === false);

// 4. 插件 handshake
r = await fetch(`${base}/handshake`, {
  method: "POST", headers: authHeaders,
  body: JSON.stringify({ pluginVersion: "0.1.0", sessionId: "test-session", placeId: 1 }),
});
body = await r.json();
check("handshake succeeds", r.status === 200 && body.ok === true);

// 5. handshake 后 plugin 在线
r = await fetch(`${base}/health`, { headers: authHeaders });
body = await r.json();
check("plugin connected after handshake", body.pluginConnected === true);

// 6. MCP initialize
r = await fetch(`${base}/mcp`, {
  method: "POST",
  headers: { ...authHeaders, Accept: "application/json, text/event-stream" },
  body: JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } },
  }),
});
const sessionId = r.headers.get("mcp-session-id");
const text = await r.text();
check("MCP initialize returns 200", r.status === 200);
check("MCP initialize returns a session id", !!sessionId);
check("MCP initialize advertises server name", text.includes("claude-for-roblox-studio"));

// 7. tools/list（带 session）
r = await fetch(`${base}/mcp`, {
  method: "POST",
  headers: { ...authHeaders, Accept: "application/json, text/event-stream", "mcp-session-id": sessionId ?? "" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
});
const listText = await r.text();
check("tools/list includes create_instance", listText.includes("create_instance"));
check("tools/list includes view_elements", listText.includes("view_elements"));
check("tools/list includes run_simulation", listText.includes("run_simulation"));
check("tools/list includes run_luau", listText.includes("run_luau"));

// 8. 完整命令往返：MCP tools/call -> 队列 -> 模拟插件长轮询 -> 回传结果。
let pluginRunning = true;
const fakePlugin = (async () => {
  while (pluginRunning) {
    let pr;
    try {
      pr = await fetch(`${base}/poll?sessionId=test-session`, { headers: authHeaders });
    } catch {
      continue;
    }
    if (pr.status === 204) continue;
    if (pr.status !== 200) break;
    const env = await pr.json();
    await fetch(`${base}/response`, {
      method: "POST", headers: authHeaders,
      body: JSON.stringify({ id: env.id, ok: true, result: { echoed: env.tool, args: env.args } }),
    });
  }
})();

r = await fetch(`${base}/mcp`, {
  method: "POST",
  headers: { ...authHeaders, Accept: "application/json, text/event-stream", "mcp-session-id": sessionId ?? "" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_selection", arguments: {} } }),
});
const callText = await r.text();
check("tool round-trip routes through the plugin and returns its result",
  callText.includes("echoed") && callText.includes("get_selection"));

pluginRunning = false;
await Promise.race([fakePlugin, new Promise((res) => setTimeout(res, 500))]);

await svc.stop();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
