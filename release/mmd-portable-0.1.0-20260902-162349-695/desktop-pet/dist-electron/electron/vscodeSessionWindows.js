import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VSCODE_USER_DATA_ROOT_DIR, VSCODE_WORKSPACE_ROOT_DIR } from "./codexLauncher.js";
export const VSCODE_SESSION_WINDOW_MARKER_PATH = path.join(".codex-pet", "session-window.json");
function compactText(value) {
    return typeof value === "string" ? value.trim() : "";
}
function normalizeFsPath(value) {
    return path.resolve(value).toLowerCase();
}
function legacyMarkerPath(userDataDir) {
    return path.join(userDataDir, VSCODE_SESSION_WINDOW_MARKER_PATH);
}
function workspaceMarkerPath(workspaceFilePath) {
    return path.join(path.dirname(workspaceFilePath), VSCODE_SESSION_WINDOW_MARKER_PATH);
}
function safeTimestamp(value) {
    const timestamp = Date.parse(compactText(value));
    return Number.isFinite(timestamp) ? timestamp : 0;
}
function decodeWorkspaceFolder(value) {
    const text = compactText(value);
    if (!text)
        return "";
    if (text.startsWith("file:")) {
        try {
            const decoded = fileURLToPath(text);
            return /^\/[A-Za-z]:[\\/]/.test(decoded) ? path.win32.normalize(decoded.slice(1)) : decoded;
        }
        catch {
            return "";
        }
    }
    return text;
}
function sortByNewest(items) {
    return [...items].sort((left, right) => right.updatedAtMs - left.updatedAtMs);
}
function parseMarker(value) {
    try {
        const marker = JSON.parse(value);
        const workspacePath = compactText(marker.workspacePath);
        const userDataDir = compactText(marker.userDataDir);
        const workspaceFilePath = compactText(marker.workspaceFilePath);
        const updatedAt = compactText(marker.updatedAt);
        if ((marker.version !== 1 && marker.version !== 2) || !workspacePath || (!userDataDir && !workspaceFilePath) || !updatedAt) {
            return null;
        }
        return {
            version: marker.version,
            workspacePath,
            userDataDir: userDataDir || undefined,
            workspaceFilePath: workspaceFilePath || undefined,
            agent: compactText(marker.agent) || "codex",
            petSessionId: compactText(marker.petSessionId) || undefined,
            codexSessionId: compactText(marker.codexSessionId) || undefined,
            updatedAt,
        };
    }
    catch {
        return null;
    }
}
function listUserDataDirs(rootDir, fs) {
    if (!fs.existsSync(rootDir))
        return [];
    try {
        return fs
            .readdirSync(rootDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(rootDir, entry.name));
    }
    catch {
        return [];
    }
}
export function vscodeSessionWindowRoot(tmpDir = os.tmpdir()) {
    return path.join(tmpDir, VSCODE_USER_DATA_ROOT_DIR);
}
export function vscodeWorkspaceWindowRoot(tmpDir = os.tmpdir()) {
    return path.join(tmpDir, VSCODE_WORKSPACE_ROOT_DIR);
}
export function writeVscodeSessionWindowMarker(options) {
    const fs = options.fs ?? nodeFs;
    const userDataDir = compactText(options.userDataDir);
    const workspaceFilePath = compactText(options.workspaceFilePath);
    const workspacePath = compactText(options.workspacePath);
    if ((!userDataDir && !workspaceFilePath) || !workspacePath)
        return null;
    const marker = {
        version: workspaceFilePath ? 2 : 1,
        workspacePath,
        userDataDir: userDataDir || undefined,
        workspaceFilePath: workspaceFilePath || undefined,
        agent: compactText(options.agent) || "codex",
        petSessionId: compactText(options.petSessionId) || undefined,
        codexSessionId: compactText(options.codexSessionId) || undefined,
        updatedAt: options.updatedAt ?? new Date().toISOString(),
    };
    const destination = workspaceFilePath ? workspaceMarkerPath(workspaceFilePath) : legacyMarkerPath(userDataDir);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
    return marker;
}
function readSessionMarkers(rootDir, fs) {
    const markers = [];
    for (const userDataDir of listUserDataDirs(rootDir, fs)) {
        const destination = legacyMarkerPath(userDataDir);
        if (!fs.existsSync(destination))
            continue;
        try {
            const marker = parseMarker(fs.readFileSync(destination, "utf8"));
            if (marker)
                markers.push({ ...marker, updatedAtMs: safeTimestamp(marker.updatedAt) });
        }
        catch {
            // Locked or partially-written marker: ignore and continue scanning.
        }
    }
    return sortByNewest(markers);
}
function readWorkspaceSessionMarkers(rootDir, fs) {
    const markers = [];
    for (const launchDir of listUserDataDirs(rootDir, fs)) {
        const destination = path.join(launchDir, VSCODE_SESSION_WINDOW_MARKER_PATH);
        if (!fs.existsSync(destination))
            continue;
        try {
            const marker = parseMarker(fs.readFileSync(destination, "utf8"));
            if (marker)
                markers.push({ ...marker, updatedAtMs: safeTimestamp(marker.updatedAt) });
        }
        catch {
            // Locked or partially-written marker: ignore and continue scanning.
        }
    }
    return sortByNewest(markers);
}
function readWorkspaceFallbacks(rootDir, workspacePath, fs) {
    const expectedWorkspacePath = normalizeFsPath(workspacePath);
    const matches = [];
    for (const userDataDir of listUserDataDirs(rootDir, fs)) {
        const workspaceStorageDir = path.join(userDataDir, "User", "workspaceStorage");
        if (!fs.existsSync(workspaceStorageDir))
            continue;
        let entries;
        try {
            entries = fs.readdirSync(workspaceStorageDir, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            const workspaceJsonPath = path.join(workspaceStorageDir, entry.name, "workspace.json");
            if (!fs.existsSync(workspaceJsonPath))
                continue;
            try {
                const payload = JSON.parse(fs.readFileSync(workspaceJsonPath, "utf8"));
                const folderPath = decodeWorkspaceFolder(payload.folder);
                const workspaceFilePath = decodeWorkspaceFolder(payload.workspace);
                let resolvedWorkspacePath = folderPath;
                if (!resolvedWorkspacePath && workspaceFilePath && fs.existsSync(workspaceFilePath)) {
                    const workspacePayload = JSON.parse(fs.readFileSync(workspaceFilePath, "utf8"));
                    const configuredPath = compactText(workspacePayload.folders?.[0]?.path);
                    if (configuredPath) {
                        resolvedWorkspacePath = path.isAbsolute(configuredPath)
                            ? configuredPath
                            : path.resolve(path.dirname(workspaceFilePath), configuredPath);
                    }
                }
                if (!resolvedWorkspacePath || normalizeFsPath(resolvedWorkspacePath) !== expectedWorkspacePath)
                    continue;
                const stat = fs.statSync(userDataDir);
                matches.push({ userDataDir, workspaceFilePath: workspaceFilePath || undefined, updatedAtMs: stat.mtimeMs });
            }
            catch {
                // Ignore unreadable workspace records from stale or locked VSCode dirs.
            }
        }
    }
    return sortByNewest(matches);
}
export function resolveVscodeSessionWindow(options) {
    const fs = options.fs ?? nodeFs;
    const rootDir = options.rootDir ?? vscodeSessionWindowRoot();
    const workspaceRootDir = options.workspaceRootDir ?? vscodeWorkspaceWindowRoot();
    const workspacePath = compactText(options.workspacePath);
    if (!workspacePath)
        return undefined;
    const expectedWorkspacePath = normalizeFsPath(workspacePath);
    const petSessionId = compactText(options.petSessionId);
    const codexSessionId = compactText(options.codexSessionId);
    const agent = compactText(options.agent);
    const markers = sortByNewest([
        ...readSessionMarkers(rootDir, fs),
        ...readWorkspaceSessionMarkers(workspaceRootDir, fs),
    ]);
    for (const marker of markers) {
        if (normalizeFsPath(marker.workspacePath) !== expectedWorkspacePath)
            continue;
        if (agent && marker.agent !== agent)
            continue;
        const resolution = { source: "marker" };
        if (marker.userDataDir)
            resolution.userDataDir = marker.userDataDir;
        if (marker.workspaceFilePath)
            resolution.workspaceFilePath = marker.workspaceFilePath;
        if (petSessionId && marker.petSessionId === petSessionId)
            return resolution;
        if (codexSessionId && marker.codexSessionId === codexSessionId)
            return resolution;
    }
    const fallback = readWorkspaceFallbacks(rootDir, workspacePath, fs)[0];
    if (!fallback)
        return undefined;
    const resolution = {
        userDataDir: fallback.userDataDir,
        source: "workspace-storage",
    };
    if (fallback.workspaceFilePath)
        resolution.workspaceFilePath = fallback.workspaceFilePath;
    return resolution;
}
export function resolveVscodeSessionWindowUserDataDir(options) {
    return resolveVscodeSessionWindow(options)?.userDataDir;
}
