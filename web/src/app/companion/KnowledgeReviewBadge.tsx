"use client";

import { useEffect, useRef, useState } from "react";

type ReviewSummary = {
  workspace_key: string | null;
  total: number;
  pending: number;
  by_status: Record<string, number>;
};

const POLL_INTERVAL_MS = 30_000;

function backendUrl(path: string): string {
  return `/api/backend${path.startsWith("/") ? path : `/${path}`}`;
}

export function KnowledgeReviewBadge({ userId }: { userId: string }) {
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [error, setError] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      if (!userId) return;
      try {
        const response = await fetch(backendUrl("/codex/knowledge/review-summary"), {
          headers: { "x-user-id": userId },
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = (await response.json()) as ReviewSummary;
        if (!cancelled) {
          setSummary(data);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }

    void refresh();
    timerRef.current = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [userId]);

  if (!summary || error) return null;

  const pending = summary.pending;
  const needsEvidence = summary.by_status.needs_evidence ?? 0;
  const claimed = summary.by_status.claimed ?? 0;

  return (
    <div
      className={`mio-knowledge-badge${pending > 0 ? " has-pending" : ""}`}
      title={`知识审核队列：待审核 ${pending}，已认领 ${claimed}，需补充证据 ${needsEvidence}`}
      aria-label={`知识审核队列：待审核 ${pending} 条`}
    >
      <span className="mio-knowledge-badge-label">KNOWLEDGE</span>
      <strong className="mio-knowledge-badge-count">{pending}</strong>
    </div>
  );
}
