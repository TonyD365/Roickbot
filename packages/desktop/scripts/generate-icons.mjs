// 从 SVG 源渲染出图标 PNG（提交进仓库，CI 无需 sharp）。
//   - build/icon.png            应用图标（1024，electron-builder 会转成 icns/ico）
//   - src/assets/tray.png       托盘彩色图标（Win/Linux）
//   - src/assets/trayTemplate.png / @2x  macOS 菜单栏模板图（黑+透明）
// 用法：node scripts/generate-icons.mjs        （默认用方案 a）
//       ICON=c node scripts/generate-icons.mjs （切换方案）
//       node scripts/generate-icons.mjs previews  （额外渲染 a/b/c 预览到指定目录）
import sharp from "sharp";
import { readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = join(root, "icons"); // electron-builder buildResources dir (not gitignored)
const assets = join(root, "src", "assets");
mkdirSync(assets, { recursive: true });

const CONCEPTS = { a: "icon.svg", b: "icon-b.svg", c: "icon-c.svg" };
const choice = (process.env.ICON || "a").toLowerCase();
const chosenSvg = readFileSync(join(buildDir, CONCEPTS[choice] || CONCEPTS.a));
const trayTpl = readFileSync(join(assets, "trayTemplate.svg"));

const png = (buf, size) => sharp(buf, { density: 384 }).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png();

// 生产资源（用所选方案）
await png(chosenSvg, 1024).toFile(join(buildDir, "icon.png"));
await png(chosenSvg, 32).toFile(join(assets, "tray.png"));
await png(trayTpl, 16).toFile(join(assets, "trayTemplate.png"));
await png(trayTpl, 32).toFile(join(assets, "trayTemplate@2x.png"));
console.log(`Generated production icons from concept "${choice}".`);

// 预生成 icon.icns / icon.ico 并提交 —— electron-builder 自带的 PNG→icns/ico 转换器
// 会 panic（app-builder index out of range），提供成品即可绕过它。
try {
  const { default: icongen } = await import("icon-gen");
  await icongen(join(buildDir, "icon.png"), buildDir, {
    report: false,
    icns: { name: "icon", sizes: [16, 32, 64, 128, 256, 512, 1024] },
    ico: { name: "icon", sizes: [16, 24, 32, 48, 64, 128, 256] },
  });
  console.log("Generated icon.icns + icon.ico.");
} catch (e) {
  console.warn("icon-gen unavailable; skipped icns/ico:", e.message);
}

// 可选：把三个方案渲染成预览
if (process.argv.includes("previews")) {
  const outDir = process.env.PREVIEW_DIR || join(root, "icon-previews");
  mkdirSync(outDir, { recursive: true });
  for (const [key, file] of Object.entries(CONCEPTS)) {
    await png(readFileSync(join(buildDir, file)), 360).toFile(join(outDir, `icon-${key}.png`));
  }
  console.log(`Wrote previews to ${outDir}`);
}
