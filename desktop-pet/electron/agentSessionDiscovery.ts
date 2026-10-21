import type {
  CodexReviewFacts,
  CodexSessionFileSummary,
  CodexSessionStatus,
} from "./codexSessionFiles.js";
import type { ClaudeSessionFileSummary } from "./claudeSessionFiles.js";

export const AGENT_SESSION_PROVIDERS = ["codex", "claude", "pet-app-server"] as const;
export type AgentSessionProvider = (typeof AGENT_SESSION_PROVIDERS)[number];

export const AGENT_SESSION_RUNTIMES = ["desktop", "cli", "wsl", "app-server", "unknown"] as const;
export type AgentSessionRuntime = (typeof AGENT_SESSION_RUNTIMES)[number];

export type AgentSessionState = CodexSessionStatus | "idle";
export type AgentSessionAgent = "codex" | "claude";

export type AgentSessionEvidence = {
  source: "codex-jsonl" | "claude-jsonl" | "pet-app-server" | "process";
  sessionFileModifiedAt: string | null;
  sessionFile: string | null;
  processId?: number | null;
  processName?: string | null;
};

export type AgentProcessObservation = {
  pid: number;
  processName: string;
  provider: AgentSessionProvider | null;
  runtime: AgentSessionRuntime;
  hostId: "local";
  startedAt: string | null;
  observedAt: string;
  sessionId?: string | null;
};

export type AgentSessionRecord = {
  sessionKey: string;
  provider: AgentSessionProvider;
  agent: AgentSessionAgent;
  runtime: AgentSessionRuntime;
  hostId: "local";
  sessionId: string;
  workspacePath: string;
  displayTitle: string;
  firstPromptPreview: string | null;
  lastSummary: string | null;
  lastOutput: string | null;
  state: AgentSessionState;
  sessionStartedAt: string;
  lastEventAt: string | null;
  lastActivityAt: string;
  sessionFile: string | null;
  processId: number | null;
  processAlive: boolean | null;
  processStartedAt: string | null;
  processName: string | null;
  processRuntime: AgentSessionRuntime | null;
  originator: string | null;
  source: string | null | undefined;
  cliVersion: string | null;
  gitBranch: string | null;
  reviewFacts: CodexReviewFacts;
  evidence: AgentSessionEvidence[];
};

export type AgentSessionDiscoverySnapshot = {
  refreshedAt: string;
  sessions: AgentSessionRecord[];
};

export type CodexSessionScanner = (options: {
  codexHome: string;
  wslCodexHome?: string | null;
  workspacePath?: string | null;
  limit?: number;
  maxFiles?: number;
}) => CodexSessionFileSummary[];

export type ClaudeSessionScanner = (options: {
  claudeHome: string;
  workspacePath?: string | null;
  limit?: number;
  maxFiles?: number;
}) => ClaudeSessionFileSummary[];

export type LocalCodexSessionDiscoveryOptions = {
  codexHome: string;
  wslCodexHome?: string | null;
  limit?: number;
  maxFiles?: number;
  scan: CodexSessionScanner;
  now?: () => Date;
};

export type LocalClaudeSessionDiscoveryOptions = {
  claudeHome: string;
  limit?: number;
  maxFiles?: number;
  scan: ClaudeSessionScanner;
  now?: () => Date;
};

export type PetAppServerSessionSummary = {
  id: string;
  workspaceId: string;
  workspacePath: string;
  status: string;
  createdAt: string;
  lastActiveAt: string;
  processId: number | null;
  codexVersion: string | null;
  transport: string;
  sandbox: string;
  mode: string | null;
  lastOutputPreview: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
};

export type PetAppServerSessionScanner = (limit: number) => Promise<PetAppServerSessionSummary[]>;

export type PetAppServerDiscoveryOptions = {
  limit?: number;
  scan: PetAppServerSessionScanner;
  now?: () => Date;
};

function compact(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function parseTime(value: string | null | undefined): number {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isWslEvidence(summary: CodexSessionFileSummary): boolean {
  return (
    summary.filePath.toLowerCase().includes("\\\\wsl.localhost\\") ||
    summary.workspacePath.toLowerCase().startsWith("/mnt/")
  );
}

function displayWorkspacePath(value: string): string {
  const workspacePath = compact(value);
  const match = workspacePath.match(/^\/mnt\/([a-z])(?:\/(.*))?$/i);
  if (!match) return workspacePath;
  const drive = match[1]?.toUpperCase();
  const tail = (match[2] ?? "").replace(/\//g, "\\");
  return `${drive}:\\${tail}`.replace(/\\+$/, "\\");
}

function classifyRuntime(summary: CodexSessionFileSummary): AgentSessionRuntime {
  const originator = compact(summary.originator).toLowerCase();
  if (/desktop/.test(originator)) return "desktop";
  if (compact(summary.source).toLowerCase() === "desktop") return "desktop";
  if (/cli|tui/.test(originator)) return isWslEvidence(summary) ? "wsl" : "cli";
  if (compact(summary.source).toLowerCase() === "cli") return isWslEvidence(summary) ? "wsl" : "cli";
  return isWslEvidence(summary) ? "wsl" : "unknown";
}

function sessionKey(summary: CodexSessionFileSummary): string {
  return `local:codex:${summary.codexSessionId}`;
}

function sessionKeyFor(provider: AgentSessionProvider, sessionId: string): string {
  return `local:${provider}:${sessionId}`;
}

function emptyReviewFacts(): CodexReviewFacts {
  return {
    failed_commands: [],
    changed_files: [],
    approvals: [],
    errors: [],
    event_counts: {},
    user_messages: [],
    assistant_messages: [],
    function_call_summaries: [],
    work_items: [],
    methods: [],
  };
}

const ACTIVE_STATES = new Set<CodexSessionStatus>([
  "starting",
  "running",
  "command_running",
  "file_changed",
  "waiting_approval",
]);
const DEFAULT_ACTIVE_WINDOW_MS = 5 * 60 * 1000;
const PROCESS_IDENTITY_CLOCK_SKEW_MS = 60 * 1000;

function deriveState(
  status: CodexSessionStatus,
  lastActivityAt: string,
  nowMs: number,
  activeWindowMs = DEFAULT_ACTIVE_WINDOW_MS,
): AgentSessionState {
  if (!ACTIVE_STATES.has(status)) return status;
  const lastActivityMs = parseTime(lastActivityAt);
  if (!lastActivityMs || nowMs - lastActivityMs > activeWindowMs) return "idle";
  return status;
}

function toRecord(summary: CodexSessionFileSummary, now: Date): AgentSessionRecord {
  const lastActivityAt =
    summary.lastEventAt || summary.fileModifiedAt || summary.sessionStartedAt;
  return {
    sessionKey: sessionKey(summary),
    provider: "codex",
    agent: "codex",
    runtime: classifyRuntime(summary),
    hostId: "local",
    sessionId: summary.codexSessionId,
    workspacePath: displayWorkspacePath(summary.workspacePath),
    displayTitle: summary.displayTitle,
    firstPromptPreview: summary.firstPromptPreview,
    lastSummary: summary.lastSummary,
    lastOutput: summary.lastOutput,
    state: deriveState(summary.lastStatus, lastActivityAt, now.getTime()),
    sessionStartedAt: summary.sessionStartedAt,
    lastEventAt: summary.lastEventAt,
    lastActivityAt,
    sessionFile: summary.filePath,
    processId: null,
    processAlive: null,
    processStartedAt: null,
    processName: null,
    processRuntime: null,
    originator: summary.originator,
    source: summary.source,
    cliVersion: summary.cliVersion,
    gitBranch: null,
    reviewFacts: summary.reviewFacts,
    evidence: [{
      source: "codex-jsonl",
      sessionFileModifiedAt: summary.fileModifiedAt,
      sessionFile: summary.filePath,
    }],
  };
}

function toClaudeRecord(summary: ClaudeSessionFileSummary, now: Date): AgentSessionRecord {
  const lastActivityAt =
    summary.lastEventAt || summary.fileModifiedAt || summary.sessionStartedAt;
  return {
    sessionKey: sessionKeyFor("claude", summary.claudeSessionId),
    provider: "claude",
    agent: "claude",
    runtime: "cli",
    hostId: "local",
    sessionId: summary.claudeSessionId,
    workspacePath: displayWorkspacePath(summary.workspacePath),
    displayTitle: summary.displayTitle,
    firstPromptPreview: summary.firstPromptPreview,
    lastSummary: summary.lastSummary,
    lastOutput: summary.lastOutput,
    state: deriveState(summary.lastStatus, lastActivityAt, now.getTime()),
    sessionStartedAt: summary.sessionStartedAt,
    lastEventAt: summary.lastEventAt,
    lastActivityAt,
    sessionFile: summary.filePath,
    processId: null,
    processAlive: null,
    processStartedAt: null,
    processName: null,
    processRuntime: null,
    originator: "claude-code",
    source: "claude-jsonl",
    cliVersion: summary.cliVersion,
    gitBranch: summary.gitBranch,
    reviewFacts: summary.reviewFacts,
    evidence: [{
      source: "claude-jsonl",
      sessionFileModifiedAt: summary.fileModifiedAt,
      sessionFile: summary.filePath,
    }],
  };
}

function appServerState(status: string): AgentSessionState {
  switch (compact(status).toLowerCase()) {
    case "starting":
    case "preparing":
      return "starting";
    case "running":
      return "running";
    case "waiting_approval":
    case "approval_required":
      return "waiting_approval";
    case "failed":
      return "failed";
    case "closed":
    case "disconnected":
      return "disconnected";
    case "completed":
      return "completed";
    case "ready":
    case "idle":
    default:
      return "idle";
  }
}

function toPetAppServerRecord(summary: PetAppServerSessionSummary): AgentSessionRecord {
  const lastActivityAt = summary.lastActiveAt || summary.createdAt;
  return {
    sessionKey: sessionKeyFor("pet-app-server", summary.id),
    provider: "pet-app-server",
    agent: "codex",
    runtime: "app-server",
    hostId: "local",
    sessionId: summary.id,
    workspacePath: displayWorkspacePath(summary.workspacePath),
    displayTitle: compact(summary.mode) ? `Pet app-server · ${summary.mode}` : "Pet app-server",
    firstPromptPreview: null,
    lastSummary: summary.error || summary.lastOutputPreview,
    lastOutput: summary.lastOutputPreview,
    state: appServerState(summary.status),
    sessionStartedAt: summary.createdAt,
    lastEventAt: lastActivityAt,
    lastActivityAt,
    sessionFile: null,
    processId: summary.processId,
    processAlive: null,
    processStartedAt: null,
    processName: null,
    processRuntime: null,
    originator: "desktop-pet",
    source: "pet-app-server",
    cliVersion: summary.codexVersion,
    gitBranch: null,
    reviewFacts: emptyReviewFacts(),
    evidence: [{
      source: "pet-app-server",
      sessionFileModifiedAt: lastActivityAt,
      sessionFile: null,
    }],
  };
}

function preferNewer(left: AgentSessionRecord, right: AgentSessionRecord): AgentSessionRecord {
  const preferred = parseTime(right.lastActivityAt) >= parseTime(left.lastActivityAt) ? right : left;
  const evidence = new Map(
    [...left.evidence, ...right.evidence].map((item) => [
      `${item.source}:${item.sessionFile}:${item.processId ?? ""}:${item.processName ?? ""}`,
      item,
    ]),
  );
  return {
    ...preferred,
    evidence: Array.from(evidence.values()).sort(
      (leftEvidence, rightEvidence) =>
        parseTime(rightEvidence.sessionFileModifiedAt) -
        parseTime(leftEvidence.sessionFileModifiedAt),
    ),
  };
}

function dedupeAndSort(
  records: AgentSessionRecord[],
  refreshedAt: string,
): AgentSessionDiscoverySnapshot {
  const bySession = new Map<string, AgentSessionRecord>();
  for (const record of records) {
    const previous = bySession.get(record.sessionKey);
    bySession.set(record.sessionKey, previous ? preferNewer(previous, record) : record);
  }
  const sessions = Array.from(bySession.values()).sort(
    (left, right) => parseTime(right.lastActivityAt) - parseTime(left.lastActivityAt),
  );
  return { refreshedAt, sessions };
}

function processMatchesRecord(
  record: AgentSessionRecord,
  observation: AgentProcessObservation,
): boolean {
  const sameStableIdentity =
    record.processId !== null && record.processId === observation.pid;
  const sameSessionIdentity =
    Boolean(observation.sessionId) &&
    observation.sessionId === record.sessionId &&
    (observation.provider === null || observation.provider === record.provider);
  if (!sameStableIdentity && !sameSessionIdentity) return false;

  if (
    record.processStartedAt &&
    observation.startedAt &&
    parseTime(record.processStartedAt) !== parseTime(observation.startedAt)
  ) {
    return false;
  }
  const sessionStartedAtMs = parseTime(record.sessionStartedAt);
  const processStartedAtMs = parseTime(observation.startedAt);
  if (
    sessionStartedAtMs &&
    processStartedAtMs &&
    processStartedAtMs > sessionStartedAtMs + PROCESS_IDENTITY_CLOCK_SKEW_MS
  ) {
    return false;
  }
  return true;
}

function isActiveState(state: AgentSessionState): boolean {
  return ACTIVE_STATES.has(state as CodexSessionStatus);
}

export function enrichAgentSessionRecords(
  records: AgentSessionRecord[],
  observations: AgentProcessObservation[],
  options: { scanCompleted: boolean },
): AgentSessionRecord[] {
  const observationByRecord = new Map<string, AgentProcessObservation>();
  for (const observation of observations) {
    for (const record of records) {
      if (processMatchesRecord(record, observation)) {
        observationByRecord.set(record.sessionKey, observation);
        break;
      }
    }
  }

  return records.map((record) => {
    const observation = observationByRecord.get(record.sessionKey);
    if (observation) {
      const processEvidence: AgentSessionEvidence = {
        source: "process",
        sessionFileModifiedAt: observation.observedAt,
        sessionFile: null,
        processId: observation.pid,
        processName: observation.processName,
      };
      const evidence = new Map(
        [...record.evidence, processEvidence].map((item) => [
          `${item.source}:${item.sessionFile}:${item.processId ?? ""}:${item.processName ?? ""}`,
          item,
        ]),
      );
      return {
        ...record,
        processId: record.processId ?? observation.pid,
        processAlive: true,
        processStartedAt: observation.startedAt,
        processName: observation.processName,
        processRuntime: observation.runtime,
        evidence: Array.from(evidence.values()).sort(
          (left, right) =>
            parseTime(right.sessionFileModifiedAt) - parseTime(left.sessionFileModifiedAt),
        ),
      };
    }

    if (
      options.scanCompleted &&
      record.provider === "pet-app-server" &&
      record.processId !== null
    ) {
      return {
        ...record,
        processAlive: false,
        state: isActiveState(record.state) ? "disconnected" : record.state,
      };
    }

    return { ...record };
  });
}

export async function discoverLocalCodexSessions(
  options: LocalCodexSessionDiscoveryOptions,
): Promise<AgentSessionDiscoverySnapshot> {
  const now = (options.now ?? (() => new Date()))();
  const summaries = options.scan({
    codexHome: options.codexHome,
    wslCodexHome: options.wslCodexHome,
    workspacePath: undefined,
    limit: Math.max(1, Math.min(options.limit ?? 50, 200)),
    maxFiles: Math.max(options.maxFiles ?? 400, options.limit ?? 50),
  });
  return dedupeAndSort(
    summaries.map((summary) => toRecord(summary, now)),
    now.toISOString(),
  );
}

export async function discoverLocalClaudeSessions(
  options: LocalClaudeSessionDiscoveryOptions,
): Promise<AgentSessionDiscoverySnapshot> {
  const now = (options.now ?? (() => new Date()))();
  const summaries = options.scan({
    claudeHome: options.claudeHome,
    workspacePath: undefined,
    limit: Math.max(1, Math.min(options.limit ?? 50, 200)),
    maxFiles: Math.max(options.maxFiles ?? 400, options.limit ?? 50),
  });
  return dedupeAndSort(
    summaries.map((summary) => toClaudeRecord(summary, now)),
    now.toISOString(),
  );
}

export async function discoverPetAppServerSessions(
  options: PetAppServerDiscoveryOptions,
): Promise<AgentSessionDiscoverySnapshot> {
  const now = (options.now ?? (() => new Date()))();
  const limit = Math.max(1, Math.min(options.limit ?? 50, 50));
  const summaries = await options.scan(limit);
  return dedupeAndSort(
    summaries.map(toPetAppServerRecord),
    now.toISOString(),
  );
}
