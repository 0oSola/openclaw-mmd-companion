import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process";

export const REMOTE_CODEX_PROJECT_ROOTS = [
  "/Users/sola/workspace",
  "/Users/sola/Desktop/kscc",
] as const;

type SpawnedProcess = { unref?: () => void };
type SpawnFn = (command: string, args: string[], options: SpawnOptions) => SpawnedProcess;

export type RemoteCodexLaunchOptions = {
  sshHost: string;
  remotePath: string;
  label: string;
  codexPath?: string;
  windowsTerminal?: string;
  spawn?: SpawnFn;
};

export type RemoteCodexLaunchResult = {
  workspacePath: string;
  commandLine: string;
  sshHost: string;
};

function normalizeRemotePath(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/").replace(/\/+$/, "") || "/";
  if (!normalized.startsWith("/") || normalized.includes("\0") || normalized.includes("\n") || normalized.includes("\r")) {
    throw new Error("远程项目路径无效");
  }
  return normalized;
}

function quotePosixShellArg(value: string): string {
  if (value.includes("\0") || value.includes("\n") || value.includes("\r")) throw new Error("远程命令参数无效");
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function isAllowedProjectPath(remotePath: string): boolean {
  return REMOTE_CODEX_PROJECT_ROOTS.some((root) => remotePath.startsWith(`${root}/`));
}

export function buildRemoteCodexTerminalCommand(options: Pick<RemoteCodexLaunchOptions, "sshHost" | "remotePath" | "codexPath">): string {
  const sshHost = options.sshHost.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(sshHost)) throw new Error("SSH 主机别名无效");
  const remotePath = normalizeRemotePath(options.remotePath);
  if (!isAllowedProjectPath(remotePath)) throw new Error("远程项目不在允许的工程目录内");
  const codexPath = options.codexPath?.trim() || "/Users/sola-codex/.local/bin/codex";
  if (!codexPath.startsWith("/") || codexPath.includes("\0") || codexPath.includes("\n") || codexPath.includes("\r")) {
    throw new Error("远程 Codex 路径无效");
  }
  const roots = REMOTE_CODEX_PROJECT_ROOTS.map(quotePosixShellArg).join(" ");
  const quotedProject = quotePosixShellArg(remotePath);
  return [
    `project=$(realpath -- ${quotedProject}) || { echo 'Pet: remote project no longer exists'; exit 72; }`,
    `case "$project" in ${REMOTE_CODEX_PROJECT_ROOTS.map((root) => `${root}/*`).join("|")}) ;; *) echo 'Pet: remote project escapes allowed roots'; exit 73 ;; esac`,
    `cd -- "$project" && exec ${quotePosixShellArg(codexPath)}`,
    `# allowed-roots: ${roots}`,
  ].join("; ");
}

export function launchRemoteCodexSession(options: RemoteCodexLaunchOptions): RemoteCodexLaunchResult {
  const sshHost = options.sshHost.trim();
  const workspacePath = normalizeRemotePath(options.remotePath);
  const commandLine = buildRemoteCodexTerminalCommand({ sshHost, remotePath: workspacePath, codexPath: options.codexPath });
  const windowsTerminal = options.windowsTerminal?.trim() || "wt.exe";
  const spawn = options.spawn ?? nodeSpawn;
  const title = `Codex · ${options.label.trim() || workspacePath}`;
  const child = spawn(windowsTerminal, [
    "new-tab",
    "--title", title,
    "ssh.exe",
    "-tt",
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", "ForwardAgent=no",
    "-o", "ClearAllForwardings=yes",
    sshHost,
    commandLine,
  ], {
    detached: true,
    stdio: "ignore",
    shell: false,
    windowsHide: false,
  });
  child.unref?.();
  return { workspacePath, commandLine, sshHost };
}
