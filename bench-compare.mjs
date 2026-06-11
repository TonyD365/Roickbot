// 对比两次基准结果（base vs 本 PR），生成"是否拖慢"的对比表。
// 用法：node bench-compare.mjs <base.json> <head.json>
// 两次跑在同一 runner 上背靠背执行，减少机器噪声。

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";

const [, , basePath, headPath] = process.argv;
const base = JSON.parse(readFileSync(basePath, "utf8"));
const head = JSON.parse(readFileSync(headPath, "utf8"));

// 触发"疑似回归"的阈值（百分比）。微基准有噪声，阈值放宽些。
const REGRESS_PCT = 20;

function pct(oldV, newV) {
  if (oldV === 0) return 0;
  return ((newV - oldV) / oldV) * 100;
}

// 延迟：越小越好。
function latRow(label, oldV, newV) {
  const d = pct(oldV, newV);
  const arrow = d > 1 ? "🔺" : d < -1 ? "🔻" : "▪️";
  const sign = d >= 0 ? "+" : "";
  return `| ${label} | ${oldV} ms | ${newV} ms | ${sign}${d.toFixed(1)}% ${arrow} |`;
}

// 吞吐：越大越好。
function thrRow(label, oldV, newV) {
  const d = pct(oldV, newV);
  const arrow = d > 1 ? "🔻 worse" : d < -1 ? "" : "▪️";
  // 对吞吐，正变化是更好；这里改成更直观的措辞。
  const better = d >= 0 ? "🔺 better" : "🔻 worse";
  const sign = d >= 0 ? "+" : "";
  return `| ${label} | ${oldV} ops/s | ${newV} ops/s | ${sign}${d.toFixed(1)}% ${better} |`;
}

const latP50 = pct(base.sequential.p50Ms, head.sequential.p50Ms);
const latP99 = pct(base.sequential.p99Ms, head.sequential.p99Ms);
const thrDelta = pct(base.throughput.opsPerSec, head.throughput.opsPerSec);

const regressed = latP50 > REGRESS_PCT || latP99 > REGRESS_PCT || thrDelta < -REGRESS_PCT;

const verdict = regressed
  ? `> ⚠️ **Possible regression** — latency or throughput moved by more than ${REGRESS_PCT}%. Please review whether this PR slows down the bridge.`
  : `> ✅ **No significant change** — the bridge hot path is within ±${REGRESS_PCT}% of \`main\`.`;

const md = `### Bridge benchmark — this PR vs base (\`main\`)

Same-runner, back-to-back run of the command hot path (\`dispatch → queue → plugin takes command → response → resolve\`) with an in-process simulated plugin.

**Sequential round-trip latency** (smaller is better)

| metric | base | this PR | change |
| --- | --- | --- | --- |
${latRow("p50", base.sequential.p50Ms, head.sequential.p50Ms)}
${latRow("p90", base.sequential.p90Ms, head.sequential.p90Ms)}
${latRow("p99", base.sequential.p99Ms, head.sequential.p99Ms)}
${latRow("mean", base.sequential.meanMs, head.sequential.meanMs)}

**Serial throughput** (bigger is better)

| metric | base | this PR | change |
| --- | --- | --- | --- |
${thrRow("ops/sec", base.throughput.opsPerSec, head.throughput.opsPerSec)}

${verdict}

_Microbenchmark — small deltas (a few %) are runner noise. Measures the local bridge only; a real Studio plugin adds DataModel + network time. Node base ${base.node} / head ${head.node}._
`;

writeFileSync("bench-summary.md", md);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}
console.log(md);

if (regressed) {
  console.log("::warning::Bridge benchmark shows a possible performance regression vs main.");
}
