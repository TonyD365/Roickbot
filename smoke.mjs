// 烟雾测试：验证桥服务器的鉴权、WebSocket 配对、插件在线检测、MCP、命令往返、agent 通道与事件。
import { CoreService } from "./packages/core/dist/index.js";
import { WebSocket } from "ws";
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 模拟 Studio 端（插件或 agent）通过 WebSocket 连接：握手 + 自动回显命令。
function fakeStudio(role) {
  const query = role === "agent" ? "?role=agent" : "";
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws${query}`, {
    headers: { Authorization: `Bearer ${token}`, "X-Roblox-MCP": "1" },
  });
  ws.on("message", (data) => {
    const m = JSON.parse(data.toString());
    if (m.type === "command") {
      const env = m.payload;
      ws.send(JSON.stringify({ type: "response", id: env.id, ok: true, result: { echoed: env.tool, args: env.args, role } }));
    }
  });
  const opened = new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  const handshake = () =>
    ws.send(JSON.stringify({
      type: "handshake",
      sessionId: `${role}-session`,
      pluginVersion: "0.2.0",
      role: role === "agent" ? "server-agent" : undefined,
    }));
  return { ws, opened, handshake };
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

// 4. 插件 WebSocket 握手
const plugin = fakeStudio("plugin");
await plugin.opened;
plugin.handshake();
await sleep(150);

// 5. 握手后 plugin 在线
r = await fetch(`${base}/health`, { headers: authHeaders });
body = await r.json();
check("plugin connected after WS handshake", body.pluginConnected === true);

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
check("MCP initialize advertises server name", text.includes("roickbot"));

async function callTool(id, name, args) {
  const rr = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { ...authHeaders, Accept: "application/json, text/event-stream", "mcp-session-id": sessionId ?? "" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
  });
  return rr.text();
}

// 7. tools/list（带 session）
r = await fetch(`${base}/mcp`, {
  method: "POST",
  headers: { ...authHeaders, Accept: "application/json, text/event-stream", "mcp-session-id": sessionId ?? "" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
});
const listText = await r.text();
for (const t of [
  "create_instance", "view_elements", "start_test", "run_luau", "get_console_output",
  "build_parts", "set_lighting", "build_gui", "bot_spawn", "bot_see",
  "edit_script_lines", "find_instances", "search_by_property", "get_tagged", "add_tag",
  "search_scripts", "get_script_info", "harness_init", "harness_session_start",
  "harness_feature_update", "fire_signal", "wait_for_event",
]) {
  check(`tools/list includes ${t}`, listText.includes(t));
}

// 8. 命令往返：MCP tools/call -> 队列 -> WS 推给假插件 -> 回传结果。
const callText = await callTool(3, "get_selection", {});
check("tool round-trip routes through the plugin (WS) and returns its result",
  callText.includes("echoed") && callText.includes("get_selection"));

// 9. Harness 工具在 core 本地处理（不经插件）。
const featText = await callTool(10, "harness_feature_update", { title: "Smoke feature", priority: "high" });
check("harness_feature_update creates a feature locally", featText.includes("Smoke feature") && featText.includes("F1"));
const statusText = await callTool(11, "harness_status", {});
check("harness_status reflects the new feature", statusText.includes("Smoke feature"));

// 10. server-agent 通道（WS, role=agent）：验证 fire_signal 路由到它。
const agent = fakeStudio("agent");
await agent.opened;
agent.handshake();
await sleep(150);
const fsText = await callTool(12, "fire_signal", { path: "ReplicatedStorage/Remote", method: "FireAllClients", args: [1] });
check("fire_signal routes to the server-agent WS channel", fsText.includes("agent") && fsText.includes("FireAllClients"));

// 11. 事件：wait_for_event 阻塞等待，插件经 WS 推 event 后被唤醒。
const waitPromise = callTool(13, "wait_for_event", { types: ["runState"], timeoutMs: 5000 });
await sleep(100);
plugin.ws.send(JSON.stringify({ type: "event", event: { type: "runState", state: "Running" } }));
const evText = await waitPromise;
check("wait_for_event resolves when an event is pushed over WS", evText.includes("runState") && evText.includes("Running"));

// 12. WS 关闭 -> 标记离线
plugin.ws.close();
await sleep(150);
r = await fetch(`${base}/health`, { headers: authHeaders });
body = await r.json();
check("plugin marked offline after WS close", body.pluginConnected === false);

agent.ws.close();
await svc.stop();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
