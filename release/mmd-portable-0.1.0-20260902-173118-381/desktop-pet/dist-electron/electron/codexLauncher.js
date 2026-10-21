import { spawn as nodeSpawn } from "node:child_process";
import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isSshWorkspaceUri } from "./remoteWorkspace.js";
const VSCODE_TERMINAL_REQUEST_DIR = ".codex-pet";
const VSCODE_TERMINAL_REQUEST_FILE = "vscode-terminal-request.json";
const VSCODE_TERMINAL_ACK_FILE = "vscode-terminal-ack.json";
const VSCODE_TERMINAL_NAME = "Codex Pet";
export const VSCODE_USER_DATA_ROOT_DIR = "mmd-pet-vscode-ud";
export const VSCODE_WORKSPACE_ROOT_DIR = path.join("mmd-codex-pet", "vscode-workspaces");
export const VSCODE_TERMINAL_REQUEST_TIMEOUT_MS = 20_000;
function cleanPath(value) {
    const trimmed = value?.trim();
    if (!trimmed)
        return null;
    if (isSshWorkspaceUri(trimmed))
        return trimmed;
    return /^[A-Za-z]:[\\/]/.test(trimmed) ? path.win32.normalize(trimmed) : path.resolve(trimmed);
}
function pathApiFor(value) {
    return (/^[A-Za-z]:[\\/]/.test(value) ? path.win32 : path);
}
function normalizeComparablePath(value) {
    const trimmed = value?.trim();
    if (!trimmed)
        return "";
    return /^[A-Za-z]:[\\/]/.test(trimmed)
        ? path.win32.normalize(trimmed).toLowerCase()
        : path.resolve(trimmed);
}
export function resolvePetWorkspacePath(options) {
    const configured = cleanPath(options.env.MMD_PET_WORKSPACE_PATH);
    if (configured)
        return configured;
    const cwd = cleanPath(options.cwd) ?? path.resolve(options.cwd);
    const pathApi = /^[A-Za-z]:[\\/]/.test(cwd) ? path.win32 : path;
    return pathApi.basename(cwd).toLowerCase() === "desktop-pet" ? pathApi.dirname(cwd) : cwd;
}
function resolveLauncherWorkspacePath(options) {
    const explicit = cleanPath(options.workspacePath);
    if (explicit)
        return explicit;
    return resolvePetWorkspacePath({ cwd: options.cwd ?? process.cwd(), env: options.env });
}
function launchDetached(spawn, command, args, options) {
    const child = spawn(command, args, options);
    child.unref?.();
}
function quoteWindowsShellArg(value) {
    if (!/[\s"&|<>^]/.test(value))
        return value;
    return `"${value.replaceAll('"', '\\"')}"`;
}
function prepareShellSpawnValue(value, platform) {
    return platform === "win32" ? quoteWindowsShellArg(value) : value;
}
function prepareShellSpawnArgs(args, platform) {
    return platform === "win32" ? args.map((arg) => quoteWindowsShellArg(arg)) : args;
}
function resolveDesktopPetRoot(cwd) {
    const resolved = cleanPath(cwd) ?? path.resolve(cwd);
    const pathApi = /^[A-Za-z]:[\\/]/.test(resolved) ? path.win32 : path;
    return pathApi.basename(resolved).toLowerCase() === "desktop-pet" ? resolved : pathApi.join(resolved, "desktop-pet");
}
function resolveVscodeHelperExtensionPath(options) {
    const configured = cleanPath(options.env.MMD_PET_VSCODE_HELPER_EXTENSION_PATH);
    if (configured)
        return configured;
    const desktopPetRoot = resolveDesktopPetRoot(options.cwd ?? process.cwd());
    return pathApiFor(desktopPetRoot).join(desktopPetRoot, "vscode-helper");
}
function resolveVscodeHelperMode(env) {
    return env.MMD_PET_VSCODE_HELPER_MODE?.trim() === "installed" ? "installed" : "development";
}
function quoteTerminalArg(value) {
    if (/^[A-Za-z0-9_./:\\-]+$/.test(value))
        return value;
    return `"${value.replaceAll('"', '\\"')}"`;
}
function buildCodexTerminalCommand(options) {
    if (isSshWorkspaceUri(options.workspacePath)) {
        const codexCli = quoteTerminalArg(options.codexCli);
        return options.codexSessionId ? `${codexCli} resume ${quoteTerminalArg(options.codexSessionId)}` : codexCli;
    }
    const isWsl = options.codexEnvMode === "wsl";
    if (isWsl) {
        const args = [
            options.wslExec || "wsl.exe",
            "--cd",
            options.workspacePath,
            "--exec",
            options.codexCli,
            "-c",
            "model_provider=kscc",
            "-c",
            "model=gpt-5.5",
        ];
        if (options.codexSessionId) {
            args.push("resume", "--cd", ".", options.codexSessionId);
        }
        return args.map(quoteTerminalArg).join(" ");
    }
    const codexCli = quoteTerminalArg(options.codexCli);
    if (!options.codexSessionId)
        return codexCli;
    const resumeArgs = `resume --cd ${quoteTerminalArg(options.workspacePath)} ${quoteTerminalArg(options.codexSessionId)}`;
    return `${codexCli} ${resumeArgs}`;
}
// Kept for focusing legacy Pet windows that were launched with an isolated
// profile before the workspace-file protocol was introduced.
export function defaultVscodeUserDataDir(now = Date.now(), random = Math.random()) {
    const stamp = `${now}-${random.toString(36).slice(2, 10)}`;
    return path.join(os.tmpdir(), VSCODE_USER_DATA_ROOT_DIR, stamp);
}
export function defaultVscodeWorkspaceFilePath(now = Date.now(), random = Math.random()) {
    const stamp = `${now}-${random.toString(36).slice(2, 10)}`;
    return path.join(os.tmpdir(), VSCODE_WORKSPACE_ROOT_DIR, stamp, "session.code-workspace");
}
function scopedRequestDir(workspaceFilePath) {
    const pathApi = pathApiFor(workspaceFilePath);
    return pathApi.join(pathApi.dirname(workspaceFilePath), VSCODE_TERMINAL_REQUEST_DIR);
}
function vscodeTerminalRequestPath(workspaceFilePath) {
    const requestDir = scopedRequestDir(workspaceFilePath);
    return pathApiFor(requestDir).join(requestDir, VSCODE_TERMINAL_REQUEST_FILE);
}
function vscodeTerminalAckPath(workspaceFilePath) {
    const requestDir = scopedRequestDir(workspaceFilePath);
    return pathApiFor(requestDir).join(requestDir, VSCODE_TERMINAL_ACK_FILE);
}
function writeVscodeWorkspaceFile(options) {
    options.fs.mkdirSync(pathApiFor(options.workspaceFilePath).dirname(options.workspaceFilePath), { recursive: true });
    const folder = isSshWorkspaceUri(options.workspacePath)
        ? { uri: options.workspacePath }
        : { path: options.workspacePath };
    options.fs.writeFileSync(options.workspaceFilePath, `${JSON.stringify({ folders: [folder] }, null, 2)}\n`, "utf8");
}
function writeVscodeTerminalRequest(options) {
    const requestPath = vscodeTerminalRequestPath(options.workspaceFilePath);
    const serialized = `${JSON.stringify(options.request, null, 2)}\n`;
    options.fs.mkdirSync(pathApiFor(requestPath).dirname(requestPath), { recursive: true });
    options.fs.writeFileSync(requestPath, serialized, "utf8");
    return {
        id: options.request.id,
        path: requestPath,
        ackPath: options.request.ackPath,
        workspacePath: options.workspacePath,
        workspaceFilePath: options.workspaceFilePath,
    };
}
function openLegacyVscodeWindow(options) {
    const codeCli = options.env.MMD_PET_VSCODE_CLI?.trim() || "code";
    const args = ["--new-window", "--user-data-dir", options.userDataDir, options.workspacePath];
    launchDetached(options.spawn, prepareShellSpawnValue(codeCli, options.platform), prepareShellSpawnArgs(args, options.platform), {
        cwd: options.workspacePath,
        detached: true,
        stdio: "ignore",
        shell: options.platform === "win32",
        windowsHide: true,
    });
}
function openVscodeWorkspaceFile(options) {
    const codeCli = options.env.MMD_PET_VSCODE_CLI?.trim() || "code";
    const helperMode = resolveVscodeHelperMode(options.env);
    const args = [];
    if (options.freshWindow) {
        args.push("--new-window", "--skip-add-to-recently-opened");
    }
    if (options.withHelper && helperMode !== "installed") {
        args.push("--extensionDevelopmentPath", resolveVscodeHelperExtensionPath({ cwd: options.cwd, env: options.env }));
    }
    args.push(options.workspaceFilePath);
    launchDetached(options.spawn, prepareShellSpawnValue(codeCli, options.platform), prepareShellSpawnArgs(args, options.platform), {
        cwd: options.workspacePath,
        detached: true,
        stdio: "ignore",
        shell: options.platform === "win32",
        windowsHide: true,
    });
}
function requestCodexInVscodeTerminal(options) {
    const isWsl = options.codexEnvMode === "wsl";
    const codexCli = isWsl
        ? options.env.MMD_PET_WSL_CODEX_CLI?.trim() || "codex"
        : options.env.MMD_PET_CODEX_CLI?.trim() || "codex";
    const commandLine = buildCodexTerminalCommand({
        codexCli,
        workspacePath: options.workspacePath,
        codexSessionId: options.codexSessionId,
        codexEnvMode: options.codexEnvMode,
        wslExec: isWsl ? options.env.MMD_PET_WSL_EXEC?.trim() || "wsl.exe" : undefined,
    });
    writeVscodeWorkspaceFile({
        fs: options.fs,
        workspacePath: options.workspacePath,
        workspaceFilePath: options.workspaceFilePath,
    });
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ackPath = vscodeTerminalAckPath(options.workspaceFilePath);
    const createdAtMs = Date.now();
    const terminalRequest = writeVscodeTerminalRequest({
        fs: options.fs,
        workspacePath: options.workspacePath,
        workspaceFilePath: options.workspaceFilePath,
        request: {
            id: requestId,
            mode: options.mode,
            workspacePath: options.workspacePath,
            terminalName: VSCODE_TERMINAL_NAME,
            commandLine,
            codexSessionId: options.codexSessionId,
            createdAt: new Date(createdAtMs).toISOString(),
            expiresAt: new Date(createdAtMs + VSCODE_TERMINAL_REQUEST_TIMEOUT_MS).toISOString(),
            ackPath,
            targetWorkspaceFilePath: options.workspaceFilePath,
        },
    });
    openVscodeWorkspaceFile({
        cwd: options.cwd,
        workspacePath: options.workspacePath,
        workspaceFilePath: options.workspaceFilePath,
        freshWindow: true,
        withHelper: true,
        env: options.env,
        platform: options.platform,
        spawn: options.spawn,
    });
    return { commandLine, terminalRequest };
}
export async function waitForVscodeTerminalRequestAck(terminalRequest, options = {}) {
    const fs = options.fs ?? nodeFs;
    const timeoutMs = options.timeoutMs ?? VSCODE_TERMINAL_REQUEST_TIMEOUT_MS;
    const pollIntervalMs = options.pollIntervalMs ?? 200;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
        if (fs.existsSync(terminalRequest.ackPath)) {
            try {
                const ack = JSON.parse(fs.readFileSync(terminalRequest.ackPath, "utf8"));
                if (ack.id === terminalRequest.id &&
                    typeof ack.handledAt === "string" &&
                    normalizeComparablePath(ack.target?.workspaceFilePath) ===
                        normalizeComparablePath(terminalRequest.workspaceFilePath)) {
                    return ack;
                }
            }
            catch {
                // The helper may still be finishing an atomic-looking write on a slow disk.
            }
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    throw new Error("VSCode did not confirm the Codex terminal launch; VSCode may be updating or the Pet helper did not load");
}
export function focusVscodeWorkspace(options = {}) {
    const env = options.env ?? process.env;
    const platform = options.platform ?? process.platform;
    const workspacePath = resolveLauncherWorkspacePath({ cwd: options.cwd, workspacePath: options.workspacePath, env });
    const spawn = options.spawn ?? nodeSpawn;
    const fs = options.fs ?? nodeFs;
    const userDataDir = options.userDataDir?.trim();
    const requestedWorkspaceFilePath = options.workspaceFilePath?.trim() || null;
    if (userDataDir && !requestedWorkspaceFilePath) {
        openLegacyVscodeWindow({ workspacePath, userDataDir, env, platform, spawn });
        return { workspacePath, userDataDir };
    }
    const workspaceFilePath = requestedWorkspaceFilePath || defaultVscodeWorkspaceFilePath();
    if (!requestedWorkspaceFilePath) {
        writeVscodeWorkspaceFile({ fs, workspacePath, workspaceFilePath });
    }
    openVscodeWorkspaceFile({
        cwd: options.cwd,
        workspacePath,
        workspaceFilePath,
        freshWindow: !requestedWorkspaceFilePath,
        withHelper: false,
        env,
        platform,
        spawn,
    });
    return { workspacePath, workspaceFilePath };
}
export function launchNewCodexSession(options = {}) {
    const env = options.env ?? process.env;
    const platform = options.platform ?? process.platform;
    const workspacePath = resolveLauncherWorkspacePath({ cwd: options.cwd, workspacePath: options.workspacePath, env });
    const spawn = options.spawn ?? nodeSpawn;
    const fs = options.fs ?? nodeFs;
    const workspaceFilePath = options.workspaceFilePath?.trim() || defaultVscodeWorkspaceFilePath();
    const { commandLine, terminalRequest } = requestCodexInVscodeTerminal({
        mode: "new",
        cwd: options.cwd,
        workspacePath,
        workspaceFilePath,
        env,
        platform,
        spawn,
        fs,
        codexEnvMode: options.codexEnvMode,
    });
    return { workspacePath, commandLine, workspaceFilePath, terminalRequest };
}
export function resumeCodexSession(options) {
    const env = options.env ?? process.env;
    const platform = options.platform ?? process.platform;
    const workspacePath = resolveLauncherWorkspacePath({ cwd: options.cwd, workspacePath: options.workspacePath, env });
    const spawn = options.spawn ?? nodeSpawn;
    const fs = options.fs ?? nodeFs;
    const codexSessionId = options.codexSessionId.trim();
    if (!codexSessionId) {
        throw new Error("codexSessionId is required");
    }
    const workspaceFilePath = options.workspaceFilePath?.trim() || defaultVscodeWorkspaceFilePath();
    const { commandLine, terminalRequest } = requestCodexInVscodeTerminal({
        mode: "resume",
        codexSessionId,
        cwd: options.cwd,
        workspacePath,
        workspaceFilePath,
        env,
        platform,
        spawn,
        fs,
        codexEnvMode: options.codexEnvMode,
    });
    return { workspacePath, commandLine, workspaceFilePath, terminalRequest, codexSessionId };
}
