const DEFAULT_EVENT_TIMEOUT_MS = 15_000;
function compact(value) {
    return typeof value === "string" ? value.trim() : "";
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function normalizeApiBaseUrl(value) {
    return value.trim().replace(/\/+$/, "") || "http://127.0.0.1:8000";
}
export function buildCodexInteractiveWebSocketUrl(apiBaseUrl, sessionId, userId) {
    const base = new URL(`${normalizeApiBaseUrl(apiBaseUrl)}/`);
    base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    base.pathname = `${base.pathname.replace(/\/api\/backend\/?$/, "").replace(/\/+$/, "")}/ws/codex/interactive/${encodeURIComponent(sessionId)}`;
    base.search = new URLSearchParams({ user_id: userId }).toString();
    base.hash = "";
    return base.toString();
}
function parseEvent(data) {
    if (typeof data !== "string")
        return null;
    try {
        const parsed = JSON.parse(data);
        return parsed && typeof parsed === "object" ? parsed : null;
    }
    catch {
        return null;
    }
}
function eventType(event) {
    return compact(event.type);
}
function eventTurnId(event) {
    return compact(event.turn_id);
}
export class CodexInteractiveRelay {
    apiBaseUrl;
    userId;
    WebSocket;
    fetch;
    eventTimeoutMs;
    onEvent;
    onLog;
    connections = new Map();
    constructor(options) {
        this.apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
        this.userId = options.userId.trim();
        this.WebSocket =
            options.WebSocket ??
                globalThis.WebSocket;
        this.fetch =
            options.fetch ??
                globalThis.fetch;
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
    async sendUserMessage(sessionId, text, mode = "read_only") {
        const normalizedSessionId = compact(sessionId);
        const normalizedText = text.trim();
        if (!normalizedSessionId || !normalizedText) {
            return { ok: false, reason: "send-failed", message: "Codex 继续跟进内容为空" };
        }
        try {
            const connection = await this.ensureConnection(normalizedSessionId);
            const started = this.waitForEvent(connection, (event) => {
                const type = eventType(event);
                return type === "turn_started" || type === "turn_failed";
            });
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
        }
        catch (error) {
            return this.failureResult(error);
        }
    }
    async cancelTurn(sessionId) {
        const normalizedSessionId = compact(sessionId);
        if (!normalizedSessionId) {
            return { ok: false, reason: "not-running", message: "目标任务不存在" };
        }
        try {
            const response = await this.fetch(`${this.apiBaseUrl}/codex/interactive/${encodeURIComponent(normalizedSessionId)}/cancel`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-user-id": this.userId,
                },
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                const detail = payload && typeof payload === "object" && "detail" in payload
                    ? compact(payload.detail)
                    : "";
                return {
                    ok: false,
                    reason: response.status === 404 ? "not-running" : "send-failed",
                    message: detail || `Codex 停止请求失败（${response.status}）`,
                };
            }
            const result = payload && typeof payload === "object"
                ? payload
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
        }
        catch (error) {
            return this.failureResult(error);
        }
    }
    closeSession(sessionId) {
        const normalizedSessionId = compact(sessionId);
        const connection = this.connections.get(normalizedSessionId);
        if (!connection)
            return;
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
    closeAll() {
        for (const sessionId of this.connections.keys())
            this.closeSession(sessionId);
    }
    async ensureConnection(sessionId) {
        const existing = this.connections.get(sessionId);
        if (existing) {
            await existing.ready;
            return existing;
        }
        const socket = new this.WebSocket(buildCodexInteractiveWebSocketUrl(this.apiBaseUrl, sessionId, this.userId));
        let readyResolve;
        let readyReject;
        const ready = new Promise((resolve, reject) => {
            readyResolve = resolve;
            readyReject = reject;
        });
        const connection = {
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
            if (!event)
                return;
            const type = eventType(event);
            if (type === "turn_started")
                connection.activeTurnId = eventTurnId(event) || connection.activeTurnId;
            if (type === "turn_completed" || (type === "turn_failed" && eventTurnId(event) === connection.activeTurnId)) {
                connection.activeTurnId = null;
            }
            if (type === "session_ready" && !connection.readySettled) {
                connection.readySettled = true;
                connection.readyResolve();
            }
            for (const waiter of Array.from(connection.waiters)) {
                if (!waiter.matches(event))
                    continue;
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
            const error = new Error(`Codex interactive WebSocket 已关闭${event.code ? `（${event.code}）` : ""}`);
            if (!connection.readySettled) {
                connection.readySettled = true;
                connection.readyReject(error);
            }
            this.rejectConnectionWaiters(connection, error);
            if (this.connections.get(sessionId) === connection)
                this.connections.delete(sessionId);
            this.log("connection:close", { sessionId, code: event.code, reason: event.reason });
        };
        await this.withTimeout(ready, this.eventTimeoutMs, "Codex interactive 连接等待超时");
        return connection;
    }
    waitForEvent(connection, matches) {
        return new Promise((resolve, reject) => {
            const waiter = {
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
    rejectConnectionWaiters(connection, error) {
        for (const waiter of connection.waiters) {
            clearTimeout(waiter.timeout);
            waiter.reject(error);
        }
        connection.waiters.clear();
    }
    async withTimeout(promise, timeoutMs, message) {
        let timeout;
        try {
            return await Promise.race([
                promise,
                new Promise((_, reject) => {
                    timeout = setTimeout(() => reject(new RelayTimeoutError(message)), timeoutMs);
                }),
            ]);
        }
        finally {
            if (timeout)
                clearTimeout(timeout);
        }
    }
    failureResult(error) {
        const message = errorMessage(error);
        return {
            ok: false,
            reason: error instanceof RelayTimeoutError ? "timeout" : "connection-failed",
            message,
        };
    }
    log(event, payload) {
        this.onLog?.(event, payload);
    }
}
class RelayTimeoutError extends Error {
}
