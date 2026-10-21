import type { BrowserWindowConstructorOptions, Rectangle } from "electron";

import type { ScreenPoint } from "./contextMenuPosition.js";

export const CONTEXT_MENU_WINDOW_WIDTH = 230;
export const CONTEXT_MENU_WINDOW_HEIGHT = 280;
const CONTEXT_MENU_WINDOW_MARGIN = 6;

export function createDiagnosticBlankBrowserWindowOptions(bounds: Rectangle): BrowserWindowConstructorOptions {
  return {
    ...bounds,
    show: true,
    transparent: false,
    frame: false,
    focusable: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    backgroundColor: "#14181d",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  };
}

export function createContextMenuBrowserWindowOptions(
  preloadPath: string,
  bounds: Rectangle,
): BrowserWindowConstructorOptions {
  return {
    ...bounds,
    show: true,
    transparent: false,
    frame: false,
    focusable: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    backgroundColor: "#14181d",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      partition: "desktop-pet-menu",
    },
  };
}

export function resolveContextMenuWindowBounds({
  point,
  workArea,
}: {
  point: ScreenPoint;
  workArea: Rectangle;
}): Rectangle {
  const maxX = workArea.x + workArea.width - CONTEXT_MENU_WINDOW_WIDTH - CONTEXT_MENU_WINDOW_MARGIN;
  const maxY = workArea.y + workArea.height - CONTEXT_MENU_WINDOW_HEIGHT - CONTEXT_MENU_WINDOW_MARGIN;
  return {
    x: Math.min(Math.max(point.x, workArea.x + CONTEXT_MENU_WINDOW_MARGIN), maxX),
    y: Math.min(Math.max(point.y, workArea.y + CONTEXT_MENU_WINDOW_MARGIN), maxY),
    width: CONTEXT_MENU_WINDOW_WIDTH,
    height: CONTEXT_MENU_WINDOW_HEIGHT,
  };
}
