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
