import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { isInjectedCodexContext } from "../shared/codexPresentation.js";
import { normalizeWorkspacePathIdentity } from "./workspacePathIdentity.js";
export const CODEX_SESSION_PARSER_VERSION = "codex-jsonl-stream-v2";
export const CODEX_REVIEW_FACTS_VERSION = "codex-review-facts-v2";
const DEFAULT_STREAM_CHUNK_BYTES = 64 * 1024;
const DEFAULT_MAX_JSONL_LINE_CHARS = 16 * 1024 * 1024;
const DEFAULT_SCAN_FILE_LIMIT = 80;
const MAX_PENDING_TOOL_CALLS = 256;
const REVIEW_FACT_MAX_FAILED_COMMANDS = 6;
const REVIEW_FACT_MAX_FAILED_COMMAND_EXCERPT = 500;
const REVIEW_FACT_MAX_ERRORS = 8;
const REVIEW_FACT_MAX_ERROR_EXCERPT = 500;
const REVIEW_FACT_MAX_APPROVALS = 10;
const REVIEW_FACT_MAX_CHANGED_FILES = 40;
const REVIEW_FACT_MAX_TEXT = 240;
const REVIEW_FACT_MAX_USER_MESSAGES = 10;
const REVIEW_FACT_MAX_USER_MESSAGE_CHARS = 500;
const REVIEW_FACT_MAX_ASSISTANT_MESSAGES = 15;
const REVIEW_FACT_MAX_ASSISTANT_MESSAGE_CHARS = 800;
const REVIEW_FACT_MAX_FUNCTION_CALLS = 20;
const REVIEW_FACT_MAX_WORK_ITEMS = 24;
const REVIEW_FACT_MAX_WORK_ITEM_CHARS = 500;
const REVIEW_FACT_MAX_METHODS = 24;
const REVIEW_FACT_MAX_METHOD_COMMAND_CHARS = 240;
const REVIEW_FACT_MAX_METHOD_EXCERPT_CHARS = 500;
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
function normalizeOutputText(value) {
    if (typeof value === "string")
        return value.replace(/\r\n/g, "\n").trim();
    if (Array.isArray(value)) {
        return value
            .map((item) => normalizeOutputText(item))
            .filter(Boolean)
            .join("\n")
            .trim();
    }
    if (!value || typeof value !== "object")
        return "";
    const record = asRecord(value);
    return normalizeOutputText(record.text ?? record.output ?? record.content ?? record.message);
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
    const output = redactSensitiveText(normalizeOutputText(value)).replace(/\r\n/g, "\n").trim();
    if (!output)
        return "";
    return Array.from(output).slice(0, maxLength).join("");
}
function boundedCompactFactText(value, maxLength) {
    const text = redactSensitiveText(compactText(value));
    if (!text)
        return null;
    return Array.from(text).slice(0, maxLength).join("");
}
function eventTimestamp(event) {
    return typeof event.timestamp === "string" ? event.timestamp : null;
}
function workspaceName(workspacePath) {
    const parts = workspacePath.split(/[\\/]/).filter(Boolean);
    return parts.at(-1) || "workspace";
}
export function resolveCodexHome(env, platform = process.platform) {
    const pathApi = platform === "win32" ? path.win32 : path.posix;
    const configured = env.CODEX_HOME?.trim();
    if (configured)
        return pathApi.resolve(configured);
    if (platform === "win32" && env.USERPROFILE?.trim())
        return pathApi.join(env.USERPROFILE.trim(), ".codex");
    if (env.HOME?.trim())
        return pathApi.join(env.HOME.trim(), ".codex");
    return pathApi.join(os.homedir(), ".codex");
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
function forEachJsonLineEvent(filePath, options, visit) {
    const chunkBytes = Math.max(1024, options.chunkBytes ?? DEFAULT_STREAM_CHUNK_BYTES);
    const maxLineChars = Math.max(1024, options.maxLineChars ?? DEFAULT_MAX_JSONL_LINE_CHARS);
    const fd = fs.openSync(filePath, "r");
    const decoder = new StringDecoder("utf8");
    const buffer = Buffer.alloc(chunkBytes);
    let pending = "";
    const consumeLine = (line) => {
        if (line.length > maxLineChars) {
            throw new Error(`Codex JSONL line exceeds ${maxLineChars} characters in ${filePath}`);
        }
        const event = parseJsonLine(line.endsWith("\r") ? line.slice(0, -1) : line);
        if (event)
            visit(event);
    };
    try {
        while (true) {
            const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
            if (bytesRead <= 0)
                break;
            pending += decoder.write(buffer.subarray(0, bytesRead));
            if (pending.length > maxLineChars && !pending.includes("\n")) {
                throw new Error(`Codex JSONL line exceeds ${maxLineChars} characters in ${filePath}`);
            }
            let newlineIndex = pending.indexOf("\n");
            while (newlineIndex >= 0) {
                const line = pending.slice(0, newlineIndex);
                pending = pending.slice(newlineIndex + 1);
                consumeLine(line);
                newlineIndex = pending.indexOf("\n");
            }
        }
        pending += decoder.end();
        if (pending)
            consumeLine(pending);
    }
    finally {
        fs.closeSync(fd);
    }
}
function resolveSessionStartedAt(earliestTimestamp, stat) {
    if (earliestTimestamp)
        return earliestTimestamp;
    const birthtimeMs = stat.birthtime.getTime();
    const fallback = Number.isFinite(birthtimeMs) && birthtimeMs > 0 ? stat.birthtime : stat.ctime;
    return fallback.toISOString();
}
function contentText(content) {
    if (typeof content === "string")
        return compactText(content);
    if (!Array.isArray(content))
        return "";
    return compactText(content
        .map((item) => {
        const record = asRecord(item);
        return typeof record.text === "string" ? record.text : "";
    })
        .join(" "));
}
function userPromptFromEvent(event) {
    const payload = asRecord(event.payload);
    if (event.type === "response_item" && payload.type === "message" && payload.role === "user") {
        const text = contentText(payload.content);
        return text && !isInjectedCodexContext(text) ? text : null;
    }
    if (event.type === "event_msg" && payload.type === "user_message") {
        const text = compactText(payload.message);
        return text && !isInjectedCodexContext(text) ? text : null;
    }
    return null;
}
function assistantSummaryFromEvent(event) {
    const payload = asRecord(event.payload);
    if (event.type === "response_item" && payload.type === "message" && payload.role === "assistant") {
        return truncateText(contentText(payload.content), 1000);
    }
    if (event.type === "event_msg" && payload.type === "agent_message") {
        return truncateText(compactText(payload.message), 1000);
    }
    return null;
}
function outputFromEvent(event) {
    const payload = asRecord(event.payload);
    if (event.type === "response_item" &&
        (payload.type === "function_call_output" || payload.type === "custom_tool_call_output")) {
        return truncateOutput(normalizeOutputText(payload.output), 1000);
    }
    return assistantSummaryFromEvent(event);
}
function isApprovalEvent(event) {
    const payload = asRecord(event.payload);
    const eventType = String(payload.type || "");
    if (/approval|permission/i.test(eventType))
        return true;
    const message = compactText(payload.message);
    return /APPROVAL REQUEST START|approval request|permission request/i.test(message);
}
function eventFactType(event) {
    const payload = asRecord(event.payload);
    const payloadType = compactText(payload.type);
    if (event.type === "response_item" && payloadType === "message") {
        const role = compactText(payload.role);
        return role ? `${role}_message` : payloadType;
    }
    return payloadType || compactText(event.type) || null;
}
function commandText(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => compactText(item))
            .filter(Boolean)
            .join(" ");
    }
    return compactText(value);
}
function isToolCallPayloadType(value) {
    return value === "function_call" || value === "custom_tool_call";
}
function isToolCallOutputPayloadType(value) {
    return value === "function_call_output" || value === "custom_tool_call_output";
}
function toolCallId(payload) {
    return boundedCompactFactText(payload.call_id, 160) || null;
}
function decodeQuotedJavaScriptString(value, quote) {
    if (quote === '"') {
        try {
            return JSON.parse(`"${value}"`);
        }
        catch {
            return value;
        }
    }
    return value.replace(/\\([\\'"`])/g, "$1").replace(/\\n/g, "\n").replace(/\\r/g, "\r");
}
function commandFromCustomToolInput(value) {
    if (value && typeof value === "object") {
        return parseToolCallCommand(asRecord(value));
    }
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
            const nested = parseToolCallCommand(asRecord(parsed));
            if (nested)
                return nested;
        }
    }
    catch {
        // Current Codex Desktop custom tool inputs are commonly JavaScript source.
    }
    const cmdMatch = trimmed.match(/\bcmd\s*:\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/);
    if (cmdMatch)
        return compactText(decodeQuotedJavaScriptString(cmdMatch[2], cmdMatch[1])) || null;
    const commandMatch = trimmed.match(/\bcommand\s*:\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/);
    if (commandMatch)
        return compactText(decodeQuotedJavaScriptString(commandMatch[2], commandMatch[1])) || null;
    return compactText(trimmed) || null;
}
function parseToolCallCommand(payload) {
    for (const key of ["command", "cmd"]) {
        const direct = commandText(payload[key]);
        if (direct)
            return direct;
    }
    const args = payload.arguments;
    if (typeof args === "string") {
        try {
            return parseToolCallCommand(JSON.parse(args));
        }
        catch {
            return compactText(args) || null;
        }
    }
    if (args && typeof args === "object") {
        const nested = asRecord(args);
        for (const key of ["command", "cmd"]) {
            const value = commandText(nested[key]);
            if (value)
                return value;
        }
    }
    const callName = compactText(payload.name);
    if (/^(?:exec|exec_command|shell_command)$/i.test(callName)) {
        const customInput = commandFromCustomToolInput(payload.input);
        if (customInput)
            return customInput;
    }
    if (payload.type === "custom_tool_call")
        return null;
    return compactText(payload.name) || null;
}
function parseExitCode(payload, output) {
    if (typeof payload.exit_code === "number" && Number.isFinite(payload.exit_code))
        return payload.exit_code;
    if (typeof payload.exitCode === "number" && Number.isFinite(payload.exitCode))
        return payload.exitCode;
    const match = output.match(/\b(?:Exit code:|Process exited with code)\s*(-?\d+)/i);
    return match ? Number(match[1]) : null;
}
function inferToolOutcome(callPayload, outputPayload, output) {
    const exitCode = parseExitCode(outputPayload, output);
    if (exitCode !== null) {
        return { outcome: exitCode === 0 ? "success" : "failed", exitCode };
    }
    const status = compactText(callPayload?.status ?? outputPayload.status).toLowerCase();
    if (/failed|error|cancelled/.test(status) || /\bscript failed\b/i.test(output)) {
        return { outcome: "failed", exitCode: null };
    }
    if (status === "completed" || /\bscript completed\b/i.test(output) || /^done!?$/i.test(output.trim())) {
        return { outcome: "success", exitCode: null };
    }
    return { outcome: "unknown", exitCode: null };
}
function patchChangedFiles(payload) {
    const callName = compactText(payload.name);
    if (!/patch/i.test(callName))
        return [];
    const input = typeof payload.input === "string" ? payload.input : "";
    if (!input)
        return [];
    const files = [];
    const patterns = [
        /^\*\*\* (?:Add|Update|Delete) File:\s*(.+)$/gm,
        /^\+\+\+\s+b\/(.+)$/gm,
    ];
    for (const pattern of patterns) {
        for (const match of input.matchAll(pattern)) {
            const file = compactText(match[1]);
            if (file && !files.includes(file))
                files.push(file);
        }
    }
    return files;
}
function addUnique(items, value, maxItems, maxLength = REVIEW_FACT_MAX_TEXT) {
    const text = boundedCompactFactText(value, maxLength);
    if (!text || items.includes(text) || items.length >= maxItems)
        return;
    items.push(text);
}
function addWorkItem(facts, event, kind, source, value) {
    if (facts.work_items.length >= REVIEW_FACT_MAX_WORK_ITEMS)
        return;
    const text = boundedCompactFactText(value, REVIEW_FACT_MAX_WORK_ITEM_CHARS);
    if (!text)
        return;
    if (facts.work_items.some((item) => item.kind === kind && item.text === text))
        return;
    facts.work_items.push({
        kind,
        source,
        text,
        timestamp: eventTimestamp(event),
    });
}
function changedFileValues(value) {
    if (Array.isArray(value)) {
        return value;
    }
    return [value];
}
function addChangedFileFacts(facts, event, value, source = "event") {
    for (const item of changedFileValues(value)) {
        addUnique(facts.changed_files, item, REVIEW_FACT_MAX_CHANGED_FILES);
        addWorkItem(facts, event, "file_change", source, item);
    }
}
function isCheckCommand(command) {
    if (!command)
        return false;
    return /\b(pytest|vitest|tsc|ruff|mypy|cargo\s+test|go\s+test)\b/i.test(command)
        || /\b(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:test|typecheck|build|lint)\b/i.test(command);
}
function methodKindForCall(name, command) {
    if (isCheckCommand(command))
        return "check";
    if (command)
        return "command";
    if (/edit|write|patch|file/i.test(name))
        return "file_operation";
    return "tool";
}
function addMethod(facts, method) {
    if (facts.methods.length >= REVIEW_FACT_MAX_METHODS)
        return null;
    facts.methods.push({
        kind: method.kind,
        name: boundedCompactFactText(method.name, 80) || "unknown",
        command: boundedCompactFactText(method.command, REVIEW_FACT_MAX_METHOD_COMMAND_CHARS),
        outcome: method.outcome ?? "pending",
        exit_code: method.exit_code ?? null,
        excerpt: method.excerpt ? boundedFactText(method.excerpt, REVIEW_FACT_MAX_METHOD_EXCERPT_CHARS) : null,
        timestamp: method.timestamp,
    });
    return facts.methods.length - 1;
}
function updateMethodOutcome(facts, methodIndex, outcome, exitCode, output) {
    if (methodIndex === null)
        return;
    const method = facts.methods[methodIndex];
    if (!method)
        return;
    method.exit_code = exitCode;
    method.outcome = outcome;
    method.excerpt = boundedFactText(output, REVIEW_FACT_MAX_METHOD_EXCERPT_CHARS) || null;
}
function createReviewFactsAccumulator() {
    return {
        facts: {
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
        },
        pendingCalls: new Map(),
        lastCall: null,
    };
}
function rememberPendingCall(accumulator, call) {
    accumulator.lastCall = call;
    if (!call.callId)
        return;
    accumulator.pendingCalls.set(call.callId, call);
    while (accumulator.pendingCalls.size > MAX_PENDING_TOOL_CALLS) {
        const oldest = accumulator.pendingCalls.keys().next().value;
        if (typeof oldest !== "string")
            break;
        accumulator.pendingCalls.delete(oldest);
    }
}
function processReviewFactEvent(accumulator, event) {
    const facts = accumulator.facts;
    const payload = asRecord(event.payload);
    const factType = eventFactType(event);
    if (factType) {
        facts.event_counts[factType] = (facts.event_counts[factType] ?? 0) + 1;
    }
    if (event.type === "response_item" && isToolCallPayloadType(payload.type)) {
        const command = parseToolCallCommand(payload);
        const callName = boundedCompactFactText(payload.name, 80) || "unknown";
        if (facts.function_call_summaries.length < REVIEW_FACT_MAX_FUNCTION_CALLS) {
            facts.function_call_summaries.push({
                name: callName,
                command: boundedCompactFactText(command, 120),
            });
        }
        const methodIndex = addMethod(facts, {
            kind: methodKindForCall(callName, command),
            name: callName,
            command,
            timestamp: eventTimestamp(event),
        });
        rememberPendingCall(accumulator, {
            callId: toolCallId(payload),
            callName,
            command,
            methodIndex,
            payload,
        });
        for (const changedFile of patchChangedFiles(payload)) {
            addChangedFileFacts(facts, event, changedFile, "tool");
        }
    }
    if (event.type === "response_item" &&
        payload.type === "message" &&
        payload.role === "user" &&
        facts.user_messages.length < REVIEW_FACT_MAX_USER_MESSAGES) {
        const userText = contentText(payload.content);
        if (userText && !isInjectedCodexContext(userText) && !facts.user_messages.includes(userText)) {
            facts.user_messages.push(truncateText(userText, REVIEW_FACT_MAX_USER_MESSAGE_CHARS) || userText);
            addWorkItem(facts, event, "goal", "user", userText);
        }
    }
    if (event.type === "response_item" &&
        payload.type === "message" &&
        payload.role === "assistant" &&
        facts.assistant_messages.length < REVIEW_FACT_MAX_ASSISTANT_MESSAGES) {
        const assistantText = contentText(payload.content);
        if (assistantText && !facts.assistant_messages.includes(assistantText)) {
            facts.assistant_messages.push(truncateText(assistantText, REVIEW_FACT_MAX_ASSISTANT_MESSAGE_CHARS) || assistantText);
            addWorkItem(facts, event, "agent_update", "assistant", assistantText);
        }
    }
    if (event.type === "event_msg" && payload.type === "user_message" && facts.user_messages.length < REVIEW_FACT_MAX_USER_MESSAGES) {
        const userText = compactText(payload.message);
        if (userText && !isInjectedCodexContext(userText) && !facts.user_messages.includes(userText)) {
            facts.user_messages.push(truncateText(userText, REVIEW_FACT_MAX_USER_MESSAGE_CHARS) || userText);
            addWorkItem(facts, event, "goal", "user", userText);
        }
    }
    if (event.type === "event_msg" && payload.type === "agent_message" && facts.assistant_messages.length < REVIEW_FACT_MAX_ASSISTANT_MESSAGES) {
        const assistantText = compactText(payload.message);
        if (assistantText && !facts.assistant_messages.includes(assistantText)) {
            facts.assistant_messages.push(truncateText(assistantText, REVIEW_FACT_MAX_ASSISTANT_MESSAGE_CHARS) || assistantText);
            addWorkItem(facts, event, "agent_update", "assistant", assistantText);
        }
    }
    if (event.type === "response_item" && isToolCallOutputPayloadType(payload.type)) {
        const callId = toolCallId(payload);
        const matchedCall = callId ? accumulator.pendingCalls.get(callId) ?? null : null;
        const pendingCall = matchedCall ?? (payload.type === "function_call_output" || !callId ? accumulator.lastCall : null);
        const excerpt = boundedFactText(payload.output, REVIEW_FACT_MAX_FAILED_COMMAND_EXCERPT);
        const result = inferToolOutcome(pendingCall?.payload ?? null, payload, excerpt);
        updateMethodOutcome(facts, pendingCall?.methodIndex ?? null, result.outcome, result.exitCode, payload.output);
        if (result.exitCode !== null &&
            result.exitCode !== 0 &&
            facts.failed_commands.length < REVIEW_FACT_MAX_FAILED_COMMANDS) {
            facts.failed_commands.push({
                command: boundedCompactFactText(pendingCall?.command, REVIEW_FACT_MAX_TEXT),
                exit_code: result.exitCode,
                excerpt,
            });
        }
        if (callId)
            accumulator.pendingCalls.delete(callId);
    }
    addChangedFileFacts(facts, event, payload.path);
    addChangedFileFacts(facts, event, payload.file_path);
    addChangedFileFacts(facts, event, payload.changed_files);
    if (isApprovalEvent(event) && facts.approvals.length < REVIEW_FACT_MAX_APPROVALS) {
        const title = compactText(payload.title) || compactText(payload.message) || compactText(payload.type) || "Approval request";
        facts.approvals.push({
            title: truncateText(title, REVIEW_FACT_MAX_TEXT) || "Approval request",
            action_type: truncateText(compactText(payload.action_type) || compactText(payload.actionType), 80),
        });
        addWorkItem(facts, event, "approval", "event", title);
        addMethod(facts, {
            kind: "approval",
            name: compactText(payload.action_type) || compactText(payload.actionType) || "approval",
            command: null,
            outcome: "pending",
            exit_code: null,
            excerpt: title,
            timestamp: eventTimestamp(event),
        });
    }
    const payloadType = compactText(payload.type);
    if (/failed|error/i.test(payloadType) && facts.errors.length < REVIEW_FACT_MAX_ERRORS) {
        const excerpt = boundedFactText(payload.message ?? payload.error ?? payload.detail ?? payload.reason, REVIEW_FACT_MAX_ERROR_EXCERPT);
        if (excerpt) {
            facts.errors.push({
                type: payloadType || "error",
                excerpt,
            });
            addWorkItem(facts, event, "error", "event", excerpt);
        }
    }
}
export function extractCodexReviewFacts(events) {
    const accumulator = createReviewFactsAccumulator();
    for (const event of events)
        processReviewFactEvent(accumulator, event);
    return accumulator.facts;
}
function nextCodexSessionStatus(current, event) {
    const payload = asRecord(event.payload);
    const payloadType = String(payload.type || "");
    const role = String(payload.role || "");
    if (isApprovalEvent(event))
        return "waiting_approval";
    if (event.type === "response_item") {
        if (isToolCallPayloadType(payloadType))
            return "command_running";
        if (/file.*change|patch|diff/i.test(payloadType))
            return "file_changed";
        if (isToolCallOutputPayloadType(payloadType) || payloadType === "reasoning")
            return "running";
        if (payloadType === "message" && role === "assistant")
            return "completed";
        if (payloadType === "message" && role === "user")
            return "running";
        return current;
    }
    if (event.type !== "event_msg")
        return current;
    if (payloadType === "task_complete" || payloadType === "agent_message")
        return "completed";
    if (payloadType === "task_started" || payloadType === "user_message")
        return "running";
    if (/file.*change|patch|diff/i.test(payloadType))
        return "file_changed";
    if (/process.*exit|session.*closed|disconnected/i.test(payloadType))
        return "disconnected";
    if (/failed|error/i.test(payloadType))
        return "failed";
    return current;
}
export function inferCodexSessionStatus(events) {
    let status = "running";
    for (const event of events)
        status = nextCodexSessionStatus(status, event);
    return status;
}
function extractSessionMeta(event) {
    if (event.type !== "session_meta")
        return null;
    const payload = asRecord(event.payload);
    const codexSessionId = compactText(payload.id);
    const workspacePath = compactText(payload.cwd);
    if (!codexSessionId || !workspacePath)
        return null;
    return {
        codexSessionId,
        workspacePath,
        originator: truncateText(compactText(payload.originator), 120),
        source: truncateText(compactText(payload.source), 80),
        cliVersion: truncateText(compactText(payload.cli_version), 80),
    };
}
function absolutePathWithComparableDrive(value) {
    const slashPath = value.trim().replace(/\\/g, "/");
    const wslMount = slashPath.match(/^\/mnt\/([a-z])(?:\/(.*))?$/i);
    if (wslMount) {
        const tail = path.posix.normalize(`/${wslMount[2] ?? ""}`).replace(/^\/+/, "");
        return tail ? `${wslMount[1].toLowerCase()}:/${tail}` : `${wslMount[1].toLowerCase()}:/`;
    }
    if (/^[a-z]:\//i.test(slashPath)) {
        const tail = path.posix.normalize(`/${slashPath.slice(3)}`).replace(/^\/+/, "");
        return tail ? `${slashPath[0].toLowerCase()}:/${tail}` : `${slashPath[0].toLowerCase()}:/`;
    }
    return path.posix.normalize(slashPath);
}
function workspaceRelativeChangedFile(value, workspacePath) {
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    const slashPath = trimmed.replace(/\\/g, "/");
    const looksAbsolute = path.posix.isAbsolute(slashPath) || /^[a-z]:\//i.test(slashPath);
    if (looksAbsolute) {
        const workspaceAbsolute = absolutePathWithComparableDrive(workspacePath).replace(/\/+$/, "");
        const fileAbsolute = absolutePathWithComparableDrive(trimmed);
        const workspacePrefix = `${workspaceAbsolute}/`;
        if (!workspaceAbsolute || !fileAbsolute.toLowerCase().startsWith(workspacePrefix.toLowerCase()))
            return null;
        return fileAbsolute.slice(workspacePrefix.length);
    }
    const normalized = path.posix.normalize(slashPath).replace(/^\.\//, "");
    if (!normalized || normalized === ".." || normalized.startsWith("../"))
        return null;
    return normalized;
}
function normalizeReviewFactPaths(facts, workspacePath) {
    const normalizedFiles = [];
    const pathMap = new Map();
    for (const file of facts.changed_files) {
        const normalized = workspaceRelativeChangedFile(file, workspacePath);
        if (!normalized)
            continue;
        pathMap.set(file, normalized);
        if (!normalizedFiles.includes(normalized))
            normalizedFiles.push(normalized);
    }
    facts.changed_files = normalizedFiles;
    facts.work_items = facts.work_items.filter((item) => {
        if (item.kind !== "file_change")
            return true;
        const normalized = pathMap.get(item.text) ?? workspaceRelativeChangedFile(item.text, workspacePath);
        if (!normalized)
            return false;
        item.text = normalized;
        return true;
    });
    return facts;
}
export function parseCodexSessionFile(filePath, options = {}) {
    const stat = fs.statSync(filePath);
    const reviewAccumulator = createReviewFactsAccumulator();
    const sessionState = { meta: null };
    let firstPromptPreview = null;
    let lastSummary = null;
    let lastOutput = null;
    let lastStatus = "running";
    let earliestTimestamp = null;
    let earliestTime = Number.POSITIVE_INFINITY;
    let lastEventAt = null;
    forEachJsonLineEvent(filePath, options, (event) => {
        sessionState.meta ??= extractSessionMeta(event);
        firstPromptPreview ??= truncateText(userPromptFromEvent(event), 240);
        lastSummary = assistantSummaryFromEvent(event) ?? lastSummary;
        lastOutput = outputFromEvent(event) ?? lastOutput;
        lastStatus = nextCodexSessionStatus(lastStatus, event);
        processReviewFactEvent(reviewAccumulator, event);
        if (typeof event.timestamp === "string") {
            lastEventAt = event.timestamp;
            const eventTime = Date.parse(event.timestamp);
            if (Number.isFinite(eventTime) && eventTime < earliestTime) {
                earliestTime = eventTime;
                earliestTimestamp = event.timestamp;
            }
        }
    });
    const meta = sessionState.meta;
    if (!meta) {
        throw new Error(`Codex session metadata not found in ${filePath}`);
    }
    const displayTitle = truncateText(firstPromptPreview || workspaceName(meta.workspacePath), 48) || "Codex session";
    const sessionStartedAt = resolveSessionStartedAt(earliestTimestamp, stat);
    const reviewFacts = normalizeReviewFactPaths(reviewAccumulator.facts, meta.workspacePath);
    return {
        ...meta,
        filePath,
        firstPromptPreview,
        displayTitle,
        lastSummary,
        lastOutput,
        lastStatus,
        sessionStartedAt,
        lastEventAt,
        fileModifiedAt: stat.mtime.toISOString(),
        reviewFacts,
    };
}
function findRolloutFiles(root, maxFiles) {
    if (!fs.existsSync(root))
        return [];
    const found = [];
    const stack = [root];
    let visitedRolloutFiles = 0;
    while (stack.length && visitedRolloutFiles < maxFiles) {
        const current = stack.pop();
        if (!current)
            continue;
        const childDirectories = [];
        const entries = fs
            .readdirSync(current, { withFileTypes: true })
            .sort((left, right) => right.name.localeCompare(left.name));
        for (const entry of entries) {
            const entryPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                childDirectories.push(entryPath);
                continue;
            }
            if (!entry.isFile() || !/^rollout-.*\.jsonl$/i.test(entry.name))
                continue;
            if (visitedRolloutFiles >= maxFiles)
                break;
            visitedRolloutFiles += 1;
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
export function scanRecentCodexSessionFiles(options) {
    const workspaceFilter = normalizeWorkspacePathIdentity(options.workspacePath);
    const limit = Math.max(1, Math.min(options.limit ?? 10, 50));
    const maxFiles = Math.max(limit, options.maxFiles ?? DEFAULT_SCAN_FILE_LIMIT);
    const summaries = [];
    const scanRoots = [path.join(options.codexHome, "sessions")];
    if (options.wslCodexHome?.trim()) {
        scanRoots.push(path.join(options.wslCodexHome.trim(), "sessions"));
    }
    const perRootMaxFiles = Math.max(1, Math.ceil(maxFiles / scanRoots.length));
    const candidates = scanRoots
        .flatMap((sessionsRoot) => findRolloutFiles(sessionsRoot, perRootMaxFiles))
        .sort((left, right) => right.mtimeMs - left.mtimeMs);
    const seenFilePaths = new Set();
    for (const candidate of candidates) {
        if (seenFilePaths.has(candidate.filePath))
            continue;
        if (seenFilePaths.size >= maxFiles)
            break;
        seenFilePaths.add(candidate.filePath);
        try {
            const summary = parseCodexSessionFile(candidate.filePath);
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
export function buildDesktopPetSessionPayload(summary, codexHome) {
    return {
        pet_session_id: `codex:${summary.codexSessionId}`,
        codex_session_id: summary.codexSessionId,
        workspace_id: null,
        workspace_path: summary.workspacePath,
        codex_home: codexHome,
        display_title: summary.displayTitle,
        first_prompt_preview: summary.firstPromptPreview,
        last_summary: summary.lastSummary,
        last_status: summary.lastStatus,
        launch_mode: "workspace-write",
        remote_url: null,
        app_server_pid: null,
        app_server_port: null,
        metadata: {
            source: "codex-jsonl",
            session_parser_version: CODEX_SESSION_PARSER_VERSION,
            review_facts_version: CODEX_REVIEW_FACTS_VERSION,
            session_file: summary.filePath,
            session_file_mtime: summary.fileModifiedAt,
            session_started_at: summary.sessionStartedAt,
            originator: summary.originator,
            codex_source: summary.source,
            cli_version: summary.cliVersion,
            last_event_at: summary.lastEventAt,
            last_output: summary.lastOutput,
            facts: summary.reviewFacts,
        },
    };
}
