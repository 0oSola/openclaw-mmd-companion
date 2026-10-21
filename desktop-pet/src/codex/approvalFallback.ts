import type { CodexStatus } from "./codexStatus";
import type { NotificationDetailLevel } from "./notificationDetail";
import { formatCodexStatusNotification } from "./notificationDetail";

export type ApprovalFallback = {
  canApprove: false;
  canDeny: false;
  primaryAction: {
    type: "focus-codex-session";
    label: "Open Codex session";
  };
  message: string;
  limitation: string;
  limitationCode: "scanner-missing-approval-id";
};

export function buildApprovalFallback(
  status: CodexStatus | null | undefined,
  detailLevel: NotificationDetailLevel,
): ApprovalFallback | null {
  if (!status || status.state !== "waiting_approval") return null;

  const message = `${formatCodexStatusNotification(status, detailLevel) ?? "Codex needs approval"} · Open the Codex session to approve or deny the pending request.`;
  return {
    canApprove: false,
    canDeny: false,
    primaryAction: {
      type: "focus-codex-session",
      label: "Open Codex session",
    },
    message,
    limitation: "The local JSONL scanner does not expose an approval id, so Desktop Pet cannot submit approve or deny decisions.",
    limitationCode: "scanner-missing-approval-id",
  };
}
