import { describe, expect, it } from "vitest";

import {
  addDismissedCompletionNoticeKey,
  buildCodexCompletionNotice,
  MAX_DISMISSED_COMPLETION_NOTICE_KEYS,
  parseDismissedCompletionNoticeKeys,
  resolveLatchedCodexCompletionNotice,
  serializeDismissedCompletionNoticeKeys,
} from "./completionNotice";

describe("Codex completion notice", () => {
  it("builds a dismissible workspace completion notice", () => {
    const notice = buildCodexCompletionNotice(
      {
        state: "completed",
        workspacePath: "D:\\workspace\\Other project",
        sessionTitle: "Run release checks",
        codexSessionId: "session-123",
        completionNoticeKey: "completion-123",
      },
      [],
      "Codex",
    );

    expect(notice).toEqual({
      key: "completion-123",
      title: "Codex task completed",
      workspaceLabel: "Other project",
      taskLabel: "Run release checks",
      workspacePath: "D:\\workspace\\Other project",
    });
  });

  it("does not expose injected context as the completed task label", () => {
    const notice = buildCodexCompletionNotice(
      {
        state: "completed",
        workspacePath: "D:\\workspace\\MMD project",
        sessionTitle: "<recommended_plugins> Here is a list of plugins...",
        completionNoticeKey: "completion-injected-context",
      },
      [],
      "Codex",
    );

    expect(notice).toMatchObject({
      workspaceLabel: "MMD project",
      taskLabel: undefined,
    });
  });

  it("does not rebuild a notice after the user dismissed the same completion", () => {
    const notice = buildCodexCompletionNotice(
      {
        state: "completed",
        workspacePath: "D:\\workspace\\Other project",
        sessionTitle: "Run release checks",
        codexSessionId: "session-123",
        completionNoticeKey: "completion-123",
      },
      ["older-completion", "completion-123"],
      "Codex",
    );

    expect(notice).toBeNull();
  });

  it("keeps both notices dismissed when completed statuses alternate A to B to A", () => {
    const dismissed = addDismissedCompletionNoticeKey(
      addDismissedCompletionNoticeKey([], "completion-a"),
      "completion-b",
    );
    const status = (completionNoticeKey: string) => ({
      state: "completed" as const,
      workspacePath: "D:\\workspace\\Other project",
      sessionTitle: "Run release checks",
      completionNoticeKey,
    });

    expect(buildCodexCompletionNotice(status("completion-a"), dismissed, "Codex")).toBeNull();
    expect(buildCodexCompletionNotice(status("completion-b"), dismissed, "Codex")).toBeNull();
    expect(buildCodexCompletionNotice(status("completion-a"), dismissed, "Codex")).toBeNull();
  });

  it("keeps an undismissed completion latched across unrelated status refreshes", () => {
    const completed = {
      state: "completed" as const,
      workspacePath: "D:\\workspace\\A",
      sessionTitle: "Task A",
      completionNoticeKey: "completion-a",
    };
    const notice = resolveLatchedCodexCompletionNotice(null, completed, [], "Codex");

    expect(
      resolveLatchedCodexCompletionNotice(
        notice,
        {
          state: "completed",
          workspacePath: "D:\\workspace\\B",
          sessionTitle: "Historical task B",
        },
        [],
        "Codex",
      ),
    ).toEqual(notice);
    expect(
      resolveLatchedCodexCompletionNotice(
        notice,
        { state: "running", workspacePath: "D:\\workspace\\B" },
        [],
        "Codex",
      ),
    ).toEqual(notice);
    expect(resolveLatchedCodexCompletionNotice(notice, completed, ["completion-a"], "Codex")).toBeNull();
  });

  it("replaces the latched notice when a newer explicit completion arrives", () => {
    const first = resolveLatchedCodexCompletionNotice(
      null,
      {
        state: "completed",
        workspacePath: "D:\\workspace\\A",
        completionNoticeKey: "completion-a",
      },
      [],
      "Codex",
    );
    const second = resolveLatchedCodexCompletionNotice(
      first,
      {
        state: "completed",
        workspacePath: "D:\\workspace\\B",
        completionNoticeKey: "completion-b",
      },
      [],
      "Codex",
    );

    expect(second?.key).toBe("completion-b");
    expect(second?.workspacePath).toBe("D:\\workspace\\B");
  });

  it("ignores historical completed statuses without an explicit completion notice key", () => {
    expect(
      buildCodexCompletionNotice(
        {
          state: "completed",
          workspacePath: "D:\\workspace\\Other project",
          sessionTitle: "Historical release checks",
          codexSessionId: "historical-session",
        },
        [],
        "Codex",
      ),
    ).toBeNull();
  });

  it("ignores non-completed statuses", () => {
    expect(
      buildCodexCompletionNotice(
        {
          state: "running",
          workspacePath: "D:\\workspace\\Other project",
          sessionTitle: "Run release checks",
          completionNoticeKey: "completion-123",
        },
        [],
        "Codex",
      ),
    ).toBeNull();
  });

  it("migrates a legacy single dismissed key into the collection format", () => {
    const keys = parseDismissedCompletionNoticeKeys("legacy-completion");

    expect(keys).toEqual(["legacy-completion"]);
    expect(serializeDismissedCompletionNoticeKeys(keys)).toBe('["legacy-completion"]');
  });

  it("normalizes stored collections and keeps only the latest 100 unique keys", () => {
    const stored = JSON.stringify([
      "duplicate",
      ...Array.from({ length: 105 }, (_, index) => `completion-${index}`),
      "duplicate",
    ]);
    const keys = parseDismissedCompletionNoticeKeys(stored);

    expect(keys).toHaveLength(MAX_DISMISSED_COMPLETION_NOTICE_KEYS);
    expect(keys[0]).toBe("completion-6");
    expect(keys.at(-1)).toBe("duplicate");
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("appends a dismissed key without allowing the collection to grow unbounded", () => {
    const initial = Array.from(
      { length: MAX_DISMISSED_COMPLETION_NOTICE_KEYS + 5 },
      (_, index) => `completion-${index}`,
    );
    const keys = addDismissedCompletionNoticeKey(initial, "completion-105");

    expect(keys).toHaveLength(MAX_DISMISSED_COMPLETION_NOTICE_KEYS);
    expect(keys[0]).toBe("completion-6");
    expect(keys.at(-1)).toBe("completion-105");
  });
});
