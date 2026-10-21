import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCompanionSharedConfigPayload,
  saveCompanionSharedConfigWithTimeout,
} from "../src/features/stage/companionSharedConfigSave.js";

test("Reze 共享配置自动同步时包含材质与场景文档", () => {
  const payload = buildCompanionSharedConfigPayload({
    selectedModelPath: "models/koleda.pmx",
    renderPipeline: "reze-k3",
    rezeStageDocument: {
      name: "Reze K3",
      materialPresets: { body: "柔滑布料" },
      scene: { backgroundColor: "#000000" },
    },
    rezeSceneDebugSettings: {
      backgroundColor: "#123456",
      cameraDistance: 30,
    },
  });

  assert.deepEqual(payload, {
    selected_model_path: "models/koleda.pmx",
    render_pipeline: "reze-k3",
    reze_stage_document: {
      name: "Reze K3",
      materialPresets: { body: "柔滑布料" },
      scene: { backgroundColor: "#123456" },
    },
  });
});

test("切换到非 Reze 管线时清空旧的舞台文档", () => {
  const payload = buildCompanionSharedConfigPayload({
    selectedModelPath: "models/koleda.pmx",
    renderPipeline: "classic",
    rezeStageDocument: { name: "stale" },
    rezeSceneDebugSettings: { backgroundColor: "#ffffff" },
  });

  assert.equal(payload.reze_stage_document, null);
});

test("v14d-game 接入准备态不复用 Reze 场景文档", () => {
  const payload = buildCompanionSharedConfigPayload({
    selectedModelPath: "models/koleda.pmx",
    renderPipeline: "v14d-game",
    rezeStageDocument: { name: "stale-reze-document" },
    rezeSceneDebugSettings: { backgroundColor: "#ffffff" },
  });

  assert.equal(payload.reze_stage_document, null);
});

test("桌面 Pet 保存请求超时时会中止请求并返回明确错误", async () => {
  await assert.rejects(
    saveCompanionSharedConfigWithTimeout(
      (signal) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
      5,
    ),
    /保存到桌面 Pet 超时/,
  );
});

test("桌面 Pet 保存请求成功时保持原结果", async () => {
  const result = await saveCompanionSharedConfigWithTimeout(async () => ({ render_pipeline: "reze-k3" }), 50);
  assert.deepEqual(result, { render_pipeline: "reze-k3" });
});
