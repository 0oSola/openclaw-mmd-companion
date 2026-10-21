import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  AgentProcessObservation,
  AgentSessionRuntime,
  AgentSessionProvider,
} from "./agentSessionDiscovery.js";

const execFile = promisify(nodeExecFile);

type ProcessRow = {
  ProcessName?: unknown;
  Id?: unknown;
  StartTime?: unknown;
};

export type ProcessCommandRunner = (
  file: string,
  args: readonly string[],
  options: {
    windowsHide?: boolean;
    timeout?: number;
  },
) => Promise<{ stdout: string; stderr: string }>;

export type AgentProcessScannerOptions = {
  platform?: NodeJS.Platform;
  now?: () => Date;
  execFile?: ProcessCommandRunner;
  timeoutMs?: number;
};

const WINDOWS_PROCESS_QUERY = `
$names = @('codex', 'ChatGPT', 'claude')
Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $names -contains $_.ProcessName } |
  ForEach-Object {
    $startedAt = $null
    try { $startedAt = $_.StartTime.ToUniversalTime().ToString("o") } catch {}
    [pscustomobject]@{
      ProcessName = $_.ProcessName
      Id = $_.Id
      StartTime = $startedAt
    }
  } |
  ConvertTo-Json -Compress
`;

function compact(value: unknown): string {
  return String(value ?? "").trim();
}

function classifyProcess(
  processName: string,
): { provider: AgentSessionProvider; runtime: AgentSessionRuntime } | null {
  switch (processName.toLowerCase()) {
    case "chatgpt":
      return { provider: "codex", runtime: "desktop" };
    case "codex":
      return { provider: "codex", runtime: "cli" };
    case "claude":
      return { provider: "claude", runtime: "cli" };
    default:
      return null;
  }
}

function parseRows(stdout: string): ProcessRow[] {
  const text = stdout.trim();
  if (!text) return [];
  const parsed: unknown = JSON.parse(text);
  if (parsed === null) return [];
  if (Array.isArray(parsed)) return parsed as ProcessRow[];
  return [parsed as ProcessRow];
}

function toObservation(
  row: ProcessRow,
  observedAt: string,
): AgentProcessObservation | null {
  const processName = compact(row.ProcessName);
  const classification = classifyProcess(processName);
  const pid = Number(row.Id);
  if (!classification || !Number.isInteger(pid) || pid <= 0) return null;
  const startedAt = compact(row.StartTime) || null;
  return {
    pid,
    processName,
    provider: classification.provider,
    runtime: classification.runtime,
    hostId: "local",
    startedAt,
    observedAt,
  };
}

export function createWindowsAgentProcessScanner(
  options: AgentProcessScannerOptions = {},
): () => Promise<AgentProcessObservation[]> {
  const platform = options.platform ?? process.platform;
  const now = options.now ?? (() => new Date());
  const run = options.execFile ?? (execFile as unknown as ProcessCommandRunner);
  const timeout = options.timeoutMs ?? 5_000;

  return async () => {
    if (platform !== "win32") return [];
    const result = await run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_PROCESS_QUERY],
      { windowsHide: true, timeout },
    );
    const observedAt = now().toISOString();
    return parseRows(result.stdout)
      .map((row) => toObservation(row, observedAt))
      .filter((item): item is AgentProcessObservation => item !== null);
  };
}
