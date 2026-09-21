"use client";

import Link from "next/link";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { makeUrl } from "@/lib/api";
import type { ChatMessage, DailyPodcast, MessageServiceSession } from "@/lib/types";

import { CompanionChatbox } from "./CompanionChatbox";
import { CodexConsole } from "./CodexConsole";

export type RightPanelView = "overview" | "chat" | "tasks" | "tools" | "memory" | "skills";

type TraceRow = readonly [string, string, string, string];

type CompanionRightRailProps = {
  collapsed: boolean;
  activeView: RightPanelView;
  userId: string;
  sessions: MessageServiceSession[];
  activeSessionId: string;
  sessionBusy: boolean;
  messages: ChatMessage[];
  chatAutoScrollRevision: number;
  loading: boolean;
  error: string;
  ttsEnabled: boolean;
  activeTtsMessageId: string;
  nextSteps: string[];
  memoryNotes: string[];
  traceRows: readonly TraceRow[];
  dailyPodcast: DailyPodcast | null;
  onRefreshDailyPodcast: () => Promise<void> | void;
  onBeforeAudioPlayback: () => void;
  onPodcastAudioStopReady: (stop: (() => void) | null) => void;
  onToggleCollapsed: () => void;
  onCreateSession: () => void;
  onSelectSession: (sessionId: string) => void;
  onRenameSession: (session: MessageServiceSession) => void;
  onDeleteSession: (session: MessageServiceSession) => void;
  onPlayTtsMessage: (message: ChatMessage) => void;
};

type OverviewWorkspaceProps = Pick<CompanionRightRailProps, "nextSteps" | "memoryNotes" | "dailyPodcast"> & {
  isPodcastPlaying: boolean;
  isPodcastRefreshing: boolean;
  podcastAudioLabel: string;
  podcastReady: boolean;
  podcastStatusLabel: string;
  onRefreshDailyPodcast: () => Promise<void> | void;
  onToggleDailyPodcastPlayback: () => Promise<void> | void;
};

function PlaceholderWorkspace({
  title,
  label,
  description,
  actionLabel,
}: {
  title: string;
  label: string;
  description: string;
  actionLabel: string;
}) {
  return (
    <article className="mio-card mio-workspace-card">
      <h2>
        {title} <small>{label}</small>
      </h2>
      <div className="mio-card-copy">
        <p>{description}</p>
        <p>Coming soon</p>
      </div>
      <button type="button">{actionLabel}</button>
    </article>
  );
}

function OverviewWorkspace({
  nextSteps,
  memoryNotes,
  dailyPodcast,
  isPodcastPlaying,
  isPodcastRefreshing,
  podcastAudioLabel,
  podcastReady,
  podcastStatusLabel,
  onRefreshDailyPodcast,
  onToggleDailyPodcastPlayback,
}: OverviewWorkspaceProps) {
  return (
    <>
      <article className="mio-card">
        <h2>
          <img src="/images/sprite-sliced/asset-013.png" alt="" />
          下一步建议 <small>NEXT STEPS</small>
        </h2>
        <div className="mio-card-copy">
          <ul className="mio-check-list">
            {nextSteps.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <button type="button">查看更多建议（6）</button>
      </article>

      <article className="mio-card">
        <h2>
          <img src="/images/sprite-sliced/asset-008.png" alt="" />
          记忆摘要 <small>MEMORY</small>
        </h2>
        <div className="mio-card-copy">
          {memoryNotes.map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
        <button type="button">查看完整记忆</button>
      </article>

      <article className="mio-card mio-podcast-card">
        <div className="mio-podcast-title-slot">
          <h2>
            <img src="/images/sprite-sliced/asset-022.png" alt="" />
            每日播客 <small>PODCAST</small>
          </h2>
          <button
            className="mio-podcast-refresh-slot"
            type="button"
            aria-label={isPodcastRefreshing ? "正在刷新每日播客" : "刷新每日播客"}
            aria-busy={isPodcastRefreshing}
            disabled={isPodcastRefreshing}
            onClick={() => void onRefreshDailyPodcast()}
            data-imagegen-slot="daily-podcast-refresh-icon"
            data-refreshing={isPodcastRefreshing ? "true" : "false"}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 7v5h-5" />
              <path d="M4 17v-5h5" />
              <path d="M6.1 9a7 7 0 0 1 11.5-2.3L20 9" />
              <path d="M17.9 15a7 7 0 0 1-11.5 2.3L4 15" />
            </svg>
          </button>
        </div>
        <div className="mio-card-copy mio-podcast-content-slot">
          <div className="mio-podcast-meta mio-podcast-meta-slot">
            <span>{podcastStatusLabel}</span>
            <strong>{dailyPodcast?.date || "--"}</strong>
            <small>{podcastAudioLabel}</small>
          </div>
          <div className="mio-podcast-play-slot">
            <button
              className="mio-podcast-play-icon-slot"
              type="button"
              aria-label={isPodcastPlaying ? "暂停今日播客" : "播放今日播客"}
              aria-pressed={isPodcastPlaying}
              disabled={!podcastReady}
              onClick={() => void onToggleDailyPodcastPlayback()}
              data-imagegen-slot="daily-podcast-play-icon"
            >
              {isPodcastPlaying ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 7v10" />
                  <path d="M15 7v10" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 5v14l11-7Z" />
                </svg>
              )}
            </button>
            <div className="mio-podcast-play-copy-slot">
              <strong>{podcastReady ? "今日播客" : "音频未就绪"}</strong>
              <span>{podcastReady ? "点击图标快速收听" : "生成完成后可播放"}</span>
            </div>
          </div>
        </div>
        <div className="mio-rail-podcast-actions">
          {dailyPodcast?.doc_url ? (
            <a className="mio-podcast-doc-slot" href={dailyPodcast.doc_url} target="_blank" rel="noreferrer">
              查看飞书文档
            </a>
          ) : (
            <span className="mio-podcast-doc-slot is-disabled">暂无飞书文档</span>
          )}
          <Link className="mio-podcast-list-slot" href="/podcasts">
            播客列表
          </Link>
        </div>
      </article>
    </>
  );
}

function PodcastAudioElement({
  audioRef,
  audioSource,
  podcastReady,
  onPlayingChange,
}: {
  audioRef: RefObject<HTMLAudioElement | null>;
  audioSource: string;
  podcastReady: boolean;
  onPlayingChange: (playing: boolean) => void;
}) {
  if (!podcastReady) return null;
  return (
    <audio
      ref={audioRef}
      className="mio-podcast-audio-slot"
      src={audioSource}
      preload="metadata"
      onPlay={() => onPlayingChange(true)}
      onPause={() => onPlayingChange(false)}
      onEnded={() => onPlayingChange(false)}
    />
  );
}

export function CompanionRightRail({
  collapsed,
  activeView,
  userId,
  sessions,
  activeSessionId,
  sessionBusy,
  messages,
  chatAutoScrollRevision,
  loading,
  error,
  ttsEnabled,
  activeTtsMessageId,
  nextSteps,
  memoryNotes,
  traceRows,
  dailyPodcast,
  onRefreshDailyPodcast,
  onBeforeAudioPlayback,
  onPodcastAudioStopReady,
  onToggleCollapsed,
  onCreateSession,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onPlayTtsMessage,
}: CompanionRightRailProps) {
  const podcastAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isPodcastPlaying, setIsPodcastPlaying] = useState(false);
  const [isPodcastRefreshing, setIsPodcastRefreshing] = useState(false);
  const workspaceClassName =
    activeView === "overview" ? "mio-right-rail-overview" : activeView === "chat" ? "mio-right-rail-chat" : "mio-right-rail-workspace";
  // <audio src> 无法携带请求头，身份用查询参数传给后端音频代理。
  const podcastAudioSource = dailyPodcast?.audio.url
    ? (() => {
        const base = makeUrl(dailyPodcast.audio.url);
        if (!userId) return base;
        return base + (base.includes("?") ? "&" : "?") + "user_id=" + encodeURIComponent(userId);
      })()
    : "";
  const podcastReady = dailyPodcast?.status === "ready" && Boolean(podcastAudioSource);
  const podcastStatusLabel =
    dailyPodcast?.status === "ready"
      ? "已就绪"
      : dailyPodcast?.status === "partial"
        ? "部分就绪"
        : dailyPodcast?.status === "failed"
          ? "生成失败"
          : dailyPodcast?.status === "missing"
            ? "暂无内容"
            : "检查中";
  const podcastAudioLabel = dailyPodcast?.audio.source ? `音频 ${dailyPodcast.audio.source.toUpperCase()}` : "暂无音频";

  const stopPodcastAudio = useCallback(() => {
    setIsPodcastPlaying(false);
    const audio = podcastAudioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  }, []);

  useEffect(() => {
    onPodcastAudioStopReady(stopPodcastAudio);
    return () => onPodcastAudioStopReady(null);
  }, [onPodcastAudioStopReady, stopPodcastAudio]);

  useEffect(() => {
    stopPodcastAudio();
  }, [podcastAudioSource, stopPodcastAudio]);

  async function handleToggleDailyPodcastPlayback() {
    const audio = podcastAudioRef.current;
    if (!podcastReady || !audio) return;

    if (audio.paused) {
      onBeforeAudioPlayback();
      if (audio.ended) audio.currentTime = 0;
      try {
        await audio.play();
      } catch {
        setIsPodcastPlaying(false);
      }
      return;
    }

    audio.pause();
  }

  async function handleRefreshDailyPodcast() {
    if (isPodcastRefreshing) return;
    setIsPodcastRefreshing(true);
    try {
      await onRefreshDailyPodcast();
    } finally {
      setIsPodcastRefreshing(false);
    }
  }

  return (
    <section
      className={`mio-right-rail ${workspaceClassName}${collapsed ? " is-collapsed" : ""}`}
      data-testid="mio-right-rail"
      aria-label="状态面板"
    >
      <PodcastAudioElement
        audioRef={podcastAudioRef}
        audioSource={podcastAudioSource}
        podcastReady={podcastReady}
        onPlayingChange={setIsPodcastPlaying}
      />
      <button
        className="mio-panel-toggle mio-panel-toggle-right"
        type="button"
        aria-label={collapsed ? "展开右侧面板" : "收起右侧面板"}
        aria-pressed={collapsed}
        onClick={onToggleCollapsed}
      >
        {collapsed ? "‹" : "›"}
      </button>

      {!collapsed ? (
        activeView === "overview" ? (
          <OverviewWorkspace
            nextSteps={nextSteps}
            memoryNotes={memoryNotes}
            dailyPodcast={dailyPodcast}
            isPodcastPlaying={isPodcastPlaying}
            isPodcastRefreshing={isPodcastRefreshing}
            podcastAudioLabel={podcastAudioLabel}
            podcastReady={podcastReady}
            podcastStatusLabel={podcastStatusLabel}
            onRefreshDailyPodcast={handleRefreshDailyPodcast}
            onToggleDailyPodcastPlayback={handleToggleDailyPodcastPlayback}
          />
        ) : activeView === "chat" ? (
          <CompanionChatbox
            sessions={sessions}
            activeSessionId={activeSessionId}
            sessionBusy={sessionBusy}
            messages={messages}
            autoScrollRevision={chatAutoScrollRevision}
            loading={loading}
            error={error}
            ttsEnabled={ttsEnabled}
            activeTtsMessageId={activeTtsMessageId}
            onCreateSession={onCreateSession}
            onSelectSession={onSelectSession}
            onRenameSession={onRenameSession}
            onDeleteSession={onDeleteSession}
            onPlayTtsMessage={onPlayTtsMessage}
          />
        ) : activeView === "tasks" ? (
          <CodexConsole userId={userId} localChatSessionId={activeSessionId} />
        ) : activeView === "tools" ? (
          <PlaceholderWorkspace
            title="工具面板"
            label="TOOLS"
            description="这里将承接工具调用记录、工具状态和 Trace 聚合信息。"
            actionLabel="查看工具状态"
          />
        ) : activeView === "memory" ? (
          <PlaceholderWorkspace
            title="记忆面板"
            label="MEMORY"
            description="这里将承接用户偏好、摘要记忆和长期上下文。"
            actionLabel="查看记忆详情"
          />
        ) : (
          <PlaceholderWorkspace
            title="能力面板"
            label="SKILLS"
            description="这里将承接技能列表、状态和推荐使用方式。"
            actionLabel="查看能力清单"
          />
        )
      ) : null}
    </section>
  );
}
