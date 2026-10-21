import { discoverSshWorkspaces, isSshWorkspaceUri } from "./remoteWorkspace.js";
import { discoverCodexDesktopProjects } from "./codexDesktopProjects.js";
export async function fetchCodexRemoteWorkspaces(options) {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const response = await fetchImpl(`${options.apiBaseUrl.replace(/\/+$/, "")}/codex/workspaces`, {
        headers: { "x-user-id": options.userId },
    });
    if (!response.ok)
        throw new Error(`Codex workspace list returned ${response.status}`);
    const payload = (await response.json());
    const apiWorkspaces = Array.isArray(payload.workspaces)
        ? payload.workspaces.flatMap((item) => {
            if (!item || typeof item !== "object")
                return [];
            const candidate = item;
            const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
            const workspacePath = typeof candidate.path === "string" ? candidate.path.trim() : "";
            if (!id || !workspacePath)
                return [];
            return [{
                    id,
                    path: workspacePath,
                    source: typeof candidate.source === "string" && candidate.source.trim() ? candidate.source.trim() : "remote",
                    kind: isSshWorkspaceUri(workspacePath) ? "ssh" : "local",
                }];
        })
        : [];
    const sshWorkspaces = (options.discoverLegacySshWorkspaces ?? discoverSshWorkspaces)();
    const desktopProjects = (options.discoverDesktopProjects ?? discoverCodexDesktopProjects)();
    const normalizedApi = apiWorkspaces;
    const seen = new Set(normalizedApi.map((workspace) => workspace.path));
    return [
        ...normalizedApi,
        ...sshWorkspaces.filter((workspace) => !seen.has(workspace.path)),
        ...desktopProjects
            .filter((project) => project.path && !seen.has(project.path))
            .map((project) => ({
            id: project.projectId,
            path: project.path,
            source: "codex-desktop-ssh",
            kind: "ssh",
            remoteAuthority: project.hostDisplayName,
            label: `${project.label} · ${project.hostDisplayName ?? project.hostId ?? "SSH"}`,
            projectId: project.projectId,
            projectKind: project.projectKind,
            hostId: project.hostId,
            hostDisplayName: project.hostDisplayName,
            isGitRepository: project.isGitRepository,
        })),
    ];
}
