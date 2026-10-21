import { describe, expect, it } from "vitest";

import {
  hasPetPointerMoved,
  shouldActivatePetWindowDrag,
  shouldStartPetWindowDrag,
  shouldStopPetWindowDragPropagation,
} from "./petWindowEvents";

describe("desktop pet window event routing", () => {
  it("starts window dragging only for left pointer down in whole-window drag mode", () => {
    expect(shouldStartPetWindowDrag({ interactionMode: "window-drag", button: 0 })).toBe(true);
    expect(shouldStartPetWindowDrag({ interactionMode: "window-drag", button: 2 })).toBe(false);
    expect(shouldStartPetWindowDrag({ interactionMode: "camera-adjust", button: 0 })).toBe(false);
  });

  it("waits for movement before activating whole-window dragging", () => {
    expect(
      shouldActivatePetWindowDrag({
        interactionMode: "window-drag",
        button: 0,
        moved: false,
      }),
    ).toBe(false);
    expect(
      shouldActivatePetWindowDrag({
        interactionMode: "window-drag",
        button: 0,
        moved: true,
      }),
    ).toBe(true);
    expect(
      shouldActivatePetWindowDrag({
        interactionMode: "camera-adjust",
        button: 0,
        moved: true,
      }),
    ).toBe(false);
  });

  it("uses six pixels as the boundary between a click and a drag", () => {
    expect(hasPetPointerMoved({ origin: { x: 10, y: 10 }, current: { x: 14, y: 13 } })).toBe(false);
    expect(hasPetPointerMoved({ origin: { x: 10, y: 10 }, current: { x: 17, y: 10 } })).toBe(true);
  });

  it("does not route right-click or camera controls into window dragging", () => {
    expect(shouldStartPetWindowDrag({ interactionMode: "window-drag", button: 2 })).toBe(false);
    expect(shouldStartPetWindowDrag({ interactionMode: "camera-adjust", button: 0 })).toBe(false);
    expect(shouldStartPetWindowDrag({ interactionMode: "camera-adjust", button: 1 })).toBe(false);
    expect(shouldStartPetWindowDrag({ interactionMode: "camera-adjust", button: 2 })).toBe(false);
  });

  it("lets pointer down and up continue to the MMD stage so character clicks can switch actions", () => {
    expect(shouldStopPetWindowDragPropagation({ eventType: "pointerdown", dragActive: true })).toBe(false);
    expect(shouldStopPetWindowDragPropagation({ eventType: "pointerup", dragActive: true })).toBe(false);
    expect(shouldStopPetWindowDragPropagation({ eventType: "pointermove", dragActive: true })).toBe(true);
    expect(shouldStopPetWindowDragPropagation({ eventType: "pointermove", dragActive: false })).toBe(false);
  });
});
