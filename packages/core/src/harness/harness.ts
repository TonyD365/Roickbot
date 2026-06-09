// 开发 harness：跨 AI session 的项目记忆（持久化到本机 JSON 文件，由 core 直接处理，不转发给插件）。
// 灵感来自 rbxsync 的 harness：init / session_start / session_end / status / feature_update。
// 即使 Studio 没连，也能查状态/记进度 —— 它记录的是"开发流程"，不是 DataModel。

import { promises as fs } from "node:fs";
import { dirname } from "node:path";

export type FeatureStatus = "planned" | "in_progress" | "completed" | "blocked" | "cancelled";
export type FeaturePriority = "low" | "medium" | "high" | "critical";

export interface HarnessFeature {
  id: string;
  title: string;
  status: FeatureStatus;
  priority: FeaturePriority;
  tags: string[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HarnessSession {
  id: string;
  startedAt: string;
  endedAt?: string;
  initialGoals?: string[];
  handoffNotes?: string[];
  summary?: string;
}

export interface HarnessState {
  initialized: boolean;
  gameName?: string;
  genre?: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
  counters: { feature: number; session: number };
  features: HarnessFeature[];
  sessions: HarnessSession[];
}

function emptyState(): HarnessState {
  return { initialized: false, counters: { feature: 0, session: 0 }, features: [], sessions: [] };
}

const now = () => new Date().toISOString();

/** 项目级开发记忆。所有写操作都会落盘。 */
export class Harness {
  private state: HarnessState | null = null;

  constructor(private readonly path: string) {}

  private async ensureLoaded(): Promise<HarnessState> {
    if (this.state) return this.state;
    try {
      const raw = await fs.readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as Partial<HarnessState>;
      this.state = { ...emptyState(), ...parsed, counters: { ...emptyState().counters, ...parsed.counters } };
    } catch {
      this.state = emptyState();
    }
    return this.state;
  }

  private async persist(): Promise<void> {
    if (!this.state) return;
    this.state.updatedAt = now();
    await fs.mkdir(dirname(this.path), { recursive: true });
    await fs.writeFile(this.path, JSON.stringify(this.state, null, 2) + "\n", "utf8");
  }

  /** 一次性初始化项目（game_name / genre / description）。可重复调用以更新元信息。 */
  async init(input: { gameName?: string; genre?: string; description?: string }): Promise<HarnessState> {
    const s = await this.ensureLoaded();
    const reinit = s.initialized;
    if (input.gameName !== undefined) s.gameName = input.gameName;
    if (input.genre !== undefined) s.genre = input.genre;
    if (input.description !== undefined) s.description = input.description;
    if (!s.initialized) {
      s.initialized = true;
      s.createdAt = now();
    }
    await this.persist();
    return { ...s, ...(reinit ? {} : {}) };
  }

  /** 开发 session 开始：开一个 session，返回 session_id + "上次干到哪了"的上下文。 */
  async sessionStart(input: { initialGoals?: string[] }): Promise<{
    sessionId: string;
    project: { gameName?: string; genre?: string; description?: string; initialized: boolean };
    initialGoals: string[];
    openFeatures: HarnessFeature[];
    previousSession: HarnessSession | null;
  }> {
    const s = await this.ensureLoaded();
    s.counters.session += 1;
    const id = `S${s.counters.session}`;
    const previousSession = s.sessions.length ? s.sessions[s.sessions.length - 1] : null;
    const session: HarnessSession = {
      id,
      startedAt: now(),
      initialGoals: input.initialGoals ?? [],
    };
    s.sessions.push(session);
    await this.persist();
    return {
      sessionId: id,
      project: {
        gameName: s.gameName,
        genre: s.genre,
        description: s.description,
        initialized: s.initialized,
      },
      initialGoals: session.initialGoals ?? [],
      openFeatures: s.features.filter((f) => f.status !== "completed" && f.status !== "cancelled"),
      previousSession,
    };
  }

  /** session 结束：留 handoff_notes + summary 给下一个 session。 */
  async sessionEnd(input: {
    sessionId?: string;
    handoffNotes?: string[];
    summary?: string;
  }): Promise<HarnessSession> {
    const s = await this.ensureLoaded();
    let session: HarnessSession | undefined;
    if (input.sessionId) {
      session = s.sessions.find((x) => x.id === input.sessionId);
    } else {
      // 默认收尾最近一个还没结束的 session。
      for (let i = s.sessions.length - 1; i >= 0; i--) {
        if (!s.sessions[i].endedAt) {
          session = s.sessions[i];
          break;
        }
      }
    }
    if (!session) {
      throw new Error("No open session to end. Call harness_session_start first.");
    }
    session.endedAt = now();
    if (input.handoffNotes !== undefined) session.handoffNotes = input.handoffNotes;
    if (input.summary !== undefined) session.summary = input.summary;
    await this.persist();
    return session;
  }

  /** 当前项目状态（features + sessions 摘要）。 */
  async status(): Promise<{
    project: { gameName?: string; genre?: string; description?: string; initialized: boolean; createdAt?: string };
    features: HarnessFeature[];
    featureCountsByStatus: Record<string, number>;
    sessions: Array<Pick<HarnessSession, "id" | "startedAt" | "endedAt" | "summary">>;
    openSession: string | null;
  }> {
    const s = await this.ensureLoaded();
    const counts: Record<string, number> = {};
    for (const f of s.features) counts[f.status] = (counts[f.status] ?? 0) + 1;
    const open = s.sessions.find((x) => !x.endedAt);
    return {
      project: {
        gameName: s.gameName,
        genre: s.genre,
        description: s.description,
        initialized: s.initialized,
        createdAt: s.createdAt,
      },
      features: s.features,
      featureCountsByStatus: counts,
      sessions: s.sessions.map((x) => ({ id: x.id, startedAt: x.startedAt, endedAt: x.endedAt, summary: x.summary })),
      openSession: open?.id ?? null,
    };
  }

  /** 增 / 改一个 feature（给 id 则更新，否则新建）。状态 + 优先级 + 标签。 */
  async featureUpdate(input: {
    id?: string;
    title?: string;
    status?: FeatureStatus;
    priority?: FeaturePriority;
    tags?: string[];
    notes?: string;
  }): Promise<HarnessFeature> {
    const s = await this.ensureLoaded();
    let feature: HarnessFeature | undefined = input.id ? s.features.find((f) => f.id === input.id) : undefined;

    if (!feature) {
      if (input.id) throw new Error(`No feature with id ${input.id}.`);
      if (!input.title) throw new Error("title is required to create a new feature.");
      s.counters.feature += 1;
      feature = {
        id: `F${s.counters.feature}`,
        title: input.title,
        status: input.status ?? "planned",
        priority: input.priority ?? "medium",
        tags: input.tags ?? [],
        notes: input.notes,
        createdAt: now(),
        updatedAt: now(),
      };
      s.features.push(feature);
    } else {
      if (input.title !== undefined) feature.title = input.title;
      if (input.status !== undefined) feature.status = input.status;
      if (input.priority !== undefined) feature.priority = input.priority;
      if (input.tags !== undefined) feature.tags = input.tags;
      if (input.notes !== undefined) feature.notes = input.notes;
      feature.updatedAt = now();
    }
    await this.persist();
    return feature;
  }
}
