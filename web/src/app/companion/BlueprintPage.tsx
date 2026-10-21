"use client";

import { createContext, useContext, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import type { StageLoadState } from "@/features/stage/MMDStage";
import { ArrowRight } from "lucide-react";
import "./pageEntrance.css";

type Box = { x: number; y: number; width: number; height: number; detail: boolean };
type Phase = "sketch" | "reveal" | "ready";
type StageBinding = { entranceAllowed: boolean; particlesAllowed: boolean; arrivalDurationMs: number; onLoadStateChange: (state: StageLoadState) => void };
const StageRenderReady = createContext<StageBinding>({ entranceAllowed: true, particlesAllowed: true, arrivalDurationMs: 6400, onLoadStateChange: () => {} });

/** 人物在覆盖层下加载；只延后出场播放，不延后渲染器挂载。 */
export function BlueprintRenderGate({ children, canLoad }: { children: (binding: StageBinding) => ReactNode; canLoad: boolean }) {
  const binding = useContext(StageRenderReady);
  return canLoad ? children(binding) : <section className="mio-stage" data-stage-deferred="true" aria-label="角色舞台准备中" />;
}

/** 线稿独立画完并淡出，主场景可见后才启动粒子；资源可提前加载。 */
export function BlueprintPage({ children, loadingError, ...props }: ComponentProps<"main"> & { loadingError?: string | null }) {
  const root = useRef<HTMLElement>(null);
  const [phase, setPhase] = useState<Phase>("sketch");
  const [stageRenderReady, setStageRenderReady] = useState(false);
  const [loadState, setLoadState] = useState<StageLoadState | null>(null);
  const [sketchComplete, setSketchComplete] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [size, setSize] = useState({ width: 1, height: 1 });

  useEffect(() => {
    if (phase === "ready") setStageRenderReady(true);
  }, [phase]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => { setReduced(media.matches); if (media.matches) setPhase("ready"); };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (sketchComplete && phase === "sketch") setPhase("reveal");
  }, [sketchComplete, phase]);

  useEffect(() => {
    if (phase === "ready") return;
    const element = root.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      setSize({ width: bounds.width, height: bounds.height });
      const regions = ".mio-topbar, .mio-sidebar, .mio-stage-wrap, .mio-card, .mio-chatbox-head, .mio-chatbox-list, .mio-command-bar";
      const details = ".mio-brand, .mio-nav-button, .mio-card h2, .mio-card-copy p, .mio-card-copy li, .mio-dialogue, .mio-command-input-shell";
      setBoxes(Array.from(element.querySelectorAll(`${regions}, ${details}`)).flatMap((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return [];
        return [{ x: rect.left - bounds.left, y: rect.top - bounds.top,
          width: rect.width, height: rect.height, detail: !node.matches(regions) }];
      }));
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    element.querySelectorAll(".mio-layout, .mio-right-rail").forEach((node) => observer.observe(node));
    window.addEventListener("resize", schedule);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("resize", schedule); };
  }, [phase]);

  return (
    <main {...props} ref={root} data-page-entrance={phase} data-sketch-complete={sketchComplete} data-reduced-motion={reduced} data-stage-render-ready={stageRenderReady} data-stage-load-state={loadingError ? "error" : loadState?.state || "loading"}>
      <StageRenderReady.Provider value={{ entranceAllowed: stageRenderReady, particlesAllowed: stageRenderReady, arrivalDurationMs: 6400, onLoadStateChange: setLoadState }}>{children}</StageRenderReady.Provider>
      {(loadingError || loadState?.state === "error") ? <div className="blueprint-load-error" role="alert">
        <p>{loadingError || loadState?.detail}</p>
        <button type="button" onClick={() => loadingError ? window.location.reload() : loadState?.retry()}>重新加载角色</button>
      </div> : null}
      {phase !== "ready" && !reduced ? <div className="blueprint-entrance-control">
        <button type="button" onClick={() => {
          setPhase("ready");
        }}
          aria-label="跳过页面入场">
          <ArrowRight size={14} />
          <span>跳过入场</span>
        </button>
      </div> : null}
      {phase !== "ready" && !reduced ? (
        <svg className="blueprint-wireframe" aria-hidden="true" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none"
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget && event.animationName === "page-wire-dismiss" && phase === "reveal") setPhase("ready");
          }}>
          <defs><pattern id="blueprint-dots" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.65" fill="#c8ccd0" /></pattern></defs>
          {boxes.map((box, index) => (
            <g key={index} className={box.detail ? "blueprint-wire-detail" : "blueprint-wire-region"} style={{ animationDelay: `${Math.min(index * 22, 280)}ms` }}
              onAnimationEnd={(event) => {
                if (event.target === event.currentTarget && event.animationName === "page-wire-draw" && index === boxes.length - 1) setSketchComplete(true);
              }}>
              <rect x={box.x} y={box.y} width={box.width} height={box.height} rx={box.detail ? 4 : 16}
                fill={box.detail ? "none" : "url(#blueprint-dots)"} stroke="currentColor" strokeWidth="0.8" />
              {!box.detail && [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]].map(([x, y], corner) => (
                <rect key={corner} x={x - 2} y={y - 2} width="4" height="4" fill="#fff" stroke="currentColor" strokeWidth="0.8" />
              ))}
              {box.detail && box.width > 120 ? <path d={`M${box.x + 8} ${box.y + box.height / 2}h${box.width * 0.65}`} stroke="currentColor" strokeWidth="1" strokeDasharray="2 4" /> : null}
            </g>
          ))}
        </svg>
      ) : null}
    </main>
  );
}
