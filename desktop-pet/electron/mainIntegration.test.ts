import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Electron main runtime integration", () => {
  it("routes context menus through webContents with a Windows right-button fallback into one deduped native popup", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const nativeMouseBlock = mainSource.slice(
      mainSource.indexOf("function installNativeMouseHooks"),
      mainSource.indexOf("const DAILY_SCAN_HOUR"),
    );
    const windowEventBlock = mainSource.slice(
      mainSource.indexOf('window.on("close"'),
      mainSource.indexOf('window.webContents.on("console-message"'),
    );

    expect(nativeMouseBlock).toContain("WM_RBUTTONUP");
    expect(nativeMouseBlock).toContain("nativeClickCandidateState");
    expect(nativeMouseBlock).toContain("readNativeClientPoint");
    expect(nativeMouseBlock).toContain("shouldActivateNativeWindowDrag");
    expect(nativeMouseBlock).toContain("shouldDispatchNativePetClick");
    expect(nativeMouseBlock).toContain('source: "native-click-candidate"');
    expect(nativeMouseBlock).toContain('openPetContextMenu(window, { space: "screen", point }, "native")');
    expect(nativeMouseBlock).toContain('"native-mouse:right-button-up"');
    expect(windowEventBlock).not.toContain('window.on("system-context-menu"');
    expect(windowEventBlock.match(/webContents\.on\("context-menu"/g)).toHaveLength(1);
    expect(mainSource).not.toContain('ipcMain.handle("pet:menu:open-context"');
    expect(mainSource).toContain("createNativeMenuOwnerWindow");
    expect(mainSource).toContain("Menu.buildFromTemplate");
    expect(mainSource).toContain("menu.popup({");
    expect(mainSource).toContain("toElectronMenuTemplate");
    expect(mainSource).toContain('ipcMain.handle("pet:menu:execute"');

    const leftButtonDownBlock = nativeMouseBlock.slice(
      nativeMouseBlock.indexOf("WM_LBUTTONDOWN"),
      nativeMouseBlock.indexOf("WM_MOUSEMOVE"),
    );
    expect(leftButtonDownBlock).not.toContain('startPetWindowDrag(window, "native")');
  });

  it("exposes renderer menu presentation and execution with camera-mode contextmenu suppression", () => {
    const appSource = readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf8");
    const menuWindowSource = readFileSync(path.resolve(__dirname, "../src/MenuWindow.tsx"), "utf8");
    const preloadSource = readFileSync(path.resolve(__dirname, "preload.cts"), "utf8");
    const rendererTypes = readFileSync(path.resolve(__dirname, "../src/vite-env.d.ts"), "utf8");

    expect(appSource).not.toContain("function handleContextMenu");
    expect(appSource).toContain('document.addEventListener("contextmenu"');
    expect(appSource).toContain('interactionMode !== "camera-adjust"');
    expect(preloadSource).not.toContain("openContextMenu:");
    expect(rendererTypes).not.toContain("openContextMenu:");
    expect(preloadSource).toContain('ipcRenderer.on("pet:menu:show"');
    expect(preloadSource).toContain('ipcRenderer.invoke("pet:menu:execute"');
    expect(preloadSource).toContain('ipcRenderer.send("pet:menu:request-paint"');
    expect(preloadSource).toContain('ipcRenderer.send("pet:menu:received"');
    expect(preloadSource).toContain('ipcRenderer.send("pet:menu:committed"');
    expect(rendererTypes).toContain("onShow:");
    expect(rendererTypes).toContain("execute:");
    expect(rendererTypes).toContain("requestPaint:");
    expect(rendererTypes).toContain("reportReceived:");
    expect(rendererTypes).toContain("reportCommitted:");
    expect(appSource).not.toContain("pet-context-menu");
    expect(appSource).not.toContain("window.desktopPet?.menu?.onShow");
    expect(menuWindowSource).toContain("pet-menu-window");
    expect(menuWindowSource).toContain("window.desktopPet?.menu?.onShow");
    expect(menuWindowSource).toContain("window.desktopPet?.menu?.execute");
  });

  it("forces the transparent Pet window to repaint after the renderer commits the context menu", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const paintBlock = mainSource.slice(
      mainSource.indexOf('ipcMain.on("pet:menu:request-paint"'),
      mainSource.indexOf('ipcMain.on("pet:menu:painted"'),
    );

    expect(paintBlock).toContain("BrowserWindow.fromWebContents(event.sender)");
    expect(paintBlock).toContain("window.webContents.invalidate()");
  });

  it("never starts a session refresh as a side effect of opening or closing the context menu", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const contextMenuBlock = mainSource.slice(
      mainSource.indexOf("async function openPetContextMenu"),
      mainSource.indexOf("function startPetWindowDrag"),
    );
    const popupIndex = contextMenuBlock.indexOf("openNativeContextMenu(");
    const nativeMenuBlock = mainSource.slice(
      mainSource.indexOf("function openNativeContextMenu"),
      mainSource.indexOf("function startPetWindowDrag"),
    );

    expect(popupIndex).toBeGreaterThanOrEqual(0);
    expect(contextMenuBlock).not.toContain("refreshRecentSessionsInBackground(window)");
    expect(contextMenuBlock).not.toContain("scheduleRecentSessionsRefresh");
    expect(nativeMenuBlock).not.toContain("onClosed: () => void");
    expect(nativeMenuBlock).not.toContain("onClosed();");
  });

  it("keeps the global agent snapshot refreshing outside the menu popup path", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");

    expect(mainSource).toContain("scheduleAgentSessionRefresh");
    expect(mainSource).toContain("AGENT_SESSION_REFRESH_INTERVAL_MS");
    expect(mainSource).toContain("clearInterval(agentSessionRefreshTimer)");
    expect(mainSource).toContain("void refreshRecentSessionsInBackground(window)");
    const contextMenuBlock = mainSource.slice(
      mainSource.indexOf("async function openPetContextMenu"),
      mainSource.indexOf("function startPetWindowDrag"),
    );
    expect(contextMenuBlock).not.toContain("refreshRecentSessionsInBackground");
    expect(contextMenuBlock).not.toContain("scheduleAgentSessionRefresh");
  });

  it("moves global agent session discovery off the Electron main thread", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const discoveryBlock = mainSource.slice(
      mainSource.indexOf("async function readAllLocalAgentSessions"),
      mainSource.indexOf("async function upsertDesktopPetSession"),
    );
    const workerSource = readFileSync(
      path.resolve(__dirname, "agentSessionDiscoveryWorker.ts"),
      "utf8",
    );

    expect(mainSource).toContain('new Worker(new URL("./agentSessionDiscoveryWorker.js", import.meta.url))');
    expect(mainSource).toContain("AGENT_SESSION_DISCOVERY_TIMEOUT_MS");
    expect(discoveryBlock).toContain("runAgentSessionDiscoveryInWorker(limit)");
    expect(discoveryBlock).not.toContain("scanRecentCodexSessionFiles");
    expect(discoveryBlock).not.toContain("scanRecentClaudeSessionFiles");
    expect(discoveryBlock).not.toContain("createWindowsAgentProcessScanner");
    expect(workerSource).toContain("scanRecentCodexSessionFiles");
    expect(workerSource).toContain("scanRecentClaudeSessionFiles");
    expect(workerSource).toContain("createWindowsAgentProcessScanner");
  });

  it("does not treat an unsupported process platform as a completed empty scan", () => {
    const workerSource = readFileSync(
      path.resolve(__dirname, "agentSessionDiscoveryWorker.ts"),
      "utf8",
    );
    const processRefreshBlock = workerSource.slice(
      workerSource.indexOf("let processScanCompleted"),
      workerSource.indexOf("return { candidates"),
    );

    expect(processRefreshBlock).toContain('if (process.platform === "win32")');
    expect(processRefreshBlock).toContain("processScanCompleted = true");
    expect(processRefreshBlock).not.toContain("else");
  });

  it("keeps Pet app-server sessions out of the VSCode terminal restore path", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const restoreBlock = mainSource.slice(
      mainSource.indexOf('if (action.type === "restore-session")'),
      mainSource.indexOf('if (action.type === "focus-active-session")'),
    );
    const focusBlock = mainSource.slice(
      mainSource.indexOf('if (action.type === "focus-active-session")'),
      mainSource.indexOf('if (action.type === "more-sessions")'),
    );

    expect(restoreBlock).toContain('session?.runtime === "app-server"');
    expect(restoreBlock).toContain("app-server session is already managed by Pet");
    expect(focusBlock).toContain('session?.runtime === "app-server"');
    expect(focusBlock).toContain("has no VSCode window to focus");
    expect(mainSource).toContain('item.menuSession.runtime !== "app-server"');
    expect(mainSource).toContain('item.payload.pet_session_id.startsWith("codex:")');
  });

  it("keeps the native menu owner alive but hidden after dismissal so closing it cannot terminate the app", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const ownerBlock = mainSource.slice(
      mainSource.indexOf("function createNativeMenuOwnerWindow"),
      mainSource.indexOf("function openNativeContextMenu"),
    );
    const nativeMenuBlock = mainSource.slice(
      mainSource.indexOf("function openNativeContextMenu"),
      mainSource.indexOf("function startPetWindowDrag"),
    );

    expect(ownerBlock).toContain("nativeMenuOwnerWindow.setBounds");
    expect(ownerBlock).toContain("nativeMenuOwnerWindow.show()");
    expect(ownerBlock).toContain("return nativeMenuOwnerWindow");
    expect(ownerBlock).not.toContain("nativeMenuOwnerWindow.destroy()");
    expect(ownerBlock).toContain("ownerWindow.setOpacity(0)");
    expect(nativeMenuBlock).toContain("ownerWindow.hide()");
    expect(nativeMenuBlock).not.toContain("ownerWindow.destroy()");
  });

  it("records native menu actions and the Pet/application shutdown lifecycle", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const nativeMenuBlock = mainSource.slice(
      mainSource.indexOf("function openNativeContextMenu"),
      mainSource.indexOf("function startPetWindowDrag"),
    );
    const windowLifecycleBlock = mainSource.slice(
      mainSource.indexOf('window.on("close"'),
      mainSource.indexOf('window.webContents.on("context-menu"'),
    );

    expect(nativeMenuBlock).toContain('logPetDebugEvent("context-menu:action-selected"');
    expect(windowLifecycleBlock).toContain('logPetDebugEvent("pet-window:close-requested"');
    expect(windowLifecycleBlock).toContain('window.on("closed"');
    expect(windowLifecycleBlock).toContain('logPetDebugEvent("pet-window:closed"');
    expect(mainSource).toContain('app.on("before-quit"');
    expect(mainSource).toContain('app.on("will-quit"');
    expect(mainSource).toContain('logPetDebugEvent("app:window-all-closed"');
  });

  it("re-applies persisted bounds after creating the transparent BrowserWindow", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const createWindowBlock = mainSource.slice(
      mainSource.indexOf("const window = new BrowserWindow(windowOptions)"),
      mainSource.indexOf("void refreshApiRuntimeStatus()", mainSource.indexOf("const window = new BrowserWindow(windowOptions)")),
    );

    expect(createWindowBlock).toContain("window.setBounds");
    expect(createWindowBlock).toContain("windowOptions.width");
    expect(createWindowBlock).toContain("windowOptions.height");
  });

  it("supports a fresh blank-window diagnostic that bypasses renderer menu IPC, preload, and React", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const contextMenuBlock = mainSource.slice(
      mainSource.indexOf("async function openPetContextMenu"),
      mainSource.indexOf("function startPetWindowDrag"),
    );
    const diagnosticIndex = contextMenuBlock.indexOf("contextMenuBlankDiagnosticEnabled");
    const createIndex = contextMenuBlock.indexOf("createDiagnosticBlankWindow(menuBounds");
    const nativeIndex = contextMenuBlock.indexOf("openNativeContextMenu(");

    expect(mainSource).toContain("MMD_PET_CONTEXT_MENU_DIAGNOSTIC_BLANK");
    expect(mainSource).toContain("createDiagnosticBlankBrowserWindowOptions");
    expect(contextMenuBlock).toContain('"context-menu:diagnostic-blank-created"');
    expect(diagnosticIndex).toBeGreaterThanOrEqual(0);
    expect(createIndex).toBeGreaterThan(diagnosticIndex);
    expect(nativeIndex).toBeGreaterThan(createIndex);
  });

  it("creates and destroys a separate lightweight context menu window for each opening", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");

    expect(mainSource).toContain('from "./contextMenuWindow.js"');
    expect(mainSource).toContain("createContextMenuWindow");
    expect(mainSource).toContain("createContextMenuBrowserWindowOptions");
    expect(mainSource).toContain('loadURL(`${devRendererUrl}/menu.html`)');
    expect(mainSource).toContain('loadFile(path.join(__dirname, "../dist/menu.html"))');
    expect(mainSource).toContain('"context-menu-window:renderer-ready"');
    expect(mainSource).toContain('"pet-window:renderer-ready"');
    expect(mainSource).toContain("createContextMenuBrowserWindowOptions(");
    expect(mainSource).toContain("menuWindow.destroy()");
    expect(mainSource).not.toContain("menuWindow.showInactive()");
    expect(mainSource).not.toContain("resolveContextMenuParkingBounds");
    expect(mainSource).not.toContain("pendingContextMenuReveal");
    expect(mainSource).not.toContain("parkContextMenuWindow");
  });

  it("uses renderer commit only as telemetry because the fresh menu window is already visible", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const committedBlock = mainSource.slice(
      mainSource.indexOf('ipcMain.on("pet:menu:committed"'),
      mainSource.indexOf('ipcMain.on("pet:menu:painted"'),
    );
    const paintedBlock = mainSource.slice(
      mainSource.indexOf('ipcMain.on("pet:menu:painted"'),
      mainSource.indexOf('ipcMain.handle("pet:vscode:focus"'),
    );

    expect(committedBlock).toContain('"context-menu:committed"');
    expect(committedBlock).not.toContain("revealContextMenuWindow");
    expect(paintedBlock).not.toContain("revealContextMenuWindow");
  });

  it("checks API runtime availability during startup and keeps fallback state current", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");

    expect(mainSource).toContain('from "./apiRuntime.js"');
    expect(mainSource).toContain("ensureApiRuntime({");
    expect(mainSource).toContain("lastApiAvailable = runtimeStatus.available");
    expect(mainSource).toContain("currentApiRuntimeStatus = runtimeStatus");
    expect(mainSource).toContain('"pet:api-runtime:changed"');
    expect(mainSource).toContain('"api-runtime:status"');
  });

  it("keeps the author handoff transport disabled by default and stops it with the app", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");

    expect(mainSource).toContain("MMD_PET_KNOWLEDGE_HANDOFF_TRANSPORT_ENABLED");
    expect(mainSource).toContain('process.env.MMD_PET_KNOWLEDGE_HANDOFF_TRANSPORT_ENABLED === "1"');
    expect(mainSource).toContain("startKnowledgeHandoffTransport()");
    expect(mainSource).toContain("stopKnowledgeHandoffTransport()");
    expect(mainSource).toContain('app.on("will-quit"');
  });

  it("exposes API runtime retry and status through IPC", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");

    expect(mainSource).toContain("apiRuntimeStatus: currentApiRuntimeStatus");
    expect(mainSource).toContain('"pet:api-runtime:get"');
    expect(mainSource).toContain('"pet:api-runtime:retry"');
  });

  it("applies interaction-mode menu actions in the main process before notifying the renderer", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");

    expect(mainSource).toContain('if (action.type === "interaction-mode")');
    expect(mainSource).toContain("publishInteractionMode(window, normalizeInteractionMode(action.mode))");
    expect(mainSource).toContain('window.webContents.send("pet:menu:action", { type: "interaction-mode", mode: currentInteractionMode })');
  });

  it("does not open the native context menu during camera adjustment", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const contextMenuBlock = mainSource.slice(
      mainSource.indexOf("async function openPetContextMenu"),
      mainSource.indexOf("function startPetWindowDrag"),
    );

    expect(mainSource).toContain("shouldOpenPetContextMenu");
    expect(contextMenuBlock).toContain("context-menu:ignored-camera-adjust");
    expect(contextMenuBlock.indexOf("shouldOpenPetContextMenu(currentInteractionMode)")).toBeLessThan(
      contextMenuBlock.indexOf("const now = Date.now()"),
    );
  });

  it("prevents Electron's default context menu before routing the custom menu", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const windowContextMenuBlock = mainSource.slice(
      mainSource.indexOf('window.webContents.on("context-menu"'),
      mainSource.indexOf('window.webContents.on("console-message"'),
    );

    expect(windowContextMenuBlock).toContain(
      'window.webContents.on("context-menu", (event, params) =>',
    );
    expect(windowContextMenuBlock).toContain("event.preventDefault()");
  });

  it("shows active workspaces in the context menu and switches the selected workspace from that submenu", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");

    expect(mainSource).toContain("buildActiveWorkspaceSummaries");
    expect(mainSource).toContain("activeWorkspaces: buildActiveWorkspaceSummaries(sessions)");
    expect(mainSource).toContain('if (action.type === "switch-workspace")');

    const switchBlock = mainSource.slice(
      mainSource.indexOf('if (action.type === "switch-workspace")'),
      mainSource.indexOf('if (action.type === "interaction-mode")'),
    );
    expect(switchBlock).toContain("writeSelectedWorkspacePath({");
    expect(switchBlock).toContain("workspacePath: action.workspacePath");
    expect(switchBlock).toContain('stopCodexSessionOutputWatch(window, "workspace-switched")');
    expect(switchBlock).toContain("codexCompletionTracker.reset()");
    expect(switchBlock).toContain('window.webContents.send("pet:menu:action", { type: "workspace-selected", workspacePath })');

    const selectBlock = mainSource.slice(
      mainSource.indexOf('if (action.type === "select-workspace")'),
      mainSource.indexOf('if (action.type === "switch-workspace")'),
    );
    expect(selectBlock).toContain('stopCodexSessionOutputWatch(window, "workspace-selected")');
    expect(selectBlock).toContain("codexCompletionTracker.reset()");
  });

  it("focuses active sessions without running the restore-session launcher", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");

    expect(mainSource).toContain('if (action.type === "focus-active-session")');
    expect(mainSource).toContain("focusActiveSessionWindow(window, action.petSessionId)");
    expect(mainSource).toContain('"pet:sessions:focus-active"');
    expect(mainSource).toContain("writeVscodeSessionWindowMarker");
    expect(mainSource).toContain("resolveVscodeSessionWindow");

    const focusActiveBlock = mainSource.slice(
      mainSource.indexOf('if (action.type === "focus-active-session")'),
      mainSource.indexOf('if (action.type === "more-sessions")'),
    );
    expect(focusActiveBlock).toContain("focusVscodeWorkspace({ workspacePath, userDataDir, workspaceFilePath");
    expect(focusActiveBlock).not.toContain("resumeCodexSession(");
    expect(focusActiveBlock).not.toContain("resumeClaudeSession(");
    const resolveActiveBlock = mainSource.slice(
      mainSource.indexOf("function resolveActiveSessionWindow"),
      mainSource.indexOf("function focusActiveSessionWindow"),
    );
    expect(resolveActiveBlock).not.toContain("activeSessionWindowsByWorkspace.get");
    expect(resolveActiveBlock).toContain("resolveVscodeSessionWindow({");
    expect(resolveActiveBlock).toContain('if (resolvedWindow.source === "workspace-storage")');
    expect(resolveActiveBlock).toContain("focus-active-session-workspace-fallback");
    expect(mainSource).toContain("Active task window metadata is unavailable");
  });

  it("redacts main-process session title fallbacks before publishing status or payloads", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");

    expect(mainSource).toContain('from "./codexPresentation.js"');
    expect(mainSource).toContain("resolveCodexTaskTitle(");
    expect(mainSource).toContain("session.display_title, session.first_prompt_preview, session.last_summary");
  });

  it("focuses VSCode without overwriting the current Codex status", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const menuFocusBlock = mainSource.slice(
      mainSource.indexOf('if (action.type === "focus-vscode")'),
      mainSource.indexOf('if (action.type === "notification-detail")'),
    );
    const ipcFocusBlock = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("pet:vscode:focus"'),
      mainSource.indexOf('ipcMain.handle("pet:sessions:restore"'),
    );

    expect(menuFocusBlock).toContain("focusVscodeWorkspace({ workspacePath })");
    expect(ipcFocusBlock).toContain("focusVscodeWorkspace({ workspacePath })");
    expect(menuFocusBlock).not.toContain('state: "vscode-opened"');
    expect(ipcFocusBlock).not.toContain('state: "vscode-opened"');
  });

  it("routes renderer status and completion notice focus through the selected Codex launch target", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const preloadSource = readFileSync(path.resolve(__dirname, "preload.cts"), "utf8");
    const completionSource = readFileSync(path.resolve(__dirname, "../src/CompletionNoticeWindow.tsx"), "utf8");

    expect(mainSource).toContain('ipcMain.handle("pet:codex:focus"');
    expect(mainSource).toContain("launchCodexDesktopExistingSession");
    expect(mainSource).toContain("codex-desktop-launch:focus-status");
    expect(mainSource).toContain("codex-desktop-launch:focus-approval");
    expect(mainSource).toContain("codex-desktop-launch:focus-completion");
    expect(preloadSource).toContain('"pet:codex:focus"');
    expect(completionSource).toContain("window.desktopPet.codex.focus");
    expect(completionSource).toContain("codexSessionId: notice.codexSessionId");
    expect(completionSource).not.toContain("completionNotice.focusWorkspace");
  });

  it("keeps completion-notice actions sender-checked and session-bound with app-server controls and fallback modes", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const completionWindowSource = readFileSync(
      path.resolve(__dirname, "completionNoticeWindow.ts"),
      "utf8",
    );
    const notificationCssSource = readFileSync(path.resolve(__dirname, "../src/notification.css"), "utf8");
    const completionRendererSource = readFileSync(
      path.resolve(__dirname, "../src/CompletionNoticeWindow.tsx"),
      "utf8",
    );
    const relaySource = readFileSync(path.resolve(__dirname, "codexInteractiveRelay.ts"), "utf8");
    const senderGuardBlock = mainSource.slice(
      mainSource.indexOf("function completionNoticeSenderIsCurrent"),
      mainSource.indexOf("function codexFocusSourceForRequest"),
    );
    const noticeIpcBlock = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("pet:completion-notice:status:get"'),
      mainSource.indexOf('ipcMain.handle("pet:codex:focus"'),
    );
    const stopCapabilityBlock = mainSource.slice(
      mainSource.indexOf("function completionNoticeStopSupportedForSession"),
      mainSource.indexOf("function completionNoticeSessionForNotice"),
    );
    const followUpBlock = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("pet:prompt:send-to-session"'),
      mainSource.indexOf('ipcMain.on("pet:renderer-error"'),
    );

    expect(completionWindowSource).toContain(
      "export const COMPLETION_NOTICE_EXPANDED_HEIGHT = 190",
    );
    expect(completionWindowSource).toContain(
      "noticeCount * COMPLETION_NOTICE_EXPANDED_HEIGHT +",
    );
    expect(completionWindowSource).toContain(
      "(noticeCount - 1) * COMPLETION_NOTICE_CARD_GAP",
    );
    expect(notificationCssSource).toContain("height: 190px;");
    expect(notificationCssSource).toContain("min-height: 190px;");
    expect(senderGuardBlock).toContain(
      "BrowserWindow.fromWebContents(event.sender) === window",
    );
    for (const channel of [
      "pet:completion-notice:status:get",
      "pet:completion-notice:expand",
      "pet:completion-notice:collapse",
      "pet:completion-notice:dismiss",
      "pet:completion-notice:restore",
      "pet:completion-notice:stop",
    ]) {
      const handlerStart = noticeIpcBlock.indexOf(`ipcMain.handle("${channel}"`);
      const nextHandlerStart = noticeIpcBlock.indexOf("ipcMain.handle(", handlerStart + 1);
      const handlerBlock = noticeIpcBlock.slice(
        handlerStart,
        nextHandlerStart === -1 ? undefined : nextHandlerStart,
      );

      expect(handlerStart).toBeGreaterThanOrEqual(0);
      expect(handlerBlock).toContain("completionNoticeSenderIsCurrent(event)");
    }
    expect(noticeIpcBlock).toContain('ipcMain.handle("pet:completion-notice:restore"');
    expect(noticeIpcBlock).toContain('type: "restore-session"');
    expect(noticeIpcBlock).toContain(
      'petSessionId: session.pet_session_id || session.codex_session_id || ""',
    );
    expect(noticeIpcBlock).toContain('return { ok: true, mode: "restore-requested" }');
    expect(stopCapabilityBlock).toContain("return Boolean(completionNoticeAppServerSessionId(session));");
    expect(mainSource).toContain("function completionNoticeAppServerSessionId");
    expect(noticeIpcBlock).toContain('ipcMain.handle("pet:completion-notice:stop"');
    expect(noticeIpcBlock).toContain('reason: "unsupported-runtime"');
    expect(noticeIpcBlock).toContain('message: "当前运行模式不支持自动停止"');
    expect(noticeIpcBlock).toContain("const sessionId = completionNoticeAppServerSessionId(session)");
    expect(noticeIpcBlock).toContain("getCodexInteractiveRelay().cancelTurn(sessionId)");
    expect(relaySource).toContain('mode: "stop-requested"');

    expect(completionRendererSource).toContain("继续/恢复任务");
    expect(completionRendererSource).toContain("停止任务");
    expect(completionRendererSource).toContain("继续跟进");
    expect(completionRendererSource).toContain("window.desktopPet.completionNotice.restore(key)");
    expect(completionRendererSource).toContain("window.desktopPet.completionNotice.stop(key)");
    expect(completionRendererSource).toContain("window.desktopPet.prompt.sendToSession");
    expect(completionRendererSource).toContain("workspacePath: notice.workspacePath");
    expect(completionRendererSource).toContain("petSessionId: notice.petSessionId");
    expect(completionRendererSource).toContain("codexSessionId: notice.codexSessionId");

    expect(followUpBlock).toContain("completionNoticeSenderIsCurrent(event)");
    expect(followUpBlock).toContain("workspacePath?: unknown");
    expect(followUpBlock).toContain("petSessionId?: unknown");
    expect(followUpBlock).toContain("codexSessionId?: unknown");
    expect(followUpBlock).toContain(
      "const session = findMenuSessionByPetId(petSessionId || codexSessionId)",
    );
    expect(followUpBlock).toContain("normalizeWorkspacePathIdentity(workspacePath)");
    expect(followUpBlock).toContain(
      "normalizeWorkspacePathIdentity(session.workspace_path)",
    );
    expect(followUpBlock).toContain("clipboard.writeText(promptText)");
    expect(followUpBlock).toContain('execution: "copy-only"');
    expect(followUpBlock).toContain('return { ok: true, mode: "copy-only" }');
    expect(followUpBlock).toContain("getCodexInteractiveRelay().sendUserMessage");
    expect(relaySource).toContain('mode: "follow-up-sent"');
    expect(followUpBlock).not.toContain("dispatchMenuAction(");
    expect(followUpBlock).not.toContain("startCodexSessionOutputWatch(");
    expect(followUpBlock).not.toContain("resumeCodexSession(");
  });

  it("installs crash diagnostics for renderer, child process, and main-process failures", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const crashDiagnosticsSource = readFileSync(path.resolve(__dirname, "crashDiagnostics.ts"), "utf8");

    expect(mainSource).toContain("crashReporter");
    expect(mainSource).toContain("installPetCrashDiagnostics();");
    expect(mainSource).toContain('app.on("render-process-gone"');
    expect(mainSource).toContain('app.on("child-process-gone"');
    expect(mainSource).toContain('process.on("uncaughtExceptionMonitor"');
    expect(mainSource).toContain('process.on("unhandledRejection"');
    expect(mainSource).toContain('ipcMain.on("pet:renderer-error"');
    expect(mainSource).toContain("resolveCrashDiagnosticsPaths");
    expect(crashDiagnosticsSource).toContain("crash-events.ndjson");
  });

  it("keeps watching VSCode terminal Codex sessions after launch so output reaches the Pet status card", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");

    expect(mainSource).toContain("const CODEX_SESSION_WATCH_INTERVAL_MS");
    expect(mainSource).toContain("const CODEX_SESSION_WATCH_MAX_DURATION_MS");
    expect(mainSource).toContain("function startCodexSessionOutputWatch");
    expect(mainSource).toContain("stopCodexSessionOutputWatch(window)");
    expect(mainSource).toContain('"codex-session:watch-stop"');
    expect(mainSource).toContain("startCodexSessionOutputWatch(window, result.workspacePath, {");
    expect(mainSource).toContain("startCodexSessionOutputWatch(window, result.workspacePath, {");
    expect(mainSource).toContain("codexSessionId,");
    expect(mainSource).toContain("hasMatchedSession: false");
    expect(mainSource).toContain("watch.codexSessionId = matchedSessionId");
    expect(mainSource).toContain('"codex-session:watch-session-bound"');
    expect(mainSource).toContain("item.sessionStartedAt");
    expect(mainSource).toContain("candidateAt = codexSessionId ? item.fileModifiedAt : item.sessionStartedAt");

    const refreshBlock = mainSource.slice(
      mainSource.indexOf("async function refreshLocalCodexSession"),
      mainSource.indexOf("function stopCodexSessionOutputWatch"),
    );
    expect(refreshBlock).toContain("await upsertDesktopPetSession(latest.payload)");
    expect(refreshBlock).not.toContain("for (const item of [...local].reverse())");

    const tickBlock = mainSource.slice(
      mainSource.indexOf("async function tickCodexSessionOutputWatch"),
      mainSource.indexOf("async function dispatchMenuAction"),
    );
    expect(tickBlock).toContain("allowFirstCompletion");
    expect(tickBlock).toContain("await scanAndUpsertRecentCodexSessions(window, {");
    expect(tickBlock).toContain("workspacePath: watch.workspacePath");
    expect(tickBlock).toContain("publishStatus: false");
    expect(tickBlock).toContain('stopCodexSessionOutputWatch(window, "status:completed")');
  });

  it("tracks completion occurrences in the main process without replaying historical completions", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");

    expect(mainSource).toContain('from "./codexCompletionTracker.js"');
    expect(mainSource).toContain("const codexCompletionTracker = createCodexCompletionTracker()");
    expect(mainSource).toContain("completionNoticeKey?: string");
    expect(mainSource).toContain("completionEventAt: sessionLastEventAt(session)");
    expect(mainSource).toContain("...(completionNoticeKey ? { completionNoticeKey } : {})");
  });

  it("stops the active session watcher when changing coding agents", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const agentBlock = mainSource.slice(
      mainSource.indexOf('if (action.type === "agent")'),
      mainSource.indexOf('if (action.type === "codex-env")'),
    );

    expect(agentBlock).toContain('stopCodexSessionOutputWatch(window, "agent-changed")');
    expect(agentBlock).toContain("codexSessionContext.invalidate()");
    expect(agentBlock).toContain("codexCompletionTracker.reset()");
  });

  it("drops stale async session refreshes after workspace or agent context changes", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const refreshBlock = mainSource.slice(
      mainSource.indexOf("async function refreshRecentSessionsInBackground"),
      mainSource.indexOf("async function refreshLocalCodexSession"),
    );
    const listBlock = mainSource.slice(
      mainSource.indexOf("async function listRecentSessions"),
      mainSource.indexOf("async function openPetContextMenu"),
    );

    expect(mainSource).toContain('from "./codexSessionContext.js"');
    expect(mainSource).toContain("const codexSessionContext = createCodexSessionContext()");
    expect(refreshBlock).toContain("captureActiveCodexSessionContext()");
    expect(refreshBlock).toContain("!isActiveCodexSessionContext(context)");
    expect(refreshBlock).toContain("latestDisplayableSession");
    expect(refreshBlock).toContain("!codexSessionOutputWatches.has(window)");
    expect(listBlock).toContain("if (!isActiveCodexSessionContext(context)) return []");
    expect(mainSource.match(/codexSessionContext\.invalidate\(\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(mainSource).toContain('"codex-launch:new-session-stale"');
    expect(mainSource).toContain('"codex-launch:restore-session-stale"');
  });

  it("waits for a scoped VSCode helper ACK before treating a new session as launched", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");

    expect(mainSource).toContain("waitForVscodeTerminalRequestAck");
    expect(mainSource).toContain('"codex-launch:new-session-confirmed"');
    expect(mainSource).toContain('"codex-launch:restore-session-confirmed"');
    expect(mainSource).toContain("workspaceFilePath: \"workspaceFilePath\" in result");
    expect(mainSource).toContain("commandLine: result.commandLine");
    expect(mainSource).toContain("cleanupStaleVscodeUserDataDirs(");
    expect(mainSource).toContain("cleanupStaleVscodeWorkspaceDirs(");
    expect(mainSource).toContain('ipcMain.handle("pet:clipboard:write-text"');
  });

  it("passes the persisted Codex environment to the menu and both Codex launch paths", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const newSessionBlock = mainSource.slice(
      mainSource.indexOf('if (action.type === "new-session")'),
      mainSource.indexOf('if (action.type === "restore-session")'),
    );
    const restoreSessionBlock = mainSource.slice(
      mainSource.indexOf('if (action.type === "restore-session")'),
      mainSource.indexOf('if (action.type === "focus-active-session")'),
    );

    expect(mainSource).toContain("codexEnvMode: currentCodexEnvMode");
    expect(newSessionBlock).toContain("const launchCodexEnvMode = currentCodexEnvMode");
    expect(newSessionBlock).toContain("launchNewCodexSession({ workspacePath, codexEnvMode: launchCodexEnvMode })");
    expect(restoreSessionBlock).toContain("const launchCodexEnvMode = currentCodexEnvMode");
    expect(restoreSessionBlock).toContain(
      "resumeCodexSession({ codexSessionId, workspacePath, codexEnvMode: launchCodexEnvMode })",
    );
  });

  it("persists the Codex launch target and routes new Codex sessions to Codex Desktop when selected", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const preferencesBlock = mainSource.slice(
      mainSource.indexOf("function applyPersistedPetPreferences"),
      mainSource.indexOf("function persistPetPreferences"),
    );
    const newSessionBlock = mainSource.slice(
      mainSource.indexOf('if (action.type === "new-session")'),
      mainSource.indexOf('if (action.type === "restore-session")'),
    );
    const launchTargetActionBlock = mainSource.slice(
      mainSource.indexOf('if (action.type === "codex-launch-target")'),
      mainSource.indexOf('if (action.type === "close")'),
    );
    const contextMenuBlock = mainSource.slice(
      mainSource.indexOf("async function openPetContextMenu"),
      mainSource.indexOf("function createNativeMenuOwnerWindow"),
    );

    expect(mainSource).toContain('from "./codexDesktopLauncher.js"');
    expect(mainSource).toContain('let currentCodexLaunchTarget: CodexLaunchTarget = "vscode-cli"');
    expect(preferencesBlock).toContain("settings.codexLaunchTarget ?? currentCodexLaunchTarget");
    expect(contextMenuBlock).toContain("codexLaunchTarget: currentCodexLaunchTarget");
    expect(launchTargetActionBlock).toContain("normalizeCodexLaunchTarget(action.target)");
    expect(launchTargetActionBlock).toContain("persistPetPreferences({ codexLaunchTarget: currentCodexLaunchTarget })");
    expect(newSessionBlock).toContain('launchAgent === "codex" && launchCodexTarget === "codex-desktop"');
    expect(newSessionBlock).toContain("await launchNewCodexDesktopSession({ workspacePath })");
    expect(newSessionBlock).toContain("await launchNewCodexDesktopUnboundSession()");
    expect(newSessionBlock).toContain("await dialog.showMessageBox(window");
    expect(newSessionBlock).toContain("confirmation.response !== 0");
    expect(newSessionBlock).toContain("clipboard.writeText(pathLabel)");
    expect(newSessionBlock).toContain('"codex-desktop-launch:remote-confirmation-cancelled"');
    expect(newSessionBlock.indexOf("await dialog.showMessageBox(window")).toBeLessThan(
      newSessionBlock.indexOf("await launchNewCodexDesktopUnboundSession()"),
    );
    expect(newSessionBlock.indexOf("clipboard.writeText(pathLabel)")).toBeLessThan(
      newSessionBlock.indexOf("await launchNewCodexDesktopUnboundSession()"),
    );
    expect(newSessionBlock).not.toContain("await launchCodexDesktopApp()");
    expect(newSessionBlock).toContain('"codex-desktop-launch:new-session-requested"');
    expect(newSessionBlock).toContain('"codex-desktop-launch:new-session-error"');
    expect(newSessionBlock).toContain("launchNewCodexSession({ workspacePath, codexEnvMode: launchCodexEnvMode })");
    expect(newSessionBlock).toContain("launchNewClaudeSession({ workspacePath })");
  });

  it("routes Codex Desktop restore and active-session focus through the selected Codex Desktop thread", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const restoreSessionBlock = mainSource.slice(
      mainSource.indexOf('if (action.type === "restore-session")'),
      mainSource.indexOf('if (action.type === "focus-active-session")'),
    );
    const focusActiveBlock = mainSource.slice(
      mainSource.indexOf('if (action.type === "focus-active-session")'),
      mainSource.indexOf('if (action.type === "more-sessions")'),
    );

    expect(restoreSessionBlock).toContain("const launchCodexTarget = currentCodexLaunchTarget");
    expect(restoreSessionBlock).toContain("launchCodexDesktopExistingSession({ codexSessionId })");
    const desktopRestoreBranch = restoreSessionBlock.slice(
      restoreSessionBlock.indexOf('if (launchAgent === "codex" && launchCodexTarget === "codex-desktop")'),
      restoreSessionBlock.indexOf("const result =", restoreSessionBlock.indexOf('if (launchAgent === "codex" && launchCodexTarget === "codex-desktop")')),
    );
    expect(desktopRestoreBranch).not.toContain("resumeCodexSession(");
    expect(focusActiveBlock).toContain("const launchCodexTarget = currentCodexLaunchTarget");
    expect(focusActiveBlock).toContain("launchCodexDesktopExistingSession({ codexSessionId })");
    expect(focusActiveBlock).toContain("if (currentAgent === \"codex\" && launchCodexTarget === \"codex-desktop\")");
  });

  it("invalidates the transparent Pet window after Codex status updates so unfocused status cards repaint", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const publishBlock = mainSource.slice(
      mainSource.indexOf("function publishCodexStatus"),
      mainSource.indexOf("function normalizeCodexSessionStatus"),
    );

    expect(publishBlock).toContain('window.webContents.send("pet:codex-status:changed", currentCodexStatus)');
    expect(publishBlock).toContain("window.webContents.invalidate()");
  });

  it("refreshes recent sessions after the Pet renderer finishes loading so status does not depend on opening the context menu", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const didFinishLoadBlock = mainSource.slice(
      mainSource.indexOf('window.webContents.on("did-finish-load"'),
      mainSource.indexOf("if (isDev)", mainSource.indexOf('window.webContents.on("did-finish-load"')),
    );

    expect(didFinishLoadBlock).toContain('logPetDebugEvent("renderer:did-finish-load"');
    expect(didFinishLoadBlock).toContain("void refreshRecentSessionsInBackground(window)");
  });

  it("restores and shows a minimized Pet window without stealing focus after renderer load", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const visibilityBlock = mainSource.slice(
      mainSource.indexOf("function restorePetWindowAfterRendererLoad"),
      mainSource.indexOf("async function createPetWindow"),
    );
    const didFinishLoadBlock = mainSource.slice(
      mainSource.indexOf('window.webContents.on("did-finish-load"'),
      mainSource.indexOf("if (isDev)", mainSource.indexOf('window.webContents.on("did-finish-load"')),
    );

    expect(visibilityBlock).toContain("window.isMinimized()");
    expect(visibilityBlock).toContain("window.restore()");
    expect(visibilityBlock).toContain("window.showInactive()");
    expect(visibilityBlock).toContain("!window.isVisible()");
    expect(visibilityBlock).not.toContain("window.focus()");
    expect(visibilityBlock).not.toContain("window.setBounds");
    expect(visibilityBlock.indexOf("window.restore()")).toBeLessThan(visibilityBlock.indexOf("window.showInactive()"));
    expect(didFinishLoadBlock).toContain("restorePetWindowAfterRendererLoad(window)");
    expect(didFinishLoadBlock.indexOf("restorePetWindowAfterRendererLoad(window)")).toBeLessThan(
      didFinishLoadBlock.indexOf("void writePetReadyMarkerForWindow(window)"),
    );
  });

  it("builds the context menu from memory without synchronously scanning session files", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const immediateSessionsBlock = mainSource.slice(
      mainSource.indexOf("function listImmediateMenuSessions"),
      mainSource.indexOf("function publishCodexStatusForSession"),
    );
    const contextMenuBlock = mainSource.slice(
      mainSource.indexOf("async function openPetContextMenu"),
      mainSource.indexOf("function startPetWindowDrag"),
    );

    expect(immediateSessionsBlock).toContain("lastMenuSessionsByPetId.values()");
    expect(immediateSessionsBlock).not.toContain("readLocalCodexSessions(");
    expect(contextMenuBlock.indexOf("listImmediateMenuSessions()")).toBeLessThan(
      contextMenuBlock.indexOf('logPetDebugEvent("context-menu:present"'),
    );
    expect(contextMenuBlock).not.toContain("refreshRecentSessionsInBackground(window)");
  });
});
