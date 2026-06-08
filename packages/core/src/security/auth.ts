// 本地服务鉴权：防止恶意网页通过 localhost CSRF / DNS-rebinding 攻击本地桥。
//
// 任何网页都能向 127.0.0.1:<port> 发请求，因此每个请求都必须满足：
//   1. 携带正确的 Bearer token（只显示在原生 App 里，网页拿不到）。
//   2. Host 头精确匹配 127.0.0.1:<port> 或 localhost:<port>（防 DNS-rebinding）。
//   3. 不带浏览器 Origin 头（合法客户端 Claude Code / Roblox 都不带）。
//   4. 携带自定义头 X-Roblox-MCP: 1（跨站简单请求无法设置而不触发预检）。
// 且服务只绑定 127.0.0.1，绝不 0.0.0.0；绝不开放宽松 CORS。

import { randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import type { IncomingMessage } from "node:http";

export const REQUIRED_HEADER = "x-roblox-mcp";

export interface AuthConfig {
  token: string;
  port: number;
}

export interface AuthResult {
  ok: boolean;
  status?: number;
  message?: string;
}

/** 生成一个新的加密随机 token。 */
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/** 从文件读取 token；不存在则生成并以 0600 权限写入。 */
export async function loadOrCreateToken(tokenPath: string): Promise<string> {
  try {
    const existing = (await fs.readFile(tokenPath, "utf8")).trim();
    if (existing.length >= 32) return existing;
  } catch {
    // 文件不存在，往下生成。
  }
  const token = generateToken();
  await fs.mkdir(dirname(tokenPath), { recursive: true });
  await fs.writeFile(tokenPath, token, { encoding: "utf8", mode: 0o600 });
  try {
    await fs.chmod(tokenPath, 0o600);
  } catch {
    // Windows 上 chmod 可能无效，忽略。
  }
  return token;
}

/** 常量时间字符串比较，防时序攻击。 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}

/**
 * 校验一个入站请求是否合法。按固定顺序检查，任一不过即拒绝。
 */
export function authorizeRequest(req: IncomingMessage, cfg: AuthConfig): AuthResult {
  const headers = req.headers;

  // 1. 拒绝任何带浏览器 Origin 的请求。
  if (headers.origin) {
    return { ok: false, status: 403, message: "Cross-origin requests are not allowed" };
  }

  // 2. Host 必须精确匹配本地回环地址 + 端口。
  const host = (headers.host ?? "").toLowerCase();
  const allowedHosts = [`127.0.0.1:${cfg.port}`, `localhost:${cfg.port}`];
  if (!allowedHosts.includes(host)) {
    return { ok: false, status: 403, message: "Invalid Host header" };
  }

  // 3. 自定义必需头。
  const marker = headers[REQUIRED_HEADER];
  if (marker !== "1") {
    return { ok: false, status: 403, message: "Missing required header" };
  }

  // 4. Bearer token。
  const token = bearer(headers.authorization);
  if (!token || !safeEqual(token, cfg.token)) {
    return { ok: false, status: 401, message: "Invalid or missing token" };
  }

  return { ok: true };
}
