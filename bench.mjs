// 基准测试：测量桥的命令热路径（dispatch -> 队列 -> 插件经 HTTP 长轮询 -> 回传 -> resolve）。
// 用一个"假插件"在本地通过 HTTP 轮询/回传，模拟 Studio 端，但不依赖真实 Studio。
//
// 输出：顺序往返延迟的百分位 + 串行吞吐量。CI 中会写入 job summary 和 bench-results.json。

import { CommandQueue, BridgeServer, ConfirmStore, generateToken } from "./packages/core/dist/index.js";
import { writeFileSync, appendFileSync } from "node:fs";

const PORT = Number(process.env.BENCH_PORT) || 7399;
const SEQ_N = Number(process.env.BENCH_SEQ) || 300; // 顺序延迟样本数
const THRPUT_N = Number(process.env.BENCH_THROUGHPUT) || 2000; // 吞吐量命令数
const SESSION = "bench-session";
const base = `http://127.0.0.1:${PORT}`;

const token = generateToken();
const queue = new CommandQueue();
const bridge = new BridgeServer({ port: PORT, token, queue, confirm: new ConfirmStore() });
await bridge.start();

const authHeaders = {
  Authorization: `Bearer ${token}`,
  "X-Roblox-MCP": "1",
  "Content-Type": "application/json",
};

// 假插件：持续长轮询，拿到命令立即回传一个固定结果。
let pluginRunning = true;
const pluginLoop = (async () => {
  while (pluginRunning) {
    let resp;
    try {
      resp = await fetch(`${base}/poll?sessionId=${SESSION}`, { headers: authHeaders });
    } catch {
      continue;
    }
    if (resp.status === 204) continue;
    if (resp.status !== 200) break;
    const env = await resp.json();
    await fetch(`${base}/response`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ id: env.id, ok: true, result: { ok: true, tool: env.tool } }),
    }).catch(() => {});
  }
})();

// 标记插件在线（让 dispatch 不被离线检查拦截）。
queue.setConnectedSession(SESSION);

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function warmup(n) {
  for (let i = 0; i < n; i++) await queue.dispatch("get_selection", {});
}

async function sequentialLatency(n) {
  const lat = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    await queue.dispatch("get_selection", {});
    lat.push(performance.now() - t);
  }
  lat.sort((a, b) => a - b);
  const mean = lat.reduce((s, x) => s + x, 0) / lat.length;
  return {
    samples: lat.length,
    meanMs: +mean.toFixed(3),
    p50Ms: +percentile(lat, 50).toFixed(3),
    p90Ms: +percentile(lat, 90).toFixed(3),
    p99Ms: +percentile(lat, 99).toFixed(3),
    minMs: +lat[0].toFixed(3),
    maxMs: +lat[lat.length - 1].toFixed(3),
  };
}

async function throughput(n) {
  const t = performance.now();
  const promises = [];
  for (let i = 0; i < n; i++) promises.push(queue.dispatch("get_selection", {}));
  await Promise.all(promises);
  const wallMs = performance.now() - t;
  return { commands: n, wallMs: +wallMs.toFixed(1), opsPerSec: +((n / wallMs) * 1000).toFixed(0) };
}

console.log("Warming up...");
await warmup(50);
console.log(`Measuring sequential latency (${SEQ_N} commands)...`);
const seq = await sequentialLatency(SEQ_N);
console.log(`Measuring throughput (${THRPUT_N} commands)...`);
const thr = await throughput(THRPUT_N);

pluginRunning = false;
await Promise.race([pluginLoop, new Promise((r) => setTimeout(r, 500))]);
await bridge.stop();

const results = { timestamp: new Date().toISOString(), node: process.version, sequential: seq, throughput: thr };

console.log("\n=== Bridge benchmark ===");
console.log("Sequential round-trip latency (ms):");
console.table([seq]);
console.log("Serial throughput:");
console.table([thr]);

writeFileSync("bench-results.json", JSON.stringify(results, null, 2));

if (process.env.GITHUB_STEP_SUMMARY) {
  const md = `### Bridge benchmark

Command hot path: \`dispatch → queue → plugin poll (HTTP) → response (HTTP) → resolve\`, with a simulated plugin (no Roblox Studio).

**Sequential round-trip latency** (${seq.samples} samples)

| mean | p50 | p90 | p99 | min | max |
| --- | --- | --- | --- | --- | --- |
| ${seq.meanMs} ms | ${seq.p50Ms} ms | ${seq.p90Ms} ms | ${seq.p99Ms} ms | ${seq.minMs} ms | ${seq.maxMs} ms |

**Serial throughput**: ${thr.opsPerSec} ops/sec (${thr.commands} commands in ${thr.wallMs} ms)

_Node ${results.node}. Measures the local bridge only; a real Studio plugin adds DataModel + network time._
`;
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}

console.log("\nWrote bench-results.json");
process.exit(0);
