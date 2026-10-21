import { describe, expect, it, vi } from "vitest";

import {
  buildCodexDesktopThreadUrl,
  buildCodexDesktopNewThreadUrl,
  launchCodexDesktopExistingSession,
  launchNewCodexDesktopUnboundSession,
  launchNewCodexDesktopSession,
} from "./codexDesktopLauncher.js";

describe("Codex Desktop launcher", () => {
  it("builds a new-thread deeplink that preserves the selected workspace path", () => {
    const url = buildCodexDesktopNewThreadUrl({
      workspacePath: "D:\\workspace\\MMD project\\feature #1 & review",
    });

    const parsed = new URL(url);
    expect(parsed.protocol).toBe("codex:");
    expect(parsed.hostname).toBe("new");
    expect(parsed.searchParams.get("path")).toBe("D:\\workspace\\MMD project\\feature #1 & review");
  });

  it("opens the Codex Desktop new-thread deeplink without sending a prompt", async () => {
    const openExternal = vi.fn(async () => undefined);

    const result = await launchNewCodexDesktopSession({
      workspacePath: "D:\\workspace\\MMD project",
      openExternal,
    });

    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(new URL(openExternal.mock.calls[0][0]).searchParams.get("path")).toBe("D:\\workspace\\MMD project");
    expect(new URL(openExternal.mock.calls[0][0]).searchParams.has("prompt")).toBe(false);
    expect(result).toEqual({
      workspacePath: "D:\\workspace\\MMD project",
      url: openExternal.mock.calls[0][0],
    });
  });

  it("opens the parameterless Codex Desktop new-thread route for remote projects", async () => {
    const openExternal = vi.fn(async () => undefined);

    const result = await launchNewCodexDesktopUnboundSession({ openExternal });

    expect(openExternal).toHaveBeenCalledWith("codex://threads/new");
    expect(result).toEqual({ url: "codex://threads/new" });
  });

  it("builds and opens the Codex Desktop route for an existing thread", async () => {
    const openExternal = vi.fn(async () => undefined);
    const codexSessionId = "7b6c5d4e-3210-4fed-9abc-0123456789ab";

    expect(buildCodexDesktopThreadUrl(codexSessionId)).toBe(`codex://threads/${codexSessionId}`);

    const result = await launchCodexDesktopExistingSession({
      codexSessionId,
      openExternal,
    });

    expect(openExternal).toHaveBeenCalledWith(`codex://threads/${codexSessionId}`);
    expect(result).toEqual({
      codexSessionId,
      url: `codex://threads/${codexSessionId}`,
    });
  });

  it("rejects an empty workspace and propagates protocol launch failures", async () => {
    await expect(
      launchNewCodexDesktopSession({
        workspacePath: " ",
        openExternal: vi.fn(),
      }),
    ).rejects.toThrow("Workspace path is required");

    expect(() => buildCodexDesktopThreadUrl(" ")).toThrow("Codex session ID is required");
    await expect(
      launchCodexDesktopExistingSession({
        codexSessionId: " ",
        openExternal: vi.fn(),
      }),
    ).rejects.toThrow("Codex session ID is required");

    await expect(
      launchNewCodexDesktopSession({
        workspacePath: "D:\\workspace\\MMD project",
        openExternal: vi.fn(async () => {
          throw new Error("No application is registered for codex://");
        }),
      }),
    ).rejects.toThrow("No application is registered for codex://");
  });
});
