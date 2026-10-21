import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_REMOTE_HOST_PROFILE,
  buildRemoteGitScanCommand,
  mergeRemoteProjects,
  parseRemoteGitScanOutput,
  refreshRemoteProjectCatalog,
} from "./remoteProjectCatalog.js";

describe("remote project catalog", () => {
  it("builds a bounded scan command for the approved roots", () => {
    expect(buildRemoteGitScanCommand(DEFAULT_REMOTE_HOST_PROFILE)).toBe(
      "find '/Users/sola/workspace' '/Users/sola/Desktop/kscc' -mindepth 1 -maxdepth 4 -name .git -prune -print 2>/dev/null",
    );
  });

  it("parses, filters, and de-duplicates git repository paths", () => {
    const projects = parseRemoteGitScanOutput([
      "/Users/sola/workspace/MoMask/.git",
      "/Users/sola/workspace/MoMask/.git",
      "/Users/sola/Desktop/kscc/Qwen3-TTS/.git",
      "/tmp/ignored/.git",
    ].join("\n"), DEFAULT_REMOTE_HOST_PROFILE);

    expect(projects.map((project) => project.remotePath)).toEqual([
      "/Users/sola/workspace/MoMask",
      "/Users/sola/Desktop/kscc/Qwen3-TTS",
    ]);
  });

  it("merges an SSH project with the formal Codex Desktop project id by path", () => {
    const sshProjects = parseRemoteGitScanOutput(
      "/Users/sola/workspace/voice-workflow-service/.git",
      DEFAULT_REMOTE_HOST_PROFILE,
    );
    const projects = mergeRemoteProjects({
      profile: DEFAULT_REMOTE_HOST_PROFILE,
      sshProjects,
      desktopProjects: [{
        projectId: "eed427f0-87cd-4179-a070-acedbd2dca98",
        projectKind: "remote",
        label: "voice-workflow-service",
        path: "/Users/sola/workspace/voice-workflow-service",
        hostId: "remote-ssh-codex-managed:macCodex",
        hostDisplayName: "macCodex",
        isGitRepository: true,
      }],
    });

    expect(projects).toEqual([
      expect.objectContaining({
        desktopProjectId: "eed427f0-87cd-4179-a070-acedbd2dca98",
        availability: "desktop_registered",
        sources: ["codex-desktop-registry", "system-ssh-scan"],
      }),
    ]);
  });

  it("uses a cached snapshot when SSH refresh fails", async () => {
    const files = new Map<string, string>();
    const memoryFs = {
      existsSync: vi.fn((filePath: string) => files.has(filePath)),
      mkdirSync: vi.fn(),
      readFileSync: vi.fn((filePath: string) => files.get(filePath) ?? ""),
      writeFileSync: vi.fn((filePath: string, value: string) => files.set(filePath, value)),
      renameSync: vi.fn((from: string, to: string) => {
        files.set(to, files.get(from) ?? "");
        files.delete(from);
      }),
      rmSync: vi.fn((filePath: string) => files.delete(filePath)),
    };
    const userDataPath = "C:\\pet";
    const successfulExec = vi.fn(async () => ({
      stdout: "/Users/sola/workspace/MoMask/.git\n",
      stderr: "",
    }));
    await refreshRemoteProjectCatalog({ userDataPath, desktopProjects: [], execFile: successfulExec, fs: memoryFs });
    expect(files.has(path.join(userDataPath, "remote-project-catalog.v1.json"))).toBe(true);

    const failed = await refreshRemoteProjectCatalog({
      userDataPath,
      desktopProjects: [],
      execFile: vi.fn(async () => { throw new Error("SSH timeout"); }),
      fs: memoryFs,
    });
    expect(failed.fromCache).toBe(true);
    expect(failed.error).toBe("SSH timeout");
    expect(failed.projects[0]).toMatchObject({ availability: "cached_offline" });
  });

  it("replaces an existing cache on consecutive successful refreshes", async () => {
    const files = new Map<string, string>();
    const memoryFs = {
      existsSync: vi.fn((filePath: string) => files.has(filePath)),
      mkdirSync: vi.fn(),
      readFileSync: vi.fn((filePath: string) => files.get(filePath) ?? ""),
      writeFileSync: vi.fn((filePath: string, value: string) => files.set(filePath, value)),
      renameSync: vi.fn((from: string, to: string) => {
        files.set(to, files.get(from) ?? "");
        files.delete(from);
      }),
      rmSync: vi.fn((filePath: string) => files.delete(filePath)),
    };
    const userDataPath = "C:\\pet";
    await refreshRemoteProjectCatalog({
      userDataPath,
      desktopProjects: [],
      execFile: vi.fn(async () => ({ stdout: "/Users/sola/workspace/MoMask/.git\n", stderr: "" })),
      fs: memoryFs,
    });
    await refreshRemoteProjectCatalog({
      userDataPath,
      desktopProjects: [],
      execFile: vi.fn(async () => ({ stdout: "/Users/sola/workspace/voice-workflow-service/.git\n", stderr: "" })),
      fs: memoryFs,
    });
    expect(memoryFs.rmSync).toHaveBeenCalled();
    expect([...files.values()].join("\n")).toContain("voice-workflow-service");
  });
});
