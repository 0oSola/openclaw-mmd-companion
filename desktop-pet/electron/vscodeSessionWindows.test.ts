import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  resolveVscodeSessionWindow,
  resolveVscodeSessionWindowUserDataDir,
  writeVscodeSessionWindowMarker,
} from "./vscodeSessionWindows";

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pet-vscode-session-windows-"));
  tempRoots.push(root);
  return root;
}

function writeWorkspaceJson(root: string, userDataDirName: string, workspacePath: string, mtimeMs: number) {
  const workspaceStorageDir = path.join(root, userDataDirName, "User", "workspaceStorage", "workspace-id");
  fs.mkdirSync(workspaceStorageDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceStorageDir, "workspace.json"),
    `${JSON.stringify({ folder: `file:///${workspacePath.replace(/\\/g, "/").replace(":", "%3A").replace(/ /g, "%20")}` }, null, 2)}\n`,
    "utf8",
  );
  fs.utimesSync(path.join(root, userDataDirName), mtimeMs / 1000, mtimeMs / 1000);
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("VSCode session window markers", () => {
  it("resolves a session-specific user-data-dir after the Pet process restarts", () => {
    const root = makeTempRoot();
    const userDataDir = path.join(root, "session-window");

    writeVscodeSessionWindowMarker({
      userDataDir,
      workspacePath: "D:\\workspace\\MMD project",
      petSessionId: "codex:session-1",
      codexSessionId: "session-1",
      agent: "codex",
      updatedAt: "2026-06-15T15:35:00.000Z",
    });

    expect(
      resolveVscodeSessionWindow({
        rootDir: root,
        workspaceRootDir: path.join(root, "scoped-workspaces"),
        workspacePath: "D:\\workspace\\MMD project",
        petSessionId: "codex:session-1",
        codexSessionId: "session-1",
        agent: "codex",
      }),
    ).toEqual({ userDataDir, source: "marker" });
  });

  it("resolves a session-specific scoped workspace file after the Pet process restarts", () => {
    const root = makeTempRoot();
    const workspaceRootDir = path.join(root, "scoped-workspaces");
    const workspaceFilePath = path.join(workspaceRootDir, "launch-1", "session.code-workspace");

    writeVscodeSessionWindowMarker({
      workspaceFilePath,
      workspacePath: "D:\\workspace\\MMD project",
      petSessionId: "codex:session-2",
      codexSessionId: "session-2",
      agent: "codex",
      updatedAt: "2026-07-10T15:10:00.000Z",
    });

    expect(
      resolveVscodeSessionWindow({
        rootDir: path.join(root, "legacy-user-data"),
        workspaceRootDir,
        workspacePath: "D:\\workspace\\MMD project",
        petSessionId: "codex:session-2",
        codexSessionId: "session-2",
        agent: "codex",
      }),
    ).toEqual({ workspaceFilePath, source: "marker" });
  });

  it("uses the newest matching VSCode workspace dir as a best-effort fallback when no session marker exists", () => {
    const root = makeTempRoot();
    writeWorkspaceJson(root, "old-window", "D:\\workspace\\MMD project", Date.parse("2026-06-15T15:20:00.000Z"));
    writeWorkspaceJson(root, "new-window", "D:\\workspace\\MMD project", Date.parse("2026-06-15T15:35:00.000Z"));
    writeWorkspaceJson(root, "other-window", "D:\\workspace\\Other", Date.parse("2026-06-15T15:40:00.000Z"));

    expect(
      resolveVscodeSessionWindow({
        rootDir: root,
        workspaceRootDir: path.join(root, "scoped-workspaces"),
        workspacePath: "D:\\workspace\\MMD project",
        petSessionId: "codex:missing-marker",
        codexSessionId: "missing-marker",
        agent: "codex",
      }),
    ).toEqual({ userDataDir: path.join(root, "new-window"), source: "workspace-storage" });

    expect(
      resolveVscodeSessionWindowUserDataDir({
        rootDir: root,
        workspaceRootDir: path.join(root, "scoped-workspaces"),
        workspacePath: "D:\\workspace\\MMD project",
        petSessionId: "codex:missing-marker",
        codexSessionId: "missing-marker",
        agent: "codex",
      }),
    ).toBe(path.join(root, "new-window"));
  });
});
