import { execFile as nodeExecFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import type { CodexDesktopProject } from "./codexDesktopProjects.js";

const execFileAsync = promisify(nodeExecFile);

export const DEFAULT_REMOTE_HOST_PROFILE: RemoteHostProfile = {
  id: "mac-codex-pet",
  displayName: "macCodex（受限）",
  desktopHostId: "remote-ssh-codex-managed:macCodex",
  sshHost: "macCodex-pet",
  scanRoots: ["/Users/sola/workspace", "/Users/sola/Desktop/kscc"],
  maxDepth: 4,
  enabled: true,
};

export type RemoteHostProfile = {
  id: string;
  displayName: string;
  desktopHostId: string;
  sshHost: string;
  scanRoots: string[];
  maxDepth: number;
  enabled: boolean;
};

export type RemoteProjectAvailability = "desktop_registered" | "ssh_discovered" | "cached_offline";

export type RemoteProjectTarget = {
  projectKey: string;
  label: string;
  remotePath: string;
  hostProfileId: string;
  hostDisplayName: string;
  desktopHostId?: string;
  desktopProjectId?: string;
  sshHost: string;
  isGitRepository: boolean;
  availability: RemoteProjectAvailability;
  sources: Array<"codex-desktop-registry" | "system-ssh-scan" | "cache">;
  lastVerifiedAt?: string;
};

export type RemoteProjectCatalogSnapshot = {
  schemaVersion: 1;
  hostProfile: RemoteHostProfile;
  projects: RemoteProjectTarget[];
  refreshedAt?: string;
  fromCache: boolean;
  error?: string;
};

type ExecFile = (file: string, args: string[], options: {
  timeout: number;
  maxBuffer: number;
  windowsHide: boolean;
}) => Promise<{ stdout: string; stderr: string }>;

type CatalogFs = Pick<typeof fs, "existsSync" | "mkdirSync" | "readFileSync" | "writeFileSync" | "renameSync" | "rmSync">;

function normalizeRemotePath(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/").replace(/\/+$/, "");
  if (!normalized.startsWith("/") || normalized.includes("\0")) throw new Error("Remote path must be an absolute POSIX path");
  return normalized || "/";
}

function normalizeProfile(profile: RemoteHostProfile): RemoteHostProfile {
  const sshHost = profile.sshHost.trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(sshHost)) throw new Error("SSH Host contains unsupported characters");
  const maxDepth = Math.max(1, Math.min(8, Math.round(profile.maxDepth)));
  const scanRoots = Array.from(new Set(profile.scanRoots.map(normalizeRemotePath)));
  if (scanRoots.some((root) => root === "/" || root === "/Users" || /^\/Users\/[^/]+$/.test(root))) {
    throw new Error("Remote scan root is too broad");
  }
  return { ...profile, sshHost, maxDepth, scanRoots };
}

function projectKey(profileId: string, remotePath: string): string {
  return `${profileId}:${remotePath}`;
}

function projectLabel(remotePath: string): string {
  return remotePath.split("/").filter(Boolean).at(-1) || remotePath;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function buildRemoteGitScanCommand(profile: RemoteHostProfile): string {
  const normalized = normalizeProfile(profile);
  const roots = normalized.scanRoots.map(shellQuote).join(" ");
  return `find ${roots} -mindepth 1 -maxdepth ${normalized.maxDepth} -name .git -prune -print 2>/dev/null`;
}

export function parseRemoteGitScanOutput(stdout: string, profile: RemoteHostProfile): RemoteProjectTarget[] {
  const normalized = normalizeProfile(profile);
  const verifiedAt = new Date().toISOString();
  const seen = new Set<string>();
  const projects: RemoteProjectTarget[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    const remotePath = normalizeRemotePath(raw.replace(/\/.git$/, ""));
    if (seen.has(remotePath)) continue;
    if (!normalized.scanRoots.some((root) => remotePath === root || remotePath.startsWith(`${root}/`))) continue;
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
    if (projects.length >= 500) throw new Error("Remote project scan exceeded 500 repositories");
  }
  return projects.sort((left, right) => `${left.label}:${left.remotePath}`.localeCompare(`${right.label}:${right.remotePath}`));
}

export function mergeRemoteProjects(options: {
  profile: RemoteHostProfile;
  desktopProjects: CodexDesktopProject[];
  sshProjects: RemoteProjectTarget[];
}): RemoteProjectTarget[] {
  const profile = normalizeProfile(options.profile);
  const byPath = new Map<string, RemoteProjectTarget>();
  for (const project of options.sshProjects) byPath.set(normalizeRemotePath(project.remotePath), project);
  for (const project of options.desktopProjects) {
    if (project.projectKind !== "remote" || project.hostId !== profile.desktopHostId || !project.path) continue;
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

function cachePath(userDataPath: string): string {
  return path.join(userDataPath, "remote-project-catalog.v1.json");
}

export function readRemoteProjectCatalogCache(options: { userDataPath: string; fs?: CatalogFs }): RemoteProjectCatalogSnapshot | undefined {
  const fileSystem = options.fs ?? fs;
  const filePath = cachePath(options.userDataPath);
  if (!fileSystem.existsSync(filePath)) return undefined;
  try {
    const payload = JSON.parse(fileSystem.readFileSync(filePath, "utf8")) as RemoteProjectCatalogSnapshot;
    if (payload.schemaVersion !== 1 || !Array.isArray(payload.projects)) return undefined;
    return payload;
  } catch {
    return undefined;
  }
}

export function writeRemoteProjectCatalogCache(options: {
  userDataPath: string;
  snapshot: RemoteProjectCatalogSnapshot;
  fs?: CatalogFs;
}) {
  const fileSystem = options.fs ?? fs;
  fileSystem.mkdirSync(options.userDataPath, { recursive: true });
  const target = cachePath(options.userDataPath);
  const temporary = `${target}.tmp`;
  fileSystem.writeFileSync(temporary, `${JSON.stringify(options.snapshot, null, 2)}\n`, "utf8");
  if (fileSystem.existsSync(target)) fileSystem.rmSync(target);
  fileSystem.renameSync(temporary, target);
}

export function loadRemoteProjectCatalog(options: {
  userDataPath: string;
  desktopProjects: CodexDesktopProject[];
  profile?: RemoteHostProfile;
  fs?: CatalogFs;
}): RemoteProjectCatalogSnapshot {
  const profile = normalizeProfile(options.profile ?? DEFAULT_REMOTE_HOST_PROFILE);
  const cached = readRemoteProjectCatalogCache({ userDataPath: options.userDataPath, fs: options.fs });
  const cachedProjects = cached?.projects.filter((project) => project.hostProfileId === profile.id).map((project) => ({
    ...project,
    availability: project.availability === "desktop_registered" ? "desktop_registered" as const : "cached_offline" as const,
    sources: Array.from(new Set([...project.sources, "cache" as const])),
  })) ?? [];
  return {
    schemaVersion: 1,
    hostProfile: profile,
    projects: mergeRemoteProjects({ profile, desktopProjects: options.desktopProjects, sshProjects: cachedProjects }),
    refreshedAt: cached?.refreshedAt,
    fromCache: Boolean(cached),
  };
}

export async function scanRemoteGitProjects(options: {
  profile?: RemoteHostProfile;
  execFile?: ExecFile;
} = {}): Promise<RemoteProjectTarget[]> {
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

export async function refreshRemoteProjectCatalog(options: {
  userDataPath: string;
  desktopProjects: CodexDesktopProject[];
  profile?: RemoteHostProfile;
  execFile?: ExecFile;
  fs?: CatalogFs;
}): Promise<RemoteProjectCatalogSnapshot> {
  const profile = normalizeProfile(options.profile ?? DEFAULT_REMOTE_HOST_PROFILE);
  try {
    const sshProjects = profile.enabled ? await scanRemoteGitProjects({ profile, execFile: options.execFile }) : [];
    const snapshot: RemoteProjectCatalogSnapshot = {
      schemaVersion: 1,
      hostProfile: profile,
      projects: mergeRemoteProjects({ profile, desktopProjects: options.desktopProjects, sshProjects }),
      refreshedAt: new Date().toISOString(),
      fromCache: false,
    };
    writeRemoteProjectCatalogCache({ userDataPath: options.userDataPath, snapshot, fs: options.fs });
    return snapshot;
  } catch (error) {
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
