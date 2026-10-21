import { describe, expect, it, vi } from "vitest";

import { fetchCodexRemoteWorkspaces } from "./codexWorkspaceApi.js";
import { discoverCodexDesktopProjects } from "./codexDesktopProjects.js";

describe("Codex remote workspace API", () => {
  it("loads and normalizes workspace entries using the Pet user header", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        workspaces: [
          { id: "mmd-companion", path: " D:/workspace/MMD project ", source: "env" },
          { id: "", path: "D:/ignored" },
          { id: "ui-project", path: "/mnt/d/workspace/ui", source: "ui" },
        ],
      }),
    });

    await expect(
      fetchCodexRemoteWorkspaces({
        apiBaseUrl: "http://127.0.0.1:8000/",
        userId: "admin-1",
        fetch,
        discoverDesktopProjects: () => [],
        discoverLegacySshWorkspaces: () => [],
      }),
    ).resolves.toEqual([
      { id: "mmd-companion", path: "D:/workspace/MMD project", source: "env", kind: "local" },
      { id: "ui-project", path: "/mnt/d/workspace/ui", source: "ui", kind: "local" },
    ]);
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:8000/codex/workspaces", {
      headers: { "x-user-id": "admin-1" },
    });
  });

  it("discovers the Codex Desktop SSH project shape without treating its path as local", () => {
    const projects = discoverCodexDesktopProjects({
      env: { CODEX_DESKTOP_LOG_DIR: "C:\\codex-logs" },
      fs: {
        existsSync: () => true,
        readdirSync: () => [{ name: "desktop.log", isDirectory: () => false }],
        readFileSync: () =>
          'info response={"threads":[{"projectId":"eed427f0-87cd-4179-a070-acedbd2dca98","hostId":"remote-ssh-codex-managed:macCodex","cwd":"/Users/sola/workspace/voice-workflow-service"}]}',
      },
    });
    expect(projects).toEqual([
      expect.objectContaining({
        projectId: "eed427f0-87cd-4179-a070-acedbd2dca98",
        projectKind: "remote",
        label: "voice-workflow-service",
        path: "/Users/sola/workspace/voice-workflow-service",
        hostId: "remote-ssh-codex-managed:macCodex",
        hostDisplayName: "macCodex",
      }),
    ]);
  });

  it("discovers a remote project nested in the real Electron contentItems text shape", () => {
    const nestedThreadList = JSON.stringify({
      schemaVersion: 4,
      threads: [{
        id: "019f949b-5f86-7713-8d4f-34bc3eb5fe65",
        projectId: null,
        hostId: "remote-ssh-codex-managed:macCodex",
        cwd: "/Users/sola/workspace/voice-workflow-service",
      }],
    });
    const response = JSON.stringify({ contentItems: [{ type: "inputText", text: nestedThreadList }], success: true });
    const projects = discoverCodexDesktopProjects({
      env: { CODEX_DESKTOP_LOG_DIR: "C:\\codex-logs" },
      fs: {
        existsSync: () => true,
        readdirSync: () => [{ name: "desktop.log", isDirectory: () => false }],
        readFileSync: () => `info [electron-message-handler] Sending server response response=${response}`,
      },
    });

    expect(projects).toEqual([
      expect.objectContaining({
        label: "voice-workflow-service",
        path: "/Users/sola/workspace/voice-workflow-service",
        hostId: "remote-ssh-codex-managed:macCodex",
        hostDisplayName: "macCodex",
      }),
    ]);
  });

  it("discovers a project from cwd-before-hostId key-value log fields", () => {
    const projects = discoverCodexDesktopProjects({
      env: { CODEX_DESKTOP_LOG_DIR: "C:\\codex-logs" },
      fs: {
        existsSync: () => true,
        readdirSync: () => [{ name: "desktop.log", isDirectory: () => false }],
        readFileSync: () =>
          "warning [git] cwd=/Users/sola/Desktop/kscc/Qwen3-TTS/voice-workflow-service hostId=remote-ssh-codex-managed:macCodex isRemote=true",
      },
    });

    expect(projects).toEqual([
      expect.objectContaining({
        label: "voice-workflow-service",
        path: "/Users/sola/Desktop/kscc/Qwen3-TTS/voice-workflow-service",
        hostDisplayName: "macCodex",
      }),
    ]);
  });

  it("upgrades a historical thread candidate to the formal Desktop project id", () => {
    const threadResponse = JSON.stringify({
      threads: [{
        projectId: null,
        hostId: "remote-ssh-codex-managed:macCodex",
        cwd: "/Users/sola/workspace/voice-workflow-service",
      }],
    });
    const projectResponse = JSON.stringify({
      projects: [{
        projectId: "eed427f0-87cd-4179-a070-acedbd2dca98",
        projectKind: "remote",
        label: "voice-workflow-service",
        path: "/Users/sola/workspace/voice-workflow-service",
        hostId: "remote-ssh-codex-managed:macCodex",
        hostDisplayName: "macCodex",
        isGitRepository: true,
      }],
    });
    const projects = discoverCodexDesktopProjects({
      env: { CODEX_DESKTOP_LOG_DIR: "C:\\codex-logs" },
      fs: {
        existsSync: () => true,
        readdirSync: () => [
          { name: "a.log", isDirectory: () => false },
          { name: "b.log", isDirectory: () => false },
        ],
        readFileSync: (filePath: string) => filePath.endsWith("a.log")
          ? `response=${threadResponse}`
          : `response=${projectResponse}`,
      },
    });

    expect(projects).toEqual([
      expect.objectContaining({ projectId: "eed427f0-87cd-4179-a070-acedbd2dca98" }),
    ]);
  });

  it("surfaces API errors", async () => {
    await expect(
      fetchCodexRemoteWorkspaces({
        apiBaseUrl: "http://127.0.0.1:8000",
        userId: "admin-1",
        fetch: vi.fn().mockResolvedValue({ ok: false, status: 403 }),
        discoverDesktopProjects: () => [],
        discoverLegacySshWorkspaces: () => [],
      }),
    ).rejects.toThrow("Codex workspace list returned 403");
  });
});
