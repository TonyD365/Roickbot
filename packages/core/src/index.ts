// 核心服务入口：把队列、鉴权、确认、HTTP 桥组装成一个可启停的 CoreService。
// 桌面 App 主进程直接引用本模块来启停服务。

import { dirname, join } from "node:path";
import { EventEmitter } from "node:events";
import { CommandQueue } from "./bridge/commandQueue.js";
import { ConfirmStore } from "./safety/confirm.js";
import { BridgeServer } from "./bridge/httpServer.js";
import { Harness } from "./harness/harness.js";
import { loadOrCreateToken, generateToken } from "./security/auth.js";
import type { HandshakeInfo } from "./bridge/envelope.js";

export const DEFAULT_PORT = 7331;

export interface CoreServiceOptions {
  port?: number;
  /** token 持久化文件路径。 */
  tokenPath?: string;
  /** harness 项目记忆 JSON 文件路径（默认与 token 同目录）。 */
  harnessPath?: string;
}

export interface CoreStatus {
  running: boolean;
  port: number;
  pluginConnected: boolean;
  claudeConnected: boolean;
  /** 连上来的 MCP 客户端名（如 "claude-code" / "gemini-cli" / "cursor"），未知则 null。 */
  mcpClient: string | null;
  queueDepth: number;
}

/**
 * 可启停的核心服务。事件：
 *   "status"    状态变化
 *   "handshake" 插件接入 (HandshakeInfo)
 */
export class CoreService extends EventEmitter {
  readonly port: number;
  private readonly tokenPath: string;
  private readonly harness: Harness;
  private token = "";
  private queue: CommandQueue | null = null;
  private confirm: ConfirmStore | null = null;
  private bridge: BridgeServer | null = null;
  private running = false;

  constructor(opts: CoreServiceOptions = {}) {
    super();
    this.port = opts.port ?? (Number(process.env.CLAUDE_ROBLOX_PORT) || DEFAULT_PORT);
    this.tokenPath = opts.tokenPath ?? join(process.cwd(), ".roblox-mcp", "token");
    this.harness = new Harness(opts.harnessPath ?? join(dirname(this.tokenPath), "harness.json"));
  }

  getToken(): string {
    return this.token;
  }

  isRunning(): boolean {
    return this.running;
  }

  getStatus(): CoreStatus {
    return {
      running: this.running,
      port: this.port,
      pluginConnected: this.queue?.isPluginConnected() ?? false,
      claudeConnected: this.bridge?.mcpActiveRecently() ?? false,
      mcpClient: this.bridge?.getMcpClient()?.name ?? null,
      queueDepth: this.queue?.queueDepth ?? 0,
    };
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.token = await loadOrCreateToken(this.tokenPath);
    this.queue = new CommandQueue();
    this.confirm = new ConfirmStore();
    this.bridge = new BridgeServer({
      port: this.port,
      token: this.token,
      queue: this.queue,
      confirm: this.confirm,
      harness: this.harness,
      onHandshake: (info: HandshakeInfo) => {
        this.emit("handshake", info);
        this.emit("status", this.getStatus());
      },
    });
    await this.bridge.start();
    this.running = true;
    this.emit("status", this.getStatus());
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.queue?.shutdown();
    await this.bridge?.stop();
    this.bridge = null;
    this.queue = null;
    this.confirm = null;
    this.running = false;
    this.emit("status", this.getStatus());
  }

  /** 轮换 token（需重新配对 + 重写 Claude Code 配置）。 */
  async rotateToken(): Promise<string> {
    const wasRunning = this.running;
    if (wasRunning) await this.stop();
    const { promises: fs } = await import("node:fs");
    this.token = generateToken();
    await fs.mkdir(join(this.tokenPath, ".."), { recursive: true });
    await fs.writeFile(this.tokenPath, this.token, { encoding: "utf8", mode: 0o600 });
    if (wasRunning) await this.start();
    return this.token;
  }
}

export { CommandQueue } from "./bridge/commandQueue.js";
export { ConfirmStore } from "./safety/confirm.js";
export { BridgeServer } from "./bridge/httpServer.js";
export * from "./security/auth.js";
export * from "./config/mcpConfig.js";
export * from "./bridge/envelope.js";
export { Harness } from "./harness/harness.js";
