// 桥协议的消息信封定义（服务器 <-> Studio 插件）。

/** 协议版本号；插件与服务器在 handshake 时校验兼容性。 */
export const PROTOCOL_VERSION = 1;

/** 服务器下发给插件的命令信封。 */
export interface CommandEnvelope {
  /** 唯一请求 id，用于把响应匹配回等待的 Promise。 */
  id: string;
  /** 工具名，例如 "create_instance"。 */
  tool: string;
  /** 工具参数（已由 zod 校验）。 */
  args: unknown;
  /** 试运行：插件执行后立即回滚，不落地，只返回预览。 */
  dryRun: boolean;
  /** 插件侧执行的软超时（毫秒）；服务器侧另有硬超时。 */
  deadlineMs: number;
  protocol: number;
}

/** 插件回传给服务器的响应信封。 */
export interface ResponseEnvelope {
  id: string;
  ok: boolean;
  /** ok 为 true 时的结果。 */
  result?: unknown;
  /** ok 为 false 时的错误。 */
  error?: CommandError;
}

export interface CommandError {
  /** 机器可读错误码，如 PATH_DENIED / LUAU_ERROR。 */
  code: string;
  message: string;
  stack?: string;
}

/** 插件在 handshake 时上报的信息。 */
export interface HandshakeInfo {
  pluginVersion: string;
  placeId?: number;
  sessionId: string;
  /** 插件当前实现的工具名列表（用于检测插件与 App 的版本不一致）。 */
  tools?: string[];
}
