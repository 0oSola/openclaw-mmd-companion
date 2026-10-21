import { describe, expect, it } from "vitest";

import {
  WM_LBUTTONDOWN,
  WM_LBUTTONUP,
  WM_MOUSEMOVE,
  shouldStartNativeWindowDrag,
  shouldActivateNativeWindowDrag,
  shouldDispatchNativePetClick,
  hasNativeClickMoved,
  readNativeClientPoint,
} from "./nativeMouseInput";

describe("native Windows mouse input", () => {
  it("uses only the Win32 mouse messages needed for window dragging", () => {
    expect(WM_LBUTTONDOWN).toBe(0x0201);
    expect(WM_LBUTTONUP).toBe(0x0202);
    expect(WM_MOUSEMOVE).toBe(0x0200);
  });

  it("starts native window dragging only in window-drag mode", () => {
    expect(shouldStartNativeWindowDrag({ interactionMode: "window-drag" })).toBe(true);
    expect(shouldStartNativeWindowDrag({ interactionMode: "camera-adjust" })).toBe(false);
  });

  it("activates native dragging only after the pointer crosses the movement threshold", () => {
    expect(
      shouldActivateNativeWindowDrag({
        interactionMode: "window-drag",
        moved: false,
      }),
    ).toBe(false);
    expect(
      shouldActivateNativeWindowDrag({
        interactionMode: "window-drag",
        moved: true,
      }),
    ).toBe(true);
    expect(
      shouldActivateNativeWindowDrag({
        interactionMode: "camera-adjust",
        moved: true,
      }),
    ).toBe(false);
  });

  it("does not start native dragging while a context menu is active or just closed", () => {
    expect(
      shouldStartNativeWindowDrag({
        interactionMode: "window-drag",
        contextMenuActive: true,
        nowMs: 1000,
      }),
    ).toBe(false);
    expect(
      shouldStartNativeWindowDrag({
        interactionMode: "window-drag",
        contextMenuActive: false,
        lastContextMenuClosedAtMs: 900,
        nowMs: 1000,
      }),
    ).toBe(false);
    expect(
      shouldStartNativeWindowDrag({
        interactionMode: "window-drag",
        contextMenuActive: false,
        lastContextMenuClosedAtMs: 100,
        nowMs: 1000,
      }),
    ).toBe(true);
  });

  it("dispatches a stationary native click in both interaction modes", () => {
    expect(
      shouldDispatchNativePetClick({
        interactionMode: "window-drag",
        moved: false,
      }),
    ).toBe(true);
    expect(
      shouldDispatchNativePetClick({
        interactionMode: "camera-adjust",
        moved: false,
      }),
    ).toBe(true);
    expect(
      shouldDispatchNativePetClick({
        interactionMode: "window-drag",
        moved: true,
      }),
    ).toBe(false);
  });

  it("classifies native mouse movement with the same short-click threshold", () => {
    expect(
      hasNativeClickMoved({
        origin: { x: 100, y: 100 },
        current: { x: 104, y: 103 },
      }),
    ).toBe(false);
    expect(
      hasNativeClickMoved({
        origin: { x: 100, y: 100 },
        current: { x: 107, y: 100 },
      }),
    ).toBe(true);
  });

  it("decodes signed client coordinates from Win32 mouse message lParam", () => {
    const lParam = Buffer.alloc(4);
    lParam.writeInt16LE(-12, 0);
    lParam.writeInt16LE(34, 2);

    expect(readNativeClientPoint(lParam)).toEqual({ x: -12, y: 34 });
  });
});
