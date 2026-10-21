import fs from "node:fs";
import os from "node:os";
import path from "node:path";
function defaultLogRoot(env) {
    return env.CODEX_DESKTOP_LOG_DIR?.trim() || path.join(os.homedir(), "AppData", "Local", "Codex", "Logs");
}
function hostDisplayName(hostId) {
    return hostId.replace(/^remote-ssh-codex-managed:/, "") || hostId;
}
function projectLabel(remotePath) {
    const normalized = remotePath.replaceAll("\\", "/").replace(/\/+$/, "");
    return normalized.split("/").filter(Boolean).at(-1) || remotePath;
}
function isLikelyProjectPath(remotePath) {
    const normalized = remotePath.replaceAll("\\", "/").replace(/\/+$/, "");
    const name = normalized.split("/").filter(Boolean).at(-1)?.toLowerCase();
    return Boolean(name && name !== ".git" && name !== "eval");
}
function projectId(hostId, remotePath) {
    // Codex Desktop does not persist its private project registry in a public file.
    // Keep a stable local identity until an official project-list API is available.
    return `remote-${hostId}-${remotePath}`.replace(/[^a-zA-Z0-9._:-]+/g, "-");
}
function addRemoteProject(output, hostId, cwd, existingProjectId) {
    const normalizedHostId = hostId.trim();
    const normalizedCwd = cwd.trim();
    if (!normalizedHostId.startsWith("remote-ssh-codex-managed:") ||
        !normalizedCwd.startsWith("/") ||
        !isLikelyProjectPath(normalizedCwd))
        return;
    const key = `${normalizedHostId}\n${normalizedCwd}`;
    const existing = output.get(key);
    const normalizedProjectId = existingProjectId?.trim();
    if (existing && (!normalizedProjectId || existing.projectId === normalizedProjectId))
        return;
    if (existing && !existing.projectId.startsWith("remote-") && normalizedProjectId)
        return;
    output.set(key, {
        projectId: normalizedProjectId || existing?.projectId || projectId(normalizedHostId, normalizedCwd),
        projectKind: "remote",
        label: projectLabel(normalizedCwd),
        path: normalizedCwd,
        hostId: normalizedHostId,
        hostDisplayName: hostDisplayName(normalizedHostId),
    });
}
function collectRemoteProjectFromText(value, output) {
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        try {
            collectRemoteThreads(JSON.parse(trimmed), output);
            return;
        }
        catch {
            // Continue with bounded field extraction for truncated or non-JSON log text.
        }
    }
    const hostMatch = value.match(/(?:\\?"hostId\\?"\s*:\s*\\?"|\bhostId=)(remote-ssh-codex-managed:[^"\\\s]+)/);
    const cwdMatch = value.match(/(?:\\?"cwd\\?"\s*:\s*\\?"|\bcwd=)(\/[^"\\\s]+)/);
    if (hostMatch && cwdMatch)
        addRemoteProject(output, hostMatch[1], cwdMatch[1]);
}
function collectRemoteThreads(value, output) {
    if (typeof value === "string") {
        collectRemoteProjectFromText(value, output);
        return;
    }
    if (!value || typeof value !== "object")
        return;
    if (Array.isArray(value)) {
        for (const item of value)
            collectRemoteThreads(item, output);
        return;
    }
    const record = value;
    const hostId = typeof record.hostId === "string" ? record.hostId.trim() : "";
    const cwd = typeof record.cwd === "string"
        ? record.cwd.trim()
        : record.projectKind === "remote" && typeof record.path === "string"
            ? record.path.trim()
            : "";
    addRemoteProject(output, hostId, cwd, typeof record.projectId === "string" ? record.projectId : undefined);
    if (hostId.startsWith("remote-ssh-codex-managed:") && cwd.startsWith("/")) {
        const key = `${hostId}\n${cwd}`;
        const project = output.get(key);
        if (project) {
            output.set(key, {
                ...project,
                label: typeof record.label === "string" && record.label.trim() ? record.label.trim() : project.label,
                hostDisplayName: typeof record.hostDisplayName === "string" && record.hostDisplayName.trim()
                    ? record.hostDisplayName.trim()
                    : project.hostDisplayName,
                isGitRepository: typeof record.isGitRepository === "boolean" ? record.isGitRepository : project.isGitRepository,
            });
        }
    }
    for (const child of Object.values(record))
        collectRemoteThreads(child, output);
}
function logFiles(logRoot, fileSystem) {
    if (!fileSystem.existsSync(logRoot))
        return [];
    const result = [];
    const walk = (directory) => {
        let entries = [];
        try {
            entries = fileSystem.readdirSync(directory, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory())
                walk(entryPath);
            else if (entry.name.endsWith(".log"))
                result.push(entryPath);
        }
    };
    walk(logRoot);
    return result.sort().slice(-40);
}
export function discoverCodexDesktopProjects(options = {}) {
    const env = options.env ?? process.env;
    const fileSystem = options.fs ?? fs;
    const projects = new Map();
    for (const filePath of logFiles(defaultLogRoot(env), fileSystem)) {
        let text = "";
        try {
            text = fileSystem.readFileSync(filePath, "utf8");
        }
        catch {
            continue;
        }
        for (const line of text.split(/\r?\n/)) {
            if (!line.includes("hostId") || !line.includes("remote-ssh-codex-managed:"))
                continue;
            const responseStart = line.indexOf("response=");
            const candidate = responseStart >= 0 ? line.slice(responseStart + "response=".length) : line;
            try {
                collectRemoteThreads(JSON.parse(candidate), projects);
            }
            catch {
                collectRemoteProjectFromText(candidate, projects);
            }
        }
    }
    return [...projects.values()].sort((left, right) => `${left.label}:${left.hostDisplayName}`.localeCompare(`${right.label}:${right.hostDisplayName}`));
}
