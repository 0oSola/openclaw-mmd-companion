export type CodexCompletionObservation = {
  state: string;
  codexSessionId?: string | null;
  eventAt?: string | null;
};

export type CodexCompletionObserveOptions = {
  allowFirstCompletion?: boolean;
};

type SessionCompletionState = {
  lastState: string;
  eventAt?: string;
  noticeKey?: string;
};

function compactText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function codexCompletionNoticeKey(
  codexSessionId: string | null | undefined,
  eventAt?: string | null,
): string | undefined {
  const sessionId = compactText(codexSessionId);
  if (!sessionId) return undefined;
  const completionEventAt = compactText(eventAt);
  return completionEventAt ? `${sessionId}:${completionEventAt}` : sessionId;
}

export function createCodexCompletionTracker() {
  const sessions = new Map<string, SessionCompletionState>();

  return {
    observe(
      observation: CodexCompletionObservation,
      options: CodexCompletionObserveOptions = {},
    ): string | undefined {
      const sessionId = compactText(observation.codexSessionId);
      if (!sessionId) return undefined;

      const state = compactText(observation.state) || "running";
      const eventAt = compactText(observation.eventAt) || undefined;
      const previous = sessions.get(sessionId);

      if (state !== "completed") {
        sessions.set(sessionId, {
          lastState: state,
          eventAt: previous?.eventAt,
          noticeKey: previous?.noticeKey,
        });
        return undefined;
      }

      const occurrenceKey = codexCompletionNoticeKey(sessionId, eventAt);
      if (!occurrenceKey) return undefined;

      let noticeKey: string | undefined;
      if (!previous) {
        // A completed session first seen during startup/menu refresh is history,
        // not a new transition. A newly launched watcher can opt in so a task
        // that finishes before its first poll still produces one notice.
        noticeKey = options.allowFirstCompletion ? occurrenceKey : undefined;
      } else if (previous.lastState !== "completed") {
        noticeKey = occurrenceKey;
      } else {
        const isNewTimedOccurrence = Boolean(eventAt && previous.eventAt && previous.eventAt !== eventAt);
        if (options.allowFirstCompletion && isNewTimedOccurrence) {
          // A watcher starting on a resumed session may only observe the new
          // completed occurrence, without seeing the intervening running state.
          noticeKey = occurrenceKey;
        } else {
          // Re-publishing completed must preserve an already-issued key even
          // if a trailing JSONL event nudges last_event_at. A watcher may also
          // promote a completion that background refresh treated as history.
          noticeKey = previous.noticeKey ?? (options.allowFirstCompletion ? occurrenceKey : undefined);
        }
      }

      sessions.set(sessionId, {
        lastState: state,
        eventAt: eventAt ?? previous?.eventAt,
        noticeKey,
      });
      return noticeKey;
    },

    reset() {
      sessions.clear();
    },
  };
}
