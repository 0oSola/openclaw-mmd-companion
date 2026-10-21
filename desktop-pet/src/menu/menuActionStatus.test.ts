import { describe, expect, it } from "vitest";

import { describeMainSiteSyncResult, describeMenuActionResult } from "./menuActionStatus";

describe("desktop pet menu action status", () => {
  it("describes notification detail changes", () => {
    expect(describeMenuActionResult({ type: "notification-detail", profile: "high" })).toBe(
      "Notification detail: High",
    );
  });

  it("describes launch actions as active system commands", () => {
    expect(describeMenuActionResult({ type: "new-session" })).toBe("Opening VSCode workspace and starting Codex...");
    expect(describeMenuActionResult({ type: "send-prompt" })).toBe("Preparing Codex prompt...");
    expect(describeMenuActionResult({ type: "prompt-sent" })).toBe("Prompt sent to VSCode terminal");
    expect(describeMenuActionResult({ type: "focus-vscode" })).toBe("Opening VSCode workspace...");
    expect(describeMenuActionResult({ type: "more-sessions", sessions: [] })).toBe("Showing Codex sessions...");
    expect(describeMenuActionResult({ type: "restore-session", petSessionId: "codex:session-1" })).toBe(
      "Opening VSCode workspace and resuming Codex...",
    );
    expect(describeMenuActionResult({ type: "focus-active-session", petSessionId: "codex:session-1" })).toBe(
      "Opening existing task window...",
    );
  });

  it("describes menu language changes", () => {
    expect(describeMenuActionResult({ type: "menu-language", language: "zh-CN" })).toBe("菜单语言：中文");
    expect(describeMenuActionResult({ type: "menu-language", language: "en" })).toBe("Menu language: English");
  });

  it("describes always-on-top changes", () => {
    expect(describeMenuActionResult({ type: "always-on-top", enabled: true })).toBe("Always on top enabled");
    expect(describeMenuActionResult({ type: "always-on-top", enabled: false })).toBe("Always on top disabled");
  });

  it("describes interaction mode changes", () => {
    expect(describeMenuActionResult({ type: "interaction-mode", mode: "camera-adjust" })).toBe(
      "Interaction mode: Adjust Camera · Mouse wheel zooms",
    );
    expect(describeMenuActionResult({ type: "interaction-mode", mode: "window-drag" })).toBe(
      "Interaction mode: Drag Whole App",
    );
  });

  it("describes workspace selection", () => {
    expect(describeMenuActionResult({ type: "select-workspace" })).toBe("Selecting Codex workspace...");
    expect(describeMenuActionResult({ type: "switch-workspace", workspacePath: "D:\\workspace\\other project" })).toBe(
      "Switching workspace: other project",
    );
    expect(describeMenuActionResult({ type: "workspace-selected", workspacePath: "D:\\workspace\\MMD project" })).toBe(
      "Workspace selected: MMD project",
    );
  });

  it("describes main site sync clearly", () => {
    expect(describeMenuActionResult({ type: "sync-main-site" })).toBe("Syncing from main site...");
  });

  it("describes completed main site sync with the loaded model and pipeline", () => {
    expect(describeMainSiteSyncResult("Eula", "mio-reference")).toBe("Synced: Eula · mio-reference");
  });

  it("describes completed main site sync when no model is selected", () => {
    expect(describeMainSiteSyncResult(null, "classic")).toBe("Synced: no model · classic");
  });
});
