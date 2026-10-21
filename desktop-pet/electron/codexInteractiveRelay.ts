export type CodexInteractiveEvent = {
  type?: unknown;
  turn_id?: unknown;
  error?: unknown;
  [key: string]: unknown;
};

export type CodexInteractiveRelayFailureReason =
  | "connection-failed"
  | "timeout"
  | "not-running"
  | "send-failed";

export type CodexInteractiveRelayResult =
  | {
      ok: true;
      mode: "follow-up-sent" | "stop-requested" | "copy-only";
      turnId?: string;
    }
  | {
      ok: false;
      reason: CodexInteractiveRelayFailureReason;
      message: string;
    };

type RelayMessageEvent = {
  data: unknown;
};

type RelayCloseEvent = {
  code?: number;
  reason?: string;
};

type RelayWebSocket = {
  readonly readyState: number;
  readonly OPEN: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: RelayMessageEvent) => void) | null;
  onerror: (() => void) | null;
  onclose: ((event: RelayCloseEvent) => void) | null;
};

type RelayWebSocketConstructor = new (url: string) => RelayWebSocket;
type RelayFetch = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

type RelayConnection = {
  sessionId: string;
  socket: RelayWebSocket;
  ready: Promise<void>;
  readyResolve: () => void;
  readyReject: (error: Error) => void;
  readySettled: boolean;
  waiters: Set<RelayEventWaiter>;
  activeTurnId: string | null;
};

type RelayEventWaiter = {
  matches: (event: CodexInteractiveEvent) => boolean;
  resolve: (event: CodexInteractiveEvent) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export type CodexInteractiveRelayOptions = {
  apiBaseUrl: string;
  userId: string;
  WebSocket?: RelayWebSocketConstructor;
  fetch?: RelayFetch;
  eventTimeoutMs?: number;
  onEvent?: (sessionId: string, event: CodexInteractiveEvent) => void;
  onLog?: (event: string, payload: Record<string, unknown>) => void;
};

const DEFAULT_EVENT_TIMEOUT_MS = 15_000;

function compact(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeApiBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "") || "http://127.0.0.1:8000";
}

export function buildCodexInteractiveWebSocketUrl(
  apiBaseUrl: string,
  sessionId: string,
  userId: string,
): string {
  const base = new URL(`${normalizeApiBaseUrl(apiBaseUrl)}/`);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = `${base.pathname.replace(/\/api\/backend\/?$/, "").replace(/\/+$/, "")}/ws/codex/interactive/${encodeURIComponent(sessionId)}`;
  base.search = new URLSearchParams({ user_id: userId }).toString();
  base.hash = "";
  return base.toString();
}

function parseEvent(data: unknown): CodexInteractiveEvent | null {
  if (typeof data !== "string") return null;
  try {
    const parsed = JSON.parse(data) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as CodexInteractiveEvent) : null;
  } catch {
    return null;
  }
}

function eventType(event: CodexInteractiveEvent): string {
  return compact(event.type);
}

function eventTurnId(event: CodexInteractiveEvent): string {
  return compact(event.turn_id);
}

export class CodexInteractiveRelay {
  private readonly apiBaseUrl: string;
  private readonly userId: string;
  private readonly WebSocket: RelayWebSocketConstructor;
  private readonly fetch: RelayFetch;
  private readonly eventTimeoutMs: number;
  private readonly onEvent?: CodexInteractiveRelayOptions["onEvent"];
  private readonly onLog?: CodexInteractiveRelayOptions["onLog"];
  private readonly connections = new Map<string, RelayConnection>();

  constructor(options: CodexInteractiveRelayOptions) {
    this.apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
    this.userId = options.userId.trim();
    this.WebSocket =
      options.WebSocket ??
      ((globalThis as unknown as { WebSocket?: RelayWebSocketConstructor }).WebSocket as RelayWebSocketConstructor);
    this.fetch =
      options.fetch ??
      ((globalThis as unknown as { fetch?: RelayFetch }).fetch as RelayFetch);
    this.eventTimeoutMs = Math.max(1_000, options.eventTimeoutMs ?? DEFAULT_EVENT_TIMEOUT_MS);
    this.onEvent = options.onEvent;
    this.onLog = options.onLog;
    if (!this.WebSocket || !this.fetch) {
      throw new Error("当前 Electron 运行时缺少 WebSocket 或 fetch 支持");
    }
    if (!this.userId) {
      throw new Error("Codex interactive 用户身份缺失");
    }
  }

  async sendUserMessage(
    sessionId: string,
    text: string,
    mode = "read_only",
  ): Promise<CodexInteractiveRelayResult> {
    const normalizedSessionId = compact(sessionId);
    const normalizedText = text.trim();
    if (!normalizedSessionId || !normalizedText) {
      return { ok: false, reason: "send-failed", message: "Codex 继续跟进内容为空" };
    }

    try {
      const connection = await this.ensureConnection(normalizedSessionId);
      const started = this.waitForEvent(
        connection,
        (event) => {
          const type = eventType(event);
          return type === "turn_started" || type === "turn_failed";
        },
      );
      connection.socket.send(JSON.stringify({ type: "user_message", text: normalizedText, mode }));
      const event = await started;
      if (eventType(event) === "turn_started") {
        const turnId = eventTurnId(event);
        connection.activeTurnId = turnId || connection.activeTurnId;
        this.log("user-message:sent", { sessionId: normalizedSessionId, turnId, mode });
        return { ok: true, mode: "follow-up-sent", ...(turnId ? { turnId } : {}) };
      }
      return {
        ok: false,
        reason: "send-failed",
        message: compact(event.error) || "Codex 继续跟进未发送",
      };
    } catch (error) {
      return this.failureResult(error);
    }
  }

  async cancelTurn(sessionId: string): Promise<CodexInteractiveRelayResult> {
    const normalizedSessionId = compact(sessionId);
    if (!normalizedSessionId) {
      return { ok: false, reason: "not-running", message: "目标任务不存在" };
    }

    try {
      const response = await this.fetch(
        `${this.apiBaseUrl}/codex/interactive/${encodeURIComponent(normalizedSessionId)}/cancel`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": this.userId,
          },
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail =
          payload && typeof payload === "object" && "detail" in payload
            ? compact((payload as { detail?: unknown }).detail)
            : "";
        return {
          ok: false,
          reason: response.status === 404 ? "not-running" : "send-failed",
          message: detail || `Codex 停止请求失败（${response.status}）`,
        };
      }
      const result =
        payload && typeof payload === "object"
          ? (payload as {
              cancelled?: unknown;
              turn_id?: unknown;
              message?: unknown;
              reason?: unknown;
            })
          : {};
      if (result.cancelled !== true) {
        return {
          ok: false,
          reason: result.reason === "not-running" ? "not-running" : "send-failed",
          message: compact(result.message) || "当前任务没有正在运行的回合",
        };
      }
      const turnId = compact(result.turn_id);
      this.log("cancel:confirmed", { sessionId: normalizedSessionId, turnId, transport: "http" });
      return { ok: true, mode: "stop-requested", ...(turnId ? { turnId } : {}) };
    } catch (error) {
      return this.failureResult(error);
    }
  }

  closeSession(sessionId: string): void {
    const normalizedSessionId = compact(sessionId);
    const connection = this.connections.get(normalizedSessionId);
    if (!connection) return;
    this.connections.delete(normalizedSessionId);
    for (const waiter of connection.waiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error("Codex interactive 连接已关闭"));
    }
    connection.waiters.clear();
    if (connection.socket.readyState === connection.socket.OPEN) {
      connection.socket.close();
    }
  }

  closeAll(): void {
    for (const sessionId of this.connections.keys()) this.closeSession(sessionId);
  }

  private async ensureConnection(sessionId: string): Promise<RelayConnection> {
    const existing = this.connections.get(sessionId);
    if (existing) {
      await existing.ready;
      return existing;
    }

    const socket = new this.WebSocket(buildCodexInteractiveWebSocketUrl(this.apiBaseUrl, sessionId, this.userId));
    let readyResolve!: () => void;
    let readyReject!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    const connection: RelayConnection = {
      sessionId,
      socket,
      ready,
      readyResolve,
      readyReject,
      readySettled: false,
      waiters: new Set(),
      activeTurnId: null,
    };
    this.connections.set(sessionId, connection);

    socket.onopen = () => {
      this.log("connection:open", { sessionId });
    };
    socket.onmessage = (message) => {
      const event = parseEvent(message.data);
      if (!event) return;
      const type = eventType(event);
      if (type === "turn_started") connection.activeTurnId = eventTurnId(event) || connection.activeTurnId;
      if (type === "turn_completed" || (type === "turn_failed" && eventTurnId(event) === connection.activeTurnId)) {
        connection.activeTurnId = null;
      }
      if (type === "session_ready" && !connection.readySettled) {
        connection.readySettled = true;
        connection.readyResolve();
      }
      for (const waiter of Array.from(connection.waiters)) {
        if (!waiter.matches(event)) continue;
        clearTimeout(waiter.timeout);
        connection.waiters.delete(waiter);
        waiter.resolve(event);
      }
      this.onEvent?.(sessionId, event);
    };
    socket.onerror = () => {
      const error = new Error("Codex interactive WebSocket 连接失败");
      if (!connection.readySettled) {
        connection.readySettled = true;
        connection.readyReject(error);
      }
      this.rejectConnectionWaiters(connection, error);
      this.log("connection:error", { sessionId, error: error.message });
    };
    socket.onclose = (event) => {
      const error = new Error(
        `Codex interactive WebSocket 已关闭${event.code ? `（${event.code}）` : ""}`,
      );
      if (!connection.readySettled) {
        connection.readySettled = true;
        connection.readyReject(error);
      }
      this.rejectConnectionWaiters(connection, error);
      if (this.connections.get(sessionId) === connection) this.connections.delete(sessionId);
      this.log("connection:close", { sessionId, code: event.code, reason: event.reason });
    };

    await this.withTimeout(
      ready,
      this.eventTimeoutMs,
      "Codex interactive 连接等待超时",
    );
    return connection;
  }

  private waitForEvent(
    connection: RelayConnection,
    matches: (event: CodexInteractiveEvent) => boolean,
  ): Promise<CodexInteractiveEvent> {
    return new Promise((resolve, reject) => {
      const waiter: RelayEventWaiter = {
        matches,
        resolve,
        reject,
        timeout: setTimeout(() => {
          connection.waiters.delete(waiter);
          reject(new RelayTimeoutError("Codex interactive 事件等待超时"));
        }, this.eventTimeoutMs),
      };
      connection.waiters.add(waiter);
    });
  }

  private rejectConnectionWaiters(connection: RelayConnection, error: Error): void {
    for (const waiter of connection.waiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    connection.waiters.clear();
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeout = setTimeout(() => reject(new RelayTimeoutError(message)), timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private failureResult(error: unknown): CodexInteractiveRelayResult {
    const message = errorMessage(error);
    return {
      ok: false,
      reason: error instanceof RelayTimeoutError ? "timeout" : "connection-failed",
      message,
    };
  }

  private log(event: string, payload: Record<string, unknown>): void {
    this.onLog?.(event, payload);
  }
}

class RelayTimeoutError extends Error {}
