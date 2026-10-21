import { describe, expect, it } from "vitest";

import {
  CONTEXT_MENU_WINDOW_HEIGHT,
  CONTEXT_MENU_WINDOW_WIDTH,
  createDiagnosticBlankBrowserWindowOptions,
  createContextMenuBrowserWindowOptions,
  resolveContextMenuWindowBounds,
} from "./contextMenuWindow";

describe("desktop pet context menu window", () => {
  it("creates a lightweight opaque focusable popup window", () => {
    expect(createContextMenuBrowserWindowOptions("preload.cjs", {
      x: 100,
      y: 200,
      width: CONTEXT_MENU_WINDOW_WIDTH,
      height: CONTEXT_MENU_WINDOW_HEIGHT,
    })).toMatchObject({
      x: 100,
      y: 200,
      width: CONTEXT_MENU_WINDOW_WIDTH,
      height: CONTEXT_MENU_WINDOW_HEIGHT,
      show: true,
      transparent: false,
      frame: false,
      focusable: true,
      resizable: false,
      skipTaskbar: true,
      backgroundColor: "#14181d",
      webPreferences: {
        preload: "preload.cjs",
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        partition: "desktop-pet-menu",
      },
    });
  });

  it("keeps the popup inside the current display work area", () => {
    expect(
      resolveContextMenuWindowBounds({
        point: { x: 1910, y: 1070 },
        workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      }),
    ).toEqual({
      x: 1684,
      y: 794,
      width: CONTEXT_MENU_WINDOW_WIDTH,
      height: CONTEXT_MENU_WINDOW_HEIGHT,
    });
  });

  it("creates the diagnostic blank window visible without preload or page loading", () => {
    expect(
      createDiagnosticBlankBrowserWindowOptions({
        x: 100,
        y: 200,
        width: CONTEXT_MENU_WINDOW_WIDTH,
        height: CONTEXT_MENU_WINDOW_HEIGHT,
      }),
    ).toMatchObject({
      x: 100,
      y: 200,
      width: CONTEXT_MENU_WINDOW_WIDTH,
      height: CONTEXT_MENU_WINDOW_HEIGHT,
      show: true,
      frame: false,
      transparent: false,
      skipTaskbar: true,
      backgroundColor: "#14181d",
      webPreferences: {
        backgroundThrottling: false,
      },
    });
  });
});
