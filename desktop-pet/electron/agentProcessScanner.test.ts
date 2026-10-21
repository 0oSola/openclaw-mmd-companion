import { describe, expect, it } from "vitest";

import {
  createWindowsAgentProcessScanner,
} from "./agentProcessScanner.js";

describe("agent process scanner", () => {
  it("parses supported processes without inspecting command lines", async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    const scan = createWindowsAgentProcessScanner({
      platform: "win32",
      now: () => new Date("2026-08-05T10:00:00.000Z"),
      execFile: async (file, args) => {
        calls.push({ file, args });
        return {
          stdout: JSON.stringify([
            { ProcessName: "ChatGPT", Id: 1001, StartTime: "2026-08-05T09:00:00.000Z" },
            { ProcessName: "codex", Id: 1002, StartTime: null },
            { ProcessName: "claude", Id: 1003, StartTime: "2026-08-05T09:30:00.000Z" },
            { ProcessName: "codex-code-mode-host", Id: 1004, StartTime: null },
          ]),
          stderr: "",
        };
      },
    });

    await expect(scan()).resolves.toEqual([
      {
        pid: 1001,
        processName: "ChatGPT",
        provider: "codex",
        runtime: "desktop",
        hostId: "local",
        startedAt: "2026-08-05T09:00:00.000Z",
        observedAt: "2026-08-05T10:00:00.000Z",
      },
      {
        pid: 1002,
        processName: "codex",
        provider: "codex",
        runtime: "cli",
        hostId: "local",
        startedAt: null,
        observedAt: "2026-08-05T10:00:00.000Z",
      },
      {
        pid: 1003,
        processName: "claude",
        provider: "claude",
        runtime: "cli",
        hostId: "local",
        startedAt: "2026-08-05T09:30:00.000Z",
        observedAt: "2026-08-05T10:00:00.000Z",
      },
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.file).toBe("powershell.exe");
    expect(calls[0]?.args.join(" ")).not.toMatch(/CommandLine|Win32_Process/i);
  });

  it("returns no observations outside Windows and propagates command failures", async () => {
    const nonWindowsScan = createWindowsAgentProcessScanner({
      platform: "linux",
      execFile: async () => {
        throw new Error("should not run");
      },
    });
    await expect(nonWindowsScan()).resolves.toEqual([]);

    const failingScan = createWindowsAgentProcessScanner({
      platform: "win32",
      execFile: async () => {
        throw new Error("powershell unavailable");
      },
    });
    await expect(failingScan()).rejects.toThrow("powershell unavailable");
  });
});
