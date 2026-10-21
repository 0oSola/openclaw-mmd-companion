import type { MmdModelAsset, RenderPipeline, VmdAsset } from "@/lib/types";
import { buildAutoFavoriteInteraction, isEulaFavoriteMotionAsset, isUniversalBuiltInMotionAsset, mergeFavoriteMotionAssets } from "@/features/mapping/vmdPreview.js";
import { resolveStageCharacterClickInteraction } from "@/features/stage/stageCharacterClick.js";
import type { CodexLaunchState, CodexStatusMotionIntent } from "../codex/codexStatus";

const MIN_FALLBACK_MODEL_BYTES = 1024;

type PetStageInteraction = {
  emotion: string;
  action: string;
  mode: "procedural" | "vmd";
  vmdUrl?: string;
  vmdLoopUrls?: string[];
  vmdLoopEmotionByUrl?: Record<string, string>;
  standbyVmdUrl?: string;
  loopGapMs?: number;
  loopMode?: "random" | "sequential";
  lockLowerBody?: boolean;
  disableCrossfade?: boolean;
  playbackRate?: number;
  sequence?: Array<{
    template: string;
    action: string;
    durationMs: number;
    intensity: number;
  }>;
};

type PetStageClickInteraction = {
  activeVmdAssetId: string;
  interaction: PetStageInteraction;
};

type PetStageInteractionViewState = {
  mode: "default_idle" | "autoplay_loop" | "stage_click_vmd_action" | "stage_click_procedural_action";
  source: "default" | "autoplay" | "stage-click";
  interaction: PetStageInteraction;
  activeVmdAssetId: string;
  pendingAutoResume: boolean;
};

type CodexStatusPetStageResolution = {
  priority: "idle" | "codex-status" | "click-interaction";
  shouldApply: boolean;
  interaction: PetStageInteraction | null;
  blockedBy?: "click-interaction-active" | "idle-not-interrupted";
};

type PetStageInteractionFallbackResult = {
  interaction: PetStageInteraction | null;
  fallbackApplied: boolean;
  reason?: "missing-interaction" | "unsupported-procedural-action" | "no-playable-fallback";
};

const PROCEDURAL_IDLE_INTERACTION: PetStageInteraction = {
  emotion: "neutral",
  action: "idle",
  mode: "procedural",
  vmdLoopUrls: [],
  loopMode: "random",
  loopGapMs: 600,
};

const CODEX_STATUS_INTERACTIONS: Record<CodexStatusMotionIntent, PetStageInteraction> = {
  idle: PROCEDURAL_IDLE_INTERACTION,
  thinking: {
    emotion: "focused",
    action: "thinking",
    mode: "procedural",
  },
  command: {
    emotion: "focused",
    action: "command_running",
    mode: "procedural",
  },
  file_change: {
    emotion: "alert",
    action: "file_changed",
    mode: "procedural",
  },
  approval: {
    emotion: "concerned",
    action: "approval_prompt",
    mode: "procedural",
  },
  complete: {
    emotion: "happy",
    action: "completed",
    mode: "procedural",
  },
  failure: {
    emotion: "concerned",
    action: "failed",
    mode: "procedural",
  },
  disconnected: {
    emotion: "neutral",
    action: "disconnected",
    mode: "procedural",
  },
};

const SUPPORTED_RUNTIME_PROCEDURAL_ACTIONS = new Set([
  "idle",
  "nod",
  "wave",
  "think",
  "cheer",
  "comfort",
  "lean_in",
  "look_away",
  "headshake",
]);

function isFallbackLoadable(model: MmdModelAsset): boolean {
  return typeof model.size_bytes !== "number" || model.size_bytes >= MIN_FALLBACK_MODEL_BYTES;
}

export function pickSelectedModel(models: MmdModelAsset[], selectedModelPath: string | null | undefined) {
  if (selectedModelPath) {
    return models.find((model) => model.relative_path === selectedModelPath) ?? models.find(isFallbackLoadable) ?? models[0] ?? null;
  }
  return models.find(isFallbackLoadable) ?? models[0] ?? null;
}

export function selectFavoriteVmdUrls(assets: VmdAsset[], selectedModelPath: string): string[] {
  return assets
    .filter((asset) => asset.is_favorite && asset.favorite_model_relative_path === selectedModelPath)
    .map((asset) => `/assets/vmd/file/${asset.asset_id}`);
}

function selectCurrentModelFavoriteVmdAssets(assets: VmdAsset[], selectedModelPath: string): VmdAsset[] {
  const ownFavorites = assets.filter((asset) => asset.is_favorite && asset.favorite_model_relative_path === selectedModelPath);
  const sharedFavorites = assets.filter((asset) => isEulaFavoriteMotionAsset(asset) || isUniversalBuiltInMotionAsset(asset));
  return mergeFavoriteMotionAssets(ownFavorites, sharedFavorites);
}

function resolveActiveVmdAssetId(assets: VmdAsset[], vmdUrl: string): string {
  if (!vmdUrl) return "";
  return assets.find((asset) => asset.url === vmdUrl)?.asset_id || "";
}

function resolveInteractionUrls(interaction: PetStageInteraction, resolveUrl: (url: string) => string): PetStageInteraction {
  const vmdLoopEmotionByUrl = interaction.vmdLoopEmotionByUrl
    ? Object.fromEntries(Object.entries(interaction.vmdLoopEmotionByUrl).map(([url, emotion]) => [resolveUrl(url), emotion]))
    : interaction.vmdLoopEmotionByUrl;

  return {
    ...interaction,
    vmdUrl: interaction.vmdUrl ? resolveUrl(interaction.vmdUrl) : interaction.vmdUrl,
    vmdLoopUrls: interaction.vmdLoopUrls?.map((url) => resolveUrl(url)) ?? interaction.vmdLoopUrls,
    vmdLoopEmotionByUrl,
    standbyVmdUrl: interaction.standbyVmdUrl ? resolveUrl(interaction.standbyVmdUrl) : interaction.standbyVmdUrl,
  };
}

export function resetPetStageInteractionState(
  defaultInteraction: PetStageInteraction = PROCEDURAL_IDLE_INTERACTION,
): PetStageInteractionViewState {
  return {
    mode: "default_idle",
    source: "default",
    interaction: defaultInteraction,
    activeVmdAssetId: "",
    pendingAutoResume: false,
  };
}

export function buildPetIdleInteraction(
  assets: VmdAsset[],
  selectedModelPath: string,
  resolveUrl: (url: string) => string = (url) => url,
): PetStageInteraction {
  const currentModelFavorites = selectCurrentModelFavoriteVmdAssets(assets, selectedModelPath);
  const interaction = buildAutoFavoriteInteraction(currentModelFavorites) as PetStageInteraction | null;
  if (!interaction) return PROCEDURAL_IDLE_INTERACTION;
  return resolveInteractionUrls(interaction, resolveUrl);
}

export function buildPetAutoplayIdleState(
  assets: VmdAsset[],
  selectedModelPath: string,
  resolveUrl: (url: string) => string = (url) => url,
): PetStageInteractionViewState {
  const currentModelFavorites = selectCurrentModelFavoriteVmdAssets(assets, selectedModelPath);
  const interaction = buildAutoFavoriteInteraction(currentModelFavorites) as PetStageInteraction | null;
  if (!interaction?.vmdUrl || interaction.mode !== "vmd") {
    return resetPetStageInteractionState();
  }

  return {
    mode: "autoplay_loop",
    source: "autoplay",
    interaction: resolveInteractionUrls(interaction, resolveUrl),
    activeVmdAssetId: resolveActiveVmdAssetId(currentModelFavorites, interaction.vmdUrl),
    pendingAutoResume: false,
  };
}

export function buildPetStageClickInteraction({
  assets,
  selectedModelPath,
  previousActiveVmdAssetId = "",
  randomValue,
  resolveUrl = (url) => url,
}: {
  assets: VmdAsset[];
  selectedModelPath: string;
  previousActiveVmdAssetId?: string;
  randomValue?: number;
  resolveUrl?: (url: string) => string;
}): PetStageClickInteraction {
  const currentModelFavorites = selectCurrentModelFavoriteVmdAssets(assets, selectedModelPath);
  const clickAction = resolveStageCharacterClickInteraction({
    assets: currentModelFavorites,
    previousActiveVmdAssetId,
    ...(typeof randomValue === "number" ? { randomValue } : {}),
  }) as PetStageClickInteraction;
  return {
    activeVmdAssetId: clickAction.activeVmdAssetId,
    interaction: resolveInteractionUrls(clickAction.interaction, resolveUrl),
  };
}

export function buildPetStageClickInteractionState(clickAction: PetStageClickInteraction): PetStageInteractionViewState {
  return {
    mode: clickAction.interaction.mode === "vmd" ? "stage_click_vmd_action" : "stage_click_procedural_action",
    source: "stage-click",
    interaction: clickAction.interaction,
    activeVmdAssetId: clickAction.activeVmdAssetId,
    pendingAutoResume: true,
  };
}

export function buildPetStageKey(selectedModelPath: string, renderPipeline: RenderPipeline, reloadRevision: number): string {
  return `${selectedModelPath}::${renderPipeline}::${reloadRevision}`;
}

export function buildCodexStatusPetStageResolution(
  presentation: { motionIntent: CodexStatusMotionIntent; shouldInterruptIdle: boolean },
  options: { clickInteractionActive?: boolean } = {},
): CodexStatusPetStageResolution {
  if (options.clickInteractionActive) {
    return {
      priority: "click-interaction",
      shouldApply: false,
      interaction: null,
      blockedBy: "click-interaction-active",
    };
  }

  if (!presentation.shouldInterruptIdle || presentation.motionIntent === "idle") {
    return {
      priority: "idle",
      shouldApply: false,
      interaction: null,
      blockedBy: "idle-not-interrupted",
    };
  }

  return {
    priority: "codex-status",
    shouldApply: true,
    interaction: CODEX_STATUS_INTERACTIONS[presentation.motionIntent],
  };
}

function hasPlayableVmdHit(interaction: PetStageInteraction): boolean {
  return Boolean(interaction.mode === "vmd" && interaction.vmdUrl);
}

function hasSupportedProceduralHit(interaction: PetStageInteraction): boolean {
  if (interaction.mode !== "procedural") return false;
  if (SUPPORTED_RUNTIME_PROCEDURAL_ACTIONS.has(interaction.action)) return true;
  return Boolean(
    interaction.sequence?.some((step) => SUPPORTED_RUNTIME_PROCEDURAL_ACTIONS.has(step.action)),
  );
}

export function resolvePetStageInteractionWithFallback(
  requestedInteraction: PetStageInteraction | null | undefined,
  favoriteLoopInteraction: PetStageInteraction,
): PetStageInteractionFallbackResult {
  if (!requestedInteraction) {
    if (!hasPlayableVmdHit(favoriteLoopInteraction)) {
      return {
        interaction: null,
        fallbackApplied: true,
        reason: "no-playable-fallback",
      };
    }
    return {
      interaction: favoriteLoopInteraction,
      fallbackApplied: true,
      reason: "missing-interaction",
    };
  }

  if (hasPlayableVmdHit(requestedInteraction) || hasSupportedProceduralHit(requestedInteraction)) {
    return {
      interaction: requestedInteraction,
      fallbackApplied: false,
    };
  }

  if (!hasPlayableVmdHit(favoriteLoopInteraction)) {
    return {
      interaction: null,
      fallbackApplied: true,
      reason: "no-playable-fallback",
    };
  }

  return {
    interaction: favoriteLoopInteraction,
    fallbackApplied: true,
    reason: "unsupported-procedural-action",
  };
}

export function shouldReplayCodexStatusMotionOnCompletion(state: CodexLaunchState | null | undefined): boolean {
  return (
    state === "starting" ||
    state === "launched" ||
    state === "resuming" ||
    state === "running" ||
    state === "command_running" ||
    state === "file_changed" ||
    state === "waiting_approval" ||
    state === "disconnected"
  );
}
