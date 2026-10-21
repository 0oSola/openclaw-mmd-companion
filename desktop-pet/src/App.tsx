import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MMDStage } from "@/features/stage/MMDStage";
import type { MMDStageHandle } from "@/features/stage/MMDStage";
import {
  createStageClickRipple,
  shouldTriggerStageCharacterClick,
  STAGE_CLICK_RIPPLE_DURATION_MS,
} from "@/features/stage/stageCharacterClick.js";
import type { CompanionSharedConfig, MmdCameraSnapshot, MmdModelAsset, RenderPipeline, VmdAsset } from "@/lib/types";
import { normalizeRezeStageDocument } from "@/features/stage/rezeEditorScene";
import { REZE_DESIGN_SCENE_DEFAULTS, REZE_K3_SCENE_DEFAULTS } from "@/features/stage/rezeDesignDefaults";

import { getCodexStatusPresentation, type CodexStatus } from "./codex/codexStatus";
import { buildCodexStatusCard, buildIdleCodexStatusCardFallback } from "./codex/codexStatusCard";
import { buildApprovalFallback } from "./codex/approvalFallback";
import { formatCodexStatusNotification } from "./codex/notificationDetail";
import {
  buildSessionPickerItems,
  filterSessionPickerItems,
  type DesktopPetSession,
} from "./codex/sessionPicker";
import { createApiClient } from "./lib/apiClient";
import { describeMainSiteSyncResult, describeMenuActionResult } from "./menu/menuActionStatus";
import {
  loadPetCameraSnapshot,
  loadPetRezeCameraDistance,
  preparePetCameraSnapshotForStorage,
  resolvePetRezeCameraDistance,
  savePetCameraSnapshot,
  savePetRezeCameraDistance,
  shouldPersistPetCameraOnModeChange,
} from "./mmd/petCameraState";
import {
  buildPetAutoplayIdleState,
  buildCodexStatusPetStageResolution,
  buildPetStageClickInteraction,
  buildPetStageClickInteractionState,
  buildPetStageKey,
  pickSelectedModel,
  resetPetStageInteractionState,
  resolvePetStageInteractionWithFallback,
  shouldReplayCodexStatusMotionOnCompletion,
} from "./mmd/petStageState";
import {
  hasPetPointerMoved,
  shouldActivatePetWindowDrag,
  shouldStopPetWindowDragPropagation,
} from "./window/petWindowEvents";

const DEFAULT_USER_ID = "admin-1";
// 画布修正为真正覆盖整个 Pet 窗口后，垂直视图范围变大；
// 使用 30 的安全距离，保留完整角色并仍允许交互模式继续缩放。
const PET_REZE_K3_CAMERA_DISTANCE = 30;
const DEFAULT_SHARED_CONFIG: CompanionSharedConfig = {
  user_id: DEFAULT_USER_ID,
  selected_model_path: null,
  render_pipeline: "classic",
  reze_stage_document: null,
  updated_at: null,
};
type PetInteractionMode = "window-drag" | "camera-adjust";
type NotificationProfile = "low" | "medium" | "high";
type MenuLanguage = "en" | "zh-CN";
type ApiRuntimeStatus = {
  state: "available" | "unavailable";
  available: boolean;
  apiBaseUrl: string;
  healthUrl: string;
  attempts: number;
  started: boolean;
  checkedAt: string;
  autostart: {
    enabled: boolean;
    attempted: boolean;
    reason?: "disabled" | "missing_command" | "spawn_failed";
    command?: string;
    error?: string;
  };
  logPaths?: {
    stdout: string;
    stderr: string;
  };
  error?: string;
};
type DesktopPetAgent = "codex" | "claude";
type DesktopPetMenuAction =
  | { type: "select-workspace" }
  | { type: "switch-workspace"; workspacePath: string }
  | { type: "workspace-selected"; workspacePath: string }
  | { type: "new-session" }
  | { type: "send-prompt" }
  | { type: "prompt-sent"; source?: "terminal" }
  | { type: "restore-session"; petSessionId: string }
  | { type: "focus-active-session"; petSessionId: string }
  | { type: "more-sessions"; sessions?: DesktopPetSession[] }
  | { type: "interaction-mode"; mode: PetInteractionMode }
  | { type: "notification-detail"; profile: NotificationProfile }
  | { type: "menu-language"; language: MenuLanguage }
  | { type: "agent"; agent: DesktopPetAgent }
  | { type: "codex-env"; envMode: "win" | "wsl" }
  | { type: "always-on-top"; enabled: boolean }
  | { type: "focus-vscode" }
  | { type: "sync-main-site" }
  | { type: "close" };
type PetStageInteractionState = ReturnType<typeof resetPetStageInteractionState>;
type StageClickRipple = {
  id: string;
  x: number;
  y: number;
  xPercent?: number;
  yPercent?: number;
};
type StagePointerCandidate = {
  pointerId: number;
  clientX: number;
  clientY: number;
  timeStamp: number;
};

function getModelLabel(model: MmdModelAsset): string {
  if (model.label?.trim()) return model.label.trim();
  const parts = model.relative_path.split(/[\\/]/).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2];
  return model.name.replace(/\.(pmx|pmd)$/i, "") || "MMD Model";
}

function describeApiRuntimeStatus(status: ApiRuntimeStatus | null): string {
  if (!status) return "API unavailable";
  if (status.available) return status.started ? "API started" : "API available";
  if (status.autostart.enabled && !status.autostart.command) return "API unavailable · start command missing";
  if (status.autostart.attempted && status.logPaths?.stderr) return "API unavailable · logs available";
  return status.error ? `API unavailable · ${status.error}` : "API unavailable";
}

export function App() {
  const [apiBaseUrl, setApiBaseUrl] = useState("http://127.0.0.1:8000");
  const [apiRuntimeResolved, setApiRuntimeResolved] = useState(false);
  const [apiRuntimeStatus, setApiRuntimeStatus] = useState<ApiRuntimeStatus | null>(null);
  const [apiRuntimeRetrying, setApiRuntimeRetrying] = useState(false);
  const [sharedConfig, setSharedConfig] = useState<CompanionSharedConfig>(DEFAULT_SHARED_CONFIG);
  const [models, setModels] = useState<MmdModelAsset[]>([]);
  const [vmdAssets, setVmdAssets] = useState<VmdAsset[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [interactionMode, setInteractionMode] = useState<PetInteractionMode>("window-drag");
  const [notificationProfile, setNotificationProfile] = useState<NotificationProfile>("medium");
  const [codexStatus, setCodexStatus] = useState<CodexStatus | null>(null);
  const [agent, setAgent] = useState<DesktopPetAgent>("codex");
  const [commandCopied, setCommandCopied] = useState(false);
  const [menuStatus, setMenuStatus] = useState<string | null>(null);
  const [stageReloadRevision, setStageReloadRevision] = useState(0);
  const [petCameraRevision, setPetCameraRevision] = useState(0);
  const [petRezeCameraRevision, setPetRezeCameraRevision] = useState(0);
  const [codexStatusMotionReplayRevision, setCodexStatusMotionReplayRevision] = useState(0);
  const [sessionPanelOpen, setSessionPanelOpen] = useState(false);
  const [sessionPanelQuery, setSessionPanelQuery] = useState("");
  const [sessionPanelSessions, setSessionPanelSessions] = useState<DesktopPetSession[]>([]);
  const [promptPanelOpen, setPromptPanelOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");
  const [stageInteractionState, setStageInteractionState] = useState<PetStageInteractionState>(() =>
    resetPetStageInteractionState(),
  );
  const [stageClickRipples, setStageClickRipples] = useState<StageClickRipple[]>([]);
  const stageRef = useRef<MMDStageHandle | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const stageClickCandidateRef = useRef<StagePointerCandidate | null>(null);
  const lastStageClickVmdAssetIdRef = useRef("");
  const lastStageClickEventRef = useRef<{ atMs: number; clientX: number; clientY: number } | null>(null);
  const previousInteractionModeRef = useRef<PetInteractionMode>("window-drag");

  useEffect(() => {
    const runtimeInfo = window.desktopPet?.runtimeInfo();
    if (!runtimeInfo) {
      setApiRuntimeResolved(true);
      return;
    }
    runtimeInfo
      .then((info) => {
        setApiBaseUrl(info.apiBaseUrl);
        setApiRuntimeStatus(info.apiRuntimeStatus ?? null);
      })
      .catch(() => {})
      .finally(() => setApiRuntimeResolved(true));
  }, []);

  useEffect(() => {
    window.desktopPet?.interactionMode
      ?.get()
      .then((mode) => setInteractionMode(mode))
      .catch(() => {});
    return window.desktopPet?.interactionMode?.onChanged((mode) => setInteractionMode(mode));
  }, []);

  useEffect(() => {
    window.desktopPet?.notificationProfile
      ?.get()
      .then((profile) => setNotificationProfile(profile))
      .catch(() => {});
  }, []);

  useEffect(() => {
    window.desktopPet?.codexStatus
      ?.get()
      .then((status) => setCodexStatus(status))
      .catch(() => {});
    return window.desktopPet?.codexStatus?.onChanged((status) => setCodexStatus(status));
  }, []);

  useEffect(() => {
    window.desktopPet?.agent
      ?.get()
      .then((value) => setAgent(value))
      .catch(() => {});
    return window.desktopPet?.agent?.onChanged((value) => setAgent(value));
  }, []);

  const api = useMemo(() => createApiClient({ baseUrl: apiBaseUrl, userId: DEFAULT_USER_ID }), [apiBaseUrl]);
  const selectedModel = pickSelectedModel(models, sharedConfig.selected_model_path);
  const renderPipeline: RenderPipeline = sharedConfig.render_pipeline || "classic";
  const rezeStageDocument = useMemo(
    () =>
      normalizeRezeStageDocument(
        sharedConfig.reze_stage_document,
        renderPipeline === "reze-k3" ? REZE_K3_SCENE_DEFAULTS : REZE_DESIGN_SCENE_DEFAULTS,
      ),
    [renderPipeline, sharedConfig.reze_stage_document],
  );
  const petRezeSceneSettings = useMemo(
    () => {
      if (
        (renderPipeline !== "reze-k3" && renderPipeline !== "reze-design") ||
        !selectedModel
      ) {
        return rezeStageDocument.scene;
      }
      let savedDistance: number | null = null;
      try {
        savedDistance = loadPetRezeCameraDistance({
          storage: window.localStorage,
          modelPath: selectedModel.relative_path,
          renderPipeline,
        });
      } catch {
        savedDistance = null;
      }
      return {
        ...rezeStageDocument.scene,
        // 相机距离按 Pet 窗口独立保存；主站 scene.cameraDistance 不参与同步。
        cameraDistance: resolvePetRezeCameraDistance({
          renderPipeline,
          savedDistance,
          mainSiteDistance: rezeStageDocument.scene.cameraDistance,
          petDefaultDistance:
            renderPipeline === "reze-k3"
              ? PET_REZE_K3_CAMERA_DISTANCE
              : REZE_DESIGN_SCENE_DEFAULTS.cameraDistance,
        }),
      };
    },
    [petRezeCameraRevision, renderPipeline, rezeStageDocument.scene, selectedModel],
  );
  const petCameraSnapshot = useMemo<MmdCameraSnapshot | null>(() => {
    if (!selectedModel) return null;
    try {
      return loadPetCameraSnapshot({
        storage: window.localStorage,
        modelPath: selectedModel.relative_path,
        renderPipeline,
      });
    } catch {
      return null;
    }
  }, [petCameraRevision, renderPipeline, selectedModel]);
  const persistCurrentPetCameraSnapshot = useCallback((): boolean | null => {
    if (!selectedModel) return null;
    const snapshot = stageRef.current?.captureCamera();
    const persistedSnapshot = snapshot ? preparePetCameraSnapshotForStorage(snapshot) : null;
    if (!persistedSnapshot) return null;
    try {
      savePetCameraSnapshot({
        storage: window.localStorage,
        modelPath: selectedModel.relative_path,
        renderPipeline,
        snapshot: persistedSnapshot,
      });
      return true;
    } catch {
      return false;
    }
  }, [renderPipeline, selectedModel]);
  const petAutoplayIdleState = useMemo(
    () =>
      selectedModel
        ? buildPetAutoplayIdleState(vmdAssets, selectedModel.relative_path, api.toAbsoluteUrl)
        : resetPetStageInteractionState(),
    [api, selectedModel, vmdAssets],
  );
  const agentLabel = agent === "claude" ? "Claude" : "Codex";
  const codexStatusPresentation = useMemo(() => getCodexStatusPresentation(codexStatus), [codexStatus]);
  const codexStatusCard = useMemo(
    () => buildCodexStatusCard(codexStatus, notificationProfile, agentLabel),
    [agentLabel, codexStatus, notificationProfile],
  );
  const idleCodexStatusCard = useMemo(
    () =>
      buildIdleCodexStatusCardFallback({
        hasSelectedModel: Boolean(selectedModel),
        loading,
        loadError,
        agentLabel,
      }),
    [agentLabel, loadError, loading, selectedModel],
  );
  const visibleCodexStatusCard = codexStatusCard ?? idleCodexStatusCard;
  const codexStatusResolution = useMemo(
    () =>
      buildCodexStatusPetStageResolution(codexStatusPresentation, {
        clickInteractionActive: stageInteractionState.source === "stage-click",
      }),
    [codexStatusPresentation, stageInteractionState.source],
  );
  const codexStatusInteraction = useMemo(() => {
    if (!codexStatusResolution.shouldApply) return null;
    const fallbackResult = resolvePetStageInteractionWithFallback(
      codexStatusResolution.interaction,
      petAutoplayIdleState.interaction,
    );
    if (!fallbackResult.interaction) return null;
    return { ...fallbackResult.interaction };
  }, [
    codexStatusMotionReplayRevision,
    codexStatusResolution.interaction,
    codexStatusResolution.shouldApply,
    petAutoplayIdleState.interaction,
  ]);
  const interaction =
    stageInteractionState.source === "stage-click"
      ? stageInteractionState.interaction
      : codexStatusInteraction ?? stageInteractionState.interaction;
  const sessionPickerItems = useMemo(
    () => buildSessionPickerItems(sessionPanelSessions),
    [sessionPanelSessions],
  );
  const filteredSessionPickerItems = useMemo(
    () => filterSessionPickerItems(sessionPickerItems, sessionPanelQuery),
    [sessionPanelQuery, sessionPickerItems],
  );

  const loadPetState = useCallback((options: { syncFeedback?: boolean } = {}) => {
    if (!apiRuntimeResolved) return () => {};
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    api.getSharedConfig().then(async (config) => {
      const [modelRows, motionRows] = await Promise.all([api.listModelsForConfig(config), api.listVmdAssets()]);
      return [config, modelRows, motionRows] as const;
    })
      .then(([nextSharedConfig, nextModels, nextVmdAssets]) => {
        if (cancelled) return;
        setSharedConfig(nextSharedConfig);
        setModels(nextModels);
        setVmdAssets(nextVmdAssets);
        if (options.syncFeedback) {
          const nextSelectedModel = pickSelectedModel(nextModels, nextSharedConfig.selected_model_path);
          setStageReloadRevision((revision) => revision + 1);
          setMenuStatus(
            describeMainSiteSyncResult(
              nextSelectedModel ? getModelLabel(nextSelectedModel) : null,
              nextSharedConfig.render_pipeline || "classic",
            ),
          );
          window.setTimeout(() => setMenuStatus(null), 3600);
        }
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setLoadError(error.message);
        if (options.syncFeedback) {
          setMenuStatus(`Sync failed: ${error.message}`);
          window.setTimeout(() => setMenuStatus(null), 4200);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, apiRuntimeResolved]);

  useEffect(() => loadPetState(), [loadPetState]);

  useEffect(() => {
    return window.desktopPet?.apiRuntime?.onChanged((status) => {
      setApiRuntimeStatus(status);
      if (status?.available) loadPetState();
    });
  }, [loadPetState]);

  useEffect(() => {
    setStageInteractionState(petAutoplayIdleState);
    setStageClickRipples([]);
    lastStageClickVmdAssetIdRef.current = "";
    stageClickCandidateRef.current = null;
  }, [petAutoplayIdleState, renderPipeline, selectedModel?.relative_path, stageReloadRevision]);

  useEffect(() => {
    if (renderPipeline !== "reze-k3" && renderPipeline !== "reze-design") return;
    let cancelled = false;
    let retries = 0;
    let timer: number | null = null;
    const applyMaterialPresets = () => {
      if (cancelled) return;
      const entries = stageRef.current?.getMaterialDebugEntries?.() ?? [];
      if (!entries.length && retries++ < 30) {
        timer = window.setTimeout(applyMaterialPresets, 100);
        return;
      }
      for (const entry of entries) {
        const preset = rezeStageDocument.materialPresets[entry.id];
        if (preset) stageRef.current?.setMaterialPreset?.(entry.id, preset);
      }
    };
    timer = window.setTimeout(applyMaterialPresets, 0);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [renderPipeline, rezeStageDocument, selectedModel?.relative_path, stageReloadRevision]);

  useEffect(() => {
    const persistBeforeUnload = () => {
      persistCurrentPetCameraSnapshot();
    };
    window.addEventListener("beforeunload", persistBeforeUnload);
    window.addEventListener("pagehide", persistBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", persistBeforeUnload);
      window.removeEventListener("pagehide", persistBeforeUnload);
    };
  }, [persistCurrentPetCameraSnapshot]);

  useEffect(() => {
    const previousInteractionMode = previousInteractionModeRef.current;
    if (
      shouldPersistPetCameraOnModeChange(previousInteractionMode, interactionMode) &&
      selectedModel
    ) {
      const persistenceResult = persistCurrentPetCameraSnapshot();
      if (persistenceResult === true) {
        try {
          stageRef.current?.lockCamera();
          setPetCameraRevision((revision) => revision + 1);
          setMenuStatus("Pet camera saved");
          window.setTimeout(() => setMenuStatus(null), 1800);
        } catch {
          // Camera persistence already succeeded; locking is only a runtime convenience.
        }
      } else if (persistenceResult === false) {
        setMenuStatus("Pet camera save failed");
        window.setTimeout(() => setMenuStatus(null), 2400);
      }
    }
    if (interactionMode === "camera-adjust") {
      stageRef.current?.unlockCamera();
    }
    previousInteractionModeRef.current = interactionMode;
  }, [interactionMode, persistCurrentPetCameraSnapshot, selectedModel, stageReloadRevision]);

  useEffect(() => {
    if (interactionMode !== "camera-adjust" || (renderPipeline !== "reze-k3" && renderPipeline !== "reze-design")) return;
    const handleWheel = (event: WheelEvent) => {
      const rect = stageRef.current?.getStageRect();
      if (!rect || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
      event.preventDefault();
      // 滚轮上推拉近角色，滚轮下拉拉远角色。
      const result = stageRef.current?.adjustCameraDistance?.(event.deltaY * 0.012);
      if (
        typeof result === "number" &&
        selectedModel &&
        (renderPipeline === "reze-k3" || renderPipeline === "reze-design")
      ) {
        try {
          savePetRezeCameraDistance({
            storage: window.localStorage,
            modelPath: selectedModel.relative_path,
            renderPipeline,
            distance: result,
          });
          setPetRezeCameraRevision((revision) => revision + 1);
        } catch {
          // 相机仍已在运行时调整；存储不可用时不阻断交互。
        }
      }
    };
    document.addEventListener("wheel", handleWheel, { passive: false, capture: true });
    return () => document.removeEventListener("wheel", handleWheel, true);
  }, [interactionMode, renderPipeline, selectedModel]);

  useEffect(() => {
    if (interactionMode !== "camera-adjust") return;
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("contextmenu", handleContextMenu, true);
    return () => document.removeEventListener("contextmenu", handleContextMenu, true);
  }, [interactionMode]);

  useEffect(() => {
    return window.desktopPet?.menu?.onAction((action: DesktopPetMenuAction) => {
      setMenuStatus(describeMenuActionResult(action));
      if (action.type === "more-sessions") {
        setSessionPanelSessions(action.sessions || []);
        setSessionPanelQuery("");
        setSessionPanelOpen(true);
        setPromptPanelOpen(false);
        window.setTimeout(() => setMenuStatus(null), 1800);
        return;
      }
      if (action.type === "send-prompt") {
        setPromptDraft("");
        setPromptPanelOpen(true);
        setSessionPanelOpen(false);
        return;
      }
      if (action.type === "prompt-sent") {
        setPromptPanelOpen(false);
        setPromptDraft("");
        window.setTimeout(() => setMenuStatus(null), 2200);
        return;
      }
      if (action.type === "notification-detail") {
        setNotificationProfile(action.profile);
      }
      if (action.type === "sync-main-site") {
        loadPetState({ syncFeedback: true });
        return;
      }
      window.setTimeout(() => setMenuStatus(null), 2800);
    });
  }, [loadPetState]);

  const restoreSessionFromPanel = useCallback((petSessionId: string) => {
    setSessionPanelOpen(false);
    setMenuStatus("Opening VSCode workspace and resuming Codex...");
    window.desktopPet?.sessions
      ?.restore(petSessionId)
      .catch((error: Error) => {
        setMenuStatus(`Resume failed: ${error.message}`);
        window.setTimeout(() => setMenuStatus(null), 4200);
      });
  }, []);

  const sendPromptFromPanel = useCallback(() => {
    const prompt = promptDraft.trim();
    if (!prompt) {
      setMenuStatus("Prompt is required");
      window.setTimeout(() => setMenuStatus(null), 1800);
      return;
    }
    if (!window.desktopPet?.prompt?.send) {
      setMenuStatus("Prompt unavailable");
      window.setTimeout(() => setMenuStatus(null), 2800);
      return;
    }

    setMenuStatus("Sending prompt...");
    window.desktopPet.prompt.send(prompt).catch((error: Error) => {
      setMenuStatus(`Prompt failed: ${error.message}`);
      window.setTimeout(() => setMenuStatus(null), 4200);
    });
  }, [promptDraft]);

  const retryApiRuntime = useCallback(() => {
    setApiRuntimeRetrying(true);
    setMenuStatus("Checking API...");
    window.desktopPet?.apiRuntime
      ?.retry()
      .then((status) => {
        setApiRuntimeStatus(status);
        if (status?.available) {
          setMenuStatus(describeApiRuntimeStatus(status));
          loadPetState();
        } else {
          setMenuStatus(describeApiRuntimeStatus(status));
          window.setTimeout(() => setMenuStatus(null), 3600);
        }
      })
      .catch((error: Error) => {
        setMenuStatus(`API retry failed: ${error.message}`);
        window.setTimeout(() => setMenuStatus(null), 4200);
      })
      .finally(() => setApiRuntimeRetrying(false));
  }, [loadPetState]);

  const showFocusSuccess = useCallback(() => {
    setMenuStatus("Codex session open");
    window.setTimeout(() => setMenuStatus(null), 1800);
  }, []);

  const focusActiveSessionFromPanel = useCallback(
    (petSessionId: string) => {
      setSessionPanelOpen(false);
      setMenuStatus("Opening existing task window...");
      const focusRequest = window.desktopPet?.sessions?.focusActive(petSessionId);
      if (!focusRequest) {
        setMenuStatus("Open active task unavailable");
        window.setTimeout(() => setMenuStatus(null), 2800);
        return;
      }
      focusRequest
        .then(showFocusSuccess)
        .catch((error: Error) => {
          setMenuStatus(`Open active task failed: ${error.message}`);
          window.setTimeout(() => setMenuStatus(null), 4200);
        });
    },
    [showFocusSuccess],
  );

  const focusCodexForApproval = useCallback(() => {
    setMenuStatus("Opening Codex session...");
    const focusRequest = window.desktopPet?.codex?.focus?.({
      workspacePath: codexStatus?.workspacePath,
      codexSessionId: codexStatus?.codexSessionId,
      source: "approval",
    });
    if (!focusRequest) {
      setMenuStatus("Open Codex session unavailable");
      window.setTimeout(() => setMenuStatus(null), 2800);
      return;
    }
    focusRequest
      .then(showFocusSuccess)
      .catch((error: Error) => {
        setMenuStatus(`Open Codex session failed: ${error.message}`);
        window.setTimeout(() => setMenuStatus(null), 4200);
      });
  }, [codexStatus?.codexSessionId, codexStatus?.workspacePath, showFocusSuccess]);

  const focusCodexForStatus = useCallback(() => {
    if (!codexStatus?.workspacePath) return;
    setMenuStatus("Opening Codex session...");
    const focusRequest = window.desktopPet?.codex?.focus?.({
      workspacePath: codexStatus.workspacePath,
      codexSessionId: codexStatus.codexSessionId,
      source: "status",
    });
    if (!focusRequest) {
      setMenuStatus("Open Codex session unavailable");
      window.setTimeout(() => setMenuStatus(null), 2800);
      return;
    }
    focusRequest
      .then(showFocusSuccess)
      .catch((error: Error) => {
        setMenuStatus(`Open Codex session failed: ${error.message}`);
        window.setTimeout(() => setMenuStatus(null), 4200);
      });
  }, [codexStatus, showFocusSuccess]);

  const copyCommandFromStatus = useCallback((commandLine: string) => {
    const command = commandLine.trim();
    if (!command) return;
    const write = window.desktopPet?.clipboard?.writeText?.(command);
    Promise.resolve(write)
      .then(() => {
        setCommandCopied(true);
        window.setTimeout(() => setCommandCopied(false), 2000);
      })
      .catch((error: Error) => {
        setMenuStatus(`Copy failed: ${error.message}`);
        window.setTimeout(() => setMenuStatus(null), 4200);
      });
  }, []);

  const handlePetStageCharacterClick = useCallback(
    ({ clientX, clientY, stageRect }: { clientX: number; clientY: number; stageRect: DOMRect }) => {
      if (!selectedModel?.relative_path) return;
      const nowMs = performance.now();
      const lastClick = lastStageClickEventRef.current;
      if (
        lastClick &&
        nowMs - lastClick.atMs < 180 &&
        Math.abs(lastClick.clientX - clientX) <= 1 &&
        Math.abs(lastClick.clientY - clientY) <= 1
      ) {
        return;
      }
      lastStageClickEventRef.current = { atMs: nowMs, clientX, clientY };

      const ripple = createStageClickRipple({ clientX, clientY, rect: stageRect }) as StageClickRipple;
      setStageClickRipples((current) => [...current.slice(-5), ripple]);
      window.setTimeout(() => {
        setStageClickRipples((current) => current.filter((item) => item.id !== ripple.id));
      }, STAGE_CLICK_RIPPLE_DURATION_MS);

      const clickAction = buildPetStageClickInteraction({
        assets: vmdAssets,
        selectedModelPath: selectedModel.relative_path,
        previousActiveVmdAssetId: lastStageClickVmdAssetIdRef.current,
        resolveUrl: api.toAbsoluteUrl,
      });
      if (clickAction.activeVmdAssetId) {
        lastStageClickVmdAssetIdRef.current = clickAction.activeVmdAssetId;
      }
      setStageInteractionState(buildPetStageClickInteractionState(clickAction));
    },
    [api, selectedModel?.relative_path, vmdAssets],
  );

  useEffect(() => {
    return window.desktopPet?.nativeClick?.on((point) => {
      if (!Number.isFinite(point.clientX) || !Number.isFinite(point.clientY)) return;
      const stageRect = stageRef.current?.getStageRect();
      const hit = Boolean(stageRef.current?.hitTestCharacterAtClientPoint(point.clientX, point.clientY));
      if (!hit) return;
      if (!stageRect) return;
      handlePetStageCharacterClick({
        clientX: point.clientX,
        clientY: point.clientY,
        stageRect,
      });
    });
  }, [handlePetStageCharacterClick, renderPipeline, selectedModel?.relative_path]);

  const recoverPetStageInteraction = useCallback(() => {
    setStageInteractionState(petAutoplayIdleState);
  }, [petAutoplayIdleState]);

  const handleStageInteractionComplete = useCallback(() => {
    if (stageInteractionState.source === "stage-click") {
      recoverPetStageInteraction();
      return;
    }
    if (
      codexStatusResolution.shouldApply &&
      shouldReplayCodexStatusMotionOnCompletion(codexStatus?.state)
    ) {
      setCodexStatusMotionReplayRevision((revision) => revision + 1);
      return;
    }
    recoverPetStageInteraction();
  }, [codexStatus?.state, codexStatusResolution.shouldApply, recoverPetStageInteraction, stageInteractionState.source]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Element && event.target.closest(".pet-panel, .pet-status-action")) return;
      if (event.target instanceof Element && event.target.closest("[data-pet-interactive]")) return;
      if (event.target instanceof Element && event.target.closest(".pet-camera-save-exit")) return;
      if (event.target instanceof Element && event.target.closest(".pet-status-main")) return;
      if (event.button === 0) {
        stageClickCandidateRef.current = {
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          timeStamp: event.timeStamp,
        };
      }
    }

    function handlePointerMove(event: PointerEvent) {
      const candidate = stageClickCandidateRef.current;
      if (
        candidate?.pointerId === event.pointerId &&
        dragPointerIdRef.current === null &&
        shouldActivatePetWindowDrag({
          interactionMode,
          button: 0,
          moved: hasPetPointerMoved({
            origin: { x: candidate.clientX, y: candidate.clientY },
            current: { x: event.clientX, y: event.clientY },
          }),
        })
      ) {
        dragPointerIdRef.current = event.pointerId;
        stageClickCandidateRef.current = null;
        event.preventDefault();
        if (shouldStopPetWindowDragPropagation({ eventType: "pointermove", dragActive: true })) {
          event.stopPropagation();
        }
        window.desktopPet?.windowDrag?.start();
      }
      if (dragPointerIdRef.current !== event.pointerId) return;
      event.preventDefault();
      if (shouldStopPetWindowDragPropagation({ eventType: "pointermove", dragActive: true })) {
        event.stopPropagation();
      }
      window.desktopPet?.windowDrag?.move();
    }

    function finishActiveDrag() {
      if (dragPointerIdRef.current === null) return;
      dragPointerIdRef.current = null;
      window.desktopPet?.windowDrag?.end();
    }

    function finishPointerDrag(event: PointerEvent) {
      const candidate = stageClickCandidateRef.current;
      if (dragPointerIdRef.current === event.pointerId) {
        event.preventDefault();
        if (shouldStopPetWindowDragPropagation({ eventType: "pointerup", dragActive: true })) {
          event.stopPropagation();
        }
        finishActiveDrag();
      }
      if (candidate?.pointerId !== event.pointerId) return;
      stageClickCandidateRef.current = null;
      if (
        !shouldTriggerStageCharacterClick({
          downClientX: candidate.clientX,
          downClientY: candidate.clientY,
          upClientX: event.clientX,
          upClientY: event.clientY,
          downTimeMs: candidate.timeStamp,
          upTimeMs: event.timeStamp,
        })
      ) {
        return;
      }
      if (!stageRef.current?.hitTestCharacterAtClientPoint(event.clientX, event.clientY)) return;
      const stageRect = stageRef.current.getStageRect();
      if (!stageRect) return;
      handlePetStageCharacterClick({ clientX: event.clientX, clientY: event.clientY, stageRect });
    }

    function cancelPointerDrag(event: PointerEvent) {
      if (stageClickCandidateRef.current?.pointerId === event.pointerId) {
        stageClickCandidateRef.current = null;
      }
      finishPointerDrag(event);
    }

    function handleBlur() {
      stageClickCandidateRef.current = null;
      finishActiveDrag();
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("pointermove", handlePointerMove, true);
    document.addEventListener("pointerup", finishPointerDrag, true);
    document.addEventListener("pointercancel", cancelPointerDrag, true);
    window.addEventListener("blur", handleBlur);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("pointermove", handlePointerMove, true);
      document.removeEventListener("pointerup", finishPointerDrag, true);
      document.removeEventListener("pointercancel", cancelPointerDrag, true);
      window.removeEventListener("blur", handleBlur);
      finishActiveDrag();
    };
  }, [handlePetStageCharacterClick, interactionMode]);

  const handleSaveAndExitCamera = useCallback(() => {
    if (interactionMode !== "camera-adjust") return;
    setInteractionMode("window-drag");
    const modeRequest = window.desktopPet?.interactionMode?.set("window-drag");
    modeRequest?.catch(() => {
      setMenuStatus("Camera mode exit sync failed");
      window.setTimeout(() => setMenuStatus(null), 2800);
    });
  }, [interactionMode]);

  const codexStatusText = codexStatusCard?.title ?? formatCodexStatusNotification(codexStatus, notificationProfile);
  const approvalFallback = buildApprovalFallback(codexStatus, notificationProfile);
  const showApiRetry = Boolean(loadError) && !approvalFallback;
  const statusText =
    menuStatus ||
    approvalFallback?.message ||
    codexStatusText ||
    idleCodexStatusCard?.title ||
    (loadError
      ? describeApiRuntimeStatus(apiRuntimeStatus)
      : loading
        ? "Loading MMD"
          : !selectedModel
          ? `No MMD model · ${notificationProfile}`
          : null);
  const statusOutputLines = !menuStatus && visibleCodexStatusCard ? visibleCodexStatusCard.outputLines : [];
  const canFocusStatus = Boolean(codexStatusCard?.focusable && !showApiRetry);
  const statusCommandLine = !menuStatus ? visibleCodexStatusCard?.commandLine?.trim() : undefined;

  return (
    <main
      className="pet-shell"
      data-interaction-mode={interactionMode}
    >
      <div
        className="pet-input-hit-surface"
        aria-hidden="true"
      />
      <div className="pet-stage" data-render-pipeline={renderPipeline}>
        {selectedModel ? (
          <MMDStage
            ref={stageRef}
            key={buildPetStageKey(selectedModel.relative_path, renderPipeline, stageReloadRevision)}
            chrome="bare"
            interaction={interaction}
            speaking={false}
            models={models}
            selectedModelPath={selectedModel.relative_path}
            modelUrl={api.toAbsoluteUrl(selectedModel.url)}
            modelLabel={getModelLabel(selectedModel)}
            renderPipeline={renderPipeline}
            assetApiBaseUrl={apiBaseUrl}
            appearanceUserId={DEFAULT_USER_ID}
            appearanceControlsPortal
            rezeBackgroundEffect={rezeStageDocument.backgroundEffect}
            rezeGrade={rezeStageDocument.grade}
            rezeGradeIntensity={rezeStageDocument.gradeIntensity}
            rezeSceneDebugSettings={petRezeSceneSettings}
            // Pet 舞台仍然覆盖整个窗口，但背景按用户要求保持透明，
            // 让桌面或主站背景从 Reze 画布后方透出。
            rezeTransparentBackground
            cameraSnapshot={petCameraSnapshot}
            cameraLocked={interactionMode !== "camera-adjust"}
            // Pet 的点击统一由外层输入路由处理；避免 MMDStage 内层指针捕获
            // 在窗口拖动结束时把同一次拖动误判成动作点击。
            enableCharacterClickCapture={false}
            onCharacterClick={handlePetStageCharacterClick}
            clickRipples={stageClickRipples}
            onInteractionComplete={handleStageInteractionComplete}
            onInteractionError={recoverPetStageInteraction}
            onModelChange={() => {}}
          />
        ) : null}
      </div>
      {interactionMode === "camera-adjust" ? (
        <button
          type="button"
          className="pet-camera-save-exit"
          data-testid="pet-camera-save-exit"
          aria-label="Save camera and exit camera mode"
          title="Save camera and exit camera mode"
          onClick={handleSaveAndExitCamera}
        >
          Save &amp; Exit Camera
        </button>
      ) : null}
      {sessionPanelOpen ? (
        <section className="pet-panel pet-session-panel" aria-label="Codex sessions">
          <div className="pet-session-panel-header">
            <span>Sessions</span>
            <button
              type="button"
              className="pet-session-panel-close"
              aria-label="Close sessions"
              onClick={() => setSessionPanelOpen(false)}
            >
              x
            </button>
          </div>
          <input
            className="pet-session-search"
            value={sessionPanelQuery}
            onChange={(event) => setSessionPanelQuery(event.target.value)}
            placeholder="Search"
            aria-label="Search sessions"
          />
          <div className="pet-session-list">
            {filteredSessionPickerItems.length > 0 ? (
              filteredSessionPickerItems.map((item) => (
                <button
                  key={item.petSessionId}
                  type="button"
                  className="pet-session-row"
                  onClick={() => item.isActive ? focusActiveSessionFromPanel(item.petSessionId) : restoreSessionFromPanel(item.petSessionId)}
                >
                  <span className="pet-session-title">{item.title}</span>
                  <span className="pet-session-detail-grid" aria-label={item.subtitle}>
                    <span>{item.workspace}</span>
                    <span>{item.status}</span>
                    <span>{item.time}</span>
                  </span>
                  <span className="pet-session-preview">
                    <span className="pet-session-preview-label">Prompt</span>
                    <span>{item.promptPreview}</span>
                  </span>
                  <span className="pet-session-preview">
                    <span className="pet-session-preview-label">Summary</span>
                    <span>{item.summaryPreview}</span>
                  </span>
                </button>
              ))
            ) : (
              <div className="pet-session-empty">No sessions</div>
            )}
          </div>
        </section>
      ) : null}
      {promptPanelOpen ? (
        <section className="pet-panel pet-prompt-panel" aria-label="Codex prompt">
          <div className="pet-prompt-panel-header">
            <span>Prompt</span>
            <button
              type="button"
              className="pet-prompt-panel-close"
              aria-label="Close prompt"
              onClick={() => setPromptPanelOpen(false)}
            >
              x
            </button>
          </div>
          <textarea
            className="pet-prompt-input"
            value={promptDraft}
            onChange={(event) => setPromptDraft(event.target.value)}
            placeholder="Prompt"
            aria-label="Prompt"
            rows={4}
          />
          <div className="pet-prompt-actions">
            <button
              type="button"
              className="pet-prompt-button"
              onClick={() => setPromptPanelOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="pet-prompt-button pet-prompt-button-primary"
              disabled={!promptDraft.trim()}
              onClick={sendPromptFromPanel}
            >
              Send
            </button>
          </div>
        </section>
      ) : null}
      {statusText ? (
        <div
          className="pet-status"
          role="status"
          data-status-tone={codexStatusPresentation.statusTone}
          data-codex-card={visibleCodexStatusCard && !menuStatus ? "true" : "false"}
          title={statusText}
        >
          {canFocusStatus ? (
            <button
              type="button"
              className="pet-status-main"
              onClick={focusCodexForStatus}
            >
              <span className="pet-status-dot" />
              <span className="pet-status-content">
                <span className="pet-status-title">{statusText}</span>
                {statusOutputLines.length > 0 ? (
                  <span className="pet-status-output">
                    {statusOutputLines.map((line, index) => (
                      <span key={`${index}-${line}`}>{line}</span>
                    ))}
                  </span>
                ) : null}
              </span>
            </button>
          ) : (
            <span className="pet-status-main pet-status-main-static">
              <span className="pet-status-dot" />
              <span className="pet-status-content">
                <span className="pet-status-title">{statusText}</span>
                {statusOutputLines.length > 0 ? (
                  <span className="pet-status-output">
                    {statusOutputLines.map((line, index) => (
                      <span key={`${index}-${line}`}>{line}</span>
                    ))}
                  </span>
                ) : null}
              </span>
            </span>
          )}
          {approvalFallback ? (
            <button
              type="button"
              className="pet-status-action"
              onClick={focusCodexForApproval}
            >
              {approvalFallback.primaryAction.label}
            </button>
          ) : showApiRetry ? (
            <button
              type="button"
              className="pet-status-action"
              disabled={apiRuntimeRetrying}
              onClick={retryApiRuntime}
            >
              Retry
            </button>
          ) : statusCommandLine ? (
            <button
              type="button"
              className="pet-status-action"
              onClick={() => copyCommandFromStatus(statusCommandLine)}
              title={statusCommandLine}
            >
              {commandCopied ? "Copied" : "Copy command"}
            </button>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
