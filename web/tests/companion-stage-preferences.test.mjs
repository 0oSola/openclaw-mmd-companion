import assert from "node:assert/strict";
import test from "node:test";

import {
  companionRenderPipelineStorageKey,
  normalizeRememberedRenderPipeline,
} from "../src/features/stage/companionStagePreferences.js";

test("记住的 Reze K3 舞台会被恢复", () => {
  assert.equal(normalizeRememberedRenderPipeline("reze-k3"), "reze-k3");
});

test("记住的 v14d-game 舞台会被恢复", () => {
  assert.equal(normalizeRememberedRenderPipeline("v14d-game"), "v14d-game");
});

test("GF2 mode 刷新后保留模式选择", () => {
  assert.equal(normalizeRememberedRenderPipeline("gf2"), "gf2");
});

test("未知舞台会安全回退到 MIO", () => {
  assert.equal(normalizeRememberedRenderPipeline("deleted-stage"), "mio-reference");
});

test("舞台记忆按用户隔离", () => {
  assert.equal(companionRenderPipelineStorageKey("alice"), "mmd_companion_render_pipeline_v1:alice");
  assert.notEqual(companionRenderPipelineStorageKey("alice"), companionRenderPipelineStorageKey("bob"));
});
