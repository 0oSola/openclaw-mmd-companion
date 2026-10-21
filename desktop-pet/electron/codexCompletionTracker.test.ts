import { describe, expect, it } from "vitest";

import { codexCompletionNoticeKey, createCodexCompletionTracker } from "./codexCompletionTracker";

describe("Codex completion tracker", () => {
  it("treats a first completed observation as history by default", () => {
    const tracker = createCodexCompletionTracker();
    const completed = {
      state: "completed",
      codexSessionId: "session-1",
      eventAt: "2026-07-10T08:00:00.000Z",
    };

    expect(tracker.observe(completed)).toBeUndefined();
    expect(tracker.observe(completed)).toBeUndefined();
  });

  it("creates one stable key for a running to completed transition", () => {
    const tracker = createCodexCompletionTracker();
    const completed = {
      state: "completed",
      codexSessionId: "session-1",
      eventAt: "2026-07-10T08:01:00.000Z",
    };

    expect(tracker.observe({ state: "running", codexSessionId: "session-1" })).toBeUndefined();
    expect(tracker.observe(completed)).toBe("session-1:2026-07-10T08:01:00.000Z");
    expect(tracker.observe(completed)).toBe("session-1:2026-07-10T08:01:00.000Z");
    expect(tracker.observe({ ...completed, eventAt: undefined })).toBe("session-1:2026-07-10T08:01:00.000Z");
    expect(tracker.observe({ ...completed, eventAt: "2026-07-10T08:01:01.000Z" })).toBe(
      "session-1:2026-07-10T08:01:00.000Z",
    );
  });

  it("uses last_event_at to distinguish a later completion in the same session", () => {
    const tracker = createCodexCompletionTracker();

    tracker.observe({ state: "running", codexSessionId: "session-1" });
    expect(
      tracker.observe({
        state: "completed",
        codexSessionId: "session-1",
        eventAt: "2026-07-10T08:01:00.000Z",
      }),
    ).toBe("session-1:2026-07-10T08:01:00.000Z");

    tracker.observe({ state: "running", codexSessionId: "session-1" });
    expect(
      tracker.observe({
        state: "completed",
        codexSessionId: "session-1",
        eventAt: "2026-07-10T08:05:00.000Z",
      }),
    ).toBe("session-1:2026-07-10T08:05:00.000Z");
  });

  it("lets a resumed watcher distinguish a new timed completion without observing running", () => {
    const tracker = createCodexCompletionTracker();

    tracker.observe({ state: "running", codexSessionId: "session-resume" });
    expect(
      tracker.observe({
        state: "completed",
        codexSessionId: "session-resume",
        eventAt: "2026-07-10T08:05:00.000Z",
      }),
    ).toBe("session-resume:2026-07-10T08:05:00.000Z");
    expect(
      tracker.observe(
        {
          state: "completed",
          codexSessionId: "session-resume",
          eventAt: "2026-07-10T08:10:00.000Z",
        },
        { allowFirstCompletion: true },
      ),
    ).toBe("session-resume:2026-07-10T08:10:00.000Z");
  });

  it("allows a new watcher to report a task that completed before its first poll", () => {
    const tracker = createCodexCompletionTracker();
    const completed = {
      state: "completed",
      codexSessionId: "session-fast",
      eventAt: "2026-07-10T08:02:00.000Z",
    };

    expect(tracker.observe(completed, { allowFirstCompletion: true })).toBe(
      "session-fast:2026-07-10T08:02:00.000Z",
    );
    expect(tracker.observe(completed)).toBe("session-fast:2026-07-10T08:02:00.000Z");
  });

  it("lets a watcher promote a completion previously baselined as history", () => {
    const tracker = createCodexCompletionTracker();
    const completed = {
      state: "completed",
      codexSessionId: "session-promoted",
      eventAt: "2026-07-10T08:03:00.000Z",
    };

    expect(tracker.observe(completed)).toBeUndefined();
    expect(tracker.observe(completed, { allowFirstCompletion: true })).toBe(
      "session-promoted:2026-07-10T08:03:00.000Z",
    );
    expect(tracker.observe(completed)).toBe("session-promoted:2026-07-10T08:03:00.000Z");
  });

  it("falls back to the session id when no completion event timestamp exists", () => {
    expect(codexCompletionNoticeKey("session-no-time")).toBe("session-no-time");
    expect(codexCompletionNoticeKey("  ")).toBeUndefined();
  });

  it("resets prior transitions when workspace or agent context changes", () => {
    const tracker = createCodexCompletionTracker();
    const completed = {
      state: "completed",
      codexSessionId: "session-reset",
      eventAt: "2026-07-10T08:20:00.000Z",
    };

    tracker.observe({ state: "running", codexSessionId: "session-reset" });
    expect(tracker.observe(completed)).toBe("session-reset:2026-07-10T08:20:00.000Z");
    tracker.reset();
    expect(tracker.observe(completed)).toBeUndefined();
  });
});
