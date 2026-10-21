import assert from "node:assert/strict";
import test from "node:test";

import {
  buildV14dSkinVariantStyleGroups,
  collectV14dSkinVariantBindingCounts,
  perturbV14dSkinVariantStyleGroups,
  V14D_BROWS_LASHES_V1_COMPOSITE_GRAPH,
} from "../src/features/stage/v14dSkinVariantGraphs.js";
import {
  V14D_BROWS_MATERIAL_NAME,
  V14D_LASHES_MATERIAL_NAME,
  V14D_BROWS_LASHES_TINT,
  V14D_BROWS_LASHES_WRONG_ALPHA_FAULT_TAG,
  V14D_BROWS_LASHES_WRONG_ALPHA_FAULT_FACTOR,
} from "../src/features/stage/v14dAuthority.js";

function fakeGroups() {
  return [
    // Emotions 是 face 分组内不参与本票迁移的占位材质：抽出 Face/Brows/Lashes 后
    // k3-face 分组因仍含 Emotions 而保留，missing 负测才能把漏槽真实回塞到原分组。
    { id: "k3-face", label: "Face", materials: ["Face", "Brows", "Lashes", "Emotions"], graph: { version: 1, name: "Face", nodes: [], links: [], output: { node: "o", socket: "color" } } },
    { id: "k3-body", label: "Body", materials: ["BodySkin"], graph: { version: 1, name: "Body", nodes: [], links: [], output: { node: "o", socket: "color" } } },
    { id: "k3-hair", label: "Hair", materials: ["HairA", "HairB"], graph: { version: 1, name: "Hair", nodes: [], links: [], output: { node: "o", socket: "color" } } },
    { id: "k3-cloth", label: "Cloth", materials: ["Cth1-Top"], graph: { version: 1, name: "Cloth", nodes: [], links: [], output: { node: "o", socket: "color" } } },
  ];
}

test("V1 group: Brows/Lashes extracted to V14D Brows Lashes V1 Composite", () => {
  const groups = buildV14dSkinVariantStyleGroups(fakeGroups());
  const bl = groups.find((g) => g.id === "v14d-skin-variant-brows-lashes");
  assert.ok(bl, "brows-lashes V1 group should exist");
  assert.deepEqual(bl.materials, ["Brows", "Lashes"]);
  assert.equal(bl.graph.name, "V14D Brows Lashes V1 Composite");
  assert.equal(bl.graph, V14D_BROWS_LASHES_V1_COMPOSITE_GRAPH);
  assert.equal(bl.graph.nodes[0].id, "v14d_brows_lashes_tint");
  assert.deepEqual(bl.graph.nodes[0].inputs.color, [1.0, 1.0, 1.0]);
  // hashed-alpha 裁切口径（取证 alphaThreshold=0.5），renderClass auto（非 hair）。
  assert.equal(bl.renderClass, "auto");
  assert.equal(bl.alphaMode, "hashed");
  const k3face = groups.find((g) => g.id === "k3-face");
  assert.deepEqual(k3face.materials, ["Emotions"], "Face/Brows/Lashes 迁出后 face 分组仅剩未迁移槽");
});

test("authority constants: Brows/Lashes names + identity tint", () => {
  assert.equal(V14D_BROWS_MATERIAL_NAME, "Brows");
  assert.equal(V14D_LASHES_MATERIAL_NAME, "Lashes");
  assert.deepEqual(V14D_BROWS_LASHES_TINT, [1.0, 1.0, 1.0]);
});

test("V1 group no regression: Face/BodySkin/HairA/HairB still V1-bound", () => {
  const groups = buildV14dSkinVariantStyleGroups(fakeGroups());
  assert.ok(groups.find((g) => g.id === "v14d-skin-variant-face"));
  assert.ok(groups.find((g) => g.id === "v14d-skin-variant-body"));
  assert.ok(groups.find((g) => g.id === "v14d-skin-variant-hair"));
});

test("negative missingBrows: Brows back to face group, Lashes stays V1", () => {
  const v1 = buildV14dSkinVariantStyleGroups(fakeGroups());
  const bad = perturbV14dSkinVariantStyleGroups(v1, "missingBrows");
  const bl = bad.find((g) => g.id === "v14d-skin-variant-brows-lashes");
  assert.deepEqual(bl.materials, ["Lashes"]);
  const k3face = bad.find((g) => g.graph && g.graph.name === "Face");
  assert.ok(k3face.materials.includes("Brows"));
  assert.ok(!k3face.materials.includes("Lashes"));
});

test("negative missingLashes: Lashes back to face group, Brows stays V1", () => {
  const v1 = buildV14dSkinVariantStyleGroups(fakeGroups());
  const bad = perturbV14dSkinVariantStyleGroups(v1, "missingLashes");
  const bl = bad.find((g) => g.id === "v14d-skin-variant-brows-lashes");
  assert.deepEqual(bl.materials, ["Brows"]);
  const k3face = bad.find((g) => g.graph && g.graph.name === "Face");
  assert.ok(k3face.materials.includes("Lashes"));
});

test("negative wrongBrowsLashesTint: identity tint changed to red-green offset", () => {
  const v1 = buildV14dSkinVariantStyleGroups(fakeGroups());
  const bad = perturbV14dSkinVariantStyleGroups(v1, "wrongBrowsLashesTint");
  const bl = bad.find((g) => g.id === "v14d-skin-variant-brows-lashes");
  assert.equal(bl.graph.name, "V14D Brows Lashes V1 Composite");
  assert.notDeepEqual(bl.graph.nodes[0].inputs.color, V14D_BROWS_LASHES_TINT);
  // Stage 2C-M2a 收尾：K3 显示链抵消暖色偏置，[1.35/2.2/6 红偏置] 无法让逐槽正式
  // Gate 自然拒绝；负测改用检流红 [0,1,1]（红通道归零）；但实测显示链对绝对 MAE 强压缩，恒等 tint 的绝对目标误差口径判别力不足，wrongTint 负测未闭合（见 handoff）。
  assert.deepEqual(bl.graph.nodes[0].inputs.color, [0.0, 1.0, 1.0]);
});

test("negative swapBrowsLashes: two distinct-identity cloned graphs cross-bound to wrong slot", () => {
  const v1 = buildV14dSkinVariantStyleGroups(fakeGroups());
  const bad = perturbV14dSkinVariantStyleGroups(v1, "swapBrowsLashes");
  // 合并分组被移除，换成两个独立身份的克隆分组。
  assert.ok(!bad.find((g) => g.id === "v14d-skin-variant-brows-lashes"));
  const browsG = bad.find((g) => g.id === "v14d-skin-variant-brows-lashes-brows");
  const lashesG = bad.find((g) => g.id === "v14d-skin-variant-brows-lashes-lashes");
  assert.ok(browsG && lashesG, "swap 应生成两个独立身份 graph 分组");
  // 交叉绑定：brows 归属的 graph 绑定到 Lashes 材质，反之亦然。
  assert.deepEqual(browsG.materials, ["Lashes"]);
  assert.deepEqual(lashesG.materials, ["Brows"]);
  assert.ok(browsG.graph.name.includes("(swapped-slot brows)"));
  assert.ok(lashesG.graph.name.includes("(swapped-slot lashes)"));
  assert.notEqual(browsG.graph.name, lashesG.graph.name, "两 graph 必须有独立身份（非仅数组顺序）");
});

test("negative wrongBrowsLashesAlpha: 专用 fault tag 注入（alpha 故障因子 seam）", () => {
  const v1 = buildV14dSkinVariantStyleGroups(fakeGroups());
  const bad = perturbV14dSkinVariantStyleGroups(v1, "wrongBrowsLashesAlpha");
  const bl = bad.find((g) => g.id === "v14d-skin-variant-brows-lashes");
  // Stage 2C-M2a 修正轮 seam：不再翻 alphaMode（hashed↔opaque 对可见区 alpha=1 无像素
  // 差异），改在 graph.tags 注入专用 fault tag，引擎 prelude 在 hashed discard 前乘故障
  // 因子。graph 名/alphaMode 保持权威形态（override/hair helper 同生产 V1，单变量只在
  // prelude alpha）。
  assert.equal(bl.alphaMode, "hashed", "alphaMode 保持 hashed（fault 经 tag 注入，非翻口径）");
  assert.equal(bl.graph.name, "V14D Brows Lashes V1 Composite", "graph 名保持权威（override 同生产 V1）");
  assert.ok(bl.graph.tags.includes(V14D_BROWS_LASHES_WRONG_ALPHA_FAULT_TAG), "graph.tags 必须含专用 fault tag");
  // 正常 V1 不含 fault tag（默认入口/普通 V1 不可达）。
  const normal = v1.find((g) => g.id === "v14d-skin-variant-brows-lashes");
  assert.ok(!normal.graph.tags.includes(V14D_BROWS_LASHES_WRONG_ALPHA_FAULT_TAG), "正常 V1 graph 不得含 fault tag");
});

test("wrongAlpha 故障因子唯一权威：patch 脚本从 v14dAuthority 导入生成，不复制字面量", async () => {
  // Stage 2C-M2a 修正轮 P1：V14D_BROWS_LASHES_WRONG_ALPHA_FAULT_FACTOR 是 wrongAlpha 故障
  // 因子的唯一权威。patch-reze-engine.mjs 必须动态导入该导出并据其生成引擎 literal，
  // 禁止在脚本内手写数字字面量（否则 authority 改值后 patch 漂移）。
  assert.equal(typeof V14D_BROWS_LASHES_WRONG_ALPHA_FAULT_FACTOR, "number");
  assert.ok(Number.isFinite(V14D_BROWS_LASHES_WRONG_ALPHA_FAULT_FACTOR));
  assert.ok(V14D_BROWS_LASHES_WRONG_ALPHA_FAULT_FACTOR > 0 && V14D_BROWS_LASHES_WRONG_ALPHA_FAULT_FACTOR < 1e-6,
    "故障因子须低于 hashed clamp 下限 1e-6 才真实剔除片元");
  const fs = await import("node:fs");
  const patchSrc = fs.readFileSync(new URL("../scripts/patch-reze-engine.mjs", import.meta.url), "utf8");
  // patch 脚本必须引用权威导出（生成值来自 authority），而非手写数字字面量。
  assert.ok(patchSrc.includes("V14D_BROWS_LASHES_WRONG_ALPHA_FAULT_FACTOR"), "patch 必须引用权威导出");
  assert.ok(/import\(pathToFileURL\(V14D_AUTHORITY_PATH\)\.href\)[\s\S]*V14D_BROWS_LASHES_WRONG_ALPHA_FAULT_FACTOR|V14D_BROWS_LASHES_WRONG_ALPHA_FAULT_FACTOR[\s\S]*= await import/.test(patchSrc),
    "patch 必须从 v14dAuthority.js 动态导入故障因子");
  // 断言故障因子 literal 由权威值拼接生成（V14D_WRONG_ALPHA_FAULT_FACTOR_LITERAL），
  // 不出现脱离 authority 的独立硬编码数字。
  assert.ok(patchSrc.includes("V14D_WRONG_ALPHA_FAULT_FACTOR_LITERAL"), "patch 必须用权威值拼接 fault literal");
});

test("negative wrongGraph: all graph names replaced with non-authoritative", () => {
  const v1 = buildV14dSkinVariantStyleGroups(fakeGroups());
  const bad = perturbV14dSkinVariantStyleGroups(v1, "wrongGraph");
  const bl = bad.find((g) => g.id === "v14d-skin-variant-brows-lashes");
  assert.equal(bl.graph.name, "V14D WRONG Non-Authoritative Graph");
});

test("binding counts: Brows/Lashes OnComposite increment when V1 graph hit", () => {
  const v1 = buildV14dSkinVariantStyleGroups(fakeGroups());
  const blGroup = v1.find((g) => g.id === "v14d-skin-variant-brows-lashes");
  const engine = {
    modelInstances: new Map([
      ["companion", {
        drawCalls: [
          { materialName: "Brows", groupId: "v14d-skin-variant-brows-lashes", baseBindGroupEntries: [{}] },
          { materialName: "Lashes", groupId: "v14d-skin-variant-brows-lashes", baseBindGroupEntries: [{}] },
          { materialName: "Face", groupId: "v14d-skin-variant-face", baseBindGroupEntries: [{}] },
        ],
        styleGroups: new Map([
          ["v14d-skin-variant-brows-lashes", { pipeline: {}, group: blGroup }],
          ["v14d-skin-variant-face", { pipeline: {}, group: v1.find((g) => g.id === "v14d-skin-variant-face") }],
        ]),
      }],
    ]),
  };
  const counts = collectV14dSkinVariantBindingCounts(engine);
  assert.equal(counts.browsDrawCalls, 1);
  assert.equal(counts.browsOnComposite, 1);
  assert.equal(counts.lashesDrawCalls, 1);
  assert.equal(counts.lashesOnComposite, 1);
  assert.equal(counts.faceDrawCalls, 1);
  assert.equal(counts.faceOnComposite, 1);
});

test("binding counts negative: wrong graph name does not count OnComposite", () => {
  const v1 = buildV14dSkinVariantStyleGroups(fakeGroups());
  const blGroup = v1.find((g) => g.id === "v14d-skin-variant-brows-lashes");
  const wrongGroup = { ...blGroup, graph: { ...blGroup.graph, name: "Wrong Graph" } };
  const engine = {
    modelInstances: new Map([
      ["companion", {
        drawCalls: [
          { materialName: "Brows", groupId: "g", baseBindGroupEntries: [{}] },
          { materialName: "Lashes", groupId: "g", baseBindGroupEntries: [{}] },
        ],
        styleGroups: new Map([["g", { pipeline: {}, group: wrongGroup }]]),
      }],
    ]),
  };
  const counts = collectV14dSkinVariantBindingCounts(engine);
  assert.equal(counts.browsDrawCalls, 1);
  assert.equal(counts.browsOnComposite, 0);
  assert.equal(counts.lashesOnComposite, 0);
});
