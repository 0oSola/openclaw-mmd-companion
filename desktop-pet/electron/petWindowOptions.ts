import type { BrowserWindowConstructorOptions } from "electron";

import {
  PET_WINDOW_MIN_HEIGHT,
  PET_WINDOW_MIN_WIDTH,
  PET_WINDOW_SETTINGS_HEIGHT,
  PET_WINDOW_SETTINGS_WIDTH,
  type PetWindowBounds,
  normalizePetWindowBounds,
} from "./petSettingsStore.js";

const PET_WINDOW_WIDTH = PET_WINDOW_SETTINGS_WIDTH;
const PET_WINDOW_HEIGHT = PET_WINDOW_SETTINGS_HEIGHT;
const PET_WINDOW_DEFAULT_BOUNDS = {
  width: PET_WINDOW_WIDTH,
  height: PET_WINDOW_HEIGHT,
};
const MIN_VISIBLE_WINDOW_EDGE = 80;

export type PetWindowWorkArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function normalizeWorkArea(value: PetWindowWorkArea): PetWindowWorkArea | undefined {
  const x = Number.isFinite(value.x) ? Math.round(value.x) : undefined;
  const y = Number.isFinite(value.y) ? Math.round(value.y) : undefined;
  const width = Number.isFinite(value.width) ? Math.round(value.width) : undefined;
  const height = Number.isFinite(value.height) ? Math.round(value.height) : undefined;
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

function isMeaningfullyVisible(bounds: PetWindowBounds, workArea: PetWindowWorkArea): boolean {
  const left = Math.max(bounds.x, workArea.x);
  const right = Math.min(bounds.x + bounds.width, workArea.x + workArea.width);
  const top = Math.max(bounds.y, workArea.y);
  const bottom = Math.min(bounds.y + bounds.height, workArea.y + workArea.height);
  const visibleWidth = Math.max(0, right - left);
  const visibleHeight = Math.max(0, bottom - top);
  return visibleWidth >= Math.min(MIN_VISIBLE_WINDOW_EDGE, bounds.width) &&
    visibleHeight >= Math.min(MIN_VISIBLE_WINDOW_EDGE, bounds.height);
}

function centeredBoundsInWorkArea(workArea: PetWindowWorkArea, size: { width: number; height: number }): PetWindowBounds {
  return {
    x: workArea.x + Math.max(0, Math.round((workArea.width - size.width) / 2)),
    y: workArea.y + Math.max(0, Math.round((workArea.height - size.height) / 2)),
    width: size.width,
    height: size.height,
  };
}

function resolveVisiblePetWindowBounds(
  savedBounds: PetWindowBounds | undefined,
  workAreas: PetWindowWorkArea[] | undefined,
): PetWindowBounds | undefined {
  if (!savedBounds) return undefined;
  const normalizedWorkAreas = (workAreas ?? [])
    .map(normalizeWorkArea)
    .filter((workArea): workArea is PetWindowWorkArea => Boolean(workArea));
  if (!normalizedWorkAreas.length) return savedBounds;
  if (normalizedWorkAreas.some((workArea) => isMeaningfullyVisible(savedBounds, workArea))) {
    return savedBounds;
  }
  return centeredBoundsInWorkArea(normalizedWorkAreas[0], savedBounds);
}

export function createPetBrowserWindowOptions(
  preloadPath: string,
  savedBounds?: PetWindowBounds,
  displayWorkAreas?: PetWindowWorkArea[],
): BrowserWindowConstructorOptions {
  const bounds = resolveVisiblePetWindowBounds(normalizePetWindowBounds(savedBounds), displayWorkAreas);
  return {
    ...(bounds ? { x: bounds.x, y: bounds.y } : {}),
    width: bounds?.width ?? PET_WINDOW_DEFAULT_BOUNDS.width,
    height: bounds?.height ?? PET_WINDOW_DEFAULT_BOUNDS.height,
    minWidth: PET_WINDOW_MIN_WIDTH,
    minHeight: PET_WINDOW_MIN_HEIGHT,
    transparent: true,
    frame: false,
    focusable: true,
    alwaysOnTop: true,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  };
}
