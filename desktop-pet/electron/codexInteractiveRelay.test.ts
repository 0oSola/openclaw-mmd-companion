import { describe, expect, it } from "vitest";

import {
  buildCodexInteractiveWebSocketUrl,
  CodexInteractiveRelay,
} from "./codexInteractiveRelay";

type FakeSocket = {
  readonly readyState: number;
  readonly OPEN: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
};

function makeSocketHarness() {
  const sockets: FakeSocket[] = [];
  class FakeWebSocket implements FakeSocket {
    readonly readyState = 1;
    readonly OPEN = 1;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
    sent: string[] = [];

    constructor(readonly url: string) {
      sockets.push(this);
      queueMicrotask(() => this.onopen?.());
      queueMicrotask(() =>
        this.onmessage?.({
          data: JSON.stringify({
            type: "session_ready",
            session_id: "codex_sess_abc",
          }),
        }),
      );
    }

    send(data: string): void {
      this.sent.push(data);
      const payload = JSON.parse(data) as { type?: string };
      if (payload.type === "user_message") {
        queueMicrotask(() =>
          this.onmessage?.({
            data: JSON.stringify({
              type: "turn_started",
              turn_id: "codex_turn_followup",
            }),
          }),
        );
      }
    }

    close(): void {
      this.onclose?.({ code: 1000, reason: "closed" });
    }
  }

  return { sockets, WebSocket: FakeWebSocket };
}

describe("Codex interactive relay", () => {
  it("builds the direct API WebSocket URL", () => {
    expect(
      buildCodexInteractiveWebSocketUrl(
        "http://127.0.0.1:8000/",
        "codex_sess_abc",
        "admin-1",
      ),
    ).toBe(
      "ws://127.0.0.1:8000/ws/codex/interactive/codex_sess_abc?user_id=admin-1",
    );
  });

  it("sends a follow-up over the interactive WebSocket after session_ready", async () => {
    const harness = makeSocketHarness();
    const relay = new CodexInteractiveRelay({
      apiBaseUrl: "http://127.0.0.1:8000",
      userId: "admin-1",
      WebSocket: harness.WebSocket,
      fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
      eventTimeoutMs: 1000,
    });

    await expect(
      relay.sendUserMessage("codex_sess_abc", "继续检查通知", "read_only"),
    ).resolves.toEqual({
      ok: true,
      mode: "follow-up-sent",
      turnId: "codex_turn_followup",
    });
    expect(harness.sockets).toHaveLength(1);
    expect(harness.sockets[0].sent).toEqual([
      JSON.stringify({
        type: "user_message",
        text: "继续检查通知",
        mode: "read_only",
      }),
    ]);
  });

  it("uses the session-level HTTP cancel endpoint instead of a new WebSocket", async () => {
    const harness = makeSocketHarness();
    const requests: Array<{ url: string; init?: unknown }> = [];
    const relay = new CodexInteractiveRelay({
      apiBaseUrl: "http://127.0.0.1:8000",
      userId: "admin-1",
      WebSocket: harness.WebSocket,
      fetch: async (url, init) => {
        requests.push({ url, init });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session_id: "codex_sess_abc",
            cancelled: true,
            turn_id: "codex_turn_original",
            status: "cancelled",
          }),
        };
      },
    });

    await expect(relay.cancelTurn("codex_sess_abc")).resolves.toEqual({
      ok: true,
      mode: "stop-requested",
      turnId: "codex_turn_original",
    });
    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:8000/codex/interactive/codex_sess_abc/cancel",
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": "admin-1",
          },
        },
      },
    ]);
    expect(harness.sockets).toHaveLength(0);
  });

  it("reports not-running when the API session has no active turn", async () => {
    const relay = new CodexInteractiveRelay({
      apiBaseUrl: "http://127.0.0.1:8000",
      userId: "admin-1",
      WebSocket: makeSocketHarness().WebSocket,
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          cancelled: false,
          reason: "not-running",
          message: "当前任务没有正在运行的回合",
        }),
      }),
    });

    await expect(relay.cancelTurn("codex_sess_abc")).resolves.toEqual({
      ok: false,
      reason: "not-running",
      message: "当前任务没有正在运行的回合",
    });
  });
});
