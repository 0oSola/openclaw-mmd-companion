import { describe, expect, it, vi } from "vitest";

import { buildRemoteCodexTerminalCommand, launchRemoteCodexSession } from "./remoteCodexCliLauncher.js";

describe("remote Codex CLI launcher", () => {
  it("builds a fixed remote Codex command for an allowed project", () => {
    expect(buildRemoteCodexTerminalCommand({
      sshHost: "macCodex-pet",
      remotePath: "/Users/sola/workspace/MoMask",
    })).toContain("project=$(realpath -- '/Users/sola/workspace/MoMask')");
    expect(buildRemoteCodexTerminalCommand({
      sshHost: "macCodex-pet",
      remotePath: "/Users/sola/workspace/MoMask",
    })).toContain('case "$project" in /Users/sola/workspace/*|/Users/sola/Desktop/kscc/*)');
  });

  it("escapes a single quote in the remote path without using a local shell", () => {
    const spawned: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    const result = launchRemoteCodexSession({
      sshHost: "macCodex-pet",
      remotePath: "/Users/sola/workspace/O'Hara",
      label: "O'Hara",
      spawn: vi.fn((command, args, options) => {
        spawned.push({ command, args, options: options as Record<string, unknown> });
        return { unref: vi.fn() };
      }),
    });

    expect(result.commandLine).toContain("'/Users/sola/workspace/O'\"'\"'Hara'");
    expect(spawned[0]).toMatchObject({ command: "wt.exe", options: { shell: false, detached: true } });
    expect(spawned[0]?.args).toContain("macCodex-pet");
  });

  it("rejects hosts and paths outside the constrained remote project roots", () => {
    expect(() => buildRemoteCodexTerminalCommand({ sshHost: "macCodex;rm", remotePath: "/Users/sola/workspace/MoMask" })).toThrow();
    expect(() => buildRemoteCodexTerminalCommand({ sshHost: "macCodex-pet", remotePath: "/Users/sola/.ssh" })).toThrow("允许的工程目录");
  });
});
