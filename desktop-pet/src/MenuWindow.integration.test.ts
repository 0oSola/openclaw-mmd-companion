import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Desktop Pet lightweight menu window", () => {
  it("renders menu models without importing the MMD stage", () => {
    const source = readFileSync(path.resolve(__dirname, "MenuWindow.tsx"), "utf8");

    expect(source).toContain("window.desktopPet?.menu?.onShow");
    expect(source).toContain("window.desktopPet?.menu?.execute");
    expect(source).toContain("pet-menu-window");
    expect(source).not.toContain("MMDStage");
    expect(source).not.toContain("mmdCompanionRuntime");
  });

  it("acknowledges a synchronous React commit without waiting for a throttled animation frame", () => {
    const source = readFileSync(path.resolve(__dirname, "MenuWindow.tsx"), "utf8");

    expect(source).toContain('import { flushSync } from "react-dom"');
    expect(source).toContain("window.desktopPet?.menu?.reportReceived(nextPayload.openedAtMs)");
    expect(source).toContain("flushSync(() =>");
    expect(source).toContain("window.desktopPet?.menu?.reportCommitted(nextPayload.openedAtMs)");
    expect(source).not.toContain("window.requestAnimationFrame");
  });

  it("renders a preloaded empty shell before any menu payload arrives", () => {
    const source = readFileSync(path.resolve(__dirname, "MenuWindow.tsx"), "utf8");

    expect(source).toContain("if (!payload)");
    expect(source).toContain('aria-label="Blank context menu diagnostic"');
  });

  it("has a dedicated Vite HTML entry", () => {
    const viteConfig = readFileSync(path.resolve(__dirname, "../vite.config.ts"), "utf8");
    const menuHtml = readFileSync(path.resolve(__dirname, "../menu.html"), "utf8");

    expect(viteConfig).toContain('menu: fileURLToPath(new URL("./menu.html", import.meta.url))');
    expect(menuHtml).toContain('/src/menuMain.tsx');
  });
});
