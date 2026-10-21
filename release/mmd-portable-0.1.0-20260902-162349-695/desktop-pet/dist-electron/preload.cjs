"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const MAX_RENDERER_ERROR_TEXT_LENGTH = 4000;
function truncateRendererErrorText(value) {
    if (value.length <= MAX_RENDERER_ERROR_TEXT_LENGTH)
        return value;
    return `${value.slice(0, MAX_RENDERER_ERROR_TEXT_LENGTH - 3)}...`;
}
function stringifyRendererValue(value) {
    if (typeof value === "string")
        return value;
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
function serializeRendererError(value) {
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
function reportRendererError(payload) {
    electron_1.ipcRenderer.send("pet:renderer-error", payload);
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
electron_1.contextBridge.exposeInMainWorld("desktopPet", {
    runtimeInfo: () => electron_1.ipcRenderer.invoke("pet:runtime-info"),
    apiRuntime: {
        get: () => electron_1.ipcRenderer.invoke("pet:api-runtime:get"),
        retry: () => electron_1.ipcRenderer.invoke("pet:api-runtime:retry"),
        onChanged: (callback) => {
            const listener = (_event, status) => callback(status);
            electron_1.ipcRenderer.on("pet:api-runtime:changed", listener);
            return () => electron_1.ipcRenderer.removeListener("pet:api-runtime:changed", listener);
        },
    },
    menu: {
        onShow: (callback) => {
            const listener = (_event, payload) => callback(payload);
            electron_1.ipcRenderer.on("pet:menu:show", listener);
            return () => electron_1.ipcRenderer.removeListener("pet:menu:show", listener);
        },
        execute: (action) => electron_1.ipcRenderer.invoke("pet:menu:execute", action),
        close: () => electron_1.ipcRenderer.send("pet:menu:closed"),
        requestPaint: () => electron_1.ipcRenderer.send("pet:menu:request-paint"),
        reportReceived: (openedAtMs) => electron_1.ipcRenderer.send("pet:menu:received", { openedAtMs }),
        reportCommitted: (openedAtMs) => electron_1.ipcRenderer.send("pet:menu:committed", { openedAtMs }),
        reportPainted: (openedAtMs) => electron_1.ipcRenderer.send("pet:menu:painted", { openedAtMs }),
        onAction: (callback) => {
            const listener = (_event, action) => callback(action);
            electron_1.ipcRenderer.on("pet:menu:action", listener);
            return () => electron_1.ipcRenderer.removeListener("pet:menu:action", listener);
        },
    },
    windowDrag: {
        start: () => electron_1.ipcRenderer.send("pet:window-drag:start"),
        move: () => electron_1.ipcRenderer.send("pet:window-drag:move"),
        end: () => electron_1.ipcRenderer.send("pet:window-drag:end"),
    },
    nativeClick: {
        on: (callback) => {
            const listener = (_event, point) => callback(point);
            electron_1.ipcRenderer.on("pet:native-left-click", listener);
            return () => electron_1.ipcRenderer.removeListener("pet:native-left-click", listener);
        },
    },
    notificationProfile: {
        get: () => electron_1.ipcRenderer.invoke("pet:notification-profile:get"),
    },
    sessions: {
        restore: (petSessionId) => electron_1.ipcRenderer.invoke("pet:sessions:restore", petSessionId),
        focusActive: (petSessionId) => electron_1.ipcRenderer.invoke("pet:sessions:focus-active", petSessionId),
    },
    prompt: {
        send: (prompt) => electron_1.ipcRenderer.invoke("pet:prompt:send", prompt),
        sendToSession: (options) => electron_1.ipcRenderer.invoke("pet:prompt:send-to-session", options),
    },
    vscode: {
        focus: (options) => electron_1.ipcRenderer.invoke("pet:vscode:focus", options),
    },
    codex: {
        focus: (options) => electron_1.ipcRenderer.invoke("pet:codex:focus", options),
    },
    clipboard: {
        writeText: (text) => electron_1.ipcRenderer.invoke("pet:clipboard:write-text", text),
    },
    codexStatus: {
        get: () => electron_1.ipcRenderer.invoke("pet:codex-status:get"),
        onChanged: (callback) => {
            const listener = (_event, status) => callback(status);
            electron_1.ipcRenderer.on("pet:codex-status:changed", listener);
            return () => electron_1.ipcRenderer.removeListener("pet:codex-status:changed", listener);
        },
    },
    completionNotice: {
        status: {
            get: () => electron_1.ipcRenderer.invoke("pet:completion-notice:status:get"),
            onChanged: (callback) => {
                const listener = (_event, state) => callback(state);
                electron_1.ipcRenderer.on("pet:completion-notice:status:changed", listener);
                return () => electron_1.ipcRenderer.removeListener("pet:completion-notice:status:changed", listener);
            },
        },
        expand: () => electron_1.ipcRenderer.invoke("pet:completion-notice:expand"),
        collapse: () => electron_1.ipcRenderer.invoke("pet:completion-notice:collapse"),
        dismiss: (key) => electron_1.ipcRenderer.invoke("pet:completion-notice:dismiss", key),
        restore: (key) => electron_1.ipcRenderer.invoke("pet:completion-notice:restore", key),
        stop: (key) => electron_1.ipcRenderer.invoke("pet:completion-notice:stop", key),
    },
    agent: {
        get: () => electron_1.ipcRenderer.invoke("pet:agent:get"),
        onChanged: (callback) => {
            const listener = (_event, agent) => callback(agent);
            electron_1.ipcRenderer.on("pet:agent:changed", listener);
            return () => electron_1.ipcRenderer.removeListener("pet:agent:changed", listener);
        },
    },
    codexEnv: {
        get: () => electron_1.ipcRenderer.invoke("pet:codex-env:get"),
        onChanged: (callback) => {
            const listener = (_event, envMode) => callback(envMode);
            electron_1.ipcRenderer.on("pet:codex-env:changed", listener);
            return () => electron_1.ipcRenderer.removeListener("pet:codex-env:changed", listener);
        },
    },
    interactionMode: {
        get: () => electron_1.ipcRenderer.invoke("pet:interaction-mode:get"),
        set: (mode) => electron_1.ipcRenderer.invoke("pet:interaction-mode:set", mode),
        onChanged: (callback) => {
            const listener = (_event, mode) => callback(mode);
            electron_1.ipcRenderer.on("pet:interaction-mode:changed", listener);
            return () => electron_1.ipcRenderer.removeListener("pet:interaction-mode:changed", listener);
        },
    },
});
