// 命令队列：把 MCP 工具调用串行投递给 Studio 插件，并用长轮询回收结果。
//
// 设计要点：
// - 命令在插件侧串行执行（DataModel 单线程 + HttpService 限制），所以这里
//   维护一个 FIFO pending 队列。
// - 插件用单条 GET /poll 长轮询拉取下一条命令；若暂时没有命令，poll 在
//   pollTimeoutMs 后返回 null（HTTP 204），插件立即重新 poll（兼作心跳）。
// - 每条命令有一个硬超时；超时则 reject 对应 Promise 并丢弃迟到的响应。

import { randomUUID } from "node:crypto";
import {
  CommandEnvelope,
  CommandError,
  ResponseEnvelope,
} from "./envelope.js";
import { PROTOCOL_VERSION } from "./envelope.js";

export interface DispatchOptions {
  dryRun?: boolean;
  /** 服务器侧硬超时（毫秒）。 */
  deadlineMs?: number;
}

interface InflightEntry {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** dispatch 在插件返回 ok:false 时抛出的错误类型，携带结构化 code。 */
export class CommandFailure extends Error {
  code: string;
  constructor(err: CommandError) {
    super(err.message);
    this.name = "CommandFailure";
    this.code = err.code;
    this.stack = err.stack ?? this.stack;
  }
}

const DEFAULT_DEADLINE_MS = 15_000;
const DEFAULT_POLL_TIMEOUT_MS = 25_000;
/** 超过该时长没有 poll，则认为插件离线。 */
const PLUGIN_OFFLINE_MS = 40_000;

export class CommandQueue {
  private pending: CommandEnvelope[] = [];
  private inflight = new Map<string, InflightEntry>();
  /** 当前停在 /poll 上、等待命令的 resolver（单条）。 */
  private waiter: { resolve: (env: CommandEnvelope | null) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private lastPollAt = 0;
  private connectedSessionId: string | null = null;
  /** 插件 handshake 上报的工具集（用于检测版本不一致）；null 表示未知（旧插件）。 */
  private pluginTools: Set<string> | null = null;

  constructor(private readonly pollTimeoutMs: number = DEFAULT_POLL_TIMEOUT_MS) {}

  /** 由 handshake 调用，标记某个插件会话已配对成功。 */
  setConnectedSession(sessionId: string): void {
    this.connectedSessionId = sessionId;
    this.lastPollAt = Date.now();
  }

  /** 记录插件上报的工具集；不传则视为未知（旧插件，跳过预检）。 */
  setPluginTools(tools: string[] | undefined): void {
    this.pluginTools = tools && tools.length ? new Set(tools) : null;
  }

  /**
   * 插件是否实现某工具。未知（旧插件没上报）时返回 true 以保持兼容，
   * 让 Dispatcher 的 UNKNOWN_TOOL 兜底。
   */
  supportsTool(tool: string): boolean {
    return this.pluginTools === null || this.pluginTools.has(tool);
  }

  /** 插件是否在线（最近有 poll 心跳）。 */
  isPluginConnected(): boolean {
    return this.connectedSessionId !== null && Date.now() - this.lastPollAt < PLUGIN_OFFLINE_MS;
  }

  get queueDepth(): number {
    return this.pending.length;
  }

  /**
   * 投递一条命令给插件并等待结果。
   * 成功返回插件的 result；插件报错则抛 CommandFailure；超时抛 Error。
   */
  dispatch(tool: string, args: unknown, opts: DispatchOptions = {}): Promise<unknown> {
    const env: CommandEnvelope = {
      id: randomUUID(),
      tool,
      args,
      dryRun: opts.dryRun ?? false,
      deadlineMs: opts.deadlineMs ?? DEFAULT_DEADLINE_MS,
      protocol: PROTOCOL_VERSION,
    };

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.inflight.delete(env.id);
        // 同时尝试从 pending 移除（若还没被取走）。
        const idx = this.pending.findIndex((e) => e.id === env.id);
        if (idx >= 0) this.pending.splice(idx, 1);
        reject(new Error(`Timed out waiting for Studio plugin to run "${tool}"`));
      }, env.deadlineMs + 2_000);

      this.inflight.set(env.id, { resolve, reject, timer });
      this.deliver(env);
    });
  }

  /** 若有停泊的 poll 就直接交付，否则入队。 */
  private deliver(env: CommandEnvelope): void {
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      clearTimeout(w.timer);
      w.resolve(env);
    } else {
      this.pending.push(env);
    }
  }

  /**
   * 插件长轮询：返回下一条命令；若 pollTimeoutMs 内无命令返回 null。
   * 调用即视为一次心跳。
   */
  poll(sessionId: string): Promise<CommandEnvelope | null> {
    this.lastPollAt = Date.now();
    if (this.connectedSessionId === null) this.connectedSessionId = sessionId;

    const next = this.pending.shift();
    if (next) return Promise.resolve(next);

    // 没有命令：停泊一个 waiter（仅保留最新的一个）。
    if (this.waiter) {
      clearTimeout(this.waiter.timer);
      this.waiter.resolve(null);
      this.waiter = null;
    }
    return new Promise<CommandEnvelope | null>((resolve) => {
      const timer = setTimeout(() => {
        if (this.waiter && this.waiter.resolve === resolve) this.waiter = null;
        resolve(null);
      }, this.pollTimeoutMs);
      this.waiter = { resolve, timer };
    });
  }

  /** 插件回传结果，解析对应的 inflight Promise。 */
  resolveResponse(res: ResponseEnvelope): boolean {
    const entry = this.inflight.get(res.id);
    if (!entry) return false; // 迟到或未知 id，丢弃。
    this.inflight.delete(res.id);
    clearTimeout(entry.timer);
    if (res.ok) {
      entry.resolve(res.result ?? null);
    } else {
      entry.reject(new CommandFailure(res.error ?? { code: "UNKNOWN", message: "Unknown plugin error" }));
    }
    return true;
  }

  /** 关停：拒绝所有等待中的命令并清理。 */
  shutdown(): void {
    if (this.waiter) {
      clearTimeout(this.waiter.timer);
      this.waiter.resolve(null);
      this.waiter = null;
    }
    for (const [, entry] of this.inflight) {
      clearTimeout(entry.timer);
      entry.reject(new Error("Server shutting down"));
    }
    this.inflight.clear();
    this.pending = [];
    this.connectedSessionId = null;
    this.pluginTools = null;
  }
}
