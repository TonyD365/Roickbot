// 无头启动自检：用 xvfb 启动打包前的 Electron app，捕获主/渲染进程输出，
// 确认 preload 注入、core 加载成功，且没有致命错误（崩溃 / 渲染语法错误等）。
// 用法：先 build:core + build:desktop，再 node scripts/smoke-app.mjs

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const electronPath = require("electron"); // 解析为 electron 二进制路径
const appDir = join(dirname(fileURLToPath(import.meta.url)), ".."); // packages/desktop

const TIMEOUT_MS = 30_000;
const SUCCESS = ["[preload] api exposed", "[main] core service loaded"];
const FATAL = [
  "Uncaught",
  "has already been declared",
  "A JavaScript error occurred",
  "Cannot destructure",
  "render-process-gone",
  "did-fail-load",
  "Cannot find module",
  "preload-error",
];

console.log(`Launching app headlessly: ${electronPath} ${appDir}`);

// 用 xvfb-run 提供虚拟显示；electron app 不会自己退出，靠本脚本判定后杀掉整个进程组。
// --no-sandbox / --disable-gpu：便于在 CI / root 容器的无头环境里启动。
const child = spawn("xvfb-run", ["-a", electronPath, appDir, "--no-sandbox", "--disable-gpu"], {
  cwd: appDir,
  env: { ...process.env, CLAUDE_RBX_DEBUG: "0" },
  detached: true,
});

let output = "";
let settled = false;

function finish(code, reason) {
  if (settled) return;
  settled = true;
  console.log(`\n--- self-test ${code === 0 ? "PASSED" : "FAILED"}: ${reason} ---`);
  try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
  setTimeout(() => process.exit(code), 300);
}

function scan(chunk) {
  output += chunk;
  process.stdout.write(chunk);
  for (const f of FATAL) {
    if (output.includes(f)) return finish(1, `fatal marker detected: "${f}"`);
  }
  if (SUCCESS.every((s) => output.includes(s))) {
    finish(0, "preload + core service initialized with no fatal errors");
  }
}

child.stdout.on("data", (d) => scan(d.toString()));
child.stderr.on("data", (d) => scan(d.toString()));
child.on("error", (e) => finish(1, `failed to spawn: ${e.message}`));
child.on("exit", (code) => {
  if (!settled) finish(code === 0 ? 1 : 1, `app exited early (code ${code}) before success markers`);
});

setTimeout(() => finish(1, `timed out after ${TIMEOUT_MS}ms without success markers`), TIMEOUT_MS);
