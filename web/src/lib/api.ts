import { buildTraceHeaders } from "@/lib/trace.js";
import { loadSession } from "@/lib/session";
import { requestServerTtsAudio } from "@/lib/ttsClient.js";
export { sessionVoiceWebSocketUrl } from "@/lib/realtimeVoiceQueue.js";
import type {
  ChatResponse,
  CompanionSharedConfig,
  DailyPodcast,
  MappingConfig,
  MessageBridgeExternalSession,
  MessageBridgeStatus,
  MessageServiceMessage,
  MessageServiceCleanupResult,
  MessageServiceSendResponse,
  MessageServiceSession,
  MotionContextExport,
  MmdMotionAsset,
  MmdModelAsset,
  OpenClawConfig,
  OpenClawConfigSaveResult,
  OpenClawHealthStatus,
  RenderPipeline,
  RuntimeHealthStatus,
  TraceEvent,
  TraceMirror,
  VmdAsset,
  WorkspaceContext,
} from "@/lib/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

function resolveRuntimeApiBaseUrl(): string {
  if (typeof window === "undefined") return API_BASE_URL;
  try {
    const configured = new URL(API_BASE_URL);
    const runtimeHostname = window.location.hostname;
    const configuredHostname = configured.hostname;
    if (
      runtimeHostname &&
      runtimeHostname !== "localhost" &&
      runtimeHostname !== "127.0.0.1" &&
      (configuredHostname === "localhost" || configuredHostname === "127.0.0.1")
    ) {
      configured.hostname = runtimeHostname;
      if (window.location.protocol === "https:") {
        configured.protocol = "https:";
        configured.port = "";
        configured.pathname = "/api";
      }
      return configured.toString().replace(/\/$/, "");
    }
  } catch {
    return API_BASE_URL;
  }
  return API_BASE_URL;
}

function makeUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (typeof window !== "undefined") {
    return `/api/backend${path.startsWith("/") ? path : `/${path}`}`;
  }
  const baseUrl = resolveRuntimeApiBaseUrl();
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

async function requestJSON<T>(
  path: string,
  init: RequestInit & { userId?: string; traceId?: string; directApi?: boolean } = {},
): Promise<T> {
  const { userId, traceId, directApi = false, headers, ...rest } = init;
  const resolvedHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(headers as Record<string, string>),
  };
  const effectiveUserId = userId || loadSession()?.userId || "";
  if (effectiveUserId) resolvedHeaders["x-user-id"] = effectiveUserId;
  const token = loadSession()?.token;
  if (token) resolvedHeaders["Authorization"] = `Bearer ${token}`;
  if (traceId || effectiveUserId) {
    const traceHeaders = buildTraceHeaders(traceId || "", effectiveUserId);
    Object.assign(resolvedHeaders, traceHeaders);
  }
  const baseUrl = resolveRuntimeApiBaseUrl().replace(/\/$/, "");
  const url = directApi ? `${baseUrl}${path.startsWith("/") ? path : `/${path}`}` : makeUrl(path);
  let response: Response;
  try {
    response = await fetch(url, {
      ...rest,
      headers: resolvedHeaders,
      cache: "no-store",
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`API request failed before reaching backend: ${url}. ${detail}`);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.detail || data?.message || `Request failed: ${response.status}`);
  }
  return data as T;
}

export type ChatInput = {
  user_id: string;
  message: string;
  session_id: string;
  history: Array<{ role: "user" | "assistant" | "system"; content: string }>;
};

export async function postChat(input: ChatInput, traceId: string): Promise<ChatResponse> {
  return requestJSON<ChatResponse>("/chat", {
    method: "POST",
    body: JSON.stringify(input),
    userId: input.user_id,
    traceId,
  });
}

export async function getCurrentWorkspace(userId: string): Promise<WorkspaceContext> {
  return requestJSON<WorkspaceContext>("/workspaces/current", {
    method: "GET",
    userId,
  });
}

export async function getLatestDailyPodcast(userId: string): Promise<DailyPodcast> {
  const payload = await requestJSON<{ podcast: DailyPodcast }>("/podcasts/daily/latest", {
    method: "GET",
    userId,
  });
  return payload.podcast;
}

export async function refreshDailyPodcast(userId: string): Promise<DailyPodcast> {
  const payload = await requestJSON<{ podcast: DailyPodcast }>("/podcasts/daily/refresh", {
    method: "POST",
    body: JSON.stringify({}),
    userId,
  });
  return payload.podcast;
}

export async function listDailyPodcasts(userId: string, days = 30): Promise<DailyPodcast[]> {
  const params = new URLSearchParams({ days: String(days) });
  const payload = await requestJSON<{ items: DailyPodcast[] }>(`/podcasts/daily?${params.toString()}`, {
    method: "GET",
    userId,
  });
  return payload.items || [];
}

export async function getDailyPodcast(userId: string, date: string): Promise<DailyPodcast> {
  const payload = await requestJSON<{ podcast: DailyPodcast }>(`/podcasts/daily/${encodeURIComponent(date)}`, {
    method: "GET",
    userId,
  });
  return payload.podcast;
}

export async function listChatSessions(userId: string): Promise<MessageServiceSession[]> {
  const payload = await requestJSON<{ items: MessageServiceSession[] }>("/sessions", {
    method: "GET",
    userId,
  });
  return payload.items || [];
}

export async function createChatSession(
  userId: string,
  payload: { title?: string; selected_model_path?: string | null } = {},
): Promise<MessageServiceSession> {
  const response = await requestJSON<{ session: MessageServiceSession }>("/sessions", {
    method: "POST",
    body: JSON.stringify(payload),
    userId,
  });
  return response.session;
}

export async function getChatSession(userId: string, sessionId: string): Promise<MessageServiceSession> {
  const response = await requestJSON<{ session: MessageServiceSession }>(`/sessions/${encodeURIComponent(sessionId)}`, {
    method: "GET",
    userId,
  });
  return response.session;
}

export async function updateChatSession(
  userId: string,
  sessionId: string,
  payload: { title?: string | null; selected_model_path?: string | null },
): Promise<MessageServiceSession> {
  const response = await requestJSON<{ session: MessageServiceSession }>(`/sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
    userId,
  });
  return response.session;
}

export async function deleteChatSession(userId: string, sessionId: string): Promise<MessageServiceSession> {
  const response = await requestJSON<{ session: MessageServiceSession }>(`/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    userId,
  });
  return response.session;
}

export async function listSessionMessages(userId: string, sessionId: string): Promise<MessageServiceMessage[]> {
  const payload = await requestJSON<{ items: MessageServiceMessage[] }>(
    `/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: "GET",
      userId,
    },
  );
  return payload.items || [];
}

export async function getMessageById(userId: string, messageId: string): Promise<MessageServiceMessage> {
  const payload = await requestJSON<{ message: MessageServiceMessage }>(`/messages/${encodeURIComponent(messageId)}`, {
    method: "GET",
    userId,
  });
  return payload.message;
}

export async function getLatestGreetingMessage(userId: string): Promise<MessageServiceMessage | null> {
  const payload = await requestJSON<{ message: MessageServiceMessage }>("/messages/greetings/latest", {
    method: "GET",
    userId,
  });
  return payload.message;
}

export async function postSessionMessage(
  userId: string,
  sessionId: string,
  payload: { content: string; tts_enabled: boolean; selected_model_path?: string | null },
  traceId: string,
): Promise<MessageServiceSendResponse> {
  return requestJSON<MessageServiceSendResponse>(`/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST",
    body: JSON.stringify(payload),
    userId,
    traceId,
  });
}

export async function regenerateMessageTts(userId: string, messageId: string): Promise<MessageServiceMessage> {
  const payload = await requestJSON<{ message: MessageServiceMessage }>(
    `/messages/${encodeURIComponent(messageId)}/tts/regenerate`,
    {
      method: "POST",
      body: JSON.stringify({}),
      userId,
    },
  );
  return payload.message;
}

export async function markMessageTtsExpired(userId: string, ttsId: string): Promise<void> {
  await requestJSON<{ tts: unknown }>(`/message-tts/${encodeURIComponent(ttsId)}/mark-expired`, {
    method: "POST",
    body: JSON.stringify({}),
    userId,
  });
}

export async function createMotionContextExport(userId: string, selectedModelPath: string): Promise<MotionContextExport> {
  return requestJSON<MotionContextExport>("/motion-context/exports", {
    method: "POST",
    body: JSON.stringify({ selected_model_path: selectedModelPath }),
    userId,
  });
}

export async function getLatestMotionContextExport(
  userId: string,
  selectedModelPath: string,
): Promise<MotionContextExport> {
  const params = new URLSearchParams({ model_key: selectedModelPath });
  return requestJSON<MotionContextExport>(`/motion-context/exports/latest?${params.toString()}`, {
    method: "GET",
    userId,
  });
}

export async function getCompanionSharedConfig(userId: string): Promise<CompanionSharedConfig> {
  return requestJSON<CompanionSharedConfig>("/desktop-pet/shared-config", {
    headers: buildTraceHeaders("", userId),
    directApi: true,
  });
}

export async function putCompanionSharedConfig(
  userId: string,
  payload: { selected_model_path: string | null; render_pipeline: RenderPipeline; reze_stage_document?: Record<string, unknown> | null },
  init: { signal?: AbortSignal } = {},
): Promise<CompanionSharedConfig> {
  return requestJSON<CompanionSharedConfig>("/desktop-pet/shared-config", {
    method: "PUT",
    headers: buildTraceHeaders("", userId),
    body: JSON.stringify(payload),
    signal: init.signal,
    directApi: true,
  });
}

export async function cleanupMessageServiceAdmin(userId: string): Promise<MessageServiceCleanupResult> {
  return requestJSON<MessageServiceCleanupResult>("/admin/message-service/cleanup", {
    method: "POST",
    body: JSON.stringify({}),
    userId,
  });
}

export async function getResolvedMappings(userId: string): Promise<Record<string, MappingConfig>> {
  const payload = await requestJSON<{ mappings: Record<string, MappingConfig> }>(
    `/config/mapping/resolved/${encodeURIComponent(userId)}`,
    { method: "GET", userId },
  );
  return payload.mappings || {};
}

export async function putUserMappings(
  userId: string,
  mappings: Record<string, MappingConfig>,
): Promise<Record<string, MappingConfig>> {
  const payload = await requestJSON<{ mappings: Record<string, MappingConfig> }>(
    `/config/mapping/user/${encodeURIComponent(userId)}`,
    {
      method: "PUT",
      body: JSON.stringify({ mappings }),
      userId,
    },
  );
  return payload.mappings || {};
}

export async function getOpenClawConfig(userId: string): Promise<OpenClawConfig> {
  return requestJSON<OpenClawConfig>("/config/openclaw", {
    method: "GET",
    userId,
  });
}

export async function putOpenClawConfig(
  userId: string,
  payload: {
    base_url: string;
    token?: string | null;
    agent_id: string;
    model: string;
    message_channel: string;
    proxy_url: string;
    verify_ssl: boolean;
    timeout_seconds: number;
  },
): Promise<OpenClawConfigSaveResult> {
  return requestJSON<OpenClawConfigSaveResult>("/config/openclaw", {
    method: "PUT",
    body: JSON.stringify(payload),
    userId,
  });
}

export async function getOpenClawHealth(userId: string): Promise<OpenClawHealthStatus> {
  return requestJSON<OpenClawHealthStatus>("/healthz/openclaw", {
    method: "GET",
    userId,
  });
}

export async function getRuntimeHealth(userId: string): Promise<RuntimeHealthStatus> {
  return requestJSON<RuntimeHealthStatus>("/admin/runtime-health", {
    method: "GET",
    userId,
  });
}

export async function getMessageBridgeStatus(userId: string): Promise<MessageBridgeStatus> {
  return requestJSON<MessageBridgeStatus>("/admin/message-bridge/status", {
    method: "GET",
    userId,
  });
}

export async function patchMessageBridgeSettings(
  userId: string,
  payload: { enabled?: boolean; realtime_drive_character?: boolean },
): Promise<MessageBridgeStatus> {
  return requestJSON<MessageBridgeStatus>("/admin/message-bridge/settings", {
    method: "PATCH",
    body: JSON.stringify(payload),
    userId,
  });
}

export async function listMessageBridgeFeishuSessions(userId: string): Promise<MessageBridgeExternalSession[]> {
  const payload = await requestJSON<{ items: MessageBridgeExternalSession[] }>(
    "/admin/message-bridge/openclaw/feishu/sessions",
    {
      method: "GET",
      userId,
    },
  );
  return payload.items || [];
}

export async function setDefaultMessageBridgeBinding(
  userId: string,
  payload: { provider: string; channel: string; external_session_key: string },
): Promise<MessageBridgeStatus["binding"]> {
  const response = await requestJSON<{ binding: MessageBridgeStatus["binding"] }>("/admin/message-bridge/bindings/default", {
    method: "POST",
    body: JSON.stringify(payload),
    userId,
  });
  return response.binding;
}

export async function listVmdAssets(userId: string): Promise<VmdAsset[]> {
  const payload = await requestJSON<{ items: VmdAsset[] }>(
    `/assets/vmd?user_id=${encodeURIComponent(userId)}`,
    { method: "GET", userId },
  );
  return payload.items || [];
}

export async function listMmdModels(): Promise<MmdModelAsset[]> {
  const payload = await requestJSON<{ items: MmdModelAsset[] }>("/assets/mmd/models", {
    method: "GET",
  });
  return payload.items || [];
}

export async function getV14dGameManifest(): Promise<{
  available?: boolean;
  reason?: string;
  model?: {
    url?: string;
    relativePath?: string;
    sha256?: string | null;
    sizeBytes?: number;
  };
  [key: string]: unknown;
}> {
  return requestJSON("/assets/v14d-game/manifest", { method: "GET" });
}

export async function listMmdMotions(): Promise<MmdMotionAsset[]> {
  const payload = await requestJSON<{ items: MmdMotionAsset[] }>("/assets/mmd/vmds", {
    method: "GET",
  });
  return payload.items || [];
}

export async function uploadVmdAsset(userId: string, slot: string, file: File): Promise<VmdAsset> {
  const form = new FormData();
  form.append("user_id", userId);
  form.append("slot", slot);
  const sourceRelativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath?.trim();
  console.info("[vmd-upload] preparing upload", {
    name: file.name,
    slot,
    sourceRelativePath: sourceRelativePath || null,
  });
  if (sourceRelativePath) {
    form.append("source_relative_path", sourceRelativePath);
  }
  form.append("file", file);

  const response = await fetch(makeUrl("/assets/vmd"), {
    method: "POST",
    headers: { "x-user-id": userId },
    body: form,
    cache: "no-store",
  });
  const data = await response.json();
  console.info("[vmd-upload] upload response", {
    name: file.name,
    sourceRelativePath: sourceRelativePath || null,
    returnedSourceRelativePath: data?.source_relative_path || null,
    assetId: data?.asset_id || null,
  });
  if (!response.ok) throw new Error(data?.detail || `Upload failed: ${response.status}`);
  return data as VmdAsset;
}

export async function updateVmdAsset(
  userId: string,
  assetId: string,
  payload: {
    display_name?: string;
    favorite?: boolean;
    model_relative_path?: string;
  },
): Promise<VmdAsset> {
  return requestJSON<VmdAsset>(`/assets/vmd/${encodeURIComponent(assetId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
    userId,
  });
}

export async function getTraceEvents(
  userId: string,
  query: { traceId?: string; targetUserId?: string } = {},
): Promise<TraceEvent[]> {
  const params = new URLSearchParams();
  if (query.traceId) params.set("trace_id", query.traceId);
  if (query.targetUserId) params.set("user_id", query.targetUserId);
  const payload = await requestJSON<{ items: TraceEvent[] }>(
    `/trace/events${params.toString() ? `?${params.toString()}` : ""}`,
    { method: "GET", userId },
  );
  return payload.items || [];
}

export async function getTraceMirrors(
  userId: string,
  query: { traceId?: string; targetUserId?: string } = {},
): Promise<TraceMirror[]> {
  const params = new URLSearchParams();
  if (query.traceId) params.set("trace_id", query.traceId);
  if (query.targetUserId) params.set("user_id", query.targetUserId);
  const payload = await requestJSON<{ items: TraceMirror[] }>(
    `/trace/mirrors${params.toString() ? `?${params.toString()}` : ""}`,
    { method: "GET", userId },
  );
  return payload.items || [];
}

export type ServerTtsResult =
  | {
      configured: false;
      message: string;
    }
  | {
      configured: true;
      audio: Blob;
      mediaType: string;
      message?: string;
    };

export async function requestServerTts(userId: string, text: string, sessionId?: string): Promise<ServerTtsResult> {
  return requestServerTtsAudio({ userId, text, sessionId, makeUrl }) as Promise<ServerTtsResult>;
}

export { API_BASE_URL, makeUrl };
