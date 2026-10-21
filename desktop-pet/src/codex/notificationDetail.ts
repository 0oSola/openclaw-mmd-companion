import type { CodexStatus, CodexLaunchState } from "./codexStatus";
import { resolveCodexTaskTitle, workspaceLabelFromPath } from "../../electron/codexPresentation";

export type NotificationDetailLevel = "low" | "medium" | "high";

const LOW_LABELS: Record<CodexLaunchState, string | null> = {
  idle: null,
  starting: "{agent} starting",
  launched: "{agent} terminal running",
  resuming: "{agent} resuming",
  running: "{agent} running",
  command_running: "{agent} running command",
  file_changed: "{agent} changed files",
  waiting_approval: "{agent} needs approval",
  completed: "{agent} completed",
  failed: "{agent} failed",
  disconnected: "{agent} disconnected",
  "vscode-opened": "VSCode workspace open",
};

const DEFAULT_AGENT_LABEL = "Codex";

function compact(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function mediumContext(status: CodexStatus): string {
  if (status.state === "failed" && compact(status.error)) return compact(status.error);
  return resolveCodexTaskTitle([status.sessionTitle], status.workspacePath);
}

export function normalizeNotificationDetailLevel(value: unknown): NotificationDetailLevel {
  return value === "low" || value === "medium" || value === "high" ? value : "medium";
}

export function formatCodexStatusNotification(
  status: CodexStatus | null | undefined,
  detailLevel: NotificationDetailLevel,
  agentLabel: string = DEFAULT_AGENT_LABEL,
): string | null {
  if (!status) return null;
  const labelTemplate = LOW_LABELS[status.state];
  if (!labelTemplate) return null;
  const label = labelTemplate.replace("{agent}", agentLabel);

  const level = normalizeNotificationDetailLevel(detailLevel);
  if (level === "low") return label;

  const pieces = [label, mediumContext(status)];
  if (level === "high") {
    if (compact(status.workspacePath)) pieces.push(`workspace ${compact(status.workspacePath)}`);
    if (compact(status.codexSessionId)) pieces.push(`session ${compact(status.codexSessionId)}`);
    if (compact(status.updatedAt)) pieces.push(`updated ${compact(status.updatedAt)}`);
  }

  return pieces.filter(Boolean).join(" · ");
}
