"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getLatestDailyPodcast, listDailyPodcasts } from "@/lib/api";
import { loadSession } from "@/lib/session";
import type { DailyPodcast, UserSession } from "@/lib/types";

import { PodcastWaveform } from "./PodcastWaveform";

type ExpandedRows = Record<string, boolean>;

function statusLabel(podcast: DailyPodcast | null): string {
  return podcast?.status || "missing";
}

function audioLabel(podcast: DailyPodcast | null): string {
  if (!podcast?.audio?.source) return "no audio";
  return `${podcast.audio.source.toUpperCase()} ${podcast.audio.bytes ? `${Math.round(podcast.audio.bytes / 1024)} KB` : ""}`.trim();
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  if (!entries.length) return "No counts";
  return entries.map(([key, value]) => `${key}: ${value}`).join(" / ");
}

export default function PodcastsPage() {
  const [session, setSession] = useState<UserSession | null>(null);
  const [latestPodcast, setLatestPodcast] = useState<DailyPodcast | null>(null);
  const [items, setItems] = useState<DailyPodcast[]>([]);
  const [selectedPodcast, setSelectedPodcast] = useState<DailyPodcast | null>(null);
  const [expandedRows, setExpandedRows] = useState<ExpandedRows>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSession(loadSession());
  }, []);

  const loadPodcasts = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError("");
    try {
      const [latest, items] = await Promise.all([
        getLatestDailyPodcast(session.userId),
        listDailyPodcasts(session.userId, 30),
      ]);
      setLatestPodcast(latest);
      setItems(items);
      setSelectedPodcast((current) => current || latest);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void loadPodcasts();
  }, [loadPodcasts]);

  const activePodcast = selectedPodcast || latestPodcast;
  const docLinks = useMemo(() => Object.entries(activePodcast?.doc_links || {}), [activePodcast]);

  if (!session) {
    return (
      <main className="podcast-page">
        <section className="podcast-empty-panel">
          <p>No local session is active.</p>
          <Link href="/">Open start page</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="podcast-page">
      <header className="podcast-page-header">
        <div>
          <span>Daily Audio Briefing</span>
          <h1>Daily Podcast</h1>
        </div>
        <nav>
          <Link href="/companion">Companion</Link>
          <button type="button" onClick={() => void loadPodcasts()} disabled={loading}>
            {loading ? "Refreshing" : "Refresh"}
          </button>
        </nav>
      </header>

      {error ? <p className="podcast-error">{error}</p> : null}

      <section className="podcast-layout">
        <section className="podcast-now-panel" aria-label="Latest Daily Podcast">
          <div className="podcast-section-head">
            <div>
              <span>Latest</span>
              <h2>{activePodcast?.date || "--"}</h2>
            </div>
            <div className="podcast-status-strip">
              <span data-status={statusLabel(activePodcast)}>{statusLabel(activePodcast)}</span>
              <strong>{audioLabel(activePodcast)}</strong>
            </div>
          </div>

          <PodcastWaveform
            audioUrl={activePodcast?.audio.url || null}
            format={activePodcast?.audio.format || null}
            title={`Daily Podcast ${activePodcast?.date || ""}`.trim()}
            userId={session?.userId || ""}
          />

          <div className="podcast-meta-grid">
            <div>
              <span>Script</span>
              <strong>{activePodcast?.script_chars ? `${activePodcast.script_chars} chars` : "--"}</strong>
            </div>
            <div>
              <span>Updated</span>
              <strong>{activePodcast?.updated_at || "--"}</strong>
            </div>
            <div>
              <span>Counts</span>
              <strong>{formatCounts(activePodcast?.counts || {})}</strong>
            </div>
          </div>

          <div className="podcast-doc-actions">
            {activePodcast?.doc_url ? (
              <a href={activePodcast.doc_url} target="_blank" rel="noreferrer">
                Feishu Doc
              </a>
            ) : (
              <span>No Feishu Doc</span>
            )}
            {docLinks.map(([label, url]) => (
              <a key={`${label}-${url}`} href={url} target="_blank" rel="noreferrer">
                {label}
              </a>
            ))}
          </div>
        </section>

        <section className="podcast-history-panel" aria-label="Recent Daily Podcasts">
          <div className="podcast-section-head">
            <div>
              <span>Recent 30 Days</span>
              <h2>{items.length.toString().padStart(2, "0")} Ready Entries</h2>
            </div>
          </div>

          <div className="podcast-history-list">
            {items.length === 0 && !loading ? <p className="podcast-empty-copy">No podcast entries found.</p> : null}
            {items.map((podcast) => {
              const expanded = Boolean(expandedRows[podcast.date]);
              return (
                <article key={podcast.date} className="podcast-history-row">
                  <button type="button" className="podcast-history-main" onClick={() => setSelectedPodcast(podcast)}>
                    <span>{podcast.date}</span>
                    <strong>{podcast.status}</strong>
                    <small>{audioLabel(podcast)}</small>
                  </button>
                  <button
                    type="button"
                    className="podcast-history-expand"
                    aria-expanded={expanded}
                    onClick={() => setExpandedRows((current) => ({ ...current, [podcast.date]: !expanded }))}
                  >
                    {expanded ? "Close" : "Details"}
                  </button>
                  {expanded ? (
                    <div className="podcast-history-details">
                      <p>{formatCounts(podcast.counts)}</p>
                      <p>Script chars: {podcast.script_chars || "--"}</p>
                      {podcast.audio_error ? <p>Audio error: {podcast.audio_error}</p> : null}
                      <div>
                        {Object.entries(podcast.doc_links).map(([label, url]) => (
                          <a key={`${podcast.date}-${label}`} href={url} target="_blank" rel="noreferrer">
                            {label}
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      </section>
    </main>
  );
}
