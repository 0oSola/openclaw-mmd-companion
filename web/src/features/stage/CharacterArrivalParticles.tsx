"use client";

import { useEffect, useRef } from "react";
import type { ArrivalView } from "./characterArrivalProjection";

type Point = [number, number];
const EMPTY_POINTS: Point[] = [];
const random = (seed: number) => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};

// 点集均来自真实模型；提供镜头时先投影L06局部几何，旧入口保留高度归一坐标。
export function CharacterArrivalParticles({ revealing, onFormed, modelPoints = EMPTY_POINTS, previewPoints = EMPTY_POINTS, previewPose = "", waitForModelPoints = true, gatherDurationMs = 6400, getView }: {
  getView?: () => ArrivalView | null;
  gatherDurationMs?: number;
  revealing: boolean; onFormed: () => void; modelPoints?: Point[]; previewPoints?: Point[]; previewPose?: string; waitForModelPoints?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const callbackRef = useRef(onFormed);
  const revealingRef = useRef(revealing);
  revealingRef.current = revealing;
  const drawingControlRef = useRef<((value: boolean) => void) | null>(null);
  callbackRef.current = onFormed;
  useEffect(() => { drawingControlRef.current?.(revealing); }, [revealing]);
  const inputs = useRef({ model: modelPoints, preview: previewPoints, modelStarted: 0, waitForModelPoints, getView });
  useEffect(() => {
    if (inputs.current.model !== modelPoints) inputs.current.modelStarted = performance.now();
    inputs.current.model = modelPoints;
    inputs.current.preview = previewPoints;
    inputs.current.waitForModelPoints = waitForModelPoints;
    inputs.current.getView = getView;
  }, [modelPoints, previewPoints, waitForModelPoints, getView]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const hologramEnabled = new URLSearchParams(window.location.search).get("arrivalStyle") !== "particles";
    let hologram: ReturnType<typeof import("./characterArrivalHologram").createArrivalHologram> = null;
    let disposed = false, pointerStrength = 0;
    let project: ReturnType<typeof import("./characterArrivalProjection").createArrivalProjection> = null;
    let projectionFailed = false;
    if (getView) void import("./characterArrivalProjection").then(module => {
      if (!disposed) { project = module.createArrivalProjection(); projectionFailed = !project; }
    }).catch(error => { projectionFailed = true; console.warn("加载姿态投影不可用，等待真实模型", error); });
    if (hologramEnabled) void import("./characterArrivalHologram").then(module => {
      if (!disposed && module.hologramPoseMatches) hologram = module.createArrivalHologram();
    }).catch(error => console.warn("全息实验资源未就绪，继续原粒子", error));
    const grains = Array.from({ length: 24000 }, (_, i) => ({
      phase: random(i * 7) * Math.PI * 2, depth: random(i * 7 + 1),
      spread: random(i * 7 + 2), size: .85 + random(i * 7 + 3) * 1.15,
      speed: .45 + random(i * 7 + 4) * .65, wisp: random(i * 7 + 5) > .94,
      delay: random(i * 7 + 6) * 1.1,
    }));
    const glow = document.createElement("canvas");
    glow.width = glow.height = 32;
    const glowContext = glow.getContext("2d");
    if (!glowContext) return;
    const gradient = glowContext.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, "rgba(166,213,255,.7)");
    gradient.addColorStop(.22, "rgba(65,109,255,.3)");
    gradient.addColorStop(1, "rgba(65,81,255,0)");
    glowContext.fillStyle = gradient;
    glowContext.fillRect(0, 0, 32, 32);

    let frame = 0, notified = false, faded = false;
    let fadeTimer: number | undefined;
    let width = 0, height = 0;
    let sourceModel: Point[] | undefined, sourcePreview: Point[] | undefined;
    let actual: Point[] = [], preview: Point[] = [];
    let centerX = 0, centerY = 0, halfWidth = 0, halfHeight = 0;
    let gatherStarted: number | null = null;
    let gatherElapsedMs = 0, animationElapsedMs = 0;
    let offsets = new Float32Array(0);
    const start = performance.now();
    let previousFrame = start;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pointer = { x: 0, y: 0, active: false };
    const clearPointer = () => { pointer.active = false; };
    const movePointer = (event: PointerEvent) => {
      pointer.x = event.clientX; pointer.y = event.clientY;
      pointer.active = !reduced && event.pointerType !== "touch" && event.buttons === 0
        && !(event.target instanceof Element && event.target.closest("button, input, textarea, select, a, [data-pet-interactive], .pet-panel"));
    };
    const leaveWindow = (event: PointerEvent) => { if (!event.relatedTarget) clearPointer(); };
    const changeVisibility = () => {
      if (document.hidden) { clearPointer(); cancelAnimationFrame(frame); frame = 0; }
      else if (!faded && !disposed && !frame) { previousFrame = performance.now(); frame = requestAnimationFrame(draw); }
    };
    // 只观察输入，不接管点击或拖动；透明粒子层保持鼠标穿透。
    window.addEventListener("pointermove", movePointer, { passive: true, capture: true });
    window.addEventListener("pointerout", leaveWindow, { passive: true });
    window.addEventListener("pointercancel", clearPointer);
    window.addEventListener("blur", clearPointer);
    document.addEventListener("visibilitychange", changeVisibility);
    const draw = (now: number) => {
      frame = 0;
      if (disposed || faded || document.hidden) return;
      const box = canvas.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(box.width * dpr));
      const h = Math.max(1, Math.round(box.height * dpr));
      const size = Math.min(h * .88, w * 1.35);
      const delta = Math.min(.1, Math.max(0, (now - previousFrame) / 1000));
      previousFrame = now;
      animationElapsedMs += delta * 1000;
      const pointerInside = pointer.active && pointer.x >= box.left && pointer.x <= box.right && pointer.y >= box.top && pointer.y <= box.bottom;
      const pointerX = (pointer.x - box.left) * dpr, pointerY = (pointer.y - box.top) * dpr;
      const pointerRadius = Math.max(65 * dpr, Math.min(125 * dpr, size * .16));
      const approach = 1 - Math.exp(-delta * 9), recover = 1 - Math.exp(-delta * 4);
      let maxOffset = 0;
      const input = inputs.current;
      const view = input.getView?.();
      const projected = input.preview.length && project && view ? project(view, box) : null;
      const previewInput = input.getView ? projected?.points || EMPTY_POINTS : input.preview;
      const awaitingProjection = Boolean(input.getView && input.preview.length && !projected && !projectionFailed);
      if (width !== w || height !== h || sourceModel !== input.model || sourcePreview !== previewInput) {
        width = w; height = h; sourceModel = input.model; sourcePreview = previewInput;
        canvas.width = w; canvas.height = h;
        const gap = Math.max(2.5 * dpr, size * .0055);
        const sample = (source: Point[], centered: boolean) => {
          const cells = new Map<string, Point[]>();
          const result: Point[] = [];
          for (const [sx, sy] of source) {
            const x = centered ? w / 2 + sx * h : sx * w;
            const y = centered ? h / 2 + sy * h : sy * h;
            if (!Number.isFinite(x + y)) continue;
            const cx = Math.floor(x / gap), cy = Math.floor(y / gap);
            let crowded = false;
            for (let dx = -1; dx <= 1 && !crowded; dx++) for (let dy = -1; dy <= 1; dy++) {
              if (cells.get(`${cx + dx},${cy + dy}`)?.some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 < gap ** 2)) {
                crowded = true; break;
              }
            }
            if (crowded) continue;
            const point: Point = [x, y], key = `${cx},${cy}`;
            const cell = cells.get(key) || [];
            cell.push(point); cells.set(key, cell); result.push(point);
          }
          return result;
        };
        actual = sample(input.model, false);
        preview = sample(previewInput, !input.getView);
        const anchors = preview.length ? preview : actual;
        if (offsets.length !== anchors.length * 20) offsets = new Float32Array(anchors.length * 20);
        if (anchors.length) {
          let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
          for (const [x, y] of anchors) {
            left = Math.min(left, x); right = Math.max(right, x);
            top = Math.min(top, y); bottom = Math.max(bottom, y);
          }
          centerX = (left + right) / 2; centerY = (top + bottom) / 2;
          halfWidth = (right - left) / 2; halfHeight = (bottom - top) / 2;
        }
      }
      context.clearRect(0, 0, w, h);
      const time = reduced ? 0 : animationElapsedMs / 1000;
      // 从首次有真实轮廓时计时，网络等待不能提前消耗聚合动画。
      const hasOutline = !awaitingProjection && (preview.length > 0 || actual.length > 0);
      if (gatherStarted !== null) gatherElapsedMs += delta * 1000;
      if (gatherStarted === null && (hasOutline || !input.waitForModelPoints)) gatherStarted = now;
      const elapsed = gatherElapsedMs / 1000 * (6400 / Math.max(1, gatherDurationMs));
      // 呼吸不随聚合时长加速；停顿恢复最多推进100ms，避免直接跳过聚合尾段。
      const breathTime = gatherElapsedMs / 1000;
      const breathPhase = (breathTime % 4.8) / 4.8;
      const breathRamp = breathPhase < .42 ? breathPhase / .42 : (1 - breathPhase) / .58;
      const breath = reduced ? .5 : breathRamp * breathRamp * (3 - 2 * breathRamp);
      const breathMotion = reduced ? 0 : breath - .5;
      const breathLight = reduced ? 1 : .78 + breath * .28;
      const breathSize = reduced ? 1 : .96 + breath * .12;
      // 需要人物轮廓的入口始终保留完整时长，重试/尺寸变化导致的短暂投影缺口不能走光束退路。
      const duration = input.waitForModelPoints || hasOutline ? 6.4 : 3.2;
      const progress = gatherStarted === null ? 0 : reduced ? 1 : Math.min(1, elapsed / duration);
      const modelBlend = reduced ? 1 : Math.min(1, (now - input.modelStarted) / 900);
      canvas.dataset.modelFormed = String(actual.length > 0 && modelBlend === 1);
      canvas.dataset.particlePhase = progress < .12 ? "cloud" : progress < 1 ? "gather" : "formed";
      canvas.dataset.gatherStep = gatherStarted === null ? "waiting" : String(Math.floor(progress * 4));
      canvas.dataset.gatherStarted = gatherStarted === null ? "" : String(gatherStarted);
      canvas.dataset.outlineSource = preview.length ? "verified-model-preview" : actual.length ? "runtime-model" : "awaiting-model";
      context.globalCompositeOperation = "source-over";
      pointerStrength += ((pointerInside ? 1 : 0) - pointerStrength) * (pointerInside ? approach : recover);
      const surface = preview.length ? hologram?.draw({ width: w, height: h, time, progress, breath,
        pointerX, pointerY, pointerStrength: reduced ? 0 : pointerStrength, reduced, projection: projected,
        anchor: [(centerX - w / 2) / h + .5, centerY / h, halfHeight / h] }) : null;
      const hasHologram = Boolean(surface);
      canvas.dataset.arrivalStyle = hasHologram ? "hologram" : "particles";
      if (surface) context.drawImage(surface, 0, 0, w, h);

      // 几何尚不可用时只显示光束，不用通用人偶替代另一个角色。
      if (!reduced && time < 3.2) {
        const strength = Math.min(1, time * 3) * Math.min(1, (3.2 - time) / 1.2);
        for (let beam = 0; beam < (hasHologram ? 3 : 7); beam++) {
          const beamCenter = hasOutline ? centerX : w / 2;
          const beamWidth = hasOutline ? halfWidth * 1.1 : size * .32;
          const bx = beamCenter + (random(beam + 70) - .5) * beamWidth;
          const bottom = Math.min(h * .96, time * h * (1.1 + random(beam + 90)));
          const beamGradient = context.createLinearGradient(bx, 0, bx, Math.max(1, bottom));
          beamGradient.addColorStop(0, "rgba(91,89,255,0)");
          beamGradient.addColorStop(.7, `rgba(72,117,255,${strength * .09})`);
          beamGradient.addColorStop(1, `rgba(178,216,255,${strength * .32})`);
          context.fillStyle = beamGradient;
          context.fillRect(bx - 3 * dpr, 0, 6 * dpr, bottom);
          context.fillStyle = `rgba(${beam % 3 ? "159,206,255" : "183,131,255"},${strength * .72})`;
          context.fillRect(bx, Math.max(0, bottom - h * .8), .65 * dpr, Math.min(bottom, h * .8));
        }
      }

      const renderCloud = (anchors: Point[], weight: number) => {
        if (weight <= 0) return;
        for (let index = 0; index < anchors.length; index++) {
          if (hasHologram && index % 2) continue;
          const [targetX, targetY] = anchors[index];
          const density = .8 + .2 * random(index + 53);
          // 以胸腹附近为重心，脚部保持稳定，避免整个人形像气球一样缩放。
          const chestWeight = Math.exp(-(((targetY - (centerY - halfHeight * .25)) / Math.max(1, halfHeight * .85)) ** 2));
          for (let layer = 0; layer < (hasHologram ? 2 : 10); layer++) {
            const grain = grains[(index * 10 + layer) % grains.length];
            const angle = grain.phase + time * grain.speed * .35;
            // 不同尺度的缓慢流动和少量低亮逸散，软化轮廓而不是模糊整张画布。
            const radius = size * (.003 + grain.spread * .010 + (grain.wisp ? .022 : 0)) * (1.3 - progress * .3) * (1 + breathMotion * .4);
            const drift = reduced ? 0 : Math.sin(time * grain.speed + grain.phase + targetY / h * 5) * size * .003;
            const travel = reduced ? 1 : Math.max(0, Math.min(1, (elapsed - grain.delay) / (4.5 + grain.depth * .65)));
            const settled = travel * travel * (3 - 2 * travel);
            // 起点位于模型包围范围之外，疏密和远近不一；弧线收拢后留下局部漂浮。
            const directionX = Math.cos(grain.phase), directionY = Math.sin(grain.phase);
            const edge = Math.min(halfWidth / Math.max(.001, Math.abs(directionX)), halfHeight / Math.max(.001, Math.abs(directionY)));
            const distance = edge + size * (.09 + grain.spread * .28);
            const sourceX = centerX + directionX * distance;
            const sourceY = centerY + directionY * distance;
            const bend = Math.sin(Math.PI * travel) * (1 - travel) * size * (.08 + grain.depth * .12);
            let x = sourceX + (targetX - sourceX) * settled - directionY * bend + Math.cos(angle) * radius + drift;
            let y = sourceY + (targetY - sourceY) * settled + directionX * bend + Math.sin(angle * .85 + grain.phase) * radius * .8 - drift * .65;
            x += (targetX - centerX) * breathMotion * .065 * chestWeight * settled;
            y -= size * .006 * breathMotion * chestWeight * settled;
            const offsetIndex = (index * 10 + layer) * 2;
            let pushX = 0, pushY = 0;
            if (pointerInside) {
              const dx = x - pointerX, dy = y - pointerY;
              const distanceToPointer = Math.hypot(dx, dy);
              if (distanceToPointer < pointerRadius) {
                const falloff = (1 - distanceToPointer / pointerRadius) ** 2;
                const nx = distanceToPointer > .01 ? dx / distanceToPointer : directionX;
                const ny = distanceToPointer > .01 ? dy / distanceToPointer : directionY;
                const push = pointerRadius * .44 * falloff * (.25 + grain.depth * .75);
                pushX = (nx - ny * .3) * push;
                pushY = (ny + nx * .3) * push;
              }
            }
            const response = pushX || pushY ? approach : recover;
            offsets[offsetIndex] += (pushX - offsets[offsetIndex]) * response;
            offsets[offsetIndex + 1] += (pushY - offsets[offsetIndex + 1]) * response;
            if (Math.abs(offsets[offsetIndex]) < .01) offsets[offsetIndex] = 0;
            if (Math.abs(offsets[offsetIndex + 1]) < .01) offsets[offsetIndex + 1] = 0;
            x += offsets[offsetIndex]; y += offsets[offsetIndex + 1];
            maxOffset = Math.max(maxOffset, Math.abs(offsets[offsetIndex]), Math.abs(offsets[offsetIndex + 1]));
            const pulse = reduced ? 1 : .96 + .04 * Math.sin(time * .6 + grain.phase);
            const arrivalAlpha = reduced ? 1 : Math.min(1, elapsed / .55) * (.28 + settled * .72);
            const alpha = (.62 + grain.depth * .32) * weight * density * pulse * (grain.wisp ? .4 : 1) * arrivalAlpha * breathLight
              * (hasHologram ? .18 + (1 - progress) * .65 : 1);
            if (layer === 0 && index % 3 === 0) {
              const haloSize = (9 + grain.size * 3) * dpr * (1 + breathMotion * .4);
              context.globalAlpha = .18 * weight * arrivalAlpha * (reduced ? 1 : .7 + breath * .45);
              context.drawImage(glow, x - haloSize / 2, y - haloSize / 2, haloSize, haloSize);
              context.globalAlpha = 1;
            }
            context.fillStyle = hasHologram ? `rgba(${layer ? "66,212,241" : "173,239,255"},${alpha})` : layer % 5 === 0 ? `rgba(139,123,255,${alpha})`
              : layer % 3 === 0 ? `rgba(155,217,255,${alpha})` : `rgba(42,121,255,${alpha})`;
            const diameter = grain.size * dpr * (1 + grain.depth * .2) * breathSize * (hasHologram ? 1.25 : 1);
            context.fillRect(x, y, diameter, diameter);
          }
        }
      };
      // 选定动作的首帧预览保持至淡出；模型初始站姿不能覆盖这个姿势。
      renderCloud(preview, 1);
      if (!preview.length && !awaitingProjection) renderCloud(actual, 1);
      canvas.dataset.particleInteraction = reduced ? "reduced" : pointerInside ? "hover" : maxOffset > .1 || (hasHologram && pointerStrength > .01) ? "returning" : "idle";
      if (progress === 1 && !notified && (!input.waitForModelPoints || hasOutline)) {
        notified = true; canvas.dataset.formed = "true"; callbackRef.current();
      }
      frame = requestAnimationFrame(draw);
    };
    const setRevealing = (value: boolean) => {
      window.clearTimeout(fadeTimer);
      if (value) {
        fadeTimer = window.setTimeout(() => {
          faded = true; cancelAnimationFrame(frame); frame = 0;
          canvas.dataset.particleDrawing = "faded";
        }, 650);
      } else {
        faded = false;
        canvas.dataset.particleDrawing = "running";
        if (!frame && !document.hidden) { previousFrame = performance.now(); frame = requestAnimationFrame(draw); }
      }
    };
    frame = requestAnimationFrame(draw);
    drawingControlRef.current = setRevealing;
    setRevealing(revealingRef.current);
    return () => {
      disposed = true; hologram?.dispose();
      drawingControlRef.current = null;
      window.clearTimeout(fadeTimer);
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", movePointer, true);
      window.removeEventListener("pointerout", leaveWindow);
      window.removeEventListener("pointercancel", clearPointer);
      window.removeEventListener("blur", clearPointer);
      document.removeEventListener("visibilitychange", changeVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} aria-label="模型轮廓粒子正在漂浮汇聚" data-character-particles="true" data-outline-pose={previewPoints.length ? previewPose : ""}
    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 3, pointerEvents: "none", opacity: revealing ? 0 : 1, transition: "opacity 650ms ease" }} />;
}
