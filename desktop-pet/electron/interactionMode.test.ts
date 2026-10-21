import { describe, expect, it } from "vitest";

import {
  DEFAULT_INTERACTION_MODE,
  INTERACTION_MODE_LABELS,
  normalizeInteractionMode,
  shouldOpenPetContextMenu,
} from "./interactionMode.js";

describe("desktop pet interaction mode", () => {
  it("defaults to whole-window dragging", () => {
    expect(DEFAULT_INTERACTION_MODE).toBe("window-drag");
  });

  it("normalizes unknown values to the default mode", () => {
    expect(normalizeInteractionMode("camera-adjust")).toBe("camera-adjust");
    expect(normalizeInteractionMode("unknown")).toBe("window-drag");
    expect(normalizeInteractionMode(null)).toBe("window-drag");
  });

  it("has readable menu labels", () => {
    expect(INTERACTION_MODE_LABELS["window-drag"]).toContain("Drag");
    expect(INTERACTION_MODE_LABELS["camera-adjust"]).toContain("Camera");
  });

  it("blocks the context menu while the camera is being adjusted", () => {
    expect(shouldOpenPetContextMenu("camera-adjust")).toBe(false);
    expect(shouldOpenPetContextMenu("window-drag")).toBe(true);
  });
});
