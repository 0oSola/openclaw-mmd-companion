import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
export function isSshWorkspaceUri(value) {
    return typeof value === "string" && value.trim().toLowerCase().startsWith("vscode-remote://ssh-remote+");
}
export function workspaceKind(value) {
    return isSshWorkspaceUri(value) ? "ssh" : "local";
}
export function remoteAuthorityFromUri(value) {
    if (!isSshWorkspaceUri(value))
        return undefined;
    try {
        const url = new URL(value);
        return decodeURIComponent(url.host.replace(/^ssh-remote\+/i, ""));
    }
    catch {
        return undefined;
    }
}
export function remoteWorkspaceLabel(value) {
    if (!isSshWorkspaceUri(value))
        return path.basename(value.replaceAll("\\", "/")) || value;
    try {
        const url = new URL(value);
        const remote = remoteAuthorityFromUri(value) || "SSH";
        const remotePath = decodeURIComponent(url.pathname || "/").replace(/^\/+/, "");
        return `${remote}:${remotePath.split("/").filter(Boolean).at(-1) || "/"}`;
    }
    catch {
        return value;
    }
}
export function workspaceDisplayLabel(value) {
    return remoteWorkspaceLabel(value);
}
function vscodeUserDataRoots(env) {
    const roots = [
        env.MMD_PET_VSCODE_USER_DATA_DIR,
        path.join(env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Code"),
        path.join(env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Code - Insiders"),
    ];
    return Array.from(new Set(roots.filter((value) => Boolean(value && value.trim()))));
}
function workspaceUriFromRecord(payload, workspaceFilePath) {
    const value = typeof payload.folder === "string" ? payload.folder : typeof payload.workspace === "string" ? payload.workspace : "";
    if (!value)
        return undefined;
    if (value.startsWith("vscode-remote://"))
        return value;
    if (value.startsWith("file:")) {
        try {
            const localWorkspaceFile = fileURLToPath(value);
            if (!localWorkspaceFile.toLowerCase().endsWith(".code-workspace"))
                return undefined;
            const workspacePayload = JSON.parse(nodeFs.readFileSync(localWorkspaceFile, "utf8"));
            const folder = workspacePayload.folders?.[0];
            if (folder?.uri?.startsWith("vscode-remote://"))
                return folder.uri;
            if (folder?.path?.startsWith("vscode-remote://"))
                return folder.path;
        }
        catch {
            return undefined;
        }
        return undefined;
    }
    if (path.isAbsolute(value) && value.toLowerCase().endsWith(".code-workspace")) {
        try {
            const workspacePayload = JSON.parse(nodeFs.readFileSync(value, "utf8"));
            const folder = workspacePayload.folders?.[0];
            if (folder?.uri?.startsWith("vscode-remote://"))
                return folder.uri;
            if (folder?.path?.startsWith("vscode-remote://"))
                return folder.path;
        }
        catch {
            return undefined;
        }
    }
    void workspaceFilePath;
    return undefined;
}
export function discoverSshWorkspaces(options = {}) {
    const env = options.env ?? process.env;
    const fs = options.fs ?? nodeFs;
    const result = [];
    const seen = new Set();
    for (const userDataRoot of vscodeUserDataRoots(env)) {
        const storageRoot = path.join(userDataRoot, "User", "workspaceStorage");
        if (!fs.existsSync(storageRoot))
            continue;
        let entries = [];
        try {
            entries = fs.readdirSync(storageRoot, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            const workspaceFilePath = path.join(storageRoot, entry.name, "workspace.json");
            if (!fs.existsSync(workspaceFilePath))
                continue;
            try {
                const payload = JSON.parse(fs.readFileSync(workspaceFilePath, "utf8"));
                const uri = workspaceUriFromRecord(payload, workspaceFilePath);
                if (!uri || !isSshWorkspaceUri(uri) || seen.has(uri))
                    continue;
                seen.add(uri);
                const authority = remoteAuthorityFromUri(uri);
                result.push({
                    id: `ssh:${authority || entry.name}`,
                    path: uri,
                    source: "vscode-remote-ssh",
                    kind: "ssh",
                    remoteAuthority: authority,
                    label: remoteWorkspaceLabel(uri),
                });
            }
            catch {
                // Ignore stale or locked VS Code workspace records.
            }
        }
    }
    return result;
}
