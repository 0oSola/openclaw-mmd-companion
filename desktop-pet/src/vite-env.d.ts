/// <reference types="vite/client" />

declare global {
  interface Window {
    desktopPet: {
      runtimeInfo: () => Promise<{ apiBaseUrl: string; apiRuntimeStatus: DesktopPetApiRuntimeStatus | null }>;
      apiRuntime: {
        get: () => Promise<DesktopPetApiRuntimeStatus | null>;
        retry: () => Promise<DesktopPetApiRuntimeStatus | null>;
        onChanged: (callback: (status: DesktopPetApiRuntimeStatus | null) => void) => () => void;
      };
      menu: {
        onShow: (callback: (payload: DesktopPetContextMenuPayload) => void) => () => void;
        execute: (action: DesktopPetMenuAction) => Promise<boolean>;
        close: () => void;
        requestPaint: () => void;
        reportReceived: (openedAtMs: number) => void;
        reportCommitted: (openedAtMs: number) => void;
        reportPainted: (openedAtMs: number) => void;
        onAction: (callback: (action: DesktopPetMenuAction) => void) => () => void;
      };
      windowDrag: {
        start: () => void;
        move: () => void;
        end: () => void;
      };
      nativeClick: {
        on: (callback: (point: { clientX: number; clientY: number }) => void) => () => void;
      };
      notificationProfile: {
        get: () => Promise<"low" | "medium" | "high">;
      };
      sessions: {
        restore: (petSessionId: string) => Promise<boolean>;
        focusActive: (petSessionId: string) => Promise<boolean>;
      };
      prompt: {
        send: (prompt: string) => Promise<boolean>;
        sendToSession: (options: DesktopPetPromptSessionOptions) => Promise<DesktopPetCompletionNoticeActionResult>;
      };
      vscode: {
        focus: (options?: { workspacePath?: string }) => Promise<boolean>;
      };
      codex: {
        focus: (options?: {
          workspacePath?: string;
          codexSessionId?: string;
          source?: "status" | "approval" | "completion";
        }) => Promise<boolean>;
      };
      codexStatus: {
        get: () => Promise<DesktopPetCodexStatus>;
        onChanged: (callback: (status: DesktopPetCodexStatus) => void) => () => void;
      };
      completionNotice: {
        status: {
          get: () => Promise<DesktopPetCompletionNoticeWindowState | null>;
          onChanged: (callback: (state: DesktopPetCompletionNoticeWindowState) => void) => () => void;
        };
        expand: () => Promise<boolean>;
        collapse: () => Promise<boolean>;
        dismiss: (key: string) => Promise<boolean>;
        restore: (key: string) => Promise<DesktopPetCompletionNoticeActionResult>;
        stop: (key: string) => Promise<DesktopPetCompletionNoticeActionResult>;
      };
      interactionMode: {
        get: () => Promise<"window-drag" | "camera-adjust">;
        set: (mode: "window-drag" | "camera-adjust") => Promise<"window-drag" | "camera-adjust">;
        onChanged: (callback: (mode: "window-drag" | "camera-adjust") => void) => () => void;
      };
      agent: {
        get: () => Promise<DesktopPetAgent>;
        onChanged: (callback: (agent: DesktopPetAgent) => void) => () => void;
      };
      codexEnv: {
        get: () => Promise<DesktopPetCodexEnvMode>;
        onChanged: (callback: (envMode: DesktopPetCodexEnvMode) => void) => () => void;
      };
      clipboard: {
        writeText: (text: string) => Promise<boolean>;
      };
    };
  }
}

type DesktopPetAgent = "codex" | "claude";
type DesktopPetCodexEnvMode = "win" | "wsl";

type DesktopPetMenuItem = {
  id: string;
  label?: string;
  type?: "normal" | "separator" | "radio" | "checkbox";
  checked?: boolean;
  enabled?: boolean;
  action?: DesktopPetMenuAction;
  submenu?: DesktopPetMenuItem[];
};

type DesktopPetContextMenuPayload = {
  items: DesktopPetMenuItem[];
  position: { x: number; y: number };
  openedAtMs: number;
};

type DesktopPetMenuAction =
  | { type: "select-workspace" }
  | { type: "switch-workspace"; workspacePath: string }
  | { type: "workspace-selected"; workspacePath: string }
  | { type: "new-session" }
  | { type: "send-prompt" }
  | { type: "prompt-sent"; source?: "terminal" }
  | { type: "restore-session"; petSessionId: string }
  | { type: "focus-active-session"; petSessionId: string }
  | { type: "more-sessions"; sessions?: DesktopPetSession[] }
  | { type: "interaction-mode"; mode: "window-drag" | "camera-adjust" }
  | { type: "notification-detail"; profile: "low" | "medium" | "high" }
  | { type: "menu-language"; language: "en" | "zh-CN" }
  | { type: "agent"; agent: DesktopPetAgent }
  | { type: "codex-env"; envMode: DesktopPetCodexEnvMode }
  | { type: "always-on-top"; enabled: boolean }
  | { type: "focus-vscode" }
  | { type: "sync-main-site" }
  | { type: "close" };

type DesktopPetCodexStatus = {
  state:
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
  workspacePath?: string;
  sessionTitle?: string;
  codexSessionId?: string;
  completionNoticeKey?: string;
  lastOutput?: string;
  error?: string;
  updatedAt?: string;
  commandLine?: string;
  source?: "codex-jsonl" | "claude-jsonl" | "app-server" | "terminal";
};

type DesktopPetCompletionNotice = {
  key: string;
  title: string;
  workspaceLabel: string;
  taskLabel?: string;
  outputLines: string[];
  workspacePath: string;
  petSessionId?: string;
  codexSessionId?: string;
  stopSupported: boolean;
};

type DesktopPetCompletionNoticeWindowState = {
  notices: DesktopPetCompletionNotice[];
  expanded: boolean;
};

type DesktopPetCompletionNoticeActionResult =
  | boolean
  | {
      ok: boolean;
      message?: string;
      mode?: string;
      reason?: string;
    };

type DesktopPetPromptSessionOptions = {
  workspacePath: string;
  petSessionId?: string;
  codexSessionId?: string;
  prompt: string;
};

type DesktopPetApiRuntimeStatus = {
  state: "available" | "unavailable";
  available: boolean;
  apiBaseUrl: string;
  healthUrl: string;
  attempts: number;
  started: boolean;
  checkedAt: string;
  autostart: {
    enabled: boolean;
    attempted: boolean;
    reason?: "disabled" | "missing_command" | "spawn_failed";
    command?: string;
    error?: string;
  };
  logPaths?: {
    stdout: string;
    stderr: string;
  };
  statusCode?: number;
  reason?: "fetch_failed" | "bad_status";
  error?: string;
};

type DesktopPetSession = {
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

export {};
