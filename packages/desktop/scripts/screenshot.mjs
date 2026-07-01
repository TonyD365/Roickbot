// 开发用：无头启动 app 并截一张主窗口的图，用于 UI 迭代。
// 用法：node scripts/screenshot.mjs [outPath]
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(process.argv[2] || join(appDir, "ui-screenshot.png"));

const child = spawn("xvfb-run", ["-a", electronPath, appDir, "--no-sandbox", "--disable-gpu"], {
  cwd: appDir,
  env: { ...process.env, ROICKBOT_DEBUG: "0", ROICKBOT_SCREENSHOT: out },
  detached: true,
});

let done = false;
const finish = (code, msg) => {
  if (done) return;
  done = true;
  console.log(msg);
  try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ }
  setTimeout(() => process.exit(code), 200);
};

const scan = (d) => {
  const s = d.toString();
  process.stdout.write(s);
  if (s.includes("[main] screenshot saved")) {
    setTimeout(() => finish(existsSync(out) ? 0 : 1, existsSync(out) ? `Saved ${out}` : "screenshot missing"), 200);
  }
};
child.stdout.on("data", scan);
child.stderr.on("data", scan);
setTimeout(() => finish(1, "timed out"), 30000);
