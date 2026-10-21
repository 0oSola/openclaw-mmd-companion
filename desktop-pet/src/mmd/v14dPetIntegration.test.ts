import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveStageAssetUrl } from "@/features/stage/stageAssetUrls.js";

describe("V14D 桌宠共享外观接入", () => {
  it("使用运行时 API 地址解析清单、材质、OCIO 和动作资源", () => {
    for (const path of ["/assets/v14d-game/manifest", "assets/mask.png?v=abc", "/assets/vmd/motion.vmd"]) {
      expect(resolveStageAssetUrl(path, "http://127.0.0.1:8116/")).toBe(`http://127.0.0.1:8116/${path.replace(/^\//, "")}`);
    }
    expect(resolveStageAssetUrl("https://example.org/model.pmx?v=abc", "http://127.0.0.1:8116")).toBe("https://example.org/model.pmx?v=abc");
    expect(resolveStageAssetUrl("", "http://127.0.0.1:8116")).toBe("");
  });
  it("桌宠传入运行时地址与参数保存身份，微调不被拖动层捕获", () => {
    const app = readFileSync(resolve("src/App.tsx"), "utf8");
    expect(app).toContain("assetApiBaseUrl={apiBaseUrl}");
    expect(app).toContain("appearanceUserId={DEFAULT_USER_ID}");
    expect(app).toContain("appearanceControlsPortal");
    expect(app).toContain('closest("[data-pet-interactive]")');
    const stage = readFileSync(resolve("../web/src/features/stage/MMDStage.tsx"), "utf8");
    expect(stage).toContain("absolutizeV14dGameManifest(rawManifest, toAbsolute)");
    expect(stage).toContain("floating />, document.body)");
  });
});
