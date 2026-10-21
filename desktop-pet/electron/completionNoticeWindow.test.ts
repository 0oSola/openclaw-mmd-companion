import { describe, expect, it } from "vitest";

import {
  COMPLETION_NOTICE_COMPACT_HEIGHT,
  COMPLETION_NOTICE_EXPANDED_HEIGHT,
  COMPLETION_NOTICE_CARD_GAP,
  COMPLETION_NOTICE_WINDOW_WIDTH,
  MAX_VISIBLE_COMPLETION_NOTICES,
  addDismissedCompletionNoticeKey,
  calculateCompletionNoticePosition,
  completionNoticeSummary,
  completionNoticeWindowSize,
  createCompletionNoticeBrowserWindowOptions,
  createCompletionNoticeReducerState,
  reduceCompletionNoticeState,
  serializeDismissedCompletionNoticeKeys,
} from "./completionNoticeWindow";
import { buildCodexStatusCard } from "../src/codex/codexStatusCard";

describe("completion notice window pure behavior", () => {
  it("creates an interactive frameless transparent always-on-top window", () => {
    const options = createCompletionNoticeBrowserWindowOptions("preload.cjs");

    expect(options).toMatchObject({
      width: COMPLETION_NOTICE_WINDOW_WIDTH,
      height: COMPLETION_NOTICE_COMPACT_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: true,
      resizable: false,
      movable: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: "preload.cjs",
      },
    });
  });

  it("places the notice centered above the Pet", () => {
    expect(
      calculateCompletionNoticePosition(
        { x: 900, y: 400, width: 266, height: 412 },
        { width: COMPLETION_NOTICE_WINDOW_WIDTH, height: COMPLETION_NOTICE_EXPANDED_HEIGHT },
        { x: 0, y: 0, width: 1920, height: 1080 },
      ),
    ).toEqual({ x: 890, y: 198 });
  });

  it("keeps the notice inside the work area when the Pet is near the top edge", () => {
    expect(
      calculateCompletionNoticePosition(
        { x: -620, y: 80, width: 220, height: 240 },
        { width: COMPLETION_NOTICE_WINDOW_WIDTH, height: COMPLETION_NOTICE_COMPACT_HEIGHT },
        { x: -1280, y: 0, width: 1280, height: 900 },
      ),
    ).toEqual({ x: -653, y: 0 });
  });

  it("keeps the notice bottom attached to the Pet top when expanded", () => {
    const petBounds = { x: 1540, y: 420, width: 220, height: 240 };
    const position = calculateCompletionNoticePosition(
      petBounds,
      { width: COMPLETION_NOTICE_WINDOW_WIDTH, height: COMPLETION_NOTICE_EXPANDED_HEIGHT },
      { x: 0, y: 0, width: 1920, height: 1080 },
    );

    expect(position).toEqual({ x: 1507, y: 218 });
    expect(position.y + COMPLETION_NOTICE_EXPANDED_HEIGHT + 12).toBe(petBounds.y);
  });

  it("keeps the default new notice collapsed and appends new keys", () => {
    const initial = createCompletionNoticeReducerState();
    const first = reduceCompletionNoticeState(initial, {
      type: "status",
      agentLabel: "Codex",
      status: {
        state: "completed",
        workspacePath: "D:\\workspace\\MMD project",
        sessionTitle: "Build the notice",
        completionNoticeKey: "completion-a",
      },
    });

    expect(first.notices).toEqual([{
      key: "completion-a",
      title: "Codex completed - MMD project",
      workspaceLabel: "MMD project",
      taskLabel: "Build the notice",
      outputLines: [],
      workspacePath: "D:\\workspace\\MMD project",
      stopSupported: false,
    }]);
    expect(first.expanded).toBe(false);

    const expanded = reduceCompletionNoticeState(first, { type: "expand" });
    const sameKey = reduceCompletionNoticeState(expanded, {
      type: "status",
      status: {
        state: "completed",
        workspacePath: "D:\\workspace\\MMD project",
        sessionTitle: "Updated presentation",
        completionNoticeKey: "completion-a",
      },
    });
    expect(sameKey).toBe(expanded);

    const replacement = reduceCompletionNoticeState(sameKey, {
      type: "status",
      status: {
        state: "completed",
        workspacePath: "D:\\workspace\\Other project",
        sessionTitle: "Newest task",
        lastOutput: "newest output",
        completionNoticeKey: "completion-b",
      },
    });
    expect(replacement.notices.map((notice) => notice.key)).toEqual([
      "completion-a",
      "completion-b",
    ]);
    expect(replacement.expanded).toBe(true);
  });

  it("keeps completed notices across ordinary status updates and dismisses one key at a time", () => {
    const first = reduceCompletionNoticeState(createCompletionNoticeReducerState(), {
      type: "status",
      status: {
        state: "completed",
        workspacePath: "D:\\workspace\\MMD project",
        completionNoticeKey: "completion-a",
      },
    });
    const running = reduceCompletionNoticeState(first, {
      type: "status",
      status: { state: "running", workspacePath: "D:\\workspace\\MMD project" },
    });
    expect(running).toBe(first);

    const dismissed = reduceCompletionNoticeState(running, {
      type: "dismiss",
      key: "completion-a",
    });
    expect(dismissed.notices).toEqual([]);
    expect(dismissed.dismissedKeys).toEqual(["completion-a"]);

    const replay = reduceCompletionNoticeState(dismissed, {
      type: "status",
      status: {
        state: "completed",
        workspacePath: "D:\\workspace\\MMD project",
        completionNoticeKey: "completion-a",
      },
    });
    expect(replay).toBe(dismissed);
  });

  it("deduplicates keys and keeps only the newest visible notices", () => {
    let state = createCompletionNoticeReducerState();
    for (const key of ["a", "b", "c", "d"]) {
      state = reduceCompletionNoticeState(state, {
        type: "status",
        status: {
          state: "completed",
          workspacePath: `D:\\workspace\\${key}`,
          completionNoticeKey: `completion-${key}`,
        },
      });
    }

    expect(state.notices.map((notice) => notice.key)).toEqual([
      "completion-b",
      "completion-c",
      "completion-d",
    ]);

    const duplicate = reduceCompletionNoticeState(state, {
      type: "status",
      status: {
        state: "completed",
        workspacePath: "D:\\workspace\\d",
        completionNoticeKey: "completion-d",
      },
    });
    expect(duplicate).toBe(state);
  });

  it("keeps the compact window at one capsule height for three notices", () => {
    expect(completionNoticeWindowSize(3, false)).toEqual({
      width: COMPLETION_NOTICE_WINDOW_WIDTH,
      height: COMPLETION_NOTICE_COMPACT_HEIGHT,
    });
  });

  it("adds card heights and gaps only while expanded", () => {
    expect(COMPLETION_NOTICE_EXPANDED_HEIGHT).toBe(190);
    expect(completionNoticeWindowSize(1, true).height).toBe(190);
    expect(completionNoticeWindowSize(2, true).height).toBe(388);
    expect(completionNoticeWindowSize(3, true)).toEqual({
      width: COMPLETION_NOTICE_WINDOW_WIDTH,
      height: 586,
    });
  });

  it("uses the newest notice for the aggregate copy and shows its output summary", () => {
    let state = createCompletionNoticeReducerState();
    state = reduceCompletionNoticeState(state, {
      type: "status",
      status: {
        state: "completed",
        workspacePath: "D:\\workspace\\Older",
        sessionTitle: "Older task",
        lastOutput: "older output",
        completionNoticeKey: "completion-older",
      },
    });
    state = reduceCompletionNoticeState(state, {
      type: "status",
      status: {
        state: "completed",
        workspacePath: "D:\\workspace\\Newest",
        sessionTitle: "Newest task",
        lastOutput: "newest output",
        completionNoticeKey: "completion-newest",
      },
    });

    const newest = state.notices.at(-1);
    expect(newest?.title).toBe("Codex completed - Newest");
    expect(newest ? completionNoticeSummary(newest) : "").toBe("newest output");
  });

  it("keeps task and cleaned output lines for expanded cards", () => {
    const state = reduceCompletionNoticeState(createCompletionNoticeReducerState(), {
      type: "status",
      status: {
        state: "completed",
        workspacePath: "D:\\workspace\\MMD project",
        sessionTitle: "Render the final card",
        lastOutput: "Output:\nExit code: 0\nfinal output\napi_key=sk-test1234567890",
        completionNoticeKey: "completion-card",
      },
    });

    expect(state.notices[0]).toMatchObject({
      taskLabel: "Render the final card",
      outputLines: ["final output", "api_key=[redacted]"],
    });
    expect(state.notices[0].outputLines.join("\n")).not.toContain("sk-test1234567890");
  });

  it("uses the same completed title, task and output projection as the Pet status card", () => {
    const status = {
      state: "completed" as const,
      workspacePath: "D:\\workspace\\MMD project",
      sessionTitle: "Render the final card",
      lastOutput: "Output:\nExit code: 0\nfinal output\napi_key=sk-test1234567890",
      completionNoticeKey: "completion-shared-presentation",
    };
    const notice = reduceCompletionNoticeState(createCompletionNoticeReducerState(), {
      type: "status",
      status,
      agentLabel: "Codex",
    }).notices[0];
    const statusCard = buildCodexStatusCard(status, "low", "Codex");

    expect(notice).toBeDefined();
    expect(statusCard).toBeDefined();
    expect(notice?.title).toBe(statusCard?.title);
    expect(notice?.taskLabel ? `Task: ${notice.taskLabel}` : undefined).toBe(statusCard?.outputLines[0]);
    expect(notice?.outputLines).toEqual(statusCard?.outputLines.slice(notice?.taskLabel ? 1 : 0));
  });

  it("falls back to the workspace label when the completed status has no session title", () => {
    const state = reduceCompletionNoticeState(createCompletionNoticeReducerState(), {
      type: "status",
      agentLabel: "Codex",
      status: {
        state: "completed",
        workspacePath: "D:\\workspace\\Fallback workspace",
        lastOutput: "Done",
        completionNoticeKey: "completion-fallback",
      },
    });

    expect(state.notices[0]).toMatchObject({
      title: "Codex completed - Fallback workspace",
      workspaceLabel: "Fallback workspace",
      taskLabel: undefined,
      outputLines: ["Done"],
    });
  });

  it("dismisses the newest notice and leaves the remaining compact copy", () => {
    let state = createCompletionNoticeReducerState();
    for (const [key, workspace] of [
      ["completion-a", "Workspace A"],
      ["completion-b", "Workspace B"],
    ]) {
      state = reduceCompletionNoticeState(state, {
        type: "status",
        status: {
          state: "completed",
          workspacePath: `D:\\workspace\\${workspace}`,
          completionNoticeKey: key,
        },
      });
    }

    state = reduceCompletionNoticeState(state, { type: "dismiss", key: "completion-b" });
    const remaining = state.notices.at(-1);
    expect(state.notices).toHaveLength(1);
    expect(remaining ? completionNoticeSummary(remaining) : "").toBe("Completed");
    expect(remaining?.title).toBe("Codex completed - Workspace A");
  });

  it("serializes dismissed keys without duplicate growth", () => {
    const keys = addDismissedCompletionNoticeKey(["completion-a"], "completion-a");
    expect(keys).toEqual(["completion-a"]);
    expect(serializeDismissedCompletionNoticeKeys(keys)).toBe('["completion-a"]');
    expect(completionNoticeWindowSize(false)).toEqual({
      width: COMPLETION_NOTICE_WINDOW_WIDTH,
      height: COMPLETION_NOTICE_COMPACT_HEIGHT,
    });
    expect(completionNoticeWindowSize(true)).toEqual({
      width: COMPLETION_NOTICE_WINDOW_WIDTH,
      height: COMPLETION_NOTICE_EXPANDED_HEIGHT,
    });
    expect(completionNoticeWindowSize(MAX_VISIBLE_COMPLETION_NOTICES, true)).toEqual({
      width: COMPLETION_NOTICE_WINDOW_WIDTH,
      height: 3 * COMPLETION_NOTICE_EXPANDED_HEIGHT + 2 * COMPLETION_NOTICE_CARD_GAP,
    });
  });
});
