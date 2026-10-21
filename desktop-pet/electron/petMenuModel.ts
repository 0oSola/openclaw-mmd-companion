import type { PetInteractionMode } from "./interactionMode.js";
import { workspaceDisplayLabel } from "./remoteWorkspace.js";

export const NOTIFICATION_PROFILES = ["low", "medium", "high"] as const;
export const MENU_LANGUAGES = ["en", "zh-CN"] as const;
export const PET_AGENTS = ["codex", "claude"] as const;
export const CODEX_LAUNCH_TARGETS = ["vscode-cli", "codex-desktop"] as const;

export type NotificationProfile = (typeof NOTIFICATION_PROFILES)[number];
export type MenuLanguage = (typeof MENU_LANGUAGES)[number];
export type PetAgent = (typeof PET_AGENTS)[number];
export type CodexLaunchTarget = (typeof CODEX_LAUNCH_TARGETS)[number];

export const PET_AGENT_LABELS: Record<PetAgent, string> = {
  codex: "Codex",
  claude: "Claude",
};

export const CODEX_ENV_MODES = ["win", "wsl"] as const;
export type CodexEnvMode = (typeof CODEX_ENV_MODES)[number];

export const CODEX_ENV_MODE_LABELS: Record<CodexEnvMode, string> = {
  win: "Windows",
  wsl: "WSL",
};

export type PetMenuSession = {
  pet_session_id?: string;
  codex_session_id?: string;
  agent?: string | null;
  runtime?: string | null;
  workspace_id?: string | null;
  display_title?: string | null;
  first_prompt_preview?: string | null;
  last_summary?: string | null;
  workspace_path?: string | null;
  codex_home?: string | null;
  last_status?: string | null;
  launch_mode?: string | null;
  remote_url?: string | null;
  app_server_pid?: number | null;
  app_server_port?: number | null;
  metadata?: Record<string, unknown> | null;
  last_seen_at?: string | null;
  updated_at?: string | null;
};

export type PetMenuAction =
  | { type: "select-workspace" }
  | { type: "refresh-remote-projects" }
  | { type: "select-codex-workspace"; workspaceId: string; workspacePath: string }
  | { type: "switch-workspace"; workspacePath: string }
  | { type: "workspace-selected"; workspacePath: string }
  | { type: "new-session" }
  | { type: "send-prompt" }
  | { type: "prompt-sent" }
  | { type: "restore-session"; petSessionId: string }
  | { type: "focus-active-session"; petSessionId: string }
  | { type: "more-sessions"; sessions?: PetMenuSession[] }
  | { type: "interaction-mode"; mode: PetInteractionMode }
  | { type: "notification-detail"; profile: NotificationProfile }
  | { type: "menu-language"; language: MenuLanguage }
  | { type: "agent"; agent: PetAgent }
  | { type: "codex-env"; envMode: CodexEnvMode }
  | { type: "codex-launch-target"; target: CodexLaunchTarget }
  | { type: "always-on-top"; enabled: boolean }
  | { type: "focus-vscode" }
  | { type: "sync-main-site" }
  | { type: "close" };

export type PetMenuItemModel = {
  id: string;
  label?: string;
  type?: "normal" | "separator" | "radio" | "checkbox";
  checked?: boolean;
  enabled?: boolean;
  action?: PetMenuAction;
  submenu?: PetMenuItemModel[];
};

const ACTIVE_SESSION_STATUSES = new Set(["starting", "running", "command_running", "file_changed", "waiting_approval"]);

export type PetMenuActiveTask = {
  petSessionId: string;
  codexSessionId?: string | null;
  title: string;
  status?: string | null;
  lastSeenAt?: string | null;
};

export type PetMenuActiveWorkspace = {
  workspacePath: string;
  activeSessionCount: number;
  lastStatus?: string | null;
  lastSeenAt?: string | null;
  activeTasks?: PetMenuActiveTask[];
};

const STATUS_LABELS: Record<MenuLanguage, Record<string, string>> = {
  en: {
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
  },
  "zh-CN": {
    no_session: "无会话",
    idle: "空闲",
    starting: "启动中",
    running: "运行中",
    command_running: "命令运行中",
    file_changed: "文件已变更",
    waiting_approval: "等待审批",
    completed: "已完成",
    failed: "已失败",
    disconnected: "已断开",
  },
};

const PROFILE_LABELS: Record<MenuLanguage, Record<NotificationProfile, string>> = {
  en: {
    low: "Low",
    medium: "Medium",
    high: "High",
  },
  "zh-CN": {
    low: "低",
    medium: "中",
    high: "高",
  },
};

const MENU_LABELS: Record<
  MenuLanguage,
  {
    newSession: string;
    sendPrompt: string;
    workspace: string;
    currentWorkspace: string;
    activeWorkspaces: string;
    noActiveWorkspaces: string;
    currentWorkspaceGroup: string;
    switchToWorkspace: string;
    noActiveTasks: string;
    selectWorkspace: string;
    codexWorkspaces: string;
    noCodexWorkspaces: string;
    refreshRemoteProjects: string;
    recentSessions: string;
    noRecentSessions: string;
    moreSessions: string;
    interactionMode: string;
    dragWholeApp: string;
    adjustCamera: string;
    notificationDetail: string;
    menuLanguage: string;
    agentMenu: string;
    codexEnvMenu: string;
    codexLaunchTargetMenu: string;
    alwaysOnTop: string;
    focusVscode: string;
    syncMainSite: string;
    close: string;
    continuePrefix: string;
    unknownStatus: string;
    activeTaskSingular: string;
    activeTaskPlural: string;
  }
> = {
  en: {
    newSession: "New {agent} Session",
    sendPrompt: "Send Prompt...",
    workspace: "Workspace",
    currentWorkspace: "Current",
    activeWorkspaces: "Active Workspaces",
    noActiveWorkspaces: "No active workspaces",
    currentWorkspaceGroup: "Current workspace",
    switchToWorkspace: "Switch to workspace",
    noActiveTasks: "No active tasks",
    selectWorkspace: "Select Workspace...",
    codexWorkspaces: "Codex Remote Projects",
    noCodexWorkspaces: "No Codex projects available",
    refreshRemoteProjects: "Refresh macCodex projects",
    recentSessions: "Recent Sessions",
    noRecentSessions: "No recent sessions",
    moreSessions: "More Sessions...",
    interactionMode: "Interaction Mode",
    dragWholeApp: "Drag Whole App",
    adjustCamera: "Adjust Camera",
    notificationDetail: "Notification Detail",
    menuLanguage: "Language / 语言",
    agentMenu: "Coding Agent",
    codexEnvMenu: "Codex Environment",
    codexLaunchTargetMenu: "Codex Launch Tool",
    alwaysOnTop: "Always on Top",
    focusVscode: "Open VSCode Workspace",
    syncMainSite: "Sync from Main Site",
    close: "Close",
    continuePrefix: "Continue",
    unknownStatus: "unknown",
    activeTaskSingular: "active task",
    activeTaskPlural: "active tasks",
  },
  "zh-CN": {
    newSession: "新建 {agent} 会话",
    sendPrompt: "发送 Prompt...",
    workspace: "工作区",
    currentWorkspace: "当前",
    activeWorkspaces: "\u6d3b\u8dc3\u5de5\u4f5c\u533a",
    noActiveWorkspaces: "\u6682\u65e0\u6d3b\u8dc3\u5de5\u4f5c\u533a",
    currentWorkspaceGroup: "\u5f53\u524d\u5de5\u4f5c\u533a",
    switchToWorkspace: "\u5207\u6362\u5230\u8be5\u5de5\u4f5c\u533a",
    noActiveTasks: "\u6682\u65e0\u6d3b\u8dc3\u4efb\u52a1",
    selectWorkspace: "选择工作区...",
    recentSessions: "最近会话",
    noRecentSessions: "暂无最近会话",
    moreSessions: "更多会话...",
    interactionMode: "交互模式",
    dragWholeApp: "拖动整个窗口",
    adjustCamera: "调整相机",
    notificationDetail: "提醒精度",
    menuLanguage: "Language / 语言",
    agentMenu: "编程助手",
    codexWorkspaces: "Codex 远程项目",
    noCodexWorkspaces: "暂无可用 Codex 项目",
    refreshRemoteProjects: "刷新 macCodex 项目",
    codexEnvMenu: "Codex 环境",
    codexLaunchTargetMenu: "Codex 启动工具",
    alwaysOnTop: "固定在顶部",
    focusVscode: "打开 VSCode 工作区",
    syncMainSite: "从主站同步",
    close: "关闭",
    continuePrefix: "继续",
    unknownStatus: "未知",
    activeTaskSingular: "\u4e2a\u6d3b\u8dc3\u4efb\u52a1",
    activeTaskPlural: "\u4e2a\u6d3b\u8dc3\u4efb\u52a1",
  },
};

export function shortSessionId(id: string): string {
  const compact = id.replaceAll("-", "");
  if (compact.length <= 16) return compact;
  return `${compact.slice(0, 8)}...${compact.slice(-8)}`;
}

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

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const clipped = value.slice(0, maxLength - 3);
  const lastSpace = clipped.lastIndexOf(" ");
  const boundary = lastSpace >= Math.floor(maxLength * 0.62) ? lastSpace : clipped.length;
  return `${clipped.slice(0, boundary).trimEnd()}...`;
}

export function formatSessionMenuLabel(session: PetMenuSession, now = new Date(), language: MenuLanguage = "en"): string {
  const labels = MENU_LABELS[language];
  const fallbackTitle = compactText(session.first_prompt_preview) || "Codex session";
  const rawTitle = compactText(session.display_title) || fallbackTitle;
  const title = truncateText(redactSensitiveText(rawTitle), 72);
  const statusKey = String(session.last_status || "");
  const status = STATUS_LABELS[language][statusKey] || statusKey || labels.unknownStatus;
  const seen = new Date(session.last_seen_at || session.updated_at || now);
  const sameDay = seen.toDateString() === now.toDateString();
  const locale = language === "zh-CN" ? "zh-CN" : undefined;
  const time = sameDay
    ? seen.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
    : seen.toLocaleDateString(locale, { month: "short", day: "numeric" });
  return language === "zh-CN"
    ? `${labels.continuePrefix}：${title} · ${time} · ${status}`
    : `${labels.continuePrefix}: ${title} 路 ${time} 路 ${status}`;
}

export function normalizeNotificationProfile(value: unknown): NotificationProfile {
  return NOTIFICATION_PROFILES.includes(value as NotificationProfile) ? (value as NotificationProfile) : "medium";
}

export function normalizeMenuLanguage(value: unknown): MenuLanguage {
  return MENU_LANGUAGES.includes(value as MenuLanguage) ? (value as MenuLanguage) : "en";
}

function workspaceName(workspacePath: string | undefined): string {
  if (workspacePath?.toLowerCase().startsWith("vscode-remote://")) return workspaceDisplayLabel(workspacePath);
  const parts = workspacePath?.split(/[\\/]/).filter(Boolean) ?? [];
  return parts.at(-1) || "workspace";
}

function workspaceIdentityKey(workspacePath: string | undefined): string {
  return (workspacePath || "").trim().replace(/[\\/]+/g, "\\").toLowerCase();
}

function sessionSeenAt(session: PetMenuSession): string | null {
  return session.last_seen_at || session.updated_at || null;
}

function sessionRestoreKey(session: PetMenuSession): string {
  return compactText(session.pet_session_id) || compactText(session.codex_session_id);
}

function sessionTaskTitle(session: PetMenuSession): string {
  const rawTitle = compactText(session.display_title) || compactText(session.first_prompt_preview) || "Codex session";
  return truncateText(redactSensitiveText(rawTitle), 64);
}

function seenAtMs(value: string | null | undefined): number {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatActiveWorkspaceMenuLabel(
  workspace: PetMenuActiveWorkspace,
  language: MenuLanguage,
): string {
  const labels = MENU_LABELS[language];
  const statusKey = String(workspace.lastStatus || "");
  const status = STATUS_LABELS[language][statusKey] || statusKey || labels.unknownStatus;
  if (workspace.activeSessionCount <= 1) {
    return `${workspaceName(workspace.workspacePath)} - ${status}`;
  }
  const taskLabel =
    workspace.activeSessionCount === 1 ? labels.activeTaskSingular : labels.activeTaskPlural;
  return `${workspaceName(workspace.workspacePath)} - ${status} - ${workspace.activeSessionCount} ${taskLabel}`;
}

function formatActiveTaskMenuLabel(task: PetMenuActiveTask, language: MenuLanguage): string {
  const labels = MENU_LABELS[language];
  const statusKey = String(task.status || "");
  const status = STATUS_LABELS[language][statusKey] || statusKey || labels.unknownStatus;
  return `${task.title} - ${status}`;
}

function buildActiveTaskMenuItem(task: PetMenuActiveTask, language: MenuLanguage): PetMenuItemModel {
  return {
    id: `workspace:active-task:${task.petSessionId}`,
    label: formatActiveTaskMenuLabel(task, language),
    action: { type: "focus-active-session", petSessionId: task.petSessionId },
  };
}

function buildActiveWorkspaceGroupSubmenu(
  workspace: PetMenuActiveWorkspace,
  isSelected: boolean,
  language: MenuLanguage,
): PetMenuItemModel[] {
  const labels = MENU_LABELS[language];
  const tasks = (workspace.activeTasks ?? []).slice(0, 10);
  const workspaceControl: PetMenuItemModel = isSelected
    ? {
        id: `workspace:active-current:${workspace.workspacePath}`,
        label: labels.currentWorkspaceGroup,
        type: "radio",
        checked: true,
        enabled: false,
      }
    : {
        id: `workspace:active-switch:${workspace.workspacePath}`,
        label: labels.switchToWorkspace,
        action: { type: "switch-workspace", workspacePath: workspace.workspacePath },
      };

  if (tasks.length === 0) {
    return [
      workspaceControl,
      {
        id: `workspace:active-empty:${workspace.workspacePath}`,
        label: labels.noActiveTasks,
        enabled: false,
      },
    ];
  }

  return [
    workspaceControl,
    { id: `workspace:active-separator:${workspace.workspacePath}`, type: "separator" },
    ...tasks.map((task) => buildActiveTaskMenuItem(task, language)),
  ];
}

function buildActiveWorkspaceDirectItems(
  workspace: PetMenuActiveWorkspace,
  isSelected: boolean,
  language: MenuLanguage,
): PetMenuItemModel[] {
  const tasks = (workspace.activeTasks ?? []).slice(0, 10);
  const firstTask = tasks[0];
  const workspaceAction: PetMenuAction | undefined = isSelected
    ? firstTask
      ? { type: "focus-active-session", petSessionId: firstTask.petSessionId }
      : undefined
    : { type: "switch-workspace", workspacePath: workspace.workspacePath };
  return [
    {
      id: `workspace:active:${workspace.workspacePath}`,
      label: formatActiveWorkspaceMenuLabel(workspace, language),
      enabled: true,
      action: workspaceAction,
    },
    ...tasks.map((task) => buildActiveTaskMenuItem(task, language)),
  ];
}

export function buildActiveWorkspaceSummaries(sessions: PetMenuSession[]): PetMenuActiveWorkspace[] {
  const byWorkspace = new Map<string, PetMenuActiveWorkspace>();
  for (const session of sessions) {
    const workspacePath = compactText(session.workspace_path);
    const lastStatus = compactText(session.last_status);
    if (!workspacePath || !ACTIVE_SESSION_STATUSES.has(lastStatus)) continue;
    const petSessionId = sessionRestoreKey(session);
    if (!petSessionId) continue;

    const key = workspaceIdentityKey(workspacePath);
    const lastSeenAt = sessionSeenAt(session);
    const task: PetMenuActiveTask = {
      petSessionId,
      codexSessionId: compactText(session.codex_session_id) || undefined,
      title: sessionTaskTitle(session),
      status: lastStatus,
      lastSeenAt,
    };
    const current = byWorkspace.get(key);
    if (!current) {
      byWorkspace.set(key, {
        workspacePath,
        activeSessionCount: 1,
        lastStatus,
        lastSeenAt,
        activeTasks: [task],
      });
      continue;
    }

    current.activeTasks = [...(current.activeTasks ?? []), task];
    current.activeSessionCount = current.activeTasks.length;
    if (seenAtMs(lastSeenAt) >= seenAtMs(current.lastSeenAt)) {
      current.workspacePath = workspacePath;
      current.lastStatus = lastStatus;
      current.lastSeenAt = lastSeenAt;
    }
  }

  return Array.from(byWorkspace.values())
    .map((workspace) => ({
      ...workspace,
      activeTasks: [...(workspace.activeTasks ?? [])].sort(
        (left, right) => seenAtMs(right.lastSeenAt) - seenAtMs(left.lastSeenAt),
      ),
    }))
    .sort((left, right) => seenAtMs(right.lastSeenAt) - seenAtMs(left.lastSeenAt));
}

export function normalizePetAgent(value: unknown): PetAgent {
  return PET_AGENTS.includes(value as PetAgent) ? (value as PetAgent) : "codex";
}

export function normalizeCodexEnvMode(value: unknown): CodexEnvMode {
  return CODEX_ENV_MODES.includes(value as CodexEnvMode) ? (value as CodexEnvMode) : "win";
}

export function normalizeCodexLaunchTarget(value: unknown): CodexLaunchTarget {
  return CODEX_LAUNCH_TARGETS.includes(value as CodexLaunchTarget)
    ? (value as CodexLaunchTarget)
    : "vscode-cli";
}

export function buildPetMenuModel(options: {
  interactionMode: PetInteractionMode;
  notificationProfile: NotificationProfile;
  menuLanguage: MenuLanguage;
  sessions: PetMenuSession[];
  activeWorkspaces?: PetMenuActiveWorkspace[];
  apiAvailable: boolean;
  alwaysOnTop?: boolean;
  selectedWorkspacePath?: string;
  codexRemoteWorkspaces?: Array<{
    id: string;
    path: string;
    source?: string;
    label?: string;
    hostDisplayName?: string;
    availability?: "desktop_registered" | "ssh_discovered" | "cached_offline";
  }>;
  agent?: PetAgent;
  codexEnvMode?: CodexEnvMode;
  codexLaunchTarget?: CodexLaunchTarget;
  now?: Date;
}): PetMenuItemModel[] {
  const now = options.now ?? new Date();
  const language = normalizeMenuLanguage(options.menuLanguage);
  const labels = MENU_LABELS[language];
  const recentSessions = options.sessions.slice(0, 10);
  const alwaysOnTop = options.alwaysOnTop ?? true;
  const agent = normalizePetAgent(options.agent);
  const codexEnvMode = normalizeCodexEnvMode(options.codexEnvMode);
  const codexLaunchTarget = normalizeCodexLaunchTarget(options.codexLaunchTarget);
  const codexDesktopRemoteProjects = (options.codexRemoteWorkspaces ?? []).filter(
    (workspace) => workspace.source === "codex-desktop-ssh",
  );
  const selectedRemoteWorkspace = codexDesktopRemoteProjects.find(
    (workspace) => workspaceIdentityKey(workspace.path) === workspaceIdentityKey(options.selectedWorkspacePath),
  );
  const newSessionLabel =
    agent === "codex" && codexLaunchTarget === "codex-desktop" && selectedRemoteWorkspace
      ? language === "zh-CN"
        ? "打开 Codex Desktop 新任务（需确认远程项目）"
        : "Open Codex Desktop task (confirm remote project)"
      : labels.newSession.replace("{agent}", PET_AGENT_LABELS[agent]);
  const currentWorkspaceLabel =
    language === "zh-CN"
      ? `${labels.currentWorkspace}：${workspaceName(options.selectedWorkspacePath)}`
      : `${labels.currentWorkspace}: ${workspaceName(options.selectedWorkspacePath)}`;
  const selectedWorkspaceKey = workspaceIdentityKey(options.selectedWorkspacePath);
  const activeWorkspaces = options.activeWorkspaces ?? [];
  const activeWorkspaceSubmenu: PetMenuItemModel = {
    id: "workspace:active",
    label: labels.activeWorkspaces,
    enabled: activeWorkspaces.length > 0,
    submenu:
      activeWorkspaces.length > 0
        ? activeWorkspaces.slice(0, 10).flatMap((workspace) => {
            const isSelected = workspaceIdentityKey(workspace.workspacePath) === selectedWorkspaceKey;
            return buildActiveWorkspaceDirectItems(workspace, isSelected, language);
          })
        : [{ id: "workspace:active:none", label: labels.noActiveWorkspaces, enabled: false }],
  };
  const workspaceSubmenu: PetMenuItemModel[] = [
    {
      id: "workspace:current",
      label: currentWorkspaceLabel,
      enabled: false,
    },
    ...(options.activeWorkspaces === undefined ? [] : [activeWorkspaceSubmenu]),
    {
      id: "workspace:select",
      label: labels.selectWorkspace,
      action: { type: "select-workspace" },
    },
    ...(options.codexRemoteWorkspaces === undefined
      ? []
      : [
          { id: "workspace:separator:codex-remote", type: "separator" as const },
          {
            id: "workspace:codex-remote",
            label: labels.codexWorkspaces,
            submenu:
              codexDesktopRemoteProjects.length > 0
                ? [
                    {
                      id: "workspace:codex-remote:refresh",
                      label: labels.refreshRemoteProjects,
                      action: { type: "refresh-remote-projects" as const },
                    },
                    { id: "workspace:codex-remote:separator", type: "separator" as const },
                    ...codexDesktopRemoteProjects.slice(0, 20).map((workspace) => ({
                    id: `workspace:codex-remote:${workspace.id}`,
                    label: `${workspace.label ?? `${workspace.id} · ${workspaceDisplayLabel(workspace.path)}`}${
                      workspace.availability === "ssh_discovered"
                        ? language === "zh-CN" ? " · SSH 已发现" : " · SSH discovered"
                        : workspace.availability === "cached_offline"
                          ? language === "zh-CN" ? " · 离线缓存" : " · offline cache"
                          : ""
                    }`,
                    type: "radio" as const,
                    checked: workspaceIdentityKey(workspace.path) === selectedWorkspaceKey,
                    action: {
                      type: "select-codex-workspace" as const,
                      workspaceId: workspace.id,
                      workspacePath: workspace.path,
                    },
                  })),
                  ]
                : [
                    {
                      id: "workspace:codex-remote:refresh",
                      label: labels.refreshRemoteProjects,
                      action: { type: "refresh-remote-projects" as const },
                    },
                    { id: "workspace:codex-remote:none", label: labels.noCodexWorkspaces, enabled: false },
                  ],
          },
        ]),
  ];
  return [
    {
      id: "workspace",
      label: labels.workspace,
      submenu: workspaceSubmenu,
    },
    { id: "new-session", label: newSessionLabel, action: { type: "new-session" } },
    { id: "send-prompt", label: labels.sendPrompt, action: { type: "send-prompt" } },
    {
      id: "recent-sessions",
      label: labels.recentSessions,
      enabled: recentSessions.length > 0,
      submenu:
        recentSessions.length > 0
          ? recentSessions.map((session) => ({
              id: `restore-session:${session.pet_session_id || session.codex_session_id || ""}`,
              label: formatSessionMenuLabel(session, now, language),
              action: { type: "restore-session", petSessionId: String(session.pet_session_id || "") },
            }))
          : [{ id: "no-recent-sessions", label: labels.noRecentSessions, enabled: false }],
    },
    { id: "more-sessions", label: labels.moreSessions, action: { type: "more-sessions" } },
    { id: "separator:settings", type: "separator" },
    {
      id: "interaction-mode",
      label: labels.interactionMode,
      submenu: [
        {
          id: "interaction-mode:window-drag",
          label: labels.dragWholeApp,
          type: "radio",
          checked: options.interactionMode === "window-drag",
          action: { type: "interaction-mode", mode: "window-drag" },
        },
        {
          id: "interaction-mode:camera-adjust",
          label: labels.adjustCamera,
          type: "radio",
          checked: options.interactionMode === "camera-adjust",
          action: { type: "interaction-mode", mode: "camera-adjust" },
        },
      ],
    },
    {
      id: "notification-detail",
      label: labels.notificationDetail,
      submenu: NOTIFICATION_PROFILES.map((profile) => ({
        id: `notification-detail:${profile}`,
        label: PROFILE_LABELS[language][profile],
        type: "radio",
        checked: options.notificationProfile === profile,
        action: { type: "notification-detail", profile },
      })),
    },
    {
      id: "menu-language",
      label: labels.menuLanguage,
      submenu: [
        {
          id: "menu-language:en",
          label: "English",
          type: "radio",
          checked: language === "en",
          action: { type: "menu-language", language: "en" },
        },
        {
          id: "menu-language:zh-CN",
          label: "中文",
          type: "radio",
          checked: language === "zh-CN",
          action: { type: "menu-language", language: "zh-CN" },
        },
      ],
    },
    {
      id: "agent",
      label: labels.agentMenu,
      submenu: PET_AGENTS.map((agentOption) => ({
        id: `agent:${agentOption}`,
        label: PET_AGENT_LABELS[agentOption],
        type: "radio",
        checked: agent === agentOption,
        action: { type: "agent", agent: agentOption },
      })),
    },
    {
      id: "codex-env",
      label: labels.codexEnvMenu,
      submenu: CODEX_ENV_MODES.map((envMode) => ({
        id: `codex-env:${envMode}`,
        label: CODEX_ENV_MODE_LABELS[envMode],
        type: "radio",
        checked: codexEnvMode === envMode,
        action: { type: "codex-env", envMode },
      })),
    },
    {
      id: "codex-launch-target",
      label: labels.codexLaunchTargetMenu,
      submenu: [
        {
          id: "codex-launch-target:vscode-cli",
          label: "VSCode + Codex CLI",
          type: "radio",
          checked: codexLaunchTarget === "vscode-cli",
          action: { type: "codex-launch-target", target: "vscode-cli" },
        },
        {
          id: "codex-launch-target:codex-desktop",
          label: "Codex Desktop",
          type: "radio",
          checked: codexLaunchTarget === "codex-desktop",
          action: { type: "codex-launch-target", target: "codex-desktop" },
        },
      ],
    },
    {
      id: "always-on-top",
      label: labels.alwaysOnTop,
      type: "checkbox",
      checked: alwaysOnTop,
      action: { type: "always-on-top", enabled: !alwaysOnTop },
    },
    { id: "focus-vscode", label: labels.focusVscode, action: { type: "focus-vscode" } },
    {
      id: "sync-main-site",
      label: labels.syncMainSite,
      action: { type: "sync-main-site" },
    },
    { id: "separator:close", type: "separator" },
    { id: "close", label: labels.close, action: { type: "close" } },
  ];
}







