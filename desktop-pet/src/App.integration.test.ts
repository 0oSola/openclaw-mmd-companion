import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Desktop Pet App integration wiring", () => {
  it("uses Codex status helpers for notification detail, approval fallback, and MMD status motion", () => {
    const source = readFileSync(path.resolve(__dirname, "App.tsx"), "utf8");

    expect(source).toContain("formatCodexStatusNotification");
    expect(source).toContain("buildCodexStatusCard");
    expect(source).toContain("buildApprovalFallback");
    expect(source).toContain("getCodexStatusPresentation");
    expect(source).toContain("buildCodexStatusPetStageResolution");
    expect(source).toContain("codexStatusInteraction");
    expect(source).toContain("approvalFallback");
  });

  it("renders Codex status output as a clickable Codex session focus target", () => {
    const source = readFileSync(path.resolve(__dirname, "App.tsx"), "utf8");
    const styles = readFileSync(path.resolve(__dirname, "styles.css"), "utf8");

    expect(source).toContain("visibleCodexStatusCard.outputLines");
    expect(source).toContain("buildIdleCodexStatusCardFallback");
    expect(source).toContain("const visibleCodexStatusCard = codexStatusCard ?? idleCodexStatusCard");
    expect(source).toContain("data-status-tone={codexStatusPresentation.statusTone}");
    expect(source).toContain('data-codex-card={visibleCodexStatusCard && !menuStatus ? "true" : "false"}');
    expect(source).toContain("focusCodexForStatus");
    expect(source).toContain("workspacePath: codexStatus?.workspacePath");
    expect(source).toContain("pet-status-output");
    expect(styles).toContain('.pet-status[data-codex-card="true"] .pet-status-title');
    expect(styles).toContain("position: absolute;");
    expect(styles).toContain('content: "";');
    expect(styles).toContain('.pet-status[data-status-tone="attention"] .pet-status-dot');
  });

  it("keeps completion notices outside the Pet renderer", () => {
    const source = readFileSync(path.resolve(__dirname, "App.tsx"), "utf8");
    const styles = readFileSync(path.resolve(__dirname, "styles.css"), "utf8");

    expect(source).not.toContain("pet-completion-bubble");
    expect(source).not.toContain("resolveLatchedCodexCompletionNotice");
    expect(styles).not.toContain(".pet-completion-bubble");
  });

  it("wraps long Codex status output instead of truncating it to a single line", () => {
    const styles = readFileSync(path.resolve(__dirname, "styles.css"), "utf8");
    const outputBlock = styles.match(/\.pet-status-output\s*\{[\s\S]*?\}/)?.[0] ?? "";
    const outputLineBlock = styles.match(/\.pet-status-output span\s*\{[\s\S]*?\}/)?.[0] ?? "";

    expect(outputBlock).toContain("max-height:");
    expect(outputBlock).toContain("overflow: hidden;");
    expect(outputLineBlock).toContain("white-space: normal;");
    expect(outputLineBlock).toContain("overflow-wrap: anywhere;");
    expect(outputLineBlock).not.toContain("text-overflow: ellipsis;");
    expect(outputLineBlock).not.toContain("white-space: nowrap;");
  });

  it("clears the Codex focus toast after a successful focus request", () => {
    const source = readFileSync(path.resolve(__dirname, "App.tsx"), "utf8");

    expect(source).toContain("showFocusSuccess");
    expect(source.match(/\.then\(showFocusSuccess\)/g)?.length).toBe(3);
    expect(source).toContain('setMenuStatus("Codex session open")');
  });

  it("routes status and approval clicks through the target-aware Codex session focus IPC", () => {
    const source = readFileSync(path.resolve(__dirname, "App.tsx"), "utf8");
    const statusAndApprovalBlock = source.slice(
      source.indexOf("const focusCodexForApproval"),
      source.indexOf("const codexStatusText"),
    );

    expect(statusAndApprovalBlock).toContain("window.desktopPet?.codex?.focus?.(");
    expect(statusAndApprovalBlock).not.toContain("window.desktopPet?.vscode?.focus?.(");
    expect(statusAndApprovalBlock).toContain("codexSessionId: codexStatus?.codexSessionId");
  });

  it("focuses active sessions from the bottom dialog instead of restoring a duplicate window", () => {
    const source = readFileSync(path.resolve(__dirname, "App.tsx"), "utf8");

    expect(source).toContain("focusActiveSessionFromPanel");
    expect(source).toContain("window.desktopPet?.sessions?.focusActive");
    expect(source).toContain("item.isActive ? focusActiveSessionFromPanel(item.petSessionId) : restoreSessionFromPanel(item.petSessionId)");
  });

  it("observes API runtime status and retries MMD state loading when API becomes available", () => {
    const source = readFileSync(path.resolve(__dirname, "App.tsx"), "utf8");

    expect(source).toContain("apiRuntimeStatus");
    expect(source).toContain("onChanged((status) =>");
    expect(source).toContain("if (status?.available) loadPetState();");
    expect(source).toContain("retryApiRuntime");
    expect(source).toContain("API unavailable");
  });

  it("wires explicit main-site sync to reload shared MMD config and remount the stage", () => {
    const source = readFileSync(path.resolve(__dirname, "App.tsx"), "utf8");

    expect(source).toContain('action.type === "sync-main-site"');
    expect(source).toContain("loadPetState({ syncFeedback: true })");
    expect(source).toContain("setStageReloadRevision((revision) => revision + 1)");
  });

  it("starts and recovers the MMD stage through the pet autoplay idle state", () => {
    const source = readFileSync(path.resolve(__dirname, "App.tsx"), "utf8");

    expect(source).toContain("buildPetAutoplayIdleState");
    expect(source).toContain("petAutoplayIdleState");
    expect(source).toContain("setStageInteractionState(petAutoplayIdleState)");
    expect(source).toContain("buildPetStageClickInteractionState(clickAction)");
    expect(source).toContain('stageInteractionState.source === "stage-click"');
  });

  it("replays active Codex status motions when a procedural status action completes", () => {
    const source = readFileSync(path.resolve(__dirname, "App.tsx"), "utf8");

    expect(source).toContain("shouldReplayCodexStatusMotionOnCompletion");
    expect(source).toContain("codexStatusMotionReplayRevision");
    expect(source).toContain("setCodexStatusMotionReplayRevision");
  });

  it("falls back to the favorite idle loop when a Codex status motion has no playable hit", () => {
    const source = readFileSync(path.resolve(__dirname, "App.tsx"), "utf8");

    expect(source).toContain("resolvePetStageInteractionWithFallback");
    expect(source).toContain("fallbackResult.interaction");
    expect(source).toContain("petAutoplayIdleState.interaction");
    expect(source).toContain("if (!fallbackResult.interaction) return null");
  });

  it("keeps stage click hit and motion selection wired to shared main-site helpers", () => {
    const source = readFileSync(path.resolve(__dirname, "App.tsx"), "utf8");
    const petStageState = readFileSync(path.resolve(__dirname, "mmd", "petStageState.ts"), "utf8");

    expect(source).toContain("shouldTriggerStageCharacterClick");
    expect(source).toContain("createStageClickRipple");
    expect(source).not.toContain("handlePetInputSurfaceClick");
    expect(source).not.toContain("onClick={handlePetInputSurfaceClick}");
    expect(petStageState).toContain('from "@/features/stage/stageCharacterClick.js"');
    expect(petStageState).toContain("resolveStageCharacterClickInteraction({");
  });

  it("defines a stationary click as an action and leaves movement to window/camera interaction", () => {
    const source = readFileSync(path.resolve(__dirname, "App.tsx"), "utf8");

    expect(source).toContain("nativeClick?.on");
    expect(source).toContain("shouldTriggerStageCharacterClick");
    expect(source).toContain("hasPetPointerMoved");
    expect(source).toContain("shouldActivatePetWindowDrag");
    expect(source).toContain("interactionMode !== \"camera-adjust\"");
    expect(source).toContain("enableCharacterClickCapture={false}");

    const pointerDownBlock = source.slice(
      source.indexOf("function handlePointerDown"),
      source.indexOf("function handlePointerMove"),
    );
    expect(pointerDownBlock).not.toContain("windowDrag?.start");
  });

  it("keeps the right-click menu out of the MMD renderer", () => {
    const source = readFileSync(path.resolve(__dirname, "App.tsx"), "utf8");

    expect(source).not.toContain("window.desktopPet?.menu?.onShow");
    expect(source).not.toContain("pet-context-menu");
    expect(source).toContain('closest(".pet-panel, .pet-status-action")');
  });

  it("provides a camera-mode save and exit button without routing its click into stage actions", () => {
    const source = readFileSync(path.resolve(__dirname, "App.tsx"), "utf8");
    const styles = readFileSync(path.resolve(__dirname, "styles.css"), "utf8");

    expect(source).toContain('interactionMode === "camera-adjust"');
    expect(source).toContain('data-testid="pet-camera-save-exit"');
    expect(source).toContain("handleSaveAndExitCamera");
    expect(source).toContain('setInteractionMode("window-drag")');
    expect(source).toContain('interactionMode?.set("window-drag")');
    expect(source).toContain(".pet-camera-save-exit");
    expect(styles).toContain("z-index: 13;");
    expect(styles).toContain("-webkit-app-region: no-drag;");
  });

  it("persists the current camera snapshot before the renderer unloads", () => {
    const source = readFileSync(path.resolve(__dirname, "App.tsx"), "utf8");

    expect(source).toContain("persistCurrentPetCameraSnapshot");
    expect(source).toContain('window.addEventListener("beforeunload"');
    expect(source).toContain("savePetCameraSnapshot");
    expect(source).toContain("captureCamera");
  });

  it("suppresses the renderer context menu while camera adjustment is active", () => {
    const source = readFileSync(path.resolve(__dirname, "App.tsx"), "utf8");

    expect(source).toContain('document.addEventListener("contextmenu"');
    expect(source).toContain("event.preventDefault()");
    expect(source).toContain('interactionMode !== "camera-adjust"');
  });
});
