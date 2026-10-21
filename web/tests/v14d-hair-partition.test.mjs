import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  buildV14dSkinVariantStyleGroups,
  collectV14dSkinVariantBindingCounts,
  perturbV14dSkinVariantStyleGroups,
  V14D_HAIR_V1_COMPOSITE_GRAPH,
} from "../src/features/stage/v14dSkinVariantGraphs.js";
import {
  buildHairUvGridFromPmx,
  barycentricForTriangleUv,
  barycentricInside,
  classifyHairPixel,
  linearToSrgbByte,
  sampleHairTextureLinear,
  srgbByteToLinear,
  v14dHairTargetDisplay,
  v14dHairTargetDisplayFromLinear,
  V14D_HAIR_TINT_LINEAR,
} from "../src/features/stage/v14dHairPartition.js";
import { V14D_HAIR_TINT } from "../src/features/stage/v14dAuthority.js";
import {
  captureV14dHairRuntimeState,
  restoreV14dHairRuntimeState,
  validateV14dHairAtomicEvidence,
  validateV14dHairCapturePair,
} from "../src/features/stage/v14dHairCaptureState.js";

// 最小 fake style groups（hair/face/body 分组 + 一个无关分组），驱动纯函数负测。
// includeV1=false 返回原始 K3 分组（供 buildV14dSkinVariantStyleGroups 的输入）；
// 负测 missing 需要「抽空后仍保留 hair 分组」的形态，故这里保留空 hair 分组。
function fakeGroups(keepEmptyHair = false) {
  return [
    { id: "k3-face", label: "Face", materials: ["Face"], graph: { version: 1, name: "Face", nodes: [], links: [], output: { node: "o", socket: "color" } } },
    { id: "k3-body", label: "Body", materials: ["BodySkin"], graph: { version: 1, name: "Body", nodes: [], links: [], output: { node: "o", socket: "color" } } },
    { id: "k3-hair", label: "Hair", materials: ["HairA", "HairB"], graph: { version: 1, name: "Hair", nodes: [], links: [], output: { node: "o", socket: "color" } } },
    { id: "k3-cloth", label: "Cloth", materials: ["Cth1-Top"], graph: { version: 1, name: "Cloth", nodes: [], links: [], output: { node: "o", socket: "color" } } },
  ];
}

test("V1 分组：HairA/HairB 抽出绑定到 V14D Hair V1 Composite（renderClass=hair）", () => {
  const groups = buildV14dSkinVariantStyleGroups(fakeGroups());
  const hair = groups.find((g) => g.id === "v14d-skin-variant-hair");
  assert.ok(hair, "应存在 hair V1 分组");
  assert.deepEqual(hair.materials, ["HairA", "HairB"]);
  assert.equal(hair.graph.name, "V14D Hair V1 Composite");
  assert.equal(hair.renderClass, "hair");
  // 原 hair 分组应被抽空（HairA/HairB 已迁出）。
  const k3hair = groups.find((g) => g.id === "k3-hair");
  assert.equal(k3hair, undefined, "K3 原 hair 分组抽空后应被过滤");
});

test("负测扰动 missingHairA：HairA 回塞原 hair 分组，HairB 留在 V1（单变量）", () => {
  const v1 = buildV14dSkinVariantStyleGroups(fakeGroups(true));
  // 保留空 hair 分组供回塞：手动把抽空但被过滤的 k3-hair 加回（模拟引擎真实分组，
  // 引擎侧即使抽空也保留分组对象，materials 为空数组）。
  v1.push({ id: "k3-hair", label: "Hair", materials: [], graph: { version: 1, name: "Hair", nodes: [], links: [], output: { node: "o", socket: "color" } } });
  const bad = perturbV14dSkinVariantStyleGroups(v1, "missingHairA");
  const hair = bad.find((g) => g.id === "v14d-skin-variant-hair");
  assert.deepEqual(hair.materials, ["HairB"], "HairA 应从 V1 分组移除");
  const k3hair = bad.find((g) => g.graph && g.graph.name === "Hair");
  assert.ok(k3hair.materials.includes("HairA"), "HairA 应回塞原 hair 分组");
  assert.ok(!k3hair.materials.includes("HairB"), "HairB 不应回塞");
});

test("负测扰动 missingHairB：HairB 回塞原 hair 分组，HairA 留在 V1（单变量）", () => {
  const v1 = buildV14dSkinVariantStyleGroups(fakeGroups(true));
  v1.push({ id: "k3-hair", label: "Hair", materials: [], graph: { version: 1, name: "Hair", nodes: [], links: [], output: { node: "o", socket: "color" } } });
  const bad = perturbV14dSkinVariantStyleGroups(v1, "missingHairB");
  const hair = bad.find((g) => g.id === "v14d-skin-variant-hair");
  assert.deepEqual(hair.materials, ["HairA"]);
  const k3hair = bad.find((g) => g.graph && g.graph.name === "Hair");
  assert.ok(k3hair.materials.includes("HairB"));
});

test("负测扰动 wrongHairMaterial：hair V1 分组 materials 换成 BodySkin", () => {
  const v1 = buildV14dSkinVariantStyleGroups(fakeGroups());
  const bad = perturbV14dSkinVariantStyleGroups(v1, "wrongHairMaterial");
  const hair = bad.find((g) => g.id === "v14d-skin-variant-hair");
  assert.deepEqual(hair.materials, ["BodySkin"]);
});

test("负测扰动 wrongTint：红绿偏置远离权威 tint", () => {
  const v1 = buildV14dSkinVariantStyleGroups(fakeGroups());
  const bad = perturbV14dSkinVariantStyleGroups(v1, "wrongTint");
  const hair = bad.find((g) => g.id === "v14d-skin-variant-hair");
  // graph.name 仍触发引擎覆写，但 tint 常量被改成经实跑确认的错误红绿偏置。
  assert.equal(hair.graph.name, "V14D Hair V1 Composite");
  assert.notDeepEqual(hair.graph.nodes[0].inputs.color, V14D_HAIR_TINT);
  assert.deepEqual(hair.graph.nodes[0].inputs.color, [1.35, 0.25, 0.25]);
});

test("负测扰动 wrongGraph：全部 graph.name 换成非权威名", () => {
  const v1 = buildV14dSkinVariantStyleGroups(fakeGroups());
  const bad = perturbV14dSkinVariantStyleGroups(v1, "wrongGraph");
  for (const g of bad) assert.equal(g.graph.name, "V14D WRONG Non-Authoritative Graph");
});

test("负测扰动 failCompile：注入非法 output/节点引用", () => {
  const v1 = buildV14dSkinVariantStyleGroups(fakeGroups());
  const bad = perturbV14dSkinVariantStyleGroups(v1, "failCompile");
  for (const g of bad) {
    assert.equal(g.graph.output.node, "__missing_node__");
    assert.ok(g.graph.nodes.some((n) => n.type === "__nonexistent_op__"));
  }
});

test("绑定计数：逐 drawCall 核对 graph.name 与 pipeline（含负测 0 命中）", () => {
  const mkInst = (drawCalls, styleGroups) => ({ drawCalls, styleGroups });
  const sg = new Map();
  sg.set("g-hair-v1", { pipeline: {}, group: { graph: { name: "V14D Hair V1 Composite" } } });
  sg.set("g-hair-k3", { pipeline: {}, group: { graph: { name: "Hair" } } });
  sg.set("g-face-v1", { pipeline: {}, group: { graph: { name: "V14D Face State2 Live Composite" } } });
  const engine = {
    modelInstances: new Map([
      ["m", mkInst(
        [
          { materialName: "HairA", groupId: "g-hair-v1", baseBindGroupEntries: [] },
          { materialName: "HairB", groupId: "g-hair-k3", baseBindGroupEntries: [] }, // 错 graph → 不命中
          { materialName: "Face", groupId: "g-face-v1", baseBindGroupEntries: [] },
          { materialName: "BodySkin", groupId: null, baseBindGroupEntries: [] },
        ],
        sg,
      )],
    ]),
  };
  const c = collectV14dSkinVariantBindingCounts(engine);
  assert.equal(c.hairADrawCalls, 1);
  assert.equal(c.hairAOnComposite, 1);
  assert.equal(c.hairBDrawCalls, 1);
  assert.equal(c.hairBOnComposite, 0, "错 graph 不应命中 V1 composite");
  assert.equal(c.faceOnComposite, 1);
  assert.equal(c.bodyOnComposite, 0);
});

test("颜色空间：srgb→linear→×tint→srgb 往返，tint 使 B 通道相对提升", () => {
  // 幂等往返（tint=1 时）。
  for (const c of [0, 64, 128, 192, 255]) {
    assert.equal(linearToSrgbByte(srgbByteToLinear(c)), c);
  }
  // 权威公式：银白紫 tint 使 B 相对 R 提升（B 系数 0.96 > R 0.84）。
  const src = [200, 180, 170];
  const tgt = v14dHairTargetDisplay(src);
  assert.ok(tgt[2] / Math.max(1, tgt[0]) > src[2] / Math.max(1, src[0]), "B/R 比应提升（偏蓝紫）");
  assert.deepEqual(V14D_HAIR_TINT_LINEAR, V14D_HAIR_TINT);
});

test("线性 hair_d 双线性采样：四个角的中心值按 WebGPU texel-center 语义插值", () => {
  const texture = {
    width: 2,
    height: 2,
    linear: new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      1, 1, 1,
    ]),
  };
  const sample = sampleHairTextureLinear(texture, 0.5, 0.5);
  assert.deepEqual(sample.map((value) => Number(value.toFixed(6))), [0.5, 0.5, 0.25]);
  assert.deepEqual(sampleHairTextureLinear(texture, 0, 0), [0.5, 0.5, 0.25]);
});

test("线性 hair_d 双线性采样：REPEAT 在左右/上下边界与越界坐标保持首尾接缝", () => {
  const texture = {
    width: 2,
    height: 2,
    linear: new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      1, 1, 1,
    ]),
  };
  const rounded = (uv) => sampleHairTextureLinear(texture, uv[0], uv[1]).map((value) => Number(value.toFixed(6)));
  assert.deepEqual(rounded([0.01, 0.01]), [0.48, 0.48, 0.2304]);
  assert.deepEqual(rounded([0.99, 0.99]), [0.52, 0.52, 0.2704]);
  assert.deepEqual(rounded([1, 1]), [0.5, 0.5, 0.25]);
  assert.deepEqual(rounded([-1, -1]), [0.5, 0.5, 0.25]);
  assert.deepEqual(rounded([1.01, 1.01]), rounded([0.01, 0.01]));
  assert.deepEqual(rounded([-0.99, -0.99]), rounded([0.01, 0.01]));
});

test("Hair triUV 负测：错槽仍保留合法样本，失败必须来自自然目标指标", (t) => {
  const reportPath = path.join(process.cwd(), ".scratch", "reze-k3-v1-stage", "visual-diff-swap-slot-target.json");
  const analyzerPath = path.join(process.cwd(), "scripts", "analyze-reze-k3-v1-diff.mjs");
  if (!fs.existsSync(reportPath) || !fs.existsSync(analyzerPath)) {
    t.skip("真实 /companion triUV 证据尚未生成");
    return;
  }
  const run = spawnSync(process.execPath, [analyzerPath, "--neg-swap-slot-target"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      V14D_HAIR_ORIG_CANVAS: path.join(process.cwd(), ".scratch", "reze-k3-v1-stage", "g3-hair-original-canvas.png"),
      V14D_HAIR_V1_CANVAS: path.join(process.cwd(), ".scratch", "reze-k3-v1-stage", "g3-hair-v1-canvas.png"),
    },
  });
  assert.equal(run.status, 1, run.stdout + run.stderr);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  for (const slot of ["hairA", "hairB"]) {
    const metric = report.regions[slot].targetConvergence;
    assert.ok(metric.samples >= 30, slot + " 当前槽样本必须存在");
    assert.ok(metric.targetSamples >= 30, slot + " 错槽目标样本必须存在");
    assert.ok(metric.rejectedNoTriUv >= 0);
    assert.ok(metric.rejectedInvalidTri >= 0);
    assert.ok(metric.rejectedBarycentric >= 0);
    assert.ok(metric.triUvResolution >= 0.999, slot + " triUV 解析覆盖率必须达到 99.9%");
    assert.equal(metric.targetBinding.inputsValid, true);
    assert.equal(metric.metricGate, false, slot + " 必须由自然指标失败");
    assert.ok(metric.metricFailureReasons.some((reason) => /v1Mae|drop|P95/i.test(reason)), slot + " 缺少自然指标失败证据");
  }
  assert.equal(report.negativeVerdict.status, "rejected");
  assert.deepEqual(report.negativeVerdict.analysisFailures, []);
});

test("Hair triUV 采集状态：暂停非零时间与播放状态均恢复，未运行循环不被启动", () => {
  const makeModel = (progress) => {
    const state = { ...progress };
    return {
      state,
      getAnimationProgress: () => ({ ...state }),
      playCalls: 0,
      pauseCalls: 0,
      stopCalls: 0,
      seekCalls: [],
      play() { this.playCalls += 1; state.playing = true; state.paused = false; },
      pause() { this.pauseCalls += 1; state.playing = false; state.paused = true; },
      stop() { this.stopCalls += 1; state.playing = false; state.paused = false; },
      seek(seconds) { this.seekCalls.push(seconds); state.current = seconds; },
    };
  };
  const makeEngine = (running) => ({
    animationFrameId: running ? 7 : null,
    runCalls: 0,
    runRenderLoop() { this.runCalls += 1; this.animationFrameId = 8; },
  });

  const pausedModel = makeModel({ current: 5.5, duration: 10, animationName: "paused.vmd", looping: true, playing: false, paused: true });
  const pausedEngine = makeEngine(false);
  const pausedSnapshot = captureV14dHairRuntimeState(pausedModel, pausedEngine);
  pausedModel.seek(0); pausedModel.pause();
  restoreV14dHairRuntimeState(pausedModel, pausedEngine, pausedSnapshot);
  assert.equal(pausedModel.state.current, 5.5);
  assert.equal(pausedModel.state.playing, false);
  assert.equal(pausedModel.state.paused, true);
  assert.equal(pausedEngine.runCalls, 0);

  const playingModel = makeModel({ current: 2.25, duration: 10, animationName: "playing.vmd", looping: true, playing: true, paused: false });
  const playingEngine = makeEngine(true);
  const playingSnapshot = captureV14dHairRuntimeState(playingModel, playingEngine);
  playingModel.seek(0); playingModel.pause();
  restoreV14dHairRuntimeState(playingModel, playingEngine, playingSnapshot);
  assert.equal(playingModel.state.current, 2.25);
  assert.equal(playingModel.state.playing, true);
  assert.equal(playingModel.state.paused, false);
  assert.equal(playingEngine.runCalls, 1);
});

test("Hair 原子采集 Gate：时间推进或跨帧配对必须拒绝，健康证据通过", () => {
  const evidence = (captureId, seconds) => ({
    captureId,
    width: 8,
    height: 8,
    animationName: "authoritative.vmd",
    currentSeconds: seconds,
    currentFrame: seconds * 24,
  });
  const healthy = evidence("capture-1", 1);
  assert.equal(validateV14dHairAtomicEvidence({ pixel: healthy, triUv: { ...healthy } }).ok, true);

  const progressed = evidence("capture-1", 1 + 1 / 24);
  const skewed = validateV14dHairAtomicEvidence({ pixel: healthy, triUv: progressed });
  assert.equal(skewed.ok, false);
  assert.ok(skewed.issues.includes("currentSeconds mismatch"));
  assert.ok(skewed.issues.includes("currentFrame mismatch"));

  const pair = validateV14dHairCapturePair({
    original: { pixel: evidence("original", 1), triUv: evidence("original", 1) },
    v1: { pixel: evidence("v1", 1 + 1 / 24), triUv: evidence("v1", 1 + 1 / 24) },
  });
  assert.equal(pair.ok, false);
  assert.ok(pair.issues.includes("original/v1 currentSeconds mismatch"));
  assert.ok(pair.issues.includes("original/v1 currentFrame mismatch"));
});

test("Hair 固定帧绝对 Gate：只接受 4 秒/120 帧/权威动画名", () => {
  const AUTHORITATIVE = {
    currentSeconds: 4,
    currentFrame: 120,
    fps: 30,
    fpsProvenance: "vmd-standard-fixed-30",
    animationName: "koleda-v14d-authoritative-pose-f120.vmd",
  };
  const evidence = (captureId, overrides = {}) => ({
    captureId,
    width: 8,
    height: 8,
    ...AUTHORITATIVE,
    ...overrides,
  });
  const pair = (overrides = {}) => ({
    original: {
      pixel: evidence("original-capture", overrides.originalPixel),
      triUv: evidence("original-capture", overrides.originalTriUv),
    },
    v1: {
      pixel: evidence("v1-capture", overrides.v1Pixel),
      triUv: evidence("v1-capture", overrides.v1TriUv),
    },
  });
  const healthy = validateV14dHairCapturePair(pair());
  assert.equal(healthy.ok, true, JSON.stringify(healthy));

  const allNullDimensions = validateV14dHairCapturePair({
    ...pair({
      originalPixel: { width: null, height: null },
      originalTriUv: { width: null, height: null },
      v1Pixel: { width: null, height: null },
      v1TriUv: { width: null, height: null },
    }),
  });
  assert.equal(allNullDimensions.ok, false, "四份画布尺寸全为 null 必须拒绝");

  const allInfinityDimensions = validateV14dHairCapturePair({
    ...pair({
      originalPixel: { width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY },
      originalTriUv: { width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY },
      v1Pixel: { width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY },
      v1TriUv: { width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY },
    }),
  });
  assert.equal(allInfinityDimensions.ok, false, "四份画布尺寸全为 Infinity 必须拒绝");

  const invalidDimensions = [
    ["null", null],
    ["undefined", undefined],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["0", 0],
    ["negative", -1],
    ["non-integer", 1.5],
  ];
  const evidenceSlots = ["originalPixel", "originalTriUv", "v1Pixel", "v1TriUv"];
  for (const [label, value] of invalidDimensions) {
    for (const slot of evidenceSlots) {
      for (const dimension of ["width", "height"]) {
        const invalid = validateV14dHairCapturePair({
          ...pair({ [slot]: { [dimension]: value } }),
        });
        assert.equal(invalid.ok, false, slot + "." + dimension + "=" + label + " 必须拒绝");
      }
    }
  }

  const bothFrameZero = validateV14dHairCapturePair({
    ...pair({
      originalPixel: { currentSeconds: 0, currentFrame: 0 },
      originalTriUv: { currentSeconds: 0, currentFrame: 0 },
      v1Pixel: { currentSeconds: 0, currentFrame: 0 },
      v1TriUv: { currentSeconds: 0, currentFrame: 0 },
    }),
  });
  assert.equal(bothFrameZero.ok, false, "双方同时 frame0 不能因彼此相等而通过");

  const bothWrongSeconds = validateV14dHairCapturePair({
    ...pair({
      originalPixel: { currentSeconds: 3.5, currentFrame: 105 },
      originalTriUv: { currentSeconds: 3.5, currentFrame: 105 },
      v1Pixel: { currentSeconds: 3.5, currentFrame: 105 },
      v1TriUv: { currentSeconds: 3.5, currentFrame: 105 },
    }),
  });
  assert.equal(bothWrongSeconds.ok, false, "双方同时错误秒数不能通过");

  const wrongFps = validateV14dHairCapturePair({
    ...pair({ originalPixel: { fps: 24 } }),
  });
  assert.equal(wrongFps.ok, false, "显式 fps 错配必须拒绝");

  const fpsMissing = validateV14dHairCapturePair({
    ...pair({
      originalPixel: { fps: undefined },
      originalTriUv: { fps: undefined },
      v1Pixel: { fps: undefined },
      v1TriUv: { fps: undefined },
    }),
  });
  assert.equal(fpsMissing.ok, false, "四份 fps 全缺失必须拒绝");
  assert.equal(fpsMissing.issues.filter((issue) => issue.includes("fps")).length, 4);

  const bothWrongFps = validateV14dHairCapturePair({
    ...pair({
      originalPixel: { fps: 24 },
      originalTriUv: { fps: 24 },
      v1Pixel: { fps: 24 },
      v1TriUv: { fps: 24 },
    }),
  });
  assert.equal(bothWrongFps.ok, false, "四份 fps 同为错误 24 必须拒绝");
  assert.equal(bothWrongFps.issues.filter((issue) => issue.includes("fps")).length, 4);

  for (const [slot, fps, label] of [
    ["originalPixel", Number.NaN, "NaN"],
    ["originalTriUv", Number.POSITIVE_INFINITY, "Infinity"],
    ["v1Pixel", Number.NaN, "NaN"],
    ["v1TriUv", Number.POSITIVE_INFINITY, "Infinity"],
    ["v1Pixel", null, "null"],
  ]) {
    const invalidFps = validateV14dHairCapturePair({
      ...pair({ [slot]: { fps } }),
    });
    assert.equal(invalidFps.ok, false, slot + " 的 " + label + " fps 必须拒绝");
  }

  const provenanceMissing = validateV14dHairCapturePair({
    ...pair({
      originalPixel: { fpsProvenance: undefined },
      originalTriUv: { fpsProvenance: undefined },
      v1Pixel: { fpsProvenance: undefined },
      v1TriUv: { fpsProvenance: undefined },
    }),
  });
  assert.equal(provenanceMissing.ok, false, "四份 fps provenance 全缺失必须拒绝");
  assert.equal(provenanceMissing.issues.filter((issue) => issue.includes("fpsProvenance")).length, 4);

  for (const slot of ["originalPixel", "originalTriUv", "v1Pixel", "v1TriUv"]) {
    const wrongProvenance = validateV14dHairCapturePair({
      ...pair({ [slot]: { fpsProvenance: "derived-from-frame-seconds" } }),
    });
    assert.equal(wrongProvenance.ok, false, slot + " 的错误 fps provenance 必须拒绝");
  }

  for (const animationName of ["", "wrong-pose.vmd"]) {
    const wrongName = validateV14dHairCapturePair({
      ...pair({
        originalPixel: { animationName },
        originalTriUv: { animationName },
        v1Pixel: { animationName },
        v1TriUv: { animationName },
      }),
    });
    assert.equal(wrongName.ok, false, "双方动画名=" + JSON.stringify(animationName) + " 不能通过");
  }

  const captureIdMismatch = validateV14dHairCapturePair({
    ...pair({ originalTriUv: { captureId: "different-triuv" } }),
  });
  assert.equal(captureIdMismatch.ok, false, "pixel↔triUV captureId 错配必须拒绝");

  const captureTimeMismatch = validateV14dHairCapturePair({
    ...pair({ v1TriUv: { currentSeconds: 4 + 1 / 30, currentFrame: 121 } }),
  });
  assert.equal(captureTimeMismatch.ok, false, "pixel↔triUV 时间/帧错配必须拒绝");
});

test("逐像素目标：线性 hair_d 样本只经 authority tint 后转回显示字节", () => {
  const target = v14dHairTargetDisplayFromLinear([1, 1, 1]);
  assert.deepEqual(target, V14D_HAIR_TINT.map((value) => linearToSrgbByte(value)));
  assert.deepEqual(v14dHairTargetDisplay([255, 255, 255]), target);
});

test("triUV 重心校验：合法点通过，三角形外点和退化三角形拒绝", () => {
  const triangle = [0, 0, 1, 0, 0, 1];
  assert.ok(barycentricInside(barycentricForTriangleUv(0.25, 0.25, triangle)));
  assert.equal(barycentricInside(barycentricForTriangleUv(0.8, 0.8, triangle)), false);
  assert.equal(barycentricForTriangleUv(0.2, 0.2, [0, 0, 1, 1, 2, 2]), null);
});

test("patch 源码只从 v14dAuthority.js 生成头发 tint，不再内含旧硬编码数组", () => {
  const patchSource = fs.readFileSync(path.join(process.cwd(), "scripts", "patch-reze-engine.mjs"), "utf8");
  assert.match(patchSource, /v14dAuthority\.js/);
  assert.match(patchSource, /V14D_HAIR_TINT_LITERAL/);
  assert.doesNotMatch(patchSource, /\[0\.84\s*,\s*0\.85\s*,\s*0\.96/);
});

test("Hair analyzer 默认使用原子画布，legacy 画布只留给场景 lane", () => {
  const analyzerSource = fs.readFileSync(path.join(process.cwd(), "scripts", "analyze-reze-k3-v1-diff.mjs"), "utf8");
  assert.match(analyzerSource, /const FORMAL_HAIR_ORIG = path\.join\(OUT, ["']g3-hair-original-canvas\.png["']\)/);
  assert.match(analyzerSource, /const FORMAL_HAIR_V1 = path\.join\(OUT, ["']g3-hair-v1-canvas\.png["']\)/);
  assert.match(analyzerSource, /process\.env\.V14D_HAIR_ORIG_CANVAS \|\| FORMAL_HAIR_ORIG/);
  assert.match(analyzerSource, /process\.env\.V14D_HAIR_V1_CANVAS \|\| FORMAL_HAIR_V1/);
  assert.match(analyzerSource, /const ORIG = path\.join\(OUT, ["']g3-original-canvas\.png["']\)/);
  assert.match(analyzerSource, /const V1 = path\.join\(OUT, ["']g3-v1-canvas\.png["']\)/);
  assert.match(analyzerSource, /nonSkinStats\(r, hairOrigImage, hairActual\)/);

  const acceptSource = fs.readFileSync(path.join(process.cwd(), "scripts", "accept-reze-k3-v1-stage.mjs"), "utf8");
  assert.match(acceptSource, /delete analyzerEnv\.V14D_HAIR_ORIG_CANVAS/);
  assert.match(acceptSource, /delete analyzerEnv\.V14D_HAIR_V1_CANVAS/);
});

test("Hair 正式 Gate 单一权威：legacy aggregate 诊断不能阻断健康样本，正式槽失败仍硬失败", () => {
  const analyzerPath = path.join(process.cwd(), "scripts", "analyze-reze-k3-v1-diff.mjs");
  const run = spawnSync(process.execPath, [analyzerPath, "--self-test-hair-gate"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const result = JSON.parse(run.stdout.trim());
  assert.deepEqual(result.healthyWithLegacyAggregateFailure, {
    pass: true,
    formalTargetGate: { hairA: true, hairB: true },
    legacyAggregateIgnored: true,
  });
  assert.equal(result.changedFailure.pass, false);
  assert.equal(result.changedFailure.formalTargetGate.hairA, false);
  assert.equal(result.changedFailure.formalTargetGate.hairB, true);
  assert.equal(result.targetConvergenceFailure.pass, false);
  assert.equal(result.targetConvergenceFailure.formalTargetGate.hairA, true);
  assert.equal(result.targetConvergenceFailure.formalTargetGate.hairB, false);
  assert.deepEqual(result.swapNegative, { status: "rejected", expectedExit: 1, analysisFailures: [] });
  assert.deepEqual(result.wrongTintNegative, { status: "rejected", expectedExit: 0, analysisFailures: [] });
});

test("Hair 原子 probe 生成 fps 与可审计来源，accept 不再事后补造 fps", () => {
  const stageSource = fs.readFileSync(path.join(process.cwd(), "src", "features", "stage", "RezeWebGpuStage.tsx"), "utf8");
  assert.match(stageSource, /const fps = V14D_HAIR_AUTHORITATIVE_CAPTURE\.fps/);
  assert.match(stageSource, /fpsProvenance:\s*V14D_HAIR_AUTHORITATIVE_CAPTURE\.fpsProvenance/);

  const acceptSource = fs.readFileSync(path.join(process.cwd(), "scripts", "accept-reze-k3-v1-stage.mjs"), "utf8");
  assert.doesNotMatch(acceptSource, /captureEvidenceWithDerivedFps/);
  assert.match(acceptSource, /captureEvidence:\s*\{\s*original:/s);
  assert.match(acceptSource, /fpsProvenance/);
});

// Stage 2C-M2a 修正轮（P1 provenance）：探针隔离的采集 epoch。跨 page.reload 的两次独立采集
// 必须用全局唯一 captureId（epoch 前缀），否则 run2/wrong 在新 page 首采时 captureId 碰撞为 "1"，
// 无法机器证明标定采集独立。此测试锁定实现口径：epoch 仅在显式 acceptance probe 下启用，
// captureId 由 epoch 前缀 + per-capture 自增序号组成（同 page 内仍保证 pixel↔triUV 原子配对）。
test("acceptance probe 采集 epoch 使跨 reload captureId 全局唯一（探针隔离）", () => {
  const stageSource = fs.readFileSync(path.join(process.cwd(), "src", "features", "stage", "RezeWebGpuStage.tsx"), "utf8");
  // epoch 仅在显式 acceptance probe 下分配（默认生产入口不启用），且持久化在 sessionStorage
  // （跨 page.reload 存活、不同 tab 隔离）；每次采集实时读取自增，不在组件 useRef 缓存。
  assert.match(stageSource, /if \(acceptanceProbeEnabled\) \{/);
  assert.match(stageSource, /sessionStorage\?\.getItem\(KEY\)/);
  assert.match(stageSource, /sessionStorage\?\.setItem\(KEY, String\(cur \+ 1\)\)/);
  // captureId = "e<epoch>-<per-capture 自增序号>"（有 epoch 时带前缀），实时读取 window.__v14dCaptureEpoch。
  assert.match(stageSource, /captureEpoch = acceptanceProbeEnabled \? String\(/);
  assert.match(stageSource, /captureId = captureEpoch \? "e" \+ captureEpoch \+ "-" \+ seq/);
});

// 真实 PMX 分区解析（资产存在时）：HairA/HairB UV 网格非空且分区不坍缩。
const PMX = process.env.V14D_TEST_PMX || "D:\\mmd\\克莱妲原皮\\GirlsFrontline KoledaDefault.pmx";
test("PMX 分区：HairA/HairB 面区间解析出非空且不重叠坍缩的 UV 网格", (t) => {
  if (!fs.existsSync(PMX)) { t.skip("权威 PMX 不在本机"); return; }
  const buf = fs.readFileSync(PMX);
  const grid = buildHairUvGridFromPmx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), {
    hairA: { name: "HairA", startIndex: 190407, indexCount: 30198 },
    hairB: { name: "HairB", startIndex: 220605, indexCount: 13512 },
  });
  let aUnits = 0, bUnits = 0;
  for (let u = 0; u < grid.gridU * grid.gridV; u++) {
    if (grid.hairA[u] > 0) aUnits++;
    if (grid.hairB[u] > 0) bUnits++;
  }
  assert.ok(aUnits > 50, "HairA 应覆盖多个 UV 单位格，实际 " + aUnits);
  assert.ok(bUnits > 50, "HairB 应覆盖多个 UV 单位格，实际 " + bUnits);
  // 引用计数守恒：每个面区间 index 数等于该槽顶点引用总数。
  let aRefs = 0, bRefs = 0;
  for (let u = 0; u < grid.gridU * grid.gridV; u++) { aRefs += grid.hairA[u]; bRefs += grid.hairB[u]; }
  assert.equal(aRefs, 30198);
  assert.equal(bRefs, 13512);
});
