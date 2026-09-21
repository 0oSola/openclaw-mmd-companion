"use client";

import { PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { makeUrl } from "@/lib/api";
import { computePeaks, seekTimeFromPointer } from "@/lib/audioWaveform.js";

type PodcastWaveformProps = {
  audioUrl: string | null;
  format: string | null;
  title: string;
  userId?: string;
};

type DecodeState = "idle" | "loading" | "ready" | "unavailable";

export function PodcastWaveform({ audioUrl, format, title, userId = "" }: PodcastWaveformProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const [decodeState, setDecodeState] = useState<DecodeState>("idle");
  const [peaks, setPeaks] = useState<number[]>([]);
  const [playing, setPlaying] = useState(false);
  // <audio src> 无法携带请求头，身份用查询参数传给后端音频代理。
  const resolvedAudioUrl = useMemo(() => {
    if (!audioUrl) return null;
    const base = makeUrl(audioUrl);
    if (!userId) return base;
    return base + (base.includes("?") ? "&" : "?") + "user_id=" + encodeURIComponent(userId);
  }, [audioUrl, userId]);
  const disabled = !resolvedAudioUrl;

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const audio = audioRef.current;
    if (!canvas || !context) return;

    const width = canvas.width;
    const height = canvas.height;
    const progress = audio?.duration ? Math.min(1, Math.max(0, audio.currentTime / audio.duration)) : 0;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "rgba(8, 22, 36, 0.84)";
    context.fillRect(0, 0, width, height);

    const centerY = height / 2;
    const barWidth = Math.max(1, Math.floor(width / Math.max(1, peaks.length)));
    const sourcePeaks = peaks.length ? peaks : [];
    context.fillStyle = disabled || decodeState === "unavailable" ? "rgba(126, 154, 174, 0.32)" : "rgba(115, 211, 237, 0.42)";
    sourcePeaks.forEach((peak, index) => {
      const x = index * barWidth;
      const barHeight = Math.max(2, peak * (height - 12));
      context.fillRect(x, centerY - barHeight / 2, Math.max(1, barWidth - 1), barHeight);
    });

    if (sourcePeaks.length) {
      context.save();
      context.beginPath();
      context.rect(0, 0, width * progress, height);
      context.clip();
      context.fillStyle = "rgba(92, 232, 199, 0.9)";
      sourcePeaks.forEach((peak, index) => {
        const x = index * barWidth;
        const barHeight = Math.max(2, peak * (height - 12));
        context.fillRect(x, centerY - barHeight / 2, Math.max(1, barWidth - 1), barHeight);
      });
      context.restore();
    } else {
      context.fillStyle = "rgba(166, 207, 226, 0.38)";
      context.fillRect(0, centerY - 1, width, 2);
    }

    context.fillStyle = "rgba(235, 250, 255, 0.9)";
    context.fillRect(Math.max(0, width * progress - 1), 8, 2, height - 16);
  }, [decodeState, disabled, peaks]);

  const syncProgress = useCallback(() => {
    drawWaveform();
    if (audioRef.current && !audioRef.current.paused) {
      rafRef.current = requestAnimationFrame(syncProgress);
    }
  }, [drawWaveform]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(72, Math.floor(rect.height * ratio));
      drawWaveform();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [drawWaveform]);

  useEffect(() => {
    let cancelled = false;
    setPeaks([]);
    setDecodeState(audioUrl ? "loading" : "idle");
    if (!resolvedAudioUrl) return;
    const audioFetchUrl = resolvedAudioUrl;

    async function decodeWaveform() {
      try {
        const response = await fetch(audioFetchUrl, { cache: "no-store" });
        const data = await response.arrayBuffer();
        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        const audioContext = new AudioContextCtor();
        try {
          const buffer = await audioContext.decodeAudioData(data);
          if (cancelled) return;
          const canvasWidth = canvasRef.current?.width || 180;
          setPeaks(computePeaks(buffer.getChannelData(0), Math.max(64, Math.floor(canvasWidth / 3))));
          setDecodeState("ready");
        } finally {
          await audioContext.close().catch(() => undefined);
        }
      } catch {
        if (!cancelled) setDecodeState("unavailable");
      }
    }

    void decodeWaveform();
    return () => {
      cancelled = true;
    };
  }, [audioUrl, resolvedAudioUrl]);

  useEffect(() => {
    drawWaveform();
  }, [drawWaveform]);

  const seekFromPointer = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    const audio = audioRef.current;
    const canvas = canvasRef.current;
    if (!audio || !canvas || !audio.duration) return;
    const rect = canvas.getBoundingClientRect();
    audio.currentTime = seekTimeFromPointer({
      clientX: event.clientX,
      left: rect.left,
      width: rect.width,
      duration: audio.duration,
    });
    drawWaveform();
  }, [drawWaveform]);

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || disabled) return;
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  }, [disabled]);

  return (
    <section className={`podcast-waveform-card${disabled ? " is-disabled" : ""}`} aria-label={title}>
      <audio
        ref={audioRef}
        src={resolvedAudioUrl || undefined}
        preload="metadata"
        onPlay={() => {
          setPlaying(true);
          if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
          rafRef.current = requestAnimationFrame(syncProgress);
        }}
        onPause={() => {
          setPlaying(false);
          drawWaveform();
        }}
        onEnded={() => {
          setPlaying(false);
          drawWaveform();
        }}
        onTimeUpdate={drawWaveform}
      />
      <div className="podcast-waveform-toolbar">
        <button type="button" onClick={togglePlayback} disabled={disabled} aria-label={playing ? "Pause podcast" : "Play podcast"}>
          {playing ? "Pause" : "Play"}
        </button>
        <span>{format || "no audio"}</span>
        <strong>{decodeState === "loading" ? "Loading waveform" : decodeState === "unavailable" ? "Waveform unavailable" : title}</strong>
      </div>
      <canvas
        ref={canvasRef}
        className="podcast-waveform-canvas"
        role="img"
        aria-label={disabled ? "No podcast audio available" : "Podcast waveform seek control"}
        onPointerDown={(event) => {
          if (disabled) return;
          draggingRef.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          seekFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (!draggingRef.current || disabled) return;
          seekFromPointer(event);
        }}
        onPointerUp={(event) => {
          draggingRef.current = false;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={(event) => {
          draggingRef.current = false;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      />
      {disabled ? <p>No audio is available for this podcast.</p> : null}
      {!disabled && decodeState === "unavailable" ? <p>Waveform unavailable. Audio controls remain available.</p> : null}
    </section>
  );
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
