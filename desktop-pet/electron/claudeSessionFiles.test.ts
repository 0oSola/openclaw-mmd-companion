import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildClaudeDesktopPetSessionPayload,
  extractClaudeReviewFacts,
  inferClaudeSessionStatus,
  parseClaudeSessionFile,
  resolveClaudeHome,
  scanRecentClaudeSessionFiles,
  type ClaudeSessionJsonEvent,
} from "./claudeSessionFiles";

const WORKSPACE = "D:\\workspace\\MMD project";
const SESSION_ID = "92bc9f7f-1f37-4244-a6f5-5a11d0a0f7c6";

function writeSessionFile(lines: unknown[], filename = `${SESSION_ID}.jsonl`) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-pet-claude-session-"));
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, lines.map((line) => JSON.stringify(line)).join("\n"), "utf8");
  return filePath;
}

function fileStartedAtFallback(filePath: string): string {
  const stat = fs.statSync(filePath);
  return (stat.birthtime.getTime() > 0 ? stat.birthtime : stat.ctime).toISOString();
}

function userLine(content: unknown, overrides: Partial<ClaudeSessionJsonEvent> = {}): ClaudeSessionJsonEvent {
  return {
    type: "user",
    sessionId: SESSION_ID,
    cwd: WORKSPACE,
    gitBranch: "codex/local-interactive-integration",
    timestamp: "2026-06-12T04:04:29.140Z",
    version: "2.1.174",
    message: { role: "user", content },
    ...overrides,
  };
}

function assistantLine(content: unknown, overrides: Record<string, unknown> = {}): ClaudeSessionJsonEvent {
  return {
    type: "assistant",
    sessionId: SESSION_ID,
    cwd: WORKSPACE,
    gitBranch: "codex/local-interactive-integration",
    timestamp: "2026-06-12T04:04:35.000Z",
    version: "2.1.174",
    message: { role: "assistant", model: "claude-opus-4.8", stop_reason: "end_turn", content, ...overrides },
  };
}

describe("desktop pet Claude session files", () => {
  it("resolves the Claude config home with platform defaults", () => {
    expect(resolveClaudeHome({ CLAUDE_CONFIG_DIR: "D:\\claude-home" }, "win32")).toBe("D:\\claude-home");
    expect(resolveClaudeHome({ USERPROFILE: "C:\\Users\\KSG" }, "win32")).toBe("C:\\Users\\KSG\\.claude");
    expect(resolveClaudeHome({ HOME: "/home/ksg" }, "linux")).toBe("/home/ksg/.claude");
  });

  it("parses a Claude JSONL transcript into bounded desktop-pet session metadata", () => {
    const filePath = writeSessionFile([
      { type: "mode", sessionId: SESSION_ID, mode: "default" },
      userLine("<command-name>/model</command-name>"),
      userLine("了解下当前项目"),
      assistantLine([{ type: "text", text: "我来看看这个项目。" }]),
      assistantLine([{ type: "text", text: "这是一个 MMD 虚拟陪伴系统。" }], { stop_reason: "end_turn" }),
    ]);

    const summary = parseClaudeSessionFile(filePath);
    const payload = buildClaudeDesktopPetSessionPayload(summary, "C:\\Users\\KSG\\.claude");

    expect(summary).toMatchObject({
      claudeSessionId: SESSION_ID,
      workspacePath: WORKSPACE,
      firstPromptPreview: "了解下当前项目",
      lastStatus: "completed",
      lastSummary: "这是一个 MMD 虚拟陪伴系统。",
      gitBranch: "codex/local-interactive-integration",
      cliVersion: "2.1.174",
      sessionStartedAt: "2026-06-12T04:04:29.140Z",
    });
    expect(payload).toMatchObject({
      pet_session_id: `claude:${SESSION_ID}`,
      codex_session_id: SESSION_ID,
      codex_home: "C:\\Users\\KSG\\.claude",
      display_title: "了解下当前项目",
      first_prompt_preview: "了解下当前项目",
      last_status: "completed",
      launch_mode: "interactive",
    });
    expect(payload.metadata).toMatchObject({
      source: "claude-jsonl",
      agent: "claude",
      session_file: filePath,
      session_started_at: "2026-06-12T04:04:29.140Z",
      git_branch: "codex/local-interactive-integration",
      cli_version: "2.1.174",
    });
  });

  it("derives the session id from the filename when no line carries sessionId", () => {
    const filePath = writeSessionFile([
      { type: "user", cwd: WORKSPACE, message: { role: "user", content: "hi" } },
    ]);

    const summary = parseClaudeSessionFile(filePath);
    expect(summary.claudeSessionId).toBe(SESSION_ID);
    expect(summary.workspacePath).toBe(WORKSPACE);
    expect(summary.sessionStartedAt).toBe(fileStartedAtFallback(filePath));
  });

  it("skips injected command/system user turns when choosing the first prompt", () => {
    const filePath = writeSessionFile([
      userLine("<command-name>/permissions</command-name>"),
      userLine("<local-command-stdout>done</local-command-stdout>"),
      userLine("# AGENTS.md instructions"),
      userLine("真正的第一条指令"),
    ]);

    const summary = parseClaudeSessionFile(filePath);
    expect(summary.firstPromptPreview).toBe("真正的第一条指令");
  });

  it("uses the latest tool_result as the last output", () => {
    const filePath = writeSessionFile([
      userLine("跑测试"),
      assistantLine([
        { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "npm test" } },
      ]),
      userLine([
        { type: "tool_result", tool_use_id: "toolu_1", content: "line one\nline two\nline three" },
      ]),
    ]);

    const summary = parseClaudeSessionFile(filePath);
    expect(summary.lastOutput).toBe("line one\nline two\nline three");
    // last assistant turn was a tool_use (no text), so command_running is current
    expect(summary.lastStatus).toBe("command_running");
  });

  it("infers status from the latest non-sidechain turn", () => {
    expect(inferClaudeSessionStatus([])).toBe("running");

    expect(inferClaudeSessionStatus([userLine("继续")])).toBe("running");

    expect(
      inferClaudeSessionStatus([
        assistantLine([{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }]),
      ]),
    ).toBe("command_running");

    expect(
      inferClaudeSessionStatus([
        assistantLine([{ type: "tool_use", id: "t2", name: "Edit", input: { file_path: "a.ts" } }]),
      ]),
    ).toBe("file_changed");

    expect(
      inferClaudeSessionStatus([
        assistantLine([{ type: "text", text: "完成。" }], { stop_reason: "end_turn" }),
      ]),
    ).toBe("completed");

    expect(
      inferClaudeSessionStatus([
        assistantLine([{ type: "text", text: "截断" }], { stop_reason: "max_tokens" }),
      ]),
    ).toBe("failed");
  });

  it("ignores sidechain (subagent) turns for status and previews", () => {
    const filePath = writeSessionFile([
      userLine("主任务"),
      assistantLine([{ type: "text", text: "主回答。" }], { stop_reason: "end_turn" }),
      userLine("子代理 prompt", { isSidechain: true }),
      { ...assistantLine([{ type: "tool_use", id: "s1", name: "Bash", input: { command: "x" } }]), isSidechain: true },
    ]);

    const summary = parseClaudeSessionFile(filePath);
    expect(summary.firstPromptPreview).toBe("主任务");
    expect(summary.lastStatus).toBe("completed");
  });

  it("extracts bounded review facts and redacts secrets", () => {
    const facts = extractClaudeReviewFacts([
      userLine("build"),
      assistantLine([
        { type: "tool_use", id: "t1", name: "Bash", input: { command: "npm run build" } },
      ]),
      userLine([
        {
          type: "tool_result",
          tool_use_id: "t1",
          is_error: true,
          content: "Exit code: 1\nschema mismatch\nSECRET_TOKEN=should-not-leak",
        },
      ]),
      assistantLine([
        { type: "tool_use", id: "t2", name: "Edit", input: { file_path: "desktop-pet/src/App.tsx" } },
      ]),
      userLine([{ type: "tool_result", tool_use_id: "t2", content: "ok" }]),
    ]);

    expect(facts.failed_commands).toMatchObject([
      { command: "npm run build", exit_code: 1 },
    ]);
    expect(facts.failed_commands[0].excerpt).toContain("SECRET_TOKEN=[redacted]");
    expect(facts.failed_commands[0].excerpt).not.toContain("should-not-leak");
    expect(facts.changed_files).toEqual(["desktop-pet/src/App.tsx"]);
    expect(facts.errors).toMatchObject([{ type: "tool_error" }]);
  });

  it("scans recent session files for the requested workspace", () => {
    const claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-pet-claude-home-"));
    const projectsDir = path.join(claudeHome, "projects", "d--workspace-MMD-project");
    fs.mkdirSync(projectsDir, { recursive: true });
    const included = path.join(projectsDir, `${SESSION_ID}.jsonl`);
    const excluded = path.join(projectsDir, "11111111-2222-3333-4444-555555555555.jsonl");
    fs.writeFileSync(included, JSON.stringify(userLine("included")) + "\n", "utf8");
    fs.writeFileSync(
      excluded,
      JSON.stringify(userLine("excluded", { cwd: "D:\\workspace\\Other", sessionId: "11111111-2222-3333-4444-555555555555" })) + "\n",
      "utf8",
    );

    const sessions = scanRecentClaudeSessionFiles({
      claudeHome,
      workspacePath: WORKSPACE,
      limit: 10,
    });

    expect(sessions.map((session) => session.claudeSessionId)).toEqual([SESSION_ID]);
  });
});
