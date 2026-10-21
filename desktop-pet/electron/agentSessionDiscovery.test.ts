import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  scanRecentCodexSessionFiles,
  type CodexSessionFileSummary,
} from "./codexSessionFiles.js";
import {
  discoverLocalCodexSessions,
  discoverLocalClaudeSessions,
  discoverPetAppServerSessions,
  enrichAgentSessionRecords,
  type AgentProcessObservation,
  type PetAppServerSessionScanner,
  type CodexSessionScanner,
} from "./agentSessionDiscovery.js";
import type { ClaudeSessionFileSummary } from "./claudeSessionFiles.js";

function emptyFacts() {
  return {
    failed_commands: [],
    changed_files: [],
    approvals: [],
    errors: [],
    event_counts: {},
    user_messages: [],
    assistant_messages: [],
    function_call_summaries: [],
    work_items: [],
    methods: [],
  };
}

function summary(
  overrides: Partial<CodexSessionFileSummary> = {},
): CodexSessionFileSummary {
  return {
    codexSessionId: "session-1",
    workspacePath: "D:\\workspace\\MMD project",
    filePath: "C:\\Users\\KSG\\.codex\\sessions\\session-1.jsonl",
    firstPromptPreview: "Implement discovery",
    displayTitle: "Implement discovery",
    lastSummary: "Scanning sessions",
    lastOutput: "working",
    lastStatus: "running",
    originator: "codex-tui",
    cliVersion: "0.146.0",
    sessionStartedAt: "2026-08-05T10:00:00.000Z",
    lastEventAt: "2026-08-05T10:02:00.000Z",
    fileModifiedAt: "2026-08-05T10:02:00.000Z",
    reviewFacts: emptyFacts(),
    ...overrides,
  };
}

describe("agent session discovery", () => {
  it("uses the real Codex scanner without filtering to one workspace", async () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "agent-discovery-codex-"));
    const sessionsDir = path.join(codexHome, "sessions", "2026", "08", "05");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const first = path.join(sessionsDir, "rollout-first.jsonl");
    const second = path.join(sessionsDir, "rollout-second.jsonl");
    fs.writeFileSync(
      first,
      `${JSON.stringify({
        type: "session_meta",
        payload: {
          id: "real-1",
          cwd: "D:\\workspace\\MMD project",
          originator: "codex-tui",
          source: "cli",
        },
      })}\n`,
      "utf8",
    );
    fs.writeFileSync(
      second,
      `${JSON.stringify({
        type: "session_meta",
        payload: {
          id: "real-2",
          cwd: "D:\\workspace\\Aether UI",
          originator: "Codex Desktop",
          source: "vscode",
        },
      })}\n`,
      "utf8",
    );

    const snapshot = await discoverLocalCodexSessions({
      codexHome,
      scan: scanRecentCodexSessionFiles,
    });

    expect(snapshot.sessions.map((session) => session.sessionId).sort()).toEqual(["real-1", "real-2"]);
  });

  it("extracts the Codex Desktop sessionID from session_meta as the stable session identity", async () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "agent-discovery-codex-desktop-"));
    const sessionsDir = path.join(codexHome, "sessions", "2026", "08", "05");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const rollout = path.join(sessionsDir, "rollout-desktop.jsonl");
    fs.writeFileSync(
      rollout,
      [
        JSON.stringify({
          timestamp: "2026-08-05T09:57:06.494Z",
          type: "session_meta",
          payload: {
            id: "019fd15a-ae34-76d1-a99c-af48bf7b2ddf",
            cwd: "D:\\workspace\\MMD project",
            originator: "Codex Desktop",
            source: "vscode",
            cli_version: "codex-test/1.0",
          },
        }),
        JSON.stringify({
          timestamp: "2026-08-05T09:58:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Inspect the active Desktop session" }],
          },
        }),
        JSON.stringify({
          timestamp: "2026-08-05T09:59:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "The session is active." }],
          },
        }),
        JSON.stringify({
          timestamp: "2026-08-05T10:00:00.000Z",
          type: "response_item",
          payload: {
            type: "function_call_output",
            output: "session content verified",
          },
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const snapshot = await discoverLocalCodexSessions({
      codexHome,
      limit: 10,
      scan: scanRecentCodexSessionFiles,
      now: () => new Date("2026-08-05T10:00:01.000Z"),
    });

    expect(snapshot.sessions[0]).toMatchObject({
      sessionId: "019fd15a-ae34-76d1-a99c-af48bf7b2ddf",
      runtime: "desktop",
      originator: "Codex Desktop",
      source: "vscode",
      workspacePath: "D:\\workspace\\MMD project",
      firstPromptPreview: "Inspect the active Desktop session",
      lastSummary: "The session is active.",
      lastOutput: "session content verified",
    });
    expect(snapshot.sessions[0]?.sessionKey).toBe(
      "local:codex:019fd15a-ae34-76d1-a99c-af48bf7b2ddf",
    );
  });

  it("discovers all local Codex workspaces without using a workspace filter", async () => {
    const scanner: CodexSessionScanner = (options) => {
      expect(options.workspacePath).toBeUndefined();
      return [
        summary(),
        summary({
          codexSessionId: "session-2",
          workspacePath: "D:\\workspace\\Aether UI",
          filePath: "C:\\Users\\KSG\\.codex\\sessions\\session-2.jsonl",
          originator: "Codex Desktop",
        }),
      ];
    };

    const snapshot = await discoverLocalCodexSessions({
      codexHome: "C:\\Users\\KSG\\.codex",
      wslCodexHome: "\\\\wsl.localhost\\Ubuntu\\home\\ksg\\.codex",
      scan: scanner,
    });

    expect(snapshot.sessions).toHaveLength(2);
    expect(snapshot.sessions.map((session) => session.workspacePath)).toEqual([
      "D:\\workspace\\MMD project",
      "D:\\workspace\\Aether UI",
    ]);
  });

  it("classifies Desktop, CLI, and WSL runtimes from bounded session evidence", async () => {
    const snapshot = await discoverLocalCodexSessions({
      codexHome: "C:\\Users\\KSG\\.codex",
      scan: () => [
        summary({ codexSessionId: "desktop", originator: "Codex Desktop" }),
        summary({
          codexSessionId: "cli",
          originator: "codex_cli_rs",
          filePath: "C:\\Users\\KSG\\.codex\\sessions\\cli.jsonl",
        }),
        summary({
          codexSessionId: "wsl",
          originator: "codex-tui",
          workspacePath: "/mnt/d/workspace/MMD project",
          filePath: "\\\\wsl.localhost\\Ubuntu\\home\\ksg\\.codex\\sessions\\wsl.jsonl",
        }),
      ],
    });

    expect(snapshot.sessions.map((session) => session.runtime)).toEqual([
      "desktop",
      "cli",
      "wsl",
    ]);
    expect(snapshot.sessions[0]?.workspacePath).toBe("D:\\workspace\\MMD project");
  });

  it("deduplicates the same session observed by multiple local sources", async () => {
    const snapshot = await discoverLocalCodexSessions({
      codexHome: "C:\\Users\\KSG\\.codex",
      scan: () => [
        summary(),
        summary({
          filePath: "C:\\Users\\KSG\\.codex\\sessions\\duplicate-copy.jsonl",
          lastOutput: "newer evidence",
          fileModifiedAt: "2026-08-05T10:03:00.000Z",
        }),
      ],
    });

    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0]?.lastOutput).toBe("newer evidence");
    expect(snapshot.sessions[0]?.evidence).toHaveLength(2);
  });

  it("normalizes stale active evidence to idle and discovers Claude through the same registry", async () => {
    const stale: CodexSessionFileSummary = summary({
      codexSessionId: "stale",
      lastEventAt: "2026-08-05T09:00:00.000Z",
      fileModifiedAt: "2026-08-05T09:00:00.000Z",
    });
    const claude: ClaudeSessionFileSummary = {
      claudeSessionId: "claude-1",
      workspacePath: "/mnt/d/workspace/Aether UI",
      filePath: "C:\\Users\\KSG\\.claude\\projects\\aether\\claude-1.jsonl",
      firstPromptPreview: "Review the UI",
      displayTitle: "Review the UI",
      lastSummary: "Inspecting components",
      lastOutput: "working",
      lastStatus: "running",
      gitBranch: "main",
      cliVersion: "1.0.0",
      sessionStartedAt: "2026-08-05T09:00:00.000Z",
      lastEventAt: "2026-08-05T09:59:00.000Z",
      fileModifiedAt: "2026-08-05T09:59:00.000Z",
      reviewFacts: emptyFacts(),
    };

    const codexSnapshot = await discoverLocalCodexSessions({
      codexHome: "C:\\Users\\KSG\\.codex",
      scan: () => [stale],
      now: () => new Date("2026-08-05T10:00:00.000Z"),
    });
    const claudeSnapshot = await discoverLocalClaudeSessions({
      claudeHome: "C:\\Users\\KSG\\.claude",
      scan: (options) => {
        expect(options.workspacePath).toBeUndefined();
        return [claude];
      },
      now: () => new Date("2026-08-05T10:00:00.000Z"),
    });

    expect(codexSnapshot.sessions[0]?.state).toBe("idle");
    expect(claudeSnapshot.sessions[0]).toMatchObject({
      agent: "claude",
      provider: "claude",
      runtime: "cli",
      workspacePath: "D:\\workspace\\Aether UI",
      state: "running",
      gitBranch: "main",
    });
  });

  it("maps Pet app-server lifecycle sessions into the same bounded discovery record", async () => {
    const scan: PetAppServerSessionScanner = async (limit) => {
      expect(limit).toBe(10);
      return [
        {
          id: "codex_sess_runtime",
          workspaceId: "mmd-companion",
          workspacePath: "D:\\workspace\\MMD project",
          status: "waiting_approval",
          createdAt: "2026-08-05T09:50:00.000Z",
          lastActiveAt: "2026-08-05T09:59:00.000Z",
          processId: 4321,
          codexVersion: "codex-test/1.0",
          transport: "stdio",
          sandbox: "read-only",
          mode: "read_only",
          lastOutputPreview: "Need approval",
          error: null,
          metadata: { mode: "read_only" },
        },
      ];
    };

    const snapshot = await discoverPetAppServerSessions({
      limit: 10,
      scan,
      now: () => new Date("2026-08-05T10:00:00.000Z"),
    });

    expect(snapshot.sessions[0]).toMatchObject({
      sessionKey: "local:pet-app-server:codex_sess_runtime",
      provider: "pet-app-server",
      agent: "codex",
      runtime: "app-server",
      workspacePath: "D:\\workspace\\MMD project",
      state: "waiting_approval",
      lastOutput: "Need approval",
    });
    expect(snapshot.sessions[0]?.evidence[0]).toMatchObject({
      source: "pet-app-server",
      sessionFile: null,
    });
  });

  it("only enriches existing sessions with process evidence and marks missing app-server processes disconnected", () => {
    const processEvidence: AgentProcessObservation = {
      pid: 4321,
      processName: "codex",
      provider: "codex",
      runtime: "cli",
      hostId: "local",
      startedAt: "2026-08-05T09:45:00.000Z",
      observedAt: "2026-08-05T10:00:00.000Z",
    };

    const enriched = enrichAgentSessionRecords(
      [
        {
          sessionKey: "local:pet-app-server:runtime-session",
          provider: "pet-app-server",
          agent: "codex",
          runtime: "app-server",
          hostId: "local",
          sessionId: "runtime-session",
          workspacePath: "D:\\workspace\\MMD project",
          displayTitle: "Pet app-server",
          firstPromptPreview: null,
          lastSummary: null,
          lastOutput: null,
          state: "running",
          sessionStartedAt: "2026-08-05T09:50:00.000Z",
          lastEventAt: "2026-08-05T09:59:00.000Z",
          lastActivityAt: "2026-08-05T09:59:00.000Z",
          sessionFile: null,
          processId: 4321,
          processAlive: null,
          processStartedAt: null,
          processName: null,
          processRuntime: null,
          originator: "desktop-pet",
          source: "pet-app-server",
          cliVersion: null,
          gitBranch: null,
          reviewFacts: emptyFacts(),
          evidence: [],
        },
      ],
      [processEvidence],
      { scanCompleted: true },
    );

    expect(enriched[0]).toMatchObject({
      processId: 4321,
      processAlive: true,
      processStartedAt: "2026-08-05T09:45:00.000Z",
      processName: "codex",
      processRuntime: "cli",
      state: "running",
    });
    expect(enriched[0]?.evidence).toContainEqual({
      source: "process",
      sessionFileModifiedAt: "2026-08-05T10:00:00.000Z",
      sessionFile: null,
      processId: 4321,
      processName: "codex",
    });

    const disconnected = enrichAgentSessionRecords(
      enriched,
      [],
      { scanCompleted: true },
    );
    expect(disconnected[0]?.state).toBe("disconnected");
    expect(disconnected[0]?.processAlive).toBe(false);
    expect(
      enrichAgentSessionRecords(
        [{ ...disconnected[0]!, state: "running", processAlive: null }],
        [],
        { scanCompleted: false },
      )[0],
    ).toMatchObject({
      state: "running",
      processAlive: null,
    });
    const reusedPid = enrichAgentSessionRecords(
      [enriched[0]!],
      [{ ...processEvidence, startedAt: "2026-08-05T10:30:00.000Z" }],
      { scanCompleted: true },
    );
    expect(reusedPid[0]).toMatchObject({
      processAlive: false,
      state: "disconnected",
    });
    expect(
      enrichAgentSessionRecords([], [processEvidence], { scanCompleted: true }),
    ).toEqual([]);
  });
});
