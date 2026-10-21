import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { VSCODE_USER_DATA_ROOT_DIR, VSCODE_WORKSPACE_ROOT_DIR } from "./codexLauncher.js";

type SessionWindowDirEntry = {
  name: string;
  isDirectory: () => boolean;
};
type SessionWindowFs = {
  existsSync: (p: string) => boolean;
  mkdirSync: (p: string, options: { recursive: true }) => unknown;
  readFileSync: (p: string, encoding: "utf8") => string;
  readdirSync: (p: string, options: { withFileTypes: true }) => SessionWindowDirEntry[];
  statSync: (p: string) => { mtimeMs: number };
  writeFileSync: (p: string, data: string, encoding: "utf8") => void;
};

export type VscodeSessionWindowMarker = {
  version: 1 | 2;
  workspacePath: string;
  userDataDir?: string;
  workspaceFilePath?: string;
  agent: string;
  petSessionId?: string;
  codexSessionId?: string;
  updatedAt: string;
};
export type VscodeSessionWindowResolution = {
  userDataDir?: string;
  workspaceFilePath?: string;
  source: "marker" | "workspace-storage";
};

export const VSCODE_SESSION_WINDOW_MARKER_PATH = path.join(".codex-pet", "session-window.json");

function compactText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeFsPath(value: string): string {
  return path.resolve(value).toLowerCase();
}

function legacyMarkerPath(userDataDir: string): string {
  return path.join(userDataDir, VSCODE_SESSION_WINDOW_MARKER_PATH);
}

function workspaceMarkerPath(workspaceFilePath: string): string {
  return path.join(path.dirname(workspaceFilePath), VSCODE_SESSION_WINDOW_MARKER_PATH);
}

function safeTimestamp(value: unknown): number {
  const timestamp = Date.parse(compactText(value));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function decodeWorkspaceFolder(value: unknown): string {
  const text = compactText(value);
  if (!text) return "";
  if (text.startsWith("file:")) {
    try {
      const decoded = fileURLToPath(text);
      return /^\/[A-Za-z]:[\\/]/.test(decoded) ? path.win32.normalize(decoded.slice(1)) : decoded;
    } catch {
      return "";
    }
  }
  return text;
}

function sortByNewest<T extends { updatedAtMs: number }>(items: T[]): T[] {
  return [...items].sort((left, right) => right.updatedAtMs - left.updatedAtMs);
}

function parseMarker(value: string): VscodeSessionWindowMarker | null {
  try {
    const marker = JSON.parse(value) as Partial<VscodeSessionWindowMarker>;
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
  } catch {
    return null;
  }
}

function listUserDataDirs(rootDir: string, fs: SessionWindowFs): string[] {
  if (!fs.existsSync(rootDir)) return [];
  try {
    return fs
      .readdirSync(rootDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(rootDir, entry.name));
  } catch {
    return [];
  }
}

export function vscodeSessionWindowRoot(tmpDir = os.tmpdir()): string {
  return path.join(tmpDir, VSCODE_USER_DATA_ROOT_DIR);
}

export function vscodeWorkspaceWindowRoot(tmpDir = os.tmpdir()): string {
  return path.join(tmpDir, VSCODE_WORKSPACE_ROOT_DIR);
}

export function writeVscodeSessionWindowMarker(options: {
  userDataDir?: string;
  workspaceFilePath?: string;
  workspacePath: string;
  agent: string;
  petSessionId?: string | null;
  codexSessionId?: string | null;
  updatedAt?: string;
  fs?: SessionWindowFs;
}): VscodeSessionWindowMarker | null {
  const fs = options.fs ?? (nodeFs as unknown as SessionWindowFs);
  const userDataDir = compactText(options.userDataDir);
  const workspaceFilePath = compactText(options.workspaceFilePath);
  const workspacePath = compactText(options.workspacePath);
  if ((!userDataDir && !workspaceFilePath) || !workspacePath) return null;
  const marker: VscodeSessionWindowMarker = {
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

function readSessionMarkers(rootDir: string, fs: SessionWindowFs): Array<VscodeSessionWindowMarker & { updatedAtMs: number }> {
  const markers: Array<VscodeSessionWindowMarker & { updatedAtMs: number }> = [];
  for (const userDataDir of listUserDataDirs(rootDir, fs)) {
    const destination = legacyMarkerPath(userDataDir);
    if (!fs.existsSync(destination)) continue;
    try {
      const marker = parseMarker(fs.readFileSync(destination, "utf8"));
      if (marker) markers.push({ ...marker, updatedAtMs: safeTimestamp(marker.updatedAt) });
    } catch {
      // Locked or partially-written marker: ignore and continue scanning.
    }
  }
  return sortByNewest(markers);
}

function readWorkspaceSessionMarkers(
  rootDir: string,
  fs: SessionWindowFs,
): Array<VscodeSessionWindowMarker & { updatedAtMs: number }> {
  const markers: Array<VscodeSessionWindowMarker & { updatedAtMs: number }> = [];
  for (const launchDir of listUserDataDirs(rootDir, fs)) {
    const destination = path.join(launchDir, VSCODE_SESSION_WINDOW_MARKER_PATH);
    if (!fs.existsSync(destination)) continue;
    try {
      const marker = parseMarker(fs.readFileSync(destination, "utf8"));
      if (marker) markers.push({ ...marker, updatedAtMs: safeTimestamp(marker.updatedAt) });
    } catch {
      // Locked or partially-written marker: ignore and continue scanning.
    }
  }
  return sortByNewest(markers);
}

function readWorkspaceFallbacks(
  rootDir: string,
  workspacePath: string,
  fs: SessionWindowFs,
): Array<{ userDataDir: string; workspaceFilePath?: string; updatedAtMs: number }> {
  const expectedWorkspacePath = normalizeFsPath(workspacePath);
  const matches: Array<{ userDataDir: string; workspaceFilePath?: string; updatedAtMs: number }> = [];
  for (const userDataDir of listUserDataDirs(rootDir, fs)) {
    const workspaceStorageDir = path.join(userDataDir, "User", "workspaceStorage");
    if (!fs.existsSync(workspaceStorageDir)) continue;
    let entries: SessionWindowDirEntry[];
    try {
      entries = fs.readdirSync(workspaceStorageDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const workspaceJsonPath = path.join(workspaceStorageDir, entry.name, "workspace.json");
      if (!fs.existsSync(workspaceJsonPath)) continue;
      try {
        const payload = JSON.parse(fs.readFileSync(workspaceJsonPath, "utf8")) as { folder?: unknown; workspace?: unknown };
        const folderPath = decodeWorkspaceFolder(payload.folder);
        const workspaceFilePath = decodeWorkspaceFolder(payload.workspace);
        let resolvedWorkspacePath = folderPath;
        if (!resolvedWorkspacePath && workspaceFilePath && fs.existsSync(workspaceFilePath)) {
          const workspacePayload = JSON.parse(fs.readFileSync(workspaceFilePath, "utf8")) as {
            folders?: Array<{ path?: unknown }>;
          };
          const configuredPath = compactText(workspacePayload.folders?.[0]?.path);
          if (configuredPath) {
            resolvedWorkspacePath = path.isAbsolute(configuredPath)
              ? configuredPath
              : path.resolve(path.dirname(workspaceFilePath), configuredPath);
          }
        }
        if (!resolvedWorkspacePath || normalizeFsPath(resolvedWorkspacePath) !== expectedWorkspacePath) continue;
        const stat = fs.statSync(userDataDir);
        matches.push({ userDataDir, workspaceFilePath: workspaceFilePath || undefined, updatedAtMs: stat.mtimeMs });
      } catch {
        // Ignore unreadable workspace records from stale or locked VSCode dirs.
      }
    }
  }
  return sortByNewest(matches);
}

export function resolveVscodeSessionWindow(options: {
  workspacePath: string;
  petSessionId?: string | null;
  codexSessionId?: string | null;
  agent?: string;
  rootDir?: string;
  workspaceRootDir?: string;
  fs?: SessionWindowFs;
}): VscodeSessionWindowResolution | undefined {
  const fs = options.fs ?? (nodeFs as unknown as SessionWindowFs);
  const rootDir = options.rootDir ?? vscodeSessionWindowRoot();
  const workspaceRootDir = options.workspaceRootDir ?? vscodeWorkspaceWindowRoot();
  const workspacePath = compactText(options.workspacePath);
  if (!workspacePath) return undefined;
  const expectedWorkspacePath = normalizeFsPath(workspacePath);
  const petSessionId = compactText(options.petSessionId);
  const codexSessionId = compactText(options.codexSessionId);
  const agent = compactText(options.agent);

  const markers = sortByNewest([
    ...readSessionMarkers(rootDir, fs),
    ...readWorkspaceSessionMarkers(workspaceRootDir, fs),
  ]);
  for (const marker of markers) {
    if (normalizeFsPath(marker.workspacePath) !== expectedWorkspacePath) continue;
    if (agent && marker.agent !== agent) continue;
    const resolution: VscodeSessionWindowResolution = { source: "marker" };
    if (marker.userDataDir) resolution.userDataDir = marker.userDataDir;
    if (marker.workspaceFilePath) resolution.workspaceFilePath = marker.workspaceFilePath;
    if (petSessionId && marker.petSessionId === petSessionId) return resolution;
    if (codexSessionId && marker.codexSessionId === codexSessionId) return resolution;
  }

  const fallback = readWorkspaceFallbacks(rootDir, workspacePath, fs)[0];
  if (!fallback) return undefined;
  const resolution: VscodeSessionWindowResolution = {
    userDataDir: fallback.userDataDir,
    source: "workspace-storage",
  };
  if (fallback.workspaceFilePath) resolution.workspaceFilePath = fallback.workspaceFilePath;
  return resolution;
}

export function resolveVscodeSessionWindowUserDataDir(
  options: Parameters<typeof resolveVscodeSessionWindow>[0],
): string | undefined {
  return resolveVscodeSessionWindow(options)?.userDataDir;
}
