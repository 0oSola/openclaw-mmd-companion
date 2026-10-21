import type { PetAppServerSessionScanner, PetAppServerSessionSummary } from "./agentSessionDiscovery.js";

type PetAppServerSessionApiOptions = {
  apiBaseUrl: string;
  userId: string;
  fetcher?: typeof fetch;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(value: unknown): string | null {
  const resolved = text(value);
  return resolved || null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mapSession(value: unknown): PetAppServerSessionSummary | null {
  const item = asRecord(value);
  const id = text(item.id);
  const workspacePath = text(item.workspace_path);
  const createdAt = text(item.created_at);
  const lastActiveAt = text(item.last_active_at);
  if (!id || !workspacePath || !createdAt || !lastActiveAt) return null;
  const metadata = asRecord(item.metadata);
  return {
    id,
    workspaceId: text(item.workspace_id),
    workspacePath,
    status: text(item.status) || "idle",
    createdAt,
    lastActiveAt,
    processId: nullableNumber(item.process_id),
    codexVersion: nullableText(item.codex_version),
    transport: text(item.transport) || "stdio",
    sandbox: text(item.sandbox) || "read-only",
    mode: nullableText(metadata.mode),
    lastOutputPreview: nullableText(item.last_output_preview),
    error: nullableText(item.error),
    metadata,
  };
}

export function createPetAppServerSessionScanner(
  options: PetAppServerSessionApiOptions,
): PetAppServerSessionScanner {
  const apiBaseUrl = options.apiBaseUrl.replace(/\/+$/, "");
  const userId = options.userId.trim();
  const fetcher = options.fetcher ?? fetch;
  return async (limit) => {
    const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 50));
    const response = await fetcher(
      `${apiBaseUrl}/codex/interactive/sessions?limit=${boundedLimit}`,
      { headers: { "x-user-id": userId } },
    );
    if (!response.ok) throw new Error(`app-server sessions failed: ${response.status}`);
    const payload = asRecord(await response.json());
    const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
    return sessions
      .map(mapSession)
      .filter((session): session is PetAppServerSessionSummary => Boolean(session))
      .slice(0, boundedLimit);
  };
}
