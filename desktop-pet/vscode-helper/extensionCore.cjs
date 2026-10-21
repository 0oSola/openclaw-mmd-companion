const path = require("node:path");
const os = require("node:os");

const REQUEST_RELATIVE_PATH = path.join(".codex-pet", "vscode-terminal-request.json");
const GLOBAL_REQUEST_PATH = path.join(os.tmpdir(), "mmd-codex-pet", "vscode-terminal-request.json");
const DEFAULT_TERMINAL_NAME = "Codex Pet";
const REQUEST_TTL_MS = 5 * 60 * 1000;

function pathApiFor(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") ? path.win32 : path;
}

function dirnameFor(value) {
  return pathApiFor(value).dirname(value);
}

function remotePathFromWorkspaceUri(value) {
  if (typeof value !== "string" || !value.toLowerCase().startsWith("vscode-remote://ssh-remote+")) return null;
  try {
    return decodeURIComponent(new URL(value).pathname || "/");
  } catch {
    return null;
  }
}

function requestPathForWorkspace(workspacePath) {
  return pathApiFor(workspacePath).join(workspacePath, ".codex-pet", "vscode-terminal-request.json");
}

function requestPathForUserDataDir(userDataDir) {
  return pathApiFor(userDataDir).join(userDataDir, ".codex-pet", "vscode-terminal-request.json");
}

function requestPathForWorkspaceFile(workspaceFilePath) {
  const pathApi = pathApiFor(workspaceFilePath);
  return pathApi.join(pathApi.dirname(workspaceFilePath), ".codex-pet", "vscode-terminal-request.json");
}

function globalRequestPath() {
  return GLOBAL_REQUEST_PATH;
}

function userDataDirFromGlobalStorageUri(globalStorageUri) {
  const globalStoragePath = typeof globalStorageUri?.fsPath === "string" ? globalStorageUri.fsPath.trim() : "";
  if (!globalStoragePath) return null;
  const pathApi = pathApiFor(globalStoragePath);
  return pathApi.dirname(pathApi.dirname(pathApi.dirname(globalStoragePath)));
}

function normalizeComparablePath(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return null;
  if (/^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith("\\\\")) {
    return path.win32.normalize(trimmed).replace(/[\\/]+$/, "").toLowerCase();
  }
  return path.resolve(trimmed).replace(/[\\/]+$/, "");
}

function requestMatchesCurrentInstance(request, { currentUserDataDir, currentWorkspaceFilePath }) {
  const targetUserDataDir = normalizeComparablePath(request.targetUserDataDir);
  const targetWorkspaceFilePath = normalizeComparablePath(request.targetWorkspaceFilePath);
  if (!targetUserDataDir && !targetWorkspaceFilePath) return true;

  const userDataDirMatches =
    !targetUserDataDir || targetUserDataDir === normalizeComparablePath(currentUserDataDir);
  const workspaceFileMatches =
    !targetWorkspaceFilePath || targetWorkspaceFilePath === normalizeComparablePath(currentWorkspaceFilePath);
  return userDataDirMatches && workspaceFileMatches;
}

function parseTerminalRequest(raw) {
  const request = JSON.parse(raw);
  if (!request || typeof request !== "object") return null;
  if (typeof request.id !== "string" || !request.id.trim()) return null;
  if (typeof request.commandLine !== "string" || !request.commandLine.trim()) return null;
  return request;
}

function readTerminalRequest(fs, requestPath) {
  try {
    return parseTerminalRequest(fs.readFileSync(requestPath, "utf8"));
  } catch {
    return null;
  }
}

function findTerminal(vscode, terminalName) {
  return vscode.window.terminals.find((terminal) => terminal.name === terminalName) || null;
}

function deleteRequestFile(fs, requestPath) {
  try {
    fs.unlinkSync?.(requestPath);
  } catch {
    // Best-effort cleanup only. A failed delete should not block terminal launch.
  }
}

function isRequestExpired(request, nowMs) {
  if (typeof request.expiresAt === "string") {
    const expiresAtMs = Date.parse(request.expiresAt);
    if (Number.isFinite(expiresAtMs) && nowMs > expiresAtMs) return true;
  }
  if (typeof request.createdAt !== "string") return false;
  const createdAtMs = Date.parse(request.createdAt);
  return Number.isFinite(createdAtMs) && nowMs - createdAtMs > REQUEST_TTL_MS;
}

function deleteRequestFiles(fs, requestPaths) {
  for (const requestPath of requestPaths) {
    deleteRequestFile(fs, requestPath);
  }
}

function writeRequestAck({ fs, request, nowMs, currentUserDataDir, currentWorkspaceFilePath, log }) {
  const ackPath = typeof request.ackPath === "string" ? request.ackPath.trim() : "";
  if (!ackPath) return true;
  if (typeof fs.mkdirSync !== "function" || typeof fs.writeFileSync !== "function") {
    log?.("terminal request ack unavailable", { requestId: request.id, ackPath });
    return false;
  }
  const payload = {
    id: request.id,
    handledAt: new Date(nowMs).toISOString(),
    target: {
      userDataDir: request.targetUserDataDir || currentUserDataDir || null,
      workspaceFilePath: request.targetWorkspaceFilePath || currentWorkspaceFilePath || null,
    },
  };
  try {
    fs.mkdirSync(dirnameFor(ackPath), { recursive: true });
    fs.writeFileSync(ackPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return true;
  } catch (error) {
    log?.("terminal request ack failed", {
      requestId: request.id,
      ackPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function handleRequestFile({
  vscode,
  fs,
  requestPath,
  workspacePath,
  handledRequestIds,
  currentUserDataDir,
  currentWorkspaceFilePath,
  nowMs = Date.now(),
  log,
  cleanupPaths = [requestPath],
}) {
  if (!fs.existsSync(requestPath)) return null;

  const request = readTerminalRequest(fs, requestPath);
  if (!request) {
    log?.("terminal request unreadable", { requestPath, workspacePath });
    return null;
  }
  if (!requestMatchesCurrentInstance(request, { currentUserDataDir, currentWorkspaceFilePath })) {
    log?.("terminal request targets another VSCode instance", {
      requestPath,
      requestId: request.id,
      targetUserDataDir: request.targetUserDataDir,
      targetWorkspaceFilePath: request.targetWorkspaceFilePath,
      currentUserDataDir,
      currentWorkspaceFilePath,
    });
    return null;
  }
  if (isRequestExpired(request, nowMs)) {
    handledRequestIds.add(request.id);
    deleteRequestFiles(fs, cleanupPaths);
    log?.("terminal request expired", { requestPath, requestId: request.id, workspacePath });
    return null;
  }
  if (handledRequestIds.has(request.id)) {
    log?.("terminal request already handled", { requestPath, requestId: request.id, workspacePath });
    if (writeRequestAck({ fs, request, nowMs, currentUserDataDir, currentWorkspaceFilePath, log })) {
      deleteRequestFiles(fs, cleanupPaths);
    }
    return null;
  }

  const cwd = remotePathFromWorkspaceUri(request.workspacePath) || request.workspacePath || workspacePath;
  const terminalName = request.terminalName || DEFAULT_TERMINAL_NAME;
  const terminal =
    findTerminal(vscode, terminalName) ||
    vscode.window.createTerminal({
      name: terminalName,
      cwd,
    });
  terminal.show(true);
  terminal.sendText(request.commandLine, true);
  handledRequestIds.add(request.id);
  const ackWritten = writeRequestAck({ fs, request, nowMs, currentUserDataDir, currentWorkspaceFilePath, log });
  if (ackWritten) deleteRequestFiles(fs, cleanupPaths);
  log?.("terminal request sent", { requestPath, requestId: request.id, workspacePath });
  return request;
}

function handleWorkspaceRequest({
  vscode,
  fs,
  workspacePath,
  handledRequestIds,
  currentUserDataDir,
  currentWorkspaceFilePath,
  nowMs = Date.now(),
  log,
}) {
  const requestPath = requestPathForWorkspace(workspacePath);
  return handleRequestFile({
    vscode,
    fs,
    requestPath,
    workspacePath,
    handledRequestIds,
    currentUserDataDir,
    currentWorkspaceFilePath,
    nowMs,
    log,
  });
}

function handleGlobalRequest({
  vscode,
  fs,
  handledRequestIds,
  currentUserDataDir,
  currentWorkspaceFilePath,
  nowMs = Date.now(),
  log,
}) {
  const requestPath = globalRequestPath();
  if (!fs.existsSync(requestPath)) return null;

  const request = readTerminalRequest(fs, requestPath);
  if (!request) {
    log?.("global terminal request unreadable", { requestPath });
    return null;
  }
  const workspacePath = typeof request.workspacePath === "string" && request.workspacePath.trim() ? request.workspacePath : null;
  if (!workspacePath) {
    log?.("global terminal request missing workspacePath", { requestPath, requestId: request.id });
    return null;
  }
  const workspaceRequestPath = requestPathForWorkspace(workspacePath);
  const workspaceRequest = fs.existsSync(workspaceRequestPath) ? readTerminalRequest(fs, workspaceRequestPath) : null;
  if (!workspaceRequest || workspaceRequest.id !== request.id) {
    log?.("global terminal request missing matching workspace request", {
      requestPath,
      requestId: request.id,
      workspacePath,
      workspaceRequestPath,
    });
    if (isRequestExpired(request, nowMs)) {
      deleteRequestFile(fs, requestPath);
    }
    return null;
  }

  return handleRequestFile({
    vscode,
    fs,
    requestPath,
    workspacePath,
    handledRequestIds,
    currentUserDataDir,
    currentWorkspaceFilePath,
    nowMs,
    log,
    cleanupPaths: [requestPath, workspaceRequestPath],
  });
}

function handleAllWorkspaceRequests({
  vscode,
  fs,
  handledRequestIds,
  currentUserDataDir,
  currentWorkspaceFilePath,
  nowMs = Date.now(),
  log,
}) {
  const workspaceFolders = vscode.workspace.workspaceFolders || [];
  const handled = [];
  const scopedRequestPaths = [];
  if (currentUserDataDir) {
    scopedRequestPaths.push({
      requestPath: requestPathForUserDataDir(currentUserDataDir),
      workspacePath: workspaceFolders[0]?.uri?.fsPath || dirnameFor(currentWorkspaceFilePath || currentUserDataDir),
    });
  }
  if (currentWorkspaceFilePath) {
    scopedRequestPaths.push({
      requestPath: requestPathForWorkspaceFile(currentWorkspaceFilePath),
      workspacePath: dirnameFor(currentWorkspaceFilePath),
    });
  }
  const seenScopedPaths = new Set();
  for (const scopedRequest of scopedRequestPaths) {
    const requestPathKey = normalizeComparablePath(scopedRequest.requestPath);
    if (!requestPathKey || seenScopedPaths.has(requestPathKey)) continue;
    seenScopedPaths.add(requestPathKey);
    const request = handleRequestFile({
      vscode,
      fs,
      requestPath: scopedRequest.requestPath,
      workspacePath: scopedRequest.workspacePath,
      handledRequestIds,
      currentUserDataDir,
      currentWorkspaceFilePath,
      nowMs,
      log,
    });
    if (request) handled.push(request);
  }
  for (const folder of workspaceFolders) {
    const request = handleWorkspaceRequest({
      vscode,
      fs,
      workspacePath: folder.uri.fsPath,
      handledRequestIds,
      currentUserDataDir,
      currentWorkspaceFilePath,
      nowMs,
      log,
    });
    if (request) handled.push(request);
  }
  const globalRequest = handleGlobalRequest({
    vscode,
    fs,
    handledRequestIds,
    currentUserDataDir,
    currentWorkspaceFilePath,
    nowMs,
    log,
  });
  if (globalRequest) handled.push(globalRequest);
  return handled;
}

module.exports = {
  DEFAULT_TERMINAL_NAME,
  GLOBAL_REQUEST_PATH,
  REQUEST_RELATIVE_PATH,
  REQUEST_TTL_MS,
  globalRequestPath,
  handleAllWorkspaceRequests,
  handleGlobalRequest,
  handleRequestFile,
  handleWorkspaceRequest,
  parseTerminalRequest,
  readTerminalRequest,
  requestMatchesCurrentInstance,
  requestPathForUserDataDir,
  requestPathForWorkspace,
  requestPathForWorkspaceFile,
  userDataDirFromGlobalStorageUri,
};
