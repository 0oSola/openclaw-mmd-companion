import {
  isInjectedCodexContext,
  resolveCodexTaskTitle,
} from "../../electron/codexPresentation";

export type DesktopPetSession = {
  pet_session_id?: string;
  codex_session_id?: string;
  agent?: string | null;
  runtime?: string | null;
  display_title?: string | null;
  first_prompt_preview?: string | null;
  last_summary?: string | null;
  workspace_path?: string | null;
  last_status?: string | null;
  last_seen_at?: string | null;
  updated_at?: string | null;
};

export type SessionPickerItem = {
  petSessionId: string;
  codexSessionId: string;
  title: string;
  subtitle: string;
  workspace: string;
  status: string;
  time: string;
  promptPreview: string;
  summaryPreview: string;
  searchText: string;
  isActive: boolean;
};

const STATUS_LABELS: Record<string, string> = {
  no_session: "no session",
  idle: "idle",
  starting: "starting",
  running: "running",
  command_running: "running command",
  file_changed: "changed files",
  waiting_approval: "waiting approval",
  completed: "completed",
  failed: "failed",
  disconnected: "disconnected",
};

const ACTIVE_SESSION_STATUSES = new Set(["starting", "running", "command_running", "file_changed", "waiting_approval"]);

function compactText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function redactSensitiveText(value: string): string {
  return value
    .replace(
      /\b((?:[\w.-]*?(?:token|password|passwd|pwd|secret|api[_-]?key|access[_-]?key|private[_-]?key)[\w.-]*?)\s*[:=]\s*)(["']?)[^\s"',;]+/gi,
      "$1[redacted]",
    )
    .replace(/\b(?:sk|ghp|github_pat|xox[abprs])[-_][A-Za-z0-9._-]{8,}\b/g, "[redacted]");
}

function truncatePreview(value: string, maxLength = 100): string {
  if (value.length <= maxLength) return value;
  const clipped = value.slice(0, maxLength - 3);
  const lastSpace = clipped.lastIndexOf(" ");
  const boundary = lastSpace >= Math.floor(maxLength * 0.62) ? lastSpace : clipped.length;
  return `${clipped.slice(0, boundary).trimEnd()}...`;
}

function safeDetailText(value: unknown): string {
  const text = compactText(value);
  return text && !isInjectedCodexContext(text) ? redactSensitiveText(text) : "";
}

function previewText(value: string, fallback: string): string {
  return truncatePreview(value || fallback);
}

function workspaceLabel(workspacePath: string | null | undefined): string {
  const parts = compactText(workspacePath).split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || "workspace";
}

function statusLabel(status: string | null | undefined): string {
  const key = compactText(status);
  return STATUS_LABELS[key] || key || "unknown";
}

function isActiveSessionStatus(status: string | null | undefined): boolean {
  return ACTIVE_SESSION_STATUSES.has(compactText(status));
}

function runtimeLabel(session: DesktopPetSession): string {
  if (compactText(session.agent) === "claude") return "Claude Code";
  const runtime = compactText(session.runtime);
  if (runtime === "desktop") return "Codex Desktop";
  if (runtime === "cli") return "Codex CLI";
  if (runtime === "wsl") return "WSL Codex CLI";
  if (runtime === "app-server") return "Pet app-server";
  if (runtime === "remote") return "Remote Agent";
  return "";
}

function sessionTitle(session: DesktopPetSession): string {
  return resolveCodexTaskTitle(
    [session.display_title, session.first_prompt_preview],
    session.workspace_path,
    80,
  );
}

function seenLabel(session: DesktopPetSession, now: Date): string {
  const seen = new Date(compactText(session.last_seen_at) || compactText(session.updated_at) || now);
  if (Number.isNaN(seen.getTime())) return "unknown time";
  const sameDay = seen.toDateString() === now.toDateString();
  return sameDay
    ? seen.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : seen.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function buildSessionPickerItems(sessions: DesktopPetSession[], now = new Date()): SessionPickerItem[] {
  return sessions
    .map((session) => {
      const petSessionId = compactText(session.pet_session_id);
      const codexSessionId = compactText(session.codex_session_id);
      if (!petSessionId || !codexSessionId) return null;
      const title = sessionTitle(session);
      const workspace = workspaceLabel(session.workspace_path);
      const status = statusLabel(session.last_status);
      const time = seenLabel(session, now);
      const promptText = safeDetailText(session.first_prompt_preview);
      const summaryText = safeDetailText(session.last_summary);
      const promptPreview = previewText(promptText, "No prompt preview");
      const summaryPreview = previewText(summaryText, "No summary yet");
      const subtitle = [runtimeLabel(session), workspace, status, time].filter(Boolean).join(" · ");
      const isActive = isActiveSessionStatus(session.last_status);
      const searchText = [
        title,
        runtimeLabel(session),
        workspace,
        status,
        time,
        promptText,
        summaryText,
      ]
        .join(" ")
        .toLowerCase();
      return {
        petSessionId,
        codexSessionId,
        title,
        subtitle,
        workspace,
        status,
        time,
        promptPreview,
        summaryPreview,
        searchText,
        isActive,
      };
    })
    .filter((item): item is SessionPickerItem => Boolean(item));
}

export function filterSessionPickerItems(items: SessionPickerItem[], query: string): SessionPickerItem[] {
  const terms = compactText(query)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length === 0) return items;
  return items.filter((item) => terms.every((term) => item.searchText.includes(term)));
}
