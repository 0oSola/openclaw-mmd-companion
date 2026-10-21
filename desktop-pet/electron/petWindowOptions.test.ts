import { describe, expect, it } from "vitest";

import { createPetBrowserWindowOptions } from "./petWindowOptions.js";

describe("desktop pet BrowserWindow options", () => {
  it("keeps the frameless pet window resizable from its native edges", () => {
    const options = createPetBrowserWindowOptions("preload.cjs");

    expect(options).toMatchObject({
      width: 360,
      height: 420,
      minWidth: 240,
      minHeight: 280,
      transparent: true,
      frame: false,
      focusable: true,
      alwaysOnTop: true,
      resizable: true,
      hasShadow: false,
      webPreferences: {
        preload: "preload.cjs",
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    expect(options).not.toHaveProperty("maxWidth");
    expect(options).not.toHaveProperty("maxHeight");
  });

  it("restores saved window position and user-resized size", () => {
    expect(
      createPetBrowserWindowOptions("preload.cjs", {
        x: 120,
        y: 240,
        width: 520,
        height: 640,
      }),
    ).toMatchObject({
      x: 120,
      y: 240,
      width: 520,
      height: 640,
      minWidth: 240,
      minHeight: 280,
      resizable: true,
    });
  });

  it("clamps saved window sizes below the pet minimum", () => {
    expect(
      createPetBrowserWindowOptions("preload.cjs", {
        x: 120,
        y: 240,
        width: 100,
        height: 120,
      }),
    ).toMatchObject({
      x: 120,
      y: 240,
      width: 240,
      height: 280,
    });
  });

  it("recenters saved window positions that are outside the current display work areas", () => {
    expect(
      createPetBrowserWindowOptions(
        "preload.cjs",
        {
          x: 4790,
          y: 637,
          width: 520,
          height: 640,
        },
        [{ x: 0, y: 0, width: 2560, height: 1392 }],
      ),
    ).toMatchObject({
      x: 1020,
      y: 376,
      width: 520,
      height: 640,
    });
  });

  it("keeps saved window positions that are visible on an attached secondary display", () => {
    expect(
      createPetBrowserWindowOptions(
        "preload.cjs",
        {
          x: 4790,
          y: 637,
          width: 520,
          height: 640,
        },
        [
          { x: 0, y: 0, width: 2560, height: 1392 },
          { x: 3840, y: 0, width: 1920, height: 1032 },
        ],
      ),
    ).toMatchObject({
      x: 4790,
      y: 637,
      width: 520,
      height: 640,
    });
  });
});
