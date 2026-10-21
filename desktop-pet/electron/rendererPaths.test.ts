import { describe, expect, it } from "vitest";
import path from "node:path";

import {
  PRODUCTION_RENDERER_PAGES,
  resolveProductionRendererPage,
  resolveProductionRendererRoot,
} from "./rendererPaths.js";

describe("production renderer paths", () => {
  it("resolves all release pages beside dist-electron", () => {
    const electronDir = "E:\\workspace\\MMD project\\desktop-pet\\dist-electron";
    const rendererRoot = resolveProductionRendererRoot(electronDir);

    expect(rendererRoot).toBe(path.resolve("E:\\workspace\\MMD project\\desktop-pet\\dist"));
    expect(PRODUCTION_RENDERER_PAGES.map((page) => resolveProductionRendererPage(rendererRoot, page))).toEqual([
      path.join(rendererRoot, "index.html"),
      path.join(rendererRoot, "menu.html"),
      path.join(rendererRoot, "notification.html"),
    ]);
  });

  it("honors an explicit renderer root for release packaging", () => {
    const rendererRoot = resolveProductionRendererRoot(
      "E:\\workspace\\desktop-pet\\dist-electron",
      "E:\\release\\pet\\renderer",
    );

    expect(rendererRoot).toBe(path.resolve("E:\\release\\pet\\renderer"));
  });
});
