import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type WorkspaceKind = "local" | "ssh";

export type PetWorkspace = {
  id: string;
  path: string;
  source: string;
  kind: WorkspaceKind;
  remoteAuthority?: string;
  label?: string;
};

export function isSshWorkspaceUri(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().toLowerCase().startsWith("vscode-remote://ssh-remote+");
}

export function workspaceKind(value: string | null | undefined): WorkspaceKind {
  return isSshWorkspaceUri(value) ? "ssh" : "local";
}

export function remoteAuthorityFromUri(value: string): string | undefined {
  if (!isSshWorkspaceUri(value)) return undefined;
  try {
    const url = new URL(value);
    return decodeURIComponent(url.host.replace(/^ssh-remote\+/i, ""));
  } catch {
    return undefined;
  }
}

export function remoteWorkspaceLabel(value: string): string {
  if (!isSshWorkspaceUri(value)) return path.basename(value.replaceAll("\\", "/")) || value;
  try {
    const url = new URL(value);
    const remote = remoteAuthorityFromUri(value) || "SSH";
    const remotePath = decodeURIComponent(url.pathname || "/").replace(/^\/+/, "");
    return `${remote}:${remotePath.split("/").filter(Boolean).at(-1) || "/"}`;
  } catch {
    return value;
  }
}

export function workspaceDisplayLabel(value: string): string {
  return remoteWorkspaceLabel(value);
}

type WorkspaceStorageFs = Pick<typeof nodeFs, "existsSync" | "readdirSync" | "readFileSync" | "statSync">;

function vscodeUserDataRoots(env: NodeJS.ProcessEnv): string[] {
  const roots = [
    env.MMD_PET_VSCODE_USER_DATA_DIR,
    path.join(env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Code"),
    path.join(env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Code - Insiders"),
  ];
  return Array.from(new Set(roots.filter((value): value is string => Boolean(value && value.trim()))));
}

function workspaceUriFromRecord(payload: Record<string, unknown>, workspaceFilePath: string): string | undefined {
  const value = typeof payload.folder === "string" ? payload.folder : typeof payload.workspace === "string" ? payload.workspace : "";
  if (!value) return undefined;
  if (value.startsWith("vscode-remote://")) return value;
  if (value.startsWith("file:")) {
    try {
      const localWorkspaceFile = fileURLToPath(value);
      if (!localWorkspaceFile.toLowerCase().endsWith(".code-workspace")) return undefined;
      const workspacePayload = JSON.parse(nodeFs.readFileSync(localWorkspaceFile, "utf8")) as {
        folders?: Array<{ uri?: string; path?: string }>;
      };
      const folder = workspacePayload.folders?.[0];
      if (folder?.uri?.startsWith("vscode-remote://")) return folder.uri;
      if (folder?.path?.startsWith("vscode-remote://")) return folder.path;
    } catch {
      return undefined;
    }
    return undefined;
  }
  if (path.isAbsolute(value) && value.toLowerCase().endsWith(".code-workspace")) {
    try {
      const workspacePayload = JSON.parse(nodeFs.readFileSync(value, "utf8")) as { folders?: Array<{ uri?: string; path?: string }> };
      const folder = workspacePayload.folders?.[0];
      if (folder?.uri?.startsWith("vscode-remote://")) return folder.uri;
      if (folder?.path?.startsWith("vscode-remote://")) return folder.path;
    } catch {
      return undefined;
    }
  }
  void workspaceFilePath;
  return undefined;
}

export function discoverSshWorkspaces(options: {
  env?: NodeJS.ProcessEnv;
  fs?: WorkspaceStorageFs;
} = {}): PetWorkspace[] {
  const env = options.env ?? process.env;
  const fs = options.fs ?? nodeFs;
  const result: PetWorkspace[] = [];
  const seen = new Set<string>();
  for (const userDataRoot of vscodeUserDataRoots(env)) {
    const storageRoot = path.join(userDataRoot, "User", "workspaceStorage");
    if (!fs.existsSync(storageRoot)) continue;
    let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
    try {
      entries = fs.readdirSync(storageRoot, { withFileTypes: true }) as typeof entries;
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const workspaceFilePath = path.join(storageRoot, entry.name, "workspace.json");
      if (!fs.existsSync(workspaceFilePath)) continue;
      try {
        const payload = JSON.parse(fs.readFileSync(workspaceFilePath, "utf8")) as Record<string, unknown>;
        const uri = workspaceUriFromRecord(payload, workspaceFilePath);
        if (!uri || !isSshWorkspaceUri(uri) || seen.has(uri)) continue;
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
      } catch {
        // Ignore stale or locked VS Code workspace records.
      }
    }
  }
  return result;
}
