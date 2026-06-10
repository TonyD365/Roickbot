// 本地 HTTP 桥服务器：
//   - /mcp        给 Claude Code 的 MCP (Streamable HTTP) 端点
//   - /poll       Studio 插件长轮询拉取命令
//   - /response   Studio 插件回传结果
//   - /handshake  Studio 插件首次连接（配对）
//   - /health     诊断
// 只绑定 127.0.0.1；所有端点先过鉴权中间件。

import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { buildMcpServer, SERVER_VERSION } from "../mcp/server.js";
import { authorizeRequest } from "../security/auth.js";
import { PROTOCOL_VERSION, ResponseEnvelope, HandshakeInfo } from "./envelope.js";
import type { CommandQueue } from "./commandQueue.js";
import type { ConfirmStore } from "../safety/confirm.js";
import type { Harness } from "../harness/harness.js";

export interface BridgeServerOptions {
  port: number;
  token: string;
  queue: CommandQueue;
  confirm: ConfirmStore;
  harness: Harness;
  /** handshake 回调（用于通知 UI 有插件接入）。 */
  onHandshake?: (info: HandshakeInfo) => void;
}

const HOST = "127.0.0.1";

export class BridgeServer {
  private server: Server | null = null;
  private mcpTransports = new Map<string, StreamableHTTPServerTransport>();
  private lastMcpAt = 0;
  private mcpClient: { name: string; version?: string } | null = null;

  constructor(private readonly opts: BridgeServerOptions) {}

  /** Claude Code 最近是否有 MCP 活动（用于 UI 判断"已连接"）。 */
  mcpActiveRecently(): boolean {
    return this.lastMcpAt > 0 && Date.now() - this.lastMcpAt < 60_000;
  }

  /** 最近一次 MCP initialize 上报的客户端（如 "claude-code" / "gemini-cli" / "cursor"）。 */
  getMcpClient(): { name: string; version?: string } | null {
    return this.mcpClient;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        this.handle(req, res).catch((e) => {
          if (!res.headersSent) {
            res.writeHead(500, { "content-type": "application/json" });
          }
          res.end(JSON.stringify({ error: String(e) }));
        });
      });
      server.on("error", reject);
      server.listen(this.opts.port, HOST, () => resolve());
      this.server = server;
    });
  }

  async stop(): Promise<void> {
    for (const t of this.mcpTransports.values()) {
      try {
        await t.close();
      } catch {
        // ignore
      }
    }
    this.mcpTransports.clear();
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
    this.server = null;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${HOST}:${this.opts.port}`);
    const path = url.pathname;

    // 鉴权（所有端点）。
    const auth = authorizeRequest(req, { token: this.opts.token, port: this.opts.port });
    if (!auth.ok) {
      res.writeHead(auth.status ?? 401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: auth.message ?? "Unauthorized" }));
      return;
    }

    if (path === "/mcp") return this.handleMcp(req, res);
    if (path === "/poll" && req.method === "GET") return this.handlePoll(url, res);
    if (path === "/response" && req.method === "POST") return this.handleResponse(req, res);
    if (path === "/handshake" && req.method === "POST") return this.handleHandshake(req, res);
    if (path === "/health" && req.method === "GET") return this.handleHealth(res);

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }

  // ---- MCP (Streamable HTTP，带会话) ----
  private async handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.lastMcpAt = Date.now();
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? this.mcpTransports.get(sessionId) : undefined;

    let body: unknown;
    if (req.method === "POST") body = await readJsonBody(req);

    if (!transport) {
      if (req.method === "POST" && isInitializeRequest(body)) {
        // 记录是哪个 AI 客户端连上来的（MCP initialize 会带 clientInfo）。
        const info = (body as { params?: { clientInfo?: { name?: string; version?: string } } })?.params
          ?.clientInfo;
        if (info?.name) this.mcpClient = { name: info.name, version: info.version };
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            this.mcpTransports.set(sid, transport!);
          },
        });
        transport.onclose = () => {
          if (transport!.sessionId) this.mcpTransports.delete(transport!.sessionId);
        };
        const mcp = buildMcpServer({
          queue: this.opts.queue,
          confirm: this.opts.confirm,
          harness: this.opts.harness,
        });
        await mcp.connect(transport);
      } else {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32000, message: "No valid session; send an initialize request first." },
            id: null,
          }),
        );
        return;
      }
    }

    await transport.handleRequest(req, res, body);
  }

  // ---- 插件长轮询 ----
  private async handlePoll(url: URL, res: ServerResponse): Promise<void> {
    const sessionId = url.searchParams.get("sessionId") ?? "";
    const env = await this.opts.queue.poll(sessionId);
    if (!env) {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(env));
  }

  // ---- 插件回传结果 ----
  private async handleResponse(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = (await readJsonBody(req)) as ResponseEnvelope;
    const matched = this.opts.queue.resolveResponse(body);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: matched }));
  }

  // ---- 插件配对 ----
  private async handleHandshake(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const info = (await readJsonBody(req)) as HandshakeInfo;
    this.opts.queue.setConnectedSession(info.sessionId);
    this.opts.queue.setPluginTools(info.tools);
    this.opts.onHandshake?.(info);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        protocol: PROTOCOL_VERSION,
        serverVersion: SERVER_VERSION,
      }),
    );
  }

  // ---- 健康检查 ----
  private handleHealth(res: ServerResponse): void {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        serverVersion: SERVER_VERSION,
        pluginConnected: this.opts.queue.isPluginConnected(),
        queueDepth: this.opts.queue.queueDepth,
      }),
    );
  }
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      if (chunks.length === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}
