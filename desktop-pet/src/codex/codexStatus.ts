import { resolveCodexTaskTitle, workspaceLabelFromPath } from "../../electron/codexPresentation";

export type CodexLaunchState =
  | "idle"
  | "starting"
  | "launched"
  | "resuming"
  | "running"
  | "command_running"
  | "file_changed"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "disconnected"
  | "vscode-opened";

export type CodexStatus = {
  state: CodexLaunchState;
  workspacePath?: string;
  sessionTitle?: string;
  codexSessionId?: string;
  completionNoticeKey?: string;
  lastOutput?: string;
  error?: string;
  updatedAt?: string;
  source?: "codex-jsonl" | "claude-jsonl" | "app-server" | "terminal";
  /** Command the user should paste into the freshly opened VSCode terminal. */
  commandLine?: string;
};

export type CodexStatusMotionIntent =
  | "idle"
  | "thinking"
  | "command"
  | "file_change"
  | "approval"
  | "complete"
  | "failure"
  | "disconnected";

export type CodexStatusTone = "idle" | "active" | "attention" | "success" | "danger" | "offline";

export type CodexStatusPresentation = {
  motionIntent: CodexStatusMotionIntent;
  statusTone: CodexStatusTone;
  shouldInterruptIdle: boolean;
};

function sessionLabel(status: CodexStatus): string {
  return resolveCodexTaskTitle([status.sessionTitle], status.workspacePath);
}

export function describeCodexStatus(status: CodexStatus | null | undefined): string | null {
  if (!status || status.state === "idle") return null;
  if (status.state === "failed") {
    return `Codex launch failed · ${status.error?.trim() || workspaceLabelFromPath(status.workspacePath)}`;
  }
  if (status.state === "starting") {
    return `Codex starting · ${workspaceLabelFromPath(status.workspacePath)}`;
  }
  if (status.state === "vscode-opened") {
    return `VSCode workspace open · ${workspaceLabelFromPath(status.workspacePath)}`;
  }
  if (status.state === "resuming") {
    return `Codex resuming · ${sessionLabel(status)}`;
  }
  if (status.state === "running") {
    return `Codex running · ${sessionLabel(status)}`;
  }
  if (status.state === "command_running") {
    return `Codex command running · ${sessionLabel(status)}`;
  }
  if (status.state === "file_changed") {
    return `Codex changed files · ${sessionLabel(status)}`;
  }
  if (status.state === "waiting_approval") {
    return `Codex waiting approval · ${sessionLabel(status)}`;
  }
  if (status.state === "completed") {
    return `Codex completed · ${sessionLabel(status)}`;
  }
  if (status.state === "disconnected") {
    return `Codex disconnected · ${sessionLabel(status)}`;
  }
  return `Codex terminal running · ${workspaceLabelFromPath(status.workspacePath)}`;
}

export function getCodexStatusPresentation(status: CodexStatus | null | undefined): CodexStatusPresentation {
  if (!status || status.state === "idle") {
    return { motionIntent: "idle", statusTone: "idle", shouldInterruptIdle: false };
  }

  if (status.state === "command_running") {
    return { motionIntent: "command", statusTone: "active", shouldInterruptIdle: true };
  }
  if (status.state === "file_changed") {
    return { motionIntent: "file_change", statusTone: "attention", shouldInterruptIdle: true };
  }
  if (status.state === "waiting_approval") {
    return { motionIntent: "approval", statusTone: "attention", shouldInterruptIdle: true };
  }
  if (status.state === "completed") {
    return { motionIntent: "complete", statusTone: "success", shouldInterruptIdle: true };
  }
  if (status.state === "failed") {
    return { motionIntent: "failure", statusTone: "danger", shouldInterruptIdle: true };
  }
  if (status.state === "disconnected") {
    return { motionIntent: "disconnected", statusTone: "offline", shouldInterruptIdle: true };
  }

  return { motionIntent: "thinking", statusTone: "active", shouldInterruptIdle: true };
}
