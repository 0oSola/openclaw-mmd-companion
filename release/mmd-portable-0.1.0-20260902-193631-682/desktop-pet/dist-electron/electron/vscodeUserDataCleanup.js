import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { VSCODE_USER_DATA_ROOT_DIR, VSCODE_WORKSPACE_ROOT_DIR } from "./codexLauncher.js";
export const VSCODE_USER_DATA_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export function vscodeUserDataRoot(tmpDir = os.tmpdir()) {
    return path.join(tmpDir, VSCODE_USER_DATA_ROOT_DIR);
}
export function vscodeWorkspaceRoot(tmpDir = os.tmpdir()) {
    return path.join(tmpDir, VSCODE_WORKSPACE_ROOT_DIR);
}
// Legacy isolated profiles and the newer launch-scoped .code-workspace bundles
// both live under the OS temp area. Startup removes entries older than the max
// age on a best-effort basis; locked or already-removed paths never block Pet.
export function cleanupStaleVscodeUserDataDirs(options = {}) {
    const fs = options.fs ?? nodeFs;
    const root = vscodeUserDataRoot(options.tmpDir);
    return cleanupStaleDirs(root, fs, options);
}
export function cleanupStaleVscodeWorkspaceDirs(options = {}) {
    const fs = options.fs ?? nodeFs;
    const root = vscodeWorkspaceRoot(options.tmpDir);
    return cleanupStaleDirs(root, fs, options);
}
function cleanupStaleDirs(root, fs, options) {
    const now = options.now ?? Date.now();
    const maxAgeMs = options.maxAgeMs ?? VSCODE_USER_DATA_MAX_AGE_MS;
    const removed = [];
    if (!fs.existsSync(root))
        return { removed, scanned: 0 };
    let entries;
    try {
        entries = fs.readdirSync(root, { withFileTypes: true });
    }
    catch {
        return { removed, scanned: 0 };
    }
    let scanned = 0;
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        scanned += 1;
        const dirPath = path.join(root, entry.name);
        try {
            if (now - fs.statSync(dirPath).mtimeMs <= maxAgeMs)
                continue;
            fs.rmSync(dirPath, { recursive: true, force: true });
            removed.push(dirPath);
        }
        catch {
            // Locked or already-removed dir: skip, never block startup.
        }
    }
    return { removed, scanned };
}
