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
  timer: ReturnType<typeof setTimeout> | null;
  env: CommandEnvelope;
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
/** 超过该时长没有 poll，则认为插件离线。需大于最长命令耗时（run_luau 默认 30s），否则执行长命令时会误判离线。 */
const PLUGIN_OFFLINE_MS = 75_000;
const LOG_MAX = 50;
const MAX_QUEUE_DEPTH = 32;

/** 命令日志条目（供桌面 App 的活动面板展示）。 */
export interface CommandLogEntry {
  id: string;
  tool: string;
  channel: string;
  at: number;
  ok?: boolean;
  error?: string;
}

export class CommandQueue {
  private pending: CommandEnvelope[] = [];
  private inflight = new Map<string, InflightEntry>();
  /** 已发给插件、尚未收到 response 的唯一命令。 */
  private activeId: string | null = null;
  /** 活动命令超时后不再下发，避免与 Studio 中可能仍在运行的回调并发。 */
  private needsReconnect = false;
  /** 当前停在 /poll 上、等待命令的 resolver（单条）。 */
  private waiter: { resolve: (env: CommandEnvelope | null) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private lastPollAt = 0;
  private connectedSessionId: string | null = null;
  /** 插件 handshake 上报的工具集（用于检测版本不一致）；null 表示未知（旧插件）。 */
  private pluginTools: Set<string> | null = null;
  /** 命令日志（最近 LOG_MAX 条）。 */
  private log: CommandLogEntry[] = [];
  private logById = new Map<string, CommandLogEntry>();

  constructor(
    private readonly pollTimeoutMs: number = DEFAULT_POLL_TIMEOUT_MS,
    private readonly channel: string = "plugin",
  ) {}

  /** 最近的命令日志（最新在前）。 */
  recentCommands(n = LOG_MAX): CommandLogEntry[] {
    return this.log.slice(-n).reverse();
  }

  private record(entry: CommandLogEntry): void {
    this.log.push(entry);
    this.logById.set(entry.id, entry);
    if (this.log.length > LOG_MAX) {
      const dropped = this.log.shift();
      if (dropped) this.logById.delete(dropped.id);
    }
  }

  /** 由 handshake 调用，标记某个插件会话已配对成功。 */
  setConnectedSession(sessionId: string): void {
    this.connectedSessionId = sessionId;
    this.lastPollAt = Date.now();
    this.needsReconnect = false;
  }

  /** WS 连接关闭时调用：明确标记断开（不必等心跳超时）。 */
  markDisconnected(): void {
    this.connectedSessionId = null;
    this.lastPollAt = 0;
    this.pluginTools = null;
    this.needsReconnect = false;
    this.rejectAll(new Error("Studio plugin disconnected"));
    // 唤醒停泊的 waiter，让 WS 推送循环及时退出。
    if (this.waiter) {
      clearTimeout(this.waiter.timer);
      this.waiter.resolve(null);
      this.waiter = null;
    }
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

  /** 插件是否在线：最近有 poll 心跳，或当前有命令在执行中（执行长命令时不轮询，属正常）。 */
  isPluginConnected(): boolean {
    if (this.connectedSessionId === null || this.needsReconnect) return false;
    if (this.inflight.size > 0) return true; // 正在执行命令 = 插件活着，只是忙。
    return Date.now() - this.lastPollAt < PLUGIN_OFFLINE_MS;
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

    this.record({ id: env.id, tool, channel: this.channel, at: Date.now() });

    if (this.needsReconnect) {
      const error = new Error("Studio plugin did not finish its previous command. Reconnect the plugin before sending more commands.");
      const entry = this.logById.get(env.id);
      if (entry) { entry.ok = false; entry.error = error.message; }
      return Promise.reject(error);
    }
    if (this.pending.length >= MAX_QUEUE_DEPTH) {
      const error = new Error("Studio command queue is full. Wait for the current commands to finish before continuing.");
      const entry = this.logById.get(env.id);
      if (entry) { entry.ok = false; entry.error = error.message; }
      return Promise.reject(error);
    }

    return new Promise<unknown>((resolve, reject) => {
      this.inflight.set(env.id, { resolve, reject, timer: null, env });
      this.pending.push(env);
      this.flush();
    });
  }

  /** 只有没有活动命令时才能把下一条交给插件，保证严格串行。 */
  private flush(): void {
    if (this.activeId || !this.waiter || this.needsReconnect) return;
    const env = this.pending.shift();
    if (!env) return;
    const entry = this.inflight.get(env.id);
    if (!entry) {
      this.flush();
      return;
    }
    this.activeId = env.id;
    entry.timer = setTimeout(() => this.timeoutActive(env.id), env.deadlineMs + 2_000);
    const waiter = this.waiter;
    this.waiter = null;
    clearTimeout(waiter.timer);
    waiter.resolve(env);
  }

  private timeoutActive(id: string): void {
    const entry = this.inflight.get(id);
    if (!entry) return;
    this.needsReconnect = true;
    this.activeId = null;
    const error = new Error(`Timed out waiting for Studio plugin to run "${entry.env.tool}". Reconnect the plugin before continuing.`);
    const logEntry = this.logById.get(id);
    if (logEntry) { logEntry.ok = false; logEntry.error = "timed out"; }
    this.rejectAll(error);
  }

  private rejectAll(error: Error): void {
    for (const [id, entry] of this.inflight) {
      if (entry.timer) clearTimeout(entry.timer);
      const logEntry = this.logById.get(id);
      if (logEntry && logEntry.ok === undefined) { logEntry.ok = false; logEntry.error = error.message; }
      entry.reject(error);
    }
    this.inflight.clear();
    this.pending = [];
    this.activeId = null;
  }

  /**
   * 插件长轮询：返回下一条命令；若 pollTimeoutMs 内无命令返回 null。
   * 调用即视为一次心跳。
   */
  poll(sessionId: string): Promise<CommandEnvelope | null> {
    this.lastPollAt = Date.now();
    if (this.connectedSessionId === null) this.connectedSessionId = sessionId;

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
      this.flush();
    });
  }

  /** 插件回传结果，解析对应的 inflight Promise。 */
  resolveResponse(res: ResponseEnvelope): boolean {
    const entry = this.inflight.get(res.id);
    if (!entry || this.activeId !== res.id) return false; // 迟到、未知或非活动命令。
    this.inflight.delete(res.id);
    if (entry.timer) clearTimeout(entry.timer);
    this.activeId = null;
    const logEntry = this.logById.get(res.id);
    if (logEntry) {
      logEntry.ok = res.ok;
      if (!res.ok) logEntry.error = res.error?.message ?? res.error?.code;
    }
    if (res.ok) {
      entry.resolve(res.result ?? null);
    } else {
      entry.reject(new CommandFailure(res.error ?? { code: "UNKNOWN", message: "Unknown plugin error" }));
    }
    this.flush();
    return true;
  }

  /** 关停：拒绝所有等待中的命令并清理。 */
  shutdown(): void {
    if (this.waiter) {
      clearTimeout(this.waiter.timer);
      this.waiter.resolve(null);
      this.waiter = null;
    }
    this.rejectAll(new Error("Server shutting down"));
    this.connectedSessionId = null;
    this.pluginTools = null;
  }
}
