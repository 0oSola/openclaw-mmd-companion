import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeWorkspacePathIdentity } from "./workspacePathIdentity.js";
const DEFAULT_HEAD_BYTES = 1024 * 1024;
const DEFAULT_TAIL_BYTES = 256 * 1024;
const DEFAULT_SCAN_FILE_LIMIT = 80;
const REVIEW_FACT_MAX_FAILED_COMMANDS = 6;
const REVIEW_FACT_MAX_FAILED_COMMAND_EXCERPT = 500;
const REVIEW_FACT_MAX_ERRORS = 8;
const REVIEW_FACT_MAX_ERROR_EXCERPT = 500;
const REVIEW_FACT_MAX_CHANGED_FILES = 40;
const REVIEW_FACT_MAX_TEXT = 240;
const REVIEW_FACT_MAX_USER_MESSAGES = 10;
const REVIEW_FACT_MAX_USER_MESSAGE_CHARS = 500;
const REVIEW_FACT_MAX_ASSISTANT_MESSAGES = 15;
const REVIEW_FACT_MAX_ASSISTANT_MESSAGE_CHARS = 800;
const REVIEW_FACT_MAX_FUNCTION_CALLS = 20;
const FILE_CHANGE_TOOLS = new Set(["edit", "write", "multiedit", "notebookedit", "applypatch"]);
const COMMAND_TOOLS = new Set(["bash", "bashoutput", "killshell"]);
function asRecord(value) {
    return value && typeof value === "object" ? value : {};
}
function compactText(value) {
    if (typeof value !== "string")
        return "";
    return value.replace(/\s+/g, " ").trim();
}
function truncateText(value, maxLength) {
    const text = compactText(value);
    if (!text)
        return null;
    return Array.from(text).slice(0, maxLength).join("");
}
function truncateOutput(value, maxLength) {
    const text = value?.replace(/\r\n/g, "\n").trim() ?? "";
    if (!text)
        return null;
    return Array.from(text).slice(0, maxLength).join("");
}
function redactSensitiveText(value) {
    return value
        .replace(/\b((?:[\w.-]*?(?:token|password|passwd|pwd|secret|api[_-]?key|access[_-]?key|private[_-]?key)[\w.-]*?)\s*[:=]\s*)(["']?)[^\s"',;]+/gi, "$1[redacted]")
        .replace(/\b(?:sk|ghp|github_pat|xox[abprs])[-_][A-Za-z0-9._-]{8,}\b/g, "[redacted]");
}
function boundedFactText(value, maxLength = 1000) {
    const output = redactSensitiveText(normalizeTextContent(value)).replace(/\r\n/g, "\n").trim();
    if (!output)
        return "";
    return Array.from(output).slice(0, maxLength).join("");
}
function workspaceName(workspacePath) {
    const parts = workspacePath.split(/[\\/]/).filter(Boolean);
    return parts.at(-1) || "workspace";
}
export function resolveClaudeHome(env, platform = process.platform) {
    const pathApi = platform === "win32" ? path.win32 : path.posix;
    const configured = env.CLAUDE_CONFIG_DIR?.trim();
    if (configured)
        return pathApi.resolve(configured);
    if (platform === "win32" && env.USERPROFILE?.trim())
        return pathApi.join(env.USERPROFILE.trim(), ".claude");
    if (env.HOME?.trim())
        return pathApi.join(env.HOME.trim(), ".claude");
    return pathApi.join(os.homedir(), ".claude");
}
function readFileWindow(filePath, start, length) {
    if (length <= 0)
        return "";
    const fd = fs.openSync(filePath, "r");
    try {
        const buffer = Buffer.alloc(length);
        const bytesRead = fs.readSync(fd, buffer, 0, length, start);
        return buffer.subarray(0, bytesRead).toString("utf8");
    }
    finally {
        fs.closeSync(fd);
    }
}
function readHeadText(filePath, size, maxBytes) {
    const text = readFileWindow(filePath, 0, Math.min(size, maxBytes));
    if (size <= maxBytes || text.endsWith("\n"))
        return text;
    const lastNewline = text.lastIndexOf("\n");
    return lastNewline >= 0 ? text.slice(0, lastNewline) : text;
}
function readTailText(filePath, size, maxBytes) {
    if (size <= maxBytes)
        return "";
    const start = Math.max(0, size - maxBytes);
    const text = readFileWindow(filePath, start, size - start);
    if (start === 0)
        return text;
    const firstNewline = text.indexOf("\n");
    return firstNewline >= 0 ? text.slice(firstNewline + 1) : "";
}
function parseJsonLine(line) {
    const trimmed = line.trim();
    if (!trimmed)
        return null;
    try {
        return JSON.parse(trimmed);
    }
    catch {
        return null;
    }
}
function parseJsonLines(text) {
    return text
        .split(/\r?\n/)
        .map(parseJsonLine)
        .filter((event) => event !== null);
}
function resolveSessionStartedAt(events, stat) {
    let earliestTimestamp = null;
    let earliestTime = Number.POSITIVE_INFINITY;
    for (const event of events) {
        if (typeof event.timestamp !== "string")
            continue;
        const eventTime = Date.parse(event.timestamp);
        if (!Number.isFinite(eventTime) || eventTime >= earliestTime)
            continue;
        earliestTimestamp = event.timestamp;
        earliestTime = eventTime;
    }
    if (earliestTimestamp)
        return earliestTimestamp;
    const birthtimeMs = stat.birthtime.getTime();
    const fallback = Number.isFinite(birthtimeMs) && birthtimeMs > 0 ? stat.birthtime : stat.ctime;
    return fallback.toISOString();
}
// Claude assistant content is an array of typed blocks. User content is either a
// plain string (a human prompt) or an array of blocks (tool_result turns).
function normalizeTextContent(content) {
    if (typeof content === "string")
        return compactText(content);
    if (!Array.isArray(content)) {
        if (content && typeof content === "object")
            return normalizeTextContent(asRecord(content).text);
        return "";
    }
    return compactText(content
        .map((item) => {
        const block = asRecord(item);
        if (block.type === "text" && typeof block.text === "string")
            return block.text;
        return "";
    })
        .filter(Boolean)
        .join(" "));
}
function toolResultText(content) {
    if (typeof content === "string")
        return content;
    if (!Array.isArray(content))
        return "";
    return content
        .map((item) => {
        const block = asRecord(item);
        if (typeof block.text === "string")
            return block.text;
        if (typeof block.content === "string")
            return block.content;
        return "";
    })
        .filter(Boolean)
        .join("\n");
}
function isInjectedUserText(text) {
    return (text.startsWith("<command-name>") ||
        text.startsWith("<command-message>") ||
        text.startsWith("<local-command-stdout>") ||
        text.startsWith("<system-reminder>") ||
        text.startsWith("Caveat:") ||
        text.startsWith("<bash-") ||
        text.startsWith("# AGENTS.md") ||
        text.startsWith("[Request interrupted"));
}
function userBlocks(message) {
    return Array.isArray(message.content) ? message.content.map(asRecord) : [];
}
function userHasToolResult(message) {
    return userBlocks(message).some((block) => block.type === "tool_result");
}
function userPromptFromEvent(event) {
    if (event.type !== "user" || event.isSidechain)
        return null;
    const message = asRecord(event.message);
    if (userHasToolResult(message))
        return null;
    const text = normalizeTextContent(message.content);
    return text && !isInjectedUserText(text) ? text : null;
}
function assistantSummaryFromEvent(event) {
    if (event.type !== "assistant" || event.isSidechain)
        return null;
    const message = asRecord(event.message);
    const text = normalizeTextContent(message.content);
    return text ? truncateText(text, 1000) : null;
}
function outputFromEvent(event) {
    if (event.isSidechain)
        return null;
    if (event.type === "assistant")
        return assistantSummaryFromEvent(event);
    if (event.type === "user") {
        const message = asRecord(event.message);
        if (!userHasToolResult(message))
            return null;
        const blocks = userBlocks(message);
        const result = blocks.find((block) => block.type === "tool_result");
        return result ? truncateOutput(toolResultText(result.content), 1000) : null;
    }
    return null;
}
function assistantToolUses(event) {
    if (event.type !== "assistant")
        return [];
    const message = asRecord(event.message);
    if (!Array.isArray(message.content))
        return [];
    return message.content.map(asRecord).filter((block) => block.type === "tool_use");
}
function toolNameKey(block) {
    return compactText(block.name).toLowerCase();
}
export function inferClaudeSessionStatus(events) {
    let status = "running";
    for (const event of events) {
        if (event.isSidechain)
            continue;
        if (event.type === "user") {
            // A tool_result turn is the runtime echoing a tool's output back to the
            // assistant, not the human taking another turn. Treating it as a fresh
            // user prompt would wrongly reset an in-flight command/file-change status
            // back to "running", so skip it and keep the prior assistant-derived state.
            if (userHasToolResult(asRecord(event.message)))
                continue;
            status = "running";
            continue;
        }
        if (event.type !== "assistant")
            continue;
        const message = asRecord(event.message);
        const toolUses = assistantToolUses(event);
        if (toolUses.length) {
            if (toolUses.some((block) => COMMAND_TOOLS.has(toolNameKey(block))))
                status = "command_running";
            else if (toolUses.some((block) => FILE_CHANGE_TOOLS.has(toolNameKey(block))))
                status = "file_changed";
            else
                status = "command_running";
            continue;
        }
        const stopReason = compactText(message.stop_reason);
        if (stopReason === "end_turn" || stopReason === "stop_sequence")
            status = "completed";
        else if (stopReason === "max_tokens")
            status = "failed";
        else
            status = "running";
    }
    return status;
}
function addUnique(items, value, maxItems, maxLength = REVIEW_FACT_MAX_TEXT) {
    const text = truncateText(compactText(value), maxLength);
    if (!text || items.includes(text) || items.length >= maxItems)
        return;
    items.push(text);
}
function parseToolResultExitCode(text) {
    const match = text.match(/\b(?:exit code|exited with)\s*:?\s*(-?\d+)/i);
    return match ? Number(match[1]) : null;
}
export function extractClaudeReviewFacts(events) {
    const facts = {
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
    const pendingCommands = new Map();
    for (const event of events) {
        if (event.isSidechain)
            continue;
        const factType = event.type ? compactText(event.type) : null;
        if (factType) {
            facts.event_counts[factType] = (facts.event_counts[factType] ?? 0) + 1;
        }
        if (event.type === "assistant") {
            for (const block of assistantToolUses(event)) {
                const toolKey = toolNameKey(block);
                const input = asRecord(block.input);
                if (FILE_CHANGE_TOOLS.has(toolKey)) {
                    addUnique(facts.changed_files, input.file_path ?? input.path ?? input.notebook_path, REVIEW_FACT_MAX_CHANGED_FILES);
                }
                if (COMMAND_TOOLS.has(toolKey)) {
                    const callId = compactText(block.id);
                    const command = compactText(input.command) || toolKey;
                    if (callId)
                        pendingCommands.set(callId, command);
                }
                if (facts.function_call_summaries.length < REVIEW_FACT_MAX_FUNCTION_CALLS) {
                    facts.function_call_summaries.push({
                        name: truncateText(toolKey, 80) || "unknown",
                        command: truncateText(compactText(input.command), 120),
                    });
                }
            }
            const assistantText = assistantSummaryFromEvent(event);
            if (assistantText && !facts.assistant_messages.includes(assistantText) && facts.assistant_messages.length < REVIEW_FACT_MAX_ASSISTANT_MESSAGES) {
                facts.assistant_messages.push(truncateText(assistantText, REVIEW_FACT_MAX_ASSISTANT_MESSAGE_CHARS) || assistantText);
            }
            continue;
        }
        if (event.type !== "user")
            continue;
        const message = asRecord(event.message);
        const userText = userPromptFromEvent(event);
        if (userText && !facts.user_messages.includes(userText) && facts.user_messages.length < REVIEW_FACT_MAX_USER_MESSAGES) {
            facts.user_messages.push(truncateText(userText, REVIEW_FACT_MAX_USER_MESSAGE_CHARS) || userText);
        }
        for (const block of userBlocks(message)) {
            if (block.type !== "tool_result")
                continue;
            const excerpt = boundedFactText(block.content, REVIEW_FACT_MAX_FAILED_COMMAND_EXCERPT);
            const callId = compactText(block.tool_use_id);
            const command = pendingCommands.get(callId) ?? null;
            const exitCode = parseToolResultExitCode(excerpt);
            const isError = block.is_error === true || (exitCode !== null && exitCode !== 0);
            if (isError && facts.failed_commands.length < REVIEW_FACT_MAX_FAILED_COMMANDS) {
                facts.failed_commands.push({
                    command: truncateText(command, REVIEW_FACT_MAX_TEXT),
                    exit_code: exitCode ?? 1,
                    excerpt,
                });
            }
            if (block.is_error === true && facts.errors.length < REVIEW_FACT_MAX_ERRORS) {
                const errorExcerpt = boundedFactText(block.content, REVIEW_FACT_MAX_ERROR_EXCERPT);
                if (errorExcerpt)
                    facts.errors.push({ type: "tool_error", excerpt: errorExcerpt });
            }
        }
    }
    return facts;
}
function extractSessionMeta(events, fallbackId) {
    const withCwd = events.find((event) => compactText(event.cwd));
    const workspacePath = compactText(withCwd?.cwd);
    if (!workspacePath)
        return null;
    const claudeSessionId = compactText(events.find((event) => compactText(event.sessionId))?.sessionId) || fallbackId;
    if (!claudeSessionId)
        return null;
    return {
        claudeSessionId,
        workspacePath,
        gitBranch: truncateText(compactText(withCwd?.gitBranch), 120),
        cliVersion: truncateText(compactText(events.find((event) => compactText(event.version))?.version), 80),
    };
}
export function parseClaudeSessionFile(filePath, options = {}) {
    const stat = fs.statSync(filePath);
    const headEvents = parseJsonLines(readHeadText(filePath, stat.size, options.maxHeadBytes ?? DEFAULT_HEAD_BYTES));
    const tailEvents = parseJsonLines(readTailText(filePath, stat.size, options.maxTailBytes ?? DEFAULT_TAIL_BYTES));
    const events = [...headEvents, ...tailEvents];
    const fallbackId = path.basename(filePath).replace(/\.jsonl$/i, "");
    const meta = extractSessionMeta(events, fallbackId);
    if (!meta) {
        throw new Error(`Claude session metadata not found in ${filePath}`);
    }
    const firstPromptPreview = truncateText(events.map(userPromptFromEvent).find(Boolean), 240);
    const lastSummary = truncateText(events.map(assistantSummaryFromEvent).filter(Boolean).at(-1), 1000);
    const lastOutput = truncateOutput(events.map(outputFromEvent).filter(Boolean).at(-1), 1000);
    const displayTitle = truncateText(firstPromptPreview || workspaceName(meta.workspacePath), 48) || "Claude session";
    const sessionStartedAt = resolveSessionStartedAt(events, stat);
    const lastEventAt = [...events]
        .reverse()
        .map((event) => (typeof event.timestamp === "string" ? event.timestamp : null))
        .find(Boolean);
    return {
        ...meta,
        filePath,
        firstPromptPreview,
        displayTitle,
        lastSummary,
        lastOutput,
        lastStatus: inferClaudeSessionStatus(events),
        sessionStartedAt,
        lastEventAt: lastEventAt || null,
        fileModifiedAt: stat.mtime.toISOString(),
        reviewFacts: extractClaudeReviewFacts(events),
    };
}
function findClaudeSessionFiles(root, maxFiles) {
    if (!fs.existsSync(root))
        return [];
    const found = [];
    const stack = [root];
    let visitedSessionFiles = 0;
    while (stack.length && visitedSessionFiles < maxFiles) {
        const current = stack.pop();
        if (!current)
            continue;
        let entries;
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        }
        catch {
            continue;
        }
        const childDirectories = [];
        for (const entry of entries.sort((left, right) => right.name.localeCompare(left.name))) {
            const entryPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                childDirectories.push(entryPath);
                continue;
            }
            if (!entry.isFile() || !/\.jsonl$/i.test(entry.name))
                continue;
            if (visitedSessionFiles >= maxFiles)
                break;
            visitedSessionFiles += 1;
            try {
                const stat = fs.statSync(entryPath);
                found.push({ filePath: entryPath, mtimeMs: stat.mtimeMs });
            }
            catch {
                continue;
            }
        }
        for (const directory of childDirectories.reverse())
            stack.push(directory);
    }
    return found.sort((left, right) => right.mtimeMs - left.mtimeMs);
}
export function scanRecentClaudeSessionFiles(options) {
    const projectsRoot = path.join(options.claudeHome, "projects");
    const workspaceFilter = normalizeWorkspacePathIdentity(options.workspacePath);
    const limit = Math.max(1, Math.min(options.limit ?? 10, 50));
    const maxFiles = Math.max(limit, options.maxFiles ?? DEFAULT_SCAN_FILE_LIMIT);
    const summaries = [];
    for (const candidate of findClaudeSessionFiles(projectsRoot, maxFiles)) {
        try {
            const summary = parseClaudeSessionFile(candidate.filePath);
            if (workspaceFilter && normalizeWorkspacePathIdentity(summary.workspacePath) !== workspaceFilter)
                continue;
            summaries.push(summary);
            if (summaries.length >= limit)
                break;
        }
        catch {
            continue;
        }
    }
    return summaries.sort((left, right) => Date.parse(right.fileModifiedAt) - Date.parse(left.fileModifiedAt));
}
export function buildClaudeDesktopPetSessionPayload(summary, claudeHome) {
    return {
        pet_session_id: `claude:${summary.claudeSessionId}`,
        codex_session_id: summary.claudeSessionId,
        workspace_id: null,
        workspace_path: summary.workspacePath,
        codex_home: claudeHome,
        display_title: summary.displayTitle,
        first_prompt_preview: summary.firstPromptPreview,
        last_summary: summary.lastSummary,
        last_status: summary.lastStatus,
        launch_mode: "interactive",
        remote_url: null,
        app_server_pid: null,
        app_server_port: null,
        metadata: {
            source: "claude-jsonl",
            agent: "claude",
            session_file: summary.filePath,
            session_file_mtime: summary.fileModifiedAt,
            session_started_at: summary.sessionStartedAt,
            git_branch: summary.gitBranch,
            cli_version: summary.cliVersion,
            last_event_at: summary.lastEventAt,
            last_output: summary.lastOutput,
            facts: summary.reviewFacts,
        },
    };
}
