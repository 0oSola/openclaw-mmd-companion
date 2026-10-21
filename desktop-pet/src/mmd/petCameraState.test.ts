import { describe, expect, it } from "vitest";

import type { MmdCameraSnapshot } from "@/lib/types";

import {
  loadPetCameraSnapshot,
  loadPetRezeCameraDistance,
  preparePetCameraSnapshotForStorage,
  resolvePetRezeCameraDistance,
  savePetCameraSnapshot,
  savePetRezeCameraDistance,
  shouldPersistPetCameraOnModeChange,
} from "./petCameraState";

const snapshot: MmdCameraSnapshot = {
  fov: 34,
  position: [1, 2, 3],
  target: [0, 1, 0],
  locked: false,
};

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("desktop pet camera state", () => {
  it("persists and loads a camera snapshot per model and render pipeline", () => {
    const storage = createStorage();

    savePetCameraSnapshot({
      storage,
      modelPath: "models/miku/model.pmx",
      renderPipeline: "genshin",
      snapshot,
      nowIso: "2026-06-03T00:00:00.000Z",
    });

    expect(
      loadPetCameraSnapshot({
        storage,
        modelPath: "models/miku/model.pmx",
        renderPipeline: "genshin",
      }),
    ).toEqual(snapshot);
  });

  it("does not reuse a saved camera for a different model or render pipeline", () => {
    const storage = createStorage();

    savePetCameraSnapshot({
      storage,
      modelPath: "models/miku/model.pmx",
      renderPipeline: "genshin",
      snapshot,
      nowIso: "2026-06-03T00:00:00.000Z",
    });

    expect(loadPetCameraSnapshot({ storage, modelPath: "models/luka/model.pmx", renderPipeline: "genshin" })).toBeNull();
    expect(loadPetCameraSnapshot({ storage, modelPath: "models/miku/model.pmx", renderPipeline: "classic" })).toBeNull();
  });

  it("ignores malformed saved camera payloads", () => {
    const storage = createStorage();
    storage.setItem("desktop-pet:mmd-camera:classic:models%2Fmiku%2Fmodel.pmx", "{bad json");

    expect(loadPetCameraSnapshot({ storage, modelPath: "models/miku/model.pmx", renderPipeline: "classic" })).toBeNull();
  });

  it("persists only when leaving camera-adjust mode for drag mode", () => {
    expect(shouldPersistPetCameraOnModeChange("camera-adjust", "window-drag")).toBe(true);
    expect(shouldPersistPetCameraOnModeChange("window-drag", "camera-adjust")).toBe(false);
    expect(shouldPersistPetCameraOnModeChange("window-drag", "window-drag")).toBe(false);
  });

  it("stores pet camera snapshots as locked for drag-mode initialization", () => {
    expect(preparePetCameraSnapshotForStorage({ ...snapshot, locked: false })).toEqual({
      ...snapshot,
      locked: true,
    });
  });

  it("persists Reze camera distance independently per model and pipeline", () => {
    const storage = createStorage();
    savePetRezeCameraDistance({
      storage,
      modelPath: "models/koleda/model.pmx",
      renderPipeline: "reze-k3",
      distance: 12.25,
    });

    expect(
      loadPetRezeCameraDistance({
        storage,
        modelPath: "models/koleda/model.pmx",
        renderPipeline: "reze-k3",
      }),
    ).toBe(12.25);
    expect(
      loadPetRezeCameraDistance({
        storage,
        modelPath: "models/koleda/model.pmx",
        renderPipeline: "reze-design",
      }),
    ).toBeNull();
  });

  it("does not use the main-site scene camera distance as the Pet default", () => {
    expect(
      resolvePetRezeCameraDistance({
        renderPipeline: "reze-k3",
        savedDistance: null,
        mainSiteDistance: 11,
        petDefaultDistance: 30,
      }),
    ).toBe(30);
    expect(
      resolvePetRezeCameraDistance({
        renderPipeline: "reze-design",
        savedDistance: null,
        mainSiteDistance: 11,
        petDefaultDistance: 26.2,
      }),
    ).toBe(26.2);
    expect(
      resolvePetRezeCameraDistance({
        renderPipeline: "reze-k3",
        savedDistance: 17,
        mainSiteDistance: 11,
        petDefaultDistance: 30,
      }),
    ).toBe(17);
  });
});
