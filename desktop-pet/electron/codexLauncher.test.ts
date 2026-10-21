import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  defaultVscodeUserDataDir,
  defaultVscodeWorkspaceFilePath,
  focusVscodeWorkspace,
  launchNewCodexSession,
  resolvePetWorkspacePath,
  resumeCodexSession,
  VSCODE_USER_DATA_ROOT_DIR,
  VSCODE_WORKSPACE_ROOT_DIR,
  waitForVscodeTerminalRequestAck,
} from "./codexLauncher";

describe("desktop pet Codex launcher", () => {
  function createLauncherFs() {
    const writes: Array<{ path: string; value: string }> = [];
    return {
      fs: {
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn((filePath: string, value: string) => {
          writes.push({ path: filePath, value });
        }),
      },
      writes,
    };
  }

  function createSpawn() {
    const spawned: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    const spawn = vi.fn((command: string, args: string[], options: Record<string, unknown>) => {
      spawned.push({ command, args, options });
      return { unref: vi.fn() };
    });
    return { spawn, spawned };
  }

  it("uses the parent project as the default workspace when Electron starts inside desktop-pet", () => {
    expect(resolvePetWorkspacePath({ cwd: "D:\\workspace\\MMD project\\desktop-pet", env: {} })).toBe(
      "D:\\workspace\\MMD project",
    );
  });

  it("lets an environment variable override the workspace path", () => {
    expect(
      resolvePetWorkspacePath({
        cwd: "D:\\workspace\\MMD project\\desktop-pet",
        env: { MMD_PET_WORKSPACE_PATH: "D:\\workspace\\Other project" },
      }),
    ).toBe("D:\\workspace\\Other project");
  });

  it("keeps the legacy throwaway user-data-dir helper for old session windows", () => {
    const dir = defaultVscodeUserDataDir(1700000000000, 0.123456789);
    expect(dir.startsWith(path.join(os.tmpdir(), VSCODE_USER_DATA_ROOT_DIR))).toBe(true);
  });

  it("derives unique workspace files under the scoped launch root", () => {
    const first = defaultVscodeWorkspaceFilePath(1700000000000, 0.123456789);
    const second = defaultVscodeWorkspaceFilePath(1700000000001, 0.987654321);
    expect(first.startsWith(path.join(os.tmpdir(), VSCODE_WORKSPACE_ROOT_DIR))).toBe(true);
    expect(first).not.toBe(second);
  });

  it("opens a fresh workspace-file window through the shared VSCode profile", () => {
    const { spawn, spawned } = createSpawn();
    const launcherFs = createLauncherFs();

    const result = focusVscodeWorkspace({
      workspacePath: "D:\\workspace\\MMD project",
      env: {},
      platform: "win32",
      spawn,
      fs: launcherFs.fs,
    });

    expect(result.workspaceFilePath).toBeTruthy();
    expect(result.userDataDir).toBeUndefined();
    expect(spawned[0].args.slice(0, 2)).toEqual(["--new-window", "--skip-add-to-recently-opened"]);
    expect(spawned[0].args).not.toContain("--user-data-dir");
    expect(launcherFs.writes[0]?.path).toBe(result.workspaceFilePath);
    expect(JSON.parse(launcherFs.writes[0].value)).toEqual({ folders: [{ path: "D:\\workspace\\MMD project" }] });
  });

  it("focuses an existing scoped workspace without forcing another window", () => {
    const { spawn, spawned } = createSpawn();
    const workspaceFilePath = "C:\\Temp\\codex-launch\\session.code-workspace";

    const result = focusVscodeWorkspace({
      workspacePath: "D:\\workspace\\MMD project",
      workspaceFilePath,
      env: {},
      platform: "win32",
      spawn,
    });

    expect(result).toEqual({ workspacePath: "D:\\workspace\\MMD project", workspaceFilePath });
    expect(spawned[0].args).toEqual([workspaceFilePath]);
  });

  it("still focuses legacy isolated-profile windows when a user-data-dir is supplied", () => {
    const { spawn, spawned } = createSpawn();
    focusVscodeWorkspace({
      workspacePath: "D:\\workspace\\MMD project",
      userDataDir: "C:\\Temp\\legacy-window",
      env: {},
      platform: "win32",
      spawn,
    });

    expect(spawned[0].args).toEqual([
      "--new-window",
      "--user-data-dir",
      "C:\\Temp\\legacy-window",
      '"D:\\workspace\\MMD project"',
    ]);
  });

  it("opens a fresh scoped VSCode window and writes a target-bound terminal request", () => {
    const { spawn, spawned } = createSpawn();
    const launcherFs = createLauncherFs();
    const workspaceFilePath = "C:\\Temp\\Codex launch\\session.code-workspace";

    const result = launchNewCodexSession({
      cwd: "D:\\workspace\\MMD project\\desktop-pet",
      workspaceFilePath,
      env: {},
      platform: "win32",
      spawn,
      fs: launcherFs.fs,
    });

    expect(result).toMatchObject({
      workspacePath: "D:\\workspace\\MMD project",
      workspaceFilePath,
      commandLine: "codex",
      terminalRequest: {
        path: "C:\\Temp\\Codex launch\\.codex-pet\\vscode-terminal-request.json",
        ackPath: "C:\\Temp\\Codex launch\\.codex-pet\\vscode-terminal-ack.json",
        workspaceFilePath,
      },
    });
    expect(spawned[0]).toMatchObject({
      command: "code",
      args: [
        "--new-window",
        "--skip-add-to-recently-opened",
        "--extensionDevelopmentPath",
        '"D:\\workspace\\MMD project\\desktop-pet\\vscode-helper"',
        '"C:\\Temp\\Codex launch\\session.code-workspace"',
      ],
      options: { cwd: "D:\\workspace\\MMD project", shell: true, windowsHide: true },
    });
    expect(spawned[0].args).not.toContain("--user-data-dir");
    expect(launcherFs.writes.map((write) => write.path)).toEqual([
      workspaceFilePath,
      "C:\\Temp\\Codex launch\\.codex-pet\\vscode-terminal-request.json",
    ]);
    const request = JSON.parse(launcherFs.writes[1].value);
    expect(request).toMatchObject({
      mode: "new",
      workspacePath: "D:\\workspace\\MMD project",
      terminalName: "Codex Pet",
      commandLine: "codex",
      targetWorkspaceFilePath: workspaceFilePath,
      ackPath: "C:\\Temp\\Codex launch\\.codex-pet\\vscode-terminal-ack.json",
    });
    expect(Date.parse(request.expiresAt)).toBeGreaterThan(Date.parse(request.createdAt));
  });

  it("starts WSL in the workspace before launching a new Codex session", () => {
    const launcherFs = createLauncherFs();
    const result = launchNewCodexSession({
      workspacePath: "D:\\workspace\\MMD project",
      workspaceFilePath: "C:\\Temp\\wsl-new\\session.code-workspace",
      codexEnvMode: "wsl",
      env: {},
      platform: "win32",
      spawn: vi.fn(() => ({ unref: vi.fn() })),
      fs: launcherFs.fs,
    });

    expect(result.commandLine).toBe(
      'wsl.exe --cd "D:\\workspace\\MMD project" --exec codex -c "model_provider=kscc" -c "model=gpt-5.5"',
    );
    expect(JSON.parse(launcherFs.writes[1].value)).toMatchObject({ commandLine: result.commandLine });
  });

  it("omits extensionDevelopmentPath in installed helper mode", () => {
    const { spawn, spawned } = createSpawn();
    const launcherFs = createLauncherFs();

    launchNewCodexSession({
      workspacePath: "D:\\workspace\\MMD project",
      workspaceFilePath: "C:\\Temp\\installed\\session.code-workspace",
      env: { MMD_PET_VSCODE_HELPER_MODE: "installed" },
      platform: "win32",
      spawn,
      fs: launcherFs.fs,
    });

    expect(spawned[0].args).toEqual([
      "--new-window",
      "--skip-add-to-recently-opened",
      "C:\\Temp\\installed\\session.code-workspace",
    ]);
  });

  it("returns the resume command in a separate scoped workspace window", () => {
    const { spawn, spawned } = createSpawn();
    const launcherFs = createLauncherFs();
    const workspaceFilePath = "C:\\Temp\\resume\\session.code-workspace";

    const result = resumeCodexSession({
      codexSessionId: "019e88e4-4f27-7f20-be48-fd1ef50e9492",
      workspacePath: "D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet",
      workspaceFilePath,
      env: {},
      platform: "win32",
      spawn,
      fs: launcherFs.fs,
    });

    expect(result).toMatchObject({
      codexSessionId: "019e88e4-4f27-7f20-be48-fd1ef50e9492",
      workspaceFilePath,
      commandLine:
        'codex resume --cd "D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet" 019e88e4-4f27-7f20-be48-fd1ef50e9492',
    });
    expect(spawned[0].args).toContain(workspaceFilePath);
    expect(JSON.parse(launcherFs.writes[1].value)).toMatchObject({
      mode: "resume",
      codexSessionId: "019e88e4-4f27-7f20-be48-fd1ef50e9492",
    });
  });

  it("resumes WSL Codex from the WSL workspace instead of passing a Windows path to Codex", () => {
    const launcherFs = createLauncherFs();
    const workspacePath = "D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet";
    const result = resumeCodexSession({
      codexSessionId: "019e88e4-4f27-7f20-be48-fd1ef50e9492",
      workspacePath,
      workspaceFilePath: "C:\\Temp\\wsl-resume\\session.code-workspace",
      codexEnvMode: "wsl",
      env: {},
      platform: "win32",
      spawn: vi.fn(() => ({ unref: vi.fn() })),
      fs: launcherFs.fs,
    });

    expect(result.commandLine).toBe(
      'wsl.exe --cd "D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet" --exec codex -c "model_provider=kscc" -c "model=gpt-5.5" resume --cd . 019e88e4-4f27-7f20-be48-fd1ef50e9492',
    );
    expect(result.commandLine.split(workspacePath)).toHaveLength(2);
  });

  it("uses WSL-specific executable overrides without reusing the Windows Codex CLI", () => {
    const launcherFs = createLauncherFs();
    const result = launchNewCodexSession({
      workspacePath: "D:\\workspace\\MMD project",
      workspaceFilePath: "C:\\Temp\\wsl-custom\\session.code-workspace",
      codexEnvMode: "wsl",
      env: {
        MMD_PET_CODEX_CLI: "C:\\Program Files\\Codex\\codex.cmd",
        MMD_PET_WSL_EXEC: "C:\\Windows\\System32\\wsl.exe",
        MMD_PET_WSL_CODEX_CLI: "/opt/codex bin/codex",
      },
      platform: "win32",
      spawn: vi.fn(() => ({ unref: vi.fn() })),
      fs: launcherFs.fs,
    });

    expect(result.commandLine).toBe(
      'C:\\Windows\\System32\\wsl.exe --cd "D:\\workspace\\MMD project" --exec "/opt/codex bin/codex" -c "model_provider=kscc" -c "model=gpt-5.5"',
    );
    expect(result.commandLine).not.toContain("Program Files\\Codex");
  });

  it("waits for the matching helper ACK instead of trusting the detached spawn", async () => {
    const request = {
      id: "request-1",
      path: "C:\\Temp\\launch\\request.json",
      ackPath: "C:\\Temp\\launch\\ack.json",
      workspacePath: "D:\\workspace\\MMD project",
      workspaceFilePath: "C:\\Temp\\launch\\session.code-workspace",
    };
    const ack = {
      id: request.id,
      handledAt: "2026-07-10T07:00:00.000Z",
      target: {
        userDataDir: null,
        workspaceFilePath: request.workspaceFilePath,
      },
    };

    await expect(
      waitForVscodeTerminalRequestAck(request, {
        fs: { existsSync: () => true, readFileSync: () => JSON.stringify(ack) },
      }),
    ).resolves.toEqual(ack);
  });

  it("times out when no target helper confirms the request", async () => {
    await expect(
      waitForVscodeTerminalRequestAck(
        {
          id: "missing",
          path: "request.json",
          ackPath: "ack.json",
          workspacePath: "D:\\workspace\\MMD project",
          workspaceFilePath: "session.code-workspace",
        },
        { fs: { existsSync: () => false, readFileSync: () => "" }, timeoutMs: 2, pollIntervalMs: 1 },
      ),
    ).rejects.toThrow("VSCode did not confirm");
  });

  it("quotes a custom Codex CLI path in the scoped request", () => {
    const launcherFs = createLauncherFs();
    const result = launchNewCodexSession({
      cwd: "D:\\workspace\\MMD project\\desktop-pet",
      workspaceFilePath: "C:\\Temp\\custom\\session.code-workspace",
      env: { MMD_PET_CODEX_CLI: "C:\\Program Files\\Codex\\codex.cmd" },
      platform: "win32",
      spawn: vi.fn(() => ({ unref: vi.fn() })),
      fs: launcherFs.fs,
    });

    expect(result.commandLine).toBe('"C:\\Program Files\\Codex\\codex.cmd"');
    expect(JSON.parse(launcherFs.writes[1].value)).toMatchObject({ commandLine: result.commandLine });
  });

  it("opens a Remote-SSH workspace URI and runs Codex in the remote terminal", () => {
    const launcherFs = createLauncherFs();
    const workspacePath = "vscode-remote://ssh-remote+dev-box/home/ksg/MMD%20project";
    const result = launchNewCodexSession({
      workspacePath,
      workspaceFilePath: "C:\\Temp\\remote\\session.code-workspace",
      platform: "win32",
      spawn: vi.fn(() => ({ unref: vi.fn() })),
      fs: launcherFs.fs,
    });

    expect(result.workspacePath).toBe(workspacePath);
    expect(result.commandLine).toBe("codex");
    expect(JSON.parse(launcherFs.writes[0].value)).toEqual({ folders: [{ uri: workspacePath }] });
  });

  it("rejects empty resume session ids", () => {
    expect(() =>
      resumeCodexSession({
        codexSessionId: "   ",
        workspacePath: "D:\\workspace\\MMD project",
        spawn: vi.fn(() => ({ unref: vi.fn() })),
      }),
    ).toThrow("codexSessionId is required");
  });
});
