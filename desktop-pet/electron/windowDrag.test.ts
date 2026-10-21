import { describe, expect, it } from "vitest";

import {
  calculateEndedWindowDragBounds,
  calculateDraggedWindowBounds,
  calculateDraggedWindowPosition,
  shouldAcceptWindowDragStart,
  shouldApplyWindowDragMove,
} from "./windowDrag.js";

describe("desktop pet window drag", () => {
  it("moves the window by the cursor delta from drag start", () => {
    expect(
      calculateDraggedWindowPosition({
        originBounds: { x: 120, y: 80, width: 320, height: 420 },
        originCursor: { x: 500, y: 300 },
        currentCursor: { x: 545, y: 275 },
      }),
    ).toEqual({ x: 165, y: 55 });
  });

  it("preserves the original window size while moving", () => {
    expect(
      calculateDraggedWindowBounds({
        originBounds: { x: 120, y: 80, width: 320, height: 420 },
        originCursor: { x: 500, y: 300 },
        currentCursor: { x: 545, y: 275 },
      }),
    ).toEqual({ x: 165, y: 55, width: 320, height: 420 });
  });

  it("does not let a second drag source replace the active drag origin", () => {
    expect(shouldAcceptWindowDragStart(undefined, "ipc")).toBe(true);
    expect(shouldAcceptWindowDragStart("ipc", "native")).toBe(false);
    expect(shouldAcceptWindowDragStart("native", "ipc")).toBe(false);
  });

  it("applies movement only from the source that owns the active drag", () => {
    expect(shouldApplyWindowDragMove("ipc", "ipc")).toBe(true);
    expect(shouldApplyWindowDragMove("ipc", "native")).toBe(false);
    expect(shouldApplyWindowDragMove("native", "native")).toBe(true);
    expect(shouldApplyWindowDragMove("native", "ipc")).toBe(false);
  });

  it("keeps the current size when drag ends after an edge resize changed the window", () => {
    expect(
      calculateEndedWindowDragBounds({
        currentBounds: { x: 736, y: 282, width: 322, height: 420 },
        originBounds: { x: 693, y: 246, width: 321, height: 420 },
      }),
    ).toEqual({ x: 736, y: 282, width: 322, height: 420 });
  });
});
