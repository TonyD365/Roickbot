// 事件总线：插件 / server-agent 主动上报的事件（如运行状态变化、测试结束）。
// MCP 工具 wait_for_event 在此长等下一个事件，避免 AI 反复轮询 get_run_state。

export interface BridgeEvent {
  /** 事件类型，如 "runState"。 */
  type: string;
  /** 事件发生时间（服务器侧时间戳）。 */
  at: number;
  [key: string]: unknown;
}

interface Waiter {
  resolve: (ev: BridgeEvent | null) => void;
  types?: string[];
  timer: ReturnType<typeof setTimeout>;
}

const MAX_HISTORY = 200;

export class EventBus {
  private history: BridgeEvent[] = [];
  private waiters: Waiter[] = [];

  /** 发布一个事件：记入历史并唤醒匹配的等待者。 */
  publish(ev: { type: string; at?: number; [key: string]: unknown }): BridgeEvent {
    const full: BridgeEvent = { ...ev, type: ev.type, at: ev.at ?? Date.now() };
    this.history.push(full);
    if (this.history.length > MAX_HISTORY) this.history.shift();

    // 唤醒匹配的等待者（一次性）。
    const remaining: Waiter[] = [];
    for (const w of this.waiters) {
      if (!w.types || w.types.includes(full.type)) {
        clearTimeout(w.timer);
        w.resolve(full);
      } else {
        remaining.push(w);
      }
    }
    this.waiters = remaining;
    return full;
  }

  /** 等待下一个（匹配 types 的）事件；超时返回 null。 */
  wait(types: string[] | undefined, timeoutMs: number): Promise<BridgeEvent | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== resolve);
        resolve(null);
      }, timeoutMs);
      this.waiters.push({ resolve, types, timer });
    });
  }

  /** 最近 n 个事件（可按 types 过滤）。 */
  recent(types?: string[], n = 50): BridgeEvent[] {
    const list = types ? this.history.filter((e) => types.includes(e.type)) : this.history;
    return list.slice(-n);
  }

  /** 关停：唤醒所有等待者为 null。 */
  shutdown(): void {
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.resolve(null);
    }
    this.waiters = [];
    this.history = [];
  }
}
