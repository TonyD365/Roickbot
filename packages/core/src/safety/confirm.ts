// 破坏性操作的二次确认（面向 Claude 的自律，不是用户弹窗）。
//
// 流程：Claude 第一次不带 confirm 调用破坏性工具 → 服务器先做一次 dryRun 预览，
// 返回 { requiresConfirmation, confirmToken, preview }；Claude 读完预览后带该
// token 再调一次 → 服务器校验 token（绑定 args 哈希、单次、60s 过期）后真正执行。

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_MS = 60_000;

interface StoredToken {
  argsHash: string;
  expiresAt: number;
}

/** 对工具参数做稳定哈希（忽略 confirm 字段本身）。 */
export function hashArgs(args: unknown): string {
  const clone =
    args && typeof args === "object" ? { ...(args as Record<string, unknown>) } : args;
  if (clone && typeof clone === "object") {
    delete (clone as Record<string, unknown>).confirm;
  }
  return createHash("sha256").update(JSON.stringify(clone ?? null)).digest("hex");
}

export class ConfirmStore {
  private tokens = new Map<string, StoredToken>();

  /** 为一组参数签发一个一次性确认 token。 */
  issue(args: unknown): string {
    const token = randomBytes(18).toString("hex");
    this.tokens.set(token, { argsHash: hashArgs(args), expiresAt: Date.now() + TOKEN_TTL_MS });
    return token;
  }

  /** 校验并消费一个 token；通过返回 true。 */
  consume(token: string, args: unknown): boolean {
    const entry = this.tokens.get(token);
    if (!entry) return false;
    this.tokens.delete(token); // 单次有效。
    if (Date.now() > entry.expiresAt) return false;
    const expected = Buffer.from(entry.argsHash, "hex");
    const actual = Buffer.from(hashArgs(args), "hex");
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  }

  /** 定期清理过期 token（可选调用）。 */
  sweep(): void {
    const now = Date.now();
    for (const [token, entry] of this.tokens) {
      if (now > entry.expiresAt) this.tokens.delete(token);
    }
  }
}
