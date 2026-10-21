import path from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED_EVENTS = new Set(["commit", "checkout", "push", "index_changed", "repository_changed"]);
const DEFAULT_TIMEOUT_MS = 3000;

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const key = argument.slice(2);
    values.set(key, argv[index + 1] ?? "");
    index += 1;
  }
  return values;
}

export function buildGitHintRequest(options) {
  const workspaceKey = String(options.workspaceKey ?? "").trim();
  const eventType = String(options.eventType ?? "").trim();
  if (!workspaceKey) throw new Error("缺少 --workspace-key");
  if (!ALLOWED_EVENTS.has(eventType)) throw new Error(`不支持的 Git 事件：${eventType || "<empty>"}`);
  const apiBaseUrl = String(options.apiBaseUrl ?? "http://127.0.0.1:8000").replace(/\/+$/, "");
  return {
    url: `${apiBaseUrl}/codex/knowledge/git-events`,
    body: {
      workspace_key: workspaceKey,
      event_type: eventType,
    },
  };
}

export async function sendGitHint(options, fetchImpl = globalThis.fetch) {
  const request = buildGitHintRequest(options);
  const transportToken = String(options.transportToken ?? "").trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(request.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(transportToken ? { "x-codex-knowledge-transport-token": transportToken } : {}),
      },
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status };
  } finally {
    clearTimeout(timeout);
  }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const values = parseArguments(argv);
  try {
    const result = await sendGitHint({
      workspaceKey: values.get("workspace-key"),
      eventType: values.get("event"),
      apiBaseUrl: values.get("api-base-url") || env.MMD_PET_API_BASE_URL || "http://127.0.0.1:8000",
      transportToken: env.MMD_PET_KNOWLEDGE_HANDOFF_TOKEN,
    });
    if (!result.ok) process.stderr.write(`Git event hint rejected: HTTP ${result.status}\n`);
  } catch (error) {
    // A Git hint must never block commit, checkout, or push. FastAPI reconciliation is the fallback.
    process.stderr.write(`Git event hint unavailable: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  process.exitCode = await main();
}
