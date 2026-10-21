import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Electron preload module format", () => {
  it("uses a CommonJS preload file because Electron loads preload scripts outside ESM", () => {
    const electronDir = path.resolve(__dirname);
    const mainSource = readFileSync(path.join(electronDir, "main.ts"), "utf8");

    expect(existsSync(path.join(electronDir, "preload.cts"))).toBe(true);
    expect(mainSource).toContain('path.join(__dirname, "preload.cjs")');
  });

  it("exposes a prompt sender through the protected preload bridge", () => {
    const preloadSource = readFileSync(path.resolve(__dirname, "preload.cts"), "utf8");

    expect(preloadSource).toContain("prompt:");
    expect(preloadSource).toContain('"pet:prompt:send"');
  });

  it("exposes VSCode focus through the protected preload bridge", () => {
    const preloadSource = readFileSync(path.resolve(__dirname, "preload.cts"), "utf8");
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");

    expect(preloadSource).toContain("vscode:");
    expect(preloadSource).toContain("focus: (options");
    expect(preloadSource).toContain('"pet:vscode:focus"');
    expect(preloadSource).toContain("ipcRenderer.invoke(\"pet:vscode:focus\", options)");
    expect(mainSource).toContain('"pet:vscode:focus"');
    expect(mainSource).toContain("requestedWorkspacePath");
  });

  it("exposes target-aware Codex session focus through the protected preload bridge", () => {
    const preloadSource = readFileSync(path.resolve(__dirname, "preload.cts"), "utf8");
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");

    expect(preloadSource).toContain("codex:");
    expect(preloadSource).toContain('"pet:codex:focus"');
    expect(mainSource).toContain('"pet:codex:focus"');
  });

  it("exposes the completion-notice controls and session-bound follow-up fields through the protected preload bridge", () => {
    const preloadSource = readFileSync(path.resolve(__dirname, "preload.cts"), "utf8");
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const followUpHandlerBlock = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("pet:prompt:send-to-session"'),
      mainSource.indexOf('ipcMain.on("pet:renderer-error"'),
    );

    expect(preloadSource).toContain("completionNotice:");
    expect(preloadSource).toContain('"pet:completion-notice:status:get"');
    expect(preloadSource).toContain('"pet:completion-notice:status:changed"');
    expect(preloadSource).toContain('"pet:completion-notice:expand"');
    expect(preloadSource).toContain('"pet:completion-notice:collapse"');
    expect(preloadSource).toContain('"pet:completion-notice:dismiss"');
    expect(preloadSource).toContain('"pet:completion-notice:restore"');
    expect(preloadSource).toContain('"pet:completion-notice:stop"');
    expect(preloadSource).toContain("sendToSession: (options: {");
    expect(preloadSource).toContain("workspacePath: string;");
    expect(preloadSource).toContain("petSessionId?: string;");
    expect(preloadSource).toContain("codexSessionId?: string;");
    expect(preloadSource).toContain('ipcRenderer.invoke("pet:prompt:send-to-session", options)');
    expect(mainSource).toContain('ipcMain.handle("pet:prompt:send-to-session"');
    expect(followUpHandlerBlock).toContain("completionNoticeSenderIsCurrent(event)");
    expect(followUpHandlerBlock).toContain("normalizeWorkspacePathIdentity(workspacePath)");
    expect(followUpHandlerBlock).toContain("clipboard.writeText(promptText)");
    expect(followUpHandlerBlock).toContain('return { ok: true, mode: "copy-only" }');
  });

  it("exposes active session focus through the protected preload bridge", () => {
    const preloadSource = readFileSync(path.resolve(__dirname, "preload.cts"), "utf8");
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");

    expect(preloadSource).toContain("focusActive: (petSessionId: string)");
    expect(preloadSource).toContain('"pet:sessions:focus-active"');
    expect(mainSource).toContain('"pet:sessions:focus-active"');
  });

  it("forwards renderer JavaScript errors to the main crash diagnostics log", () => {
    const preloadSource = readFileSync(path.resolve(__dirname, "preload.cts"), "utf8");
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");

    expect(preloadSource).toContain('"pet:renderer-error"');
    expect(preloadSource).toContain('window.addEventListener("error"');
    expect(preloadSource).toContain('window.addEventListener("unhandledrejection"');
    expect(mainSource).toContain('ipcMain.on("pet:renderer-error"');
  });

  it("exposes API runtime retry and change events through the protected preload bridge", () => {
    const preloadSource = readFileSync(path.resolve(__dirname, "preload.cts"), "utf8");

    expect(preloadSource).toContain("apiRuntime:");
    expect(preloadSource).toContain('"pet:api-runtime:get"');
    expect(preloadSource).toContain('"pet:api-runtime:retry"');
    expect(preloadSource).toContain('"pet:api-runtime:changed"');
  });
});
