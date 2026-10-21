type MenuAction =
  | { type: "select-workspace" }
  | { type: "switch-workspace"; workspacePath: string }
  | { type: "workspace-selected"; workspacePath: string }
  | { type: "new-session" }
  | { type: "send-prompt" }
  | { type: "prompt-sent"; source?: "terminal" }
  | { type: "restore-session"; petSessionId: string }
  | { type: "focus-active-session"; petSessionId: string }
  | { type: "more-sessions"; sessions?: unknown[] }
  | { type: "interaction-mode"; mode: "window-drag" | "camera-adjust" }
  | { type: "notification-detail"; profile: "low" | "medium" | "high" }
  | { type: "menu-language"; language: "en" | "zh-CN" }
  | { type: "agent"; agent: "codex" | "claude" }
  | { type: "codex-env"; envMode: "win" | "wsl" }
  | { type: "always-on-top"; enabled: boolean }
  | { type: "focus-vscode" }
  | { type: "sync-main-site" }
  | { type: "close" };

const PROFILE_LABELS: Record<"low" | "medium" | "high", string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

function workspaceLabel(workspacePath: string): string {
  const parts = workspacePath.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || "workspace";
}

export function describeMenuActionResult(action: MenuAction): string {
  switch (action.type) {
    case "notification-detail":
      return `Notification detail: ${PROFILE_LABELS[action.profile]}`;
    case "sync-main-site":
      return "Syncing from main site...";
    case "menu-language":
      return action.language === "zh-CN" ? "菜单语言：中文" : "Menu language: English";
    case "agent":
      return action.agent === "claude" ? "Coding agent: Claude" : "Coding agent: Codex";
    case "codex-env":
      return action.envMode === "wsl" ? "Codex env: WSL" : "Codex env: Windows";
    case "always-on-top":
      return action.enabled ? "Always on top enabled" : "Always on top disabled";
    case "select-workspace":
      return "Selecting Codex workspace...";
    case "switch-workspace":
      return `Switching workspace: ${workspaceLabel(action.workspacePath)}`;
    case "workspace-selected":
      return `Workspace selected: ${workspaceLabel(action.workspacePath)}`;
    case "new-session":
      return "Opening VSCode workspace and starting Codex...";
    case "send-prompt":
      return "Preparing Codex prompt...";
    case "prompt-sent":
      return "Prompt sent to VSCode terminal";
    case "restore-session":
      return "Opening VSCode workspace and resuming Codex...";
    case "focus-active-session":
      return "Opening existing task window...";
    case "more-sessions":
      return "Showing Codex sessions...";
    case "interaction-mode":
      return action.mode === "camera-adjust"
        ? "Interaction mode: Adjust Camera · Mouse wheel zooms"
        : "Interaction mode: Drag Whole App";
    case "focus-vscode":
      return "Opening VSCode workspace...";
    case "close":
      return "Closing Pet...";
  }
}

export function describeMainSiteSyncResult(modelLabel: string | null | undefined, renderPipeline: string): string {
  return `Synced: ${modelLabel?.trim() || "no model"} · ${renderPipeline}`;
}
