import type { CodexStatus } from "./codexStatus";
import {
  resolveCodexTaskTitle,
  workspaceLabelFromPath,
} from "../../electron/codexPresentation";

export type CodexCompletionNotice = {
  key: string;
  title: string;
  workspaceLabel: string;
  taskLabel?: string;
  workspacePath: string;
};

export const DISMISSED_COMPLETION_NOTICE_STORAGE_KEY = "pet:dismissed-completion-notice";
export const MAX_DISMISSED_COMPLETION_NOTICE_KEYS = 100;

function compact(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function normalizeDismissedCompletionNoticeKeys(values: readonly unknown[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();

  for (
    let index = values.length - 1;
    index >= 0 && keys.length < MAX_DISMISSED_COMPLETION_NOTICE_KEYS;
    index -= 1
  ) {
    const value = values[index];
    const key = typeof value === "string" ? compact(value) : "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }

  return keys.reverse();
}

export function parseDismissedCompletionNoticeKeys(value: string | null | undefined): string[] {
  const stored = value?.trim();
  if (!stored) return [];

  try {
    const parsed = JSON.parse(stored) as unknown;
    if (Array.isArray(parsed)) return normalizeDismissedCompletionNoticeKeys(parsed);
    if (typeof parsed === "string") return normalizeDismissedCompletionNoticeKeys([parsed]);
    return [];
  } catch {
    // Legacy versions stored one raw completion key instead of a JSON array.
    return normalizeDismissedCompletionNoticeKeys([stored]);
  }
}

export function addDismissedCompletionNoticeKey(keys: readonly string[], value: string): string[] {
  return normalizeDismissedCompletionNoticeKeys([...keys, value]);
}

export function serializeDismissedCompletionNoticeKeys(keys: readonly string[]): string {
  return JSON.stringify(normalizeDismissedCompletionNoticeKeys(keys));
}

export function buildCodexCompletionNotice(
  status: CodexStatus | null | undefined,
  dismissedKeys: readonly string[] | null | undefined,
  agentLabel = "Codex",
): CodexCompletionNotice | null {
  const workspacePath = compact(status?.workspacePath);
  if (!status || status.state !== "completed" || !workspacePath) return null;

  const key = compact(status.completionNoticeKey);
  if (!key || dismissedKeys?.includes(key)) return null;

  const label = workspaceLabelFromPath(workspacePath);
  const task = resolveCodexTaskTitle([status.sessionTitle], workspacePath, 72);
  return {
    key,
    title: `${agentLabel} task completed`,
    workspaceLabel: label,
    taskLabel: task && task !== label ? task : undefined,
    workspacePath,
  };
}

export function resolveLatchedCodexCompletionNotice(
  current: CodexCompletionNotice | null | undefined,
  status: CodexStatus | null | undefined,
  dismissedKeys: readonly string[] | null | undefined,
  agentLabel = "Codex",
): CodexCompletionNotice | null {
  const next = buildCodexCompletionNotice(status, dismissedKeys, agentLabel);
  if (next) return next;
  if (current && dismissedKeys?.includes(current.key)) return null;
  return current ?? null;
}
