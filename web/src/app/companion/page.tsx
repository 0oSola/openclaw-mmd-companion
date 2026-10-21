"use client";

import { buildCharacterIdleInteraction, characterDefaultAssets } from "@/features/stage/characterIdlePlaylist.js";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createTraceId } from "@/lib/trace.js";
import { DetachedVmdLibrary, type DetachedVmdLibraryHandle } from "./DetachedVmdLibrary";
import { VmdLibraryConfirmation, type LibraryRemovalSelection } from "./VmdLibraryConfirmation";

import {
  buildAutoFavoriteInteraction,
  buildAutoplayResumeInteraction,
  createIdleVmdFallbackInteraction,
  createVmdPreviewInteraction,
 excludeEntryStandbyAssets,
 isEmptyVmdAsset,
 isFavoriteForModel,
  isCompanionSafeVmdAsset,
 selectModelFavoriteVmdAssets,
  isUniversalBuiltInMotionAsset,
  mergeFavoriteMotionAssets,
  resolveAutoplayVmdAssetPool,
  resolveVmdPlaybackRate,
} from "@/features/mapping/vmdPreview.js";
import { resolvePlaybackPlan, shouldUseIdleVmdFallbackForUnmatchedMotion } from "@/features/mapping/resolveAction.js";
import { readPlayerVmdMode, writePlayerVmdMode, applyPlayerVmdMode, normalizePlayerVmdMode } from "@/features/mapping/playerVmdMode.js";
import { MMDStage, type MMDStageHandle } from "@/features/stage/MMDStage";
import { KOLEDA_WEAPON_PREVIEW } from "@/features/stage/stageWeaponPair.js";
import {
  createDefaultRezeStageDocument,
  normalizeRezeStageDocument,
  rezeEditorStorageKey,
  REZE_EXECUTABLE_MATERIAL_PRESETS,
  REZE_GRADE_PRESETS,
  REZE_BACKGROUND_EFFECTS,
  type RezeExecutableMaterialPreset,
  type RezeStageDocument,
} from "@/features/stage/rezeEditorScene";
import {
  REZE_DESIGN_SCENE_DEFAULTS,
  REZE_K3_SCENE_DEFAULTS,
  type RezeSceneDebugSettings,
} from "@/features/stage/rezeDesignDefaults";
import {
  evaluateRezeK3V1Eligibility,
  resolveRezeK3SkinVariant,
  readRezeK3SkinVariant,
  rezeK3SkinVariantStorageKey,
  writeRezeK3SkinVariant,
  REZE_K3_SKIN_VARIANT_LABEL,
} from "@/features/stage/rezeSkinVariantPreference.js";

// RezeK3SkinVariant 共享类型权威：rezeSkinVariantPreference.types.d.ts（P0 第 3 项）。
import type { RezeK3SkinVariant } from "@/features/stage/rezeSkinVariantPreference.js";
import { CompanionCommandBar } from "./CompanionCommandBar";
import { KnowledgeReviewBadge } from "./KnowledgeReviewBadge";
import { BlueprintPage, BlueprintRenderGate } from "./BlueprintPage";
import { MioModeBackground } from "./MioModeBackground";
import { CompanionRightRail, type RightPanelView } from "./CompanionRightRail";
import {
  clearStagePendingAutoResume,
  completeStageInteraction,
  createDefaultStageInteraction,
  resetStageInteraction,
  startAutoplayLoop,
  startChatInteraction,
  startStageClickInteraction,
  startManualPreview,
  updateStageActiveVmdAsset,
} from "@/features/stage/stageInteractionMachine.js";
import {
  createStageClickRipple,
  resolveStageCharacterClickInteraction,
  STAGE_CLICK_RIPPLE_DURATION_MS,
} from "@/features/stage/stageCharacterClick.js";
import {
  DEFAULT_VMD_PLAYBACK_RATE,
} from "@/features/stage/builtInMotionPreferences.js";
import { getModelDisplayLabel, pickInitialModelSelection, pickRememberedModelSelection } from "@/features/stage/modelCatalog.js";
import { createV14dGameModelAsset } from "@/features/stage/v14dGameAppearanceAssets.js";
import { GF2_MODEL_PATH, isGf2StageModel } from "@/features/stage/gf2StageAssets.js";
import {
  companionRenderPipelineStorageKey,
  normalizeRememberedRenderPipeline,
} from "@/features/stage/companionStagePreferences.js";
import {
  buildCompanionSharedConfigPayload,
  saveCompanionSharedConfigWithTimeout,
} from "@/features/stage/companionSharedConfigSave.js";
import { collectImportableVmdFiles } from "@/features/stage/vmdImportHelpers.js";
import {
  cleanupMessageServiceAdmin,
  createMotionContextExport,
  exportFavoriteVmdZip,
  createChatSession,
  deleteChatSession,
  getCompanionSharedConfig,
  getLatestMotionContextExport,
  getLatestDailyPodcast,
  refreshDailyPodcast as requestDailyPodcastRefresh,
  getLatestGreetingMessage,
  getMessageBridgeStatus,
  getOpenClawConfig,
  getOpenClawHealth,
  getMessageById,
  getResolvedMappings,
  getV14dGameManifest,
  listMessageBridgeFeishuSessions,
  listChatSessions,
  listMmdModels,
  listSessionMessages,
  listVmdAssets,
  excludeVmdFromLibrary,
  excludeAllVmdFromLibrary,
  postSessionMessage,
  patchMessageBridgeSettings,
  putOpenClawConfig,
  putCompanionSharedConfig,
  regenerateMessageTts,
  setDefaultMessageBridgeBinding,
  sessionVoiceWebSocketUrl,
  updateChatSession,
  updateVmdAsset,
  uploadVmdAsset,
} from "@/lib/api";
import { AudioQueue } from "@/lib/realtimeVoiceQueue.js";
import {
  resolveMessageBridgeRefresh,
  resolveMessageBridgeSessionSync,
  resolveMessageBridgeStatusLoad,
} from "@/lib/messageBridgeSync.js";
import { resolveEntryGreetingMessage, shouldAutoPlayEntryGreeting } from "@/lib/entryGreeting.js";
import { clearSession, loadSession, saveSession } from "@/lib/session";
import { DEFAULT_TTS_MODE, playRemoteTtsAudio, playServerTtsAudio } from "@/lib/ttsPlayback.js";
import { resolveCompanionNavTarget } from "@/lib/companionNavigation.js";
import type {
  ChatMessage,
  DailyPodcast,
  MappingConfig,
  MessageServiceCleanupResult,
  MessageServiceMessage,
  MessageServiceSession,
  MessageBridgeExternalSession,
  MessageBridgeStatus,
  MotionContextExport,
  MmdCameraSnapshot,
  MmdModelAsset,
  OpenClawConfig,
  OpenClawHealthStatus,
  RealtimeVoiceFallbackMode,
  RealtimeVoiceStatus,
  RenderPipeline,
  UserSession,
  VmdAsset,
} from "@/lib/types";

type InteractionStep = {
  template: string;
  action: string;
  durationMs: number;
  intensity: number;
};

type InteractionState = {
  emotion: string;
  action: string;
  mode: "procedural" | "vmd";
  vmdUrl: string;
  vmdLoopUrls?: string[];
  vmdLoopEmotionByUrl?: Record<string, string>;
  standbyVmdUrl?: string;
  loopGapMs?: number;
  loopMode?: "random" | "sequential";
  lockLowerBody?: boolean;
  lockRootPosition?: boolean;
  bakedBoneAnimation?: boolean;
  playerVmdMode?: "baked" | "standard";
  vmdBakedBoneAnimationByUrl?: Record<string, boolean>;
  disableCrossfade?: boolean;
  playbackRate?: number;
  vmdRequestId?: number;
  sequence: InteractionStep[];
};

type InteractionSource = "default" | "autoplay" | "manual-preview" | "chat" | "stage-click";
type StageDebugTab = "scene" | "materials" | "assets" | "render";
type StageMaterialDebugEntry = {
  id: string;
  name: string;
  meshName: string;
  preset: string;
  visible: boolean;
  opacity: number;
  emissiveIntensity: number;
  supportsOpacity?: boolean;
  supportsEmissive?: boolean;
};
type RezeMaterialStyleGroupId = "body" | "eye" | "face" | "hair" | "smooth-cloth" | "ungrouped";
type RezeMaterialStyleGroup = {
  id: RezeMaterialStyleGroupId;
  label: string;
  preset: RezeExecutableMaterialPreset | null;
};
type RezeLocalModelImport = {
  revision: number;
  files: File[];
  pmxFile: File;
};
const REZE_SCENE_DEBUG_DEFAULTS = REZE_DESIGN_SCENE_DEFAULTS;

// Reze NPR 仍使用 Three.js 的独立相机与灯光构图。不能把 Reze Design 的
// targetY=11.4 / distance=26.2 套入 NPR，否则编辑器首次同步场景参数时会把
// 角色移出 NPR 相机的可视范围。
const REZE_NPR_SCENE_DEBUG_DEFAULTS: RezeSceneDebugSettings = {
  sunAzimuth: 0,
  sunElevation: 28,
  keyIntensity: 1.86,
  ambientIntensity: 0.82,
  bloomThreshold: 0.5,
  bloomKnee: 0.5,
  bloomRadius: 4.0,
  bloomStrength: 0.06,
  cameraDistance: 31.5,
  cameraTargetX: -1.2,
  cameraTargetY: 1.05,
  cameraTargetZ: 0.45,
  sunColor: "#fff7f0",
  worldColor: "#8ea6c9",
  bloomColor: "#ff9bce",
  backgroundColor: "#0f172b",
  groundColor: "#0f172b",
  groundSize: 44,
  groundOpacity: 0.16,
  groundShadow: true,
  groundGridColor: "#fafaf9",
  groundGridEnabled: false,
};

const REZE_MATERIAL_STYLE_GROUPS: readonly RezeMaterialStyleGroup[] = [
  { id: "body", label: "Body", preset: "角色皮肤" },
  { id: "eye", label: "Eye", preset: "眼睛" },
  { id: "face", label: "Face", preset: "面部" },
  { id: "hair", label: "Hair", preset: "头发" },
  { id: "smooth-cloth", label: "Smooth Cloth", preset: "柔滑布料" },
  { id: "ungrouped", label: "未分组", preset: null },
];

function resolveRezeMaterialStyleGroup(entry: StageMaterialDebugEntry): RezeMaterialStyleGroupId {
  const description = `${entry.name} ${entry.meshName} ${entry.preset}`.toLowerCase();
  if (/(eye|brow|lash|瞳|眉|睫)/.test(description)) return "eye";
  if (/(face|teeth|tongue|mouth|lip|脸|牙|舌|嘴)/.test(description)) return "face";
  if (/(hair|发)/.test(description)) return "hair";
  if (/(body|skin|stocking|肌肤|皮肤|丝袜)/.test(description)) return "body";
  if (/(cloth|cape|shoe|glove|pants|pouch|top|dress|skirt|coat|jacket|shirt|布|披风|鞋|手套|裤|裙|上衣)/.test(description)) {
    return "smooth-cloth";
  }
  return "ungrouped";
}

function getRezeSceneDebugDefaults(pipeline: RenderPipeline): RezeSceneDebugSettings {
  if (pipeline === "reze-npr") return REZE_NPR_SCENE_DEBUG_DEFAULTS;
  if (pipeline === "reze-k3") return REZE_K3_SCENE_DEFAULTS;
  return REZE_SCENE_DEBUG_DEFAULTS;
}
type StageInteractionMode =
  | "default_idle"
  | "autoplay_loop"
  | "manual_preview"
  | "chat_vmd_action"
  | "chat_procedural_action"
  | "stage_click_vmd_action"
  | "stage_click_procedural_action"
  | "recovering";
type StageClickRipple = {
  id: string;
  x: number;
  y: number;
  xPercent?: number;
  yPercent?: number;
};
type StageInteractionViewState = {
  mode: StageInteractionMode;
  source: InteractionSource;
  interaction: InteractionState;
  activeVmdAssetId: string;
  pendingAutoResume: boolean;
};
type ToastState = { id: number; message: string } | null;
type ChatMessageTts = NonNullable<ChatMessage["tts"]>;
type SpeechVisemeFrame = { viseme: string; weight?: number } | null;
type OpenClawDraft = {
  base_url: string;
  token: string;
  token_configured: boolean;
  agent_id: string;
  model: string;
  message_channel: string;
  proxy_url: string;
  verify_ssl: boolean;
  timeout_seconds: string;
};
type RealtimeVoiceServerEvent = {
  type: "queued" | "synthesis_started" | "audio_ready" | "done" | "rejected" | "error" | "cancelled";
  session_id?: string;
  message_id?: string;
  job_id?: string;
  queue_position?: number;
  sequence?: number;
  text?: string;
  audio_url?: string;
  duration?: number | null;
  elapsed_seconds?: number | null;
  reason?: string;
  fallback?: string;
  detail?: string;
};
type RealtimeAudioQueue = {
  enqueue: (chunk: {
    jobId: string;
    messageId?: string;
    sequence: number;
    url: string;
    text?: string;
    duration?: number | null;
  }) => void;
  clear: (options?: { resetHistory?: boolean }) => void;
  fallbackForJobError: (jobId: string) => RealtimeVoiceFallbackMode;
  hasPlayedChunk: (jobId: string) => boolean;
};
type RealtimeAudioQueueCtor = new (options?: {
  AudioCtor?: typeof Audio;
  setSpeechLevel?: (level: number) => void;
  setSpeechViseme?: (frame: SpeechVisemeFrame) => void;
  onError?: (event: { jobId: string; messageId?: string; fallback: RealtimeVoiceFallbackMode; error?: Error }) => void;
  onChunkStart?: (entry: { jobId: string; messageId?: string }) => void;
  onChunkEnd?: (entry: { jobId: string; messageId?: string }) => void;
}) => RealtimeAudioQueue;

const SPRITE = "/images/sprite-sliced";
const MESSAGE_BRIDGE_POLL_INTERVAL_MS = 2500;
const DEFAULT_MODEL_RELATIVE_PATH = "优菈.pmx";
const DEFAULT_COMPANION_TTS_MODE = DEFAULT_TTS_MODE as "browser" | "server";
const DEFAULT_ASSISTANT_COPY =
  "\u6211\u7406\u89e3\u4f60\u7684\u9700\u6c42\u4e86\uff5e\n\u6b63\u5728\u5e2e\u4f60\u62c6\u89e3\u4efb\u52a1\u5e76\u89c4\u5212\u6b65\u9aa4\uff01";
const INPUT_LABEL =
  "\u8f93\u5165\u4f60\u7684\u6307\u4ee4 / \u4efb\u52a1 / \u95ee\u9898...\uff08Enter \u53d1\u9001\uff0cShift + Enter \u6362\u884c\uff09";

function isRezeEditorPipeline(pipeline: RenderPipeline): boolean {
  return pipeline === "reze-design" || pipeline === "reze-npr" || pipeline === "reze-k3";
}

function normalizeRenderPipeline(value?: string): RenderPipeline {
  if (value === "classic" || value === "hero-shot" || value === "genshin" || value === "mio-reference" || value === "reze-npr" || value === "reze-design" || value === "k3" || value === "reze-k3" || value === "v14d-game" || value === "gf2") {
    return value;
  }
  return "mio-reference";
}

const navIcons: ReadonlyArray<{ key: "menu" | "chat" | "tasks" | "tools" | "memory" | "skills"; label: string; view: RightPanelView }> = [
  { key: "menu", label: "\u83dc\u5355", view: "overview" },
  { key: "chat", label: "\u5bf9\u8bdd", view: "chat" },
  { key: "tasks", label: "\u4efb\u52a1", view: "tasks" },
  { key: "tools", label: "\u5de5\u5177", view: "tools" },
  { key: "memory", label: "\u8bb0\u5fc6", view: "memory" },
  { key: "skills", label: "\u80fd\u529b", view: "skills" },
] as const;

function renderSidebarIcon(icon: (typeof navIcons)[number]["key"] | "settings"): ReactNode {
  switch (icon) {
    case "menu":
      return (
        <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
          <path d="M4 5.25h12M4 10h12M4 14.75h12" />
        </svg>
      );
    case "chat":
      return (
        <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
          <path d="M5.25 5.5h9.5a2.25 2.25 0 0 1 2.25 2.25v4.5a2.25 2.25 0 0 1-2.25 2.25H9l-3.5 2.5v-2.5H5.25A2.25 2.25 0 0 1 3 12.25v-4.5A2.25 2.25 0 0 1 5.25 5.5Z" />
          <path d="M6.8 10h.01M10 10h.01M13.2 10h.01" />
        </svg>
      );
    case "tasks":
      return (
        <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
          <path d="M7 4.75h6" />
          <path d="M7.25 3h5.5a1 1 0 0 1 1 1v1.25h1A2.25 2.25 0 0 1 17 7.5v8.25A2.25 2.25 0 0 1 14.75 18h-9.5A2.25 2.25 0 0 1 3 15.75V7.5a2.25 2.25 0 0 1 2.25-2.25h1V4a1 1 0 0 1 1-1Z" />
          <path d="M6.75 9.5h6.5M6.75 12.5h4.75" />
        </svg>
      );
    case "tools":
      return (
        <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
          <path d="M10 3.2l5.85 3.35v6.9L10 16.8l-5.85-3.35v-6.9L10 3.2Z" />
          <path d="M10 3.2v6.8m5.85-3.45L10 10M4.15 6.55 10 10" />
        </svg>
      );
    case "memory":
      return (
        <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
          <path d="M7.2 5.25A2.95 2.95 0 0 0 4.25 8.2v3.6a2.95 2.95 0 0 0 2.95 2.95h.8v1.1a.65.65 0 0 0 1.03.52l1.94-1.62h1.83a2.95 2.95 0 0 0 2.95-2.95V8.2a2.95 2.95 0 0 0-2.95-2.95H7.2Z" />
          <path d="M7 10a3 3 0 0 1 6 0M10 7.75v4.5M7.75 10h4.5" />
        </svg>
      );
    case "skills":
      return (
        <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
          <path d="M11.1 3.6 6.7 10.1h3l-1 6.3 4.6-7h-3.1l.9-5.8Z" />
        </svg>
      );
    case "settings":
      return (
        <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
          <path d="M10 3.7v1.45M10 14.85v1.45M5.15 10H3.7M16.3 10h-1.45" />
          <circle cx="10" cy="10" r="2.8" />
          <path d="M6.15 6.15 5.1 5.1M14.9 14.9l-1.05-1.05M13.85 6.15 14.9 5.1M5.1 14.9l1.05-1.05" />
        </svg>
      );
    default:
      return null;
  }
}

const nextSteps = [
  "\u751f\u6210\u9700\u6c42\u6587\u6863\u5927\u7eb2",
  "\u7ade\u54c1\u8c03\u7814\u4e0e\u5206\u6790",
  "\u8f93\u51fa\u521d\u7248\u9700\u6c42\u6587\u6863",
];

const memoryNotes = [
  "\u4f60\u504f\u597d\u7ed3\u6784\u5316\u8868\u8fbe\u65b9\u5f0f",
  "\u5e38\u7528\u5de5\u5177\uff1aNotion / VS Code",
  "\u5173\u6ce8\u70b9\uff1a\u6548\u7387\u3001\u53ef\u6269\u5c55\u6027\u3001UI \u8bbe\u8ba1",
];

const traceRows = [
  ["POST", "/v1/chat/completions", "200", "2.1s"],
  ["GET", "/v1/search", "200", "1.2s"],
  ["POST", "/v1/plan", "200", "3.4s"],
  ["POST", "/v1/memory/save", "200", "0.8s"],
  ["GET", "/v1/tools/list", "200", "0.6s"],
] as const;

const renderPipelineOptions: { value: RenderPipeline; label: string; description: string }[] = [
  { value: "gf2", label: "GF2 mode", description: "克莱妲原皮 · 原游戏材质与兵营光照" },
  { value: "mio-reference", label: "MIO Reference", description: "设计稿星海舞台" },
  { value: "k3", label: "K3", description: "精细渲染·高清阴影·轮廓线" },
  { value: "classic", label: "Classic", description: "\u7a33\u5b9a MMD \u821e\u53f0" },
  { value: "hero-shot", label: "Hero Shot", description: "\u7535\u5f71\u611f\u6784\u56fe" },
  { value: "genshin", label: "Genshin", description: "Project2 \u900f\u660e\u98ce\u683c" },
  { value: "reze-npr", label: "Reze NPR", description: "reze-engine \u5b9e\u9a8c\u98ce\u683c" },
  { value: "reze-design", label: "Reze Design", description: "Reze \u706f\u5149\u00b7MIO \u661f\u6d77\u821e\u53f0" },
  { value: "reze-k3", label: "Reze K3", description: "Reze WebGPU \u590d\u523b\u00b7\u6750\u8d28\u4e0e\u573a\u666f" },
  { value: "v14d-game", label: "frontline", description: "\u672c\u673a\u9650\u5b9a\uff1aKoleda \u767d\u540d\u5355\u6750\u8d28\u3001\u516d\u706f\u4e0e\u672c\u673a OCIO\uff1b\u8bb8\u53ef\u672a\u786e\u8ba4\uff0c\u4e0d\u8fdb\u5165\u53d1\u5e03\u5305" },
];

const MIO_REFERENCE_CAMERA_DEFAULT: MmdCameraSnapshot = {
  fov: 32,
  position: [-9.39, 12.522935, 43.63],
  target: [-1.861732, -2.847643, 1.048369],
  locked: false,
};

const EMOTION_SLOTS = ["neutral", "happy", "sad", "thinking", "excited", "caring"] as const;

function createDefaultInteractionState(): InteractionState {
  return createDefaultStageInteraction() as InteractionState;
}

function createOpenClawDraft(config?: OpenClawConfig | null): OpenClawDraft {
  return {
    base_url: config?.base_url || "http://127.0.0.1:18789",
    token: "",
    token_configured: Boolean(config?.token_configured),
    agent_id: config?.agent_id || "main",
    model: config?.model || "",
    message_channel: config?.message_channel || "feishu",
    proxy_url: config?.proxy_url || "",
    verify_ssl: config?.verify_ssl ?? true,
    timeout_seconds: String(config?.timeout_seconds ?? 15),
  };
}

function makeHistory(messages: ChatMessage[]) {
  return messages
    .filter((item) => item.role === "user" || item.role === "assistant")
    .slice(-16)
    .map((item) => ({ role: item.role, content: item.content }));
}

function createMessageId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function mapServerTtsToChatTts(messageTts?: MessageServiceMessage["tts"] | null): ChatMessage["tts"] | undefined {
  if (!messageTts) return undefined;
  return {
    id: messageTts.id,
    status: messageTts.status,
    mode: "server",
    provider: messageTts.provider,
    version: messageTts.version,
    mediaType: messageTts.media_type || undefined,
    remoteAudioUrl: messageTts.remote_audio_url || undefined,
    proxyAudioUrl: messageTts.proxy_audio_url || undefined,
    durationSeconds: messageTts.duration_seconds || undefined,
    taskId: messageTts.task_id || undefined,
    error: messageTts.error || undefined,
  };
}

function mapServerMessageToChatMessage(message: MessageServiceMessage): ChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    visibility: message.visibility,
    createdAt: message.created_at,
    traceId: message.trace_id || undefined,
    tts: mapServerTtsToChatTts(message.tts),
  };
}

function formatMessageBridgeSessionLabel(item: MessageBridgeExternalSession): string {
  const name = item.external_display_name || "Feishu";
  const keyTail = item.external_session_key.split(":").slice(-2).join(":");
  const isTargetDirect =
    item.external_session_key === "agent:main:feishu:direct:ou_229011826b88e09badbbb6f43ad38ba3";
  const channelKind = item.external_session_key.includes(":direct:") ? "direct" : "session";
  return `${isTargetDirect ? "[当前直连] " : ""}${name} · ${channelKind} · ${keyTail}`;
}

export default function CompanionPage() {
  const router = useRouter();
  const stageRef = useRef<MMDStageHandle | null>(null);
  const stageActionRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousInteractionRef = useRef<InteractionState | null>(null);
  const serverAudioRef = useRef<HTMLAudioElement | null>(null);
  const serverAudioCleanupRef = useRef<(() => void) | null>(null);
  const podcastAudioStopRef = useRef<(() => void) | null>(null);
  const ignoreNextStageCompletionResetRef = useRef(false);
  const pendingTtsPollersRef = useRef<Set<string>>(new Set());
  const playedEntryGreetingIdsRef = useRef<Set<string>>(new Set());
  const voiceSocketRef = useRef<WebSocket | null>(null);
  const audioQueueRef = useRef<RealtimeAudioQueue | null>(null);
  const realtimeVoiceJobMessageRef = useRef<Map<string, string>>(new Map());
  const cancelledRealtimeVoiceJobsRef = useRef<Set<string>>(new Set());
  const messagesRef = useRef<ChatMessage[]>([]);
  const sessionRef = useRef<UserSession | null>(null);
  const chatSessionIdRef = useRef("");
  const messageBridgeStatusRef = useRef<MessageBridgeStatus | null>(null);
  const messageBridgeSessionsRef = useRef<MessageBridgeExternalSession[]>([]);
  const messageBridgeSelectedSessionKeyRef = useRef("");
  const [session, setSession] = useState<UserSession | null>(null);
  const [dailyPodcast, setDailyPodcast] = useState<DailyPodcast | null>(null);
  const [chatSessions, setChatSessions] = useState<MessageServiceSession[]>([]);
  const [chatSessionId, setChatSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [entryGreetingMessage, setEntryGreetingMessage] = useState<ChatMessage | null>(null);
  const [chatAutoScrollRevision, setChatAutoScrollRevision] = useState(0);
  const [input, setInput] = useState("");
  const [chatBootstrapping, setChatBootstrapping] = useState(false);
  const [modelCatalogLoaded, setModelCatalogLoaded] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<ToastState>(null);
  const [stageInteractionState, setStageInteractionState] = useState<StageInteractionViewState>(
    () =>
      resetStageInteraction({
        defaultInteraction: createDefaultInteractionState(),
      }) as StageInteractionViewState,
  );
  const stageInteractionStateRef = useRef<StageInteractionViewState>(stageInteractionState);
  stageInteractionStateRef.current = stageInteractionState;
  const [stageClickRipples, setStageClickRipples] = useState<StageClickRipple[]>([]);
  const lastStageClickVmdAssetIdRef = useRef("");
  const vmdPreviewRequestIdRef = useRef(0);
  const [mappings, setMappings] = useState<Record<string, MappingConfig>>({});
  const [assets, setAssets] = useState<VmdAsset[]>([]);
  const [models, setModels] = useState<MmdModelAsset[]>([]);
  const [selectedModelPath, setSelectedModelPath] = useState("");
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [ttsMode, setTtsMode] = useState<"browser" | "server">(DEFAULT_COMPANION_TTS_MODE);
  const [speaking, setSpeaking] = useState(false);
  const [activeTtsMessageId, setActiveTtsMessageId] = useState("");
  const [realtimeVoiceStatus, setRealtimeVoiceStatus] = useState<RealtimeVoiceStatus>("idle");
  const [backgroundActivityPulse, setBackgroundActivityPulse] = useState(0);
  const [renderPipeline, setRenderPipeline] = useState<RenderPipeline>("mio-reference");
  // Reze K3 皮肤变体（"原始 Reze K3" / "Reze K3 V1（V14D）"）：
  // 按 用户+模型+reze-k3 管线 隔离持久化；仅克莱妲权威 PMX 可启用 V1，
  // 非克莱妲安全回退 original。详见 rezeSkinVariantPreference.js 概念注释。
  const [rezeK3SkinVariant, setRezeK3SkinVariant] = useState<RezeK3SkinVariant>("original");
  // P0-1 水合竞态：写 effect 只在对应 user+model+pipeline 的恢复完成后运行。
  // 记录已完成恢复的存储键；null 表示尚未对当前键完成读取，禁止写回。
  const [rezeK3SkinVariantHydratedKey, setRezeK3SkinVariantHydratedKey] = useState<string | null>(null);
  const [isAdvancedPanelOpen, setIsAdvancedPanelOpen] = useState(false);
  const [isRezeEditorOpen, setIsRezeEditorOpen] = useState(false);
  const [advancedTab, setAdvancedTab] = useState<"library" | "favorites">("library");
  const detachedVmdLibraryRef = useRef<DetachedVmdLibraryHandle>(null);
  const [advancedSlot, setAdvancedSlot] = useState<(typeof EMOTION_SLOTS)[number]>("happy");
  const [advancedFavoriteSlotFilter, setAdvancedFavoriteSlotFilter] = useState<"all" | (typeof EMOTION_SLOTS)[number]>(
    "all",
  );
  const [advancedPlaybackRate, setAdvancedPlaybackRate] = useState("1");
  const [weaponVisible, setWeaponVisible] = useState(true);
  const [weaponState, setWeaponState] = useState({ phase: "hidden", detail: "武器已隐藏" });
  const weaponSupported = selectedModelPath === KOLEDA_WEAPON_PREVIEW.modelPath
    && renderPipeline !== "reze-design" && renderPipeline !== "reze-k3";
  const [playerVmdMode, setPlayerVmdMode] = useState<"baked" | "standard">("baked");
  useEffect(() => {
    const userId = session?.userId || "";
    setPlayerVmdMode(readPlayerVmdMode(window.localStorage, userId));
  }, [session?.userId]);
  const [advancedBusy, setAdvancedBusy] = useState(false);
  const [libraryRemoval, setLibraryRemoval] = useState<LibraryRemovalSelection | null>(null);
  const libraryRemovalInFlight = useRef(false);
  const [favoriteExportBusy, setFavoriteExportBusy] = useState(false);
  const favoriteExportInFlight = useRef(false);
  const [advancedError, setAdvancedError] = useState("");
  const [advancedMessage, setAdvancedMessage] = useState("");
  const [sharedConfigSaving, setSharedConfigSaving] = useState(false);
  const [latestMotionContextExport, setLatestMotionContextExport] = useState<MotionContextExport | null>(null);
  const [cameraEditMode, setCameraEditMode] = useState(false);
  const [stageDebugTab, setStageDebugTab] = useState<StageDebugTab>("scene");
  const [stageMaterialDebugEntries, setStageMaterialDebugEntries] = useState<StageMaterialDebugEntry[]>([]);
  const [selectedRezeMaterialId, setSelectedRezeMaterialId] = useState("");
  const [isRezeMaterialLibraryOpen, setIsRezeMaterialLibraryOpen] = useState(false);
  const [rezeLocalModelImport, setRezeLocalModelImport] = useState<RezeLocalModelImport | null>(null);
  const [rezeSceneDebugSettings, setRezeSceneDebugSettings] = useState<RezeSceneDebugSettings>(REZE_SCENE_DEBUG_DEFAULTS);
  const [rezeStageDocument, setRezeStageDocument] = useState<RezeStageDocument>(() => createDefaultRezeStageDocument(REZE_SCENE_DEBUG_DEFAULTS));
  const [renameTarget, setRenameTarget] = useState<VmdAsset | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [isCompactHud, setIsCompactHud] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isRightRailCollapsed, setIsRightRailCollapsed] = useState(true);
  const [activeRightPanelView, setActiveRightPanelView] = useState<RightPanelView>("overview");
  const [isOpenClawSettingsOpen, setIsOpenClawSettingsOpen] = useState(false);
  const [openClawDraft, setOpenClawDraft] = useState<OpenClawDraft>(createOpenClawDraft);
  const [openClawSavedConfig, setOpenClawSavedConfig] = useState<OpenClawConfig | null>(null);
  const [openClawHealth, setOpenClawHealth] = useState<OpenClawHealthStatus | null>(null);
  const [openClawLoading, setOpenClawLoading] = useState(false);
  const [openClawSaving, setOpenClawSaving] = useState(false);
  const [openClawTesting, setOpenClawTesting] = useState(false);
  const [openClawError, setOpenClawError] = useState("");

  const rezeMaterialGroups = useMemo(
    () => REZE_MATERIAL_STYLE_GROUPS.map((group) => ({
      ...group,
      entries: stageMaterialDebugEntries.filter((entry) => resolveRezeMaterialStyleGroup(entry) === group.id),
    })).filter((group) => group.entries.length > 0),
    [stageMaterialDebugEntries],
  );
  const selectedRezeMaterial = useMemo(
    () => stageMaterialDebugEntries.find((entry) => entry.id === selectedRezeMaterialId) ?? null,
    [selectedRezeMaterialId, stageMaterialDebugEntries],
  );
  const [openClawMessage, setOpenClawMessage] = useState("");
  const [messageBridgeStatus, setMessageBridgeStatus] = useState<MessageBridgeStatus | null>(null);
  const [messageBridgeSessions, setMessageBridgeSessions] = useState<MessageBridgeExternalSession[]>([]);
  const [messageBridgeSelectedSessionKey, setMessageBridgeSelectedSessionKey] = useState("");
  const [messageBridgeSessionListError, setMessageBridgeSessionListError] = useState("");
  const [messageBridgeLoading, setMessageBridgeLoading] = useState(false);
  const [messageBridgeSaving, setMessageBridgeSaving] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const interaction = useMemo(() => applyPlayerVmdMode(stageInteractionState.interaction, playerVmdMode),
    [stageInteractionState.interaction, playerVmdMode]);
  const activeVmdAssetId = stageInteractionState.activeVmdAssetId;
  const interactionSource = stageInteractionState.source;

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    chatSessionIdRef.current = chatSessionId;
  }, [chatSessionId]);

  useEffect(() => {
    messageBridgeStatusRef.current = messageBridgeStatus;
  }, [messageBridgeStatus]);

  useEffect(() => {
    messageBridgeSessionsRef.current = messageBridgeSessions;
  }, [messageBridgeSessions]);

  useEffect(() => {
    messageBridgeSelectedSessionKeyRef.current = messageBridgeSelectedSessionKey;
  }, [messageBridgeSelectedSessionKey]);

  useEffect(() => {
    if (previousInteractionRef.current === interaction) return;
    previousInteractionRef.current = interaction;
    clearStageActionRecoveryTimer();
  }, [interaction]);

  useEffect(() => {
    if (!session?.userId || !selectedModelPath) return;
    const controller = new AbortController();
    const payload = buildCompanionSharedConfigPayload({
      selectedModelPath,
      renderPipeline,
      rezeStageDocument,
      rezeSceneDebugSettings,
    });
    const timeoutId = window.setTimeout(() => {
      putCompanionSharedConfig(
        session.userId,
        payload,
        { signal: controller.signal },
      ).catch(() => {
        // Shared config is best-effort. Local companion state must not break.
      });
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [
    rezeSceneDebugSettings,
    rezeStageDocument,
    renderPipeline,
    selectedModelPath,
    session?.userId,
  ]);

  useEffect(() => {
    if (!session?.userId) return;
    window.localStorage.setItem(companionRenderPipelineStorageKey(session.userId), renderPipeline);
  }, [renderPipeline, session?.userId]);

  // 皮肤变体：切换 用户/模型/管线 时读取持久化值（默认 original）。
  // P0-1：先按当前键完成水合（读取+置 hydratedKey），再允许写回；
  // 切换模型/用户/管线时键变化会触发重新水合，避免把前一个键的值写到新键。
  useEffect(() => {
    if (!session?.userId || !selectedModelPath || renderPipeline !== "reze-k3") {
      setRezeK3SkinVariantHydratedKey(null);
      return;
    }
    const key = rezeK3SkinVariantStorageKey(session.userId, selectedModelPath);
    setRezeK3SkinVariant(
      readRezeK3SkinVariant(window.localStorage, key),
    );
    setRezeK3SkinVariantHydratedKey(key);
  }, [renderPipeline, selectedModelPath, session?.userId]);

  // 皮肤变体：切换时写回持久化（original 为默认值，清除键）。
  // P0-1：仅当当前键已完成水合（hydratedKey 等于当前键）才写回，
  // 防止刷新时写 effect 以初始 original 先于读取执行 removeItem 清掉已存 v1。
  useEffect(() => {
    if (!session?.userId || !selectedModelPath || renderPipeline !== "reze-k3") return;
    const key = rezeK3SkinVariantStorageKey(session.userId, selectedModelPath);
    if (rezeK3SkinVariantHydratedKey !== key) return;
    writeRezeK3SkinVariant(
      window.localStorage,
      key,
      rezeK3SkinVariant,
    );
  }, [renderPipeline, rezeK3SkinVariant, rezeK3SkinVariantHydratedKey, selectedModelPath, session?.userId]);

  useEffect(() => {
    return () => {
      clearStageActionRecoveryTimer();
    };
  }, []);

  useEffect(() => {
    const saved = loadSession();
    const normalizedPipeline: RenderPipeline = normalizeRememberedRenderPipeline(
      saved?.userId ? window.localStorage.getItem(companionRenderPipelineStorageKey(saved.userId)) : "",
    ) as RenderPipeline;
    const normalizedSession = saved
      ? {
          ...saved,
          renderPipeline: normalizedPipeline,
          ttsEnabled: saved.ttsEnabled ?? true,
          ttsMode: DEFAULT_COMPANION_TTS_MODE,
          mmdCamera: {
            ...(saved?.mmdCamera || {}),
            "mio-reference": MIO_REFERENCE_CAMERA_DEFAULT,
          },
        }
      : null;
    setSession(normalizedSession ?? null);
    setRenderPipeline(normalizedPipeline);
    setTtsEnabled(normalizedSession?.ttsEnabled ?? true);
    setTtsMode(DEFAULT_COMPANION_TTS_MODE);
    if (normalizedSession) {
      saveSession(normalizedSession);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setChatBootstrapping(true);

    (async () => {
      try {
        const [mappingRows, sharedConfig] = await Promise.all([
          getResolvedMappings(session.userId),
          getCompanionSharedConfig(session.userId).catch(() => null),
        ]);
        if (cancelled) return;

        const effectivePipeline =
          renderPipeline === "mio-reference"
            ? (normalizeRememberedRenderPipeline(sharedConfig?.render_pipeline) as RenderPipeline)
            : renderPipeline;
        const modelRowsPromise: Promise<MmdModelAsset[]> =
          effectivePipeline === "v14d-game"
            ? getV14dGameManifest().then((manifest) => {
                const model = createV14dGameModelAsset(manifest);
                if (!model) {
                  throw new Error(manifest?.reason || "V14D 游戏外观清单未登记 Koleda 模型。");
                }
                return [model];
              })
            : listMmdModels();
        const [modelRows, sessionRows] = await Promise.all([
          modelRowsPromise,
          listChatSessions(session.userId),
        ]);
        if (cancelled) return;

        // V14D 的真实外观清单必须先打通舞台；/assets/vmd 会同步扫描本机
        // MMD 根目录并可能较慢，不能让它阻塞 Koleda 模型的首次显示。
        const assetRowsPromise = listVmdAssets(session.userId);

        setMappings(mappingRows);
        setModels(modelRows);
        setModelCatalogLoaded(true);
        setChatSessions(sessionRows);
        setSelectedModelPath((current) => {
          if (effectivePipeline === "gf2") return GF2_MODEL_PATH;
          if (current && modelRows.some((item) => item.relative_path === current)) {
            return current;
          }
          const preferred =
            effectivePipeline === "v14d-game"
              ? modelRows[0]
              : pickRememberedModelSelection(
                  modelRows,
                  sharedConfig?.selected_model_path || "",
                  DEFAULT_MODEL_RELATIVE_PATH,
                );
          return preferred?.relative_path || "";
        });
        setRenderPipeline(effectivePipeline);

        if (effectivePipeline === "v14d-game") {
          void assetRowsPromise
            .then((assetRows) => {
              if (!cancelled) setAssets(assetRows);
            })
            .catch(() => {
              // 慢速/不可用的动作资产列表不应遮蔽已可用的 V14D 外观。
            });
        } else {
          const assetRows = await assetRowsPromise;
          if (cancelled) return;
          setAssets(assetRows);
        }

        let activeSession =
          sessionRows.find((item) => item.id === session.activeChatSessionId) ||
          sessionRows[0] ||
          null;
        if (!activeSession) {
          activeSession = await createChatSession(session.userId);
          if (cancelled) return;
        }

        const nextSessionId = activeSession.id;
        setChatSessionId(nextSessionId);
        if (session.activeChatSessionId !== nextSessionId) {
          const nextUserSession = { ...session, activeChatSessionId: nextSessionId };
          setSession(nextUserSession);
          saveSession(nextUserSession);
        }

        const serverMessages = await listSessionMessages(session.userId, nextSessionId);
        if (cancelled) return;
        setMessages(serverMessages.map(mapServerMessageToChatMessage));
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "会话初始化失败。");
      } finally {
        if (!cancelled) {
          setChatBootstrapping(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session]);

  function handleRightPanelViewChange(view: RightPanelView) {
    setActiveRightPanelView(view);
    setIsRightRailCollapsed(false);
  }

  function handleCompanionNavigation(key: (typeof navIcons)[number]["key"]) {
    if (key === "tools" && isRezeEditorPipeline(renderPipeline)) {
      setIsRezeEditorOpen((open) => !open);
      setIsAdvancedPanelOpen(false);
      setStageDebugTab("scene");
      setAdvancedError("");
      return;
    }
    const target = resolveCompanionNavTarget(key);
    if (target.kind === "page") {
      router.push(target.href);
      return;
    }
    handleRightPanelViewChange(target.view as RightPanelView);
  }

  const loadOpenClawConfig = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!session) return;
      if (!silent) {
        setOpenClawLoading(true);
        setOpenClawError("");
        setOpenClawMessage("");
        setOpenClawHealth(null);
      }
      try {
        const config = await getOpenClawConfig(session.userId);
        setOpenClawSavedConfig(config);
        setOpenClawDraft(createOpenClawDraft(config));
      } catch (err) {
        if (!silent) {
          setOpenClawError(err instanceof Error ? err.message : "OpenClaw 配置读取失败。");
        }
      } finally {
        if (!silent) {
          setOpenClawLoading(false);
        }
      }
    },
    [session],
  );

  const loadMessageBridgeStatus = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!session) return;
      if (!silent) {
        setMessageBridgeLoading(true);
      }
      try {
        let status: MessageBridgeStatus | null = null;
        let sessions: MessageBridgeExternalSession[] | null = null;
        let sessionsError: unknown = null;
        try {
          status = await getMessageBridgeStatus(session.userId);
        } catch (err) {
          if (!silent) {
            setOpenClawError(err instanceof Error ? err.message : "消息桥状态读取失败。");
          }
          return;
        }
        try {
          sessions = await listMessageBridgeFeishuSessions(session.userId);
        } catch (err) {
          sessionsError = err;
        }
        const loaded = resolveMessageBridgeStatusLoad({
          status,
          sessions,
          previousStatus: messageBridgeStatusRef.current,
          previousSessions: messageBridgeSessionsRef.current,
          currentSelectedSessionKey: messageBridgeSelectedSessionKeyRef.current,
          sessionsError,
        });
        setMessageBridgeStatus(loaded.status);
        setMessageBridgeSessions(loaded.sessions);
        setMessageBridgeSelectedSessionKey(loaded.selectedSessionKey);
        const nextSessionListError =
          sessionsError instanceof Error ? sessionsError.message : sessionsError ? String(sessionsError) : "";
        setMessageBridgeSessionListError(nextSessionListError);
        if (!silent && nextSessionListError) {
          setOpenClawError(`Bridge session list unavailable: ${nextSessionListError}`);
        }
      } finally {
        if (!silent) {
          setMessageBridgeLoading(false);
        }
      }
    },
    [session],
  );

  const loadLatestMotionContextExport = useCallback(async () => {
    if (!session || !selectedModelPath) {
      setLatestMotionContextExport(null);
      return;
    }
    try {
      const exported = await getLatestMotionContextExport(session.userId, selectedModelPath);
      setLatestMotionContextExport(exported);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Motion context export load failed.";
      if (/not found/i.test(message)) {
        setLatestMotionContextExport(null);
        return;
      }
      throw err;
    }
  }, [selectedModelPath, session]);

  useEffect(() => {
    if (!session) return;
    void loadOpenClawConfig({ silent: true });
    void loadMessageBridgeStatus({ silent: true });
  }, [loadMessageBridgeStatus, loadOpenClawConfig, session]);

  const refreshDailyPodcast = useCallback(async ({ triggerVoice = false }: { triggerVoice?: boolean } = {}) => {
    if (!session) return;
    try {
      setDailyPodcast(
        await (triggerVoice ? requestDailyPodcastRefresh(session.userId) : getLatestDailyPodcast(session.userId)),
      );
    } catch {
      setDailyPodcast(null);
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    void refreshDailyPodcast();
  }, [refreshDailyPodcast, session]);

  useEffect(() => {
    if (!session?.userId) {
      setEntryGreetingMessage(null);
      return;
    }
    let cancelled = false;
    setEntryGreetingMessage(null);
    void (async () => {
      try {
        const greeting = await getLatestGreetingMessage(session.userId);
        if (!cancelled) {
          setEntryGreetingMessage(greeting ? mapServerMessageToChatMessage(greeting) : null);
        }
      } catch {
        if (!cancelled) {
          setEntryGreetingMessage(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.userId]);

  useEffect(() => {
    if (!isOpenClawSettingsOpen || !session) return;
    void loadOpenClawConfig();
    void loadMessageBridgeStatus();
  }, [isOpenClawSettingsOpen, loadMessageBridgeStatus, loadOpenClawConfig, session]);

  useEffect(() => {
    if (!session || !messageBridgeStatus?.enabled) return;
    let cancelled = false;

    const syncBridgeSession = async () => {
      const sync = resolveMessageBridgeSessionSync({
        status: messageBridgeStatus,
        currentSessionId: chatSessionIdRef.current,
        busy: loading || chatBootstrapping || sessionBusy,
      });
      if (sync.action === "open") {
        await openBridgeBoundChatSession(messageBridgeStatus.binding);
      } else if (sync.action === "refresh") {
        await refreshActiveSessionMessages({ driveBridgeMessages: true });
      }
      if (!cancelled) {
        await loadMessageBridgeStatus({ silent: true });
      }
    };

    void syncBridgeSession().catch(() => {
      // Polling is best-effort; explicit user actions still surface errors.
    });
    const timer = window.setInterval(() => {
      void syncBridgeSession().catch(() => {
        // Polling is best-effort; explicit user actions still surface errors.
      });
    }, MESSAGE_BRIDGE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    chatBootstrapping,
    chatSessionId,
    loadMessageBridgeStatus,
    loading,
    messageBridgeStatus?.binding?.external_session_key,
    messageBridgeStatus?.binding?.local_session_id,
    messageBridgeStatus?.enabled,
    session,
    sessionBusy,
  ]);

  useEffect(() => {
    if (!isAdvancedPanelOpen) return;
    void loadLatestMotionContextExport().catch(() => {
      setAdvancedError("Motion context export load failed.");
    });
  }, [isAdvancedPanelOpen, loadLatestMotionContextExport]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(max-width: 1180px), (max-height: 860px)");
    const syncCompact = (matches: boolean) => {
      setIsCompactHud(matches);
      setIsRightRailCollapsed(!matches);
    };

    syncCompact(mediaQuery.matches);
    const handleChange = (event: MediaQueryListEvent) => syncCompact(event.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeoutId = window.setTimeout(() => {
      setToast((current) => (current?.id === toast.id ? null : current));
    }, 3200);
    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  useEffect(() => {
    const latestReadyAssistant = [...messages].reverse().find((item) => item.role === "assistant");
    if (latestReadyAssistant?.tts?.status !== "ready" || !latestReadyAssistant.tts.remoteAudioUrl) return;
    const audio = new Audio();
    audio.preload = "metadata";
    audio.src = latestReadyAssistant.tts.remoteAudioUrl;
    return () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };
  }, [messages]);

  useEffect(() => {
    if (!session) return;
    const pendingMessages = messages.filter(
      (message) => message.role === "assistant" && message.id && message.tts?.status === "pending",
    );
    for (const message of pendingMessages) {
      const messageId = message.id as string;
      if (pendingTtsPollersRef.current.has(messageId)) continue;
      pendingTtsPollersRef.current.add(messageId);
      void (async () => {
        try {
          for (let attempt = 0; attempt < 10; attempt += 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 1200));
            const refreshed = await refreshMessageFromServer(messageId);
            const status = refreshed?.tts?.status;
            if (!status || status === "ready" || status === "failed" || status === "expired") {
              break;
            }
          }
        } finally {
          pendingTtsPollersRef.current.delete(messageId);
        }
      })();
    }
  }, [messages, session]);

  useEffect(() => {
    if (!session || !ttsEnabled) return;
    if (
      !shouldAutoPlayEntryGreeting({
        message: entryGreetingMessage,
        playedGreetingIds: playedEntryGreetingIdsRef.current,
      })
    ) {
      return;
    }
    const messageId = entryGreetingMessage?.id || "";
    if (!messageId) return;
    playedEntryGreetingIdsRef.current.add(messageId);
    void prepareAndPlayMessageTts(entryGreetingMessage as ChatMessage).catch((err) => {
      handleTtsFailure(err instanceof Error ? `问候语音播放失败：${err.message}` : "问候语音播放失败。");
    });
  }, [entryGreetingMessage, session, ttsEnabled]);

  const assetIndex = useMemo(() => {
    const next: Record<string, VmdAsset> = {};
    for (const item of assets) {
      next[item.asset_id] = item;
    }
    return next;
  }, [assets]);

  const recentVmdAssets = useMemo(() => {
    return [...assets].sort((left, right) => {
      const leftTime = Date.parse(left.created_at || "") || 0;
      const rightTime = Date.parse(right.created_at || "") || 0;
      return rightTime - leftTime;
    });
  }, [assets]);

  const visibleRecentVmdAssets = useMemo(() => {
    return excludeEntryStandbyAssets(recentVmdAssets);
  }, [recentVmdAssets]);

  const selectedModel = useMemo(() => {
    return (
      models.find((item) => item.relative_path === selectedModelPath) ||
      pickInitialModelSelection(models, DEFAULT_MODEL_RELATIVE_PATH)
    );
  }, [models, selectedModelPath]);

  useEffect(() => {
    lastStageClickVmdAssetIdRef.current = "";
  }, [selectedModel?.relative_path]);

  const universalBuiltinAssets = useMemo(
    () => visibleRecentVmdAssets.filter((asset) => isUniversalBuiltInMotionAsset(asset)),
    [visibleRecentVmdAssets],
  );

  // 收藏按模型归属：只取 favorite_model_paths 包含当前模型的动作。
  const scopedFavoriteAssets = useMemo(
    () => selectModelFavoriteVmdAssets(recentVmdAssets, selectedModel?.relative_path || selectedModelPath),
    [recentVmdAssets, selectedModel?.relative_path, selectedModelPath],
  );

  const currentModelLibraryAssets = useMemo(() => {
    const modelPath = selectedModel?.relative_path || selectedModelPath;
    return mergeFavoriteMotionAssets(
      recentVmdAssets.filter((asset) => !isFavoriteForModel(asset, modelPath)),
      scopedFavoriteAssets,
    ).filter((asset: VmdAsset) => !asset.library_excluded);
  }, [scopedFavoriteAssets, recentVmdAssets, selectedModel?.relative_path, selectedModelPath]);

  const autoplayVmdAssets = useMemo(
    () => characterDefaultAssets(selectedModel?.relative_path || selectedModelPath),
    [selectedModel?.relative_path, selectedModelPath],
  );

  const filteredFavoriteAssets = useMemo(() => {
    if (advancedFavoriteSlotFilter === "all") return scopedFavoriteAssets;
    return scopedFavoriteAssets.filter((asset) => asset.slot === advancedFavoriteSlotFilter);
  }, [advancedFavoriteSlotFilter, scopedFavoriteAssets]);

  const autoFavoriteInteraction = useMemo<InteractionState | null>(() => {
    return buildCharacterIdleInteraction(selectedModel?.relative_path || selectedModelPath) as InteractionState | null;
  }, [selectedModel?.relative_path, selectedModelPath]);

  const autoplayResumeInteraction = useMemo<InteractionState | null>(() => {
    return autoFavoriteInteraction;
  }, [autoFavoriteInteraction]);

  const currentChatSession = useMemo(
    () => chatSessions.find((item) => item.id === chatSessionId) || null,
    [chatSessionId, chatSessions],
  );
  const currentSessionTitle = currentChatSession?.title?.trim() || "新对话";
  const currentSessionIdentifier =
    currentChatSession?.openclaw_session_key?.trim() || chatSessionId || currentSessionTitle || "------";
  const latestAssistantMessage = [...messages].reverse().find((item) => item.role === "assistant");
  const displayAssistantMessage = resolveEntryGreetingMessage({
    latestGreetingMessage: entryGreetingMessage,
    latestAssistantMessage,
  }) as ChatMessage | null;
  const latestAssistantMessageText = displayAssistantMessage?.content || DEFAULT_ASSISTANT_COPY;
  const stageCameraSnapshot = session?.mmdCamera?.[renderPipeline] ?? null;

  useEffect(() => {
    if (!autoFavoriteInteraction) return;
    if (interactionSource !== "default" && interactionSource !== "autoplay") return;
    setStageInteractionState(
      startAutoplayLoop({
        interaction: autoFavoriteInteraction,
        activeVmdAssetId:
          autoplayVmdAssets.find((asset) => asset.url === autoFavoriteInteraction.vmdUrl)?.asset_id || "",
      }) as StageInteractionViewState,
    );
  }, [autoFavoriteInteraction, autoplayVmdAssets, interactionSource, selectedModel?.relative_path]);

  useEffect(() => {
    if (autoFavoriteInteraction || interactionSource !== "autoplay") return;
    setStageInteractionState(
      resetStageInteraction({
        defaultInteraction: createDefaultInteractionState(),
      }) as StageInteractionViewState,
    );
  }, [autoFavoriteInteraction, interactionSource]);

  useEffect(() => {
    setCameraEditMode(false);
    setStageMaterialDebugEntries([]);
    setRezeSceneDebugSettings(getRezeSceneDebugDefaults(renderPipeline));
    setRezeLocalModelImport(null);
  }, [renderPipeline, selectedModelPath]);

  useEffect(() => {
    if (!session?.userId || !selectedModelPath || !isRezeEditorPipeline(renderPipeline)) return;
    const defaults = getRezeSceneDebugDefaults(renderPipeline);
    const key = rezeEditorStorageKey(session.userId, selectedModelPath, renderPipeline);
    const raw = window.localStorage.getItem(key);
    const next = normalizeRezeStageDocument(raw ? JSON.parse(raw) : null, defaults);
    setRezeStageDocument(next);
    setRezeSceneDebugSettings(next.scene);
  }, [renderPipeline, selectedModelPath, session?.userId]);

  useEffect(() => {
    if (!session?.userId || !selectedModelPath || !isRezeEditorPipeline(renderPipeline)) return;
    const next = { ...rezeStageDocument, scene: rezeSceneDebugSettings, updatedAt: new Date().toISOString() };
    window.localStorage.setItem(rezeEditorStorageKey(session.userId, selectedModelPath, renderPipeline), JSON.stringify(next));
  }, [renderPipeline, rezeSceneDebugSettings, rezeStageDocument, selectedModelPath, session?.userId]);

  useEffect(() => {
    return () => {
      stopServerAudio({ updateSpeaking: false });
      cancelRealtimeVoicePlayback({ closeSocket: true });
    };
  }, []);

  function previewVmdAsset(asset: VmdAsset) {
    setAdvancedError("");
    if (isEmptyVmdAsset(asset)) {
      setAdvancedError(`${asset.display_name || asset.filename} 不含任何动作帧，无法预览。`);
      return;
    }
    setAdvancedMessage(`Previewing ${asset.display_name || asset.filename}`);
    const state = stageInteractionStateRef.current;
    const bakedMode = playerVmdMode === "baked";
    // 再次点同一个动作 = 停止预览，立即回到自动循环 / 默认待机。与舞台点击
    // 切换动作的行为对齐：预览视为一种「点选切换」的临时 VMD，不是锁死的播单。
    if (state.mode === "manual_preview" && state.activeVmdAssetId === asset.asset_id
      && Boolean(state.interaction.bakedBoneAnimation) === bakedMode) {
      resumeStageAfterInteractionComplete();
      return;
    }

    const preview = createVmdPreviewInteraction(asset, Number(advancedPlaybackRate) || 1, {
      bakedBoneAnimation: bakedMode,
    });
    const nextInteraction: InteractionState = {
      emotion: preview.emotion,
      action: preview.action,
      mode: "vmd",
      vmdUrl: preview.vmdUrl,
      vmdLoopUrls: [],
      vmdLoopEmotionByUrl: preview.vmdLoopEmotionByUrl,
      playbackRate: preview.playbackRate || DEFAULT_VMD_PLAYBACK_RATE,
      lockLowerBody: preview.lockLowerBody,
      lockRootPosition: preview.lockRootPosition,
      bakedBoneAnimation: preview.bakedBoneAnimation,
      disableCrossfade: preview.disableCrossfade,
      sequence: preview.sequence,
    };

    // 预览替换一段「单次 VMD」（手动预览 / 舞台点击 / 聊天一次性动作）时，需要
    // 显式 bump vmdRequestId 让 useEffect 重新触发一次播放请求；否则 URL 改变
    // 虽然也会引起 effect 重跑，但「同 URL 再次预览」在 WebGPU 路径会因 guard
    // 跳过加载，从而看起来没有反应。
    // WebGPU 的 useEffect 依赖 vmdUrl / playbackRate / vmdRequestId 触发加载。
    // 只要每次预览都带一个新的 vmdRequestId，就能稳定触发「重新播放」，无论
    // 前一个 interaction 是循环还是单次。
    nextInteraction.vmdRequestId = ++vmdPreviewRequestIdRef.current;

    setStageInteractionState(
      startManualPreview({
        interaction: nextInteraction,
        activeVmdAssetId: asset.asset_id,
        canAutoResume: Boolean(autoplayResumeInteraction),
      }) as StageInteractionViewState,
    );
  }

  function resetModelState() {
    stopSpeechPlayback();
    clearStageActionRecoveryTimer();
    setStageInteractionState(
      resetStageInteraction({
        defaultInteraction: createDefaultInteractionState(),
      }) as StageInteractionViewState,
    );
    setAdvancedError("");
    setAdvancedMessage("Model reset to default state.");
  }

  function previewWeaponMotion() {
    if (!weaponSupported || advancedBusy) return;
    setWeaponVisible(true);
    setAdvancedError("");
    setAdvancedMessage("专属查看配套试播：8倍速，沿用当前播放器模式。左手握持待修，此入口不加入默认动作库。");
    setStageInteractionState(startManualPreview({
      interaction: {
        emotion: "neutral", action: "idle", mode: "vmd",
        vmdUrl: new URL(KOLEDA_WEAPON_PREVIEW.characterMotion, window.location.origin).href,
        vmdLoopUrls: [], playbackRate: KOLEDA_WEAPON_PREVIEW.playbackRate,
        lockLowerBody: false, lockRootPosition: false, disableCrossfade: true,
        vmdRequestId: ++vmdPreviewRequestIdRef.current,
      },
      activeVmdAssetId: "koleda-weapon-inspection-preview",
      canAutoResume: Boolean(autoplayResumeInteraction),
    }) as StageInteractionViewState);
  }

  function changePlayerVmdMode(value: string) {
    const mode = normalizePlayerVmdMode(value);
    setPlayerVmdMode(mode);
    setAdvancedError("");
    if (session && !writePlayerVmdMode(window.localStorage, session.userId, mode)) {
      setAdvancedError("播放器模式本次有效，但未能保存；刷新后需重新选择。");
    }
  }

  function isReadOnlySharedFavorite(asset: VmdAsset) {
    return asset.user_id !== session?.userId;
  }

  function canRemoveFromLibrary(asset: VmdAsset) {
    return !isReadOnlySharedFavorite(asset) && asset.can_remove_from_library === true && !asset.library_excluded;
  }

  const removableLibraryAssets = assets.filter(canRemoveFromLibrary);

  function clearRemovalFeedback() {
    setAdvancedError(""); setAdvancedMessage("");
  }

  function requestLibraryRemoval(asset?: VmdAsset) {
    if (advancedBusy || libraryRemovalInFlight.current) return;
    if (asset ? !canRemoveFromLibrary(asset) : removableLibraryAssets.length === 0) return;
    clearRemovalFeedback();
    setLibraryRemoval({ all: !asset, assetIds: asset ? [asset.asset_id] : removableLibraryAssets.map((item) => item.asset_id), name: asset?.display_name || asset?.filename || "全部导入库" });
  }

  async function handleRemoveFromLibrary(asset: VmdAsset) {
    if (!session || advancedBusy || libraryRemovalInFlight.current || !canRemoveFromLibrary(asset)) return false;
    libraryRemovalInFlight.current = true;
    setAdvancedBusy(true);
    setAdvancedError("");
    setAdvancedMessage("");
    try {
      const result = await excludeVmdFromLibrary(session.userId, asset.asset_id);
      if (result.asset_id !== asset.asset_id || result.library_excluded !== true) {
        throw new Error("服务器未确认动作库移除，请刷新后核对再重试。");
      }
      setAssets((current) => current.map((item) => item.asset_id === asset.asset_id
        ? { ...item, library_excluded: true, can_remove_from_library: false } : item));
      setAdvancedMessage(`已从动作库移除「${asset.display_name || asset.filename}」；原文件和所有模型已有收藏均保留。`);
      return true;
    } catch (err) {
      setAdvancedError(`动作库移除未确认：${err instanceof Error ? err.message : "保存失败"}。可重试；不删除原文件或收藏。`);
      return false;
    } finally {
      setAdvancedBusy(false);
      libraryRemovalInFlight.current = false;
    }
  }

  async function handleRemoveAllFromLibrary(assetIds: string[]) {
    if (!session || advancedBusy || libraryRemovalInFlight.current) return false;
    libraryRemovalInFlight.current = true;
    setAdvancedBusy(true); clearRemovalFeedback();
    try {
      const result = await excludeAllVmdFromLibrary(session.userId, assetIds);
      if (!Array.isArray(result.excluded_asset_ids) || result.removed_count !== result.excluded_asset_ids.length
        || result.excluded_asset_ids.some((id) => !assetIds.includes(id))) {
        throw new Error("服务器未返回有效批量移除结果，请刷新后核对。");
      }
      // 完整快照中已排除项也可能因另一窗口操作而重复确认；服务端保证原子性。
      setAssets((current) => current.map((item) => item.user_id === session.userId && assetIds.includes(item.asset_id)
        ? { ...item, library_excluded: true, can_remove_from_library: false } : item));
      setAdvancedMessage(`已从动作库全部移除 ${result.removed_count} 个动作；原文件和所有模型已有收藏均保留。`);
      return true;
    } catch (err) {
      setAdvancedError(`全部移除未确认：${err instanceof Error ? err.message : "保存失败"}。可重试；不删除原文件或收藏。`);
      return false;
    } finally { setAdvancedBusy(false); libraryRemovalInFlight.current = false; }
  }

  async function handleFavoriteAsset(asset: VmdAsset) {
    if (!session || !selectedModel?.relative_path) return;
    if (isReadOnlySharedFavorite(asset)) {
      setAdvancedError("不能修改其他用户的收藏。");
      return;
    }
    setAdvancedBusy(true);
    setAdvancedError("");
    setAdvancedMessage("");
    try {
      const modelPath = selectedModel.relative_path;
      const currentlyFavorite = isFavoriteForModel(asset, modelPath);
      const next = await updateVmdAsset(session.userId, asset.asset_id, {
        favorite: !currentlyFavorite,
        model_relative_path: modelPath,
      });
      const nextFavorite = isFavoriteForModel(next, modelPath);
      setAssets((current) => current.map((item) => (item.asset_id === next.asset_id ? next : item)));
      if (!currentlyFavorite && !nextFavorite) {
        const ownedBy = (next.favorite_model_paths || []).filter(Boolean);
        setAdvancedError(
          `收藏请求已发出，但当前选中的模型路径不在收藏归属里，所以这个列表不会显示。当前选中：${modelPath}。收藏归属：${ownedBy.join("、") || "无"}。同名模型要看下拉框里带目录后缀的那一项。`,
        );
        return;
      }
      if (nextFavorite) {
        setStageInteractionState((current) =>
          updateStageActiveVmdAsset(current, next.asset_id) as StageInteractionViewState,
        );
      }
      if (!nextFavorite && activeVmdAssetId === next.asset_id) {
        setStageInteractionState((current) => updateStageActiveVmdAsset(current, "") as StageInteractionViewState);
      }
      setAdvancedMessage(nextFavorite
        ? (isEmptyVmdAsset(next)
          ? "已收藏，但文件没有动作帧，不参与点击随机播放。"
          : isCompanionSafeVmdAsset(next)
            ? `已收藏 ${next.display_name}，点击角色时可随机播放。`
            : `已收藏 ${next.display_name}，点击角色时可随机播放；请留意该动作的现有适配标记。`)
        : `已取消收藏 ${next.display_name}，不再参与点击随机播放。`);
    } catch (err) {
      setAdvancedError(err instanceof Error ? err.message : "Favorite update failed.");
    } finally {
      setAdvancedBusy(false);
    }
  }

  function openRenameDialog(asset: VmdAsset) {
    setAdvancedError("");
    setRenameTarget(asset);
    setRenameDraft(asset.display_name || asset.filename);
  }

  function closeRenameDialog() {
    setRenameTarget(null);
    setRenameDraft("");
  }

  function openOpenClawSettings() {
    setIsOpenClawSettingsOpen(true);
    setOpenClawError("");
    setOpenClawMessage("");
    setOpenClawHealth(null);
  }

  function closeOpenClawSettings() {
    setIsOpenClawSettingsOpen(false);
    setOpenClawError("");
    setOpenClawMessage("");
    setOpenClawHealth(null);
  }

  function resetOpenClawDraft() {
    setOpenClawDraft(createOpenClawDraft(openClawSavedConfig));
    setOpenClawError("");
    setOpenClawMessage("已恢复为最近一次读取到的配置。");
    setOpenClawHealth(null);
  }

  async function handleOpenClawSave() {
    if (!session) return;
    const baseUrl = openClawDraft.base_url.trim();
    const timeoutSeconds = Number.parseInt(openClawDraft.timeout_seconds, 10);
    if (!baseUrl) {
      setOpenClawError("Base URL 不能为空。");
      return;
    }
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 300) {
      setOpenClawError("Timeout Seconds 需要在 1 到 300 之间。");
      return;
    }

    setOpenClawSaving(true);
    setOpenClawError("");
    setOpenClawMessage("");
    try {
      const saved = await putOpenClawConfig(session.userId, {
        base_url: baseUrl,
        token: openClawDraft.token.trim() ? openClawDraft.token.trim() : null,
        agent_id: openClawDraft.agent_id.trim() || "main",
        model: openClawDraft.model.trim(),
        message_channel: openClawDraft.message_channel.trim() || "feishu",
        proxy_url: openClawDraft.proxy_url.trim(),
        verify_ssl: openClawDraft.verify_ssl,
        timeout_seconds: timeoutSeconds,
      });
      setOpenClawSavedConfig(saved);
      setOpenClawDraft(createOpenClawDraft(saved));
      if (messageBridgeStatus && messageBridgeSelectedSessionKey) {
        const bridgeMessage = await applyMessageBridgeBinding(messageBridgeSelectedSessionKey, {
          openingCurrentMessage: "Bridge Chat 已打开。",
          switchedMessage: "Bridge Session 已切换并打开。",
        });
        setOpenClawMessage(`${saved.message} ${bridgeMessage}`);
      } else {
        setOpenClawMessage(saved.message);
      }
      pushToast("OpenClaw 配置已保存。");
    } catch (err) {
      setOpenClawError(err instanceof Error ? err.message : "OpenClaw 配置保存失败。");
    } finally {
      setOpenClawSaving(false);
    }
  }

  async function handleOpenClawTest() {
    if (!session) return;
    setOpenClawTesting(true);
    setOpenClawError("");
    setOpenClawMessage("");
    try {
      const health = await getOpenClawHealth(session.userId);
      setOpenClawHealth(health);
      setOpenClawMessage(health.ok ? "当前 API 运行中的 OpenClaw 连接正常。" : "当前 API 运行中的 OpenClaw 连接异常。");
    } catch (err) {
      setOpenClawHealth(null);
      setOpenClawError(err instanceof Error ? err.message : "OpenClaw 连接测试失败。");
    } finally {
      setOpenClawTesting(false);
    }
  }

  async function handleMessageServiceCleanup() {
    if (!session) return;
    setCleanupBusy(true);
    setOpenClawError("");
    setOpenClawMessage("");
    try {
      const result: MessageServiceCleanupResult = await cleanupMessageServiceAdmin(session.userId);
      setOpenClawMessage(
        `清理完成：messages ${result.counts.deleted_soft_deleted_messages}，tts ${result.counts.deleted_soft_deleted_tts}，old terminal ${result.counts.deleted_old_terminal_tts}，orphan jobs ${result.counts.deleted_orphan_tts_jobs}，stale jobs ${result.counts.failed_stale_pending_jobs}。`,
      );
      if (chatSessionId) {
        const nextSessions = await listChatSessions(session.userId);
        setChatSessions(nextSessions);
        if (!nextSessions.some((item) => item.id === chatSessionId)) {
          const fallbackSession = nextSessions[0] || (await createChatSession(session.userId));
          setChatSessions((current) =>
            current.some((item) => item.id === fallbackSession.id) ? current : [fallbackSession, ...current],
          );
          await switchChatSession(fallbackSession);
        }
      }
    } catch (err) {
      setOpenClawError(err instanceof Error ? err.message : "消息服务清理失败。");
    } finally {
      setCleanupBusy(false);
    }
  }

  async function handleMessageBridgeSettingChange(payload: { enabled?: boolean; realtime_drive_character?: boolean }) {
    if (!session) return;
    setMessageBridgeSaving(true);
    setOpenClawError("");
    setOpenClawMessage("");
    try {
      const updated = await patchMessageBridgeSettings(session.userId, payload);
      setMessageBridgeStatus((current) => ({ ...(current || updated), ...updated }));
      await loadMessageBridgeStatus({ silent: true });
      setOpenClawMessage("消息桥设置已更新。");
    } catch (err) {
      setOpenClawError(err instanceof Error ? err.message : "消息桥设置更新失败。");
    } finally {
      setMessageBridgeSaving(false);
    }
  }

  function buildFallbackSessionFromBridgeBinding(
    binding: NonNullable<MessageBridgeStatus["binding"]>,
  ): MessageServiceSession {
    return {
      id: binding.local_session_id,
      workspace_id: "",
      account_id: "",
      openclaw_session_key: "",
      title: binding.external_display_name || binding.external_session_key || "Feishu",
      title_source: "default",
      created_at: binding.updated_at,
      updated_at: binding.updated_at,
    };
  }

  async function openBridgeBoundChatSession(
    binding: MessageBridgeStatus["binding"] | null | undefined,
    sessionsOverride?: MessageServiceSession[],
  ) {
    if (!session || !binding?.local_session_id) return false;

    let nextSessions = sessionsOverride || chatSessions;
    let target = nextSessions.find((item) => item.id === binding.local_session_id) || null;
    if (!target) {
      nextSessions = await listChatSessions(session.userId);
      setChatSessions(nextSessions);
      target = nextSessions.find((item) => item.id === binding.local_session_id) || null;
    }

    if (!target) {
      target = buildFallbackSessionFromBridgeBinding(binding);
      setChatSessions((current) =>
        current.some((item) => item.id === target?.id) || !target ? current : [target, ...current],
      );
    }

    if (chatSessionId !== target.id) {
      await switchChatSession(target);
    }
    return true;
  }

  async function applyMessageBridgeBinding(
    externalSessionKey: string,
    messages: { openingCurrentMessage: string; switchedMessage: string },
  ) {
    if (!session || !messageBridgeStatus || !externalSessionKey) return "";
    const isOpeningCurrentBinding = externalSessionKey === messageBridgeStatus.binding?.external_session_key;
    const binding = isOpeningCurrentBinding
      ? messageBridgeStatus.binding
      : await setDefaultMessageBridgeBinding(session.userId, {
          provider: messageBridgeStatus.provider,
          channel: messageBridgeStatus.channel,
          external_session_key: externalSessionKey,
        });

    const [status, nextSessions] = await Promise.all([
      getMessageBridgeStatus(session.userId),
      listChatSessions(session.userId),
    ]);
    setMessageBridgeStatus(status);
    setChatSessions(nextSessions);
    await openBridgeBoundChatSession(status.binding || binding, nextSessions);
    await loadMessageBridgeStatus({ silent: true });
    return isOpeningCurrentBinding ? messages.openingCurrentMessage : messages.switchedMessage;
  }

  async function handleMessageBridgeBindingSwitch() {
    if (!session || !messageBridgeStatus || !messageBridgeSelectedSessionKey) return;
    setMessageBridgeSaving(true);
    setOpenClawError("");
    setOpenClawMessage("");
    try {
      const bridgeMessage = await applyMessageBridgeBinding(messageBridgeSelectedSessionKey, {
        openingCurrentMessage: "Bridge Chat 已打开。",
        switchedMessage: "Bridge Session 已切换。",
      });
      setOpenClawMessage(bridgeMessage);
    } catch (err) {
      setOpenClawError(err instanceof Error ? err.message : "Bridge Session 切换失败。");
    } finally {
      setMessageBridgeSaving(false);
    }
  }

  async function handleRenameAssetConfirm() {
    if (!session || !renameTarget) return;
    const nextName = renameDraft.trim();
    if (!nextName) {
      setAdvancedError("Name is required.");
      return;
    }
    setAdvancedBusy(true);
    setAdvancedError("");
    setAdvancedMessage("");
    try {
      const next = await updateVmdAsset(session.userId, renameTarget.asset_id, {
        display_name: nextName,
        model_relative_path: selectedModel?.relative_path,
      });
      setAssets((current) => current.map((item) => (item.asset_id === next.asset_id ? next : item)));
      setAdvancedMessage(`Renamed to ${next.display_name}`);
      closeRenameDialog();
    } catch (err) {
      setAdvancedError(err instanceof Error ? err.message : "Rename failed.");
    } finally {
      setAdvancedBusy(false);
    }
  }

  function handleRenameDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeRenameDialog();
      return;
    }
    if (event.key === "Enter") {
      const target = event.target;
      if (target instanceof HTMLButtonElement) return;
      event.preventDefault();
      void handleRenameAssetConfirm();
    }
  }

  async function handleAdvancedUpload(fileListLike: FileList | File[]) {
    if (!session) return;
    setAdvancedBusy(true);
    setAdvancedError("");
    setAdvancedMessage("");
    try {
      const files = collectImportableVmdFiles(fileListLike);
      if (!files.length) {
        setAdvancedError("No importable .vmd files were found.");
        return;
      }

      const importedItems: VmdAsset[] = [];
      for (const file of files) {
        const item = await uploadVmdAsset(session.userId, advancedSlot, file);
        importedItems.push(item);
      }

      setAssets((current) => {
        const deduped = current.filter((asset) => !importedItems.some((item) => item.asset_id === asset.asset_id));
        return [...importedItems, ...deduped];
      });

      const visibleImportedItems = excludeEntryStandbyAssets(importedItems);
      if (visibleImportedItems[0]) {
        previewVmdAsset(visibleImportedItems[0]);
      }
      setAdvancedMessage(`Imported ${importedItems.length} VMD file(s).`);
      setIsAdvancedPanelOpen(true);
    } catch (err) {
      setAdvancedError(err instanceof Error ? err.message : "VMD import failed.");
    } finally {
      setAdvancedBusy(false);
    }
  }

  function handleRenderPipelineChange(nextPipeline: RenderPipeline) {
    if (nextPipeline === "gf2" && !isGf2StageModel(selectedModelPath)) handleCharacterSwitch(GF2_MODEL_PATH);
    setRenderPipeline(nextPipeline);
    setCameraEditMode(false);
    setStageDebugTab("scene");
    setStageMaterialDebugEntries([]);
    setRezeSceneDebugSettings(getRezeSceneDebugDefaults(nextPipeline));
    setIsRezeEditorOpen(false);
    setIsAdvancedPanelOpen(false);
    if (!session) return;
    const nextSession = { ...session, renderPipeline: nextPipeline, ...(nextPipeline === "gf2" ? { selectedModelPath: GF2_MODEL_PATH } : {}) };
    setSession(nextSession);
    saveSession(nextSession);
  }

  function handleRezePmxImport(files: FileList | null) {
    const importedFiles = files ? Array.from(files) : [];
    const pmxFiles = importedFiles.filter((file) => file.name.toLowerCase().endsWith(".pmx"));
    if (!pmxFiles.length) {
      setAdvancedError("请选择包含一个 PMX 文件及其贴图的完整模型目录，或多选 PMX 与贴图文件。");
      return;
    }
    if (pmxFiles.length > 1) {
      setAdvancedError("本次选择包含多个 PMX，请一次只导入一个模型目录。");
      return;
    }
    const pmxFile = pmxFiles[0]!;
    setAdvancedError("");
    setAdvancedMessage(`正在导入 ${pmxFile.name}（${importedFiles.length} 个文件）…`);
    setRezeLocalModelImport({ revision: Date.now(), files: importedFiles, pmxFile });
  }

  function refreshStageMaterialDebug() {
    const entries = stageRef.current?.getMaterialDebugEntries?.() ?? [];
    entries.forEach((entry) => {
      const preset = rezeStageDocument.materialPresets[entry.id];
      if (preset) stageRef.current?.setMaterialPreset?.(entry.id, preset);
    });
    const nextEntries = entries.map((entry) => ({
      ...entry,
      preset: rezeStageDocument.materialPresets[entry.id] ?? entry.preset,
    }));
    setStageMaterialDebugEntries(nextEntries);
    setSelectedRezeMaterialId((current) => nextEntries.some((entry) => entry.id === current) ? current : nextEntries[0]?.id ?? "");
  }

  function handleStageMaterialDebugChange(
    id: string,
    patch: Partial<Pick<StageMaterialDebugEntry, "visible" | "opacity" | "emissiveIntensity">>,
  ) {
    const next = stageRef.current?.updateMaterialDebug?.(id, patch);
    if (!next) return;
    setStageMaterialDebugEntries((entries) =>
      entries.map((entry) => (entry.id === id ? { ...entry, ...next } : entry)),
    );
  }

  function handleResetStageMaterialDebug(id: string) {
    const next = stageRef.current?.resetMaterialDebug?.(id);
    if (!next) return;
    setStageMaterialDebugEntries((entries) =>
      entries.map((entry) => (entry.id === id ? { ...entry, ...next } : entry)),
    );
  }

  function handleRezeSceneDebugChange<K extends keyof RezeSceneDebugSettings>(key: K, value: RezeSceneDebugSettings[K]) {
    const next = { ...rezeSceneDebugSettings, [key]: value };
    setRezeSceneDebugSettings(next);
    setRezeStageDocument((current) => ({ ...current, scene: next, updatedAt: new Date().toISOString() }));
    stageRef.current?.setSceneDebugSettings?.(next);
  }

  function handleResetRezeSceneDebug() {
    const next = stageRef.current?.resetSceneDebugSettings?.() as RezeSceneDebugSettings | null;
    const fallback = getRezeSceneDebugDefaults(renderPipeline);
    setRezeSceneDebugSettings(next ?? fallback);
    setRezeStageDocument((current) => ({ ...current, scene: next ?? fallback, updatedAt: new Date().toISOString() }));
  }

  function handleRezeMaterialPreset(id: string, preset: RezeExecutableMaterialPreset) {
    const applied = stageRef.current?.setMaterialPreset?.(id, preset);
    if (!applied) return;
    setRezeStageDocument((current) => ({
      ...current,
      materialPresets: { ...current.materialPresets, [id]: preset },
      updatedAt: new Date().toISOString(),
    }));
    setStageMaterialDebugEntries((entries) => entries.map((entry) => (entry.id === id ? { ...entry, preset } : entry)));
  }

  function handleRezeStyleGroupPreset(group: RezeMaterialStyleGroup) {
    const preset = group.preset;
    if (!preset) return;
    const targets = stageMaterialDebugEntries.filter((entry) => resolveRezeMaterialStyleGroup(entry) === group.id);
    if (!targets.length) {
      setAdvancedMessage(`${group.label} 样式组中没有可应用的材质。`);
      return;
    }
    const appliedIds = new Set<string>();
    targets.forEach((entry) => {
      if (stageRef.current?.setMaterialPreset?.(entry.id, preset)) appliedIds.add(entry.id);
    });
    if (!appliedIds.size) return;
    setRezeStageDocument((current) => ({
      ...current,
      materialPresets: Object.fromEntries([
        ...Object.entries(current.materialPresets),
        ...Array.from(appliedIds, (id) => [id, preset] as const),
      ]),
      updatedAt: new Date().toISOString(),
    }));
    setStageMaterialDebugEntries((entries) => entries.map((entry) => (
      appliedIds.has(entry.id) ? { ...entry, preset } : entry
    )));
    setAdvancedError("");
    setAdvancedMessage(`已将 ${preset} 应用到 ${group.label} 样式组（${appliedIds.size} 个材质）。`);
  }

  function handleExportRezeStagePng() {
    const dataUrl = stageRef.current?.captureStagePng?.();
    if (!dataUrl) {
      setAdvancedError("舞台尚未准备好，无法导出截图。");
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = dataUrl;
    anchor.download = `${rezeStageDocument.name || "reze-stage"}.png`;
    anchor.click();
  }

  async function handleSaveCompanionSharedConfig() {
    setAdvancedError("");
    setAdvancedMessage("");
    if (!session?.userId) {
      setAdvancedError("请先登录后再保存到桌面 Pet。");
      return;
    }
    if (!selectedModelPath) {
      setAdvancedError("请先选择一个 MMD 模型。");
      return;
    }
    setSharedConfigSaving(true);
    try {
      await saveCompanionSharedConfigWithTimeout((signal: AbortSignal) =>
        putCompanionSharedConfig(
          session.userId,
          buildCompanionSharedConfigPayload({
            selectedModelPath,
            renderPipeline,
            rezeStageDocument,
            rezeSceneDebugSettings,
          }),
          { signal },
        ),
      );
      setAdvancedMessage("已保存到桌面 Pet。请在 pet 右键菜单选择 Sync from Main Site / 从主站同步。");
      pushToast("已保存到桌面 Pet。");
    } catch (err) {
      setAdvancedError(err instanceof Error ? err.message : "保存到桌面 Pet 失败。");
    } finally {
      setSharedConfigSaving(false);
    }
  }

  function handleUnlockMmdCamera() {
    setAdvancedError("");
    const snapshot = stageRef.current?.unlockCamera();
    if (!snapshot) {
      setAdvancedError("Camera is not ready yet.");
      return;
    }
    setCameraEditMode(true);
    setAdvancedMessage("Editing camera. Drag, pan, or zoom on the MMD stage, then save this framing.");
  }

  function handleSaveMmdCamera() {
    setAdvancedError("");
    if (!session) return;
    const snapshot = stageRef.current?.captureCamera();
    if (!snapshot) {
      setAdvancedError("Camera is not ready yet.");
      return;
    }
    const savedSnapshot: MmdCameraSnapshot = { ...snapshot, locked: false };
    stageRef.current?.unlockCamera();
    console.info("[mmd-camera] saved snapshot", savedSnapshot);
    const nextSession: UserSession = {
      ...session,
      mmdCamera: {
        ...(session.mmdCamera || {}),
        [renderPipeline]: savedSnapshot,
      },
    };
    setSession(nextSession);
    saveSession(nextSession);
    setCameraEditMode(false);
    setAdvancedMessage(`Camera saved for ${renderPipeline}.`);
  }

  function handleResetMmdCamera() {
    setAdvancedError("");
    if (!session) return;
    const snapshot = stageRef.current?.resetCamera();
    if (!snapshot) {
      setAdvancedError("Camera is not ready yet.");
      return;
    }
    const nextCamera = { ...(session.mmdCamera || {}) };
    delete nextCamera[renderPipeline];
    const nextSession: UserSession = {
      ...session,
      mmdCamera: Object.keys(nextCamera).length ? nextCamera : undefined,
    };
    setSession(nextSession);
    saveSession(nextSession);
    setCameraEditMode(false);
    setAdvancedMessage(`Camera reset to the ${renderPipeline} default.`);
  }

  function stopServerAudio({ updateSpeaking = true }: { updateSpeaking?: boolean } = {}) {
    const audio = serverAudioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    if (serverAudioCleanupRef.current) {
      serverAudioCleanupRef.current();
      serverAudioCleanupRef.current = null;
    }
    serverAudioRef.current = null;
    if (updateSpeaking) {
      setSpeaking(false);
    }
    setMmdSpeechLevel(0);
    setMmdSpeechViseme(null);
    setActiveTtsMessageId("");
  }

  async function handleExportMotionContext() {
    if (!session || !selectedModel?.relative_path) return;
    setAdvancedBusy(true);
    setAdvancedError("");
    setAdvancedMessage("");
    try {
      const exported = await createMotionContextExport(session.userId, selectedModel.relative_path);
      setLatestMotionContextExport(exported);
      setAdvancedMessage(`Exported ${exported.motion_count} favorite motion(s) for ${exported.model_display_name}.`);
    } catch (err) {
      setAdvancedError(err instanceof Error ? err.message : "Motion context export failed.");
    } finally {
      setAdvancedBusy(false);
    }
  }

  async function handleExportFavoriteVmdZip() {
    if (!session || !selectedModel?.relative_path || advancedBusy || favoriteExportInFlight.current) return;
    favoriteExportInFlight.current = true;
    const modelLabel = getModelDisplayLabel(selectedModel);
    setFavoriteExportBusy(true);
    setAdvancedBusy(true);
    setAdvancedError("");
    setAdvancedMessage(`正在打包「${modelLabel}」的全部收藏，请稍候…`);
    try {
      const exported = await exportFavoriteVmdZip(session.userId, selectedModel.relative_path);
      const url = URL.createObjectURL(exported.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = exported.filename;
      document.body.appendChild(anchor);
      try { anchor.click(); } finally {
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      setAdvancedMessage(`已生成「${modelLabel}」全部 ${exported.count} 个收藏的完整 VMD ZIP，已请求浏览器下载；请在下载列表确认保存。`);
    } catch (err) {
      setAdvancedMessage("");
      setAdvancedError(err instanceof Error ? err.message : "收藏导出失败，未取得完整 ZIP；请重试。");
    } finally {
      favoriteExportInFlight.current = false;
      setFavoriteExportBusy(false);
      setAdvancedBusy(false);
    }
  }

  function stopSpeechPlayback({
    includeRealtime = true,
    includePodcast = true,
  }: { includeRealtime?: boolean; includePodcast?: boolean } = {}) {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    stopServerAudio();
    if (includeRealtime) {
      cancelRealtimeVoicePlayback({ closeSocket: false });
    }
    if (includePodcast) {
      podcastAudioStopRef.current?.();
    }
  }

  function handleTtsEnabledChange(enabled: boolean) {
    setTtsEnabled(enabled);
    setSession((current) => {
      if (!current) return current;
      const nextSession: UserSession = { ...current, ttsEnabled: enabled };
      saveSession(nextSession);
      return nextSession;
    });
    if (!enabled) {
      stopSpeechPlayback();
    }
  }

  function pushToast(message: string) {
    setToast({ id: Date.now(), message });
  }

  function handleTtsFailure(message: string) {
    ignoreNextStageCompletionResetRef.current = true;
    pushToast(message);
  }

  function updateMessageTts(messageId: string, tts: ChatMessageTts) {
    setMessages((current) => current.map((message) => (message.id === messageId ? { ...message, tts } : message)));
  }

  function patchMessageTts(messageId: string, patch: Partial<ChatMessageTts>) {
    setMessages((current) =>
      current.map((message) => {
        if (message.id !== messageId) return message;
        return {
          ...message,
          tts: {
            ...(message.tts || { mode: "server" as const, status: "loading" as const }),
            ...patch,
          },
        };
      }),
    );
  }

  function realtimeProxyAudioUrl(audioUrl: string, userId: string) {
    const separator = audioUrl.includes("?") ? "&" : "?";
    const authenticatedPath = `${audioUrl}${separator}user_id=${encodeURIComponent(userId)}`;
    if (/^https?:\/\//i.test(authenticatedPath)) return authenticatedPath;
    return `/api/backend${authenticatedPath.startsWith("/") ? authenticatedPath : `/${authenticatedPath}`}`;
  }

  function setMmdSpeechLevel(level: number) {
    stageRef.current?.setSpeechLevel(level);
  }

  function setMmdSpeechViseme(frame: SpeechVisemeFrame) {
    stageRef.current?.setSpeechViseme(frame);
  }

  async function refreshMessageFromServer(messageId: string) {
    if (!session) return null;
    const next = await getMessageById(session.userId, messageId);
    const mapped = mapServerMessageToChatMessage(next);
    setMessages((current) => current.map((message) => (message.id === messageId ? { ...message, ...mapped } : message)));
    return mapped;
  }

  function getRealtimeAudioQueue(): RealtimeAudioQueue {
    if (!audioQueueRef.current) {
      const RealtimeAudioQueue = AudioQueue as unknown as RealtimeAudioQueueCtor;
      audioQueueRef.current = new RealtimeAudioQueue({
        setSpeechLevel: setMmdSpeechLevel,
        setSpeechViseme: setMmdSpeechViseme,
        onChunkStart: (entry: { jobId: string; messageId?: string }) => {
          const messageId = entry.messageId || realtimeVoiceJobMessageRef.current.get(entry.jobId) || "";
          setSpeaking(true);
          setActiveTtsMessageId(messageId);
          setRealtimeVoiceStatus("playing");
        },
        onChunkEnd: (entry: { jobId: string; messageId?: string }) => {
          const messageId = entry.messageId || realtimeVoiceJobMessageRef.current.get(entry.jobId) || "";
          setSpeaking(false);
          setActiveTtsMessageId((current) => (current === messageId ? "" : current));
          setRealtimeVoiceStatus("idle");
        },
        onError: (event: { jobId: string; messageId?: string; fallback: RealtimeVoiceFallbackMode; error?: Error }) => {
          void handleRealtimeVoicePlaybackError(event);
        },
      });
    }
    return audioQueueRef.current;
  }

  async function playMessageLevelTtsFallback(messageId: string, reason: string) {
    const message = messagesRef.current.find((item) => item.id === messageId);
    if (!message) return;
    setRealtimeVoiceStatus("fallback");
    patchMessageTts(messageId, { status: "pending", mode: "server", error: reason });
    try {
      await prepareAndPlayMessageTts({
        ...message,
        tts: {
          ...(message.tts || {}),
          status: "pending",
          mode: "server",
          error: reason,
        },
      });
    } catch (error) {
      patchMessageTts(messageId, {
        status: "failed",
        mode: "server",
        error: error instanceof Error ? error.message : "Voice fallback failed.",
      });
      handleTtsFailure(error instanceof Error ? `语音回退失败：${error.message}` : "语音回退失败。");
    }
  }

  async function handleRealtimeVoicePlaybackError(event: {
    jobId: string;
    messageId?: string;
    fallback: RealtimeVoiceFallbackMode;
    error?: Error;
  }) {
    const messageId = event.messageId || realtimeVoiceJobMessageRef.current.get(event.jobId) || "";
    if (!messageId) return;
    if (event.fallback === "auto_before_playback") {
      await playMessageLevelTtsFallback(messageId, event.error?.message || "Realtime voice playback failed.");
      return;
    }
    setRealtimeVoiceStatus("partial_failed");
    patchMessageTts(messageId, {
      status: "partial_failed",
      mode: "server",
      error: event.error?.message || "Realtime voice playback failed after partial playback.",
    });
    handleTtsFailure("实时语音已部分播放，后续片段失败。可手动重播完整语音。");
  }

  function handleRealtimeVoiceFailure(event: RealtimeVoiceServerEvent) {
    const jobId = event.job_id || "";
    const messageId = event.message_id || realtimeVoiceJobMessageRef.current.get(jobId) || "";
    if (!messageId) return;
    const fallbackMode =
      jobId && audioQueueRef.current
        ? audioQueueRef.current.fallbackForJobError(jobId)
        : ("auto_before_playback" as RealtimeVoiceFallbackMode);
    const reason = event.detail || event.reason || "Realtime voice synthesis failed.";
    if (fallbackMode === "auto_before_playback") {
      void playMessageLevelTtsFallback(messageId, reason);
      return;
    }
    setRealtimeVoiceStatus("partial_failed");
    patchMessageTts(messageId, { status: "partial_failed", mode: "server", error: reason });
    handleTtsFailure("实时语音已部分播放，后续片段失败。可手动重播完整语音。");
  }

  function handleRealtimeVoiceEvent(event: RealtimeVoiceServerEvent) {
    if (event.job_id && cancelledRealtimeVoiceJobsRef.current.has(event.job_id)) return;
    const messageId = event.message_id || realtimeVoiceJobMessageRef.current.get(event.job_id || "") || "";
    if (event.type === "queued") {
      setRealtimeVoiceStatus("queued");
      if (messageId) patchMessageTts(messageId, { status: "loading", mode: "server" });
      return;
    }
    if (event.type === "synthesis_started") {
      setRealtimeVoiceStatus("synthesizing");
      if (messageId) patchMessageTts(messageId, { status: "loading", mode: "server" });
      return;
    }
    if (event.type === "audio_ready" && event.job_id && event.audio_url) {
      const activeSession = sessionRef.current;
      if (!activeSession) return;
      if (messageId) {
        realtimeVoiceJobMessageRef.current.set(event.job_id, messageId);
        patchMessageTts(messageId, { status: "loading", mode: "server" });
      }
      getRealtimeAudioQueue().enqueue({
        jobId: event.job_id,
        messageId,
        sequence: Number(event.sequence || 0),
        url: realtimeProxyAudioUrl(event.audio_url, activeSession.userId),
        text: event.text,
        duration: event.duration,
      });
      return;
    }
    if (event.type === "rejected" || event.type === "error") {
      handleRealtimeVoiceFailure(event);
      return;
    }
    if (event.type === "cancelled" || event.type === "done") {
      setRealtimeVoiceStatus((current) => (current === "partial_failed" ? current : "idle"));
    }
  }

  async function ensureRealtimeVoiceSocket() {
    const activeSession = sessionRef.current;
    const activeSessionId = chatSessionIdRef.current;
    if (!activeSession || !activeSessionId) return null;
    const existing = voiceSocketRef.current;
    if (existing?.readyState === WebSocket.OPEN) return existing;
    if (existing && existing.readyState !== WebSocket.CLOSED) {
      existing.close();
    }

    const socket = new WebSocket(sessionVoiceWebSocketUrl(activeSessionId, activeSession.userId));
    voiceSocketRef.current = socket;
    setRealtimeVoiceStatus("connecting");

    socket.addEventListener("message", (event) => {
      try {
        handleRealtimeVoiceEvent(JSON.parse(String(event.data)) as RealtimeVoiceServerEvent);
      } catch {
        setRealtimeVoiceStatus("failed");
      }
    });
    socket.addEventListener("close", () => {
      if (voiceSocketRef.current === socket) {
        voiceSocketRef.current = null;
      }
      setRealtimeVoiceStatus((current) => (current === "partial_failed" ? current : "idle"));
    });
    socket.addEventListener("error", () => {
      setRealtimeVoiceStatus("failed");
    });

    return new Promise<WebSocket>((resolve, reject) => {
      const cleanup = () => {
        socket.removeEventListener("open", handleOpen);
        socket.removeEventListener("error", handleError);
        socket.removeEventListener("close", handleClose);
      };
      const handleOpen = () => {
        cleanup();
        setRealtimeVoiceStatus("idle");
        resolve(socket);
      };
      const handleError = () => {
        cleanup();
        reject(new Error("Realtime voice WebSocket failed."));
      };
      const handleClose = () => {
        cleanup();
        reject(new Error("Realtime voice WebSocket closed."));
      };
      socket.addEventListener("open", handleOpen);
      socket.addEventListener("error", handleError);
      socket.addEventListener("close", handleClose);
    });
  }

  async function startRealtimeVoiceSynthesis(message: ChatMessage) {
    if (!session || !chatSessionId || !message.id || !message.content.trim()) return false;
    try {
      const socket = await ensureRealtimeVoiceSocket();
      if (!socket || socket.readyState !== WebSocket.OPEN) return false;
      stopSpeechPlayback();
      const jobId = createMessageId("voice-job");
      cancelledRealtimeVoiceJobsRef.current.delete(jobId);
      realtimeVoiceJobMessageRef.current.set(jobId, message.id);
      patchMessageTts(message.id, { status: "loading", mode: "server" });
      setRealtimeVoiceStatus("queued");
      socket.send(
        JSON.stringify({
          type: "synthesize",
          job_id: jobId,
          message_id: message.id,
          text: message.content,
        }),
      );
      return true;
    } catch {
      setRealtimeVoiceStatus("failed");
      return false;
    }
  }

  function cancelRealtimeVoicePlayback({ closeSocket = false }: { closeSocket?: boolean } = {}) {
    for (const jobId of realtimeVoiceJobMessageRef.current.keys()) {
      cancelledRealtimeVoiceJobsRef.current.add(jobId);
    }
    audioQueueRef.current?.clear();
    realtimeVoiceJobMessageRef.current.clear();
    setSpeaking(false);
    setMmdSpeechViseme(null);
    setActiveTtsMessageId("");
    setRealtimeVoiceStatus("idle");
    const socket = voiceSocketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "cancel", scope: "all" }));
    }
    if (closeSocket && socket) {
      socket.close();
      voiceSocketRef.current = null;
    }
  }

  function setChatStageInteraction(nextInteraction: InteractionState, activeVmdAssetId = "") {
    setStageInteractionState(
      startChatInteraction({
        interaction: nextInteraction,
        activeVmdAssetId,
        canAutoResume: Boolean(autoplayResumeInteraction),
      }) as StageInteractionViewState,
    );
  }

  function setIdleVmdFallbackStageInteraction(message: MessageServiceMessage) {
    const fallback = createIdleVmdFallbackInteraction(autoplayVmdAssets, {
      emotion: message.emotion || "neutral",
      action: "idle",
    }) as { interaction: InteractionState; activeVmdAssetId: string } | null;
    if (!fallback) return false;
    setChatStageInteraction(fallback.interaction, fallback.activeVmdAssetId);
    return true;
  }

  function handleStageCharacterClick({
    clientX,
    clientY,
    stageRect,
  }: {
    clientX: number;
    clientY: number;
    stageRect: DOMRect;
  }) {
    if (interactionSource === "stage-click") return;
    const ripple = createStageClickRipple({ clientX, clientY, rect: stageRect }) as StageClickRipple;
    setStageClickRipples((current) => [...current.slice(-5), ripple]);
    globalThis.setTimeout(() => {
      setStageClickRipples((current) => current.filter((item) => item.id !== ripple.id));
    }, STAGE_CLICK_RIPPLE_DURATION_MS);

    const clickAction = resolveStageCharacterClickInteraction({
      assets: scopedFavoriteAssets,
      previousActiveVmdAssetId: lastStageClickVmdAssetIdRef.current,
    }) as { interaction: InteractionState; activeVmdAssetId: string };
    if (!clickAction.activeVmdAssetId) return;
    if (clickAction.activeVmdAssetId) {
      lastStageClickVmdAssetIdRef.current = clickAction.activeVmdAssetId;
    }
    clearStageActionRecoveryTimer();
    setStageInteractionState(
      startStageClickInteraction({
        interaction: clickAction.interaction,
        activeVmdAssetId: clickAction.activeVmdAssetId,
        canAutoResume: Boolean(autoplayResumeInteraction),
      }) as StageInteractionViewState,
    );
  }

  function driveCharacterFromBridgeMessage(message: MessageServiceMessage) {
    if (message.role !== "assistant") return;
    if (message.metadata?.source !== "message_bridge" || message.metadata?.synced_from !== "realtime") return;
    if (!messageBridgeStatus?.realtime_drive_character) return;

    const motionResolution = message.motion_resolution;
    if (motionResolution?.status === "matched" && motionResolution.resolved_asset_url) {
      const plannedAsset = motionResolution.resolved_asset_id ? assetIndex[motionResolution.resolved_asset_id] : undefined;
      setChatStageInteraction(
        {
          emotion: message.emotion || "neutral",
          action: message.action || "idle",
          mode: "vmd",
          vmdUrl: motionResolution.resolved_asset_url,
          vmdLoopUrls: [],
          vmdLoopEmotionByUrl: { [motionResolution.resolved_asset_url]: message.emotion || "neutral" },
          playbackRate: resolveVmdPlaybackRate(plannedAsset || { url: motionResolution.resolved_asset_url }),
          sequence: [],
        },
        motionResolution.resolved_asset_id || "",
      );
      return;
    }

    const plan = resolvePlaybackPlan({
      slot: message.emotion || "neutral",
      action: message.action || "idle",
      motionPlan: message.motion_plan || undefined,
      userMappings: mappings,
      defaultMappings: {},
      assetIndex,
    });
    if (plan.mode === "vmd") {
      const plannedAsset = Object.values(assetIndex).find((item) => item.url === plan.url);
      setChatStageInteraction(
        {
          emotion: message.emotion || "neutral",
          action: message.action || "idle",
          mode: "vmd",
          vmdUrl: plan.url,
          vmdLoopUrls: [],
          vmdLoopEmotionByUrl: plan.url ? { [plan.url]: message.emotion || "neutral" } : {},
          playbackRate: resolveVmdPlaybackRate(plannedAsset || { url: plan.url }),
          sequence: [],
        },
        plannedAsset?.asset_id || "",
      );
      return;
    }

    if (
      shouldUseIdleVmdFallbackForUnmatchedMotion({
        motionResolution,
        action: message.action,
      }) &&
      setIdleVmdFallbackStageInteraction(message)
    ) {
      return;
    }

    setChatStageInteraction({
      emotion: message.emotion || "neutral",
      action: plan.action,
      mode: "procedural",
      vmdUrl: "",
      vmdLoopEmotionByUrl: {},
      playbackRate: 1,
      sequence: plan.sequence || [],
    });
  }

  async function refreshActiveSessionMessages({ driveBridgeMessages = false }: { driveBridgeMessages?: boolean } = {}) {
    const activeSession = sessionRef.current || session;
    const activeChatSessionId = chatSessionIdRef.current || chatSessionId;
    if (!activeSession || !activeChatSessionId || loading || chatBootstrapping || sessionBusy) return;
    const serverMessages = await listSessionMessages(activeSession.userId, activeChatSessionId);
    const refresh = resolveMessageBridgeRefresh({
      currentMessages: messagesRef.current,
      serverMessages,
      requestLatestOnNewBridgeMessages: driveBridgeMessages,
    });

    if (refresh.changed) {
      const nextMessages = refresh.nextMessages.map(mapServerMessageToChatMessage);
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
    }
    if (refresh.shouldRequestLatest) {
      setChatAutoScrollRevision((current) => current + 1);
    }
    if (refresh.newServerMessages.some((message: MessageServiceMessage) => message.role === "assistant")) {
      setEntryGreetingMessage(null);
    }
    if (driveBridgeMessages) {
      for (const message of refresh.newServerMessages as MessageServiceMessage[]) {
        driveCharacterFromBridgeMessage(message);
      }
    }
  }

  async function switchChatSession(nextSession: MessageServiceSession) {
    if (!session) return;
    setSessionBusy(true);
    setError("");
    cancelRealtimeVoicePlayback({ closeSocket: true });
    try {
      const serverMessages = await listSessionMessages(session.userId, nextSession.id);
      setChatSessionId(nextSession.id);
      setMessages(serverMessages.map(mapServerMessageToChatMessage));
      if (nextSession.selected_model_path) {
        setSelectedModelPath(nextSession.selected_model_path);
      }
      const nextUserSession = { ...session, activeChatSessionId: nextSession.id };
      setSession(nextUserSession);
      saveSession(nextUserSession);
    } catch (err) {
      setError(err instanceof Error ? err.message : "会话切换失败。");
    } finally {
      setSessionBusy(false);
    }
  }

  async function handleCreateSession() {
    if (!session) return;
    setSessionBusy(true);
    setError("");
    cancelRealtimeVoicePlayback({ closeSocket: true });
    try {
      const created = await createChatSession(session.userId, { selected_model_path: selectedModelPath || null });
      setChatSessions((current) => [created, ...current]);
      setChatSessionId(created.id);
      setMessages([]);
      const nextUserSession = { ...session, activeChatSessionId: created.id };
      setSession(nextUserSession);
      saveSession(nextUserSession);
    } catch (err) {
      setError(err instanceof Error ? err.message : "新会话创建失败。");
    } finally {
      setSessionBusy(false);
    }
  }

  async function handleSelectSession(sessionId: string) {
    if (sessionId === chatSessionId) return;
    const target = chatSessions.find((item) => item.id === sessionId);
    if (!target) return;
    await switchChatSession(target);
  }

  async function handleRenameSession(target: MessageServiceSession) {
    if (!session) return;
    const nextTitle = window.prompt("重命名会话", target.title)?.trim();
    if (!nextTitle || nextTitle === target.title) return;
    setSessionBusy(true);
    setError("");
    try {
      const updated = await updateChatSession(session.userId, target.id, { title: nextTitle });
      setChatSessions((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "会话重命名失败。");
    } finally {
      setSessionBusy(false);
    }
  }

  async function handleDeleteSession(target: MessageServiceSession) {
    if (!session) return;
    if (!window.confirm(`删除会话“${target.title}”？`)) return;
    setSessionBusy(true);
    setError("");
    try {
      await deleteChatSession(session.userId, target.id);
      const remaining = chatSessions.filter((item) => item.id !== target.id);
      setChatSessions(remaining);
      if (target.id === chatSessionId) {
        if (remaining.length > 0) {
          await switchChatSession(remaining[0]);
        } else {
          const created = await createChatSession(session.userId, { selected_model_path: selectedModelPath || null });
          setChatSessions([created]);
          setChatSessionId(created.id);
          setMessages([]);
          const nextUserSession = { ...session, activeChatSessionId: created.id };
          setSession(nextUserSession);
          saveSession(nextUserSession);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "会话删除失败。");
    } finally {
      setSessionBusy(false);
    }
  }

  async function playServerAudio(audioBlob: Blob, messageId = "", speechText = "") {
    stopSpeechPlayback();
    setActiveTtsMessageId(messageId);
    const controller = await playServerTtsAudio(audioBlob, {
      setSpeaking: (value?: boolean) => setSpeaking(Boolean(value)),
      setSpeechLevel: setMmdSpeechLevel,
      setSpeechViseme: setMmdSpeechViseme,
      speechText,
      onAudioCreated: ({ audio, cleanup }: { audio: HTMLAudioElement; cleanup: () => void }) => {
        serverAudioRef.current = audio;
        serverAudioCleanupRef.current = cleanup;
      },
      onCleanup: ({ audio }: { audio?: HTMLAudioElement } = {}) => {
        if (audio && serverAudioRef.current === audio) {
          serverAudioRef.current = null;
          serverAudioCleanupRef.current = null;
        }
        setActiveTtsMessageId((current) => (current === messageId ? "" : current));
      },
    });
    if (serverAudioRef.current === controller.audio) {
      serverAudioCleanupRef.current = controller.cleanup;
    }
  }

  async function playRemoteServerAudio(message: ChatMessage) {
    const remoteAudioUrl = message.tts?.remoteAudioUrl;
    const proxyAudioUrl = message.tts?.proxyAudioUrl;
    if (!session) return;
    if (!remoteAudioUrl && !proxyAudioUrl) {
      throw new Error("远端音频地址缺失。");
    }
    stopSpeechPlayback();
    setActiveTtsMessageId(message.id || "");

    const controller = await playRemoteTtsAudio({
      remoteAudioUrl,
      proxyAudioUrl,
      userId: session.userId,
      setSpeaking: (value?: boolean) => setSpeaking(Boolean(value)),
      setSpeechLevel: setMmdSpeechLevel,
      setSpeechViseme: setMmdSpeechViseme,
      speechText: message.content,
      speechDurationSeconds: message.tts?.durationSeconds || 0,
      onAudioCreated: ({ audio, cleanup }: { audio: HTMLAudioElement; cleanup: () => void }) => {
        serverAudioRef.current = audio;
        serverAudioCleanupRef.current = cleanup;
      },
      onCleanup: ({ audio }: { audio?: HTMLAudioElement } = {}) => {
        if (audio && serverAudioRef.current === audio) {
          serverAudioRef.current = null;
          serverAudioCleanupRef.current = null;
        }
        setActiveTtsMessageId((current) => (current === (message.id || "") ? "" : current));
      },
      onFinalError: async () => {
        if (message.id) {
          await refreshMessageFromServer(message.id);
        }
        handleTtsFailure("远端语音播放失败。");
      },
    });
    if (serverAudioRef.current === controller.audio) {
      serverAudioCleanupRef.current = controller.cleanup;
    }
  }

  function browserSpeak(text: string, messageId = "") {
    stopSpeechPlayback();
    if (!("speechSynthesis" in window)) {
      handleTtsFailure("当前环境不支持浏览器语音播放。");
      return;
    }
    setActiveTtsMessageId(messageId);
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "zh-CN";
    utter.rate = 1.03;
    utter.pitch = 1.08;
    utter.onstart = () => setSpeaking(true);
    utter.onend = () => {
      setSpeaking(false);
      setActiveTtsMessageId((current) => (current === messageId ? "" : current));
    };
    utter.onerror = () => {
      setSpeaking(false);
      setActiveTtsMessageId((current) => (current === messageId ? "" : current));
      handleTtsFailure("浏览器语音播放失败。");
    };
    try {
      window.speechSynthesis.speak(utter);
    } catch {
      setSpeaking(false);
      setActiveTtsMessageId((current) => (current === messageId ? "" : current));
      handleTtsFailure("浏览器语音播放失败。");
    }
  }

  async function prepareAndPlayAssistantTts(message: ChatMessage) {
    if (!ttsEnabled || !session || !message.id) return;
    if (ttsMode === "browser") {
      updateMessageTts(message.id, { status: "ready", mode: "browser" });
      browserSpeak(message.content, message.id);
      return;
    }

    if (await startRealtimeVoiceSynthesis(message)) {
      return;
    }
    await prepareAndPlayMessageTts(message);
  }

  async function prepareAndPlayMessageTts(message: ChatMessage) {
    if (!session || !message.id) return;
    let currentMessage = message;
    if (
      !currentMessage.tts ||
      currentMessage.tts.status === "loading" ||
      currentMessage.tts.status === "partial_failed"
    ) {
      const optimisticTts: ChatMessageTts = { status: "pending", mode: "server" };
      currentMessage = { ...currentMessage, tts: optimisticTts };
      updateMessageTts(message.id, optimisticTts);
    }
    if (currentMessage.tts?.status === "pending") {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
        const refreshed = await refreshMessageFromServer(message.id);
        if (!refreshed?.tts) break;
        currentMessage = refreshed;
        if (refreshed.tts.status === "ready" || refreshed.tts.status === "failed" || refreshed.tts.status === "expired") {
          break;
        }
      }
    }

    if (currentMessage.tts?.status === "ready") {
      await playMessageAudio(currentMessage);
      return;
    }

    if (currentMessage.tts?.status === "failed") {
      throw new Error(currentMessage.tts.error || "语音生成失败。");
    }

    if (currentMessage.tts?.status === "expired") {
      const regenerated = await regenerateMessageTts(session.userId, message.id);
      currentMessage = mapServerMessageToChatMessage(regenerated);
      setMessages((current) => current.map((item) => (item.id === message.id ? currentMessage : item)));
      if (currentMessage.tts?.status === "ready") {
        await playMessageAudio(currentMessage);
        return;
      }
      throw new Error(currentMessage.tts?.error || "语音重新生成失败。");
    }
  }

  async function playMessageAudio(message: ChatMessage) {
    if (message.tts?.status !== "ready") return;
    if (message.tts.mode === "server" && message.tts.audio) {
      await playServerAudio(message.tts.audio, message.id || "", message.content);
      return;
    }
    if (message.tts.mode === "server" && message.tts.remoteAudioUrl) {
      await playRemoteServerAudio(message);
      return;
    }
    browserSpeak(message.content, message.id || "");
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!session || !chatSessionId || !input.trim() || loading || chatBootstrapping) return;

    const userText = input.trim();
    const optimisticUserMessageId = createMessageId("user-pending");
    const optimisticUserMessage: ChatMessage = {
      id: optimisticUserMessageId,
      role: "user",
      content: userText,
      createdAt: new Date().toISOString(),
    };
    ignoreNextStageCompletionResetRef.current = false;
    setEntryGreetingMessage(null);
    setInput("");
    setError("");
    setBackgroundActivityPulse((current) => current + 1);
    setLoading(true);
    setChatAutoScrollRevision((current) => current + 1);
    setMessages((prev) => [...prev, optimisticUserMessage]);

    try {
      const traceId = createTraceId();
      const response = await postSessionMessage(
        session.userId,
        chatSessionId,
        {
          content: userText,
          tts_enabled: ttsEnabled && ttsMode === "server",
          selected_model_path: selectedModelPath || null,
        },
        traceId,
      );

      const userMessage = mapServerMessageToChatMessage(response.user_message);
      const assistantMessage = mapServerMessageToChatMessage(response.assistant_message);
      if (ttsEnabled && ttsMode === "browser" && assistantMessage.id) {
        assistantMessage.tts = { status: "ready", mode: "browser" };
      }
      if (ttsEnabled && ttsMode === "server" && assistantMessage.id && !assistantMessage.tts) {
        assistantMessage.tts = { status: "pending", mode: "server" };
      }
      setChatAutoScrollRevision((current) => current + 1);
      setMessages((prev) => [
        ...prev.filter((message) => message.id !== optimisticUserMessageId),
        userMessage,
        assistantMessage,
      ]);
      setLoading(false);

      const motionResolution = response.assistant_message.motion_resolution;
      if (motionResolution?.status === "matched" && motionResolution.resolved_asset_url) {
        const plannedAsset = motionResolution.resolved_asset_id ? assetIndex[motionResolution.resolved_asset_id] : undefined;
        setChatStageInteraction(
          {
            emotion: response.assistant_message.emotion || "neutral",
            action: response.assistant_message.action || "idle",
            mode: "vmd",
            vmdUrl: motionResolution.resolved_asset_url,
            vmdLoopUrls: [],
            vmdLoopEmotionByUrl: { [motionResolution.resolved_asset_url]: response.assistant_message.emotion || "neutral" },
            playbackRate: resolveVmdPlaybackRate(plannedAsset || { url: motionResolution.resolved_asset_url }),
            sequence: [],
          },
          motionResolution.resolved_asset_id || "",
        );
      } else {
        const plan = resolvePlaybackPlan({
          slot: response.assistant_message.emotion || "neutral",
          action: response.assistant_message.action || "idle",
          motionPlan: response.assistant_message.motion_plan || undefined,
          userMappings: mappings,
          defaultMappings: {},
          assetIndex,
        });

        if (plan.mode === "vmd") {
          const plannedAsset = Object.values(assetIndex).find((item) => item.url === plan.url);
          setChatStageInteraction(
            {
              emotion: response.assistant_message.emotion || "neutral",
              action: response.assistant_message.action || "idle",
              mode: "vmd",
              vmdUrl: plan.url,
              vmdLoopUrls: [],
              vmdLoopEmotionByUrl: plan.url ? { [plan.url]: response.assistant_message.emotion || "neutral" } : {},
              playbackRate: resolveVmdPlaybackRate(plannedAsset || { url: plan.url }),
              sequence: [],
            },
            plannedAsset?.asset_id || "",
          );
        } else {
          const usedIdleVmdFallback =
            shouldUseIdleVmdFallbackForUnmatchedMotion({
              motionResolution,
              action: response.assistant_message.action,
            }) &&
            setIdleVmdFallbackStageInteraction(response.assistant_message);

          if (!usedIdleVmdFallback) {
            setChatStageInteraction({
              emotion: response.assistant_message.emotion || "neutral",
              action: plan.action,
              mode: "procedural",
              vmdUrl: "",
              vmdLoopEmotionByUrl: {},
              playbackRate: 1,
              sequence: plan.sequence || [],
            });
          }
        }
      }

      try {
        await prepareAndPlayAssistantTts(assistantMessage);
      } catch (speakError) {
        if (assistantMessage.id) {
          updateMessageTts(assistantMessage.id, {
          status: "failed",
          mode: ttsMode,
          error: speakError instanceof Error ? speakError.message : "语音播放失败。",
        });
        }
        handleTtsFailure(speakError instanceof Error ? `语音播放失败：${speakError.message}` : "语音播放失败。");
      }
    } catch (err) {
      setMessages((prev) => prev.filter((message) => message.id !== optimisticUserMessageId));
      pushToast(err instanceof Error ? err.message : "\u8bf7\u6c42\u5931\u8d25\u3002");
    } finally {
      setLoading(false);
    }
  }

  function handleCharacterSwitch(nextPath: string) {
    stopSpeechPlayback();
    clearStageActionRecoveryTimer();
    setStageInteractionState(
      resetStageInteraction({
        defaultInteraction: createDefaultInteractionState(),
      }) as StageInteractionViewState,
    );
    setSelectedModelPath(nextPath);
  }

  function clearStageActionRecoveryTimer() {
    if (stageActionRecoveryTimerRef.current === null) return;
    globalThis.clearTimeout(stageActionRecoveryTimerRef.current);
    stageActionRecoveryTimerRef.current = null;
  }

  function getAutoplayResumeAssetId(nextAutoplayResumeInteraction = autoplayResumeInteraction) {
    if (!nextAutoplayResumeInteraction) return "";
    return autoplayVmdAssets.find((asset) => asset.url === nextAutoplayResumeInteraction.vmdUrl)?.asset_id || "";
  }

  function resumeStageAfterInteractionComplete() {
    const nextState = completeStageInteraction({
      autoplayResumeInteraction,
      createAutoplayResumeInteraction: () =>
        autoFavoriteInteraction,
      defaultInteraction: createDefaultInteractionState(),
      resolveAutoplayAssetId: (nextAutoplayResumeInteraction: InteractionState | null) =>
        getAutoplayResumeAssetId(nextAutoplayResumeInteraction),
    }) as StageInteractionViewState;
    setStageInteractionState(nextState);
  }

  function handleStageInteractionError() {
    clearStageActionRecoveryTimer();
    resumeStageAfterInteractionComplete();
  }

  function handleStageInteractionComplete() {
    clearStageActionRecoveryTimer();
    if (ignoreNextStageCompletionResetRef.current) {
      ignoreNextStageCompletionResetRef.current = false;
      setStageInteractionState((current) => clearStagePendingAutoResume(current) as StageInteractionViewState);
      return;
    }

    resumeStageAfterInteractionComplete();
  }

  if (!session) {
    return (
      <main className="page-shell" style={{ display: "grid", placeItems: "center" }}>
        <section className="panel" style={{ width: "min(520px, 92vw)", padding: "1.2rem" }}>
          <h2 style={{ marginTop: 0 }}>{"\u672a\u767b\u5f55"}</h2>
          <p className="muted">{"\u8bf7\u5148\u8fd4\u56de\u767b\u5f55\u9875\u8f93\u5165\u7528\u6237 ID\u3002"}</p>
          <Link className="btn" href="/">
            {"\u53bb\u767b\u5f55"}
          </Link>
        </section>
      </main>
    );
  }

  return (
    <BlueprintPage
      loadingError={!selectedModel && !rezeLocalModelImport ? error || (modelCatalogLoaded ? "没有可加载的人物，请检查模型资源后重试。" : null) : null}
      className={`mio-hud${isCompactHud ? " is-compact" : ""}`}
      data-testid="mio-hud"
      data-render-pipeline={renderPipeline}
      data-reze-grade={rezeStageDocument.grade}
    >
      <MioModeBackground
        active={renderPipeline === "mio-reference" || renderPipeline === "reze-npr" || renderPipeline === "reze-k3"}
        speaking={speaking}
        emotion={interaction.emotion}
        action={interaction.action}
        activityPulse={backgroundActivityPulse}
      />
      <header className="mio-topbar" data-testid="mio-topbar">
        <div
          className="mio-brand"
          data-testid="companion-brand-logo"
          data-logo-layout="aether-cropped-lockup"
          aria-label="AETHER PERSONAL AI"
        >
          <img className="mio-brand-mark" src="/images/aether-companion-mark-crop.png" alt="" aria-hidden="true" />
          <img className="mio-brand-wordmark" src="/images/aether-companion-wordmark-crop.png" alt="AETHER PERSONAL AI" />
        </div>

        <div className="mio-system-state">
          <span className="mio-dot" />
          <strong>LIVE</strong>
          <span>@ MEMORY SYNCED</span>
        </div>

        <div className="mio-session">
          <div className="mio-session-meta">
            <span>USER: {session.userId}</span>
            <span>SESSION: {(chatSessionId || "------").slice(0, 6).toUpperCase()}</span>
          </div>
          <div className="mio-session-actions">
            <div className="mio-session-id-popover" data-testid="mio-session-id-popover">
              <button
                className="mio-session-id-trigger"
                data-testid="mio-session-id-trigger"
                type="button"
                aria-label={`Current session ID: ${currentSessionIdentifier}`}
                aria-describedby="mio-session-id-floating"
              >
                <span aria-hidden="true">#</span>
              </button>
              <div className="mio-session-id-floating" id="mio-session-id-floating" role="tooltip">
                <span className="mio-session-id-label">CURRENT ID</span>
                <strong className="mio-session-id-value">{currentSessionIdentifier}</strong>
                {currentSessionTitle !== currentSessionIdentifier ? (
                  <span className="mio-session-id-title">{currentSessionTitle}</span>
                ) : null}
              </div>
            </div>
            <Link href="/traces" className="mio-trace-button">
              TRACE
            </Link>
            <KnowledgeReviewBadge userId={session?.userId || ""} />
            <button
              className="mio-icon-button"
              type="button"
              aria-label="Open OpenClaw settings"
              aria-expanded={isOpenClawSettingsOpen}
              onClick={openOpenClawSettings}
            >
              <span className="mio-nav-glyph" aria-hidden="true">
                {renderSidebarIcon("settings")}
              </span>
            </button>
            <button
              className="mio-avatar-stack"
              type="button"
              onClick={() => {
                clearSession();
                router.push("/");
              }}
              aria-label={"\u9000\u51fa\u767b\u5f55"}
            >
              <img className="mio-avatar" src={`${SPRITE}/asset-030.png`} alt={"\u5f53\u524d\u89d2\u8272\u5934\u50cf"} />
            </button>
          </div>
        </div>
      </header>

      {isOpenClawSettingsOpen ? (
        <div className="mio-settings-layer" role="presentation">
          <button
            type="button"
            className="mio-settings-backdrop"
            aria-label="Close OpenClaw settings"
            onClick={closeOpenClawSettings}
          />
          <section
            className="mio-settings-panel"
            role="dialog"
            aria-modal="true"
            aria-label="OpenClaw settings"
          >
            <header className="mio-settings-head">
              <div>
                <strong>OpenClaw</strong>
                <span>保存会写入 `api/.env` 并立即刷新当前 API 的 OpenClaw 配置，测试连接读取的是运行中的后端配置。</span>
              </div>
              <button type="button" className="mio-advanced-close" onClick={closeOpenClawSettings} aria-label="Close">
                ×
              </button>
            </header>

            <div className="mio-settings-body">
              {openClawError ? <p className="mio-advanced-error">{openClawError}</p> : null}
              {openClawMessage && !openClawError ? <p className="mio-advanced-empty">{openClawMessage}</p> : null}

              <div className="mio-settings-grid">
                <label className="mio-advanced-field mio-advanced-field-wide">
                  <span>Base URL</span>
                  <input
                    type="url"
                    value={openClawDraft.base_url}
                    onChange={(event) => setOpenClawDraft((current) => ({ ...current, base_url: event.target.value }))}
                    disabled={openClawLoading || openClawSaving}
                  />
                </label>
                <label className="mio-advanced-field mio-advanced-field-wide">
                  <span>Token</span>
                  <input
                    type="password"
                    value={openClawDraft.token}
                    placeholder={openClawDraft.token_configured ? "已配置，留空则保持不变" : "未配置"}
                    onChange={(event) => setOpenClawDraft((current) => ({ ...current, token: event.target.value }))}
                    disabled={openClawLoading || openClawSaving}
                  />
                </label>
                <label className="mio-advanced-field">
                  <span>Agent ID</span>
                  <input
                    value={openClawDraft.agent_id}
                    onChange={(event) => setOpenClawDraft((current) => ({ ...current, agent_id: event.target.value }))}
                    disabled={openClawLoading || openClawSaving}
                  />
                </label>
                <label className="mio-advanced-field">
                  <span>Model</span>
                  <input
                    value={openClawDraft.model}
                    onChange={(event) => setOpenClawDraft((current) => ({ ...current, model: event.target.value }))}
                    disabled={openClawLoading || openClawSaving}
                  />
                </label>
                <label className="mio-advanced-field">
                  <span>Message Channel</span>
                  <input
                    value={openClawDraft.message_channel}
                    onChange={(event) =>
                      setOpenClawDraft((current) => ({ ...current, message_channel: event.target.value }))
                    }
                    disabled={openClawLoading || openClawSaving}
                  />
                </label>
                <label className="mio-advanced-field">
                  <span>Proxy URL</span>
                  <input
                    type="url"
                    value={openClawDraft.proxy_url}
                    onChange={(event) => setOpenClawDraft((current) => ({ ...current, proxy_url: event.target.value }))}
                    disabled={openClawLoading || openClawSaving}
                  />
                </label>
                <label className="mio-advanced-field">
                  <span>Timeout Seconds</span>
                  <input
                    type="number"
                    min="1"
                    max="300"
                    value={openClawDraft.timeout_seconds}
                    onChange={(event) =>
                      setOpenClawDraft((current) => ({ ...current, timeout_seconds: event.target.value }))
                    }
                    disabled={openClawLoading || openClawSaving}
                  />
                </label>
                <label className="mio-advanced-field mio-advanced-toggle">
                  <span>Verify SSL</span>
                  <input
                    type="checkbox"
                    checked={openClawDraft.verify_ssl}
                    onChange={(event) =>
                      setOpenClawDraft((current) => ({ ...current, verify_ssl: event.target.checked }))
                    }
                    disabled={openClawLoading || openClawSaving}
                  />
                </label>
              </div>

              <section className="mio-settings-diagnostics" aria-label="Message bridge status">
                <div className="mio-settings-diagnostics-head">
                  <strong>Message Bridge</strong>
                  <span>
                    {messageBridgeLoading
                      ? "Loading..."
                      : messageBridgeStatus
                        ? `${messageBridgeStatus.provider}/${messageBridgeStatus.channel}`
                        : "Not loaded"}
                  </span>
                </div>
                <div className="mio-settings-meta">
                  <span>Status: {messageBridgeStatus?.websocket_status || "--"}</span>
                  <span>Reconnects: {messageBridgeStatus?.reconnect_attempts ?? "--"}</span>
                  <span>Last connected: {messageBridgeStatus?.last_connected_at || "--"}</span>
                  <span>Binding: {messageBridgeStatus?.binding?.external_display_name || messageBridgeStatus?.binding?.external_session_key || "--"}</span>
                  {messageBridgeStatus?.last_error ? <span>Error: {messageBridgeStatus.last_error}</span> : null}
                  {messageBridgeSessionListError ? <span>Session list: {messageBridgeSessionListError}</span> : null}
                </div>
                <div className="mio-settings-grid">
                  <label className="mio-advanced-field mio-advanced-field-wide">
                    <span>Bridge Session</span>
                    <select
                      value={messageBridgeSelectedSessionKey}
                      onChange={(event) => setMessageBridgeSelectedSessionKey(event.target.value)}
                      disabled={messageBridgeLoading || messageBridgeSaving || messageBridgeSessions.length === 0}
                    >
                      {messageBridgeSessions.length === 0 ? <option value="">No Feishu sessions</option> : null}
                      {messageBridgeSessions.map((item) => (
                        <option
                          key={item.external_session_key}
                          value={item.external_session_key}
                          title={item.external_session_key}
                        >
                          {formatMessageBridgeSessionLabel(item)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="mio-advanced-mini"
                    onClick={() => void handleMessageBridgeBindingSwitch()}
                    disabled={
                      messageBridgeLoading ||
                      messageBridgeSaving ||
                      !messageBridgeStatus ||
                      !messageBridgeSelectedSessionKey ||
                      (messageBridgeSelectedSessionKey === messageBridgeStatus.binding?.external_session_key &&
                        messageBridgeStatus.binding?.local_session_id === chatSessionId)
                    }
                  >
                    {messageBridgeSaving
                      ? "Switching..."
                      : messageBridgeSelectedSessionKey === messageBridgeStatus?.binding?.external_session_key
                        ? "Open Bridge Chat"
                        : "Switch Bridge Session"}
                  </button>
                </div>
                <div className="mio-settings-grid">
                  <label className="mio-advanced-field mio-advanced-toggle">
                    <span>Bridge Enabled</span>
                    <input
                      type="checkbox"
                      checked={messageBridgeStatus?.enabled ?? true}
                      onChange={(event) => void handleMessageBridgeSettingChange({ enabled: event.target.checked })}
                      disabled={messageBridgeLoading || messageBridgeSaving || !messageBridgeStatus}
                    />
                  </label>
                  <label className="mio-advanced-field mio-advanced-toggle">
                    <span>Realtime Drive Character</span>
                    <input
                      type="checkbox"
                      checked={messageBridgeStatus?.realtime_drive_character ?? true}
                      onChange={(event) =>
                        void handleMessageBridgeSettingChange({ realtime_drive_character: event.target.checked })
                      }
                      disabled={messageBridgeLoading || messageBridgeSaving || !messageBridgeStatus}
                    />
                  </label>
                </div>
              </section>

              <div className="mio-settings-actions">
                <button
                  type="button"
                  className="mio-advanced-mini"
                  onClick={() => void handleOpenClawTest()}
                  disabled={openClawLoading || openClawSaving || openClawTesting}
                >
                  {openClawTesting ? "Testing..." : "Test Connection"}
                </button>
                <button
                  type="button"
                  className="mio-advanced-mini"
                  onClick={resetOpenClawDraft}
                  disabled={openClawLoading || openClawSaving || cleanupBusy}
                >
                  Reset
                </button>
                <button
                  type="button"
                  className="mio-advanced-mini"
                  onClick={() => void handleMessageServiceCleanup()}
                  disabled={openClawLoading || openClawSaving || cleanupBusy}
                >
                  {cleanupBusy ? "Cleaning..." : "Cleanup"}
                </button>
                <button
                  type="button"
                  className="mio-advanced-mini is-active"
                  onClick={() => void handleOpenClawSave()}
                  disabled={openClawLoading || openClawSaving || cleanupBusy}
                >
                  {openClawSaving ? "Saving..." : "Save"}
                </button>
              </div>

              {openClawHealth ? (
                <section className="mio-settings-diagnostics" aria-label="OpenClaw diagnostics">
                  <div className="mio-settings-diagnostics-head">
                    <strong>{openClawHealth.ok ? "Runtime OK" : "Runtime Error"}</strong>
                    <span>{openClawHealth.base_url}</span>
                  </div>
                  <div className="mio-settings-meta">
                    <span>Agent: {openClawHealth.agent_id || "main"}</span>
                    <span>Model: {openClawHealth.model || "-"}</span>
                    <span>SSL: {openClawHealth.verify_ssl ? "On" : "Off"}</span>
                  </div>
                  <div className="mio-settings-probes">
                    {Object.entries(openClawHealth.probes || {}).map(([key, probe]) => (
                      <div key={key} className="mio-settings-probe">
                        <strong>{key}</strong>
                        <span>
                          {probe.status_code ?? "--"} · {probe.detail}
                        </span>
                      </div>
                    ))}
                  </div>
                  {openClawHealth.recommendations?.length ? (
                    <div className="mio-settings-recommendations">
                      {openClawHealth.recommendations.map((item) => (
                        <span key={item}>{item}</span>
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      <div className="mio-layout" data-testid="mio-layout">
        <aside
          className={`mio-sidebar${isSidebarCollapsed ? " is-collapsed" : ""}`}
          data-testid="mio-sidebar"
          aria-label={"\u4e3b\u5bfc\u822a"}
        >
          <button
            className="mio-panel-toggle"
            type="button"
            aria-label={isSidebarCollapsed ? "展开左侧菜单" : "收起左侧菜单"}
            aria-pressed={isSidebarCollapsed}
            onClick={() => setIsSidebarCollapsed((current) => !current)}
          >
            {isSidebarCollapsed ? "›" : "‹"}
          </button>
          {navIcons.map((icon) => (
            <button
              key={icon.label}
              className={`mio-nav-button ${(icon.key === "tools" && isRezeEditorOpen) || activeRightPanelView === icon.view ? "is-active" : ""}`}
              type="button"
              aria-label={icon.key === "tools" && isRezeEditorPipeline(renderPipeline) ? "打开 Reze 材质与场景编辑器" : icon.label}
              aria-pressed={(icon.key === "tools" && isRezeEditorOpen) || activeRightPanelView === icon.view}
              onClick={() => handleCompanionNavigation(icon.key)}
            >
              <span className="mio-nav-glyph" aria-hidden="true">
                {renderSidebarIcon(icon.key)}
              </span>
            </button>
          ))}

          <button
            className={`mio-nav-button is-bottom${isOpenClawSettingsOpen ? " is-active" : ""}`}
            type="button"
            aria-label={"\u8bbe\u7f6e"}
            aria-pressed={isOpenClawSettingsOpen}
            onClick={openOpenClawSettings}
          >
            <span className="mio-nav-glyph" aria-hidden="true">
              {renderSidebarIcon("settings")}
            </span>
          </button>
        </aside>

        <div className="mio-stage-wrap" data-testid="mio-stage-wrap">
          <div className="mio-orbit mio-orbit-one" />
          <div className="mio-orbit mio-orbit-two" />
          <section className="mio-dialogue" data-testid="mio-dialogue" aria-label={"\u4e3b\u5bf9\u8bdd\u6c14\u6ce1"}>
            <div className="mio-dialogue-chrome" aria-hidden="true">
              <svg viewBox="0 0 420 248" preserveAspectRatio="none" focusable="false">
                <path
                  className="mio-dialogue-glow"
                  d="M30 12H309C329 12 345 28 345 48V149C345 160 350 169 360 177L380 193L352 193C344 193 337 196 332 201L313 220C306 227 296 231 286 231H30C19 231 12 224 12 213V30C12 19 19 12 30 12Z"
                />
                <path
                  className="mio-dialogue-fill"
                  d="M30 12H309C329 12 345 28 345 48V149C345 160 350 169 360 177L380 193L352 193C344 193 337 196 332 201L313 220C306 227 296 231 286 231H30C19 231 12 224 12 213V30C12 19 19 12 30 12Z"
                />
                <path
                  className="mio-dialogue-outline-soft"
                  d="M30 12H309C329 12 345 28 345 48V149C345 160 350 169 360 177L380 193L352 193C344 193 337 196 332 201L313 220C306 227 296 231 286 231H30C19 231 12 224 12 213V30C12 19 19 12 30 12Z"
                />
                <path
                  className="mio-dialogue-outline"
                  d="M30 12H309C329 12 345 28 345 48V149C345 160 350 169 360 177L380 193L352 193C344 193 337 196 332 201L313 220C306 227 296 231 286 231H30C19 231 12 224 12 213V30C12 19 19 12 30 12Z"
                />
                <path
                  className="mio-dialogue-highlight"
                  d="M41 20H303C319 20 331 32 331 47V60"
                />
                <path
                  className="mio-dialogue-tail-highlight"
                  d="M347 164C351 171 357 176 365 181"
                />
              </svg>
            </div>
            <div className="mio-dialogue-head">
              <span className="mio-dialogue-name">MIO</span>
              <span className="mio-dialogue-wave" aria-hidden="true">
                <svg viewBox="0 0 120 16" focusable="false">
                  <path d="M2 8h11m5 0h4m5 0h2l2-3 2 6 3-10 3 13 3-8h2l2 3h4m5 0h4l2-4 2 8 3-12 3 10 2-5h4m7 0h28" />
                </svg>
              </span>
              {displayAssistantMessage?.tts ? (
                <button
                  type="button"
                  className="mio-dialogue-voice-button"
                  aria-label={
                    displayAssistantMessage.tts.status === "loading" || displayAssistantMessage.tts.status === "pending"
                      ? "Voice pending"
                      : displayAssistantMessage.tts.status === "failed" || displayAssistantMessage.tts.status === "partial_failed"
                        ? "Voice unavailable"
                        : displayAssistantMessage.tts.status === "expired"
                          ? "Voice expired"
                        : "Play voice"
                  }
                  title={
                    displayAssistantMessage.tts.status === "loading" || displayAssistantMessage.tts.status === "pending"
                      ? "Voice pending"
                      : displayAssistantMessage.tts.status === "failed" || displayAssistantMessage.tts.status === "partial_failed"
                        ? "Voice unavailable"
                        : displayAssistantMessage.tts.status === "expired"
                          ? "Voice expired"
                        : "Play voice"
                  }
                  disabled={displayAssistantMessage.tts.status !== "ready"}
                  data-status={displayAssistantMessage.tts.status}
                  data-active={displayAssistantMessage.id && displayAssistantMessage.id === activeTtsMessageId ? "true" : "false"}
                  onClick={() => playMessageAudio(displayAssistantMessage)}
                >
                  <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
                    <path d="M4.2 8.2h2.5l3.4-3v9.6l-3.4-3H4.2z" />
                    <path d="M13.1 7.2a4 4 0 0 1 0 5.6M15.2 5.1a7 7 0 0 1 0 9.8" />
                  </svg>
                </button>
              ) : null}
            </div>
            <div className="mio-dialogue-copy" aria-live="polite">
              <p>{latestAssistantMessageText}</p>
            </div>
            <div className="mio-dialogue-dots" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
          </section>
          <BlueprintRenderGate canLoad={Boolean(selectedModel?.url || rezeLocalModelImport)}>
          {(loadingBinding) => <MMDStage
            {...loadingBinding}
            ref={stageRef}
            appearanceUserId={session?.userId || ""}
            chrome="bare"
            interaction={interaction}
            weaponVisible={weaponVisible && weaponSupported}
            onWeaponStateChange={setWeaponState}
            speaking={speaking}
            onInteractionComplete={handleStageInteractionComplete}
            onInteractionError={handleStageInteractionError}
            onCharacterClick={handleStageCharacterClick}
            clickRipples={stageClickRipples}
            models={models}
            selectedModelPath={selectedModelPath}
            modelUrl={selectedModel?.url || ""}
            rezeLocalModelImport={renderPipeline === "reze-design" || renderPipeline === "reze-k3" ? rezeLocalModelImport : null}
            modelLabel={selectedModel ? getModelDisplayLabel(selectedModel) : ""}
            renderPipeline={renderPipeline}
            rezeBackgroundEffect={rezeStageDocument.backgroundEffect}
            rezeGrade={rezeStageDocument.grade}
            rezeGradeIntensity={rezeStageDocument.gradeIntensity}
            rezeSceneDebugSettings={rezeSceneDebugSettings}
            v14dSkinVariant={
              // P0-2：effective variant 与 UI/资格共用单一谓词；
              // 资格不满足（无 mask/非克莱妲）时持久化的 v1 安全回退 original。
              renderPipeline === "reze-k3"
                ? resolveRezeK3SkinVariant(rezeK3SkinVariant, rezeLocalModelImport)
                : "original"
            }
            rezeTransparentBackground={renderPipeline === "reze-k3"}
            cameraSnapshot={stageCameraSnapshot}
            onModelChange={handleCharacterSwitch}
          />}
          </BlueprintRenderGate>
          <div className="mio-stage-bottom-fade" data-testid="mio-stage-bottom-fade" aria-hidden="true" />
        </div>

        <CompanionRightRail
          collapsed={isRightRailCollapsed}
          activeView={activeRightPanelView}
          userId={session?.userId || ""}
          sessions={chatSessions}
          activeSessionId={chatSessionId}
          sessionBusy={sessionBusy}
          messages={messages}
          chatAutoScrollRevision={chatAutoScrollRevision}
          loading={loading || chatBootstrapping}
          error={error}
          ttsEnabled={ttsEnabled}
          activeTtsMessageId={activeTtsMessageId}
          nextSteps={nextSteps}
          memoryNotes={memoryNotes}
          traceRows={traceRows}
          dailyPodcast={dailyPodcast}
          onRefreshDailyPodcast={() => refreshDailyPodcast({ triggerVoice: true })}
          onBeforeAudioPlayback={() => stopSpeechPlayback({ includePodcast: false })}
          onPodcastAudioStopReady={(stop) => {
            podcastAudioStopRef.current = stop;
          }}
          onToggleCollapsed={() => setIsRightRailCollapsed((current) => !current)}
          onCreateSession={handleCreateSession}
          onSelectSession={(sessionId) => void handleSelectSession(sessionId)}
          onRenameSession={(target) => void handleRenameSession(target)}
          onDeleteSession={(target) => void handleDeleteSession(target)}
          onPlayTtsMessage={playMessageAudio}
        />
      </div>
      <CompanionCommandBar
        input={input}
        inputLabel={INPUT_LABEL}
        loading={loading || chatBootstrapping}
        sendDisabled={!session || !chatSessionId || !input.trim() || chatBootstrapping}
        error={error}
        ttsEnabled={ttsEnabled}
        isAdvancedPanelOpen={isAdvancedPanelOpen}
        advancedPanel={
          isAdvancedPanelOpen || isRezeEditorOpen ? (
            <section
              id="mio-advanced-panel"
              className={`mio-advanced-panel${isRezeEditorOpen ? " mio-advanced-panel--reze-editor" : ""}`}
              data-testid="mio-advanced-panel"
              role="dialog"
              aria-modal="false"
              aria-label={isRezeEditorOpen ? "Reze 材质与场景编辑器" : "\u9ad8\u7ea7\u529f\u80fd"}
            >
              <header className="mio-advanced-panel-head">
                <div>
                  <strong>{"\u9ad8\u7ea7\u529f\u80fd"}</strong>
                  <span>{"\u7edf\u4e00\u7ba1\u7406\u6a21\u578b\u3001\u6e32\u67d3\u6a21\u5f0f\u3001VMD \u5bfc\u5165\u4e0e MMD \u76f8\u673a\u3002"}</span>
                </div>
                <button
                  type="button"
                  className="mio-advanced-close"
                  aria-label="Close advanced panel"
                  onClick={() => {
                    setIsAdvancedPanelOpen(false);
                    setIsRezeEditorOpen(false);
                    closeRenameDialog();
                  }}
                >
                  ×
                </button>
              </header>

              <div className="mio-advanced-panel-scroll">
                <section
                  className="mio-advanced-stage"
                  data-testid="mio-advanced-stage"
                  aria-label={"\u6a21\u578b\u4e0e\u6e32\u67d3\u8bbe\u7f6e"}
                >
                  <div className="mio-camera-controls-head">
                    <div>
                      <strong>{"\u821e\u53f0\u8bbe\u7f6e"}</strong>
                      <span>
                        {selectedModel ? getModelDisplayLabel(selectedModel) : "\u672a\u9009\u62e9\u89d2\u8272"} · {renderPipeline}
                      </span>
                    </div>
                    <span>{models.length.toString().padStart(2, "0")} MODELS</span>
                  </div>

                  <label className="mio-advanced-field mio-advanced-field-wide">
                    <span>{"\u6a21\u578b\u5207\u6362"}</span>
                    <select
                      aria-label={"\u6a21\u578b\u5207\u6362"}
                      value={selectedModel?.relative_path || ""}
                      onChange={(event) => handleCharacterSwitch(event.target.value)}
                      disabled={models.length === 0}
                    >
                      {models.length === 0 ? <option value="">No models available</option> : null}
                      {models.map((model) => (
                        <option key={model.relative_path} value={model.relative_path} disabled={renderPipeline === "gf2" && !isGf2StageModel(model.relative_path)}>
                          {getModelDisplayLabel(model)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="mio-pipeline-options" role="radiogroup" aria-label={"\u6e32\u67d3\u6a21\u5f0f"}>
                    {renderPipelineOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`mio-pipeline-option ${renderPipeline === option.value ? "is-active" : ""}`}
                        role="radio"
                        aria-checked={renderPipeline === option.value}
                        onClick={() => handleRenderPipelineChange(option.value)}
                      >
                        <strong>{option.label}</strong>
                        <span>{option.description}</span>
                      </button>
                    ))}
                  </div>
                  {// P0-2：UI 显示与 effective variant/资格共用单一谓词；
                  // 需 权威克莱妲 PMX + State2 mask 同时满足才显示 V1 切换。
                  renderPipeline === "reze-k3" &&
                  evaluateRezeK3V1Eligibility(rezeLocalModelImport).eligible ? (
                    <div
                      className="mio-pipeline-options"
                      role="radiogroup"
                      aria-label="Reze K3 皮肤变体"
                      data-testid="reze-k3-skin-variant-bar"
                    >
                      {(["original", "v1"] as const).map((variant) => (
                        <button
                          key={variant}
                          type="button"
                          className={"mio-pipeline-option" + (rezeK3SkinVariant === variant ? " is-active" : "")}
                          role="radio"
                          aria-checked={rezeK3SkinVariant === variant}
                          data-testid={"reze-k3-skin-variant-" + variant}
                          onClick={() => setRezeK3SkinVariant(variant)}
                        >
                          <strong>{REZE_K3_SKIN_VARIANT_LABEL[variant]}</strong>
                          <span>
                            {variant === "v1"
                              ? "克莱妲 V14D 外观：脸部（Face）、身体皮肤（BodySkin）、头发（HairA/HairB）、眉毛（Brows）、睫毛（Lashes），共 6 槽，剩余 9 槽未迁移；头发仅基础色，高光待决"
                              : "现有 Reze K3 材质与灯光"}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="mio-camera-actions">
                    <button
                      type="button"
                      className="mio-advanced-mini is-active"
                      data-testid="mio-shared-config-save"
                      onClick={() => void handleSaveCompanionSharedConfig()}
                      disabled={sharedConfigSaving || !session?.userId || !selectedModelPath}
                    >
                      {sharedConfigSaving ? "Saving..." : "保存到桌面 Pet"}
                    </button>
                  </div>
                </section>

                {isRezeEditorOpen && isRezeEditorPipeline(renderPipeline) ? (
                  <section className="mio-stage-debugger" data-testid="mio-stage-debugger" aria-label="Reze Design 实时调试">
                    <nav className="mio-reze-editor-rail" aria-label="Reze Design 编辑器导航">
                      <span className="mio-reze-editor-logo" aria-hidden="true">✦</span>
                      <button type="button" className={`mio-reze-editor-tool ${stageDebugTab === "materials" ? "is-active" : ""}`} aria-label="材质" onClick={() => { setStageDebugTab("materials"); window.setTimeout(refreshStageMaterialDebug, 0); }}><span aria-hidden="true">◐</span><small>材质</small></button>
                      <button type="button" className={`mio-reze-editor-tool ${stageDebugTab === "scene" ? "is-active" : ""}`} aria-label="场景" onClick={() => setStageDebugTab("scene")}><span aria-hidden="true">☼</span><small>场景</small></button>
                      <button type="button" className={`mio-reze-editor-tool ${stageDebugTab === "assets" ? "is-active" : ""}`} aria-label="资产" onClick={() => setStageDebugTab("assets")}><span aria-hidden="true">□</span><small>资产</small></button>
                      <button type="button" className={`mio-reze-editor-tool ${stageDebugTab === "render" ? "is-active" : ""}`} aria-label="渲染" onClick={() => setStageDebugTab("render")}><span aria-hidden="true">▣</span><small>渲染</small></button>
                      <span className="mio-reze-editor-rail-spacer" />
                      <button type="button" className="mio-reze-editor-tool" aria-label="关闭 Reze 编辑器" onClick={() => setIsRezeEditorOpen(false)}><span aria-hidden="true">×</span><small>关闭</small></button>
                    </nav>
                    <div className="mio-reze-editor-body">
                    <div className="mio-camera-controls-head mio-reze-editor-head">
                      <div><strong>{renderPipeline === "reze-k3" ? "Reze K3" : "Reze Design"}</strong><span>{rezeStageDocument.name}</span></div>
                      <button
                        type="button"
                        className="mio-advanced-mini"
                        data-testid="mio-stage-debug-reset"
                        onClick={handleResetRezeSceneDebug}
                      >
                        恢复默认
                      </button>
                    </div>

                    <div className="mio-stage-debug-tabs" role="tablist" aria-label={renderPipeline === "reze-k3" ? "Reze K3 调试类别" : "Reze Design 调试类别"}>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={stageDebugTab === "scene"}
                        className={`mio-stage-debug-tab ${stageDebugTab === "scene" ? "is-active" : ""}`}
                        onClick={() => setStageDebugTab("scene")}
                      >
                        场景
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={stageDebugTab === "materials"}
                        className={`mio-stage-debug-tab ${stageDebugTab === "materials" ? "is-active" : ""}`}
                        onClick={() => {
                          setStageDebugTab("materials");
                          window.setTimeout(refreshStageMaterialDebug, 0);
                        }}
                      >
                        材质
                      </button>
                    </div>

                    {stageDebugTab === "scene" ? (
                      <div className="mio-stage-debug-controls" role="tabpanel" aria-label="场景调试">
                        <section className="mio-reze-inspector-section mio-reze-scene-document">
                          <header>场景文档</header>
                          <label>
                            <span>名称</span>
                            <input
                              value={rezeStageDocument.name}
                              aria-label="场景名称"
                              onChange={(event) => setRezeStageDocument((current) => ({ ...current, name: event.target.value.slice(0, 60), updatedAt: new Date().toISOString() }))}
                            />
                          </label>
                          <div className="mio-reze-document-actions">
                            <button type="button" className="mio-advanced-mini" onClick={() => {
                              const payload = JSON.stringify({ ...rezeStageDocument, scene: rezeSceneDebugSettings }, null, 2);
                              const blob = new Blob([payload], { type: "application/json" });
                              const href = URL.createObjectURL(blob);
                              const anchor = document.createElement("a");
                              anchor.href = href;
                              anchor.download = `${rezeStageDocument.name || "reze-scene"}.json`;
                              anchor.click();
                              URL.revokeObjectURL(href);
                            }}>导出 JSON</button>
                            <label className="mio-advanced-mini mio-reze-import-button">导入 JSON<input type="file" accept="application/json" onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (!file) return;
                              void file.text().then((text) => {
                                try {
                                  const next = normalizeRezeStageDocument(JSON.parse(text), getRezeSceneDebugDefaults(renderPipeline));
                                  setRezeStageDocument(next);
                                  setRezeSceneDebugSettings(next.scene);
                                  stageRef.current?.setSceneDebugSettings?.(next.scene);
                                } catch {
                                  setAdvancedError("场景 JSON 无法读取。");
                                }
                              });
                              event.currentTarget.value = "";
                            }} /></label>
                          </div>
                        </section>
                        <section className="mio-reze-inspector-section">
                          <header>调色</header>
                          <label className="mio-stage-material-preset">
                            <span>预设</span>
                            <select value={rezeStageDocument.grade} aria-label="调色预设" onChange={(event) => setRezeStageDocument((current) => ({ ...current, grade: event.target.value as RezeStageDocument["grade"], updatedAt: new Date().toISOString() }))}>
                              {REZE_GRADE_PRESETS.map((preset) => <option key={preset} value={preset}>{preset}</option>)}
                            </select>
                          </label>
                          <label className="mio-stage-debug-control">
                            <span>强度</span>
                            <output>{rezeStageDocument.gradeIntensity.toFixed(2)}</output>
                            <input type="range" min="0" max="1" step="0.01" value={rezeStageDocument.gradeIntensity} aria-label="调色强度" onChange={(event) => setRezeStageDocument((current) => ({ ...current, gradeIntensity: Number(event.target.value), updatedAt: new Date().toISOString() }))} />
                          </label>
                        </section>
                        <section className="mio-reze-inspector-section">
                          <header>背景</header>
                          <label className="mio-stage-color-control">
                            <span>颜色</span>
                            <input type="color" value={rezeSceneDebugSettings.backgroundColor} aria-label="背景颜色" onChange={(event) => handleRezeSceneDebugChange("backgroundColor", event.target.value)} />
                            <output>{rezeSceneDebugSettings.backgroundColor}</output>
                          </label>
                          <label className="mio-stage-material-preset"><span>特效</span><select value={rezeStageDocument.backgroundEffect} aria-label="背景特效" onChange={(event) => setRezeStageDocument((current) => ({ ...current, backgroundEffect: event.target.value as RezeStageDocument["backgroundEffect"], updatedAt: new Date().toISOString() }))}>{REZE_BACKGROUND_EFFECTS.map((effect) => <option key={effect} value={effect}>{effect}</option>)}</select></label>
                        </section>
                        <section className="mio-reze-inspector-section">
                          <header>太阳</header>
                          <label className="mio-stage-color-control">
                            <span>颜色</span>
                            <input type="color" value={rezeSceneDebugSettings.sunColor} aria-label="主光颜色" onChange={(event) => handleRezeSceneDebugChange("sunColor", event.target.value)} />
                            <output>{rezeSceneDebugSettings.sunColor}</output>
                          </label>
                        {([
                          ["keyIntensity", "主光强度", 0, 3, 0.01],
                          ["sunAzimuth", "主光方位", -360, 360, 1],
                          ["sunElevation", "主光仰角", 0, 89, 1],
                        ] as Array<["keyIntensity" | "sunAzimuth" | "sunElevation", string, number, number, number]>).map(([key, label, min, max, step]) => (
                          <label className="mio-stage-debug-control" key={key}>
                            <span>{label}</span>
                            <output>{step >= 1 ? rezeSceneDebugSettings[key].toFixed(0) : rezeSceneDebugSettings[key].toFixed(step === 0.1 ? 1 : 2)}</output>
                            <input type="range" min={min} max={max} step={step} value={rezeSceneDebugSettings[key]} aria-label={label} onChange={(event) => handleRezeSceneDebugChange(key, Number(event.target.value))} />
                          </label>
                        ))}
                        </section>
                        <section className="mio-reze-inspector-section">
                          <header>世界光</header>
                          <label className="mio-stage-color-control">
                            <span>颜色</span>
                            <input type="color" value={rezeSceneDebugSettings.worldColor} aria-label="世界光颜色" onChange={(event) => handleRezeSceneDebugChange("worldColor", event.target.value)} />
                            <output>{rezeSceneDebugSettings.worldColor}</output>
                          </label>
                          {([ ["ambientIntensity", "强度", 0, 2, 0.01] ] as Array<["ambientIntensity", string, number, number, number]>).map(([key, label, min, max, step]) => (
                            <label className="mio-stage-debug-control" key={key}><span>{label}</span><output>{rezeSceneDebugSettings[key].toFixed(2)}</output><input type="range" min={min} max={max} step={step} value={rezeSceneDebugSettings[key]} aria-label={`世界光${label}`} onChange={(event) => handleRezeSceneDebugChange(key, Number(event.target.value))} /></label>
                          ))}
                        </section>
                        <section className="mio-reze-inspector-section">
                          <header>泛光</header>
                          <label className="mio-stage-color-control">
                            <span>颜色</span>
                            <input type="color" value={rezeSceneDebugSettings.bloomColor} aria-label="泛光颜色" onChange={(event) => handleRezeSceneDebugChange("bloomColor", event.target.value)} />
                            <output>{rezeSceneDebugSettings.bloomColor}</output>
                          </label>
                          {([
                            ["bloomThreshold", "阈值", 0, 1, 0.01],
                            ["bloomKnee", "膝点", 0, 1, 0.01],
                            ["bloomRadius", "半径", 0, 8, 0.1],
                            ["bloomStrength", "强度", 0, 1, 0.01],
                          ] as Array<["bloomThreshold" | "bloomKnee" | "bloomRadius" | "bloomStrength", string, number, number, number]>).map(([key, label, min, max, step]) => (
                            <label className="mio-stage-debug-control" key={key}><span>{label}</span><output>{rezeSceneDebugSettings[key].toFixed(2)}</output><input type="range" min={min} max={max} step={step} value={rezeSceneDebugSettings[key]} aria-label={`泛光${label}`} onChange={(event) => handleRezeSceneDebugChange(key, Number(event.target.value))} /></label>
                          ))}
                        </section>
                        <section className="mio-reze-inspector-section">
                          <header>地面</header>
                          <label className="mio-stage-color-control"><span>颜色</span><input type="color" value={rezeSceneDebugSettings.groundColor} aria-label="地面颜色" onChange={(event) => handleRezeSceneDebugChange("groundColor", event.target.value)} /><output>{rezeSceneDebugSettings.groundColor}</output></label>
                          <div className="mio-stage-debug-toggle"><span>不透明度</span><output>{rezeSceneDebugSettings.groundOpacity.toFixed(2)}</output><input type="range" min="0" max="1" step="0.01" value={rezeSceneDebugSettings.groundOpacity} aria-label="地面不透明度" onChange={(event) => handleRezeSceneDebugChange("groundOpacity", Number(event.target.value))} /></div>
                          <label className="mio-stage-material-toggle"><span>阴影</span><input type="checkbox" checked={rezeSceneDebugSettings.groundShadow} aria-label="地面阴影" onChange={(event) => handleRezeSceneDebugChange("groundShadow", event.target.checked)} /></label>
                          <label className="mio-stage-color-control"><span>网格颜色</span><input type="color" value={rezeSceneDebugSettings.groundGridColor} aria-label="地面网格颜色" onChange={(event) => handleRezeSceneDebugChange("groundGridColor", event.target.value)} /><output>{rezeSceneDebugSettings.groundGridColor}</output></label>
                          <label className="mio-stage-material-toggle"><span>网格线</span><input type="checkbox" checked={rezeSceneDebugSettings.groundGridEnabled} aria-label="地面网格线" onChange={(event) => handleRezeSceneDebugChange("groundGridEnabled", event.target.checked)} /></label>
                          <label className="mio-stage-debug-control"><span>尺寸</span><output>{rezeSceneDebugSettings.groundSize.toFixed(0)}</output><input type="range" min="20" max="240" step="1" value={rezeSceneDebugSettings.groundSize} aria-label="地面尺寸" onChange={(event) => handleRezeSceneDebugChange("groundSize", Number(event.target.value))} /></label>
                        </section>
                        <section className="mio-reze-inspector-section">
                          <header>相机</header>
                          {([
                          ["cameraDistance", "相机距离", 8, 72, 0.1],
                          ["cameraTargetX", "目标点 X", -20, 20, 0.1],
                          ["cameraTargetY", "目标点 Y", -10, 30, 0.1],
                          ["cameraTargetZ", "目标点 Z", -20, 20, 0.1],
                        ] as Array<["cameraDistance" | "cameraTargetX" | "cameraTargetY" | "cameraTargetZ", string, number, number, number]>).map(([key, label, min, max, step]) => (
                          <label className="mio-stage-debug-control" key={key}>
                            <span>{label}</span>
                            <output>{step >= 1 ? rezeSceneDebugSettings[key].toFixed(0) : rezeSceneDebugSettings[key].toFixed(step === 0.1 ? 1 : 2)}</output>
                            <input
                              type="range"
                              min={min}
                              max={max}
                              step={step}
                              value={rezeSceneDebugSettings[key]}
                              aria-label={label}
                              onChange={(event) => handleRezeSceneDebugChange(key, Number(event.target.value))}
                            />
                          </label>
                        ))}
                        </section>
                      </div>
                    ) : stageDebugTab === "materials" ? (
                      <div className="mio-reze-material-browser" role="tabpanel" aria-label="Reze 材质库">
                        <div className="mio-reze-material-browser-head">
                          <span>样式组</span>
                          <div>
                            <button type="button" className="mio-reze-add-style-group" aria-label="新增样式组" disabled title="当前版本按 PMX 实际材质自动分组">＋</button>
                            <button
                              type="button"
                              className="mio-reze-material-library-button"
                              aria-expanded={isRezeMaterialLibraryOpen}
                              aria-controls="mio-reze-material-library"
                              onClick={() => setIsRezeMaterialLibraryOpen((open) => !open)}
                            >
                              ◌ 素材库
                            </button>
                          </div>
                        </div>

                        {isRezeMaterialLibraryOpen ? (
                          <section id="mio-reze-material-library" className="mio-reze-material-library" aria-label="材质库预设">
                            <header>
                              <strong>材质库</strong>
                              <button type="button" aria-label="关闭材质库" onClick={() => setIsRezeMaterialLibraryOpen(false)}>×</button>
                            </header>
                            <p>选择预设后会应用到当前选中的 PMX 材质。</p>
                            <div>
                              {REZE_EXECUTABLE_MATERIAL_PRESETS.map((preset) => (
                                <button
                                  key={preset}
                                  type="button"
                                  className={selectedRezeMaterial?.preset === preset ? "is-active" : ""}
                                  disabled={!selectedRezeMaterial}
                                  onClick={() => selectedRezeMaterial && handleRezeMaterialPreset(selectedRezeMaterial.id, preset)}
                                >
                                  {preset}
                                </button>
                              ))}
                            </div>
                          </section>
                        ) : null}

                        {rezeMaterialGroups.length ? (
                          <div className="mio-reze-material-tree" aria-label="PMX 材质样式组">
                            {rezeMaterialGroups.map((group) => (
                              <details key={group.id} className="mio-reze-material-group" open>
                                <summary>
                                  <span>{group.label}</span>
                                  {group.preset ? (
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.preventDefault();
                                        handleRezeStyleGroupPreset(group);
                                      }}
                                      title={`将 ${group.preset} 应用到 ${group.label} 样式组`}
                                    >
                                      {group.preset}
                                    </button>
                                  ) : <small>未映射</small>}
                                </summary>
                                <div className="mio-reze-material-leaves">
                                  {group.entries.map((entry) => (
                                    <button
                                      key={entry.id}
                                      type="button"
                                      className={`mio-reze-material-leaf ${selectedRezeMaterial?.id === entry.id ? "is-selected" : ""} ${entry.visible ? "" : "is-hidden"}`}
                                      aria-pressed={selectedRezeMaterial?.id === entry.id}
                                      onClick={() => setSelectedRezeMaterialId(entry.id)}
                                    >
                                      <span>{entry.name}</span>
                                      {!entry.visible ? <i aria-label="已隐藏">◉</i> : null}
                                    </button>
                                  ))}
                                </div>
                              </details>
                            ))}
                          </div>
                        ) : (
                          <p className="mio-advanced-empty">模型尚未完成加载，或请点击“刷新材质”重新读取。</p>
                        )}

                        {selectedRezeMaterial ? (
                          <section className="mio-reze-material-inspector" aria-label={`${selectedRezeMaterial.name} 材质详情`}>
                            <header>
                              <div><strong>{selectedRezeMaterial.name}</strong><span>{selectedRezeMaterial.meshName}</span></div>
                              <button type="button" className="mio-advanced-mini" onClick={refreshStageMaterialDebug}>刷新材质</button>
                            </header>
                            <label className="mio-stage-material-preset">
                              <span>材质图</span>
                              <select
                                value={(rezeStageDocument.materialPresets[selectedRezeMaterial.id] ?? selectedRezeMaterial.preset ?? "默认") as RezeExecutableMaterialPreset}
                                aria-label={`${selectedRezeMaterial.name} 材质图`}
                                onChange={(event) => handleRezeMaterialPreset(selectedRezeMaterial.id, event.target.value as RezeExecutableMaterialPreset)}
                              >
                                {REZE_EXECUTABLE_MATERIAL_PRESETS.map((preset) => <option key={preset} value={preset}>{preset}</option>)}
                              </select>
                            </label>
                            <label className="mio-stage-material-toggle">
                              <span>可见</span>
                              <input type="checkbox" checked={selectedRezeMaterial.visible} aria-label={`${selectedRezeMaterial.name} 可见`} onChange={(event) => handleStageMaterialDebugChange(selectedRezeMaterial.id, { visible: event.target.checked })} />
                            </label>
                            <label className="mio-stage-debug-control">
                              <span>透明度</span><output>{selectedRezeMaterial.opacity.toFixed(2)}</output>
                              <input type="range" min="0" max="1" step="0.01" value={selectedRezeMaterial.opacity} aria-label={`${selectedRezeMaterial.name} 透明度`} disabled={selectedRezeMaterial.supportsOpacity === false} onChange={(event) => handleStageMaterialDebugChange(selectedRezeMaterial.id, { opacity: Number(event.target.value) })} />
                            </label>
                            <label className="mio-stage-debug-control">
                              <span>发光强度</span><output>{selectedRezeMaterial.emissiveIntensity.toFixed(2)}</output>
                              <input type="range" min="0" max="2" step="0.01" value={selectedRezeMaterial.emissiveIntensity} aria-label={`${selectedRezeMaterial.name} 发光强度`} disabled={selectedRezeMaterial.supportsEmissive === false} onChange={(event) => handleStageMaterialDebugChange(selectedRezeMaterial.id, { emissiveIntensity: Number(event.target.value) })} />
                            </label>
                            {selectedRezeMaterial.supportsOpacity === false || selectedRezeMaterial.supportsEmissive === false ? <small className="mio-stage-material-limitation">WebGPU 当前通过 WGSL 材质图控制外观；单材质透明度与发光滑块尚未映射。</small> : null}
                            <button type="button" className="mio-advanced-mini mio-stage-material-reset" onClick={() => handleResetStageMaterialDebug(selectedRezeMaterial.id)}>重置此材质</button>
                          </section>
                        ) : null}
                      </div>
                    ) : stageDebugTab === "assets" ? (
                      <div className="mio-stage-debug-controls" role="tabpanel" aria-label="资产">
                        <section className="mio-reze-inspector-section">
                          <header>角色模型</header>
                          <label className="mio-stage-material-preset"><span>当前模型</span><select aria-label="Reze 编辑器模型" value={selectedModel?.relative_path || ""} onChange={(event) => handleCharacterSwitch(event.target.value)}>{models.map((model) => <option key={model.relative_path} value={model.relative_path}>{getModelDisplayLabel(model)}</option>)}</select></label>
                          <label className="mio-advanced-upload" title="选择含 PMX 与贴图的模型根目录">
                            <span>导入本地 PMX 模型目录</span>
                            <input
                              type="file"
                              multiple
                              ref={(element) => element?.setAttribute("webkitdirectory", "")}
                              onChange={(event) => {
                                handleRezePmxImport(event.target.files);
                                event.currentTarget.value = "";
                              }}
                            />
                          </label>
                          <p className="mio-reze-panel-note">请选择包含 PMX 与全部贴图的完整模型目录。导入内容仅保留在当前浏览器会话，刷新页面后需重新导入。</p>
                          {rezeLocalModelImport ? <p className="mio-reze-panel-note">当前本地导入：{rezeLocalModelImport.pmxFile.name}（{rezeLocalModelImport.files.length} 个文件）</p> : null}
                        </section>
                        <section className="mio-reze-inspector-section">
                          <header>动作</header>
                          <label className={`mio-advanced-upload ${advancedBusy ? "is-busy" : ""}`}><span>{advancedBusy ? "正在导入…" : "导入 VMD"}</span><input type="file" accept=".vmd" multiple disabled={advancedBusy} onChange={(event) => { if (event.target.files?.length) void handleAdvancedUpload(event.target.files); event.currentTarget.value = ""; }} /></label>
                          <p className="mio-reze-panel-note">导入后的 VMD 会进入现有动作库；WebGPU 预览使用 reze-engine 自己的 IK/物理实现，不复用 Three.js 的 Grant solver。当前模型如显示兼容性错误，请切回 Reze NPR（WebGL）。</p>
                        </section>
                      </div>
                    ) : (
                      <div className="mio-stage-debug-controls" role="tabpanel" aria-label="渲染">
                        <section className="mio-reze-inspector-section">
                          <header>静帧导出</header>
                          <p className="mio-reze-panel-note">导出当前 WebGPU 舞台画布的 PNG。MIO CSS 背景与视频导出将在画布合成路径完成后提供。</p>
                          <button type="button" className="mio-advanced-mini is-active" onClick={handleExportRezeStagePng}>导出 PNG</button>
                        </section>
                        <section className="mio-reze-inspector-section">
                          <header>画面状态</header>
                          <div className="mio-stage-effect-row"><span>调色</span><output>{rezeStageDocument.grade}</output></div>
                          <div className="mio-stage-effect-row"><span>背景</span><output>{rezeStageDocument.backgroundEffect}</output></div>
                          <div className="mio-stage-effect-row"><span>渲染器</span><output>{stageRef.current?.getRendererLabel?.() ?? "准备中…"}</output></div>
                        </section>
                      </div>
                    )}
                    </div>
                  </section>
                ) : null}

                <section className="mio-camera-controls" data-testid="mio-camera-controls" aria-label="MMD camera controls">
                  <div className="mio-camera-controls-head">
                    <div>
                      <strong>MMD Camera</strong>
                      <span>
                        {stageCameraSnapshot
                          ? `Saved for ${renderPipeline}`
                          : `Default ${renderPipeline} camera`}
                      </span>
                    </div>
                    <span className={cameraEditMode ? "is-editing" : ""} data-testid="mio-camera-mode">
                      {cameraEditMode ? "Editing" : stageCameraSnapshot?.locked ? "Locked" : "Free"}
                    </span>
                  </div>
                  <p>Move the stage camera, then save this framing in the current session.</p>
                  <div className="mio-camera-actions">
                    <button
                      type="button"
                      className="mio-advanced-mini"
                      data-testid="mio-camera-unlock"
                      onClick={handleUnlockMmdCamera}
                      disabled={cameraEditMode}
                    >
                      Move Camera
                    </button>
                    <button
                      type="button"
                      className="mio-advanced-mini is-active"
                      data-testid="mio-camera-save"
                      onClick={handleSaveMmdCamera}
                    >
                      Save Camera
                    </button>
                    <button
                      type="button"
                      className="mio-advanced-mini"
                      data-testid="mio-camera-reset"
                      onClick={handleResetMmdCamera}
                    >
                      Reset
                    </button>
                  </div>
                </section>

                <div className="mio-advanced-toolbar">
                  <label className="mio-advanced-field">
                    <span>Emotion Slot</span>
                    <select
                      value={advancedSlot}
                      onChange={(event) => setAdvancedSlot(event.target.value as (typeof EMOTION_SLOTS)[number])}
                      disabled={advancedBusy}
                    >
                      {EMOTION_SLOTS.map((slot) => (
                        <option key={slot} value={slot}>
                          {slot}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="mio-advanced-field">
                    <span>Playback Rate</span>
                    <input
                      type="number"
                      min="0.1"
                      max="4"
                      step="0.1"
                      value={advancedPlaybackRate}
                      onChange={(event) => setAdvancedPlaybackRate(event.target.value)}
                      disabled={advancedBusy}
                    />
                  </label>
                  <label className="mio-advanced-field">
                    <span>播放器骨骼模式（全局生效，新导入与收藏共用）</span>
                    <select
                      aria-label="播放器骨骼模式"
                      value={playerVmdMode}
                      onChange={(event) => changePlayerVmdMode(event.target.value)}
                      disabled={advancedBusy || renderPipeline === "reze-design" || renderPipeline === "reze-k3"}
                    >
                      <option value="standard">普通VMD（启用IK与付与）</option>
                      <option value="baked">烘焙模式（默认，跳过IK与付与）</option>
                    </select>
                    <small>{renderPipeline === "reze-design" || renderPipeline === "reze-k3"
                      ? "Reze使用独立求解器，不受此开关控制。"
                      : "模式立即生效并保存在本浏览器。普通动作异常时切回普通VMD；两种模式均不固定根位置和下半身。"}</small>
                  </label>

                  <div className="mio-advanced-field" data-testid="stage-weapon-controls">
                    <span>配套武器</span>
                    <button type="button" className="mio-advanced-mini"
                      aria-label="显示武器" aria-pressed={weaponVisible && weaponSupported}
                      disabled={!weaponSupported}
                      onClick={() => setWeaponVisible((visible) => !visible)}>
                      显示武器：{weaponVisible && weaponSupported ? "开启" : "关闭"}
                    </button>
                    <small role="status" aria-live="polite" data-testid="stage-weapon-status">
                      {weaponSupported ? weaponState.detail : "仅支持现用克莱妲人物模型"}
                    </small>
                    {weaponState.phase === "error" && weaponSupported && (
                      <button type="button" className="mio-advanced-mini"
                        onClick={() => stageRef.current?.retryWeaponLoading?.()}>重试武器加载</button>
                    )}
                    <button type="button" className="mio-advanced-mini"
                      disabled={!weaponSupported || advancedBusy} onClick={previewWeaponMotion}>
                      试播配套动作
                    </button>
                    <small>已配套的 A07 和专属查看完整 VMD 在动作库预览时自动配枪，可用开关隐藏。下方试播为旧 8 倍速候选；握持待修，沿用当前播放器模式。</small>
                  </div>
                  <label className={`mio-advanced-upload ${advancedBusy ? "is-busy" : ""}`}>
                    <span>{advancedBusy ? "Importing..." : "Import VMD"}</span>
                    <input
                      type="file"
                      accept=".vmd"
                      multiple
                      disabled={advancedBusy}
                      onChange={(event) => {
                        if (event.target.files?.length) {
                          void handleAdvancedUpload(event.target.files);
                        }
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                  <label className={`mio-advanced-upload ${advancedBusy ? "is-busy" : ""}`}>
                    <span>{advancedBusy ? "Importing..." : "Import Folder"}</span>
                    <input
                      type="file"
                      accept=".vmd"
                      multiple
                      {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                      disabled={advancedBusy}
                      onChange={(event) => {
                        if (event.target.files?.length) {
                          void handleAdvancedUpload(event.target.files);
                        }
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="mio-advanced-mini"
                    onClick={() => void handleExportMotionContext()}
                    disabled={advancedBusy || !selectedModel?.relative_path}
                  >
                    Export Motion Context
                  </button>
                </div>

                {latestMotionContextExport ? (
                  <div className="mio-advanced-empty">
                    <p>
                      Motion context ready: {latestMotionContextExport.motion_count} favorite motion(s) for{" "}
                      {latestMotionContextExport.model_display_name}.
                    </p>
                    <pre className="mio-advanced-json-preview" data-testid="mio-motion-context-json">
                      {JSON.stringify(latestMotionContextExport.export_json, null, 2)}
                    </pre>
                  </div>
                ) : null}

                <section className="mio-advanced-library">
                  <button type="button" className="mio-advanced-mini" onClick={() => {
                    setAdvancedError("");
                    detachedVmdLibraryRef.current?.open();
                  }}>
                    分离动作列表
                  </button>
                  <button type="button" className="mio-advanced-mini" onClick={() => void handleExportFavoriteVmdZip()}
                    disabled={advancedBusy || !session || !selectedModel?.relative_path}>
                    {favoriteExportBusy ? "正在打包收藏…" : "导出当前模型全部收藏 VMD（ZIP）"}
                  </button>
                  <p className="mio-advanced-library-note">导出全部收藏，不受搜索或动作库排除影响；不包含模型和贴图。</p>
                  <div className="mio-advanced-tabs" role="tablist" aria-label="VMD asset views">
                    <button
                      type="button"
                      className={`mio-advanced-tab ${advancedTab === "library" ? "is-active" : ""}`}
                      role="tab"
                      aria-selected={advancedTab === "library"}
                      onClick={() => {
                        setAdvancedTab("library");
                        setAdvancedFavoriteSlotFilter("all");
                      }}
                    >
                      Library
                    </button>
                    <button
                      type="button"
                      className={`mio-advanced-tab ${advancedTab === "favorites" ? "is-active" : ""}`}
                      role="tab"
                      aria-selected={advancedTab === "favorites"}
                      onClick={() => setAdvancedTab("favorites")}
                    >
                      Favorites
                    </button>
                  </div>

                  {advancedError ? <p className="mio-advanced-error">{advancedError}</p> : null}
                  {advancedMessage && !advancedError ? <p className="mio-advanced-empty">{advancedMessage}</p> : null}

                  <div className="mio-advanced-list">
                    {advancedTab === "library" ? <button type="button" className="mio-advanced-mini"
                      disabled={advancedBusy || removableLibraryAssets.length === 0} onClick={() => requestLibraryRemoval()}>
                      全部移除（{removableLibraryAssets.length}）</button> : null}
                    {advancedTab === "library" ? <p className="mio-advanced-empty">从库移除只排除动作库条目，刷新后仍生效；原文件和已有模型收藏保留。内置及他人动作只读。</p> : null}
                    {advancedTab === "favorites" ? (
                      <p className="mio-advanced-empty" role="status">
                        点击角色时随机播放一个有效收藏动作；播放期间不响应重复点击。默认待机使用独立的顺序动作组，收藏为空时保持待机。
                      </p>
                    ) : null}
                    <div className="mio-advanced-list-head">
                      <span>{advancedTab === "library" ? "最近使用的 VMD 动作" : "已收藏动作（点击角色时随机播放）"}</span>
                      <strong>
                        {(advancedTab === "library" ? currentModelLibraryAssets.length : filteredFavoriteAssets.length)
                          .toString()
                          .padStart(2, "0")}
                      </strong>
                    </div>

                    {advancedTab === "favorites" ? (
                      <label className="mio-advanced-filter">
                        <span>Favorite Slot Filter</span>
                        <select
                          aria-label="Favorite slot filter"
                          value={advancedFavoriteSlotFilter}
                          onChange={(event) =>
                            setAdvancedFavoriteSlotFilter(event.target.value as "all" | (typeof EMOTION_SLOTS)[number])
                          }
                          disabled={advancedBusy}
                        >
                          <option value="all">All slots</option>
                          {EMOTION_SLOTS.map((slot) => (
                            <option key={slot} value={slot}>
                              {slot}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}

                    <div className="mio-advanced-list-scroll">
                      {(advancedTab === "library" ? currentModelLibraryAssets : filteredFavoriteAssets).length === 0 ? (
                        <p className="mio-advanced-empty">
                          {advancedTab === "library"
                            ? "No VMD assets are ready for preview yet."
                            : `当前模型「${selectedModel ? getModelDisplayLabel(selectedModel) : "未选择"}」没有匹配的收藏。完整路径：${selectedModel?.relative_path || selectedModelPath || "无"}。`}
                        </p>
                      ) : (
                        (advancedTab === "library" ? currentModelLibraryAssets : filteredFavoriteAssets).map((asset) => (
                          <div key={asset.asset_id} className="mio-advanced-asset" data-testid="mio-advanced-asset">
                            <button
                              type="button"
                              className="mio-advanced-asset-preview"
                              onClick={() => previewVmdAsset(asset)}
                            >
                              <span className="mio-advanced-asset-copy">
                                <strong>{asset.display_name || asset.filename}</strong>
                                <small>
                                  {asset.slot} · {(asset.size_bytes / 1024).toFixed(1)} KB
                                </small>
                              </span>
                              <span className="mio-advanced-asset-action">Preview</span>
                            </button>
                            <div className="mio-advanced-asset-tools">
                              {advancedTab === "library" && canRemoveFromLibrary(asset) ? (
                                <button type="button" className="mio-advanced-mini" disabled={advancedBusy}
                                  onClick={() => requestLibraryRemoval(asset)}>从库移除</button>
                              ) : null}
                              <button
                                type="button"
                                className={`mio-advanced-mini ${isFavoriteForModel(asset, selectedModel?.relative_path || selectedModelPath) ? "is-active" : ""}`}
                                onClick={() => handleFavoriteAsset(asset)}
                                disabled={advancedBusy || !selectedModel?.relative_path || isReadOnlySharedFavorite(asset)}
                                title={isReadOnlySharedFavorite(asset) ? "其他用户的动作只能预览，不能修改收藏。" : undefined}
                              >
                                {isReadOnlySharedFavorite(asset) ? "只读收藏" : isFavoriteForModel(asset, selectedModel?.relative_path || selectedModelPath) ? "Unfavorite" : "Favorite"}
                              </button>
                              <button
                                type="button"
                                className="mio-advanced-mini"
                                onClick={() => openRenameDialog(asset)}
                                disabled={advancedBusy}
                              >
                                Rename
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </section>
              </div>

              {renameTarget ? (
                <div className="mio-rename-scrim">
                  <div
                    className="mio-rename-dialog"
                    data-testid="mio-rename-dialog"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="mio-rename-title"
                    onKeyDown={handleRenameDialogKeyDown}
                  >
                    <div className="mio-rename-copy">
                      <strong id="mio-rename-title">Rename Motion</strong>
                      <span>{renameTarget.filename}</span>
                    </div>
                    <input
                      className="mio-rename-input"
                      data-testid="mio-rename-input"
                      value={renameDraft}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      placeholder="Enter motion name"
                      autoFocus
                    />
                    <div className="mio-rename-actions">
                      <button type="button" className="mio-advanced-mini" onClick={closeRenameDialog} disabled={advancedBusy}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="mio-advanced-mini is-active"
                        onClick={() => void handleRenameAssetConfirm()}
                        disabled={advancedBusy}
                      >
                        Confirm
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null
        }
        onSubmit={onSubmit}
        onInputChange={setInput}
        onTtsEnabledChange={handleTtsEnabledChange}
        onAdvancedToggle={() => {
          setIsAdvancedPanelOpen((open) => !open);
          setAdvancedError("");
          setAdvancedTab("library");
          setAdvancedFavoriteSlotFilter("all");
          setIsRezeEditorOpen(false);
        }}
      />
      <DetachedVmdLibrary
        ref={detachedVmdLibraryRef}
        library={currentModelLibraryAssets}
        favorites={scopedFavoriteAssets}
        modelLabel={selectedModel ? getModelDisplayLabel(selectedModel) : ""}
        modelPath={selectedModel?.relative_path || selectedModelPath}
        activeAssetId={stageInteractionState.mode === "manual_preview" ? activeVmdAssetId : ""}
        busy={advancedBusy}
        error={advancedError}
        message={advancedMessage}
        exportBusy={favoriteExportBusy}
        onExport={() => void handleExportFavoriteVmdZip()}
        isReadOnly={isReadOnlySharedFavorite}
        isFavorite={(asset) => isFavoriteForModel(asset, selectedModel?.relative_path || selectedModelPath)}
        onPreview={previewVmdAsset}
        onFavorite={handleFavoriteAsset}
        canRemove={canRemoveFromLibrary}
        onRemove={handleRemoveFromLibrary}
        removableLibrary={removableLibraryAssets}
        onRemoveAll={handleRemoveAllFromLibrary}
        onRemovalPrompt={clearRemovalFeedback}
        onBlocked={() => setAdvancedError("浏览器阻止了动作列表窗口，请允许此网站弹出窗口后再次点击「分离动作列表」。")}
      />
      {libraryRemoval ? <VmdLibraryConfirmation selection={libraryRemoval} busy={advancedBusy} error={advancedError}
          onCancel={() => setLibraryRemoval(null)} onConfirm={async () => {
            const asset = assets.find((item) => item.asset_id === libraryRemoval.assetIds[0]);
            const success = libraryRemoval.all ? await handleRemoveAllFromLibrary(libraryRemoval.assetIds)
              : asset ? await handleRemoveFromLibrary(asset) : false;
            if (success) setLibraryRemoval(null);
          }} /> : null}
      <div className="mio-toast-layer" aria-live="polite" aria-atomic="true">
        {toast ? (
          <div className="mio-toast" role="status">
            {toast.message}
          </div>
        ) : null}
      </div>
    </BlueprintPage>
  );
}
