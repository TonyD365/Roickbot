// 基准测试：测量桥的命令热路径（dispatch -> 队列 -> 插件取走 -> 回传 -> resolve）。
// 直接驱动 CommandQueue（进程内模拟插件），不经任何网络传输 —— 这样既稳定无噪声，
// 又与传输实现（长轮询 / WebSocket）解耦，因此可同时跑在 base 和本 PR 的 core 上对比。
//
// 输出：顺序往返延迟的百分位 + 串行吞吐量。CI 中会写入 job summary 和 bench-results.json。

import { CommandQueue } from "./packages/core/dist/index.js";
import { writeFileSync, appendFileSync } from "node:fs";

const SEQ_N = Number(process.env.BENCH_SEQ) || 300; // 顺序延迟样本数
const THRPUT_N = Number(process.env.BENCH_THROUGHPUT) || 2000; // 吞吐量命令数
const SESSION = "bench-session";

const queue = new CommandQueue();
queue.setConnectedSession(SESSION);

// 进程内"假插件"：不断从队列取命令并立即回传一个固定结果。
let pluginRunning = true;
const pluginLoop = (async () => {
  while (pluginRunning) {
    const env = await queue.poll(SESSION);
    if (!env) continue;
    queue.resolveResponse({ id: env.id, ok: true, result: { ok: true, tool: env.tool } });
  }
})();

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
queue.shutdown();
await Promise.race([pluginLoop, new Promise((r) => setTimeout(r, 500))]);

const results = { timestamp: new Date().toISOString(), node: process.version, sequential: seq, throughput: thr };

console.log("\n=== Bridge benchmark ===");
console.log("Sequential round-trip latency (ms):");
console.table([seq]);
console.log("Serial throughput:");
console.table([thr]);

const outPath = process.env.BENCH_OUT || "bench-results.json";
writeFileSync(outPath, JSON.stringify(results, null, 2));

const md = `### Bridge benchmark

Command hot path: \`dispatch → queue → plugin takes command → response → resolve\`, with an in-process simulated plugin (no Roblox Studio, no network transport).

**Sequential round-trip latency** (${seq.samples} samples)

| mean | p50 | p90 | p99 | min | max |
| --- | --- | --- | --- | --- | --- |
| ${seq.meanMs} ms | ${seq.p50Ms} ms | ${seq.p90Ms} ms | ${seq.p99Ms} ms | ${seq.minMs} ms | ${seq.maxMs} ms |

**Serial throughput**: ${thr.opsPerSec} ops/sec (${thr.commands} commands in ${thr.wallMs} ms)

_Node ${results.node}. Measures the local command queue only; a real Studio plugin adds DataModel + WebSocket time._
`;

// 写到文件供 PR 评论使用，并（在 CI 中）追加到 job summary。
writeFileSync("bench-summary.md", md);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}

console.log(`\nWrote ${outPath} and bench-summary.md`);
process.exit(0);
