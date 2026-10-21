import { describe, expect, it } from "vitest";

import { describeCodexStatus, getCodexStatusPresentation } from "./codexStatus";
import { buildCodexStatusCard, buildIdleCodexStatusCardFallback } from "./codexStatusCard";

describe("desktop pet Codex status", () => {
  it("describes launch states with a readable workspace label", () => {
    expect(
      describeCodexStatus({
        state: "starting",
        workspacePath: "D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet",
      }),
    ).toBe("Codex starting · desktop-mmd-codex-pet");

    expect(
      describeCodexStatus({
        state: "launched",
        workspacePath: "D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet",
      }),
    ).toBe("Codex terminal running · desktop-mmd-codex-pet");
  });

  it("describes launch failures with the error message", () => {
    expect(
      describeCodexStatus({
        state: "failed",
        workspacePath: "D:\\workspace\\MMD project",
        error: "code command was not found",
      }),
    ).toBe("Codex launch failed · code command was not found");
  });

  it("describes live session states with readable titles", () => {
    expect(
      describeCodexStatus({
        state: "running",
        workspacePath: "D:\\workspace\\MMD project",
        sessionTitle: "修复 Pet 状态同步",
      }),
    ).toBe("Codex running · 修复 Pet 状态同步");

    expect(
      describeCodexStatus({
        state: "command_running",
        workspacePath: "D:\\workspace\\MMD project",
        sessionTitle: "修复 Pet 状态同步",
      }),
    ).toBe("Codex command running · 修复 Pet 状态同步");

    expect(
      describeCodexStatus({
        state: "waiting_approval",
        workspacePath: "D:\\workspace\\MMD project",
        sessionTitle: "npm install",
      }),
    ).toBe("Codex waiting approval · npm install");

    expect(
      describeCodexStatus({
        state: "running",
        workspacePath: "D:\\workspace\\MMD project",
        sessionTitle: "<recommended_plugins> Here is a list of plugins...",
      }),
    ).toBe("Codex running · MMD project");
  });

  it("maps live scanner states to pet motion intent, tone, and idle interruption", () => {
    expect(getCodexStatusPresentation({ state: "running" })).toMatchObject({
      motionIntent: "thinking",
      statusTone: "active",
      shouldInterruptIdle: true,
    });
    expect(getCodexStatusPresentation({ state: "command_running" })).toMatchObject({
      motionIntent: "command",
      statusTone: "active",
      shouldInterruptIdle: true,
    });
    expect(getCodexStatusPresentation({ state: "file_changed" })).toMatchObject({
      motionIntent: "file_change",
      statusTone: "attention",
      shouldInterruptIdle: true,
    });
    expect(getCodexStatusPresentation({ state: "waiting_approval" })).toMatchObject({
      motionIntent: "approval",
      statusTone: "attention",
      shouldInterruptIdle: true,
    });
    expect(getCodexStatusPresentation({ state: "completed" })).toMatchObject({
      motionIntent: "complete",
      statusTone: "success",
      shouldInterruptIdle: true,
    });
    expect(getCodexStatusPresentation({ state: "failed" })).toMatchObject({
      motionIntent: "failure",
      statusTone: "danger",
      shouldInterruptIdle: true,
    });
    expect(getCodexStatusPresentation({ state: "disconnected" })).toMatchObject({
      motionIntent: "disconnected",
      statusTone: "offline",
      shouldInterruptIdle: true,
    });
  });

  it("builds a focusable status card with at most three output lines", () => {
    const card = buildCodexStatusCard(
      {
        state: "command_running",
        workspacePath: "D:\\workspace\\MMD project",
        sessionTitle: "Run tests",
        lastOutput: "line one\nline two\nline three\nline four",
      },
      "medium",
    );

    expect(card).toEqual({
      title: "Codex running command · Run tests",
      outputLines: ["line one", "line two", "line three"],
      focusable: true,
      workspacePath: "D:\\workspace\\MMD project",
    });
  });

  it("redacts sensitive output in the status card", () => {
    const card = buildCodexStatusCard(
      {
        state: "running",
        workspacePath: "D:\\workspace\\MMD project",
        lastOutput: "token=ghp_super_secret_token\napi_key: sk-test1234567890",
      },
      "low",
    );

    expect(card?.outputLines.join("\n")).toContain("token=[redacted]");
    expect(card?.outputLines.join("\n")).toContain("api_key: [redacted]");
    expect(card?.outputLines.join("\n")).not.toContain("ghp_super_secret_token");
    expect(card?.outputLines.join("\n")).not.toContain("sk-test1234567890");
  });

  it("filters Codex tool-run metadata from the status card output", () => {
    const card = buildCodexStatusCard(
      {
        state: "running",
        workspacePath: "D:\\workspace\\MMD project",
        lastOutput: "Exit code: 0\nWall time: 4.1 seconds\nTotal output lines: 547\nActual command output",
      },
      "low",
    );

    expect(card?.outputLines).toEqual(["Actual command output"]);
  });

  it("keeps completed output readable when the transcript contains injected context and progress noise", () => {
    const card = buildCodexStatusCard(
      {
        state: "completed",
        workspacePath: "D:\\workspace\\MMD project",
        sessionTitle: "<recommended_plugins> Here is a list of plugins...",
        lastOutput: "Output:\n[100%]\n================ warnings ================\nwarning: review required\n========\nfinal result",
      },
      "low",
    );

    expect(card).toMatchObject({
      outputLines: ["warning: review required", "final result"],
    });
    expect(card?.outputLines.join("\n")).not.toContain("<recommended_plugins>");
    expect(card?.outputLines.join("\n")).not.toContain("[100%]");
    expect(card?.outputLines.join("\n")).not.toContain("warnings");
  });

  it("shows the completed workspace and keeps it focusable", () => {
    const card = buildCodexStatusCard(
      {
        state: "completed",
        workspacePath: "D:\\workspace\\Other project",
        sessionTitle: "Run release checks",
        lastOutput: "All release checks passed",
      },
      "low",
    );

    expect(card).toEqual({
      title: "Codex completed - Other project",
      outputLines: ["Task: Run release checks", "All release checks passed"],
      focusable: true,
      workspacePath: "D:\\workspace\\Other project",
    });
  });

  it("keeps an idle placeholder card visible after the MMD model is ready", () => {
    expect(
      buildIdleCodexStatusCardFallback({
        hasSelectedModel: true,
        loading: false,
        loadError: null,
      }),
    ).toEqual({
      title: "Codex idle",
      outputLines: ["No active Codex output"],
      focusable: false,
    });
  });

  it("does not show the idle placeholder while the pet is loading or failing", () => {
    expect(
      buildIdleCodexStatusCardFallback({
        hasSelectedModel: false,
        loading: false,
        loadError: null,
      }),
    ).toBeNull();
    expect(
      buildIdleCodexStatusCardFallback({
        hasSelectedModel: true,
        loading: true,
        loadError: null,
      }),
    ).toBeNull();
    expect(
      buildIdleCodexStatusCardFallback({
        hasSelectedModel: true,
        loading: false,
        loadError: "API unavailable",
      }),
    ).toBeNull();
  });
});
