import { describe, expect, it } from "vitest";

import { isSameWorkspacePath, normalizeWorkspacePathIdentity } from "./workspacePathIdentity.js";

describe("workspace path identity", () => {
  it("treats Windows drive paths and WSL mount paths as the same workspace", () => {
    expect(isSameWorkspacePath("D:\\Workspace\\MMD Project", "/mnt/d/workspace/mmd project/")).toBe(true);
    expect(normalizeWorkspacePathIdentity("/mnt/D/Workspace/MMD Project")).toBe("d:/workspace/mmd project");
  });

  it("normalizes Windows slash, case, and trailing separator differences", () => {
    expect(isSameWorkspacePath("D:\\workspace\\MMD project\\", "d:/WORKSPACE/mmd PROJECT")).toBe(true);
  });

  it("keeps non-WSL POSIX paths case-sensitive", () => {
    expect(isSameWorkspacePath("/home/ksg/Project", "/home/ksg/Project/")).toBe(true);
    expect(isSameWorkspacePath("/home/ksg/Project", "/home/ksg/project")).toBe(false);
  });

  it("rejects empty identities", () => {
    expect(normalizeWorkspacePathIdentity("  ")).toBe("");
    expect(isSameWorkspacePath("", "")).toBe(false);
  });
});
