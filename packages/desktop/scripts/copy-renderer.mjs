// 把渲染进程静态文件复制到 dist/renderer。
import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url)) + "/..";
const src = join(root, "src", "renderer");
const dest = join(root, "dist", "renderer");

await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });
console.log(`Copied renderer -> ${dest}`);

// 托盘图标等资源（运行时用 nativeImage 从 dist/assets 加载；不复制 .svg 源）。
const assetsSrc = join(root, "src", "assets");
const assetsDest = join(root, "dist", "assets");
await mkdir(assetsDest, { recursive: true });
await cp(assetsSrc, assetsDest, {
  recursive: true,
  filter: (p) => !p.endsWith(".svg"),
});
console.log(`Copied assets -> ${assetsDest}`);
