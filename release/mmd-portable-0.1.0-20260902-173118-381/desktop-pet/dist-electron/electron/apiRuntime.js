import { spawn as nodeSpawn } from "node:child_process";
import nodeFs from "node:fs";
import path from "node:path";
const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
const DEFAULT_RETRY_DELAY_MS = 750;
const DEFAULT_MAX_ATTEMPTS_AFTER_START = 5;
function normalizeApiBaseUrl(apiBaseUrl) {
    return apiBaseUrl.trim().replace(/\/+$/, "") || DEFAULT_API_BASE_URL;
}
export function resolveApiHealthUrl(apiBaseUrl) {
    return `${normalizeApiBaseUrl(apiBaseUrl)}/healthz`;
}
function enabledByEnv(value) {
    return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}
function runtimeLogPaths(cwd, env) {
    const logDir = env.MMD_PET_API_LOG_DIR?.trim() || path.join(cwd, ".codex-pet", "api-runtime");
    return {
        stdout: path.join(logDir, "api-runtime.out.log"),
        stderr: path.join(logDir, "api-runtime.err.log"),
    };
}
async function probeHealth(fetch, healthUrl) {
    try {
        const response = await fetch(healthUrl);
        if (!response.ok) {
            return {
                ok: false,
                reason: "bad_status",
                statusCode: response.status,
                error: `API health check returned ${response.status}`,
            };
        }
        return { ok: true, statusCode: response.status };
    }
    catch (error) {
        return {
            ok: false,
            reason: "fetch_failed",
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
function unavailableStatus(options) {
    return {
        state: "unavailable",
        available: false,
        apiBaseUrl: options.apiBaseUrl,
        healthUrl: options.healthUrl,
        reason: options.failure.reason,
        attempts: options.attempts,
        started: false,
        checkedAt: options.checkedAt,
        autostart: options.autostart,
        logPaths: options.logPaths,
        statusCode: options.failure.statusCode,
        error: options.failure.error,
    };
}
export async function ensureApiRuntime(options = {}) {
    const env = options.env ?? process.env;
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl ?? env.MMD_PET_API_BASE_URL ?? DEFAULT_API_BASE_URL);
    const healthUrl = resolveApiHealthUrl(apiBaseUrl);
    const fetch = options.fetch ?? globalThis.fetch;
    const spawn = options.spawn ?? nodeSpawn;
    const fs = options.fs ?? nodeFs;
    const now = options.now ?? (() => new Date());
    const sleep = options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
    const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    const autostartEnabled = enabledByEnv(env.MMD_PET_API_AUTOSTART);
    const checkedAt = now().toISOString();
    const initial = await probeHealth(fetch, healthUrl);
    if (initial.ok) {
        return {
            state: "available",
            available: true,
            apiBaseUrl,
            healthUrl,
            attempts: 1,
            started: false,
            checkedAt,
            statusCode: initial.statusCode,
            autostart: { enabled: autostartEnabled, attempted: false, reason: autostartEnabled ? undefined : "disabled" },
        };
    }
    if (!autostartEnabled) {
        return unavailableStatus({
            apiBaseUrl,
            healthUrl,
            checkedAt,
            attempts: 1,
            failure: initial,
            autostart: { enabled: false, attempted: false, reason: "disabled" },
        });
    }
    const command = env.MMD_PET_API_START_COMMAND?.trim();
    if (!command) {
        return unavailableStatus({
            apiBaseUrl,
            healthUrl,
            checkedAt,
            attempts: 1,
            failure: initial,
            autostart: { enabled: true, attempted: false, reason: "missing_command" },
        });
    }
    let logPaths;
    try {
        logPaths = runtimeLogPaths(cwd, env);
        const logDir = path.dirname(logPaths.stdout);
        fs.mkdirSync(logDir, { recursive: true });
        const stdoutFd = fs.openSync(logPaths.stdout, "a");
        const stderrFd = fs.openSync(logPaths.stderr, "a");
        const child = spawn(command, [], {
            cwd,
            detached: true,
            shell: true,
            stdio: ["ignore", stdoutFd, stderrFd],
            windowsHide: true,
        });
        child.unref?.();
    }
    catch (error) {
        return unavailableStatus({
            apiBaseUrl,
            healthUrl,
            checkedAt,
            attempts: 1,
            failure: {
                ok: false,
                reason: "fetch_failed",
                error: error instanceof Error ? error.message : String(error),
            },
            autostart: {
                enabled: true,
                attempted: true,
                reason: "spawn_failed",
                command,
                error: error instanceof Error ? error.message : String(error),
            },
            logPaths,
        });
    }
    let lastFailure = initial;
    const maxAttempts = Math.max(2, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS_AFTER_START);
    for (let attempt = 2; attempt <= maxAttempts; attempt += 1) {
        await sleep(retryDelayMs);
        const next = await probeHealth(fetch, healthUrl);
        if (next.ok) {
            return {
                state: "available",
                available: true,
                apiBaseUrl,
                healthUrl,
                attempts: attempt,
                started: true,
                checkedAt,
                statusCode: next.statusCode,
                autostart: { enabled: true, attempted: true, command },
                logPaths,
            };
        }
        lastFailure = next;
    }
    return unavailableStatus({
        apiBaseUrl,
        healthUrl,
        checkedAt,
        attempts: maxAttempts,
        failure: lastFailure,
        autostart: { enabled: true, attempted: true, command },
        logPaths,
    });
}
