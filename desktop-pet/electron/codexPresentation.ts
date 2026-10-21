const INJECTED_CONTEXT_PREFIXES = [
  "# agents.md instructions",
  "# files mentioned by the user:",
  "# project agent notes",
  "## referenced chatgpt conversation",
  "<app-context>",
  "<environment_context>",
  "<permissions instructions>",
  "<plugins_instructions>",
  "<recommended_plugins>",
  "<skills_instructions>",
  "the following is the codex agent history",
];

export function compactCodexText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

export function workspaceLabelFromPath(workspacePath: string | null | undefined): string {
  const parts = compactCodexText(workspacePath).split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || "workspace";
}

export function isInjectedCodexContext(value: string): boolean {
  const normalized = compactCodexText(value).toLowerCase();
  return Boolean(normalized) && INJECTED_CONTEXT_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function redactCodexSensitiveText(value: string): string {
  return value
    .replace(
      /\b((?:[\w.-]*?(?:token|password|passwd|pwd|secret|api[_-]?key|access[_-]?key|private[_-]?key)[\w.-]*?)\s*[:=]\s*)(["']?)[^\s"',;]+/gi,
      "$1[redacted]",
    )
    .replace(/\b(?:sk|ghp|github_pat|xox[abprs])[-_][A-Za-z0-9._-]{8,}\b/g, "[redacted]");
}

export function truncateCodexText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const clipped = value.slice(0, Math.max(0, maxLength - 3));
  const lastSpace = clipped.lastIndexOf(" ");
  const boundary = lastSpace >= Math.floor(maxLength * 0.62) ? lastSpace : clipped.length;
  return `${clipped.slice(0, boundary).trimEnd()}...`;
}

export function resolveCodexTaskTitle(
  candidates: readonly (string | null | undefined)[],
  workspacePath: string | null | undefined,
  maxLength = 80,
): string {
  const fallback = workspaceLabelFromPath(workspacePath) || "Codex session";
  const candidate = candidates
    .map(compactCodexText)
    .find((value) => value.length > 0 && !isInjectedCodexContext(value));
  return truncateCodexText(redactCodexSensitiveText(candidate || fallback), maxLength);
}

function isCodexOutputNoiseLine(value: string): boolean {
  return (
    /^Exit code:\s*-?\d+$/i.test(value) ||
    /^Wall time:\s*\d+(?:\.\d+)?\s*(?:ms|s|seconds?)$/i.test(value) ||
    /^Total output lines:\s*\d+$/i.test(value) ||
    /^Output:\s*$/i.test(value) ||
    /^\[\s*(?:[#=*\->]+\s*)?\d{1,3}%\s*(?:[#=*\->]+\s*)?\]$/i.test(value) ||
    /^\d{1,3}%$/i.test(value) ||
    /^[-_=~*]{3,}$/i.test(value) ||
    /^[-_=~* ]{3,}(?:warnings?|errors?|output|result|summary)[-_=~* ]*$/i.test(value) ||
    /^(?:warnings?|errors?|output|result|summary)\s*:?\s*$/i.test(value)
  );
}

export function formatCodexOutputLines(
  rawOutput: string | null | undefined,
  options: { maxLines?: number; maxLineLength?: number } = {},
): string[] {
  const maxLines = options.maxLines ?? 3;
  const maxLineLength = options.maxLineLength ?? 180;
  if (!compactCodexText(rawOutput)) return [];

  const lines: string[] = [];
  for (const rawLine of rawOutput!.replace(/\r\n/g, "\n").split("\n")) {
    const line = compactCodexText(rawLine);
    if (!line || isInjectedCodexContext(line) || isCodexOutputNoiseLine(line)) continue;
    const formatted = truncateCodexText(redactCodexSensitiveText(line), maxLineLength);
    if (formatted && !lines.includes(formatted)) lines.push(formatted);
    if (lines.length >= maxLines) break;
  }
  return lines;
}

export type CodexCompletedPresentation = {
  title: string;
  workspaceLabel: string;
  taskLabel?: string;
  outputLines: string[];
};

export function buildCodexCompletedPresentation(
  options: {
    workspacePath?: string | null;
    sessionTitle?: string | null;
    lastOutput?: string | null;
  },
  agentLabel = "Codex",
): CodexCompletedPresentation {
  const workspaceLabel = workspaceLabelFromPath(options.workspacePath);
  const taskCandidate = resolveCodexTaskTitle([options.sessionTitle], options.workspacePath);
  const taskLabel = taskCandidate !== workspaceLabel ? taskCandidate : undefined;
  const outputLines = formatCodexOutputLines(options.lastOutput, {
    maxLines: taskLabel ? 2 : 3,
  });

  return {
    title: `${compactCodexText(agentLabel) || "Codex"} completed - ${workspaceLabel}`,
    workspaceLabel,
    taskLabel,
    outputLines,
  };
}
