import nodeFs from "node:fs";
import path from "node:path";
import { resolvePetWorkspacePath } from "./codexLauncher.js";
import { CODEX_ENV_MODES, CODEX_LAUNCH_TARGETS, MENU_LANGUAGES, NOTIFICATION_PROFILES, PET_AGENTS } from "./petMenuModel.js";
export const PET_SETTINGS_FILE_NAME = "pet-settings.json";
export const PET_WINDOW_SETTINGS_WIDTH = 360;
export const PET_WINDOW_SETTINGS_HEIGHT = 420;
export const PET_WINDOW_MIN_WIDTH = 240;
export const PET_WINDOW_MIN_HEIGHT = 280;
function petSettingsPath(userDataPath) {
    return path.join(userDataPath, PET_SETTINGS_FILE_NAME);
}
function normalizeWorkspacePath(value) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed)
        return undefined;
    if (trimmed.toLowerCase().startsWith("vscode-remote://"))
        return trimmed;
    return path.resolve(trimmed);
}
function normalizeCodexDesktopProject(value) {
    if (!value || typeof value !== "object")
        return undefined;
    const candidate = value;
    const projectId = typeof candidate.projectId === "string" ? candidate.projectId.trim() : "";
    const projectKind = candidate.projectKind === "remote" || candidate.projectKind === "local" || candidate.projectKind === "chatgpt"
        ? candidate.projectKind
        : undefined;
    const label = typeof candidate.label === "string" ? candidate.label.trim() : "";
    if (!projectId || !projectKind || !label)
        return undefined;
    return {
        projectId,
        projectKind,
        label,
        path: typeof candidate.path === "string" && candidate.path.trim() ? candidate.path.trim() : undefined,
        hostId: typeof candidate.hostId === "string" && candidate.hostId.trim() ? candidate.hostId.trim() : undefined,
        hostDisplayName: typeof candidate.hostDisplayName === "string" && candidate.hostDisplayName.trim() ? candidate.hostDisplayName.trim() : undefined,
        sshHost: typeof candidate.sshHost === "string" && /^[A-Za-z0-9._-]+$/.test(candidate.sshHost.trim()) ? candidate.sshHost.trim() : undefined,
    };
}
function normalizeMenuLanguageSetting(value) {
    return MENU_LANGUAGES.includes(value) ? value : undefined;
}
function normalizeNotificationProfileSetting(value) {
    return NOTIFICATION_PROFILES.includes(value) ? value : undefined;
}
function normalizeAlwaysOnTop(value) {
    return typeof value === "boolean" ? value : undefined;
}
function normalizeAgentSetting(value) {
    return PET_AGENTS.includes(value) ? value : undefined;
}
export function normalizePetWindowBounds(value) {
    if (!value || typeof value !== "object")
        return undefined;
    const bounds = value;
    const x = typeof bounds.x === "number" && Number.isFinite(bounds.x) ? Math.round(bounds.x) : undefined;
    const y = typeof bounds.y === "number" && Number.isFinite(bounds.y) ? Math.round(bounds.y) : undefined;
    const rawWidth = typeof bounds.width === "number" && Number.isFinite(bounds.width) ? Math.round(bounds.width) : undefined;
    const rawHeight = typeof bounds.height === "number" && Number.isFinite(bounds.height) ? Math.round(bounds.height) : undefined;
    if (x === undefined || y === undefined || rawWidth === undefined || rawHeight === undefined)
        return undefined;
    return {
        x,
        y,
        width: Math.max(PET_WINDOW_MIN_WIDTH, rawWidth),
        height: Math.max(PET_WINDOW_MIN_HEIGHT, rawHeight),
    };
}
function normalizePetSettingsPayload(payload) {
    const settings = {};
    const selectedWorkspacePath = normalizeWorkspacePath(payload.selectedWorkspacePath);
    const selectedCodexDesktopProject = normalizeCodexDesktopProject(payload.selectedCodexDesktopProject);
    const menuLanguage = normalizeMenuLanguageSetting(payload.menuLanguage);
    const notificationProfile = normalizeNotificationProfileSetting(payload.notificationProfile);
    const alwaysOnTop = normalizeAlwaysOnTop(payload.alwaysOnTop);
    const agent = normalizeAgentSetting(payload.agent);
    const codexEnvMode = CODEX_ENV_MODES.includes(payload.codexEnvMode) ? payload.codexEnvMode : undefined;
    const codexLaunchTarget = CODEX_LAUNCH_TARGETS.includes(payload.codexLaunchTarget)
        ? payload.codexLaunchTarget
        : undefined;
    const windowBounds = normalizePetWindowBounds(payload.windowBounds);
    if (selectedWorkspacePath)
        settings.selectedWorkspacePath = selectedWorkspacePath;
    if (selectedCodexDesktopProject)
        settings.selectedCodexDesktopProject = selectedCodexDesktopProject;
    if (menuLanguage)
        settings.menuLanguage = menuLanguage;
    if (notificationProfile)
        settings.notificationProfile = notificationProfile;
    if (alwaysOnTop !== undefined)
        settings.alwaysOnTop = alwaysOnTop;
    if (agent)
        settings.agent = agent;
    if (codexEnvMode)
        settings.codexEnvMode = codexEnvMode;
    if (codexLaunchTarget)
        settings.codexLaunchTarget = codexLaunchTarget;
    if (windowBounds)
        settings.windowBounds = windowBounds;
    return settings;
}
export function readPetSettings(options) {
    const fs = options.fs ?? nodeFs;
    const filePath = petSettingsPath(options.userDataPath);
    if (!fs.existsSync(filePath))
        return {};
    try {
        const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return normalizePetSettingsPayload(payload);
    }
    catch {
        return {};
    }
}
export function writePetSettings(options) {
    const fs = options.fs ?? nodeFs;
    const current = readPetSettings({ userDataPath: options.userDataPath, fs });
    const patch = normalizePetSettingsPayload(options.patch);
    const settings = { ...current, ...patch };
    fs.mkdirSync(options.userDataPath, { recursive: true });
    fs.writeFileSync(petSettingsPath(options.userDataPath), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    return settings;
}
export function writeSelectedWorkspacePath(options) {
    const selectedWorkspacePath = normalizeWorkspacePath(options.workspacePath);
    const fs = options.fs ?? nodeFs;
    const current = readPetSettings({ userDataPath: options.userDataPath, fs });
    const settings = { ...current };
    delete settings.selectedCodexDesktopProject;
    if (selectedWorkspacePath)
        settings.selectedWorkspacePath = selectedWorkspacePath;
    fs.mkdirSync(options.userDataPath, { recursive: true });
    fs.writeFileSync(petSettingsPath(options.userDataPath), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    return settings;
}
export function resolveSelectedWorkspacePath(options) {
    const settings = readPetSettings({ userDataPath: options.userDataPath, fs: options.fs });
    return settings.selectedCodexDesktopProject?.path ?? settings.selectedWorkspacePath ?? resolvePetWorkspacePath({ cwd: options.cwd, env: options.env });
}
export function resolvePetAgent(options) {
    const settings = readPetSettings({ userDataPath: options.userDataPath, fs: options.fs });
    return settings.agent ?? "codex";
}
export function resolvePetCodexEnvMode(options) {
    const settings = readPetSettings({ userDataPath: options.userDataPath, fs: options.fs });
    return settings.codexEnvMode ?? "win";
}
