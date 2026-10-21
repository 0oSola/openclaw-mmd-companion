import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildDesktopPetSessionPayload,
  inferCodexSessionStatus,
  parseCodexSessionFile,
  resolveCodexHome,
  scanRecentCodexSessionFiles,
} from "./codexSessionFiles";

function writeSessionFile(lines: unknown[], filename = "rollout-2026-06-03T19-15-45-session.jsonl") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-pet-codex-session-"));
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, lines.map((line) => JSON.stringify(line)).join("\n"), "utf8");
  return filePath;
}

function fileStartedAtFallback(filePath: string): string {
  const stat = fs.statSync(filePath);
  return (stat.birthtime.getTime() > 0 ? stat.birthtime : stat.ctime).toISOString();
}

function sessionMeta(id = "019e88e4-4f27-7f20-be48-fd1ef50e9492") {
  return {
    timestamp: "2026-06-03T11:15:48.235Z",
    type: "session_meta",
    payload: {
      id,
      timestamp: "2026-06-03T11:15:45.059Z",
      cwd: "D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet",
      originator: "codex-tui",
      cli_version: "0.135.0",
      source: "cli",
    },
  };
}

describe("desktop pet Codex session files", () => {
  it("resolves CODEX_HOME with platform defaults", () => {
    expect(resolveCodexHome({ CODEX_HOME: "D:\\codex-home" }, "win32")).toBe("D:\\codex-home");
    expect(resolveCodexHome({ USERPROFILE: "C:\\Users\\KSG" }, "win32")).toBe("C:\\Users\\KSG\\.codex");
    expect(resolveCodexHome({ HOME: "/home/ksg" }, "linux")).toBe("/home/ksg/.codex");
  });

  it("parses a Codex JSONL transcript into bounded desktop-pet session metadata", () => {
    const filePath = writeSessionFile([
      sessionMeta(),
      {
        timestamp: "2026-06-03T11:15:48.257Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "# AGENTS.md instructions for D:\\workspace\\MMD project" }],
        },
      },
      {
        timestamp: "2026-06-03T11:15:48.260Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "The following is the Codex agent history whose result needs review." }],
        },
      },
      {
        timestamp: "2026-06-03T11:15:48.264Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "<recommended_plugins>\nHere is a list of plugins..." }],
        },
      },
      {
        timestamp: "2026-06-03T11:15:48.267Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "只做状态/提醒，预留直接发 prompt、查看摘要、处理审批",
        },
      },
      {
        timestamp: "2026-06-03T11:15:55.848Z",
        type: "response_item",
        payload: { type: "function_call", name: "shell_command" },
      },
      {
        timestamp: "2026-06-03T11:15:56.929Z",
        type: "response_item",
        payload: { type: "function_call_output", call_id: "call-1", output: "Exit code: 0" },
      },
      {
        timestamp: "2026-06-03T11:16:15.587Z",
        type: "event_msg",
        payload: { type: "agent_message", message: "已补上状态同步。" },
      },
      {
        timestamp: "2026-06-03T11:16:15.655Z",
        type: "event_msg",
        payload: { type: "task_complete" },
      },
    ]);

    const summary = parseCodexSessionFile(filePath);
    const payload = buildDesktopPetSessionPayload(summary, "C:\\Users\\KSG\\.codex");

    expect(summary).toMatchObject({
      codexSessionId: "019e88e4-4f27-7f20-be48-fd1ef50e9492",
      workspacePath: "D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet",
      firstPromptPreview: "只做状态/提醒，预留直接发 prompt、查看摘要、处理审批",
      lastStatus: "completed",
      lastSummary: "已补上状态同步。",
      lastOutput: "已补上状态同步。",
      sessionStartedAt: "2026-06-03T11:15:48.235Z",
    });
    expect(payload).toMatchObject({
      pet_session_id: "codex:019e88e4-4f27-7f20-be48-fd1ef50e9492",
      codex_session_id: "019e88e4-4f27-7f20-be48-fd1ef50e9492",
      codex_home: "C:\\Users\\KSG\\.codex",
      display_title: "只做状态/提醒，预留直接发 prompt、查看摘要、处理审批",
      first_prompt_preview: "只做状态/提醒，预留直接发 prompt、查看摘要、处理审批",
      last_status: "completed",
      launch_mode: "workspace-write",
    });
    expect(payload.metadata).toMatchObject({
      source: "codex-jsonl",
      session_parser_version: "codex-jsonl-stream-v2",
      review_facts_version: "codex-review-facts-v2",
      session_file: filePath,
      session_started_at: "2026-06-03T11:15:48.235Z",
      originator: "codex-tui",
    });
  });

  it("falls back to file creation metadata when the transcript has no event timestamp", () => {
    const filePath = writeSessionFile([{ ...sessionMeta(), timestamp: undefined }]);

    expect(parseCodexSessionFile(filePath).sessionStartedAt).toBe(fileStartedAtFallback(filePath));
  });

  it("extracts the latest command output for the desktop status card", () => {
    const filePath = writeSessionFile([
      sessionMeta(),
      {
        timestamp: "2026-06-03T11:15:55.848Z",
        type: "response_item",
        payload: { type: "function_call", name: "shell_command" },
      },
      {
        timestamp: "2026-06-03T11:15:56.929Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-1",
          output: "line one\nline two\nline three\nline four",
        },
      },
    ]);

    const summary = parseCodexSessionFile(filePath);
    const payload = buildDesktopPetSessionPayload(summary, "C:\\Users\\KSG\\.codex");

    expect(summary).toMatchObject({
      lastStatus: "running",
      lastSummary: null,
      lastOutput: "line one\nline two\nline three\nline four",
    });
    expect(payload.metadata).toMatchObject({
      last_output: "line one\nline two\nline three\nline four",
    });
  });

  it("extracts bounded review facts from Codex JSONL events", () => {
    const filePath = writeSessionFile([
      sessionMeta(),
      {
        timestamp: "2026-06-03T11:15:48.267Z",
        type: "event_msg",
        payload: { type: "user_message", message: "Implement OpenClaw review sync" },
      },
      {
        timestamp: "2026-06-03T11:15:55.848Z",
        type: "response_item",
        payload: { type: "function_call", name: "shell_command", arguments: { command: "npm run build" } },
      },
      {
        timestamp: "2026-06-03T11:15:56.929Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-1",
          output: "Process exited with code 1\nschema mismatch\nSECRET_TOKEN=should-not-leak",
        },
      },
      {
        timestamp: "2026-06-03T11:16:00.000Z",
        type: "event_msg",
        payload: { type: "file_change", path: "api/app/routes/desktop_pet.py" },
      },
      {
        timestamp: "2026-06-03T11:16:01.000Z",
        type: "event_msg",
        payload: { type: "approval_request", message: "Allow command npm test?" },
      },
      {
        timestamp: "2026-06-03T11:16:02.000Z",
        type: "event_msg",
        payload: { type: "turn_failed", message: "OpenClaw returned invalid JSON" },
      },
    ]);

    const summary = parseCodexSessionFile(filePath);
    const payload = buildDesktopPetSessionPayload(summary, "C:\\Users\\KSG\\.codex");

    expect(payload.metadata.facts).toMatchObject({
      failed_commands: [
        {
          command: "npm run build",
          exit_code: 1,
          excerpt: "Process exited with code 1\nschema mismatch\nSECRET_TOKEN=[redacted]",
        },
      ],
      changed_files: ["api/app/routes/desktop_pet.py"],
      approvals: [{ title: "Allow command npm test?" }],
      errors: [{ type: "turn_failed", excerpt: "OpenClaw returned invalid JSON" }],
      event_counts: {
        user_message: 1,
        function_call: 1,
        function_call_output: 1,
        file_change: 1,
        approval_request: 1,
        turn_failed: 1,
      },
      work_items: [
        {
          kind: "goal",
          source: "user",
          text: "Implement OpenClaw review sync",
          timestamp: "2026-06-03T11:15:48.267Z",
        },
        {
          kind: "file_change",
          source: "event",
          text: "api/app/routes/desktop_pet.py",
          timestamp: "2026-06-03T11:16:00.000Z",
        },
        {
          kind: "approval",
          source: "event",
          text: "Allow command npm test?",
          timestamp: "2026-06-03T11:16:01.000Z",
        },
        {
          kind: "error",
          source: "event",
          text: "OpenClaw returned invalid JSON",
          timestamp: "2026-06-03T11:16:02.000Z",
        },
      ],
      methods: [
        {
          kind: "check",
          name: "shell_command",
          command: "npm run build",
          outcome: "failed",
          exit_code: 1,
          excerpt: "Process exited with code 1\nschema mismatch\nSECRET_TOKEN=[redacted]",
          timestamp: "2026-06-03T11:15:55.848Z",
        },
        {
          kind: "approval",
          name: "approval",
          command: null,
          outcome: "pending",
          exit_code: null,
          excerpt: "Allow command npm test?",
          timestamp: "2026-06-03T11:16:01.000Z",
        },
      ],
    });
  });

  it("extracts current custom tool calls, correlates interleaved outputs by call_id, and indexes patch files", () => {
    const patchPath = "D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet\\api\\app\\routes\\desktop_pet.py";
    const filePath = writeSessionFile([
      sessionMeta(),
      {
        timestamp: "2026-07-14T08:00:00.000Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          call_id: "call-build",
          name: "exec",
          status: "completed",
          input: 'const r = await tools.exec_command({cmd:"npm run build"}); text(r.output);',
        },
      },
      {
        timestamp: "2026-07-14T08:00:01.000Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          call_id: "call-test",
          name: "exec",
          status: "completed",
          input: 'const r = await tools.exec_command({cmd:"npm test"}); text(r.output);',
        },
      },
      {
        timestamp: "2026-07-14T08:00:02.000Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call_output",
          call_id: "call-build",
          output: [{ type: "input_text", text: "Exit code: 1\nbuild failed" }],
        },
      },
      {
        timestamp: "2026-07-14T08:00:03.000Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call_output",
          call_id: "call-test",
          output: [{ type: "input_text", text: "Script completed\nAll tests passed" }],
        },
      },
      {
        timestamp: "2026-07-14T08:00:04.000Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          call_id: "call-patch",
          name: "apply_patch",
          status: "completed",
          input: `*** Begin Patch\n*** Update File: ${patchPath}\n@@\n-old\n+new\n*** End Patch`,
        },
      },
      {
        timestamp: "2026-07-14T08:00:05.000Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call_output",
          call_id: "call-patch",
          output: [{ type: "input_text", text: "Done!" }],
        },
      },
    ]);

    const summary = parseCodexSessionFile(filePath);

    expect(summary.lastOutput).toBe("Done!");
    expect(summary.reviewFacts.event_counts).toMatchObject({
      custom_tool_call: 3,
      custom_tool_call_output: 3,
    });
    expect(summary.reviewFacts.changed_files).toEqual(["api/app/routes/desktop_pet.py"]);
    expect(summary.reviewFacts.function_call_summaries).toEqual([
      { name: "exec", command: "npm run build" },
      { name: "exec", command: "npm test" },
      { name: "apply_patch", command: null },
    ]);
    expect(summary.reviewFacts.failed_commands).toEqual([
      { command: "npm run build", exit_code: 1, excerpt: "Exit code: 1\nbuild failed" },
    ]);
    expect(summary.reviewFacts.methods).toEqual([
      {
        kind: "check",
        name: "exec",
        command: "npm run build",
        outcome: "failed",
        exit_code: 1,
        excerpt: "Exit code: 1\nbuild failed",
        timestamp: "2026-07-14T08:00:00.000Z",
      },
      {
        kind: "check",
        name: "exec",
        command: "npm test",
        outcome: "success",
        exit_code: null,
        excerpt: "Script completed\nAll tests passed",
        timestamp: "2026-07-14T08:00:01.000Z",
      },
      {
        kind: "file_operation",
        name: "apply_patch",
        command: null,
        outcome: "success",
        exit_code: null,
        excerpt: "Done!",
        timestamp: "2026-07-14T08:00:04.000Z",
      },
    ]);
  });

  it("streams the complete JSONL file so middle events are retained despite legacy tiny window options", () => {
    const filePath = writeSessionFile([
      sessionMeta(),
      {
        timestamp: "2026-07-14T08:10:00.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "Capture the middle validation command" },
      },
      {
        timestamp: "2026-07-14T08:10:01.000Z",
        type: "event_msg",
        payload: { type: "reasoning", message: "x".repeat(4096) },
      },
      {
        timestamp: "2026-07-14T08:10:02.000Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          call_id: "call-middle",
          name: "exec",
          status: "completed",
          input: 'const r = await tools.exec_command({cmd:"python imgToAction/tools/motion_acceptance_gate.py joints.json"}); text(r.output);',
        },
      },
      {
        timestamp: "2026-07-14T08:10:03.000Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call_output",
          call_id: "call-middle",
          output: [{ type: "input_text", text: "Script completed\nG1-G14 passed" }],
        },
      },
      {
        timestamp: "2026-07-14T08:10:04.000Z",
        type: "event_msg",
        payload: { type: "reasoning", message: "y".repeat(4096) },
      },
      {
        timestamp: "2026-07-14T08:10:05.000Z",
        type: "event_msg",
        payload: { type: "agent_message", message: "Validation complete." },
      },
    ]);

    const summary = parseCodexSessionFile(filePath, {
      chunkBytes: 37,
      maxHeadBytes: 1,
      maxTailBytes: 1,
    });

    expect(summary.firstPromptPreview).toBe("Capture the middle validation command");
    expect(summary.lastSummary).toBe("Validation complete.");
    expect(summary.reviewFacts.event_counts).toMatchObject({
      custom_tool_call: 1,
      custom_tool_call_output: 1,
    });
    expect(summary.reviewFacts.methods).toContainEqual(
      expect.objectContaining({
        name: "exec",
        command: "python imgToAction/tools/motion_acceptance_gate.py joints.json",
        outcome: "success",
      }),
    );
  });

  it("infers active command and approval states from tail events", () => {
    expect(inferCodexSessionStatus([])).toBe("running");

    expect(
      inferCodexSessionStatus([
        { type: "event_msg", payload: { type: "user_message", message: "继续" } },
      ]),
    ).toBe("running");

    expect(
      inferCodexSessionStatus([
        { type: "response_item", payload: { type: "function_call", name: "shell_command" } },
      ]),
    ).toBe("command_running");

    expect(
      inferCodexSessionStatus([
        { type: "response_item", payload: { type: "custom_tool_call", name: "exec" } },
      ]),
    ).toBe("command_running");

    expect(
      inferCodexSessionStatus([
        { type: "response_item", payload: { type: "custom_tool_call_output", call_id: "call-1" } },
      ]),
    ).toBe("running");

    expect(
      inferCodexSessionStatus([
        { type: "event_msg", payload: { type: "approval_request", message: "Allow command?" } },
      ]),
    ).toBe("waiting_approval");

    expect(
      inferCodexSessionStatus([
        { type: "event_msg", payload: { type: "file_change", path: "desktop-pet/src/App.tsx" } },
      ]),
    ).toBe("file_changed");

    expect(
      inferCodexSessionStatus([
        { type: "event_msg", payload: { type: "agent_message", message: "完成。" } },
        { type: "event_msg", payload: { type: "task_complete" } },
      ]),
    ).toBe("completed");

    expect(
      inferCodexSessionStatus([
        { type: "event_msg", payload: { type: "turn_failed", message: "failed" } },
      ]),
    ).toBe("failed");

    expect(
      inferCodexSessionStatus([
        { type: "event_msg", payload: { type: "process_exit", message: "codex exited" } },
      ]),
    ).toBe("disconnected");
  });

  it("scans recent rollout files for the requested workspace", () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-pet-codex-home-"));
    const sessionsDir = path.join(codexHome, "sessions", "2026", "06", "03");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const included = path.join(sessionsDir, "rollout-2026-06-03T19-15-45-019e88e4-4f27-7f20-be48-fd1ef50e9492.jsonl");
    const excluded = path.join(sessionsDir, "rollout-2026-06-03T19-20-45-019e88eb-06f5-7801-b904-ac622612c514.jsonl");
    fs.writeFileSync(included, JSON.stringify(sessionMeta()) + "\n", "utf8");
    fs.writeFileSync(
      excluded,
      JSON.stringify({
        ...sessionMeta("019e88eb-06f5-7801-b904-ac622612c514"),
        payload: { ...sessionMeta().payload, id: "019e88eb-06f5-7801-b904-ac622612c514", cwd: "D:\\workspace\\Other" },
      }) + "\n",
      "utf8",
    );

    const sessions = scanRecentCodexSessionFiles({
      codexHome,
      workspacePath: "D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet",
      limit: 10,
    });

    expect(sessions.map((session) => session.codexSessionId)).toEqual(["019e88e4-4f27-7f20-be48-fd1ef50e9492"]);
  });

  it("globally sorts Windows and WSL roots before applying the session limit", () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-pet-codex-win-home-"));
    const wslCodexHome = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-pet-codex-wsl-home-"));
    const windowsSessionsDir = path.join(codexHome, "sessions", "2026", "07", "10");
    const wslSessionsDir = path.join(wslCodexHome, "sessions", "2026", "07", "10");
    fs.mkdirSync(windowsSessionsDir, { recursive: true });
    fs.mkdirSync(wslSessionsDir, { recursive: true });

    const windowsSessionId = "019f4ad9-0557-7da0-aacf-9d47c65fc38c";
    const wslSessionId = "019f4b12-dda1-7d21-952e-819d06243956";
    const windowsFile = path.join(windowsSessionsDir, `rollout-windows-${windowsSessionId}.jsonl`);
    const wslFile = path.join(wslSessionsDir, `rollout-wsl-${wslSessionId}.jsonl`);
    fs.writeFileSync(windowsFile, `${JSON.stringify(sessionMeta(windowsSessionId))}\n`, "utf8");
    const wslSessionMeta = sessionMeta(wslSessionId);
    fs.writeFileSync(
      wslFile,
      `${JSON.stringify({
        ...wslSessionMeta,
        payload: {
          ...wslSessionMeta.payload,
          cwd: "/mnt/d/workspace/MMD project/.worktrees/desktop-mmd-codex-pet",
        },
      })}\n`,
      "utf8",
    );
    fs.utimesSync(windowsFile, new Date("2026-07-10T08:00:00.000Z"), new Date("2026-07-10T08:00:00.000Z"));
    fs.utimesSync(wslFile, new Date("2026-07-10T08:05:00.000Z"), new Date("2026-07-10T08:05:00.000Z"));

    const sessions = scanRecentCodexSessionFiles({
      codexHome,
      wslCodexHome,
      workspacePath: "D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet",
      limit: 1,
    });

    expect(sessions.map((session) => session.codexSessionId)).toEqual([wslSessionId]);
  });
});
