import { discoverSshWorkspaces, isSshWorkspaceUri } from "./remoteWorkspace.js";
import { discoverCodexDesktopProjects, type CodexDesktopProject } from "./codexDesktopProjects.js";

export type CodexRemoteWorkspace = {
  id: string;
  path: string;
  source: string;
  kind: "local" | "ssh";
  remoteAuthority?: string;
  label?: string;
  projectId?: string;
  projectKind?: "local" | "remote" | "chatgpt";
  hostId?: string;
  hostDisplayName?: string;
  sshHost?: string;
  isGitRepository?: boolean;
  availability?: "desktop_registered" | "ssh_discovered" | "cached_offline";
};

type WorkspaceResponse = { workspaces?: unknown };

export async function fetchCodexRemoteWorkspaces(options: {
  apiBaseUrl: string;
  userId: string;
  fetch?: typeof globalThis.fetch;
  discoverDesktopProjects?: typeof discoverCodexDesktopProjects;
  discoverLegacySshWorkspaces?: typeof discoverSshWorkspaces;
}): Promise<CodexRemoteWorkspace[]> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const response = await fetchImpl(`${options.apiBaseUrl.replace(/\/+$/, "")}/codex/workspaces`, {
    headers: { "x-user-id": options.userId },
  });
  if (!response.ok) throw new Error(`Codex workspace list returned ${response.status}`);
  const payload = (await response.json()) as WorkspaceResponse;
  const apiWorkspaces = Array.isArray(payload.workspaces)
    ? payload.workspaces.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const workspacePath = typeof candidate.path === "string" ? candidate.path.trim() : "";
    if (!id || !workspacePath) return [];
    return [{
      id,
      path: workspacePath,
      source: typeof candidate.source === "string" && candidate.source.trim() ? candidate.source.trim() : "remote",
      kind: isSshWorkspaceUri(workspacePath) ? "ssh" as const : "local" as const,
    }];
      })
    : [];
  const sshWorkspaces = (options.discoverLegacySshWorkspaces ?? discoverSshWorkspaces)();
  const desktopProjects = (options.discoverDesktopProjects ?? discoverCodexDesktopProjects)();
  const normalizedApi = apiWorkspaces as CodexRemoteWorkspace[];
  const seen = new Set(normalizedApi.map((workspace) => workspace.path));
  return [
    ...normalizedApi,
    ...sshWorkspaces.filter((workspace) => !seen.has(workspace.path)),
    ...desktopProjects
      .filter((project) => project.path && !seen.has(project.path))
      .map((project: CodexDesktopProject) => ({
        id: project.projectId,
        path: project.path!,
        source: "codex-desktop-ssh",
        kind: "ssh" as const,
        remoteAuthority: project.hostDisplayName,
        label: `${project.label} · ${project.hostDisplayName ?? project.hostId ?? "SSH"}`,
        projectId: project.projectId,
        projectKind: project.projectKind,
        hostId: project.hostId,
        hostDisplayName: project.hostDisplayName,
        isGitRepository: project.isGitRepository,
      })),
  ] as CodexRemoteWorkspace[];
}

