import { type FormEvent, useEffect, useState } from "react";

import { completionNoticeSummary } from "../electron/completionNoticeWindow";

type CompletionNoticeWindowState = NonNullable<
  Awaited<ReturnType<typeof window.desktopPet.completionNotice.status.get>>
>;
type CompletionNotice = CompletionNoticeWindowState["notices"][number];
type CompletionNoticeActionResult = Awaited<
  ReturnType<typeof window.desktopPet.completionNotice.restore>
>;

type CompletionNoticeAction = "restore" | "stop" | "follow-up";

type CompletionNoticeFeedback = {
  kind: "info" | "pending" | "success" | "error";
  message: string;
  pendingAction?: CompletionNoticeAction;
};

function stopCardFocus(event: { stopPropagation: () => void }): void {
  event.stopPropagation();
}

function actionSucceeded(result: CompletionNoticeActionResult): boolean {
  return result === true || (typeof result === "object" && result !== null && result.ok === true);
}

function actionFailureMessage(
  result: CompletionNoticeActionResult,
  fallback: string,
): string {
  if (typeof result === "object" && result !== null) {
    return result.message || fallback;
  }
  return fallback;
}

export function CompletionNoticeWindow() {
  const [state, setState] = useState<CompletionNoticeWindowState | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [feedbackByKey, setFeedbackByKey] = useState<Record<string, CompletionNoticeFeedback>>({});

  useEffect(() => {
    let mounted = true;
    window.desktopPet.completionNotice.status.get().then((next) => {
      if (mounted) setState(next);
    }).catch(() => {});
    return window.desktopPet.completionNotice.status.onChanged((next) => setState(next));
  }, []);

  const setFeedback = (key: string, feedback: CompletionNoticeFeedback) => {
    setFeedbackByKey((current) => ({ ...current, [key]: feedback }));
  };

  const handleRestore = async (key: string) => {
    setFeedback(key, {
      kind: "pending",
      message: "正在请求恢复任务…",
      pendingAction: "restore",
    });

    try {
      const result = await window.desktopPet.completionNotice.restore(key);
      setFeedback(
        key,
        actionSucceeded(result)
          ? { kind: "success", message: "已请求恢复任务" }
          : {
              kind: "error",
              message: actionFailureMessage(result, "恢复任务未成功"),
            },
      );
    } catch {
      setFeedback(key, { kind: "error", message: "恢复任务失败" });
    }
  };

  const handleStop = async (key: string) => {
    setFeedback(key, {
      kind: "pending",
      message: "正在请求停止任务…",
      pendingAction: "stop",
    });

    try {
      const result = await window.desktopPet.completionNotice.stop(key);
      setFeedback(
        key,
        actionSucceeded(result)
          ? { kind: "success", message: "已请求停止任务" }
          : {
              kind: "error",
              message: actionFailureMessage(result, "停止任务未成功"),
            },
      );
    } catch {
      setFeedback(key, { kind: "error", message: "停止任务失败" });
    }
  };

  const handleFollowUpSubmit = async (
    event: FormEvent<HTMLFormElement>,
    notice: CompletionNotice,
  ) => {
    event.preventDefault();
    stopCardFocus(event);
    const prompt = (drafts[notice.key] ?? "").trim();
    if (!prompt) return;

    setFeedback(notice.key, {
      kind: "pending",
      message: "正在发送继续跟进…",
      pendingAction: "follow-up",
    });

    try {
      const result = await window.desktopPet.prompt.sendToSession({
        workspacePath: notice.workspacePath,
        codexSessionId: notice.codexSessionId,
        petSessionId: notice.petSessionId,
        prompt,
      });
      if (actionSucceeded(result)) {
        setDrafts((current) => ({ ...current, [notice.key]: "" }));
        const mode =
          typeof result === "object" && result !== null && "mode" in result
            ? result.mode
            : undefined;
        setFeedback(notice.key, {
          kind: "success",
          message: mode === "copy-only" ? "已复制继续跟进命令" : "已发送继续跟进",
        });
      } else {
        setFeedback(notice.key, {
          kind: "error",
          message: actionFailureMessage(result, "继续跟进未发送"),
        });
      }
    } catch {
      setFeedback(notice.key, { kind: "error", message: "继续跟进发送失败" });
    }
  };

  const notices = state?.notices ?? [];
  if (!notices.length) return null;
  const expanded = state?.expanded ?? false;
  const visibleNotices = notices.slice(-3);
  const latestNotice = visibleNotices[visibleNotices.length - 1];

  return (
    <main
      className={`completion-notice-stack ${expanded ? "is-expanded" : ""}`}
      role="status"
      aria-live="polite"
      aria-label={`${notices.length} 个已完成任务通知`}
      data-testid="completion-notice-stack"
    >
      {(expanded ? visibleNotices : [latestNotice]).map((notice) => (
        <article
          className={`completion-notice ${expanded ? "completion-notice-card" : "completion-notice-aggregate"}`}
          key={notice.key}
          data-testid={`completion-notice-${expanded ? "card" : "aggregate"}-${notice.key}`}
        >
          <button
            className="completion-notice-body"
            type="button"
            title={notice.title}
            aria-label={`聚焦已完成任务：${notice.workspaceLabel}`}
            data-testid={`completion-notice-focus-${notice.key}`}
            onClick={() =>
              void window.desktopPet.codex.focus({
                workspacePath: notice.workspacePath,
                codexSessionId: notice.codexSessionId,
                source: "completion",
              })
            }
          >
            <span className="completion-notice-title">{notice.title}</span>
            {notice.taskLabel ? (
              <span className="completion-notice-task">任务：{notice.taskLabel}</span>
            ) : null}
            {!expanded ? (
              <span className="completion-notice-summary">{completionNoticeSummary(notice)}</span>
            ) : null}
            {expanded
              ? notice.outputLines.slice(0, 1).map((line, index) => (
                  <span className="completion-notice-output" key={`${index}-${line}`}>
                    {line}
                  </span>
                ))
              : null}
            {!expanded ? (
              <span className="completion-notice-count">{notices.length} 个已完成任务</span>
            ) : null}
          </button>
          <div className="completion-notice-actions">
            {(!expanded || notice.key === latestNotice.key) ? (
              <button
                type="button"
                className="completion-notice-toggle"
                aria-label={expanded ? "收起已完成任务通知" : "展开已完成任务通知"}
                data-testid="completion-notice-toggle"
                onPointerDown={stopCardFocus}
                onClick={(event) => {
                  stopCardFocus(event);
                  void (expanded
                    ? window.desktopPet.completionNotice.collapse()
                    : window.desktopPet.completionNotice.expand());
                }}
              >
                {expanded ? "−" : "+"}
              </button>
            ) : null}
            <button
              type="button"
              className="completion-notice-dismiss"
              aria-label={`关闭已完成任务通知：${notice.workspaceLabel}`}
              data-testid={`completion-notice-dismiss-${notice.key}`}
              onPointerDown={stopCardFocus}
              onClick={(event) => {
                stopCardFocus(event);
                void window.desktopPet.completionNotice.dismiss(notice.key);
              }}
            >
              ×
            </button>
          </div>
          {expanded ? (
            <div className="completion-notice-details">
              <div className="completion-notice-task-actions">
                <button
                  type="button"
                  className="completion-notice-task-action completion-notice-restore"
                  aria-label={`继续或恢复任务：${notice.workspaceLabel}`}
                  data-testid={`completion-notice-restore-${notice.key}`}
                  disabled={feedbackByKey[notice.key]?.pendingAction === "restore"}
                  onPointerDown={stopCardFocus}
                  onClick={(event) => {
                    stopCardFocus(event);
                    void handleRestore(notice.key);
                  }}
                >
                  继续/恢复任务
                </button>
                <button
                  type="button"
                  className={`completion-notice-task-action completion-notice-stop${
                    notice.stopSupported ? "" : " is-unsupported"
                  }`}
                  aria-label={
                    notice.stopSupported
                      ? `停止任务：${notice.workspaceLabel}`
                      : `当前任务不支持停止：${notice.workspaceLabel}`
                  }
                  title={notice.stopSupported ? "停止任务" : "当前运行模式不支持自动停止"}
                  data-testid={`completion-notice-stop-${notice.key}`}
                  aria-disabled={!notice.stopSupported}
                  disabled={feedbackByKey[notice.key]?.pendingAction === "stop"}
                  onPointerDown={stopCardFocus}
                  onClick={(event) => {
                    stopCardFocus(event);
                    void handleStop(notice.key);
                  }}
                >
                  停止任务
                </button>
              </div>
              <form
                className="completion-notice-follow-up"
                aria-label={`继续跟进：${notice.workspaceLabel}`}
                data-testid={`completion-notice-follow-up-${notice.key}`}
                onPointerDown={stopCardFocus}
                onClick={stopCardFocus}
                onSubmit={(event) => void handleFollowUpSubmit(event, notice)}
              >
                <label htmlFor={`completion-notice-follow-up-${notice.key}`}>
                  继续跟进
                </label>
                <div className="completion-notice-follow-up-row">
                  <input
                    id={`completion-notice-follow-up-${notice.key}`}
                    type="text"
                    value={drafts[notice.key] ?? ""}
                    placeholder="继续跟进"
                    aria-label={`继续跟进：${notice.workspaceLabel}`}
                    data-testid={`completion-notice-follow-up-input-${notice.key}`}
                    onPointerDown={stopCardFocus}
                    onClick={stopCardFocus}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [notice.key]: event.target.value,
                      }))
                    }
                  />
                  <button
                    type="submit"
                    className="completion-notice-follow-up-send"
                    aria-label={`发送继续跟进：${notice.workspaceLabel}`}
                    data-testid={`completion-notice-follow-up-send-${notice.key}`}
                    disabled={
                      feedbackByKey[notice.key]?.pendingAction === "follow-up" ||
                      !(drafts[notice.key] ?? "").trim()
                    }
                    onPointerDown={stopCardFocus}
                    onClick={stopCardFocus}
                  >
                    发送
                  </button>
                </div>
              </form>
              {feedbackByKey[notice.key]?.message ? (
                <span
                  className={`completion-notice-feedback is-${feedbackByKey[notice.key]?.kind}`}
                  role={feedbackByKey[notice.key]?.kind === "error" ? "alert" : "status"}
                >
                  {feedbackByKey[notice.key]?.message}
                </span>
              ) : null}
            </div>
          ) : null}
        </article>
      ))}
    </main>
  );
}
