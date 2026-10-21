import { contextBridge, ipcRenderer } from "electron";

const MAX_RENDERER_ERROR_TEXT_LENGTH = 4000;

function truncateRendererErrorText(value: string): string {
  if (value.length <= MAX_RENDERER_ERROR_TEXT_LENGTH) return value;
  return `${value.slice(0, MAX_RENDERER_ERROR_TEXT_LENGTH - 3)}...`;
}

function stringifyRendererValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function serializeRendererError(value: unknown) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateRendererErrorText(value.message),
      stack: value.stack ? truncateRendererErrorText(value.stack) : undefined,
    };
  }
  return {
    message: truncateRendererErrorText(stringifyRendererValue(value)),
  };
}

function reportRendererError(payload: Record<string, unknown>) {
  ipcRenderer.send("pet:renderer-error", payload);
}

window.addEventListener("error", (event) => {
  const error = serializeRendererError(event.error);
  reportRendererError({
    kind: "error",
    message: event.message || error.message,
    filename: event.filename,
    line: event.lineno,
    column: event.colno,
    error,
  });
});

window.addEventListener("unhandledrejection", (event) => {
  reportRendererError({
    kind: "unhandledrejection",
    reason: serializeRendererError(event.reason),
  });
});

contextBridge.exposeInMainWorld("desktopPet", {
  runtimeInfo: () => ipcRenderer.invoke("pet:runtime-info"),
  apiRuntime: {
    get: () => ipcRenderer.invoke("pet:api-runtime:get"),
    retry: () => ipcRenderer.invoke("pet:api-runtime:retry"),
    onChanged: (callback: (status: any) => void) => {
      const listener = (_event: unknown, status: any) => callback(status);
      ipcRenderer.on("pet:api-runtime:changed", listener);
      return () => ipcRenderer.removeListener("pet:api-runtime:changed", listener);
    },
  },
  menu: {
    onShow: (callback: (payload: any) => void) => {
      const listener = (_event: unknown, payload: any) => callback(payload);
      ipcRenderer.on("pet:menu:show", listener);
      return () => ipcRenderer.removeListener("pet:menu:show", listener);
    },
    execute: (action: any) => ipcRenderer.invoke("pet:menu:execute", action),
    close: () => ipcRenderer.send("pet:menu:closed"),
    requestPaint: () => ipcRenderer.send("pet:menu:request-paint"),
    reportReceived: (openedAtMs: number) => ipcRenderer.send("pet:menu:received", { openedAtMs }),
    reportCommitted: (openedAtMs: number) => ipcRenderer.send("pet:menu:committed", { openedAtMs }),
    reportPainted: (openedAtMs: number) => ipcRenderer.send("pet:menu:painted", { openedAtMs }),
    onAction: (callback: (action: any) => void) => {
      const listener = (_event: unknown, action: any) => callback(action);
      ipcRenderer.on("pet:menu:action", listener);
      return () => ipcRenderer.removeListener("pet:menu:action", listener);
    },
  },
  windowDrag: {
    start: () => ipcRenderer.send("pet:window-drag:start"),
    move: () => ipcRenderer.send("pet:window-drag:move"),
    end: () => ipcRenderer.send("pet:window-drag:end"),
  },
  nativeClick: {
    on: (callback: (point: { clientX: number; clientY: number }) => void) => {
      const listener = (_event: unknown, point: { clientX: number; clientY: number }) => callback(point);
      ipcRenderer.on("pet:native-left-click", listener);
      return () => ipcRenderer.removeListener("pet:native-left-click", listener);
    },
  },
  notificationProfile: {
    get: () => ipcRenderer.invoke("pet:notification-profile:get"),
  },
  sessions: {
    restore: (petSessionId: string) => ipcRenderer.invoke("pet:sessions:restore", petSessionId),
    focusActive: (petSessionId: string) => ipcRenderer.invoke("pet:sessions:focus-active", petSessionId),
  },
  prompt: {
    send: (prompt: string) => ipcRenderer.invoke("pet:prompt:send", prompt),
    sendToSession: (options: {
      workspacePath: string;
      petSessionId?: string;
      codexSessionId?: string;
      prompt: string;
    }) => ipcRenderer.invoke("pet:prompt:send-to-session", options),
  },
  vscode: {
    focus: (options?: { workspacePath?: string }) => ipcRenderer.invoke("pet:vscode:focus", options),
  },
  codex: {
    focus: (options?: {
      workspacePath?: string;
      codexSessionId?: string;
      source?: "status" | "approval" | "completion";
    }) =>
      ipcRenderer.invoke("pet:codex:focus", options),
  },
  clipboard: {
    writeText: (text: string) => ipcRenderer.invoke("pet:clipboard:write-text", text),
  },
  codexStatus: {
    get: () => ipcRenderer.invoke("pet:codex-status:get"),
    onChanged: (callback: (status: any) => void) => {
      const listener = (_event: unknown, status: any) => callback(status);
      ipcRenderer.on("pet:codex-status:changed", listener);
      return () => ipcRenderer.removeListener("pet:codex-status:changed", listener);
    },
  },
  completionNotice: {
    status: {
      get: () => ipcRenderer.invoke("pet:completion-notice:status:get"),
      onChanged: (callback: (state: any) => void) => {
        const listener = (_event: unknown, state: any) => callback(state);
        ipcRenderer.on("pet:completion-notice:status:changed", listener);
        return () => ipcRenderer.removeListener("pet:completion-notice:status:changed", listener);
      },
    },
    expand: () => ipcRenderer.invoke("pet:completion-notice:expand"),
    collapse: () => ipcRenderer.invoke("pet:completion-notice:collapse"),
    dismiss: (key: string) => ipcRenderer.invoke("pet:completion-notice:dismiss", key),
    restore: (key: string) => ipcRenderer.invoke("pet:completion-notice:restore", key),
    stop: (key: string) => ipcRenderer.invoke("pet:completion-notice:stop", key),
  },
  agent: {
    get: () => ipcRenderer.invoke("pet:agent:get"),
    onChanged: (callback: (agent: string) => void) => {
      const listener = (_event: unknown, agent: string) => callback(agent);
      ipcRenderer.on("pet:agent:changed", listener);
      return () => ipcRenderer.removeListener("pet:agent:changed", listener);
    },
  },
  codexEnv: {
    get: () => ipcRenderer.invoke("pet:codex-env:get"),
    onChanged: (callback: (envMode: string) => void) => {
      const listener = (_event: unknown, envMode: string) => callback(envMode);
      ipcRenderer.on("pet:codex-env:changed", listener);
      return () => ipcRenderer.removeListener("pet:codex-env:changed", listener);
    },
  },
  interactionMode: {
    get: () => ipcRenderer.invoke("pet:interaction-mode:get"),
    set: (mode: string) => ipcRenderer.invoke("pet:interaction-mode:set", mode),
    onChanged: (callback: (mode: string) => void) => {
      const listener = (_event: unknown, mode: string) => callback(mode);
      ipcRenderer.on("pet:interaction-mode:changed", listener);
      return () => ipcRenderer.removeListener("pet:interaction-mode:changed", listener);
    },
  },
});
