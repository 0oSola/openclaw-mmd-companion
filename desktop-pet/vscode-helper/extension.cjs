const fs = require("node:fs");
const vscode = require("vscode");

const {
  REQUEST_RELATIVE_PATH,
  handleAllWorkspaceRequests,
  userDataDirFromGlobalStorageUri,
} = require("./extensionCore.cjs");

const handledRequestIds = new Set();
const RUN_SOON_DELAY_MS = 150;
const REQUEST_POLL_INTERVAL_MS = 1000;
let lastWorkspaceSignature = null;
let outputChannel = null;
let currentUserDataDir = null;

function debugEnabled() {
  return process.env.NODE_ENV !== "test";
}

function logDebug(message, payload) {
  if (!debugEnabled()) return;
  const suffix = payload ? ` ${JSON.stringify(payload)}` : "";
  const line = `[mmd-codex-pet-vscode-helper] ${message}${suffix}`;
  console.log(line);
  outputChannel?.appendLine(line);
}

function runPendingRequests(reason = "manual") {
  const workspacePaths = (vscode.workspace.workspaceFolders || []).map((folder) => folder.uri.fsPath);
  const currentWorkspaceFilePath = vscode.workspace.workspaceFile?.fsPath || null;
  const workspaceSignature = [...workspacePaths, currentWorkspaceFilePath || ""].join("|");
  if (workspaceSignature !== lastWorkspaceSignature) {
    lastWorkspaceSignature = workspaceSignature;
    logDebug("workspace folders", { reason, workspacePaths, workspaceFilePath: currentWorkspaceFilePath });
  }
  const handled = handleAllWorkspaceRequests({
    vscode,
    fs,
    handledRequestIds,
    currentUserDataDir,
    currentWorkspaceFilePath,
    log: (message, payload) => logDebug(message, { reason, ...payload }),
  });
  if (handled.length > 0) {
    logDebug("handled terminal requests", {
      reason,
      requestIds: handled.map((request) => request.id),
    });
  }
  return handled;
}

function activate(context) {
  currentUserDataDir = userDataDirFromGlobalStorageUri(context.globalStorageUri);
  outputChannel = vscode.window.createOutputChannel?.("MMD Codex Pet Helper") || null;
  if (outputChannel) context.subscriptions.push(outputChannel);

  context.subscriptions.push(
    vscode.commands.registerCommand("mmd-codex-pet.runPendingTerminalRequest", () => {
      runPendingRequests("command");
    }),
  );

  const watcher = vscode.workspace.createFileSystemWatcher(`**/${REQUEST_RELATIVE_PATH.replaceAll("\\", "/")}`);
  const runSoon = (reason = "scheduled") => setTimeout(() => runPendingRequests(reason), RUN_SOON_DELAY_MS);
  context.subscriptions.push(watcher);
  context.subscriptions.push(watcher.onDidCreate(() => runSoon("watcher-create")));
  context.subscriptions.push(watcher.onDidChange(() => runSoon("watcher-change")));
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      runSoon("workspace-folders-change");
    }),
  );
  const pollTimer = setInterval(() => runPendingRequests("poll"), REQUEST_POLL_INTERVAL_MS);
  context.subscriptions.push({
    dispose: () => clearInterval(pollTimer),
  });

  logDebug("activated", { userDataDir: currentUserDataDir });
  runSoon("activation");
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
