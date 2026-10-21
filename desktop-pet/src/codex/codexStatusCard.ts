import type { CodexStatus } from "./codexStatus";
import {
  formatCodexStatusNotification,
  type NotificationDetailLevel,
} from "./notificationDetail";
import {
  buildCodexCompletedPresentation,
  formatCodexOutputLines,
} from "../../electron/codexPresentation";

export type CodexStatusCard = {
  title: string;
  outputLines: string[];
  focusable: boolean;
  workspacePath?: string;
  /** The terminal command the user should run in the freshly opened VSCode window. */
  commandLine?: string;
};

function statusCardTitle(status: CodexStatus, detailLevel: NotificationDetailLevel, agentLabel: string): string | null {
  if (status.state === "completed") {
    return buildCodexCompletedPresentation(status, agentLabel).title;
  }
  return formatCodexStatusNotification(status, detailLevel, agentLabel);
}

function buildOutputLines(status: CodexStatus): string[] {
  if (status.state === "completed") {
    const presentation = buildCodexCompletedPresentation(status);
    return [presentation.taskLabel ? `Task: ${presentation.taskLabel}` : null, ...presentation.outputLines]
      .filter((line): line is string => Boolean(line))
      .slice(0, 3);
  }
  const rawOutput = status.lastOutput || (status.state === "failed" ? status.error : "");
  return [...formatCodexOutputLines(rawOutput)]
    .filter((line): line is string => Boolean(line))
    .slice(0, 3);
}

export function buildCodexStatusCard(
  status: CodexStatus | null | undefined,
  detailLevel: NotificationDetailLevel,
  agentLabel = "Codex",
): CodexStatusCard | null {
  if (!status) return null;
  const title = statusCardTitle(status, detailLevel, agentLabel);
  if (!title) return null;
  const workspacePath = status.workspacePath?.trim() || undefined;
  const commandLine = status.commandLine?.trim() || undefined;
  return {
    title,
    outputLines: buildOutputLines(status),
    focusable: Boolean(workspacePath),
    workspacePath,
    commandLine,
  };
}

export function buildIdleCodexStatusCardFallback(options: {
  hasSelectedModel: boolean;
  loading: boolean;
  loadError: string | null | undefined;
  agentLabel?: string;
}): CodexStatusCard | null {
  if (!options.hasSelectedModel || options.loading || options.loadError) return null;
  const agentLabel = options.agentLabel ?? "Codex";
  return {
    title: `${agentLabel} idle`,
    outputLines: [`No active ${agentLabel} output`],
    focusable: false,
  };
}
