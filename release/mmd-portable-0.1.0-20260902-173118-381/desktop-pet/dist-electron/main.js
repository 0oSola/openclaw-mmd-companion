import { BrowserWindow, Menu, app, clipboard, crashReporter, dialog, ipcMain, screen, } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { isInjectedCodexContext, resolveCodexTaskTitle } from "./codexPresentation.js";
import { resolveContextMenuPosition, } from "./contextMenuPosition.js";
import { createDiagnosticBlankBrowserWindowOptions, createContextMenuBrowserWindowOptions, resolveContextMenuWindowBounds, } from "./contextMenuWindow.js";
import { ensureApiRuntime } from "./apiRuntime.js";
import { shouldSuppressDuplicateContextMenuPopup, } from "./contextMenuDedup.js";
import { focusVscodeWorkspace, launchNewCodexSession, resumeCodexSession, waitForVscodeTerminalRequestAck, } from "./codexLauncher.js";
import { launchCodexDesktopExistingSession, launchNewCodexDesktopSession, launchNewCodexDesktopUnboundSession, } from "./codexDesktopLauncher.js";
import { buildDesktopPetSessionPayload, resolveCodexHome, scanRecentCodexSessionFiles, } from "./codexSessionFiles.js";
import { enrichAgentSessionRecords, } from "./agentSessionDiscovery.js";
import { CodexInteractiveRelay, } from "./codexInteractiveRelay.js";
import { createCodexCompletionTracker } from "./codexCompletionTracker.js";
import { createCodexSessionContext, } from "./codexSessionContext.js";
import { launchNewClaudeSession, resumeClaudeSession, } from "./claudeLauncher.js";
import { buildClaudeDesktopPetSessionPayload, resolveClaudeHome, scanRecentClaudeSessionFiles, } from "./claudeSessionFiles.js";
import { cleanupStaleVscodeUserDataDirs, cleanupStaleVscodeWorkspaceDirs, } from "./vscodeUserDataCleanup.js";
import { resolveVscodeSessionWindow, writeVscodeSessionWindowMarker, } from "./vscodeSessionWindows.js";
import { normalizeWorkspacePathIdentity } from "./workspacePathIdentity.js";
import { resolveCrashDiagnosticsPaths, serializeCrashError, writePetCrashEvent, } from "./crashDiagnostics.js";
import { DEFAULT_INTERACTION_MODE, normalizeInteractionMode, shouldOpenPetContextMenu, } from "./interactionMode.js";
import { WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE, WM_RBUTTONUP, hasNativeClickMoved, readNativeClientPoint, shouldActivateNativeWindowDrag, shouldDispatchNativePetClick, } from "./nativeMouseInput.js";
import { createPetBrowserWindowOptions } from "./petWindowOptions.js";
import { calculateEndedWindowDragBounds, calculateDraggedWindowBounds, shouldAcceptWindowDragStart, shouldApplyWindowDragMove, } from "./windowDrag.js";
import { buildActiveWorkspaceSummaries, buildPetMenuModel, normalizeMenuLanguage, normalizeNotificationProfile, normalizeCodexEnvMode, normalizeCodexLaunchTarget, normalizePetAgent, PET_AGENT_LABELS, } from "./petMenuModel.js";
import { applyPetAlwaysOnTop } from "./petAlwaysOnTop.js";
import { fetchCodexRemoteWorkspaces } from "./codexWorkspaceApi.js";
import { discoverCodexDesktopProjects } from "./codexDesktopProjects.js";
import { DEFAULT_REMOTE_HOST_PROFILE, loadRemoteProjectCatalog, refreshRemoteProjectCatalog, } from "./remoteProjectCatalog.js";
import { launchRemoteCodexSession } from "./remoteCodexCliLauncher.js";
import { isSshWorkspaceUri } from "./remoteWorkspace.js";
import { toElectronMenuTemplate } from "./electronMenuTemplate.js";
import { createKnowledgeHandoffTransport, safeKnowledgeHandoffError, } from "./knowledgeHandoffTransport.js";
import { calculateCompletionNoticePosition, completionNoticeWindowSize, createCompletionNoticeBrowserWindowOptions, createCompletionNoticeReducerState, parseDismissedCompletionNoticeKeys, reduceCompletionNoticeState, serializeDismissedCompletionNoticeKeys, toCompletionNoticeWindowState, } from "./completionNoticeWindow.js";
import { readPetSettings, resolveSelectedWorkspacePath, resolvePetCodexEnvMode, writePetSettings, writeSelectedWorkspacePath, } from "./petSettingsStore.js";
import { indexPetMenuSessions } from "./petMenuSessionIndex.js";
import { resolveProductionRendererPage, resolveProductionRendererRoot, } from "./rendererPaths.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const releaseMode = app.isPackaged || process.env.MMD_PET_RELEASE === "1";
const isDev = !releaseMode;
const devRendererUrl = process.env.MMD_PET_RENDERER_URL ?? `http://127.0.0.1:${process.env.MMD_PET_DEV_PORT ?? "5174"}`;
const productionRendererRoot = resolveProductionRendererRoot(__dirname, process.env.MMD_PET_RENDERER_DIST_DIR);
const remoteDebuggingPort = process.env.MMD_PET_REMOTE_DEBUGGING_PORT?.trim();
if (isDev && remoteDebuggingPort) {
    app.commandLine.appendSwitch("remote-debugging-port", remoteDebuggingPort);
}
const apiBaseUrl = process.env.MMD_PET_API_BASE_URL ?? "http://127.0.0.1:8000";
const menuUserId = process.env.MMD_PET_USER_ID ?? "admin-1";
const debugEventsEnabled = process.env.MMD_PET_DEBUG_EVENTS === "1";
const contextMenuBlankDiagnosticEnabled = process.env.MMD_PET_CONTEXT_MENU_DIAGNOSTIC_BLANK === "1";
const knowledgeHandoffTransportEnabled = process.env.MMD_PET_KNOWLEDGE_HANDOFF_TRANSPORT_ENABLED === "1";
const completionNoticeDemoEnabled = isDev && process.env.MMD_PET_COMPLETION_NOTICE_DEMO === "1";
const debugEventsLogPath = process.env.MMD_PET_DEBUG_EVENTS_LOG ?? path.join(process.cwd(), "desktop-pet-debug-events.ndjson");
const petReadyFilePath = process.env.MMD_PET_READY_FILE?.trim()
    ? path.resolve(process.env.MMD_PET_READY_FILE.trim())
    : null;
const crashDiagnosticsPaths = resolveCrashDiagnosticsPaths({ cwd: process.cwd(), env: process.env });
const CODEX_SESSION_WATCH_INTERVAL_MS = 2500;
const CODEX_SESSION_WATCH_MAX_DURATION_MS = 60 * 60 * 1000;
const AGENT_SESSION_REFRESH_INTERVAL_MS = 15 * 1000;
let currentInteractionMode = DEFAULT_INTERACTION_MODE;
let currentNotificationProfile = "medium";
let currentMenuLanguage = "en";
let currentAlwaysOnTop = true;
let currentAgent = "codex";
let currentCodexEnvMode = "win";
let currentCodexLaunchTarget = "vscode-cli";
let currentCodexRemoteWorkspaces = [];
let currentRemoteProjectCatalog = null;
let currentCodexStatus = { state: "idle" };
const codexCompletionTracker = createCodexCompletionTracker();
const codexSessionContext = createCodexSessionContext();
let knowledgeHandoffTransport = null;
let currentApiRuntimeStatus = null;
let lastApiAvailable = true;
let lastMenuPopup;
let contextMenuActive = false;
let lastContextMenuClosedAtMs;
let lastMenuSessionsByPetId = new Map();
let completionNoticeDemoSessionsById = new Map();
let petWindow = null;
let contextMenuWindow = null;
let diagnosticBlankWindow = null;
let nativeMenuOwnerWindow = null;
let completionNoticeWindow = null;
let completionNoticeState = createCompletionNoticeReducerState();
let completionNoticePersistencePath = null;
let completionNoticeDisplayMetricsListenerInstalled = false;
let codexInteractiveRelay = null;
const windowDragState = new WeakMap();
const nativeClickCandidateState = new WeakMap();
let activeSessionWindowsByPetId = new Map();
let activeSessionWindowsByWorkspace = new Map();
const codexSessionOutputWatches = new WeakMap();
let agentSessionRefreshTimer = null;
function writePetReadyMarker(payload) {
    if (!petReadyFilePath)
        return;
    try {
        fs.mkdirSync(path.dirname(petReadyFilePath), { recursive: true });
        fs.writeFileSync(petReadyFilePath, `${JSON.stringify({
            version: 1,
            pid: process.pid,
            mode: isDev ? "dev" : "release",
            checkedAt: new Date().toISOString(),
            ...payload,
        }, null, 2)}\n`, "utf8");
    }
    catch (error) {
        logPetDebugEvent("pet-ready-marker:write-error", {
            path: petReadyFilePath,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
function removePetReadyMarker() {
    if (!petReadyFilePath || !fs.existsSync(petReadyFilePath))
        return;
    try {
        const current = JSON.parse(fs.readFileSync(petReadyFilePath, "utf8"));
        if (Number(current.pid) !== process.pid)
            return;
        fs.rmSync(petReadyFilePath, { force: true });
    }
    catch (error) {
        logPetDebugEvent("pet-ready-marker:remove-error", {
            path: petReadyFilePath,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
async function writePetReadyMarkerForWindow(window) {
    let rendererShellReady = false;
    try {
        rendererShellReady = Boolean(await window.webContents.executeJavaScript("document.readyState === 'complete' && Boolean(document.querySelector('#root')?.firstElementChild)", true));
    }
    catch (error) {
        logPetDebugEvent("pet-ready-marker:renderer-check-error", {
            error: error instanceof Error ? error.message : String(error),
        });
    }
    const rendererUrl = window.webContents.getURL();
    writePetReadyMarker({
        rendererPage: "index",
        rendererRoot: productionRendererRoot,
        rendererFile: isDev
            ? null
            : resolveProductionRendererPage(productionRendererRoot, "index"),
        rendererUrl,
        rendererShellReady,
    });
}
async function loadRendererPage(window, page) {
    if (isDev) {
        if (page === "menu") {
            await window.loadURL(`${devRendererUrl}/menu.html`);
            return;
        }
        if (page === "notification") {
            await window.loadURL(`${devRendererUrl}/notification.html`);
            return;
        }
        await window.loadURL(devRendererUrl);
        return;
    }
    const rendererFile = resolveProductionRendererPage(productionRendererRoot, page);
    if (page === "menu" && !process.env.MMD_PET_RENDERER_DIST_DIR) {
        await window.loadFile(path.join(__dirname, "../dist/menu.html"));
        return;
    }
    await window.loadFile(rendererFile);
}
function logPetDebugEvent(type, payload = {}) {
    if (!debugEventsEnabled)
        return;
    fs.appendFileSync(debugEventsLogPath, `${JSON.stringify({ at: new Date().toISOString(), type, ...payload })}\n`, "utf8");
}
function logPetCrashEvent(type, payload = {}) {
    try {
        writePetCrashEvent({
            eventsLogPath: crashDiagnosticsPaths.eventsLogPath,
            type,
            payload,
        });
    }
    catch {
        // Crash diagnostics must never become the reason the app exits.
    }
    logPetDebugEvent(`crash:${type}`, {
        ...payload,
        eventsLogPath: crashDiagnosticsPaths.eventsLogPath,
        crashDumpsDir: crashDiagnosticsPaths.crashDumpsDir,
    });
}
function startKnowledgeHandoffTransport() {
    if (!knowledgeHandoffTransportEnabled) {
        logPetDebugEvent("knowledge-handoff:disabled", {
            flag: "MMD_PET_KNOWLEDGE_HANDOFF_TRANSPORT_ENABLED",
        });
        return;
    }
    if (knowledgeHandoffTransport)
        return;
    const codexHome = resolveCodexHome(process.env);
    knowledgeHandoffTransport = createKnowledgeHandoffTransport({
        handoffRoot: path.join(codexHome, "knowledge-handoffs"),
        queueFile: path.join(app.getPath("userData"), "knowledge-handoff-transport", "queue.json"),
        apiBaseUrl,
        transportToken: process.env.MMD_PET_KNOWLEDGE_HANDOFF_TOKEN,
        autoDrain: true,
        onLog: (event, payload) => logPetDebugEvent(event, payload),
    });
    void knowledgeHandoffTransport.start().catch((error) => {
        knowledgeHandoffTransport = null;
        logPetDebugEvent("knowledge-handoff:start-error", {
            error: safeKnowledgeHandoffError(error),
        });
    });
}
function stopKnowledgeHandoffTransport() {
    knowledgeHandoffTransport?.stop();
    knowledgeHandoffTransport = null;
}
function installPetCrashDiagnostics() {
    try {
        fs.mkdirSync(crashDiagnosticsPaths.crashDumpsDir, { recursive: true });
        app.setPath("crashDumps", crashDiagnosticsPaths.crashDumpsDir);
        crashReporter.start({
            productName: "MMD Codex Pet",
            uploadToServer: false,
            compress: true,
            globalExtra: {
                component: "desktop-pet",
                mode: isDev ? "dev" : "prod",
            },
        });
        logPetCrashEvent("crash-reporter:started", {
            eventsLogPath: crashDiagnosticsPaths.eventsLogPath,
            crashDumpsDir: app.getPath("crashDumps"),
            uploadToServer: false,
        });
    }
    catch (error) {
        logPetCrashEvent("crash-reporter:start-error", serializeCrashError(error));
    }
    process.on("uncaughtExceptionMonitor", (error, origin) => {
        logPetCrashEvent("main:uncaught-exception", {
            origin,
            ...serializeCrashError(error),
        });
    });
    process.on("unhandledRejection", (reason) => {
        logPetCrashEvent("main:unhandled-rejection", serializeCrashError(reason));
    });
    process.on("warning", (warning) => {
        logPetCrashEvent("main:warning", serializeCrashError(warning));
    });
    app.on("render-process-gone", (_event, webContents, details) => {
        logPetCrashEvent("renderer:gone", {
            ...details,
            webContentsId: webContents.id,
            url: webContents.getURL(),
        });
    });
    app.on("child-process-gone", (_event, details) => {
        logPetCrashEvent("child-process:gone", details);
    });
}
installPetCrashDiagnostics();
function logRendererDomState(window, label) {
    if (!debugEventsEnabled || window.isDestroyed())
        return;
    window.webContents
        .executeJavaScript(`(() => ({
        url: window.location.href,
        readyState: document.readyState,
        bodyText: document.body?.innerText?.slice(0, 240) ?? "",
        bodyHtmlLength: document.body?.innerHTML?.length ?? 0,
        hasPetShell: Boolean(document.querySelector(".pet-shell")),
        hasPetStage: Boolean(document.querySelector(".pet-stage")),
        hasHitSurface: Boolean(document.querySelector(".pet-input-hit-surface")),
        hasPetStatus: Boolean(document.querySelector(".pet-status")),
        hasDesktopPet: Boolean(window.desktopPet),
      }))()`, true)
        .then((state) => logPetDebugEvent("renderer:dom-state", { label, state }))
        .catch((error) => logPetDebugEvent("renderer:dom-state-error", { label, error: error.message }));
}
function readCurrentPetSettings() {
    return readPetSettings({ userDataPath: app.getPath("userData") });
}
function applyPersistedPetPreferences() {
    const settings = readCurrentPetSettings();
    currentNotificationProfile = settings.notificationProfile ?? currentNotificationProfile;
    currentMenuLanguage = settings.menuLanguage ?? currentMenuLanguage;
    currentAlwaysOnTop = settings.alwaysOnTop ?? currentAlwaysOnTop;
    currentAgent = settings.agent ?? currentAgent;
    currentCodexEnvMode = resolvePetCodexEnvMode({ userDataPath: app.getPath("userData") });
    currentCodexLaunchTarget = settings.codexLaunchTarget ?? currentCodexLaunchTarget;
    return settings;
}
function persistPetPreferences(patch) {
    try {
        return writePetSettings({
            userDataPath: app.getPath("userData"),
            patch,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logPetDebugEvent("settings:write-error", { error: message });
        return undefined;
    }
}
function persistPetWindowBounds(window) {
    if (window.isDestroyed())
        return;
    persistPetPreferences({ windowBounds: window.getBounds() });
}
function publishApiRuntimeStatus(runtimeStatus) {
    currentApiRuntimeStatus = runtimeStatus;
    if (runtimeStatus) {
        lastApiAvailable = runtimeStatus.available;
    }
    else {
        lastApiAvailable = false;
    }
    for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
            window.webContents.send("pet:api-runtime:changed", currentApiRuntimeStatus);
        }
    }
}
async function refreshApiRuntimeStatus() {
    try {
        const runtimeStatus = await ensureApiRuntime({
            apiBaseUrl,
            cwd: process.cwd(),
            env: process.env,
        });
        lastApiAvailable = runtimeStatus.available;
        currentApiRuntimeStatus = runtimeStatus;
        publishApiRuntimeStatus(runtimeStatus);
        logPetDebugEvent("api-runtime:status", runtimeStatus);
        return runtimeStatus;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        publishApiRuntimeStatus(null);
        logPetDebugEvent("api-runtime:error", { apiBaseUrl, error: message });
        return null;
    }
}
function resolveCurrentWorkspacePath() {
    return resolveSelectedWorkspacePath({
        cwd: process.cwd(),
        env: process.env,
        userDataPath: app.getPath("userData"),
    });
}
function catalogWorkspacesFromSnapshot(snapshot) {
    return snapshot.projects.map((project) => ({
        id: project.projectKey,
        path: project.remotePath,
        source: "codex-desktop-ssh",
        kind: "ssh",
        remoteAuthority: project.hostDisplayName,
        label: `${project.label} · ${project.hostDisplayName}`,
        projectId: project.desktopProjectId ?? project.projectKey,
        projectKind: "remote",
        hostId: project.desktopHostId,
        hostDisplayName: project.hostDisplayName,
        sshHost: project.sshHost,
        isGitRepository: project.isGitRepository,
        availability: project.availability,
    }));
}
function loadCodexRemoteWorkspaces() {
    const userDataPath = app.getPath("userData");
    const desktopProjects = discoverCodexDesktopProjects();
    currentRemoteProjectCatalog = loadRemoteProjectCatalog({
        userDataPath,
        desktopProjects,
        profile: DEFAULT_REMOTE_HOST_PROFILE,
    });
    currentCodexRemoteWorkspaces = catalogWorkspacesFromSnapshot(currentRemoteProjectCatalog);
    return currentCodexRemoteWorkspaces;
}
async function refreshCodexRemoteWorkspaces() {
    const userDataPath = app.getPath("userData");
    const desktopProjects = discoverCodexDesktopProjects();
    currentRemoteProjectCatalog = await refreshRemoteProjectCatalog({
        userDataPath,
        desktopProjects,
        profile: DEFAULT_REMOTE_HOST_PROFILE,
    });
    const catalogWorkspaces = catalogWorkspacesFromSnapshot(currentRemoteProjectCatalog);
    try {
        const apiWorkspaces = await fetchCodexRemoteWorkspaces({ apiBaseUrl, userId: menuUserId });
        const seen = new Set(catalogWorkspaces.map((workspace) => workspace.path));
        currentCodexRemoteWorkspaces = [
            ...catalogWorkspaces,
            ...apiWorkspaces.filter((workspace) => workspace.source === "codex-desktop-ssh" && !seen.has(workspace.path)),
        ];
        logPetDebugEvent("codex-workspaces:refreshed", { count: currentCodexRemoteWorkspaces.length });
        return currentCodexRemoteWorkspaces;
    }
    catch (error) {
        logPetDebugEvent("codex-workspaces:refresh-error", { error: error instanceof Error ? error.message : String(error) });
        currentCodexRemoteWorkspaces = catalogWorkspaces;
        return currentCodexRemoteWorkspaces;
    }
}
function captureActiveCodexSessionContext() {
    const workspacePath = resolveCurrentWorkspacePath();
    const agent = currentAgent;
    return {
        snapshot: codexSessionContext.capture({ workspacePath, agent }),
        workspacePath,
        agent,
    };
}
function isActiveCodexSessionContext(context) {
    return codexSessionContext.isCurrent(context.snapshot, {
        workspacePath: resolveCurrentWorkspacePath(),
        agent: currentAgent,
    });
}
function publishInteractionMode(window, mode) {
    currentInteractionMode = mode;
    window.webContents.send("pet:interaction-mode:changed", currentInteractionMode);
}
function readPersistedCompletionNoticeKeys() {
    if (!completionNoticePersistencePath)
        return [];
    try {
        return parseDismissedCompletionNoticeKeys(fs.readFileSync(completionNoticePersistencePath, "utf8"));
    }
    catch {
        return [];
    }
}
function persistCompletionNoticeKeys(keys) {
    if (!completionNoticePersistencePath)
        return;
    try {
        fs.mkdirSync(path.dirname(completionNoticePersistencePath), { recursive: true });
        fs.writeFileSync(completionNoticePersistencePath, serializeDismissedCompletionNoticeKeys(keys), "utf8");
    }
    catch (error) {
        logPetDebugEvent("completion-notice:persist-error", {
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
function getUsableCompletionNoticeWindow() {
    if (!completionNoticeWindow ||
        completionNoticeWindow.isDestroyed() ||
        completionNoticeWindow.webContents.isDestroyed()) {
        return null;
    }
    return completionNoticeWindow;
}
function broadcastCompletionNoticeState() {
    const window = getUsableCompletionNoticeWindow();
    if (!window)
        return;
    window.webContents.send("pet:completion-notice:status:changed", toCompletionNoticeWindowState(completionNoticeState));
}
function positionCompletionNoticeWindow() {
    const window = getUsableCompletionNoticeWindow();
    if (!window || !petWindow || petWindow.isDestroyed())
        return;
    if (!completionNoticeState.notices.length)
        return;
    const petBounds = petWindow.getBounds();
    const workArea = screen.getDisplayMatching(petBounds).workArea;
    const size = completionNoticeWindowSize(completionNoticeState.notices.length, completionNoticeState.expanded);
    const position = calculateCompletionNoticePosition(petBounds, size, workArea);
    window.setBounds({ ...position, ...size }, false);
}
function destroyCompletionNoticeWindow() {
    const window = getUsableCompletionNoticeWindow();
    if (!window) {
        completionNoticeWindow = null;
        return;
    }
    completionNoticeWindow = null;
    if (!window.isDestroyed())
        window.destroy();
}
async function ensureCompletionNoticeWindow() {
    if (!completionNoticeState.notices.length || !petWindow || petWindow.isDestroyed())
        return;
    const existingWindow = getUsableCompletionNoticeWindow();
    if (existingWindow) {
        positionCompletionNoticeWindow();
        if (!existingWindow.isVisible())
            existingWindow.showInactive();
        return;
    }
    const window = new BrowserWindow(createCompletionNoticeBrowserWindowOptions(path.join(__dirname, "preload.cjs")));
    completionNoticeWindow = window;
    window.setMenuBarVisibility(false);
    window.setAlwaysOnTop(true, "floating");
    window.webContents.once("did-finish-load", () => {
        if (completionNoticeWindow !== window || window.isDestroyed())
            return;
        broadcastCompletionNoticeState();
        positionCompletionNoticeWindow();
        if (completionNoticeState.notices.length && !window.isVisible())
            window.showInactive();
    });
    window.on("closed", () => {
        if (completionNoticeWindow === window)
            completionNoticeWindow = null;
    });
    try {
        await loadRendererPage(window, "notification");
    }
    catch (error) {
        logPetDebugEvent("completion-notice:load-error", {
            error: error instanceof Error ? error.message : String(error),
        });
        if (!window.isDestroyed())
            window.destroy();
    }
}
function publishCompletionNoticeState() {
    broadcastCompletionNoticeState();
    if (completionNoticeState.notices.length) {
        void ensureCompletionNoticeWindow();
        positionCompletionNoticeWindow();
    }
    else {
        destroyCompletionNoticeWindow();
    }
}
function seedCompletionNoticeDemo() {
    if (!completionNoticeDemoEnabled)
        return;
    const demoSessions = [
        {
            pet_session_id: "demo-pet-session-mmd-project",
            codex_session_id: "demo-codex-session-mmd-project",
            agent: "codex",
            runtime: "app-server",
            workspace_path: "D:\\workspace\\MMD project",
            display_title: "MMD project",
            last_summary: "Motion checks passed; rendered the final Pet preview.",
            last_status: "completed",
            metadata: { last_output: "Motion checks passed; rendered the final Pet preview." },
        },
        {
            pet_session_id: "demo-pet-session-codex-pet",
            codex_session_id: "demo-codex-session-codex-pet",
            agent: "codex",
            runtime: "app-server",
            workspace_path: "D:\\workspace\\Codex Pet",
            display_title: "浮窗通知堆叠验证",
            last_summary: "Expanded and compact layouts are ready for review.",
            last_status: "completed",
            metadata: { last_output: "Expanded and compact layouts are ready for review." },
        },
        {
            pet_session_id: "demo-pet-session-motion-lab",
            codex_session_id: "demo-codex-session-motion-lab",
            agent: "codex",
            runtime: "app-server",
            workspace_path: "D:\\workspace\\Motion Lab",
            display_title: "任务完成通知交互测试",
            last_summary: "Three completion cards passed the interaction checks.",
            last_status: "completed",
            metadata: { last_output: "Three completion cards passed the interaction checks." },
        },
    ];
    completionNoticeDemoSessionsById = new Map(demoSessions.flatMap((session) => {
        const entries = [];
        const petSessionId = compactText(session.pet_session_id);
        const codexSessionId = compactText(session.codex_session_id);
        if (petSessionId)
            entries.push([petSessionId, session]);
        if (codexSessionId)
            entries.push([codexSessionId, session]);
        return entries;
    }));
    for (const session of demoSessions) {
        const key = sessionMenuKey(session);
        if (key)
            lastMenuSessionsByPetId.set(key, session);
        if (session.codex_session_id)
            lastMenuSessionsByPetId.set(session.codex_session_id, session);
    }
    const demoNotices = [
        {
            state: "completed",
            workspacePath: "D:\\workspace\\MMD project",
            sessionTitle: "MMD project",
            petSessionId: "demo-pet-session-mmd-project",
            codexSessionId: "demo-codex-session-mmd-project",
            agent: "codex",
            runtime: "app-server",
            lastOutput: "Motion checks passed; rendered the final Pet preview.",
            completionNoticeKey: "demo-completion-mmd-project",
        },
        {
            state: "completed",
            workspacePath: "D:\\workspace\\Codex Pet",
            sessionTitle: "浮窗通知堆叠验证",
            petSessionId: "demo-pet-session-codex-pet",
            codexSessionId: "demo-codex-session-codex-pet",
            agent: "codex",
            runtime: "app-server",
            lastOutput: "Expanded and compact layouts are ready for review.",
            completionNoticeKey: "demo-completion-codex-pet",
        },
        {
            state: "completed",
            workspacePath: "D:\\workspace\\Motion Lab",
            sessionTitle: "任务完成通知交互测试",
            petSessionId: "demo-pet-session-motion-lab",
            codexSessionId: "demo-codex-session-motion-lab",
            agent: "codex",
            runtime: "app-server",
            lastOutput: "Three completion cards passed the interaction checks.",
            completionNoticeKey: "demo-completion-motion-lab",
        },
    ];
    for (const status of demoNotices) {
        completionNoticeState = reduceCompletionNoticeState(completionNoticeState, {
            type: "status",
            status,
            agentLabel: PET_AGENT_LABELS.codex,
        });
    }
    publishCompletionNoticeState();
    logPetDebugEvent("completion-notice:demo-seeded", {
        count: completionNoticeState.notices.length,
        expanded: completionNoticeState.expanded,
    });
}
function completionNoticeSenderIsCurrent(event) {
    const window = getUsableCompletionNoticeWindow();
    return Boolean(window && BrowserWindow.fromWebContents(event.sender) === window);
}
function codexFocusSourceForRequest(event, requestedSource) {
    if (requestedSource === "status" ||
        requestedSource === "approval" ||
        requestedSource === "completion") {
        return requestedSource;
    }
    if (completionNoticeSenderIsCurrent(event))
        return "completion";
    return "status";
}
function codexFocusLogType(source, suffix = "") {
    const base = {
        status: "codex-desktop-launch:focus-status",
        approval: "codex-desktop-launch:focus-approval",
        completion: "codex-desktop-launch:focus-completion",
    }[source];
    return `${base}${suffix}`;
}
function codexFocusRequestOptions(rawOptions) {
    if (!rawOptions || typeof rawOptions !== "object")
        return {};
    const options = rawOptions;
    return {
        ...(typeof options.workspacePath === "string" && options.workspacePath.trim()
            ? { workspacePath: options.workspacePath.trim() }
            : {}),
        ...(typeof options.codexSessionId === "string" && options.codexSessionId.trim()
            ? { codexSessionId: options.codexSessionId.trim() }
            : {}),
        ...(options.source !== undefined ? { source: options.source } : {}),
    };
}
function publishCodexStatus(window, status, options = {}) {
    const { completionNoticeKey: _ignoredCompletionNoticeKey, ...nextStatus } = status;
    const completionNoticeKey = codexCompletionTracker.observe({
        state: nextStatus.state,
        codexSessionId: nextStatus.codexSessionId,
        eventAt: options.completionEventAt,
    }, { allowFirstCompletion: options.allowFirstCompletion });
    currentCodexStatus = {
        ...nextStatus,
        ...(completionNoticeKey ? { completionNoticeKey } : {}),
        updatedAt: new Date().toISOString(),
    };
    const completionStatus = {
        state: currentCodexStatus.state,
        workspacePath: currentCodexStatus.workspacePath,
        sessionTitle: currentCodexStatus.sessionTitle,
        petSessionId: currentCodexStatus.petSessionId,
        codexSessionId: currentCodexStatus.codexSessionId,
        agent: currentCodexStatus.agent,
        runtime: currentCodexStatus.runtime,
        stopSupported: currentCodexStatus.stopSupported,
        lastOutput: currentCodexStatus.lastOutput,
        completionNoticeKey: currentCodexStatus.completionNoticeKey,
    };
    completionNoticeState = reduceCompletionNoticeState(completionNoticeState, {
        type: "status",
        status: completionStatus,
        agentLabel: PET_AGENT_LABELS[currentAgent],
    });
    publishCompletionNoticeState();
    logPetDebugEvent("codex-status:changed", currentCodexStatus);
    if (window.isDestroyed() || window.webContents.isDestroyed())
        return;
    window.webContents.send("pet:codex-status:changed", currentCodexStatus);
    window.webContents.invalidate();
}
const KNOWN_SESSION_STATUSES = new Set([
    "idle",
    "starting",
    "running",
    "command_running",
    "file_changed",
    "waiting_approval",
    "completed",
    "failed",
    "disconnected",
]);
const ACTIVE_CODEX_SESSION_STATUSES = new Set([
    "starting",
    "running",
    "command_running",
    "file_changed",
    "waiting_approval",
]);
function normalizeCodexSessionStatus(value) {
    return KNOWN_SESSION_STATUSES.has(value) ? value : "running";
}
function sessionMenuKey(session) {
    return String(session.pet_session_id || session.codex_session_id || "");
}
function compactText(value) {
    return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}
function trimOutputText(value) {
    return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
}
function sessionTitle(session) {
    return resolveCodexTaskTitle([session.display_title, session.first_prompt_preview, session.last_summary], session.workspace_path, 80);
}
function sessionLastOutput(session) {
    const metadata = session.metadata && typeof session.metadata === "object" ? session.metadata : {};
    return trimOutputText(metadata.last_output) || trimOutputText(session.last_summary) || undefined;
}
function sessionLastEventAt(session) {
    const metadata = session.metadata && typeof session.metadata === "object" ? session.metadata : {};
    return compactText(metadata.last_event_at) || compactText(metadata.lastEventAt) || undefined;
}
function activeSessionWorkspaceKey(workspacePath, agent) {
    return `${agent}:${normalizeWorkspacePathIdentity(workspacePath)}`;
}
function latestSessionForWorkspace(sessions, workspacePath, agent) {
    const workspaceKey = activeSessionWorkspaceKey(workspacePath, agent);
    return sessions.find((session) => {
        const sessionWorkspacePath = compactText(session.workspace_path);
        return Boolean(sessionWorkspacePath) && activeSessionWorkspaceKey(sessionWorkspacePath, agent) === workspaceKey;
    });
}
function sessionVscodeUserDataDir(session) {
    const metadata = session?.metadata && typeof session.metadata === "object" ? session.metadata : {};
    return compactText(metadata.vscode_user_data_dir) || compactText(metadata.vscodeUserDataDir);
}
function sessionVscodeWorkspaceFilePath(session) {
    const metadata = session?.metadata && typeof session.metadata === "object" ? session.metadata : {};
    return compactText(metadata.vscode_workspace_file_path) || compactText(metadata.vscodeWorkspaceFilePath);
}
function findMenuSessionByPetId(petSessionId) {
    const key = compactText(petSessionId);
    if (!key)
        return undefined;
    return (lastMenuSessionsByPetId.get(key) ||
        completionNoticeDemoSessionsById.get(key) ||
        Array.from(lastMenuSessionsByPetId.values()).find((session) => session.pet_session_id === key || session.codex_session_id === key) ||
        Array.from(completionNoticeDemoSessionsById.values()).find((session) => session.pet_session_id === key || session.codex_session_id === key));
}
function completionNoticeRuntimeForSession(session) {
    if (session?.runtime === "app-server")
        return "app-server";
    if (session?.agent === "claude")
        return "claude";
    if (currentCodexEnvMode === "wsl")
        return "wsl";
    if (currentCodexLaunchTarget === "codex-desktop")
        return "codex-desktop";
    return "cli";
}
function completionNoticeInteractiveMode(session) {
    const metadata = session?.metadata && typeof session.metadata === "object"
        ? session.metadata
        : {};
    const mode = compactText(metadata.mode);
    return mode || "read_only";
}
function completionNoticeAppServerSessionId(session) {
    if (session?.runtime !== "app-server")
        return "";
    const sessionId = compactText(session.codex_session_id);
    return /^codex_sess_[a-f0-9]+$/i.test(sessionId) ? sessionId : "";
}
function completionNoticeStopSupportedForSession(session) {
    return Boolean(completionNoticeAppServerSessionId(session));
}
function getCodexInteractiveRelay() {
    if (!codexInteractiveRelay) {
        codexInteractiveRelay = new CodexInteractiveRelay({
            apiBaseUrl,
            userId: menuUserId,
            onEvent: (sessionId, event) => handleCodexInteractiveEvent(sessionId, event),
            onLog: (event, payload) => logPetDebugEvent(`codex-interactive:${event}`, payload),
        });
    }
    return codexInteractiveRelay;
}
function publishCodexInteractiveEventStatus(sessionId, event) {
    const session = findMenuSessionByPetId(sessionId);
    if (!session || !petWindow || petWindow.isDestroyed())
        return;
    const type = compactText(event.type);
    const eventText = compactText(event.text) ||
        compactText(event.final_text) ||
        compactText(event.error) ||
        compactText(event.message);
    const baseStatus = {
        state: type === "turn_completed"
            ? "completed"
            : type === "turn_failed"
                ? /cancelled/i.test(eventText)
                    ? "idle"
                    : "failed"
                : "running",
        workspacePath: session.workspace_path || undefined,
        sessionTitle: sessionTitle(session),
        petSessionId: session.pet_session_id || undefined,
        codexSessionId: session.codex_session_id || undefined,
        agent: session.agent === "claude" ? "claude" : "codex",
        runtime: "app-server",
        stopSupported: completionNoticeStopSupportedForSession(session),
        lastOutput: eventText || sessionLastOutput(session),
        source: "app-server",
    };
    publishCodexStatus(petWindow, baseStatus);
}
function handleCodexInteractiveEvent(sessionId, event) {
    const type = compactText(event.type);
    if (!["turn_started", "text_delta", "plan_delta", "command_output", "turn_completed", "turn_failed"].includes(type)) {
        return;
    }
    publishCodexInteractiveEventStatus(sessionId, event);
}
function completionNoticeSessionForNotice(noticeKey) {
    const notice = completionNoticeState.notices.find((item) => item.key === noticeKey);
    if (!notice)
        return { notice: undefined, session: undefined };
    const sessionKey = compactText(notice.petSessionId) || compactText(notice.codexSessionId);
    return {
        notice,
        session: sessionKey ? findMenuSessionByPetId(sessionKey) : undefined,
    };
}
function cacheActiveSessionWindow(options) {
    const workspacePath = compactText(options.workspacePath);
    const userDataDir = compactText(options.userDataDir);
    const workspaceFilePath = compactText(options.workspaceFilePath);
    if (!workspacePath || (!userDataDir && !workspaceFilePath))
        return null;
    const record = {
        workspacePath,
        userDataDir: userDataDir || undefined,
        workspaceFilePath: workspaceFilePath || undefined,
        petSessionId: compactText(options.petSessionId) || undefined,
        codexSessionId: compactText(options.codexSessionId) || undefined,
        agent: options.agent ?? currentAgent,
        updatedAt: new Date().toISOString(),
    };
    for (const key of [record.petSessionId, record.codexSessionId].filter((value) => Boolean(value))) {
        activeSessionWindowsByPetId.set(key, record);
    }
    activeSessionWindowsByWorkspace.set(activeSessionWorkspaceKey(record.workspacePath, record.agent), record);
    if (options.persistMarker !== false) {
        try {
            writeVscodeSessionWindowMarker(record);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logPetDebugEvent("codex-launch:active-session-window-marker-error", {
                workspacePath: record.workspacePath,
                petSessionId: record.petSessionId,
                codexSessionId: record.codexSessionId,
                agent: record.agent,
                error: message,
            });
        }
    }
    logPetDebugEvent("codex-launch:active-session-window-cache", {
        workspacePath: record.workspacePath,
        hasUserDataDir: Boolean(record.userDataDir),
        hasWorkspaceFilePath: Boolean(record.workspaceFilePath),
        petSessionId: record.petSessionId,
        codexSessionId: record.codexSessionId,
        agent: record.agent,
    });
    return record;
}
function bindActiveSessionWindowToSession(session, options = {}) {
    const workspacePath = compactText(session.workspace_path);
    if (!workspacePath)
        return null;
    const agent = options.agent ?? currentAgent;
    const workspaceRecord = activeSessionWindowsByWorkspace.get(activeSessionWorkspaceKey(workspacePath, agent));
    const userDataDir = compactText(options.userDataDir) || workspaceRecord?.userDataDir || sessionVscodeUserDataDir(session);
    const workspaceFilePath = compactText(options.workspaceFilePath) || workspaceRecord?.workspaceFilePath || sessionVscodeWorkspaceFilePath(session);
    if (!userDataDir && !workspaceFilePath)
        return null;
    return cacheActiveSessionWindow({
        workspacePath,
        userDataDir,
        workspaceFilePath,
        petSessionId: session.pet_session_id,
        codexSessionId: session.codex_session_id,
        agent,
    });
}
function resolveActiveSessionWindow(petSessionId, session) {
    const requestedPetSessionId = compactText(petSessionId);
    const memoryRecord = activeSessionWindowsByPetId.get(requestedPetSessionId) ||
        activeSessionWindowsByPetId.get(compactText(session?.pet_session_id)) ||
        activeSessionWindowsByPetId.get(compactText(session?.codex_session_id));
    if (memoryRecord)
        return memoryRecord;
    const workspacePath = compactText(session?.workspace_path);
    if (!workspacePath)
        return undefined;
    const resolvedWindow = resolveVscodeSessionWindow({
        workspacePath,
        petSessionId: compactText(session?.pet_session_id) || requestedPetSessionId,
        codexSessionId: compactText(session?.codex_session_id),
        agent: currentAgent,
    });
    const userDataDir = resolvedWindow?.userDataDir;
    const workspaceFilePath = resolvedWindow?.workspaceFilePath;
    if (!userDataDir && !workspaceFilePath)
        return undefined;
    if (resolvedWindow.source === "workspace-storage") {
        logPetDebugEvent("codex-launch:focus-active-session-workspace-fallback", {
            workspacePath,
            petSessionId: session?.pet_session_id || requestedPetSessionId,
            codexSessionId: session?.codex_session_id,
            agent: currentAgent,
        });
        return {
            workspacePath,
            userDataDir,
            workspaceFilePath,
            petSessionId: compactText(session?.pet_session_id) || requestedPetSessionId || undefined,
            codexSessionId: compactText(session?.codex_session_id) || undefined,
            agent: currentAgent,
            updatedAt: new Date().toISOString(),
        };
    }
    return cacheActiveSessionWindow({
        workspacePath,
        userDataDir,
        workspaceFilePath,
        petSessionId: session?.pet_session_id || requestedPetSessionId,
        codexSessionId: session?.codex_session_id,
        agent: currentAgent,
    }) ?? undefined;
}
function focusActiveSessionWindow(window, petSessionId) {
    const session = findMenuSessionByPetId(petSessionId);
    const activeWindow = resolveActiveSessionWindow(petSessionId, session);
    const workspacePath = activeWindow?.workspacePath || compactText(session?.workspace_path);
    const userDataDir = activeWindow?.userDataDir || sessionVscodeUserDataDir(session);
    const workspaceFilePath = activeWindow?.workspaceFilePath || sessionVscodeWorkspaceFilePath(session);
    const title = session ? sessionTitle(session) : "Codex session";
    const codexSessionId = compactText(session?.codex_session_id) || activeWindow?.codexSessionId;
    if (!workspacePath || (!userDataDir && !workspaceFilePath)) {
        const message = "Active task window metadata is unavailable";
        const fallbackWorkspacePath = workspacePath || resolveCurrentWorkspacePath();
        logPetDebugEvent("codex-launch:focus-active-session-error", {
            petSessionId,
            workspacePath: fallbackWorkspacePath,
            codexSessionId,
            error: message,
        });
        publishCodexStatus(window, {
            state: "failed",
            workspacePath: fallbackWorkspacePath,
            sessionTitle: title,
            codexSessionId,
            error: message,
            source: "terminal",
        });
        throw new Error(message);
    }
    return { workspacePath, userDataDir, workspaceFilePath, sessionTitle: title, codexSessionId };
}
function toPetMenuSession(payload, lastSeenAt) {
    return {
        ...payload,
        last_seen_at: lastSeenAt ?? null,
        updated_at: lastSeenAt ?? null,
    };
}
function readLocalCodexSessions(workspacePath, limit = 10, agent = currentAgent) {
    if (isSshWorkspaceUri(workspacePath))
        return [];
    if (agent === "claude") {
        const claudeHome = resolveClaudeHome(process.env);
        return scanRecentClaudeSessionFiles({
            claudeHome,
            workspacePath,
            limit,
            maxFiles: Math.max(120, limit * 8),
        }).map((summary) => {
            const payload = buildClaudeDesktopPetSessionPayload(summary, claudeHome);
            return {
                payload,
                menuSession: toPetMenuSession(payload, summary.fileModifiedAt),
                sessionStartedAt: summary.sessionStartedAt,
                fileModifiedAt: summary.fileModifiedAt,
            };
        });
    }
    const codexHome = resolveCodexHome(process.env);
    const wslCodexHome = process.env.CODEX_WSL_HOME?.trim() || "\\\\wsl.localhost\\Ubuntu\\home\\ksg\\.codex";
    return scanRecentCodexSessionFiles({
        codexHome,
        wslCodexHome,
        workspacePath,
        limit,
        maxFiles: Math.max(120, limit * 8),
    }).map((summary) => {
        const payload = buildDesktopPetSessionPayload(summary, codexHome);
        return {
            payload,
            menuSession: toPetMenuSession(payload, summary.fileModifiedAt),
            sessionStartedAt: summary.sessionStartedAt,
            fileModifiedAt: summary.fileModifiedAt,
        };
    });
}
function latestDisplayableSession(sessions, workspacePath, agent) {
    return (latestSessionForWorkspace(sessions, workspacePath, agent) ||
        sessions.find((session) => ACTIVE_CODEX_SESSION_STATUSES.has(normalizeCodexSessionStatus(session.last_status))) ||
        sessions[0]);
}
function toMenuSessionFromAgentRecord(session, agentHome) {
    const primaryEvidence = session.evidence.find((evidence) => evidence.source !== "process") ?? session.evidence[0];
    const firstPromptPreview = session.firstPromptPreview && !isInjectedCodexContext(session.firstPromptPreview)
        ? session.firstPromptPreview
        : null;
    const displayTitle = resolveCodexTaskTitle([session.displayTitle, firstPromptPreview, session.lastSummary], session.workspacePath, 80);
    const payload = {
        pet_session_id: `${session.provider}:${session.sessionId}`,
        codex_session_id: session.sessionId,
        workspace_id: null,
        workspace_path: session.workspacePath,
        codex_home: agentHome,
        display_title: displayTitle,
        first_prompt_preview: firstPromptPreview,
        last_summary: session.lastSummary,
        last_status: session.state,
        launch_mode: session.agent === "claude" || session.runtime === "app-server" ? "interactive" : "workspace-write",
        remote_url: null,
        app_server_pid: session.processId,
        app_server_port: null,
        metadata: {
            source: primaryEvidence?.source ?? "unknown",
            provider: session.provider,
            runtime: session.runtime,
            host_id: session.hostId,
            session_file: primaryEvidence?.sessionFile ?? session.sessionFile,
            session_file_mtime: primaryEvidence?.sessionFileModifiedAt ?? session.lastActivityAt,
            session_started_at: session.sessionStartedAt,
            originator: session.originator,
            codex_source: session.source,
            cli_version: session.cliVersion,
            git_branch: session.gitBranch,
            last_event_at: session.lastEventAt,
            last_output: session.lastOutput,
            process_alive: session.processAlive,
            process_started_at: session.processStartedAt,
            process_name: session.processName,
            process_runtime: session.processRuntime,
            evidence: session.evidence,
            facts: session.reviewFacts,
        },
    };
    return {
        payload,
        menuSession: {
            ...payload,
            agent: session.agent,
            runtime: session.runtime,
            last_seen_at: session.lastActivityAt,
            updated_at: session.lastActivityAt,
        },
        sessionStartedAt: session.sessionStartedAt,
        fileModifiedAt: primaryEvidence?.sessionFileModifiedAt ?? session.lastActivityAt,
    };
}
const AGENT_SESSION_DISCOVERY_TIMEOUT_MS = 30_000;
let agentSessionDiscoveryInFlight = null;
function runAgentSessionDiscoveryInWorker(limit) {
    if (agentSessionDiscoveryInFlight)
        return agentSessionDiscoveryInFlight;
    const request = {
        codexHome: resolveCodexHome(process.env),
        wslCodexHome: process.env.CODEX_WSL_HOME?.trim() || "\\\\wsl.localhost\\Ubuntu\\home\\ksg\\.codex",
        claudeHome: resolveClaudeHome(process.env),
        apiBaseUrl,
        userId: menuUserId,
        limit,
    };
    const worker = new Worker(new URL("./agentSessionDiscoveryWorker.js", import.meta.url));
    const promise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            void worker.terminate();
            reject(new Error(`Agent session discovery timed out after ${AGENT_SESSION_DISCOVERY_TIMEOUT_MS}ms`));
        }, AGENT_SESSION_DISCOVERY_TIMEOUT_MS);
        worker.once("message", (message) => {
            clearTimeout(timeout);
            if (message.ok && message.result) {
                resolve(message.result);
            }
            else {
                reject(new Error(message.error || "Agent session discovery worker failed"));
            }
        });
        worker.once("error", (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        worker.once("exit", (code) => {
            if (code !== 0)
                reject(new Error(`Agent session discovery worker exited with code ${code}`));
        });
        worker.postMessage(request);
    }).finally(() => {
        void worker.terminate();
        agentSessionDiscoveryInFlight = null;
    });
    agentSessionDiscoveryInFlight = promise;
    return promise;
}
function restoreCachedProcessObservation(session) {
    if (session.provider !== "pet-app-server")
        return session;
    const cached = lastMenuSessionsByPetId.get(`pet-app-server:${session.sessionId}`);
    const metadata = cached?.metadata ?? {};
    const cachedProcessAlive = typeof metadata.process_alive === "boolean" ? metadata.process_alive : null;
    const cachedProcessStartedAt = typeof metadata.process_started_at === "string" ? metadata.process_started_at : null;
    const cachedProcessName = typeof metadata.process_name === "string" ? metadata.process_name : null;
    return {
        ...session,
        processAlive: session.processAlive ?? cachedProcessAlive,
        processStartedAt: session.processStartedAt ?? cachedProcessStartedAt,
        processName: session.processName ?? cachedProcessName,
    };
}
async function readAllLocalAgentSessions(limit = 50) {
    const discovery = await runAgentSessionDiscoveryInWorker(limit);
    for (const providerError of discovery.providerErrors) {
        logPetDebugEvent("agent-session:provider-error", providerError);
    }
    const candidates = discovery.candidates;
    const records = candidates.map(({ session }) => restoreCachedProcessObservation(session));
    const enrichedRecords = enrichAgentSessionRecords(records, discovery.processObservations, { scanCompleted: discovery.processScanCompleted });
    const agentHomesBySessionKey = new Map(candidates.map(({ session, agentHome }) => [session.sessionKey, agentHome]));
    return enrichedRecords
        .map((session) => toMenuSessionFromAgentRecord(session, agentHomesBySessionKey.get(session.sessionKey) ?? null))
        .sort((left, right) => {
        const timeDelta = Date.parse(right.fileModifiedAt) - Date.parse(left.fileModifiedAt);
        return timeDelta || sessionMenuKey(left.menuSession).localeCompare(sessionMenuKey(right.menuSession));
    });
}
async function upsertDesktopPetSession(payload) {
    const response = await fetch(`${apiBaseUrl}/desktop-pet/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": menuUserId },
        body: JSON.stringify(payload),
    });
    if (!response.ok)
        throw new Error(`session upsert failed: ${response.status}`);
    return (await response.json());
}
function payloadFromMenuSession(session, lastStatus) {
    const codexSessionId = session.codex_session_id?.trim();
    const workspacePath = session.workspace_path?.trim();
    if (!codexSessionId || !workspacePath)
        return null;
    return {
        pet_session_id: session.pet_session_id || `codex:${codexSessionId}`,
        codex_session_id: codexSessionId,
        workspace_id: session.workspace_id ?? null,
        workspace_path: workspacePath,
        codex_home: session.codex_home ?? resolveCodexHome(process.env),
        display_title: resolveCodexTaskTitle([session.display_title, session.first_prompt_preview, session.last_summary], workspacePath, 48),
        first_prompt_preview: session.first_prompt_preview ?? null,
        last_summary: session.last_summary ?? null,
        last_status: lastStatus ?? normalizeCodexSessionStatus(session.last_status),
        launch_mode: session.launch_mode || "workspace-write",
        remote_url: session.remote_url ?? null,
        app_server_pid: session.app_server_pid ?? null,
        app_server_port: session.app_server_port ?? null,
        metadata: session.metadata ?? {},
    };
}
function mergeSessions(apiSessions, localSessions, limit = 10) {
    const byKey = new Map();
    for (const session of apiSessions) {
        const key = sessionMenuKey(session);
        if (key)
            byKey.set(key, session);
    }
    for (const session of localSessions) {
        const key = sessionMenuKey(session);
        if (!key)
            continue;
        byKey.set(key, { ...(byKey.get(key) ?? {}), ...session });
    }
    return Array.from(byKey.values())
        .sort((left, right) => {
        const leftTime = Date.parse(left.last_seen_at || left.updated_at || "");
        const rightTime = Date.parse(right.last_seen_at || right.updated_at || "");
        const timeDelta = (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
        return timeDelta || sessionMenuKey(left).localeCompare(sessionMenuKey(right));
    })
        .slice(0, limit);
}
function cacheMenuSessions(sessions) {
    lastMenuSessionsByPetId = indexPetMenuSessions(sessions);
}
function listImmediateMenuSessions() {
    return Array.from(lastMenuSessionsByPetId.values()).slice(0, 10);
}
function publishCodexStatusForSession(window, session, options = {}) {
    const agent = session.agent === "claude" ? "claude" : (options.agent ?? currentAgent);
    publishCodexStatus(window, {
        state: normalizeCodexSessionStatus(session.last_status),
        workspacePath: session.workspace_path || undefined,
        sessionTitle: sessionTitle(session),
        petSessionId: session.pet_session_id || undefined,
        codexSessionId: session.codex_session_id || undefined,
        agent,
        runtime: completionNoticeRuntimeForSession(session),
        stopSupported: completionNoticeStopSupportedForSession(session),
        lastOutput: sessionLastOutput(session),
        source: session.runtime === "app-server"
            ? "app-server"
            : agent === "claude"
                ? "claude-jsonl"
                : "codex-jsonl",
    }, {
        allowFirstCompletion: options.allowFirstCompletion,
        completionEventAt: sessionLastEventAt(session),
    });
}
function shouldUpsertSessionsToApi(agent = currentAgent) {
    // Claude sessions are tracked purely from the local JSONL transcripts and are
    // never written to the FastAPI desktop-pet registry (that registry is Codex's
    // cross-machine review surface). Codex keeps its existing API upsert path.
    return agent === "codex";
}
async function syncLocalAgentSessions(context, limit = 10) {
    const local = await readAllLocalAgentSessions(limit);
    if (!isActiveCodexSessionContext(context))
        return [];
    // Global discovery is read-only for the menu. Keep the legacy review registry
    // sync scoped to the selected Codex workspace until the independent activity
    // registry exists, so merely observing another workspace does not rewrite
    // desktop_pet_sessions review data.
    const reviewSyncCandidates = context.agent === "codex"
        ? [...local]
            .filter((candidate) => candidate.payload.pet_session_id.startsWith("codex:") &&
            normalizeWorkspacePathIdentity(candidate.menuSession.workspace_path) ===
                normalizeWorkspacePathIdentity(context.workspacePath))
            .reverse()
        : [];
    for (const item of reviewSyncCandidates) {
        try {
            await upsertDesktopPetSession(item.payload);
            if (!isActiveCodexSessionContext(context))
                return [];
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logPetDebugEvent("codex-session:upsert-error", {
                workspacePath: context.workspacePath,
                codexSessionId: item.payload.codex_session_id,
                error: message,
            });
            break;
        }
    }
    if (!isActiveCodexSessionContext(context))
        return [];
    return local.map((item) => item.menuSession);
}
async function refreshRecentSessionsInBackground(window) {
    const context = captureActiveCodexSessionContext();
    try {
        const sessions = await listRecentSessions(10, context);
        if (window.isDestroyed() || !isActiveCodexSessionContext(context))
            return;
        const session = latestDisplayableSession(sessions, context.workspacePath, context.agent);
        if (session && !codexSessionOutputWatches.has(window)) {
            publishCodexStatusForSession(window, session, { agent: context.agent });
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logPetDebugEvent("codex-session:background-refresh-error", { error: message });
    }
}
function scheduleAgentSessionRefresh(window) {
    if (agentSessionRefreshTimer) {
        clearInterval(agentSessionRefreshTimer);
        agentSessionRefreshTimer = null;
    }
    let inFlight = false;
    agentSessionRefreshTimer = setInterval(() => {
        if (window.isDestroyed()) {
            if (agentSessionRefreshTimer) {
                clearInterval(agentSessionRefreshTimer);
                agentSessionRefreshTimer = null;
            }
            return;
        }
        if (inFlight)
            return;
        inFlight = true;
        void refreshRecentSessionsInBackground(window).finally(() => {
            inFlight = false;
        });
    }, AGENT_SESSION_REFRESH_INTERVAL_MS);
    logPetDebugEvent("agent-session:refresh-scheduled", {
        intervalMs: AGENT_SESSION_REFRESH_INTERVAL_MS,
    });
}
function stopAgentSessionRefresh(reason) {
    if (!agentSessionRefreshTimer)
        return;
    clearInterval(agentSessionRefreshTimer);
    agentSessionRefreshTimer = null;
    logPetDebugEvent("agent-session:refresh-stopped", { reason });
}
async function refreshLocalCodexSession(workspacePath, options = {}) {
    try {
        const agent = options.agent ?? currentAgent;
        const local = readLocalCodexSessions(workspacePath, 10, agent);
        const codexSessionId = options.codexSessionId?.trim();
        const latest = local.find((item) => {
            if (codexSessionId && item.menuSession.codex_session_id !== codexSessionId)
                return false;
            if (!options.minModifiedAtMs)
                return true;
            const candidateAt = codexSessionId ? item.fileModifiedAt : item.sessionStartedAt;
            const candidateAtMs = Date.parse(candidateAt);
            return Number.isFinite(candidateAtMs) && candidateAtMs >= options.minModifiedAtMs;
        });
        if (!latest)
            return null;
        if (shouldUpsertSessionsToApi(agent)) {
            try {
                await upsertDesktopPetSession(latest.payload);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logPetDebugEvent("codex-session:refresh-upsert-error", {
                    workspacePath,
                    codexSessionId: latest.payload.codex_session_id,
                    error: message,
                });
            }
        }
        return latest.menuSession;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logPetDebugEvent("codex-session:refresh-error", { workspacePath, error: message });
    }
    return null;
}
function stopCodexSessionOutputWatch(window, reason = "replaced") {
    const watch = codexSessionOutputWatches.get(window);
    if (!watch)
        return;
    clearInterval(watch.interval);
    clearTimeout(watch.timeout);
    codexSessionOutputWatches.delete(window);
    logPetDebugEvent("codex-session:watch-stop", {
        reason,
        workspacePath: watch.workspacePath,
        codexSessionId: watch.codexSessionId,
    });
}
function shouldStopCodexSessionOutputWatch(session) {
    const status = normalizeCodexSessionStatus(session.last_status);
    return status === "failed" || status === "disconnected";
}
function startCodexSessionOutputWatch(window, workspacePath, options) {
    stopCodexSessionOutputWatch(window);
    const watch = {
        workspacePath,
        minModifiedAtMs: options.minModifiedAtMs,
        codexSessionId: options.codexSessionId?.trim() || undefined,
        userDataDir: options.userDataDir?.trim() || undefined,
        workspaceFilePath: options.workspaceFilePath?.trim() || undefined,
        agent: options.agent ?? currentAgent,
        interval: setInterval(() => {
            void tickCodexSessionOutputWatch(window, watch);
        }, CODEX_SESSION_WATCH_INTERVAL_MS),
        timeout: setTimeout(() => {
            stopCodexSessionOutputWatch(window, "max-duration");
        }, CODEX_SESSION_WATCH_MAX_DURATION_MS),
        inFlight: false,
        hasMatchedSession: false,
    };
    codexSessionOutputWatches.set(window, watch);
    logPetDebugEvent("codex-session:watch-start", {
        workspacePath,
        codexSessionId: watch.codexSessionId,
        hasUserDataDir: Boolean(watch.userDataDir),
        hasWorkspaceFilePath: Boolean(watch.workspaceFilePath),
        minModifiedAtMs: watch.minModifiedAtMs,
        intervalMs: CODEX_SESSION_WATCH_INTERVAL_MS,
        maxDurationMs: CODEX_SESSION_WATCH_MAX_DURATION_MS,
    });
    void tickCodexSessionOutputWatch(window, watch);
}
async function tickCodexSessionOutputWatch(window, watch) {
    if (codexSessionOutputWatches.get(window) !== watch)
        return;
    if (window.isDestroyed()) {
        stopCodexSessionOutputWatch(window, "window-destroyed");
        return;
    }
    if (watch.inFlight)
        return;
    watch.inFlight = true;
    try {
        const allowFirstCompletion = !watch.hasMatchedSession;
        const session = await refreshLocalCodexSession(watch.workspacePath, {
            minModifiedAtMs: watch.minModifiedAtMs,
            codexSessionId: watch.codexSessionId,
            agent: watch.agent,
        });
        if (codexSessionOutputWatches.get(window) !== watch)
            return;
        if (session) {
            const matchedSessionId = compactText(session.codex_session_id);
            if (!watch.codexSessionId && matchedSessionId) {
                watch.codexSessionId = matchedSessionId;
                logPetDebugEvent("codex-session:watch-session-bound", {
                    workspacePath: watch.workspacePath,
                    codexSessionId: matchedSessionId,
                });
            }
            watch.hasMatchedSession = true;
            publishCodexStatusForSession(window, session, { allowFirstCompletion, agent: watch.agent });
            bindActiveSessionWindowToSession(session, {
                userDataDir: watch.userDataDir,
                workspaceFilePath: watch.workspaceFilePath,
                agent: watch.agent,
            });
        }
        const status = session ? normalizeCodexSessionStatus(session.last_status) : null;
        if (session && status === "completed") {
            // Synchronize the completed session and its siblings once for review,
            // without publishing another status that could replace this completion.
            await scanAndUpsertRecentCodexSessions(window, {
                workspacePath: watch.workspacePath,
                publishStatus: false,
                agent: watch.agent,
            });
            if (codexSessionOutputWatches.get(window) === watch) {
                stopCodexSessionOutputWatch(window, "status:completed");
            }
            return;
        }
        if (session && shouldStopCodexSessionOutputWatch(session)) {
            stopCodexSessionOutputWatch(window, `status:${status}`);
        }
    }
    finally {
        watch.inFlight = false;
    }
}
async function dispatchMenuAction(window, action) {
    if (action.type === "refresh-remote-projects") {
        const workspacePath = resolveCurrentWorkspacePath();
        publishCodexStatus(window, {
            state: "starting",
            workspacePath,
            lastOutput: "Refreshing macCodex projects",
            source: "terminal",
        });
        try {
            const projects = await refreshCodexRemoteWorkspaces();
            const error = currentRemoteProjectCatalog?.error;
            publishCodexStatus(window, {
                state: error ? "disconnected" : "idle",
                workspacePath,
                lastOutput: error
                    ? `Loaded ${projects.length} cached macCodex projects · ${error}`
                    : `Found ${projects.length} macCodex projects`,
                source: "terminal",
            });
            window.webContents.send("pet:menu:action", action);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            publishCodexStatus(window, { state: "failed", workspacePath, error: message, source: "terminal" });
        }
        return;
    }
    if (action.type === "select-workspace") {
        const currentWorkspacePath = resolveCurrentWorkspacePath();
        window.webContents.send("pet:menu:action", action);
        try {
            const result = await dialog.showOpenDialog(window, {
                title: currentMenuLanguage === "zh-CN" ? "选择 Codex 工作区" : "Select Codex Workspace",
                defaultPath: currentWorkspacePath,
                properties: ["openDirectory"],
            });
            const selectedPath = result.filePaths[0]?.trim();
            if (result.canceled || !selectedPath)
                return;
            if (!fs.statSync(selectedPath).isDirectory()) {
                throw new Error("Selected workspace is not a directory");
            }
            const settings = writeSelectedWorkspacePath({
                workspacePath: selectedPath,
                userDataPath: app.getPath("userData"),
            });
            const workspacePath = settings.selectedWorkspacePath ?? selectedPath;
            stopCodexSessionOutputWatch(window, "workspace-selected");
            codexSessionContext.invalidate();
            codexCompletionTracker.reset();
            cacheMenuSessions([]);
            publishCodexStatus(window, { state: "idle", workspacePath });
            logPetDebugEvent("workspace:selected", { workspacePath });
            window.webContents.send("pet:menu:action", { type: "workspace-selected", workspacePath });
            void refreshRecentSessionsInBackground(window);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logPetDebugEvent("workspace:select-error", { currentWorkspacePath, error: message });
            publishCodexStatus(window, { state: "failed", workspacePath: currentWorkspacePath, error: message });
        }
        return;
    }
    if (action.type === "switch-workspace") {
        const currentWorkspacePath = resolveCurrentWorkspacePath();
        const requestedWorkspacePath = action.workspacePath.trim();
        window.webContents.send("pet:menu:action", action);
        try {
            if (!requestedWorkspacePath) {
                throw new Error("Workspace path is required");
            }
            if (!fs.statSync(requestedWorkspacePath).isDirectory()) {
                throw new Error("Selected workspace is not a directory");
            }
            const settings = writeSelectedWorkspacePath({
                workspacePath: action.workspacePath,
                userDataPath: app.getPath("userData"),
            });
            const workspacePath = settings.selectedWorkspacePath ?? requestedWorkspacePath;
            stopCodexSessionOutputWatch(window, "workspace-switched");
            codexSessionContext.invalidate();
            codexCompletionTracker.reset();
            cacheMenuSessions([]);
            publishCodexStatus(window, { state: "idle", workspacePath });
            logPetDebugEvent("workspace:switched", { workspacePath });
            window.webContents.send("pet:menu:action", { type: "workspace-selected", workspacePath });
            void refreshRecentSessionsInBackground(window);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logPetDebugEvent("workspace:switch-error", {
                currentWorkspacePath,
                requestedWorkspacePath,
                error: message,
            });
            publishCodexStatus(window, { state: "failed", workspacePath: currentWorkspacePath, error: message });
        }
        return;
    }
    if (action.type === "select-codex-workspace") {
        const currentWorkspacePath = resolveCurrentWorkspacePath();
        window.webContents.send("pet:menu:action", action);
        try {
            const remoteWorkspace = currentCodexRemoteWorkspaces.find((workspace) => workspace.id === action.workspaceId);
            if (!remoteWorkspace || remoteWorkspace.path !== action.workspacePath) {
                throw new Error("Codex 远程项目已变化，请重新打开工作区菜单");
            }
            if (remoteWorkspace.source !== "codex-desktop-ssh" && !isSshWorkspaceUri(action.workspacePath) && !fs.statSync(action.workspacePath).isDirectory()) {
                throw new Error("Codex 远程项目路径在当前电脑上不可访问");
            }
            const settings = writePetSettings({
                userDataPath: app.getPath("userData"),
                patch: {
                    selectedCodexDesktopProject: {
                        projectId: remoteWorkspace.projectId ?? remoteWorkspace.id,
                        projectKind: remoteWorkspace.projectKind ?? (remoteWorkspace.kind === "ssh" ? "remote" : "local"),
                        label: remoteWorkspace.label ?? action.workspacePath,
                        path: action.workspacePath,
                        hostId: remoteWorkspace.hostId,
                        hostDisplayName: remoteWorkspace.hostDisplayName,
                        sshHost: remoteWorkspace.sshHost,
                    },
                    ...(remoteWorkspace.source === "codex-desktop-ssh" ? {} : { selectedWorkspacePath: action.workspacePath }),
                },
            });
            const workspacePath = settings.selectedCodexDesktopProject?.path ?? settings.selectedWorkspacePath ?? action.workspacePath;
            stopCodexSessionOutputWatch(window, "codex-remote-workspace-selected");
            codexSessionContext.invalidate();
            codexCompletionTracker.reset();
            cacheMenuSessions([]);
            publishCodexStatus(window, { state: "idle", workspacePath });
            logPetDebugEvent("codex-workspaces:selected", { workspaceId: action.workspaceId, workspacePath });
            window.webContents.send("pet:menu:action", { type: "workspace-selected", workspacePath });
            if (remoteWorkspace.source !== "codex-desktop-ssh") {
                void refreshRecentSessionsInBackground(window);
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logPetDebugEvent("codex-workspaces:select-error", { workspaceId: action.workspaceId, error: message });
            publishCodexStatus(window, { state: "failed", workspacePath: currentWorkspacePath, error: message });
        }
        return;
    }
    if (action.type === "interaction-mode") {
        publishInteractionMode(window, normalizeInteractionMode(action.mode));
        window.webContents.send("pet:menu:action", { type: "interaction-mode", mode: currentInteractionMode });
        return;
    }
    if (action.type === "send-prompt") {
        window.webContents.send("pet:menu:action", action);
        return;
    }
    if (action.type === "new-session") {
        const launchContext = captureActiveCodexSessionContext();
        const workspacePath = resolveCurrentWorkspacePath();
        const launchAgent = currentAgent;
        const launchCodexEnvMode = currentCodexEnvMode;
        const launchCodexTarget = currentCodexLaunchTarget;
        const launchedAt = Date.now();
        publishCodexStatus(window, { state: "starting", workspacePath, source: "terminal" });
        try {
            if (launchAgent === "codex" && launchCodexTarget === "codex-desktop") {
                const selectedProject = readPetSettings({ userDataPath: app.getPath("userData") }).selectedCodexDesktopProject;
                if (selectedProject?.projectKind === "remote") {
                    const isChinese = currentMenuLanguage === "zh-CN";
                    const hostLabel = selectedProject.hostDisplayName || "SSH";
                    const pathLabel = selectedProject.path || selectedProject.label;
                    const confirmation = await dialog.showMessageBox(window, {
                        type: "info",
                        title: isChinese ? "打开 Codex Desktop 远程任务" : "Open remote task in Codex Desktop",
                        message: isChinese
                            ? `Codex Desktop 当前无法自动绑定远程项目“${selectedProject.label}”。`
                            : `Codex Desktop cannot currently bind the remote project “${selectedProject.label}” automatically.`,
                        detail: isChinese
                            ? `Codex Desktop 不提供可由 Pet 调用的远程项目选择接口，因此不会自动弹出项目选择器。\n\n确认后会复制远程路径并打开新任务界面：\n${hostLabel}\n${pathLabel}`
                            : `Codex Desktop does not expose a remote-project picker that Pet can invoke, so no project picker will open automatically.\n\nAfter confirmation, Pet will copy the remote path and open the new-task screen:\n${hostLabel}\n${pathLabel}`,
                        buttons: isChinese ? ["复制路径并打开", "取消"] : ["Copy Path and Open", "Cancel"],
                        defaultId: 0,
                        cancelId: 1,
                        noLink: true,
                    });
                    if (confirmation.response !== 0) {
                        logPetDebugEvent("codex-desktop-launch:remote-confirmation-cancelled", {
                            projectId: selectedProject.projectId,
                            label: selectedProject.label,
                        });
                        if (isActiveCodexSessionContext(launchContext)) {
                            publishCodexStatus(window, {
                                state: "idle",
                                workspacePath,
                                lastOutput: isChinese
                                    ? `已取消打开远程项目 ${selectedProject.label}`
                                    : `Opening remote project ${selectedProject.label} was cancelled`,
                                source: "terminal",
                            });
                        }
                        window.webContents.send("pet:menu:action", action);
                        return;
                    }
                    clipboard.writeText(pathLabel);
                    logPetDebugEvent("codex-desktop-launch:remote-path-copied", {
                        projectId: selectedProject.projectId,
                        path: pathLabel,
                    });
                }
                const result = selectedProject?.projectKind === "remote"
                    ? await launchNewCodexDesktopUnboundSession()
                    : await launchNewCodexDesktopSession({ workspacePath });
                logPetDebugEvent("codex-desktop-launch:new-session-requested", result);
                if (!isActiveCodexSessionContext(launchContext)) {
                    logPetDebugEvent("codex-launch:new-session-stale", {
                        workspacePath,
                        agent: launchAgent,
                    });
                    window.webContents.send("pet:menu:action", action);
                    return;
                }
                publishCodexStatus(window, {
                    state: "launched",
                    workspacePath,
                    lastOutput: selectedProject?.projectKind === "remote"
                        ? currentMenuLanguage === "zh-CN"
                            ? `远程路径已复制；请在 Codex Desktop 中打开项目选择器并粘贴 ${selectedProject.label}`
                            : `Remote path copied; open the project picker in Codex Desktop and paste ${selectedProject.label}`
                        : "Codex Desktop new task opened",
                    source: "terminal",
                });
                window.webContents.send("pet:menu:action", action);
                return;
            }
            const selectedProject = readPetSettings({ userDataPath: app.getPath("userData") }).selectedCodexDesktopProject;
            const isRemoteCodexCli = launchAgent === "codex" &&
                selectedProject?.projectKind === "remote";
            if (isRemoteCodexCli && (!selectedProject?.path || !selectedProject.sshHost)) {
                throw new Error("远程项目缺少受限 SSH 配置，请重新选择 Codex 远程项目");
            }
            const result = launchAgent === "claude"
                ? launchNewClaudeSession({ workspacePath })
                : isRemoteCodexCli
                    ? launchRemoteCodexSession({
                        sshHost: selectedProject.sshHost,
                        remotePath: selectedProject.path,
                        label: selectedProject.label,
                    })
                    : launchNewCodexSession({ workspacePath, codexEnvMode: launchCodexEnvMode });
            logPetDebugEvent(`${launchAgent}-launch:new-session-requested`, result);
            if ("terminalRequest" in result && result.terminalRequest) {
                const ack = await waitForVscodeTerminalRequestAck(result.terminalRequest);
                logPetDebugEvent("codex-launch:new-session-confirmed", ack);
            }
            if (!isActiveCodexSessionContext(launchContext)) {
                logPetDebugEvent("codex-launch:new-session-stale", {
                    workspacePath,
                    agent: launchAgent,
                });
                window.webContents.send("pet:menu:action", action);
                return;
            }
            publishCodexStatus(window, {
                state: "launched",
                workspacePath: result.workspacePath,
                commandLine: result.commandLine,
                source: "terminal",
            });
            if (!isRemoteCodexCli) {
                const vscodeResult = result;
                cacheActiveSessionWindow({
                    workspacePath: vscodeResult.workspacePath,
                    userDataDir: vscodeResult.userDataDir,
                    workspaceFilePath: "workspaceFilePath" in vscodeResult ? vscodeResult.workspaceFilePath : undefined,
                    agent: launchAgent,
                });
                startCodexSessionOutputWatch(window, vscodeResult.workspacePath, {
                    minModifiedAtMs: launchedAt - 1000,
                    userDataDir: vscodeResult.userDataDir,
                    workspaceFilePath: "workspaceFilePath" in vscodeResult ? vscodeResult.workspaceFilePath : undefined,
                    agent: launchAgent,
                });
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (launchAgent === "codex" && launchCodexTarget === "codex-desktop") {
                logPetDebugEvent("codex-desktop-launch:new-session-error", { workspacePath, error: message });
            }
            else {
                logPetDebugEvent(`${launchAgent}-launch:new-session-error`, { workspacePath, error: message });
            }
            if (isActiveCodexSessionContext(launchContext)) {
                publishCodexStatus(window, { state: "failed", workspacePath, error: message, source: "terminal" });
            }
        }
        window.webContents.send("pet:menu:action", action);
        return;
    }
    if (action.type === "restore-session") {
        const launchContext = captureActiveCodexSessionContext();
        const launchAgent = currentAgent;
        const launchCodexEnvMode = currentCodexEnvMode;
        const launchCodexTarget = currentCodexLaunchTarget;
        const session = findMenuSessionByPetId(action.petSessionId);
        const workspacePath = session?.workspace_path || resolveCurrentWorkspacePath();
        const codexSessionId = session?.codex_session_id?.trim();
        const title = session ? sessionTitle(session) : "Codex session";
        if (session?.runtime === "app-server") {
            const message = "Pet app-server session is already managed by Pet";
            logPetDebugEvent("codex-launch:restore-session-app-server", {
                petSessionId: action.petSessionId,
                codexSessionId,
            });
            publishCodexStatus(window, {
                state: normalizeCodexSessionStatus(session.last_status),
                workspacePath,
                sessionTitle: title,
                codexSessionId,
                lastOutput: sessionLastOutput(session),
                source: "app-server",
            });
            window.webContents.send("pet:menu:action", { ...action, message });
            return;
        }
        if (!codexSessionId) {
            const message = "Codex session metadata is missing";
            logPetDebugEvent("codex-launch:restore-session-error", { petSessionId: action.petSessionId, error: message });
            publishCodexStatus(window, { state: "failed", workspacePath, sessionTitle: title, error: message, source: "terminal" });
            window.webContents.send("pet:menu:action", action);
            return;
        }
        publishCodexStatus(window, { state: "resuming", workspacePath, sessionTitle: title, codexSessionId, source: "terminal" });
        try {
            if (launchAgent === "codex" && launchCodexTarget === "codex-desktop") {
                const result = await launchCodexDesktopExistingSession({ codexSessionId });
                logPetDebugEvent("codex-desktop-launch:restore-session-requested", {
                    ...result,
                    petSessionId: action.petSessionId,
                });
                if (!isActiveCodexSessionContext(launchContext)) {
                    logPetDebugEvent("codex-launch:restore-session-stale", {
                        petSessionId: action.petSessionId,
                        codexSessionId,
                        workspacePath,
                        agent: launchAgent,
                    });
                    window.webContents.send("pet:menu:action", action);
                    return;
                }
                publishCodexStatus(window, {
                    state: "running",
                    workspacePath,
                    sessionTitle: title,
                    codexSessionId,
                    lastOutput: session ? sessionLastOutput(session) : undefined,
                    source: "terminal",
                });
                window.webContents.send("pet:menu:action", action);
                return;
            }
            const result = launchAgent === "claude"
                ? resumeClaudeSession({ claudeSessionId: codexSessionId, workspacePath })
                : resumeCodexSession({ codexSessionId, workspacePath, codexEnvMode: launchCodexEnvMode });
            logPetDebugEvent(`${launchAgent}-launch:restore-session-requested`, result);
            if ("terminalRequest" in result && result.terminalRequest) {
                const ack = await waitForVscodeTerminalRequestAck(result.terminalRequest);
                logPetDebugEvent("codex-launch:restore-session-confirmed", ack);
            }
            if (!isActiveCodexSessionContext(launchContext)) {
                logPetDebugEvent("codex-launch:restore-session-stale", {
                    petSessionId: action.petSessionId,
                    codexSessionId,
                    workspacePath,
                    agent: launchAgent,
                });
                window.webContents.send("pet:menu:action", action);
                return;
            }
            cacheActiveSessionWindow({
                workspacePath: result.workspacePath,
                userDataDir: result.userDataDir,
                workspaceFilePath: "workspaceFilePath" in result ? result.workspaceFilePath : undefined,
                petSessionId: action.petSessionId,
                codexSessionId,
                agent: launchAgent,
            });
            publishCodexStatus(window, {
                state: "running",
                workspacePath: result.workspacePath,
                sessionTitle: title,
                codexSessionId,
                commandLine: result.commandLine,
                lastOutput: session ? sessionLastOutput(session) : undefined,
                source: "terminal",
            });
            startCodexSessionOutputWatch(window, result.workspacePath, {
                minModifiedAtMs: Date.now() - 1000,
                codexSessionId,
                userDataDir: result.userDataDir,
                workspaceFilePath: "workspaceFilePath" in result ? result.workspaceFilePath : undefined,
                agent: launchAgent,
            });
            if (session && shouldUpsertSessionsToApi(launchAgent)) {
                const payload = payloadFromMenuSession(session, "running");
                if (payload) {
                    void upsertDesktopPetSession(payload).catch((error) => logPetDebugEvent("codex-session:restore-upsert-error", { petSessionId: action.petSessionId, error: error.message }));
                }
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logPetDebugEvent(launchAgent === "codex" && launchCodexTarget === "codex-desktop"
                ? "codex-desktop-launch:restore-session-error"
                : `${launchAgent}-launch:restore-session-error`, {
                petSessionId: action.petSessionId,
                codexSessionId,
                workspacePath,
                error: message,
            });
            if (isActiveCodexSessionContext(launchContext)) {
                publishCodexStatus(window, { state: "failed", workspacePath, sessionTitle: title, codexSessionId, error: message, source: "terminal" });
            }
        }
        window.webContents.send("pet:menu:action", action);
        return;
    }
    if (action.type === "focus-active-session") {
        const session = findMenuSessionByPetId(action.petSessionId);
        if (session?.runtime === "app-server") {
            const message = "Pet app-server session is managed by Pet and has no VSCode window to focus";
            logPetDebugEvent("codex-launch:focus-active-session-app-server", {
                petSessionId: action.petSessionId,
            });
            publishCodexStatus(window, {
                state: normalizeCodexSessionStatus(session.last_status),
                workspacePath: session.workspace_path || undefined,
                sessionTitle: sessionTitle(session),
                codexSessionId: session.codex_session_id || undefined,
                lastOutput: sessionLastOutput(session),
                source: "app-server",
            });
            window.webContents.send("pet:menu:action", { ...action, message });
            return;
        }
        const launchCodexTarget = currentCodexLaunchTarget;
        const codexSessionId = compactText(session?.codex_session_id);
        if (currentAgent === "codex" && launchCodexTarget === "codex-desktop") {
            if (!codexSessionId) {
                const message = "Codex session metadata is missing";
                logPetDebugEvent("codex-desktop-launch:focus-active-session-error", {
                    petSessionId: action.petSessionId,
                    error: message,
                });
                window.webContents.send("pet:menu:action", { ...action, message });
                return;
            }
            try {
                const result = await launchCodexDesktopExistingSession({ codexSessionId });
                logPetDebugEvent("codex-desktop-launch:focus-active-session", {
                    ...result,
                    petSessionId: action.petSessionId,
                });
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logPetDebugEvent("codex-desktop-launch:focus-active-session-error", {
                    petSessionId: action.petSessionId,
                    codexSessionId,
                    error: message,
                });
            }
            window.webContents.send("pet:menu:action", action);
            return;
        }
        try {
            const { workspacePath, userDataDir, workspaceFilePath } = focusActiveSessionWindow(window, action.petSessionId);
            const result = focusVscodeWorkspace({ workspacePath, userDataDir, workspaceFilePath });
            logPetDebugEvent("codex-launch:focus-active-session", { ...result, petSessionId: action.petSessionId });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logPetDebugEvent("codex-launch:focus-active-session-error", { petSessionId: action.petSessionId, error: message });
        }
        window.webContents.send("pet:menu:action", action);
        return;
    }
    if (action.type === "more-sessions") {
        const context = captureActiveCodexSessionContext();
        window.webContents.send("pet:menu:action", { type: "more-sessions", sessions: [] });
        try {
            const sessions = await listRecentSessions(50, context);
            if (!isActiveCodexSessionContext(context))
                return;
            cacheMenuSessions(sessions);
            logPetDebugEvent("codex-session:more-sessions", { sessions: sessions.length });
            window.webContents.send("pet:menu:action", { type: "more-sessions", sessions });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const workspacePath = resolveCurrentWorkspacePath();
            logPetDebugEvent("codex-session:more-sessions-error", { workspacePath, error: message });
            publishCodexStatus(window, { state: "failed", workspacePath, error: message });
        }
        return;
    }
    if (action.type === "focus-vscode") {
        const workspacePath = resolveCurrentWorkspacePath();
        try {
            const result = focusVscodeWorkspace({ workspacePath });
            logPetDebugEvent("codex-launch:focus-vscode", result);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logPetDebugEvent("codex-launch:focus-vscode-error", { workspacePath, error: message });
            publishCodexStatus(window, { state: "failed", workspacePath, error: message });
        }
        window.webContents.send("pet:menu:action", action);
        return;
    }
    if (action.type === "notification-detail") {
        currentNotificationProfile = normalizeNotificationProfile(action.profile);
        persistPetPreferences({ notificationProfile: currentNotificationProfile });
    }
    if (action.type === "menu-language") {
        currentMenuLanguage = normalizeMenuLanguage(action.language);
        persistPetPreferences({ menuLanguage: currentMenuLanguage });
    }
    if (action.type === "always-on-top") {
        currentAlwaysOnTop = Boolean(action.enabled);
        persistPetPreferences({ alwaysOnTop: currentAlwaysOnTop });
        applyPetAlwaysOnTop(window, currentAlwaysOnTop);
        logPetDebugEvent("window-top:changed", { enabled: currentAlwaysOnTop });
        window.webContents.send("pet:menu:action", { type: "always-on-top", enabled: currentAlwaysOnTop });
        return;
    }
    if (action.type === "agent") {
        stopCodexSessionOutputWatch(window, "agent-changed");
        currentAgent = normalizePetAgent(action.agent);
        codexSessionContext.invalidate();
        codexCompletionTracker.reset();
        persistPetPreferences({ agent: currentAgent });
        cacheMenuSessions([]);
        publishCodexStatus(window, { state: "idle", workspacePath: resolveCurrentWorkspacePath() });
        logPetDebugEvent("agent:changed", { agent: currentAgent });
        window.webContents.send("pet:agent:changed", currentAgent);
        window.webContents.send("pet:menu:action", { type: "agent", agent: currentAgent });
        void refreshRecentSessionsInBackground(window);
        return;
    }
    if (action.type === "codex-env") {
        currentCodexEnvMode = normalizeCodexEnvMode(action.envMode);
        writePetSettings({ userDataPath: app.getPath("userData"), patch: { codexEnvMode: currentCodexEnvMode } });
        window.webContents.invalidate();
        logPetDebugEvent("codex-env:changed", { codexEnvMode: currentCodexEnvMode });
        window.webContents.send("pet:codex-env:changed", currentCodexEnvMode);
        return;
    }
    if (action.type === "codex-launch-target") {
        currentCodexLaunchTarget = normalizeCodexLaunchTarget(action.target);
        persistPetPreferences({ codexLaunchTarget: currentCodexLaunchTarget });
        window.webContents.invalidate();
        logPetDebugEvent("codex-launch-target:changed", { codexLaunchTarget: currentCodexLaunchTarget });
        window.webContents.send("pet:menu:action", {
            type: "codex-launch-target",
            target: currentCodexLaunchTarget,
        });
        return;
    }
    if (action.type === "close") {
        window.close();
        return;
    }
    window.webContents.send("pet:menu:action", action);
}
async function listRecentSessions(limit = 10, context = captureActiveCodexSessionContext()) {
    const { workspacePath, agent } = context;
    let localSessions = [];
    try {
        localSessions = await syncLocalAgentSessions(context, limit);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logPetDebugEvent("codex-session:sync-error", { workspacePath, error: message });
    }
    if (!isActiveCodexSessionContext(context))
        return [];
    if (agent === "claude") {
        cacheMenuSessions(localSessions);
        return localSessions;
    }
    try {
        const response = await fetch(`${apiBaseUrl}/desktop-pet/sessions?limit=${limit}`, {
            headers: { "x-user-id": menuUserId },
        });
        if (!response.ok)
            throw new Error(`sessions failed: ${response.status}`);
        const payload = (await response.json());
        if (!isActiveCodexSessionContext(context))
            return [];
        lastApiAvailable = true;
        const sessions = mergeSessions(payload.sessions || [], localSessions, limit);
        cacheMenuSessions(sessions);
        return sessions;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logPetDebugEvent("codex-session:list-error", { workspacePath, error: message });
        if (!isActiveCodexSessionContext(context))
            return [];
        lastApiAvailable = false;
        cacheMenuSessions(localSessions);
        return localSessions;
    }
}
async function openPetContextMenu(window, input, source = "native") {
    if (!shouldOpenPetContextMenu(currentInteractionMode)) {
        logPetDebugEvent("context-menu:ignored-camera-adjust", { source, input });
        return;
    }
    const now = Date.now();
    const cursor = screen.getCursorScreenPoint();
    const bounds = window.getBounds();
    const resolvedPosition = resolveContextMenuPosition({
        input: input ?? { space: "screen", point: cursor },
        bounds,
    });
    if (!resolvedPosition) {
        const ignoredScreenPosition = input?.space === "screen" ? input.point : cursor;
        lastMenuPopup = { atMs: now, source, position: ignoredScreenPosition };
        logPetDebugEvent("context-menu:ignored-outside-window", { source, input, cursor, bounds });
        return;
    }
    if (shouldSuppressDuplicateContextMenuPopup({
        nowMs: now,
        source,
        position: resolvedPosition.screenPosition,
        lastPopup: lastMenuPopup,
        lastMenuClosedAtMs: lastContextMenuClosedAtMs,
        menuActive: contextMenuActive,
    })) {
        logPetDebugEvent("context-menu:deduped", { source, input, resolvedPosition, menuActive: contextMenuActive });
        return;
    }
    lastMenuPopup = { atMs: now, source, position: resolvedPosition.screenPosition };
    contextMenuActive = true;
    logPetDebugEvent("context-menu:open", { source, input, cursor, bounds, resolvedPosition });
    try {
        const sessions = listImmediateMenuSessions();
        loadCodexRemoteWorkspaces();
        const selectedWorkspacePath = resolveCurrentWorkspacePath();
        const selectedWorkspaceSession = latestSessionForWorkspace(sessions, selectedWorkspacePath, currentAgent);
        if (selectedWorkspaceSession && !codexSessionOutputWatches.has(window)) {
            publishCodexStatusForSession(window, selectedWorkspaceSession);
        }
        const items = buildPetMenuModel({
            interactionMode: currentInteractionMode,
            notificationProfile: currentNotificationProfile,
            menuLanguage: currentMenuLanguage,
            alwaysOnTop: currentAlwaysOnTop,
            selectedWorkspacePath,
            sessions,
            activeWorkspaces: buildActiveWorkspaceSummaries(sessions),
            apiAvailable: lastApiAvailable,
            agent: currentAgent,
            codexEnvMode: currentCodexEnvMode,
            codexLaunchTarget: currentCodexLaunchTarget,
            codexRemoteWorkspaces: currentCodexRemoteWorkspaces,
        });
        const openedAtMs = Date.now();
        logPetDebugEvent("context-menu:present", {
            position: resolvedPosition.popupPosition,
            sessions: sessions.length,
            openedAtMs,
        });
        const display = screen.getDisplayNearestPoint(resolvedPosition.screenPosition);
        const menuBounds = resolveContextMenuWindowBounds({
            point: resolvedPosition.screenPosition,
            workArea: display.workArea,
        });
        if (contextMenuBlankDiagnosticEnabled) {
            const blankWindow = createDiagnosticBlankWindow(menuBounds);
            logPetDebugEvent("context-menu:diagnostic-blank-created", {
                openedAtMs,
                presentToCreateMs: Date.now() - openedAtMs,
                bounds: menuBounds,
                processId: blankWindow.webContents.getOSProcessId(),
            });
            return;
        }
        openNativeContextMenu(window, items, menuBounds, openedAtMs);
        return;
    }
    catch (error) {
        contextMenuActive = false;
        const message = error instanceof Error ? error.message : String(error);
        logPetDebugEvent("context-menu:error", { source, input, error: message });
    }
}
function createNativeMenuOwnerWindow(bounds) {
    if (nativeMenuOwnerWindow && !nativeMenuOwnerWindow.isDestroyed()) {
        nativeMenuOwnerWindow.setBounds({
            x: bounds.x,
            y: bounds.y,
            width: 1,
            height: 1,
        });
        nativeMenuOwnerWindow.setOpacity(0);
        nativeMenuOwnerWindow.show();
        nativeMenuOwnerWindow.focus();
        return nativeMenuOwnerWindow;
    }
    const ownerWindow = new BrowserWindow({
        ...createDiagnosticBlankBrowserWindowOptions({
            x: bounds.x,
            y: bounds.y,
            width: 1,
            height: 1,
        }),
        opacity: 0,
    });
    nativeMenuOwnerWindow = ownerWindow;
    ownerWindow.setMenuBarVisibility(false);
    ownerWindow.setAlwaysOnTop(true, "pop-up-menu");
    ownerWindow.setOpacity(0);
    ownerWindow.focus();
    ownerWindow.on("closed", () => {
        if (nativeMenuOwnerWindow === ownerWindow)
            nativeMenuOwnerWindow = null;
        logPetDebugEvent("context-menu:native-owner-closed");
    });
    return ownerWindow;
}
function openNativeContextMenu(petWindow, items, bounds, openedAtMs) {
    const ownerWindow = createNativeMenuOwnerWindow(bounds);
    const menu = Menu.buildFromTemplate(toElectronMenuTemplate(items, (action) => {
        logPetDebugEvent("context-menu:action-selected", { action: action.type });
        void dispatchMenuAction(petWindow, action).catch((error) => {
            logPetDebugEvent("context-menu:action-error", {
                action: action.type,
                error: error instanceof Error ? error.message : String(error),
            });
        });
    }));
    logPetDebugEvent("context-menu:native-owner-created", {
        openedAtMs,
        presentToOwnerCreateMs: Date.now() - openedAtMs,
        bounds,
    });
    menu.popup({
        window: ownerWindow,
        x: 0,
        y: 0,
        callback: () => {
            if (!ownerWindow.isDestroyed())
                ownerWindow.hide();
            contextMenuActive = false;
            lastContextMenuClosedAtMs = Date.now();
            logPetDebugEvent("context-menu:closed", { reason: "native-menu-callback" });
        },
    });
    logPetDebugEvent("context-menu:native-popup-called", {
        openedAtMs,
        presentToPopupCallMs: Date.now() - openedAtMs,
    });
}
function startPetWindowDrag(window, source, seed) {
    const activeDrag = windowDragState.get(window);
    if (!shouldAcceptWindowDragStart(activeDrag?.source, source)) {
        logPetDebugEvent("window-drag:start-ignored", { source, activeSource: activeDrag?.source });
        return;
    }
    windowDragState.set(window, {
        originBounds: seed?.originBounds ?? window.getBounds(),
        originCursor: seed?.originCursor ?? screen.getCursorScreenPoint(),
        source,
    });
    logPetDebugEvent("window-drag:start", { source, ...(windowDragState.get(window) ?? {}) });
}
function movePetWindowDrag(window, source) {
    const dragState = windowDragState.get(window);
    if (!dragState)
        return;
    if (!shouldApplyWindowDragMove(dragState.source, source)) {
        logPetDebugEvent("window-drag:move-ignored", { source, activeSource: dragState.source });
        return;
    }
    const bounds = calculateDraggedWindowBounds({
        ...dragState,
        currentCursor: screen.getCursorScreenPoint(),
    });
    window.setBounds(bounds);
    logPetDebugEvent("window-drag:move", { source, bounds });
}
function endPetWindowDrag(window, source) {
    const dragState = windowDragState.get(window);
    if (!dragState)
        return;
    const bounds = calculateEndedWindowDragBounds({
        currentBounds: window.getBounds(),
        originBounds: dragState.originBounds,
    });
    window.setBounds(bounds);
    logPetDebugEvent("window-drag:end", { source, activeSource: dragState.source, bounds });
    windowDragState.delete(window);
    persistPetWindowBounds(window);
}
function installNativeMouseHooks(window) {
    if (process.platform !== "win32")
        return;
    window.hookWindowMessage(WM_RBUTTONUP, () => {
        const point = screen.getCursorScreenPoint();
        logPetDebugEvent("native-mouse:right-button-up", {
            point,
            interactionMode: currentInteractionMode,
        });
        void openPetContextMenu(window, { space: "screen", point }, "native");
    });
    window.hookWindowMessage(WM_LBUTTONDOWN, (_wParam, lParam) => {
        const originCursor = screen.getCursorScreenPoint();
        nativeClickCandidateState.set(window, {
            originBounds: window.getBounds(),
            originCursor,
            originClient: readNativeClientPoint(lParam) ?? originCursor,
            moved: false,
        });
        logPetDebugEvent("native-mouse:left-button-down", { interactionMode: currentInteractionMode });
    });
    window.hookWindowMessage(WM_MOUSEMOVE, (_wParam, lParam) => {
        const candidate = nativeClickCandidateState.get(window);
        if (candidate && !candidate.moved) {
            const currentClient = readNativeClientPoint(lParam) ?? screen.getCursorScreenPoint();
            candidate.moved = hasNativeClickMoved({
                origin: candidate.originClient,
                current: currentClient,
            });
        }
        if (candidate &&
            shouldActivateNativeWindowDrag({
                interactionMode: currentInteractionMode,
                moved: candidate.moved,
                contextMenuActive,
                lastContextMenuClosedAtMs,
            })) {
            startPetWindowDrag(window, "native", {
                originBounds: candidate.originBounds,
                originCursor: candidate.originCursor,
            });
        }
        movePetWindowDrag(window, "native");
    });
    window.hookWindowMessage(WM_LBUTTONUP, (_wParam, lParam) => {
        const candidate = nativeClickCandidateState.get(window);
        nativeClickCandidateState.delete(window);
        if (windowDragState.has(window)) {
            endPetWindowDrag(window, "native");
            return;
        }
        if (candidate &&
            shouldDispatchNativePetClick({
                interactionMode: currentInteractionMode,
                moved: candidate.moved,
                contextMenuActive,
                lastContextMenuClosedAtMs,
            })) {
            const bounds = window.getBounds();
            const point = readNativeClientPoint(lParam) ?? (() => {
                const cursor = screen.getCursorScreenPoint();
                return { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
            })();
            window.webContents.send("pet:native-left-click", {
                clientX: point.x,
                clientY: point.y,
            });
            logPetDebugEvent("native-mouse:left-click-fallback", {
                clientX: point.x,
                clientY: point.y,
                interactionMode: currentInteractionMode,
                source: "native-click-candidate",
            });
        }
    });
}
async function createContextMenuWindow(bounds, openedAtMs) {
    const menuWindow = new BrowserWindow(createContextMenuBrowserWindowOptions(path.join(__dirname, "preload.cjs"), bounds));
    contextMenuWindow = menuWindow;
    menuWindow.setMenuBarVisibility(false);
    menuWindow.setAlwaysOnTop(true, "pop-up-menu");
    menuWindow.focus();
    logPetDebugEvent("context-menu-window:created", {
        openedAtMs,
        presentToWindowCreateMs: Date.now() - openedAtMs,
        bounds,
    });
    menuWindow.on("blur", () => {
        if (!menuWindow.isDestroyed())
            menuWindow.destroy();
        if (contextMenuActive) {
            contextMenuActive = false;
            lastContextMenuClosedAtMs = Date.now();
            logPetDebugEvent("context-menu:closed", { reason: "menu-window-blur" });
        }
    });
    menuWindow.on("closed", () => {
        if (contextMenuWindow === menuWindow)
            contextMenuWindow = null;
    });
    await loadRendererPage(menuWindow, "menu");
    logPetDebugEvent("context-menu-window:renderer-ready", {
        processId: menuWindow.webContents.getOSProcessId(),
        url: menuWindow.webContents.getURL(),
        openedAtMs,
        presentToRendererReadyMs: Date.now() - openedAtMs,
    });
    return menuWindow;
}
function createDiagnosticBlankWindow(bounds) {
    if (diagnosticBlankWindow && !diagnosticBlankWindow.isDestroyed()) {
        diagnosticBlankWindow.destroy();
    }
    const blankWindow = new BrowserWindow(createDiagnosticBlankBrowserWindowOptions(bounds));
    diagnosticBlankWindow = blankWindow;
    blankWindow.setMenuBarVisibility(false);
    blankWindow.setAlwaysOnTop(true, "pop-up-menu");
    blankWindow.on("unresponsive", () => {
        logPetDebugEvent("context-menu:diagnostic-blank-unresponsive");
    });
    blankWindow.on("responsive", () => {
        logPetDebugEvent("context-menu:diagnostic-blank-responsive");
    });
    blankWindow.on("blur", () => {
        if (!blankWindow.isDestroyed())
            blankWindow.close();
        contextMenuActive = false;
        lastContextMenuClosedAtMs = Date.now();
        logPetDebugEvent("context-menu:closed", { reason: "diagnostic-blank-blur" });
    });
    blankWindow.on("closed", () => {
        if (diagnosticBlankWindow === blankWindow)
            diagnosticBlankWindow = null;
    });
    blankWindow.show();
    blankWindow.focus();
    return blankWindow;
}
const DAILY_SCAN_HOUR = 4; // 4 AM local time
let sessionScanTimer = null;
function msUntilNextDailyScan(now = new Date()) {
    const next = new Date(now);
    next.setHours(DAILY_SCAN_HOUR, 0, 0, 0);
    if (next <= now)
        next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
}
function scheduleNextDailyScan(window) {
    const delay = msUntilNextDailyScan();
    sessionScanTimer = setTimeout(() => {
        void scanAndUpsertRecentCodexSessions(window).finally(() => {
            scheduleNextDailyScan(window);
        });
    }, delay);
    logPetDebugEvent("codex-session:daily-scan-scheduled", {
        nextScanInMs: delay,
        nextScanAt: new Date(Date.now() + delay).toISOString(),
    });
}
async function scanAndUpsertRecentCodexSessions(window, options = {}) {
    if (window.isDestroyed())
        return;
    const context = captureActiveCodexSessionContext();
    const workspacePath = options.workspacePath?.trim() || context.workspacePath;
    const agent = options.agent ?? context.agent;
    if (!shouldUpsertSessionsToApi(agent))
        return;
    try {
        const local = (await readAllLocalAgentSessions(20)).filter((item) => item.menuSession.agent === "codex" &&
            item.menuSession.runtime !== "app-server" &&
            item.payload.pet_session_id.startsWith("codex:") &&
            normalizeWorkspacePathIdentity(item.menuSession.workspace_path) ===
                normalizeWorkspacePathIdentity(workspacePath));
        for (const item of [...local].reverse()) {
            try {
                await upsertDesktopPetSession(item.payload);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logPetDebugEvent("codex-session:scan-upsert-error", {
                    workspacePath,
                    codexSessionId: item.payload.codex_session_id,
                    error: message,
                });
                break;
            }
        }
        if (options.publishStatus !== false &&
            local[0] &&
            !window.isDestroyed() &&
            isActiveCodexSessionContext(context) &&
            !codexSessionOutputWatches.has(window)) {
            publishCodexStatusForSession(window, local[0].menuSession, { agent });
        }
        logPetDebugEvent("codex-session:background-scan", {
            workspacePath,
            scanned: local.length,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logPetDebugEvent("codex-session:background-scan-error", { workspacePath, error: message });
    }
}
function restorePetWindowAfterRendererLoad(window) {
    if (window.isDestroyed())
        return;
    const wasMinimized = window.isMinimized();
    if (wasMinimized) {
        window.restore();
    }
    if (wasMinimized || !window.isVisible()) {
        window.showInactive();
    }
    if (wasMinimized) {
        logPetDebugEvent("pet-window:restored-after-renderer-load");
    }
}
async function createPetWindow() {
    logPetDebugEvent("app:start", {
        isDev,
        releaseMode,
        devRendererUrl,
        productionRendererRoot,
        petReadyFilePath,
        debugEventsLogPath,
    });
    completionNoticePersistencePath = path.join(app.getPath("userData"), "dismissed-completion-notice.json");
    completionNoticeState = createCompletionNoticeReducerState(readPersistedCompletionNoticeKeys());
    startKnowledgeHandoffTransport();
    const cleaned = cleanupStaleVscodeUserDataDirs();
    if (cleaned.removed.length) {
        logPetDebugEvent("vscode-user-data:cleanup", { removed: cleaned.removed.length, scanned: cleaned.scanned });
    }
    const cleanedWorkspaces = cleanupStaleVscodeWorkspaceDirs();
    if (cleanedWorkspaces.removed.length) {
        logPetDebugEvent("vscode-workspace:cleanup", {
            removed: cleanedWorkspaces.removed.length,
            scanned: cleanedWorkspaces.scanned,
        });
    }
    const settings = applyPersistedPetPreferences();
    const displayWorkAreas = screen.getAllDisplays().map((display) => display.workArea);
    const windowOptions = createPetBrowserWindowOptions(path.join(__dirname, "preload.cjs"), settings.windowBounds, displayWorkAreas);
    if (settings.windowBounds &&
        (windowOptions.x !== settings.windowBounds.x || windowOptions.y !== settings.windowBounds.y)) {
        logPetDebugEvent("window-bounds:restored-to-visible-area", {
            savedBounds: settings.windowBounds,
            restoredBounds: { x: windowOptions.x, y: windowOptions.y, width: windowOptions.width, height: windowOptions.height },
            displayWorkAreas,
        });
    }
    const window = new BrowserWindow(windowOptions);
    petWindow = window;
    const createdBounds = window.getBounds();
    window.setBounds({
        x: windowOptions.x ?? createdBounds.x,
        y: windowOptions.y ?? createdBounds.y,
        width: windowOptions.width ?? createdBounds.width,
        height: windowOptions.height ?? createdBounds.height,
    });
    void refreshApiRuntimeStatus();
    applyPetAlwaysOnTop(window, currentAlwaysOnTop);
    installNativeMouseHooks(window);
    const syncCompletionNoticePosition = () => {
        persistPetWindowBounds(window);
        positionCompletionNoticeWindow();
    };
    window.on("resize", syncCompletionNoticePosition);
    window.on("resized", syncCompletionNoticePosition);
    window.on("move", syncCompletionNoticePosition);
    window.on("moved", syncCompletionNoticePosition);
    window.on("close", () => {
        logPetDebugEvent("pet-window:close-requested", {
            contextMenuActive,
            nativeMenuOwnerAlive: Boolean(nativeMenuOwnerWindow && !nativeMenuOwnerWindow.isDestroyed()),
        });
        stopCodexSessionOutputWatch(window, "window-close");
        stopAgentSessionRefresh("window-close");
        destroyCompletionNoticeWindow();
        persistPetWindowBounds(window);
        if (contextMenuWindow && !contextMenuWindow.isDestroyed()) {
            contextMenuWindow.close();
        }
        if (diagnosticBlankWindow && !diagnosticBlankWindow.isDestroyed()) {
            diagnosticBlankWindow.close();
        }
        if (nativeMenuOwnerWindow && !nativeMenuOwnerWindow.isDestroyed()) {
            nativeMenuOwnerWindow.close();
        }
    });
    window.on("closed", () => {
        destroyCompletionNoticeWindow();
        if (petWindow === window)
            petWindow = null;
        logPetDebugEvent("pet-window:closed");
    });
    window.webContents.on("context-menu", (event, params) => {
        event.preventDefault();
        logPetDebugEvent("context-menu:webcontents-event", { x: params.x, y: params.y });
        openPetContextMenu(window, { space: "window", point: { x: params.x, y: params.y } }, "webcontents");
    });
    window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
        logPetDebugEvent("renderer:console", { level, message, line, sourceId });
    });
    window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
        logPetDebugEvent("renderer:did-fail-load", { errorCode, errorDescription, validatedURL });
    });
    window.webContents.on("did-finish-load", () => {
        logPetDebugEvent("renderer:did-finish-load", { url: window.webContents.getURL() });
        logPetDebugEvent("pet-window:renderer-ready", {
            processId: window.webContents.getOSProcessId(),
            url: window.webContents.getURL(),
        });
        restorePetWindowAfterRendererLoad(window);
        void writePetReadyMarkerForWindow(window);
        logRendererDomState(window, "did-finish-load");
        setTimeout(() => logRendererDomState(window, "after-1500ms"), 1500);
        void refreshRecentSessionsInBackground(window);
    });
    // Daily 4AM scan: catch sessions that completed while pet was running overnight
    // or that were missed by the watch-based trigger. Session completion during
    // the day is handled by the Codex session output watch.
    scheduleNextDailyScan(window);
    scheduleAgentSessionRefresh(window);
    if (!completionNoticeDisplayMetricsListenerInstalled) {
        screen.on("display-metrics-changed", () => positionCompletionNoticeWindow());
        completionNoticeDisplayMetricsListenerInstalled = true;
    }
    await loadRendererPage(window, "index");
    seedCompletionNoticeDemo();
}
ipcMain.handle("pet:runtime-info", () => ({
    apiBaseUrl,
    apiRuntimeStatus: currentApiRuntimeStatus,
}));
ipcMain.handle("pet:interaction-mode:get", () => currentInteractionMode);
ipcMain.handle("pet:interaction-mode:set", (event, nextMode) => {
    const mode = normalizeInteractionMode(nextMode);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
        publishInteractionMode(window, mode);
    }
    else {
        currentInteractionMode = mode;
    }
    return currentInteractionMode;
});
ipcMain.handle("pet:notification-profile:get", () => currentNotificationProfile);
ipcMain.handle("pet:agent:get", () => currentAgent);
ipcMain.handle("pet:codex-env:get", () => currentCodexEnvMode);
ipcMain.handle("pet:codex-status:get", () => currentCodexStatus);
ipcMain.handle("pet:completion-notice:status:get", (event) => {
    if (!completionNoticeSenderIsCurrent(event))
        return null;
    return toCompletionNoticeWindowState(completionNoticeState);
});
ipcMain.handle("pet:completion-notice:expand", (event) => {
    if (!completionNoticeSenderIsCurrent(event))
        return false;
    completionNoticeState = reduceCompletionNoticeState(completionNoticeState, { type: "expand" });
    publishCompletionNoticeState();
    return true;
});
ipcMain.handle("pet:completion-notice:collapse", (event) => {
    if (!completionNoticeSenderIsCurrent(event))
        return false;
    completionNoticeState = reduceCompletionNoticeState(completionNoticeState, { type: "collapse" });
    publishCompletionNoticeState();
    return true;
});
ipcMain.handle("pet:completion-notice:dismiss", (event, rawKey) => {
    if (!completionNoticeSenderIsCurrent(event))
        return false;
    const key = typeof rawKey === "string" ? rawKey.trim() : "";
    if (!key)
        return false;
    completionNoticeState = reduceCompletionNoticeState(completionNoticeState, { type: "dismiss", key });
    persistCompletionNoticeKeys(completionNoticeState.dismissedKeys);
    publishCompletionNoticeState();
    return true;
});
ipcMain.handle("pet:completion-notice:restore", async (event, rawKey) => {
    if (!completionNoticeSenderIsCurrent(event)) {
        return { ok: false, reason: "window-unavailable", message: "通知窗口不可用" };
    }
    const key = typeof rawKey === "string" ? rawKey.trim() : "";
    if (!key) {
        return { ok: false, reason: "missing-target", message: "目标任务不存在" };
    }
    const { notice, session } = completionNoticeSessionForNotice(key);
    if (!notice || !session) {
        logPetDebugEvent("completion-notice:restore-missing-target", {
            completionNoticeKey: key,
            petSessionId: notice?.petSessionId,
            codexSessionId: notice?.codexSessionId,
        });
        return { ok: false, reason: "missing-target", message: "目标任务不存在" };
    }
    if (!petWindow || petWindow.isDestroyed()) {
        return { ok: false, reason: "window-unavailable", message: "Pet 主窗口不可用" };
    }
    try {
        await dispatchMenuAction(petWindow, {
            type: "restore-session",
            petSessionId: session.pet_session_id || session.codex_session_id || "",
        });
        logPetDebugEvent("completion-notice:restore-requested", {
            completionNoticeKey: key,
            petSessionId: session.pet_session_id,
            codexSessionId: session.codex_session_id,
            workspacePath: session.workspace_path,
        });
        return { ok: true, mode: "restore-requested" };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logPetDebugEvent("completion-notice:restore-error", {
            completionNoticeKey: key,
            petSessionId: session.pet_session_id,
            codexSessionId: session.codex_session_id,
            error: message,
        });
        return { ok: false, reason: "not-running", message };
    }
});
ipcMain.handle("pet:completion-notice:stop", async (event, rawKey) => {
    if (!completionNoticeSenderIsCurrent(event)) {
        return { ok: false, reason: "window-unavailable", message: "通知窗口不可用" };
    }
    const key = typeof rawKey === "string" ? rawKey.trim() : "";
    const { notice, session } = completionNoticeSessionForNotice(key);
    if (!notice || !session) {
        return { ok: false, reason: "missing-target", message: "目标任务不存在" };
    }
    const sessionId = completionNoticeAppServerSessionId(session);
    if (!sessionId) {
        logPetDebugEvent("completion-notice:stop-unsupported", {
            completionNoticeKey: key,
            petSessionId: session.pet_session_id,
            codexSessionId: session.codex_session_id,
            runtime: completionNoticeRuntimeForSession(session),
        });
        return {
            ok: false,
            reason: "unsupported-runtime",
            message: "当前运行模式不支持自动停止",
        };
    }
    try {
        const result = await getCodexInteractiveRelay().cancelTurn(sessionId);
        logPetDebugEvent("completion-notice:stop-result", {
            completionNoticeKey: key,
            petSessionId: session.pet_session_id,
            codexSessionId: session.codex_session_id,
            ...result,
        });
        if (result.ok && petWindow && !petWindow.isDestroyed()) {
            publishCodexStatus(petWindow, {
                state: "idle",
                workspacePath: session.workspace_path ?? undefined,
                sessionTitle: sessionTitle(session),
                petSessionId: session.pet_session_id ?? undefined,
                codexSessionId: session.codex_session_id || undefined,
                agent: session.agent === "claude" ? "claude" : "codex",
                runtime: "app-server",
                stopSupported: completionNoticeStopSupportedForSession(session),
                lastOutput: "任务已停止",
                source: "app-server",
            });
        }
        return result;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logPetDebugEvent("completion-notice:stop-error", {
            completionNoticeKey: key,
            petSessionId: session.pet_session_id,
            codexSessionId: session.codex_session_id,
            error: message,
        });
        return { ok: false, reason: "connection-failed", message };
    }
});
ipcMain.handle("pet:codex:focus", async (event, rawOptions) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow)
        return false;
    const options = codexFocusRequestOptions(rawOptions);
    const source = codexFocusSourceForRequest(event, options.source);
    const workspacePath = options.workspacePath || currentCodexStatus.workspacePath || resolveCurrentWorkspacePath();
    const codexSessionId = options.codexSessionId || currentCodexStatus.codexSessionId;
    try {
        if (currentAgent === "codex" && currentCodexLaunchTarget === "codex-desktop") {
            if (!codexSessionId) {
                throw new Error("Codex session metadata is missing");
            }
            const result = await launchCodexDesktopExistingSession({ codexSessionId });
            logPetDebugEvent(codexFocusLogType(source), {
                ...result,
                workspacePath,
                codexLaunchTarget: currentCodexLaunchTarget,
            });
            return true;
        }
        const result = focusVscodeWorkspace({ workspacePath });
        logPetDebugEvent(codexFocusLogType(source), {
            ...result,
            workspacePath,
            codexLaunchTarget: currentCodexLaunchTarget,
        });
        return true;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logPetDebugEvent(codexFocusLogType(source, "-error"), {
            workspacePath,
            codexSessionId,
            codexLaunchTarget: currentCodexLaunchTarget,
            error: message,
        });
        const statusWindow = senderWindow === completionNoticeWindow
            ? petWindow
            : senderWindow;
        if (statusWindow && !statusWindow.isDestroyed()) {
            publishCodexStatus(statusWindow, {
                state: "failed",
                workspacePath,
                codexSessionId,
                error: message,
                source: "terminal",
            });
        }
        throw error;
    }
});
ipcMain.handle("pet:clipboard:write-text", (_event, text) => {
    const value = typeof text === "string" ? text : "";
    if (!value.trim())
        return false;
    clipboard.writeText(value);
    logPetDebugEvent("clipboard:write", { length: value.length });
    return true;
});
ipcMain.handle("pet:api-runtime:get", () => currentApiRuntimeStatus);
ipcMain.handle("pet:api-runtime:retry", () => refreshApiRuntimeStatus());
ipcMain.handle("pet:menu:execute", async (event, action) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const window = petWindow;
    if (!window || window.isDestroyed() || !action || typeof action !== "object" || typeof action.type !== "string") {
        return false;
    }
    if (senderWindow && !senderWindow.isDestroyed())
        senderWindow.destroy();
    contextMenuActive = false;
    lastContextMenuClosedAtMs = Date.now();
    logPetDebugEvent("context-menu:closed", { reason: "action" });
    await dispatchMenuAction(window, action);
    return true;
});
ipcMain.on("pet:menu:closed", (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (senderWindow && !senderWindow.isDestroyed())
        senderWindow.destroy();
    contextMenuActive = false;
    lastContextMenuClosedAtMs = Date.now();
    logPetDebugEvent("context-menu:closed", { reason: "renderer" });
});
ipcMain.on("pet:menu:request-paint", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed() || window.webContents.isDestroyed())
        return;
    window.webContents.invalidate();
    logPetDebugEvent("context-menu:paint-requested");
});
function readMenuOpenedAtMs(payload) {
    return payload && typeof payload === "object" && typeof payload.openedAtMs === "number"
        ? payload.openedAtMs
        : undefined;
}
ipcMain.on("pet:menu:received", (_event, payload) => {
    const openedAtMs = readMenuOpenedAtMs(payload);
    logPetDebugEvent("context-menu:received", {
        openedAtMs,
        presentToReceiveMs: typeof openedAtMs === "number" ? Date.now() - openedAtMs : undefined,
    });
});
ipcMain.on("pet:menu:committed", (event, payload) => {
    const openedAtMs = readMenuOpenedAtMs(payload);
    logPetDebugEvent("context-menu:committed", {
        openedAtMs,
        presentToCommitMs: typeof openedAtMs === "number" ? Date.now() - openedAtMs : undefined,
    });
});
ipcMain.on("pet:menu:painted", (_event, payload) => {
    const openedAtMs = readMenuOpenedAtMs(payload);
    logPetDebugEvent("context-menu:painted", {
        openedAtMs,
        presentToPaintMs: typeof openedAtMs === "number" ? Date.now() - openedAtMs : undefined,
    });
});
ipcMain.handle("pet:vscode:focus", async (event, options) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window)
        return false;
    const requestedWorkspacePath = options && typeof options === "object" && typeof options.workspacePath === "string"
        ? options.workspacePath.trim()
        : "";
    const workspacePath = requestedWorkspacePath || resolveCurrentWorkspacePath();
    try {
        const result = focusVscodeWorkspace({ workspacePath });
        logPetDebugEvent("codex-launch:focus-vscode", { ...result, requestedWorkspacePath });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logPetDebugEvent("codex-launch:focus-vscode-error", { workspacePath, requestedWorkspacePath, error: message });
        publishCodexStatus(window, { state: "failed", workspacePath, error: message, source: "terminal" });
        throw error;
    }
    return true;
});
ipcMain.handle("pet:sessions:restore", async (event, petSessionId) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const selectedPetSessionId = typeof petSessionId === "string" ? petSessionId.trim() : "";
    if (!window || !selectedPetSessionId)
        return false;
    await dispatchMenuAction(window, { type: "restore-session", petSessionId: selectedPetSessionId });
    return true;
});
ipcMain.handle("pet:sessions:focus-active", async (event, petSessionId) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const selectedPetSessionId = typeof petSessionId === "string" ? petSessionId.trim() : "";
    if (!window || !selectedPetSessionId)
        return false;
    await dispatchMenuAction(window, { type: "focus-active-session", petSessionId: selectedPetSessionId });
    return true;
});
ipcMain.handle("pet:prompt:send", async (event, prompt) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window)
        return false;
    const workspacePath = resolveCurrentWorkspacePath();
    const sentAt = Date.now();
    const promptText = typeof prompt === "string" ? prompt : "";
    // Without the VSCode helper there is no way to inject text into a running
    // terminal. The prompt itself becomes the copyable command line: the user
    // pastes it into the active agent session in their VSCode window.
    const trimmedPrompt = promptText.trim();
    if (!trimmedPrompt)
        return false;
    logPetDebugEvent("pet-prompt:copy-command", { agent: currentAgent, workspacePath });
    publishCodexStatus(window, {
        ...currentCodexStatus,
        state: "running",
        workspacePath,
        commandLine: trimmedPrompt,
        source: currentAgent === "claude" ? "claude-jsonl" : "terminal",
    });
    startCodexSessionOutputWatch(window, workspacePath, { minModifiedAtMs: sentAt - 1000 });
    window.webContents.send("pet:menu:action", { type: "prompt-sent" });
    return true;
});
ipcMain.handle("pet:prompt:send-to-session", async (event, rawOptions) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow || !completionNoticeSenderIsCurrent(event)) {
        return { ok: false, reason: "window-unavailable", message: "通知窗口不可用" };
    }
    if (!rawOptions || typeof rawOptions !== "object") {
        return { ok: false, reason: "missing-target", message: "目标任务不存在" };
    }
    const options = rawOptions;
    const workspacePath = typeof options.workspacePath === "string" ? options.workspacePath.trim() : "";
    const petSessionId = typeof options.petSessionId === "string" ? options.petSessionId.trim() : "";
    const codexSessionId = typeof options.codexSessionId === "string" ? options.codexSessionId.trim() : "";
    const promptText = typeof options.prompt === "string" ? options.prompt.trim() : "";
    const session = findMenuSessionByPetId(petSessionId || codexSessionId);
    if (!session || !session.workspace_path) {
        return { ok: false, reason: "missing-target", message: "目标任务不存在" };
    }
    if (!workspacePath ||
        normalizeWorkspacePathIdentity(workspacePath) !==
            normalizeWorkspacePathIdentity(session.workspace_path)) {
        logPetDebugEvent("completion-notice:follow-up-workspace-mismatch", {
            petSessionId: session.pet_session_id,
            codexSessionId: session.codex_session_id,
            requestedWorkspacePath: workspacePath,
            sessionWorkspacePath: session.workspace_path,
        });
        return { ok: false, reason: "workspace-mismatch", message: "工作区与目标任务不一致" };
    }
    if (!promptText) {
        return { ok: false, reason: "missing-target", message: "继续跟进内容为空" };
    }
    const appServerSessionId = completionNoticeAppServerSessionId(session);
    if (appServerSessionId) {
        const result = await getCodexInteractiveRelay().sendUserMessage(appServerSessionId, promptText, completionNoticeInteractiveMode(session));
        logPetDebugEvent("completion-notice:follow-up-result", {
            petSessionId: session.pet_session_id,
            codexSessionId: session.codex_session_id,
            workspacePath: session.workspace_path,
            promptLength: promptText.length,
            ...result,
        });
        if (!result.ok)
            return result;
        const statusWindow = petWindow && !petWindow.isDestroyed() ? petWindow : senderWindow;
        publishCodexStatus(statusWindow, {
            state: "running",
            workspacePath: session.workspace_path,
            sessionTitle: sessionTitle(session),
            petSessionId: session.pet_session_id || undefined,
            codexSessionId: session.codex_session_id || undefined,
            agent: session.agent === "claude" ? "claude" : "codex",
            runtime: "app-server",
            stopSupported: completionNoticeStopSupportedForSession(session),
            source: "app-server",
        });
        if (petWindow && !petWindow.isDestroyed()) {
            petWindow.webContents.send("pet:menu:action", { type: "prompt-sent" });
        }
        return result;
    }
    clipboard.writeText(promptText);
    const statusWindow = petWindow && !petWindow.isDestroyed() ? petWindow : senderWindow;
    publishCodexStatus(statusWindow, {
        state: "running",
        workspacePath: session.workspace_path,
        sessionTitle: sessionTitle(session),
        petSessionId: session.pet_session_id || undefined,
        codexSessionId: session.codex_session_id || undefined,
        agent: session.agent === "claude" ? "claude" : "codex",
        runtime: completionNoticeRuntimeForSession(session),
        stopSupported: completionNoticeStopSupportedForSession(session),
        commandLine: promptText,
        source: session.agent === "claude" ? "claude-jsonl" : "terminal",
    });
    logPetDebugEvent("completion-notice:follow-up-copy-command", {
        petSessionId: session.pet_session_id,
        codexSessionId: session.codex_session_id,
        workspacePath: session.workspace_path,
        promptLength: promptText.length,
        execution: "copy-only",
    });
    if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send("pet:menu:action", { type: "prompt-sent" });
    }
    return { ok: true, mode: "copy-only" };
});
ipcMain.on("pet:renderer-error", (event, payload) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const eventPayload = payload && typeof payload === "object"
        ? payload
        : { message: String(payload) };
    logPetCrashEvent("renderer:error", {
        ...eventPayload,
        webContentsId: event.sender.id,
        url: window && !window.isDestroyed() ? window.webContents.getURL() : event.sender.getURL(),
    });
});
ipcMain.on("pet:window-drag:start", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window)
        return;
    startPetWindowDrag(window, "ipc");
});
ipcMain.on("pet:window-drag:move", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window)
        return;
    movePetWindowDrag(window, "ipc");
});
ipcMain.on("pet:window-drag:end", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window)
        return;
    endPetWindowDrag(window, "ipc");
});
app.whenReady().then(createPetWindow);
app.on("before-quit", () => {
    destroyCompletionNoticeWindow();
    logPetDebugEvent("app:before-quit", {
        windows: BrowserWindow.getAllWindows().length,
        petWindowAlive: Boolean(petWindow && !petWindow.isDestroyed()),
    });
});
app.on("will-quit", () => {
    destroyCompletionNoticeWindow();
    stopKnowledgeHandoffTransport();
    removePetReadyMarker();
    logPetDebugEvent("app:will-quit", {
        windows: BrowserWindow.getAllWindows().length,
    });
});
app.on("window-all-closed", () => {
    destroyCompletionNoticeWindow();
    logPetDebugEvent("app:window-all-closed", {
        petWindowAlive: Boolean(petWindow && !petWindow.isDestroyed()),
    });
    if (sessionScanTimer) {
        clearTimeout(sessionScanTimer);
        sessionScanTimer = null;
    }
    stopAgentSessionRefresh("window-all-closed");
    app.quit();
});
