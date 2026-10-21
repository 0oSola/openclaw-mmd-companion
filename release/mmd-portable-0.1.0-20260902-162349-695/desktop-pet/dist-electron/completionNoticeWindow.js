import { buildCodexCompletedPresentation } from "./codexPresentation.js";
export const COMPLETION_NOTICE_WINDOW_WIDTH = 286;
export const COMPLETION_NOTICE_COMPACT_HEIGHT = 78;
export const COMPLETION_NOTICE_EXPANDED_HEIGHT = 190;
export const COMPLETION_NOTICE_CARD_GAP = 8;
export const COMPLETION_NOTICE_WINDOW_GAP = 12;
export const MAX_VISIBLE_COMPLETION_NOTICES = 3;
export const MAX_DISMISSED_COMPLETION_NOTICE_KEYS = 100;
function compact(value) {
    return value?.replace(/\s+/g, " ").trim() ?? "";
}
function clamp(value, min, max) {
    if (max < min)
        return min;
    return Math.min(Math.max(value, min), max);
}
function normalizeDismissedKeys(values) {
    const keys = [];
    const seen = new Set();
    for (let index = values.length - 1; index >= 0 && keys.length < MAX_DISMISSED_COMPLETION_NOTICE_KEYS; index -= 1) {
        const key = typeof values[index] === "string" ? compact(values[index]) : "";
        if (!key || seen.has(key))
            continue;
        seen.add(key);
        keys.push(key);
    }
    return keys.reverse();
}
export function parseDismissedCompletionNoticeKeys(value) {
    const stored = value?.trim();
    if (!stored)
        return [];
    try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed))
            return normalizeDismissedKeys(parsed);
        if (typeof parsed === "string")
            return normalizeDismissedKeys([parsed]);
        if (parsed && typeof parsed === "object" && "dismissedKeys" in parsed) {
            const dismissedKeys = parsed.dismissedKeys;
            if (Array.isArray(dismissedKeys))
                return normalizeDismissedKeys(dismissedKeys);
        }
        return [];
    }
    catch {
        return normalizeDismissedKeys([stored]);
    }
}
export function serializeDismissedCompletionNoticeKeys(keys) {
    return JSON.stringify(normalizeDismissedKeys(keys));
}
export function addDismissedCompletionNoticeKey(keys, key) {
    return normalizeDismissedKeys([...keys, key]);
}
export function buildCompletionNotice(status, agentLabel = "Codex") {
    const key = compact(status.completionNoticeKey);
    const workspacePath = compact(status.workspacePath);
    if (status.state !== "completed" || !key || !workspacePath)
        return null;
    const presentation = buildCodexCompletedPresentation(status, agentLabel);
    return {
        key,
        title: presentation.title,
        workspaceLabel: presentation.workspaceLabel,
        taskLabel: presentation.taskLabel,
        outputLines: presentation.outputLines,
        workspacePath,
        ...(compact(status.petSessionId) ? { petSessionId: compact(status.petSessionId) } : {}),
        ...(compact(status.codexSessionId)
            ? { codexSessionId: compact(status.codexSessionId) }
            : {}),
        ...(status.agent === "codex" || status.agent === "claude" ? { agent: status.agent } : {}),
        ...(status.runtime ? { runtime: status.runtime } : {}),
        stopSupported: status.stopSupported === true,
    };
}
export function completionNoticeSummary(notice) {
    return notice.outputLines[0] || "Completed";
}
export function createCompletionNoticeReducerState(dismissedKeys = []) {
    return {
        notices: [],
        expanded: false,
        dismissedKeys: normalizeDismissedKeys(dismissedKeys),
    };
}
export function reduceCompletionNoticeState(state, action) {
    if (action.type === "expand") {
        return state.notices.length ? { ...state, expanded: true } : state;
    }
    if (action.type === "collapse") {
        return state.expanded ? { ...state, expanded: false } : state;
    }
    if (action.type === "dismiss") {
        const key = compact(action.key);
        if (!key)
            return state;
        const notices = state.notices.filter((notice) => notice.key !== key);
        if (notices.length === state.notices.length) {
            return state;
        }
        return {
            ...state,
            notices,
            expanded: notices.length ? state.expanded : false,
            dismissedKeys: addDismissedCompletionNoticeKey(state.dismissedKeys, key),
        };
    }
    const nextNotice = buildCompletionNotice(action.status, action.agentLabel);
    if (!nextNotice || state.dismissedKeys.includes(nextNotice.key)) {
        return state;
    }
    if (state.notices.some((notice) => notice.key === nextNotice.key)) {
        return state;
    }
    return {
        ...state,
        notices: [...state.notices, nextNotice].slice(-MAX_VISIBLE_COMPLETION_NOTICES),
    };
}
export const completionNoticeReducer = reduceCompletionNoticeState;
export function completionNoticeWindowSize(noticeCountOrExpanded, expandedOverride) {
    const noticeCount = Math.min(MAX_VISIBLE_COMPLETION_NOTICES, Math.max(1, typeof noticeCountOrExpanded === "number" ? Math.floor(noticeCountOrExpanded) : 1));
    const expanded = typeof noticeCountOrExpanded === "boolean"
        ? noticeCountOrExpanded
        : Boolean(expandedOverride);
    const height = expanded
        ? noticeCount * COMPLETION_NOTICE_EXPANDED_HEIGHT +
            (noticeCount - 1) * COMPLETION_NOTICE_CARD_GAP
        : COMPLETION_NOTICE_COMPACT_HEIGHT;
    return {
        width: COMPLETION_NOTICE_WINDOW_WIDTH,
        height,
    };
}
export function createCompletionNoticeBrowserWindowOptions(preloadPath) {
    return {
        width: COMPLETION_NOTICE_WINDOW_WIDTH,
        height: COMPLETION_NOTICE_COMPACT_HEIGHT,
        show: false,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: true,
        resizable: false,
        movable: false,
        fullscreenable: false,
        hasShadow: false,
        backgroundColor: "#00000000",
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            preload: preloadPath,
        },
    };
}
export function calculateCompletionNoticePosition(petBounds, noticeSize, workArea, gap = COMPLETION_NOTICE_WINDOW_GAP) {
    const minX = workArea.x;
    const maxX = workArea.x + workArea.width - noticeSize.width;
    const preferredX = petBounds.x + (petBounds.width - noticeSize.width) / 2;
    const preferredY = petBounds.y - noticeSize.height - gap;
    const maxY = workArea.y + workArea.height - noticeSize.height;
    return {
        x: clamp(preferredX, minX, maxX),
        y: clamp(preferredY, workArea.y, maxY),
    };
}
export function toCompletionNoticeWindowState(state) {
    return {
        notices: state.notices,
        expanded: state.expanded,
    };
}
