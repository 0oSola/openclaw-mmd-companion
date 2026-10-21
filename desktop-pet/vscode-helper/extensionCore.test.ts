import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  globalRequestPath,
  handleAllWorkspaceRequests,
  handleWorkspaceRequest,
  parseTerminalRequest,
  requestPathForUserDataDir,
  requestPathForWorkspace,
  requestPathForWorkspaceFile,
  userDataDirFromGlobalStorageUri,
} = require("./extensionCore.cjs") as {
  globalRequestPath: () => string;
  handleAllWorkspaceRequests: (options: {
    vscode: {
      workspace: {
        workspaceFolders?: Array<{ uri: { fsPath: string } }>;
        workspaceFile?: { fsPath: string };
      };
      window: {
        terminals: Array<{ name: string; show: ReturnType<typeof vi.fn>; sendText: ReturnType<typeof vi.fn> }>;
        createTerminal: ReturnType<typeof vi.fn>;
      };
    };
    fs: {
      existsSync: (path: string) => boolean;
      readFileSync: (path: string, encoding: "utf8") => string;
      mkdirSync?: (path: string, options: { recursive: true }) => void;
      writeFileSync?: (path: string, value: string, encoding: "utf8") => void;
      unlinkSync?: (path: string) => void;
    };
    handledRequestIds: Set<string>;
    currentUserDataDir?: string;
    currentWorkspaceFilePath?: string;
    nowMs?: number;
  }) => Array<{ id: string; commandLine: string }>;
  handleWorkspaceRequest: (options: {
    vscode: {
      window: {
        terminals: Array<{ name: string; show: ReturnType<typeof vi.fn>; sendText: ReturnType<typeof vi.fn> }>;
        createTerminal: ReturnType<typeof vi.fn>;
      };
    };
    fs: {
      existsSync: (path: string) => boolean;
      readFileSync: (path: string, encoding: "utf8") => string;
      unlinkSync?: (path: string) => void;
    };
    workspacePath: string;
    handledRequestIds: Set<string>;
    nowMs?: number;
  }) => { id: string; commandLine: string } | null;
  parseTerminalRequest: (raw: string) => { id: string; commandLine: string } | null;
  requestPathForUserDataDir: (userDataDir: string) => string;
  requestPathForWorkspace: (workspacePath: string) => string;
  requestPathForWorkspaceFile: (workspaceFilePath: string) => string;
  userDataDirFromGlobalStorageUri: (uri: { fsPath: string } | undefined) => string | null;
};

describe("VSCode helper terminal request core", () => {
  it("builds the workspace-local request path", () => {
    expect(requestPathForWorkspace("D:\\workspace\\MMD project")).toBe(
      path.win32.join("D:\\workspace\\MMD project", ".codex-pet", "vscode-terminal-request.json"),
    );
  });

  it("derives launch-scoped request paths from VSCode instance storage", () => {
    const userDataDir = "C:\\Temp\\mmd-pet-vscode-ud\\launch-1";
    const globalStoragePath = path.win32.join(
      userDataDir,
      "User",
      "globalStorage",
      "mmd-codex-pet.mmd-codex-pet-vscode-helper",
    );
    const workspaceFilePath = "D:\\workspace\\MMD project\\pet.code-workspace";

    expect(userDataDirFromGlobalStorageUri({ fsPath: globalStoragePath })).toBe(userDataDir);
    expect(requestPathForUserDataDir(userDataDir)).toBe(
      path.win32.join(userDataDir, ".codex-pet", "vscode-terminal-request.json"),
    );
    expect(requestPathForWorkspaceFile(workspaceFilePath)).toBe(
      path.win32.join("D:\\workspace\\MMD project", ".codex-pet", "vscode-terminal-request.json"),
    );
  });

  it("rejects invalid terminal requests", () => {
    expect(parseTerminalRequest(JSON.stringify({ id: "request-1" }))).toBeNull();
    expect(parseTerminalRequest(JSON.stringify({ commandLine: "codex" }))).toBeNull();
  });

  it("does not let an unrelated VSCode instance consume a user-data scoped request", () => {
    const currentUserDataDir = "C:\\Temp\\mmd-pet-vscode-ud\\window-a";
    const requestPath = requestPathForUserDataDir(currentUserDataDir);
    const ackPath = path.win32.join(currentUserDataDir, ".codex-pet", "vscode-terminal-ack.json");
    const terminal = { name: "Codex Pet", show: vi.fn(), sendText: vi.fn() };
    const fs = {
      existsSync: vi.fn((candidate: string) => candidate === requestPath),
      readFileSync: vi.fn(() =>
        JSON.stringify({
          id: "scoped-for-window-b",
          commandLine: "codex",
          workspacePath: "D:\\workspace\\Aether UI",
          targetUserDataDir: "C:\\Temp\\mmd-pet-vscode-ud\\window-b",
          ackPath,
          createdAt: new Date().toISOString(),
        }),
      ),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      unlinkSync: vi.fn(),
    };
    const vscode = {
      workspace: { workspaceFolders: undefined },
      window: {
        terminals: [] as Array<typeof terminal>,
        createTerminal: vi.fn(() => terminal),
      },
    };

    const handled = handleAllWorkspaceRequests({
      vscode,
      fs,
      handledRequestIds: new Set(),
      currentUserDataDir,
    });

    expect(handled).toEqual([]);
    expect(vscode.window.createTerminal).not.toHaveBeenCalled();
    expect(terminal.sendText).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });

  it("consumes a matching user-data scoped request, writes its ACK, then deletes it", () => {
    const nowMs = Date.parse("2026-07-10T07:30:00.000Z");
    const currentUserDataDir = "C:\\Temp\\mmd-pet-vscode-ud\\Launch-A";
    const targetUserDataDir = "c:/temp/mmd-pet-vscode-ud/launch-a/";
    const requestPath = requestPathForUserDataDir(currentUserDataDir);
    const ackPath = path.win32.join(currentUserDataDir, ".codex-pet", "vscode-terminal-ack.json");
    const workspacePath = "D:\\workspace\\Aether UI";
    const terminal = { name: "Codex Pet", show: vi.fn(), sendText: vi.fn() };
    const fs = {
      existsSync: vi.fn((candidate: string) => candidate === requestPath),
      readFileSync: vi.fn(() =>
        JSON.stringify({
          id: "scoped-match",
          commandLine: "codex",
          workspacePath,
          targetUserDataDir,
          ackPath,
          createdAt: new Date(nowMs - 1000).toISOString(),
          expiresAt: new Date(nowMs + 20_000).toISOString(),
        }),
      ),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      unlinkSync: vi.fn(),
    };
    const vscode = {
      workspace: { workspaceFolders: undefined },
      window: {
        terminals: [] as Array<typeof terminal>,
        createTerminal: vi.fn(() => terminal),
      },
    };

    const handled = handleAllWorkspaceRequests({
      vscode,
      fs,
      handledRequestIds: new Set(),
      currentUserDataDir,
      nowMs,
    });

    expect(handled.map((request) => request.id)).toEqual(["scoped-match"]);
    expect(vscode.window.createTerminal).toHaveBeenCalledWith({ name: "Codex Pet", cwd: workspacePath });
    expect(terminal.sendText).toHaveBeenCalledWith("codex", true);
    expect(fs.mkdirSync).toHaveBeenCalledWith(path.win32.dirname(ackPath), { recursive: true });
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const ackPayload = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    expect(ackPayload).toEqual({
      id: "scoped-match",
      handledAt: "2026-07-10T07:30:00.000Z",
      target: {
        userDataDir: targetUserDataDir,
        workspaceFilePath: null,
      },
    });
    expect(terminal.sendText.mock.invocationCallOrder[0]).toBeLessThan(fs.writeFileSync.mock.invocationCallOrder[0]);
    expect(fs.writeFileSync.mock.invocationCallOrder[0]).toBeLessThan(fs.unlinkSync.mock.invocationCallOrder[0]);
    expect(fs.unlinkSync).toHaveBeenCalledWith(requestPath);
  });

  it("uses the SSH remote path as terminal cwd for a Remote-SSH workspace", () => {
    const nowMs = Date.parse("2026-07-26T01:00:00.000Z");
    const workspacePath = "vscode-remote://ssh-remote+dev-box/home/ksg/MMD%20project";
    const workspaceFilePath = "C:\\Temp\\remote\\session.code-workspace";
    const requestPath = requestPathForWorkspaceFile(workspaceFilePath);
    const ackPath = "C:\\Temp\\remote\\vscode-terminal-ack.json";
    const terminal = { name: "Codex Pet", show: vi.fn(), sendText: vi.fn() };
    const fs = {
      existsSync: vi.fn((candidate: string) => candidate === requestPath),
      readFileSync: vi.fn(() => JSON.stringify({
        id: "remote-request",
        commandLine: "codex",
        workspacePath,
        ackPath,
        targetWorkspaceFilePath: workspaceFilePath,
        createdAt: new Date(nowMs - 1000).toISOString(),
        expiresAt: new Date(nowMs + 20_000).toISOString(),
      })),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      unlinkSync: vi.fn(),
    };
    const vscode = {
      workspace: {
        workspaceFolders: [{ uri: { fsPath: workspacePath } }],
        workspaceFile: { fsPath: workspaceFilePath },
      },
      window: {
        terminals: [] as Array<typeof terminal>,
        createTerminal: vi.fn(() => terminal),
      },
    };

    const handled = handleAllWorkspaceRequests({
      vscode,
      fs,
      handledRequestIds: new Set(),
      currentWorkspaceFilePath: workspaceFilePath,
      nowMs,
    });

    expect(handled.map((request) => request.id)).toEqual(["remote-request"]);
    expect(vscode.window.createTerminal).toHaveBeenCalledWith({ name: "Codex Pet", cwd: "/home/ksg/MMD project" });
    expect(terminal.sendText).toHaveBeenCalledWith("codex", true);
  });

  it("keeps an already-sent request until its ACK can be written without sending twice", () => {
    const nowMs = Date.parse("2026-07-10T07:30:00.000Z");
    const currentUserDataDir = "C:\\Temp\\mmd-pet-vscode-ud\\ack-retry";
    const requestPath = requestPathForUserDataDir(currentUserDataDir);
    const ackPath = path.win32.join(currentUserDataDir, ".codex-pet", "vscode-terminal-ack.json");
    const terminal = { name: "Codex Pet", show: vi.fn(), sendText: vi.fn() };
    const request = JSON.stringify({
      id: "ack-retry-request",
      commandLine: "codex",
      workspacePath: "D:\\workspace\\Aether UI",
      targetUserDataDir: currentUserDataDir,
      ackPath,
      createdAt: new Date(nowMs - 1000).toISOString(),
      expiresAt: new Date(nowMs + 20_000).toISOString(),
    });
    const fs = {
      existsSync: vi.fn((candidate: string) => candidate === requestPath),
      readFileSync: vi.fn(() => request),
      mkdirSync: vi.fn(),
      writeFileSync: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error("ack locked");
        })
        .mockImplementation(() => undefined),
      unlinkSync: vi.fn(),
    };
    const vscode = {
      workspace: { workspaceFolders: undefined },
      window: {
        terminals: [terminal],
        createTerminal: vi.fn(),
      },
    };
    const handledRequestIds = new Set<string>();

    handleAllWorkspaceRequests({
      vscode,
      fs,
      handledRequestIds,
      currentUserDataDir,
      nowMs,
    });
    expect(terminal.sendText).toHaveBeenCalledTimes(1);
    expect(fs.unlinkSync).not.toHaveBeenCalled();

    handleAllWorkspaceRequests({
      vscode,
      fs,
      handledRequestIds,
      currentUserDataDir,
      nowMs: nowMs + 1000,
    });
    expect(terminal.sendText).toHaveBeenCalledTimes(1);
    expect(fs.writeFileSync).toHaveBeenCalledTimes(2);
    expect(fs.unlinkSync).toHaveBeenCalledWith(requestPath);
  });

  it("reads and matches a request scoped to the current workspace file", () => {
    const nowMs = Date.parse("2026-07-10T07:30:00.000Z");
    const currentWorkspaceFilePath = "D:\\workspace\\MMD project\\pet.code-workspace";
    const targetWorkspaceFilePath = "d:/WORKSPACE/mmd project/PET.code-workspace";
    const requestPath = requestPathForWorkspaceFile(currentWorkspaceFilePath);
    const ackPath = path.win32.join("D:\\workspace\\MMD project", ".codex-pet", "vscode-terminal-ack.json");
    const terminal = { name: "Codex Pet", show: vi.fn(), sendText: vi.fn() };
    const fs = {
      existsSync: vi.fn((candidate: string) => candidate === requestPath),
      readFileSync: vi.fn(() =>
        JSON.stringify({
          id: "workspace-file-match",
          commandLine: "codex",
          workspacePath: "D:\\workspace\\MMD project",
          targetWorkspaceFilePath,
          ackPath,
          createdAt: new Date(nowMs - 1000).toISOString(),
        }),
      ),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      unlinkSync: vi.fn(),
    };
    const vscode = {
      workspace: { workspaceFolders: undefined, workspaceFile: { fsPath: currentWorkspaceFilePath } },
      window: {
        terminals: [] as Array<typeof terminal>,
        createTerminal: vi.fn(() => terminal),
      },
    };

    const handled = handleAllWorkspaceRequests({
      vscode,
      fs,
      handledRequestIds: new Set(),
      currentWorkspaceFilePath,
      nowMs,
    });

    expect(handled.map((request) => request.id)).toEqual(["workspace-file-match"]);
    expect(terminal.sendText).toHaveBeenCalledWith("codex", true);
    expect(JSON.parse(fs.writeFileSync.mock.calls[0][1])).toEqual({
      id: "workspace-file-match",
      handledAt: "2026-07-10T07:30:00.000Z",
      target: {
        userDataDir: null,
        workspaceFilePath: targetWorkspaceFilePath,
      },
    });
    expect(fs.unlinkSync).toHaveBeenCalledWith(requestPath);
  });

  it("deletes an expiresAt-scoped request without executing or acknowledging it", () => {
    const nowMs = Date.parse("2026-07-10T07:30:00.000Z");
    const currentUserDataDir = "C:\\Temp\\mmd-pet-vscode-ud\\expired";
    const requestPath = requestPathForUserDataDir(currentUserDataDir);
    const terminal = { name: "Codex Pet", show: vi.fn(), sendText: vi.fn() };
    const fs = {
      existsSync: vi.fn((candidate: string) => candidate === requestPath),
      readFileSync: vi.fn(() =>
        JSON.stringify({
          id: "expired-scoped-request",
          commandLine: "codex",
          targetUserDataDir: currentUserDataDir,
          ackPath: path.win32.join(currentUserDataDir, ".codex-pet", "ack.json"),
          createdAt: new Date(nowMs - 1000).toISOString(),
          expiresAt: new Date(nowMs - 1).toISOString(),
        }),
      ),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      unlinkSync: vi.fn(),
    };
    const vscode = {
      workspace: { workspaceFolders: undefined },
      window: {
        terminals: [] as Array<typeof terminal>,
        createTerminal: vi.fn(() => terminal),
      },
    };

    const handled = handleAllWorkspaceRequests({
      vscode,
      fs,
      handledRequestIds: new Set(),
      currentUserDataDir,
      nowMs,
    });

    expect(handled).toEqual([]);
    expect(terminal.sendText).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(fs.unlinkSync).toHaveBeenCalledWith(requestPath);
  });

  it("ignores a pending request while the JSON file is only partially written", () => {
    const terminal = { name: "Codex Pet", show: vi.fn(), sendText: vi.fn() };
    const fs = {
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() => "{"),
      unlinkSync: vi.fn(),
    };
    const vscode = {
      window: {
        terminals: [terminal],
        createTerminal: vi.fn(),
      },
    };

    expect(() =>
      handleWorkspaceRequest({
        vscode,
        fs,
        workspacePath: "D:\\workspace\\MMD project",
        handledRequestIds: new Set(),
      }),
    ).not.toThrow();
    expect(terminal.sendText).not.toHaveBeenCalled();
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });

  it("creates a Codex Pet terminal and sends the request command", () => {
    const terminal = { name: "Codex Pet", show: vi.fn(), sendText: vi.fn() };
    const vscode = {
      window: {
        terminals: [],
        createTerminal: vi.fn(() => terminal),
      },
    };
    const requestPath = requestPathForWorkspace("D:\\workspace\\MMD project");
    const fs = {
      existsSync: vi.fn((path: string) => path === requestPath),
      readFileSync: vi.fn(() =>
        JSON.stringify({
          id: "request-1",
          terminalName: "Codex Pet",
          workspacePath: "D:\\workspace\\MMD project",
          commandLine: 'codex resume --cd "D:\\workspace\\MMD project" session-1',
          createdAt: new Date().toISOString(),
        }),
      ),
      unlinkSync: vi.fn(),
    };

    const handled = handleWorkspaceRequest({
      vscode,
      fs,
      workspacePath: "D:\\workspace\\MMD project",
      handledRequestIds: new Set(),
    });

    expect(handled?.id).toBe("request-1");
    expect(vscode.window.createTerminal).toHaveBeenCalledWith({
      name: "Codex Pet",
      cwd: "D:\\workspace\\MMD project",
    });
    expect(terminal.show).toHaveBeenCalledWith(true);
    expect(terminal.sendText).toHaveBeenCalledWith('codex resume --cd "D:\\workspace\\MMD project" session-1', true);
    expect(fs.unlinkSync).toHaveBeenCalledWith(requestPath);
  });

  it("sends prompt requests as terminal input", () => {
    const terminal = { name: "Codex Pet", show: vi.fn(), sendText: vi.fn() };
    const requestPath = requestPathForWorkspace("D:\\workspace\\MMD project");
    const prompt = "继续实现 Pet prompt 发送";
    const fs = {
      existsSync: vi.fn((path: string) => path === requestPath),
      readFileSync: vi.fn(() =>
        JSON.stringify({
          id: "prompt-request-1",
          mode: "prompt",
          terminalName: "Codex Pet",
          workspacePath: "D:\\workspace\\MMD project",
          commandLine: prompt,
          createdAt: new Date().toISOString(),
        }),
      ),
      unlinkSync: vi.fn(),
    };
    const vscode = {
      window: {
        terminals: [terminal],
        createTerminal: vi.fn(),
      },
    };

    const handled = handleWorkspaceRequest({
      vscode,
      fs,
      workspacePath: "D:\\workspace\\MMD project",
      handledRequestIds: new Set(),
    });

    expect(handled?.commandLine).toBe(prompt);
    expect(vscode.window.createTerminal).not.toHaveBeenCalled();
    expect(terminal.show).toHaveBeenCalledWith(true);
    expect(terminal.sendText).toHaveBeenCalledWith(prompt, true);
    expect(fs.unlinkSync).toHaveBeenCalledWith(requestPath);
  });

  it("handles a global request pointer when VSCode opens the helper without workspace folders", () => {
    const workspacePath = "D:\\workspace\\MMD project";
    const globalPath = globalRequestPath();
    const localPath = requestPathForWorkspace(workspacePath);
    const terminal = { name: "Codex Pet", show: vi.fn(), sendText: vi.fn() };
    const requestPayload = JSON.stringify({
      id: "global-request-1",
      mode: "new",
      workspacePath,
      terminalName: "Codex Pet",
      commandLine: "codex",
      createdAt: new Date().toISOString(),
    });
    const fs = {
      existsSync: vi.fn((path: string) => path === globalPath || path === localPath),
      readFileSync: vi.fn(() => requestPayload),
      unlinkSync: vi.fn(),
    };
    const vscode = {
      workspace: {
        workspaceFolders: undefined,
      },
      window: {
        terminals: [] as Array<typeof terminal>,
        createTerminal: vi.fn(() => terminal),
      },
    };

    const handled = handleAllWorkspaceRequests({
      vscode,
      fs,
      handledRequestIds: new Set(),
    });

    expect(handled.map((request) => request.id)).toEqual(["global-request-1"]);
    expect(vscode.window.createTerminal).toHaveBeenCalledWith({
      name: "Codex Pet",
      cwd: workspacePath,
    });
    expect(terminal.sendText).toHaveBeenCalledWith("codex", true);
    expect(fs.unlinkSync).toHaveBeenCalledWith(globalPath);
    expect(fs.unlinkSync).toHaveBeenCalledWith(localPath);
  });

  it("does not run a global request pointer without a matching workspace-local request", () => {
    const workspacePath = "D:\\workspace\\MMD project";
    const globalPath = globalRequestPath();
    const terminal = { name: "Codex Pet", show: vi.fn(), sendText: vi.fn() };
    const fs = {
      existsSync: vi.fn((path: string) => path === globalPath),
      readFileSync: vi.fn(() =>
        JSON.stringify({
          id: "global-request-without-local",
          mode: "new",
          workspacePath,
          terminalName: "Codex Pet",
          commandLine: "codex",
          createdAt: new Date().toISOString(),
        }),
      ),
      unlinkSync: vi.fn(),
    };
    const vscode = {
      workspace: {
        workspaceFolders: undefined,
      },
      window: {
        terminals: [] as Array<typeof terminal>,
        createTerminal: vi.fn(() => terminal),
      },
    };

    const handled = handleAllWorkspaceRequests({
      vscode,
      fs,
      handledRequestIds: new Set(),
    });

    expect(handled).toEqual([]);
    expect(vscode.window.createTerminal).not.toHaveBeenCalled();
    expect(terminal.sendText).not.toHaveBeenCalled();
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });

  it("does not repeat a request id that was already handled", () => {
    const terminal = { name: "Codex Pet", show: vi.fn(), sendText: vi.fn() };
    const request = JSON.stringify({ id: "request-1", commandLine: "codex" });
    const fs = {
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() => request),
    };
    const vscode = {
      window: {
        terminals: [terminal],
        createTerminal: vi.fn(),
      },
    };

    expect(
      handleWorkspaceRequest({
        vscode,
        fs,
        workspacePath: "D:\\workspace\\MMD project",
        handledRequestIds: new Set(["request-1"]),
      }),
    ).toBeNull();
    expect(terminal.sendText).not.toHaveBeenCalled();
  });

  it("ignores and deletes stale terminal requests", () => {
    const terminal = { name: "Codex Pet", show: vi.fn(), sendText: vi.fn() };
    const requestPath = requestPathForWorkspace("D:\\workspace\\MMD project");
    const fs = {
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() =>
        JSON.stringify({
          id: "stale-request",
          commandLine: "codex",
          createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        }),
      ),
      unlinkSync: vi.fn(),
    };
    const vscode = {
      window: {
        terminals: [terminal],
        createTerminal: vi.fn(),
      },
    };

    expect(
      handleWorkspaceRequest({
        vscode,
        fs,
        workspacePath: "D:\\workspace\\MMD project",
        handledRequestIds: new Set(),
      }),
    ).toBeNull();
    expect(terminal.sendText).not.toHaveBeenCalled();
    expect(fs.unlinkSync).toHaveBeenCalledWith(requestPath);
  });
});
