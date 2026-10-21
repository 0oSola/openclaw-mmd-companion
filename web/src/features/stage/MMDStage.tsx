"use client";

import { ChangeEvent, PointerEvent, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
const CharacterArrivalParticles = dynamic(() => import("./CharacterArrivalParticles").then(module => module.CharacterArrivalParticles), { ssr: false });
import arrivalOutline from "./characterArrivalOutline.json";
import { characterEntranceUrl } from "./characterIdlePlaylist.js";
import { createPortal } from "react-dom";
import { resolveStageAssetUrl } from "./stageAssetUrls.js";
import { V14dGameControls } from "./V14dGameControls";

import { getModelDisplayLabel } from "@/features/stage/modelCatalog.js";
import { shouldTriggerStageCharacterClick } from "@/features/stage/stageCharacterClick.js";
import { shouldCaptureStagePointer } from "@/features/stage/stagePointerCapture";
import { applyStageRuntimeState, MMDCompanionRuntime } from "@/features/stage/mmdCompanionRuntime.js";
import { isKoledaModelIdentifier } from "@/features/stage/koledaDefaultAppearance.js";
import { GF2_MODEL_SHA256, isGf2StageModel } from "@/features/stage/gf2StageAssets.js";
import {
  V14D_GAME_MANIFEST_URL,
  validateV14dGameManifest,
} from "@/features/stage/v14dGameAppearanceAssets.js";
import { RezeWebGpuStage } from "@/features/stage/RezeWebGpuStage";
import { loadSession } from "@/lib/session";
const arrivalPreviewPoints: Array<[number, number]> = arrivalOutline.points.map(([x, y]) => [x, y]);
import type {
  RezeBackgroundEffect,
  RezeGradePreset,
  RezeSceneDebugSettings,
} from "@/features/stage/rezeDesignDefaults";
import type { V14dColorBaselineResult } from "@/features/stage/v14dColorBaseline";
import type { MmdCameraSnapshot, MmdModelAsset, RenderPipeline } from "@/lib/types";

declare global {
  interface Window {
    __mmdCompanionRuntime?: any;
  }
}

type StageInteraction = {
  emotion: string;
  action: string;
  mode?: "procedural" | "vmd";
  vmdUrl?: string;
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
  sequence?: Array<{
    template: string;
    action: string;
    durationMs: number;
    intensity: number;
  }>;
};

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

function absolutizeV14dGameManifest(manifest: any, toAbsolute: (url: string) => string) {
  return {
    ...manifest,
    model: manifest?.model ? { ...manifest.model, url: toAbsolute(manifest.model.url) } : manifest?.model,
    materialSource: manifest?.materialSource ? { ...manifest.materialSource, url: toAbsolute(manifest.materialSource.url) } : null,
    masks: manifest?.masks?.map((entry: any) => ({ ...entry, url: toAbsolute(entry.url) })),
    textures: Array.isArray(manifest?.textures)
      ? manifest.textures.map((entry: any) => ({ ...entry, url: toAbsolute(entry.url) }))
      : manifest?.textures,
    ocio: manifest?.ocio
      ? Object.fromEntries(
          Object.entries(manifest.ocio).map(([key, entry]: [string, any]) => [
            key,
            { ...entry, url: toAbsolute(entry?.url) },
          ]),
        )
      : manifest?.ocio,
  };
}

export type MMDStageHandle = {
  retryWeaponLoading?: () => void;
  unlockCamera: () => MmdCameraSnapshot | null;
  lockCamera: () => MmdCameraSnapshot | null;
  captureCamera: () => MmdCameraSnapshot | null;
  setCameraSnapshot?: (snapshot: MmdCameraSnapshot) => MmdCameraSnapshot | null;
  resetCamera: () => MmdCameraSnapshot | null;
  adjustCameraDistance?: (delta: number) => MmdCameraSnapshot | number | null;
  hitTestCharacterAtClientPoint: (clientX: number, clientY: number) => boolean;
  getStageRect: () => DOMRect | null;
  setSpeechLevel: (level: number) => void;
  setSpeechViseme: (frame: { viseme: string; weight?: number } | null) => void;
  getMaterialDebugEntries: () => Array<{
    id: string;
    name: string;
    meshName: string;
    preset: string;
    visible: boolean;
    opacity: number;
    emissiveIntensity: number;
  }>;
  updateMaterialDebug: (
    id: string,
    patch: { visible?: boolean; opacity?: number; emissiveIntensity?: number },
  ) => { id: string; visible: boolean; opacity: number; emissiveIntensity: number } | null;
  resetMaterialDebug: (id: string) => { id: string; visible: boolean; opacity: number; emissiveIntensity: number } | null;
  setMaterialPreset: (id: string, preset: string) => { id: string; preset: string } | null;
  captureStagePng: () => string | null;
  setSceneDebugSettings: (settings: Record<string, number | string | boolean>) => Record<string, number | string | boolean> | null;
  resetSceneDebugSettings: () => Record<string, number | string | boolean> | null;
  captureColorBaseline?: () => Promise<V14dColorBaselineResult>;
  getColorBaselineResult?: () => V14dColorBaselineResult | null;
  getRendererLabel?: () => string;
};

export type StageLoadState = { state: "loading" | "ready" | "error"; detail?: string; retry: () => void };

type MMDStageProps = {
  weaponVisible?: boolean;
  onWeaponStateChange?: (state: { phase: string; detail: string }) => void;
  arrivalDurationMs?: number;
  entranceAllowed?: boolean;
  particlesAllowed?: boolean;
  onLoadStateChange?: (state: StageLoadState) => void;
  appearanceUserId?: string;
  interaction: StageInteraction;
  speaking: boolean;
  models: MmdModelAsset[];
  selectedModelPath: string;
  modelUrl: string;
  rezeLocalModelImport?: {
    revision: number;
    files: File[];
    pmxFile: File;
  } | null;
  modelLabel: string;
  onModelChange: (nextPath: string) => void;
  onInteractionComplete?: () => void;
  onInteractionError?: (error: { type: "vmd"; vmdUrl: string }) => void;
  onCharacterClick?: (event: { clientX: number; clientY: number; stageRect: DOMRect }) => void;
  clickRipples?: StageClickRipple[];
  renderPipeline?: RenderPipeline;
  assetApiBaseUrl?: string;
  appearanceControlsPortal?: boolean;
  cameraSnapshot?: MmdCameraSnapshot | null;
  chrome?: "panel" | "bare";
  enableCharacterClickCapture?: boolean;
  cameraLocked?: boolean;
  rezeBackgroundEffect?: RezeBackgroundEffect;
  rezeGrade?: RezeGradePreset;
  rezeGradeIntensity?: number;
  rezeSceneDebugSettings?: RezeSceneDebugSettings;
  v14dUnlitDiagnostic?: boolean;
  v14dColorBaseline?: boolean;
  v14dFaceStatic?: boolean;
  v14dFaceStaticMode?: "normal" | "faceShadowOnly" | "finalFaceComposite" | "uvDebug" | "worldPos" | "diffuseFlat" | "bakedGolden";
  /** 黄金帧诊断 ROI/pick 门控：仅 finalFaceComposite 模式启用脸部取样口径。 */
  v14dFaceStaticGated?: boolean;
  /** State2 实时合成配准负测相机覆写（仅 faceStatic 诊断；shift/null，默认关闭）。 */
  v14dFaceCameraOverride?: "shift" | "null" | null;
  /** 生产 V1（V14D）皮肤变体（仅 reze-k3 + 克莱妲生效；默认 original）。 */
  v14dSkinVariant?: "original" | "v1";
  rezeTransparentBackground?: boolean;
};

export const MMDStage = forwardRef<MMDStageHandle, MMDStageProps>(function MMDStage({
  weaponVisible = false,
  onWeaponStateChange,
  arrivalDurationMs = 6400,
  entranceAllowed = true,
  particlesAllowed = true,
  onLoadStateChange,
  appearanceUserId = "",
  interaction: requestedInteraction,
  speaking,
  models,
  selectedModelPath,
  modelUrl,
  rezeLocalModelImport = null,
  modelLabel,
  onModelChange,
  onInteractionComplete: notifyInteractionComplete,
  onInteractionError: notifyInteractionError,
  onCharacterClick,
  clickRipples = [],
  renderPipeline = "classic",
  assetApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000",
  appearanceControlsPortal = false,
  cameraSnapshot = null,
  chrome = "panel",
  enableCharacterClickCapture = true,
  cameraLocked,
  rezeBackgroundEffect = "Shining Stars",
  rezeGrade = "中性",
  rezeGradeIntensity = 1,
  rezeSceneDebugSettings,
  v14dUnlitDiagnostic = false,
  v14dColorBaseline = false,
  v14dFaceStatic = false,
  v14dFaceStaticMode = "normal",
  v14dFaceStaticGated = false,
  v14dFaceCameraOverride = null,
  v14dSkinVariant = "original",
  rezeTransparentBackground = false,
}: MMDStageProps, ref) {
  const toAbsolute = useCallback((url: string) => resolveStageAssetUrl(url, assetApiBaseUrl), [assetApiBaseUrl]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  const runtimeRef = useRef<any>(null);
  const weaponVisibleRef = useRef(weaponVisible);
  const weaponStateCallbackRef = useRef(onWeaponStateChange);
  weaponVisibleRef.current = weaponVisible;
  weaponStateCallbackRef.current = onWeaponStateChange;
  useEffect(() => { runtimeRef.current?.weapon?.setEnabled(weaponVisible); }, [weaponVisible]);
  const [appearanceRuntime,setAppearanceRuntime] = useState<any>(null);
  const [stageLoadError, setStageLoadError] = useState<string | null>(null);
  const [stageLoadRetry, setStageLoadRetry] = useState(0);
  const [arrivalModelPoints, setArrivalModelPoints] = useState<Array<[number, number]>>([]);
  const [arrivalPreview, setArrivalPreview] = useState<Array<[number, number]>>([]);
  const arrivalKey = `${selectedModelPath}|${modelUrl}|${renderPipeline}|${stageLoadRetry}|${rezeLocalModelImport?.revision || 0}`;
  const arrivalDisabled = v14dColorBaseline || v14dFaceStatic;
  const [arrival, setArrival] = useState({ key: arrivalKey, phase: "loading", ready: false, formed: false });
  const phase = arrivalDisabled ? "idle" : arrival.key === arrivalKey ? arrival.phase : "loading";
  const entranceUrl = characterEntranceUrl(selectedModelPath || modelLabel);
  const entering = phase === "entrance-loading" || phase === "entrance";
  const arrivalInteraction = useMemo<StageInteraction>(() => {
    if (entering) return { mode: "vmd", action: "entrance", emotion: "neutral", vmdUrl: entranceUrl,
      vmdLoopUrls: [], playbackRate: 1, lockLowerBody: false, lockRootPosition: false,
      playerVmdMode: requestedInteraction.playerVmdMode };
    return { mode: "procedural", action: "idle", emotion: "neutral" };
  }, [entering, entranceUrl, requestedInteraction.playerVmdMode]);
  const interaction = phase === "idle" ? requestedInteraction : arrivalInteraction;
  useEffect(() => {
    setArrival({ key: arrivalKey, phase: "loading", ready: false, formed: false });
    setArrivalModelPoints([]);
    setArrivalPreview([]);
  }, [arrivalKey]);
  const reportArrivalReady = useCallback((ready: boolean) => {
    if (ready) setArrival((value) => value.key === arrivalKey ? { ...value, ready: true } : value);
  }, [arrivalKey]);
  const retryLoad = useCallback(() => { setStageLoadError(null); setStageLoadRetry(value => value + 1); }, []);
  const modelReady = arrival.key === arrivalKey && arrival.ready && (arrivalDisabled || arrival.formed);
  useEffect(() => {
    onLoadStateChange?.({ state: stageLoadError ? "error" : modelReady ? "ready" : "loading", detail: stageLoadError || undefined, retry: retryLoad });
  }, [modelReady, stageLoadError, retryLoad, onLoadStateChange]);
  useEffect(() => {
    if (entranceAllowed && !arrivalDisabled && arrival.key === arrivalKey && arrival.phase === "loading" && arrival.ready && arrival.formed) {
      setArrival((value) => ({ ...value, phase: entranceUrl ? "entrance-loading" : "revealing" }));
    }
  }, [arrival, arrivalKey, arrivalDisabled, entranceUrl, entranceAllowed]);
  const onInteractionStarted = useCallback(() => {
    setArrival((value) => value.key === arrivalKey && value.phase === "entrance-loading" ? { ...value, phase: "entrance" } : value);
  }, [arrivalKey]);
  useEffect(() => {
    if (phase !== "revealing") return;
    const timer = window.setTimeout(() => setArrival((value) => ({ ...value, phase: entranceUrl ? "entrance" : "idle" })), 650);
    return () => window.clearTimeout(timer);
  }, [phase, entranceUrl]);
  const onInteractionComplete = useCallback(() => {
    if (phase === "entrance") { setArrival((value) => ({ ...value, phase: "idle" })); return; }
    if (phase === "idle") notifyInteractionComplete?.();
  }, [phase, notifyInteractionComplete]);
  const onInteractionError = useCallback((error: { type: "vmd"; vmdUrl: string }) => {
    if (entering) {
      setStageLoadError("A03 进场动作加载失败，已恢复待机。");
      setArrival((value) => ({ ...value, phase: "idle" }));
      return;
    }
    notifyInteractionError?.(error);
  }, [entering, notifyInteractionError]);
  const webGpuStageRef = useRef<MMDStageHandle | null>(null);
  const currentInteractionRef = useRef(interaction);
  const currentSpeakingRef = useRef(speaking);
  const cameraSnapshotRef = useRef<MmdCameraSnapshot | null>(cameraSnapshot);
  const cameraLockedRef = useRef<boolean | undefined>(cameraLocked);
  const onInteractionErrorRef = useRef(onInteractionError);
  const stagePointerCandidateRef = useRef<StagePointerCandidate | null>(null);

  currentInteractionRef.current = interaction;
  currentSpeakingRef.current = speaking;
  cameraSnapshotRef.current = cameraSnapshot;
  cameraLockedRef.current = cameraLocked;
  onInteractionErrorRef.current = onInteractionError;
  const getArrivalView = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime?.camera || !runtime?.renderer) return null;
    // GF2保持原比例与原点；模型校验完成前不能借用frontline的默认拟合矩阵。
    if (renderPipeline === "gf2" && !runtime.model) return null;
    runtime.camera.updateMatrixWorld(true);
    runtime.model?.updateMatrixWorld(true);
    const rect = runtime.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return { projection: Array.from(runtime.camera.projectionMatrix.elements) as number[],
      view: Array.from(runtime.camera.matrixWorldInverse.elements) as number[],
      model: runtime.model ? Array.from(runtime.model.matrixWorld.elements) as number[] : undefined,
      viewport: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
  }, [renderPipeline]);

  useImperativeHandle(
    ref,
    () => ({
      unlockCamera() {
        return webGpuStageRef.current?.unlockCamera?.() ?? runtimeRef.current?.setCameraLocked?.(false) ?? null;
      },
      lockCamera() {
        return webGpuStageRef.current?.lockCamera?.() ?? runtimeRef.current?.setCameraLocked?.(true) ?? null;
      },
      captureCamera() {
        return webGpuStageRef.current?.captureCamera?.() ?? runtimeRef.current?.getCameraSnapshot?.() ?? null;
      },
      setCameraSnapshot(snapshot: MmdCameraSnapshot) {
        return webGpuStageRef.current?.setCameraSnapshot?.(snapshot) ?? runtimeRef.current?.setCameraSnapshot?.(snapshot) ?? null;
      },
      resetCamera() {
        return webGpuStageRef.current?.resetCamera?.() ?? runtimeRef.current?.resetCameraToDefault?.() ?? null;
      },
      adjustCameraDistance(delta: number) {
        return webGpuStageRef.current?.adjustCameraDistance?.(delta) ?? null;
      },
      hitTestCharacterAtClientPoint(clientX: number, clientY: number) {
        if (phase !== "idle") return false;
        return webGpuStageRef.current?.hitTestCharacterAtClientPoint?.(clientX, clientY) ?? Boolean(runtimeRef.current?.hitTestModelAtClientPoint?.(clientX, clientY));
      },
      getStageRect() {
        return (
          containerRef.current?.getBoundingClientRect() ??
          webGpuStageRef.current?.getStageRect?.() ??
          null
        );
      },
      setSpeechLevel(level: number) {
        runtimeRef.current?.setSpeechLevel?.(level);
      },
      setSpeechViseme(frame: { viseme: string; weight?: number } | null) {
        runtimeRef.current?.setSpeechViseme?.(frame);
      },
      getMaterialDebugEntries() {
        return webGpuStageRef.current?.getMaterialDebugEntries?.() ?? runtimeRef.current?.getMaterialDebugEntries?.() ?? [];
      },
      retryWeaponLoading() { runtimeRef.current?.weapon?.setEnabled(true); },
      updateMaterialDebug(id, patch) {
        return webGpuStageRef.current?.updateMaterialDebug?.(id, patch) ?? runtimeRef.current?.updateMaterialDebug?.(id, patch) ?? null;
      },
      resetMaterialDebug(id) {
        return webGpuStageRef.current?.resetMaterialDebug?.(id) ?? runtimeRef.current?.resetMaterialDebug?.(id) ?? null;
      },
      setMaterialPreset(id, preset) {
        return webGpuStageRef.current?.setMaterialPreset?.(id, preset) ?? runtimeRef.current?.setMaterialPreset?.(id, preset) ?? null;
      },
      captureStagePng() {
        return webGpuStageRef.current?.captureStagePng?.() ?? runtimeRef.current?.capturePngDataUrl?.() ?? null;
      },
      setSceneDebugSettings(settings) {
        return webGpuStageRef.current?.setSceneDebugSettings?.(settings) ?? runtimeRef.current?.setSceneDebugSettings?.(settings) ?? null;
      },
      resetSceneDebugSettings() {
        return webGpuStageRef.current?.resetSceneDebugSettings?.() ?? runtimeRef.current?.resetSceneDebugSettings?.() ?? null;
      },
      captureColorBaseline() {
        return webGpuStageRef.current?.captureColorBaseline?.() ?? Promise.reject(new Error("当前渲染管线不支持 V14D 颜色基线采集。"));
      },
      getColorBaselineResult() {
        return webGpuStageRef.current?.getColorBaselineResult?.() ?? null;
      },
      getRendererLabel() {
        return webGpuStageRef.current?.getRendererLabel?.() ?? "Three.js MMD";
      },
    }),
    [phase],
  );

  useEffect(() => {
    if (!containerRef.current || !statusRef.current) return;
    if (renderPipeline === "reze-design" || renderPipeline === "reze-k3") {
      runtimeRef.current = null;
      return;
    }
    let disposed = false;
    let runtime: any = null;
    const controller = new AbortController();
    const clearStageRuntime = () => {
      const activeRuntime = runtimeRef.current;
      const runtimes = [activeRuntime, runtime].filter(
        (candidate, index, all) => candidate && all.indexOf(candidate) === index,
      );
      for (const candidate of runtimes) {
        try {
          candidate.dispose?.();
        } catch {
          // 清理失败不能阻止移除残留画布和显示错误。
        }
      }
      runtime = null;
      runtimeRef.current = null;
      if (process.env.NODE_ENV !== "production" && runtimes.includes(window.__mmdCompanionRuntime)) {
        delete window.__mmdCompanionRuntime;
      }
      containerRef.current?.replaceChildren();
      setAppearanceRuntime(null);
    };
    const start = async () => {
      setStageLoadError(null);
      clearStageRuntime();
      let effectiveModelUrl = modelUrl;
      let v14dGameManifest: any = null;
      const assetRequestHeaders: Record<string, string> = {};
      const token = loadSession()?.token;
      if (token) assetRequestHeaders.Authorization = `Bearer ${token}`;
      const appearanceUser = appearanceUserId.trim();
      if (appearanceUser) assetRequestHeaders["x-user-id"] = appearanceUser;
      if (renderPipeline === "gf2" && !isGf2StageModel(selectedModelPath)) {
        throw new Error("GF2 mode 需要选择克莱妲原皮动作兼容模型。");
      }
      if (renderPipeline === "gf2" && GF2_MODEL_SHA256 === arrivalOutline.modelSha256
        && selectedModelPath === arrivalOutline.modelRelativePath) {
        setArrivalPreview(arrivalPreviewPoints);
      }
      if (renderPipeline === "v14d-game") {
        if (!isKoledaModelIdentifier(selectedModelPath, modelLabel, modelUrl)) {
          throw new Error("V14D 游戏外观当前仅支持明确的 Koleda/克莱妲模型；未静默替换当前模型。");
        }
        statusRef.current!.textContent = "正在检查 V14D 本机游戏外观资源……";
        const manifestResponse = await fetch(toAbsolute(V14D_GAME_MANIFEST_URL), {
          cache: "no-store",
          signal: controller.signal,
          headers: assetRequestHeaders,
        });
        if (!manifestResponse.ok) throw new Error(`V14D 游戏外观清单请求失败（${manifestResponse.status}）。`);
        const contentType = manifestResponse.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) throw new Error(`V14D 游戏外观清单返回了非 JSON 内容（${contentType}）。`);
        const rawManifest = await manifestResponse.json();
        const validation = validateV14dGameManifest(rawManifest);
        if (!validation.ok) throw new Error(validation.reason);
        v14dGameManifest = absolutizeV14dGameManifest(rawManifest, toAbsolute);
        // 只有模型路径与内容摘要均匹配才使用预采样轮廓，不能给其它模型套人形。
        if (!disposed && rawManifest.model.relativePath === arrivalOutline.modelRelativePath
          && rawManifest.model.sha256 === arrivalOutline.modelSha256) setArrivalPreview(arrivalPreviewPoints);
        effectiveModelUrl = v14dGameManifest.model.url;
      } else if (!modelUrl) {
        throw new Error("No MMD models found.");
      }
      if (disposed) return;
      runtime = new (MMDCompanionRuntime as any)({
        container: containerRef.current,
        statusElement: statusRef.current,
        renderPipeline,
        cameraSnapshot: cameraSnapshotRef.current,
        v14dGameManifest,
        resolveUrl: toAbsolute,
        assetRequestHeaders,
      });
      runtimeRef.current = runtime;
      runtime.weapon.onStateChange = (state: { phase: string; detail: string }) => {
        if (!disposed) weaponStateCallbackRef.current?.(state);
      };
      runtime.weapon.setEnabled(weaponVisibleRef.current);
      if (process.env.NODE_ENV !== "production") {
        window.__mmdCompanionRuntime = runtime;
      }
      applyStageRuntimeState(runtime, {
        interaction: currentInteractionRef.current,
        speaking: currentSpeakingRef.current,
        resolveUrl: toAbsolute,
      });
      await runtime.init(toAbsolute(effectiveModelUrl));
      if (disposed) return;
      runtime.weapon.setEnabled(weaponVisibleRef.current);
      // 几何就绪后用真实蒙皮网格投影替换通用轮廓，点的位置与当前相机一致。
      const mesh = runtime.model;
      const positions = mesh?.geometry?.attributes?.position;
      if (!arrivalDisabled && positions && mesh.getVertexPosition && runtime.camera) {
        mesh.updateMatrixWorld(true);
        mesh.skeleton?.update();
        runtime.camera.updateMatrixWorld(true);
        const vertex = mesh.position.clone();
        const points: Array<[number, number]> = [];
        const stride = Math.max(1, Math.floor(positions.count / 4200));
        for (let index = 0; index < positions.count; index += stride) {
          mesh.getVertexPosition(index, vertex);
          mesh.localToWorld(vertex).project(runtime.camera);
          if (vertex.z >= -1 && vertex.z <= 1) points.push([(vertex.x + 1) / 2, (1 - vertex.y) / 2]);
        }
        setArrivalModelPoints(points);
      }
      reportArrivalReady(true);
      if (renderPipeline === "v14d-game") setAppearanceRuntime(runtime);
      applyStageRuntimeState(runtime, {
        interaction: currentInteractionRef.current,
        speaking: currentSpeakingRef.current,
        resolveUrl: toAbsolute,
      });
      if (typeof cameraLockedRef.current === "boolean") {
        runtime.setCameraLocked(cameraLockedRef.current);
      }
    };
    void start().catch((error: Error) => {
      if (disposed || error?.name === "AbortError") return;
      clearStageRuntime();
      setStageLoadError(error.message);
      statusRef.current!.textContent = renderPipeline === "gf2"
        ? `GF2 mode 加载失败：${error.message}`
        : renderPipeline === "v14d-game"
        ? `V14D 游戏外观加载失败：${error.message}`
        : `Model load failed: ${error.message}`;
    });
    return () => {
      disposed = true;
      controller.abort();
      clearStageRuntime();
    };
  }, [appearanceUserId, modelUrl, modelLabel, renderPipeline, selectedModelPath, stageLoadRetry, toAbsolute]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.setSpeaking(speaking);
  }, [speaking]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || typeof cameraLocked !== "boolean") return;
    runtime.setCameraLocked(cameraLocked);
  }, [cameraLocked]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (interaction.mode === "vmd" && interaction.vmdUrl) {
      let cancelled = false;
      const requestedVmdUrl = toAbsolute(interaction.vmdUrl);
      void Promise.resolve(runtime.playVmd(
        requestedVmdUrl,
        interaction.playbackRate,
        interaction.vmdLoopUrls?.map((url) => toAbsolute(url)),
        {
          ...(interaction.playerVmdMode ? { playerVmdMode: interaction.playerVmdMode } : {}),
          standbyUrl: interaction.standbyVmdUrl ? toAbsolute(interaction.standbyVmdUrl) : "",
          loopGapMs: interaction.loopGapMs,
          loopMode: interaction.loopMode === "sequential" ? "sequential" : "random",
          ...(typeof interaction.lockLowerBody === "boolean" ? { lockLowerBody: interaction.lockLowerBody } : {}),
          ...(typeof interaction.lockRootPosition === "boolean" ? { lockRootPosition: interaction.lockRootPosition } : {}),
          ...(interaction.bakedBoneAnimation ? { bakedBoneAnimation: true } : {}),
          ...(interaction.vmdBakedBoneAnimationByUrl ? {
            bakedBoneAnimationByUrl: Object.fromEntries(Object.entries(interaction.vmdBakedBoneAnimationByUrl)
              .map(([url, baked]) => [toAbsolute(url), baked])),
          } : {}),
          ...(interaction.disableCrossfade ? { disableCrossfade: true } : {}),
          emotionByUrl: interaction.vmdLoopEmotionByUrl
            ? Object.fromEntries(
                Object.entries(interaction.vmdLoopEmotionByUrl).map(([url, emotion]) => [toAbsolute(url), emotion]),
              )
            : undefined,
        },
      )).then((played) => {
        if (!cancelled && played === true) onInteractionStarted();
        if (!cancelled && played === false) {
          onInteractionErrorRef.current?.({ type: "vmd", vmdUrl: requestedVmdUrl });
        }
      });
      return () => {
        cancelled = true;
      };
    }
    runtime.applyInteraction(interaction);
  }, [interaction, toAbsolute]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (!cameraSnapshot) return;
    runtime.applyCameraSnapshot(cameraSnapshot);
  }, [cameraSnapshot]);

  useEffect(() => {
    if (!onInteractionComplete) return;
    if (interaction.mode === "vmd" && (interaction.vmdLoopUrls?.length || interaction.standbyVmdUrl)) return;

    let armedProceduralCompletion = false;
    const expectedVmdUrl = interaction.mode === "vmd" && interaction.vmdUrl ? toAbsolute(interaction.vmdUrl) : "";
    const intervalId = window.setInterval(() => {
      const runtime = runtimeRef.current;
      if (!runtime || runtime.isLoadingVmd) return;

      if (interaction.mode === "vmd") {
        if (!expectedVmdUrl || runtime.currentVmdUrl !== expectedVmdUrl) return;
        if (!runtime.currentVmdDurationMs || !runtime.currentVmdStartedAt) return;
        const elapsedMs = runtime.currentVmdAction
          ? runtime.currentVmdAction.time / runtime.currentVmdPlaybackRate * 1000
          : performance.now() - runtime.currentVmdStartedAt;
        if (elapsedMs + 0.01 < runtime.currentVmdDurationMs) return;
        window.clearInterval(intervalId);
        onInteractionComplete();
        return;
      }

      if (runtime.currentSequence || runtime.currentAction) {
        armedProceduralCompletion = true;
        return;
      }
      if (!armedProceduralCompletion) return;
      window.clearInterval(intervalId);
      onInteractionComplete();
    }, 100);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [interaction, onInteractionComplete, toAbsolute]);

  function handleModelChange(event: ChangeEvent<HTMLSelectElement>) {
    onModelChange(event.target.value);
  }

  function handleStagePointerDown(event: PointerEvent<HTMLElement>) {
    if (phase !== "idle") return;
    if (event.target instanceof Element && event.target.closest("button, input, select, textarea, a, [data-pet-interactive]")) return;
    if (!shouldCaptureStagePointer({ enableCharacterClickCapture, button: event.button })) return;
    stagePointerCandidateRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      timeStamp: event.timeStamp,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleStagePointerUp(event: PointerEvent<HTMLElement>) {
    if (!enableCharacterClickCapture) {
      stagePointerCandidateRef.current = null;
      return;
    }
    const candidate = stagePointerCandidateRef.current;
    stagePointerCandidateRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!candidate || candidate.pointerId !== event.pointerId) return;
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
    const hitCharacter =
      renderPipeline === "reze-design" ||
      renderPipeline === "reze-k3" ||
      (webGpuStageRef.current?.hitTestCharacterAtClientPoint?.(event.clientX, event.clientY) ??
        Boolean(runtimeRef.current?.hitTestModelAtClientPoint?.(event.clientX, event.clientY)));
    if (!hitCharacter) return;
    onCharacterClick?.({
      clientX: event.clientX,
      clientY: event.clientY,
      stageRect: event.currentTarget.getBoundingClientRect(),
    });
  }

  function handleStagePointerCancel() {
    stagePointerCandidateRef.current = null;
  }

  function renderClickRipples() {
    if (!clickRipples.length) return null;
    return (
      <div className="mio-stage-click-ripples" aria-hidden="true">
        {clickRipples.map((ripple) => (
          <span
            key={ripple.id}
            className="mio-stage-click-ripple"
            style={{ left: `${ripple.x}px`, top: `${ripple.y}px` }}
          />
        ))}
      </div>
    );
  }

  function renderStageError() {
    if (!stageLoadError) return null;
    const notice = (
      <div role="alert" data-pet-interactive="true" style={{ position: appearanceControlsPortal ? "fixed" : "absolute", top: "12%", left: "50%", transform: "translateX(-50%)", zIndex: appearanceControlsPortal ? 1000 : 5, padding: 12, maxWidth: "80%", color: "white", background: "rgba(20,25,35,.85)", borderRadius: 8 }}>
        <p style={{ margin: "0 0 8px" }}>{stageLoadError}</p>
        <button type="button" onClick={() => setStageLoadRetry((value) => value + 1)}>重新加载角色</button>
      </div>
    );
    return appearanceControlsPortal ? createPortal(notice, document.body) : notice;
  }

  // WebGPU 分支（reze-design / reze-k3）的 RezeWebGpuStage 不会像 Three.js
  // 分支那样在内部对 interaction.vmdUrl 调用 toAbsolute；这里统一转为绝对 URL，
  // 否则 loadVmd 会把相对路径 /assets/... 请求到 web 前端而不是 API，返回 404。
  const webGpuInteraction =
    interaction.mode === "vmd" && interaction.vmdUrl
      ? {
          ...interaction,
          vmdUrl: toAbsolute(interaction.vmdUrl),
          vmdLoopUrls: interaction.vmdLoopUrls?.map((url) => toAbsolute(url)),
          standbyVmdUrl: interaction.standbyVmdUrl ? toAbsolute(interaction.standbyVmdUrl) : interaction.standbyVmdUrl,
        }
      : interaction;

  if (chrome === "bare") {
    return (
      <section
        className="mio-stage"
        aria-label="MMD companion stage"
        data-character-arrival={phase}
        style={{ position: "relative" }}
        data-active-vmd-url={interaction.mode === "vmd" ? interaction.vmdUrl || "" : ""}
        onPointerDown={handleStagePointerDown}
        onPointerUp={handleStagePointerUp}
        onPointerCancel={handleStagePointerCancel}
      >
        <style>{`[data-character-arrival="loading"] .mio-stage-canvas, [data-character-arrival="entrance-loading"] .mio-stage-canvas { opacity: 0 !important; }
          [data-character-arrival] .mio-stage-canvas { transition: opacity 650ms ease; }`}</style>
        {particlesAllowed && (phase === "loading" || phase === "revealing" || entering) && !stageLoadError ? <CharacterArrivalParticles getView={renderPipeline === "v14d-game" || renderPipeline === "gf2" ? getArrivalView : undefined} gatherDurationMs={arrivalDurationMs} key={arrivalKey} waitForModelPoints={renderPipeline !== "reze-design" && renderPipeline !== "reze-k3"} modelPoints={arrivalModelPoints} previewPoints={arrival.key === arrivalKey ? arrivalPreview : []} previewPose={`${arrivalOutline.motionFilename}:frame=${arrivalOutline.frame}`} revealing={phase === "revealing" || phase === "entrance"}
          onFormed={() => setArrival((value) => value.key === arrivalKey ? { ...value, formed: true } : value)} /> : null}
        {renderPipeline === "reze-design" || renderPipeline === "reze-k3" ? (
          <RezeWebGpuStage
            ref={webGpuStageRef}
            modelUrl={toAbsolute(modelUrl)}
            modelIdentifier={selectedModelPath || modelLabel}
            localModelImport={rezeLocalModelImport}
            interaction={webGpuInteraction}
            backgroundEffect={rezeBackgroundEffect}
            grade={rezeGrade}
            gradeIntensity={rezeGradeIntensity}
            sceneSettings={rezeSceneDebugSettings}
            scenePreset={renderPipeline === "reze-k3" ? "reze-k3" : "reze-design"}
            v14dUnlitDiagnostic={v14dUnlitDiagnostic}
            v14dColorBaseline={v14dColorBaseline}
            v14dFaceStatic={v14dFaceStatic}
            v14dFaceStaticMode={v14dFaceStaticMode}
            v14dFaceStaticGated={v14dFaceStaticGated}
            v14dFaceCameraOverride={v14dFaceCameraOverride}
            v14dSkinVariant={v14dSkinVariant}
            transparentBackground={rezeTransparentBackground}
            cameraSnapshot={cameraSnapshot}
            onInteractionComplete={onInteractionComplete}
            onInteractionError={onInteractionError}
            onInteractionStarted={onInteractionStarted}
            onReadyChange={(ready, detail) => {
              reportArrivalReady(ready);
              if (!ready && detail && /失败|不可用/.test(detail)) setStageLoadError(detail);
              if (statusRef.current) statusRef.current.textContent = detail || (ready ? "WebGPU 舞台已就绪。" : "WebGPU 舞台初始化失败。");
            }}
          />
        ) : <div ref={containerRef} className="mio-stage-canvas" />}
        {renderClickRipples()}
        {renderPipeline === "v14d-game" ? (appearanceControlsPortal
          ? createPortal(<V14dGameControls runtime={appearanceRuntime} userId={appearanceUserId} modelPath={selectedModelPath} floating />, document.body)
          : <V14dGameControls runtime={appearanceRuntime} userId={appearanceUserId} modelPath={selectedModelPath} />) : null}
        <p
          ref={statusRef}
          className={renderPipeline === "v14d-game" || renderPipeline === "gf2" ? "mio-stage-status" : "mio-stage-status mio-stage-status--sr-only"}
          aria-live="polite"
          hidden={renderPipeline === "gf2" ? phase === "idle" : renderPipeline !== "v14d-game" || (appearanceControlsPortal && Boolean(appearanceRuntime))}
        >
          Initializing stage...
        </p>
        {renderStageError()}
      </section>
    );
  }

  return (
    <section className="panel" data-character-arrival={phase} style={{ position: "relative", display: "grid", gridTemplateRows: "auto 1fr auto", minHeight: 0 }}>
      <style>{`[data-character-arrival="loading"] canvas:not([data-character-particles]), [data-character-arrival="entrance-loading"] canvas:not([data-character-particles]) { opacity: 0 !important; }
        [data-character-arrival] canvas:not([data-character-particles]) { transition: opacity 650ms ease; }`}</style>
      {particlesAllowed && (phase === "loading" || phase === "revealing" || entering) && !stageLoadError ? <CharacterArrivalParticles getView={renderPipeline === "v14d-game" || renderPipeline === "gf2" ? getArrivalView : undefined} gatherDurationMs={arrivalDurationMs} key={arrivalKey} waitForModelPoints={renderPipeline !== "reze-design" && renderPipeline !== "reze-k3"} modelPoints={arrivalModelPoints} previewPoints={arrival.key === arrivalKey ? arrivalPreview : []} previewPose={`${arrivalOutline.motionFilename}:frame=${arrivalOutline.frame}`} revealing={phase === "revealing" || phase === "entrance"}
        onFormed={() => setArrival((value) => value.key === arrivalKey ? { ...value, formed: true } : value)} /> : null}
      <header style={{ padding: "0.95rem 1rem 0.35rem" }}>
        <h2 style={{ margin: 0, fontFamily: "Space Grotesk, sans-serif" }}>Companion Stage</h2>
        <p className="muted" style={{ margin: "0.35rem 0 0" }}>
          Model: {modelLabel || "No model selected"}
        </p>
        <label style={{ display: "grid", gap: "0.35rem", marginTop: "0.7rem", maxWidth: "20rem" }}>
          <span className="muted">Model</span>
          <select
            className="select"
            aria-label="Model"
            value={selectedModelPath}
            onChange={handleModelChange}
            disabled={models.length === 0}
          >
            {models.length === 0 ? <option value="">No MMD models</option> : null}
            {models.map((model) => (
              <option key={model.relative_path} value={model.relative_path}>
                {getModelDisplayLabel(model)}
              </option>
            ))}
          </select>
        </label>
      </header>
      {renderPipeline === "reze-design" || renderPipeline === "reze-k3" ? (
        <div style={{ margin: "0.45rem 0.95rem", minHeight: 0, borderRadius: "0.8rem", border: "1px solid rgba(140, 209, 255, 0.19)", overflow: "hidden" }}>
        <RezeWebGpuStage ref={webGpuStageRef} modelUrl={toAbsolute(modelUrl)} modelIdentifier={selectedModelPath || modelLabel} localModelImport={rezeLocalModelImport} interaction={webGpuInteraction} backgroundEffect={rezeBackgroundEffect} grade={rezeGrade} gradeIntensity={rezeGradeIntensity} sceneSettings={rezeSceneDebugSettings} scenePreset={renderPipeline === "reze-k3" ? "reze-k3" : "reze-design"} v14dUnlitDiagnostic={v14dUnlitDiagnostic} v14dColorBaseline={v14dColorBaseline} transparentBackground={rezeTransparentBackground} cameraSnapshot={cameraSnapshot} onInteractionComplete={onInteractionComplete} onInteractionStarted={onInteractionStarted} onInteractionError={onInteractionError} onReadyChange={reportArrivalReady} />
        {/* chrome="panel" 分支为旧诊断入口，不接 V1 皮肤变体（默认 original）。 */}
        </div>
      ) : (
        <div
          ref={containerRef}
          onPointerDown={handleStagePointerDown}
          onPointerUp={handleStagePointerUp}
          onPointerCancel={handleStagePointerCancel}
          style={{
            margin: "0.45rem 0.95rem",
            minHeight: 0,
            borderRadius: "0.8rem",
            border: "1px solid rgba(140, 209, 255, 0.19)",
            overflow: "hidden",
          }}
        />
      )}
      <p ref={statusRef} className="muted" style={{ margin: 0, padding: "0.6rem 1rem 0.9rem" }}>
        Initializing stage...
      </p>
    </section>
  );
});
