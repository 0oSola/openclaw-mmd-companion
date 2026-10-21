import { describe, expect, it } from "vitest";

import { buildApprovalFallback } from "./approvalFallback";

describe("Codex approval fallback", () => {
  it("returns no approval action when Codex is not waiting for approval", () => {
    expect(buildApprovalFallback({ state: "running" }, "medium")).toBeNull();
  });

  it("makes waiting approval actionable by focusing the Codex session", () => {
    const fallback = buildApprovalFallback(
      {
        state: "waiting_approval",
        sessionTitle: "npm install",
        workspacePath: "D:\\workspace\\MMD project",
      },
      "medium",
    );

    expect(fallback).toMatchObject({
      canApprove: false,
      canDeny: false,
      primaryAction: {
        type: "focus-codex-session",
        label: "Open Codex session",
      },
      limitationCode: "scanner-missing-approval-id",
    });
    expect(fallback?.message).toBe(
      "Codex needs approval · npm install · Open the Codex session to approve or deny the pending request.",
    );
    expect(fallback?.limitation).toContain("JSONL scanner does not expose an approval id");
  });

});
