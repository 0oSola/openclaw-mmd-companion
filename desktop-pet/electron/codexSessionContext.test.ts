import { describe, expect, it } from "vitest";

import { createCodexSessionContext } from "./codexSessionContext.js";

describe("Codex session async context", () => {
  it("keeps a captured snapshot current for the same workspace and agent", () => {
    const context = createCodexSessionContext();
    const snapshot = context.capture({ workspacePath: "D:\\workspace\\MMD project", agent: "codex" });

    expect(context.isCurrent(snapshot, { workspacePath: "D:\\workspace\\MMD project", agent: "codex" })).toBe(true);
  });

  it("compares Windows paths without slash, case, or trailing-separator differences", () => {
    const context = createCodexSessionContext();
    const snapshot = context.capture({ workspacePath: "D:\\Workspace\\MMD Project\\", agent: "Codex" });

    expect(context.isCurrent(snapshot, { workspacePath: "d:/workspace/mmd project", agent: "codex" })).toBe(true);
  });

  it("treats a WSL mount path as the same Windows workspace", () => {
    const context = createCodexSessionContext();
    const snapshot = context.capture({ workspacePath: "D:\\workspace\\MMD project", agent: "codex" });

    expect(context.isCurrent(snapshot, { workspacePath: "/mnt/d/workspace/MMD project", agent: "codex" })).toBe(true);
  });

  it("rejects a snapshot when the current workspace or agent differs", () => {
    const context = createCodexSessionContext();
    const snapshot = context.capture({ workspacePath: "D:\\workspace\\project-a", agent: "codex" });

    expect(context.isCurrent(snapshot, { workspacePath: "D:\\workspace\\project-b", agent: "codex" })).toBe(false);
    expect(context.isCurrent(snapshot, { workspacePath: "D:\\workspace\\project-a", agent: "claude" })).toBe(false);
  });

  it("invalidates all previously captured snapshots", () => {
    const context = createCodexSessionContext();
    const snapshot = context.capture({ workspacePath: "D:\\workspace\\MMD project", agent: "codex" });

    expect(context.invalidate()).toBe(1);
    expect(context.isCurrent(snapshot, { workspacePath: "D:\\workspace\\MMD project", agent: "codex" })).toBe(false);
    expect(
      context.isCurrent(
        context.capture({ workspacePath: "D:\\workspace\\MMD project", agent: "codex" }),
        { workspacePath: "D:\\workspace\\MMD project", agent: "codex" },
      ),
    ).toBe(true);
  });

  it("advances the generation and keeps older snapshots stale", () => {
    const context = createCodexSessionContext();
    const first = context.capture({ workspacePath: "D:\\workspace\\MMD project", agent: "codex" });

    expect(context.advance()).toBe(1);
    const second = context.capture({ workspacePath: "D:\\workspace\\MMD project", agent: "codex" });
    expect(context.advance()).toBe(2);

    expect(context.isCurrent(first, { workspacePath: "D:\\workspace\\MMD project", agent: "codex" })).toBe(false);
    expect(context.isCurrent(second, { workspacePath: "D:\\workspace\\MMD project", agent: "codex" })).toBe(false);
  });
});
