import { execFile as nodeExecFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
const execFileAsync = promisify(nodeExecFile);
export const DEFAULT_REMOTE_HOST_PROFILE = {
    id: "mac-codex-pet",
    displayName: "macCodex（受限）",
    desktopHostId: "remote-ssh-codex-managed:macCodex",
    sshHost: "macCodex-pet",
    scanRoots: ["/Users/sola/workspace", "/Users/sola/Desktop/kscc"],
    maxDepth: 4,
    enabled: true,
};
function normalizeRemotePath(value) {
    const normalized = value.trim().replaceAll("\\", "/").replace(/\/+$/, "");
    if (!normalized.startsWith("/") || normalized.includes("\0"))
        throw new Error("Remote path must be an absolute POSIX path");
    return normalized || "/";
}
function normalizeProfile(profile) {
    const sshHost = profile.sshHost.trim();
    if (!/^[a-zA-Z0-9._-]+$/.test(sshHost))
        throw new Error("SSH Host contains unsupported characters");
    const maxDepth = Math.max(1, Math.min(8, Math.round(profile.maxDepth)));
    const scanRoots = Array.from(new Set(profile.scanRoots.map(normalizeRemotePath)));
    if (scanRoots.some((root) => root === "/" || root === "/Users" || /^\/Users\/[^/]+$/.test(root))) {
        throw new Error("Remote scan root is too broad");
    }
    return { ...profile, sshHost, maxDepth, scanRoots };
}
function projectKey(profileId, remotePath) {
    return `${profileId}:${remotePath}`;
}
function projectLabel(remotePath) {
    return remotePath.split("/").filter(Boolean).at(-1) || remotePath;
}
function shellQuote(value) {
    return `'${value.replaceAll("'", `'"'"'`)}'`;
}
export function buildRemoteGitScanCommand(profile) {
    const normalized = normalizeProfile(profile);
    const roots = normalized.scanRoots.map(shellQuote).join(" ");
    return `find ${roots} -mindepth 1 -maxdepth ${normalized.maxDepth} -name .git -prune -print 2>/dev/null`;
}
export function parseRemoteGitScanOutput(stdout, profile) {
    const normalized = normalizeProfile(profile);
    const verifiedAt = new Date().toISOString();
    const seen = new Set();
    const projects = [];
    for (const line of stdout.split(/\r?\n/)) {
        const raw = line.trim();
        if (!raw)
            continue;
        const remotePath = normalizeRemotePath(raw.replace(/\/.git$/, ""));
        if (seen.has(remotePath))
            continue;
        if (!normalized.scanRoots.some((root) => remotePath === root || remotePath.startsWith(`${root}/`)))
            continue;
        seen.add(remotePath);
        projects.push({
            projectKey: projectKey(normalized.id, remotePath),
            label: projectLabel(remotePath),
            remotePath,
            hostProfileId: normalized.id,
            hostDisplayName: normalized.displayName,
            desktopHostId: normalized.desktopHostId,
            sshHost: normalized.sshHost,
            isGitRepository: true,
            availability: "ssh_discovered",
            sources: ["system-ssh-scan"],
            lastVerifiedAt: verifiedAt,
        });
        if (projects.length >= 500)
            throw new Error("Remote project scan exceeded 500 repositories");
    }
    return projects.sort((left, right) => `${left.label}:${left.remotePath}`.localeCompare(`${right.label}:${right.remotePath}`));
}
export function mergeRemoteProjects(options) {
    const profile = normalizeProfile(options.profile);
    const byPath = new Map();
    for (const project of options.sshProjects)
        byPath.set(normalizeRemotePath(project.remotePath), project);
    for (const project of options.desktopProjects) {
        if (project.projectKind !== "remote" || project.hostId !== profile.desktopHostId || !project.path)
            continue;
        const remotePath = normalizeRemotePath(project.path);
        const existing = byPath.get(remotePath);
        byPath.set(remotePath, {
            projectKey: projectKey(profile.id, remotePath),
            label: project.label || existing?.label || projectLabel(remotePath),
            remotePath,
            hostProfileId: profile.id,
            // The Desktop registry may have discovered the same path via the
            // unrestricted `macCodex` connection. Pet must display and launch the
            // constrained profile that actually scanned this catalog.
            hostDisplayName: profile.displayName,
            desktopHostId: project.hostId,
            desktopProjectId: project.projectId,
            sshHost: profile.sshHost,
            isGitRepository: project.isGitRepository ?? existing?.isGitRepository ?? false,
            availability: "desktop_registered",
            sources: existing ? ["codex-desktop-registry", "system-ssh-scan"] : ["codex-desktop-registry"],
            lastVerifiedAt: existing?.lastVerifiedAt,
        });
    }
    return [...byPath.values()].sort((left, right) => {
        const availabilityOrder = Number(right.availability === "desktop_registered") - Number(left.availability === "desktop_registered");
        return availabilityOrder || `${left.label}:${left.remotePath}`.localeCompare(`${right.label}:${right.remotePath}`);
    });
}
function cachePath(userDataPath) {
    return path.join(userDataPath, "remote-project-catalog.v1.json");
}
export function readRemoteProjectCatalogCache(options) {
    const fileSystem = options.fs ?? fs;
    const filePath = cachePath(options.userDataPath);
    if (!fileSystem.existsSync(filePath))
        return undefined;
    try {
        const payload = JSON.parse(fileSystem.readFileSync(filePath, "utf8"));
        if (payload.schemaVersion !== 1 || !Array.isArray(payload.projects))
            return undefined;
        return payload;
    }
    catch {
        return undefined;
    }
}
export function writeRemoteProjectCatalogCache(options) {
    const fileSystem = options.fs ?? fs;
    fileSystem.mkdirSync(options.userDataPath, { recursive: true });
    const target = cachePath(options.userDataPath);
    const temporary = `${target}.tmp`;
    fileSystem.writeFileSync(temporary, `${JSON.stringify(options.snapshot, null, 2)}\n`, "utf8");
    if (fileSystem.existsSync(target))
        fileSystem.rmSync(target);
    fileSystem.renameSync(temporary, target);
}
export function loadRemoteProjectCatalog(options) {
    const profile = normalizeProfile(options.profile ?? DEFAULT_REMOTE_HOST_PROFILE);
    const cached = readRemoteProjectCatalogCache({ userDataPath: options.userDataPath, fs: options.fs });
    const cachedProjects = cached?.projects.filter((project) => project.hostProfileId === profile.id).map((project) => ({
        ...project,
        availability: project.availability === "desktop_registered" ? "desktop_registered" : "cached_offline",
        sources: Array.from(new Set([...project.sources, "cache"])),
    })) ?? [];
    return {
        schemaVersion: 1,
        hostProfile: profile,
        projects: mergeRemoteProjects({ profile, desktopProjects: options.desktopProjects, sshProjects: cachedProjects }),
        refreshedAt: cached?.refreshedAt,
        fromCache: Boolean(cached),
    };
}
export async function scanRemoteGitProjects(options = {}) {
    const profile = normalizeProfile(options.profile ?? DEFAULT_REMOTE_HOST_PROFILE);
    const execFile = options.execFile ?? (async (file, args, execOptions) => execFileAsync(file, args, execOptions));
    const command = buildRemoteGitScanCommand(profile);
    const { stdout } = await execFile("ssh", [
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=5",
        "-o", "StrictHostKeyChecking=yes",
        profile.sshHost,
        command,
    ], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
    return parseRemoteGitScanOutput(stdout, profile);
}
export async function refreshRemoteProjectCatalog(options) {
    const profile = normalizeProfile(options.profile ?? DEFAULT_REMOTE_HOST_PROFILE);
    try {
        const sshProjects = profile.enabled ? await scanRemoteGitProjects({ profile, execFile: options.execFile }) : [];
        const snapshot = {
            schemaVersion: 1,
            hostProfile: profile,
            projects: mergeRemoteProjects({ profile, desktopProjects: options.desktopProjects, sshProjects }),
            refreshedAt: new Date().toISOString(),
            fromCache: false,
        };
        writeRemoteProjectCatalogCache({ userDataPath: options.userDataPath, snapshot, fs: options.fs });
        return snapshot;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const cached = readRemoteProjectCatalogCache({ userDataPath: options.userDataPath, fs: options.fs });
        if (cached) {
            return {
                ...cached,
                projects: cached.projects.map((project) => ({ ...project, availability: "cached_offline", sources: Array.from(new Set([...project.sources, "cache"])) })),
                fromCache: true,
                error: message,
            };
        }
        return {
            schemaVersion: 1,
            hostProfile: profile,
            projects: mergeRemoteProjects({ profile, desktopProjects: options.desktopProjects, sshProjects: [] }),
            fromCache: false,
            error: message,
        };
    }
}
