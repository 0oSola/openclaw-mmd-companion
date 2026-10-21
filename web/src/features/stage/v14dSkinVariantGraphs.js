/**
 * Reze K3 V1 皮肤变体的 ShaderGraph 常量与 style group 构建/负测扰动（纯模块）。
 *
 * 从 RezeWebGpuStage.tsx 抽出（2026-09-03 修正轮）：graph 定义与 V1 分组构建是
 * 纯数据/纯函数，独立成模块后可被 node --test 直接驱动负测，不依赖 TSX 组件导入。
 * 生产接线（applyStyleGroups 调用、dataset 证据、资格谓词）仍在 RezeWebGpuStage。
 */

import {
  V14D_BODY_WARM,
  V14D_BODY_MATERIAL_NAME,
  V14D_FACE_MATERIAL_NAME,
  V14D_HAIR_A_MATERIAL_NAME,
  V14D_HAIR_B_MATERIAL_NAME,
  V14D_HAIR_TINT,
  V14D_BROWS_MATERIAL_NAME,
  V14D_LASHES_MATERIAL_NAME,
  V14D_BROWS_LASHES_TINT,
  V14D_BROWS_LASHES_WRONG_ALPHA_FAULT_TAG,
} from "./v14dAuthority.js";

/**
 * 生产 V1（V14D）Face 合成图：与诊断 finalFaceComposite 同一份 WGSL 覆写
 * （graph.name 精确匹配 + tags 含 v14d-state2-face），但 tags 不带
 * "diagnostic"/"face-static"，语义上是生产可选皮肤变体而非诊断入口。
 * 引擎补丁按 tags 注入 mask 声明、按 graph.name 覆写 final_color。
 */
export const V14D_FACE_V1_COMPOSITE_GRAPH = {
  version: 1,
  name: "V14D Face State2 Live Composite",
  tags: ["v14d", "v14d-state2-face", "production", "skin-variant"],
  nodes: [
    { id: "warm", type: "rgb", inputs: { color: [1.0, 0.935, 0.89] } },
  ],
  links: [],
  output: { node: "warm", socket: "color" },
};

/**
 * 生产 V1 BodySkin 暖肤合成图：graph.name "V14D Body Skin Composite" 由引擎补丁
 * 覆写为 v14d_skin_body_composite(tex_color)（body_d 线性 × warm）。BodySkin 无
 * State2 mask；warm rgb 节点仅编译占位。
 */
export const V14D_BODY_V1_COMPOSITE_GRAPH = {
  version: 1,
  name: "V14D Body Skin Composite",
  tags: ["v14d", "production", "skin-variant"],
  nodes: [
    { id: "warm", type: "rgb", inputs: { color: [V14D_BODY_WARM[0], V14D_BODY_WARM[1], V14D_BODY_WARM[2]] } },
  ],
  links: [],
  output: { node: "warm", socket: "color" },
};

/**
 * 诊断入口（v14dFaceStatic）BodySkin 实时合成图：与生产 V1 同一 graph.name（引擎
 * 补丁按 name 覆写为 v14d_skin_body_composite），tags 带 diagnostic/face-static。
 * warm rgb 节点仅编译占位；公式常量由引擎补丁 WGSL helper 提供（权威 blend 取证）。
 */
export const V14D_BODY_LIVE_COMPOSITE_GRAPH = {
  version: 1,
  name: "V14D Body Skin Composite",
  tags: ["diagnostic", "v14d", "face-static"],
  nodes: [
    { id: "warm", type: "rgb", inputs: { color: [V14D_BODY_WARM[0], V14D_BODY_WARM[1], V14D_BODY_WARM[2]] } },
  ],
  links: [],
  output: { node: "warm", socket: "color" },
};

/**
 * Stage 2C-M1 生产 V1 HairA/HairB 头发合成图：graph.name "V14D Hair V1 Composite"
 * 由引擎补丁精确覆写为 v14d_hair_composite(tex_color)（hair_d 线性 × 银白紫乘色
 * [0.84,0.85,0.96]，常量来自权威 blend 取证 hair-forensic.json）。与皮肤同一
 * 「单一乘法 tint、视角相关高光不烘焙」口径：Anisotropic 0.72 / Roughness /
 * Specular MapRange / ToonRamp 按 A/B/C 分类为 C（不能固化视角高光），保持引擎
 * hair 分组既有光照。HairA/HairB 无 State2 mask；tags 标记为生产变体。
 */
export const V14D_HAIR_V1_COMPOSITE_GRAPH = {
  version: 1,
  name: "V14D Hair V1 Composite",
  tags: ["v14d", "production", "skin-variant", "hair-v1"],
  nodes: [
    // 节点 id 固定为 v14d_hair_tint：引擎补丁按该 id 读 tint 写入 WGSL final_color。
    // wrongTint 负测改 inputs.color 即真实改变运行时头发颜色（引擎 signature 含 graph 全文触发重编译）。
    { id: "v14d_hair_tint", type: "rgb", inputs: { color: [V14D_HAIR_TINT[0], V14D_HAIR_TINT[1], V14D_HAIR_TINT[2]] } },
  ],
  links: [],
  output: { node: "v14d_hair_tint", socket: "color" },
};

/**
 * Stage 2C-M2a 生产 V1 Brows/Lashes 合成图：graph.name "V14D Brows Lashes V1 Composite"
 * 由引擎补丁精确覆写为 v14d_hair_composite(tex_color, [1,1,1])（恒等乘色 = BaseColor
 * 原样通过）。权威取证（brows-lashes-forensic.json）确认两槽 BaseColor/Alpha 直连
 * face_d 纹理、无额外乘色，V1 语义目标是「原色通过 + 独立 V1 分组绑定 + hashed-alpha
 * 裁切口径 alphaThreshold=0.5」。节点 id 固定 v14d_brows_lashes_tint 供 wrongTint
 * 负测真实改变运行时颜色。
 */
export const V14D_BROWS_LASHES_V1_COMPOSITE_GRAPH = {
  version: 1,
  name: "V14D Brows Lashes V1 Composite",
  tags: ["v14d", "production", "skin-variant", "brows-lashes-v1"],
  nodes: [
    { id: "v14d_brows_lashes_tint", type: "rgb", inputs: { color: [V14D_BROWS_LASHES_TINT[0], V14D_BROWS_LASHES_TINT[1], V14D_BROWS_LASHES_TINT[2]] } },
  ],
  links: [],
  output: { node: "v14d_brows_lashes_tint", socket: "color" },
};

/**
 * 生产 V1 变体：把 Face/BodySkin/HairA/HairB 从现有分组抽出，分别绑定到
 * V14D 实时合成 graph，其余材质保持 reze-k3 正常分组（严格 A/B）。
 * 与诊断 buildV14dUnlitStyleGroups 同构，但 graph 为生产合成图。
 * Stage 2C-M1 起纳入 HairA/HairB（V14D Hair V1 Composite，hair renderClass）。
 */
export function buildV14dSkinVariantStyleGroups(originalGroups) {
  const excluded = new Set([
    V14D_FACE_MATERIAL_NAME,
    V14D_BODY_MATERIAL_NAME,
    V14D_HAIR_A_MATERIAL_NAME,
    V14D_HAIR_B_MATERIAL_NAME,
    V14D_BROWS_MATERIAL_NAME,
    V14D_LASHES_MATERIAL_NAME,
  ]);
  const retainedGroups = originalGroups
    .map((group) => ({
      ...group,
      materials: group.materials.filter((name) => !excluded.has(name)),
    }))
    .filter((group) => group.materials.length > 0);
  return [
    ...retainedGroups,
    {
      id: "v14d-skin-variant-face",
      label: "V14D Face State2 Live Composite",
      materials: [V14D_FACE_MATERIAL_NAME],
      graph: V14D_FACE_V1_COMPOSITE_GRAPH,
    },
    {
      id: "v14d-skin-variant-body",
      label: "V14D Body Skin Composite",
      materials: [V14D_BODY_MATERIAL_NAME],
      graph: V14D_BODY_V1_COMPOSITE_GRAPH,
    },
    {
      id: "v14d-skin-variant-hair",
      label: "V14D Hair V1 Composite",
      materials: [V14D_HAIR_A_MATERIAL_NAME, V14D_HAIR_B_MATERIAL_NAME],
      graph: V14D_HAIR_V1_COMPOSITE_GRAPH,
      renderClass: "hair",
    },
    {
      id: "v14d-skin-variant-brows-lashes",
      label: "V14D Brows Lashes V1 Composite",
      materials: [V14D_BROWS_MATERIAL_NAME, V14D_LASHES_MATERIAL_NAME],
      graph: V14D_BROWS_LASHES_V1_COMPOSITE_GRAPH,
      // renderClass auto（非 hair：眉毛睫毛在眼睛前方，不能引入 HAIR_OVER_EYES 半透
      // 高光 epilogue）；alphaMode hashed（取证 blendMethod=HASHED alphaThreshold=0.5）。
      renderClass: "auto",
      alphaMode: "hashed",
    },
  ];
}

/**
 * 负测扰动（纯函数，node --test 可直接驱动）：在 V1 style groups 上注入单变量错误。
 *
 * - wrongGraph：全部 graph.name 换成非权威名 → 所有分区 composite 命中应为 0。
 * - failCompile：注入非法 output/节点引用 → applyStyleGroups 应返回 ok:false 并回退。
 * - missingHairA / missingHairB：把对应槽从 V1 分组移除并回塞原 K3 hair 分组 →
 *   该槽 OnComposite 应为 0，其余分区不受影响（单变量）。
 * - wrongHairMaterial：hair V1 分组的 materials 换成 BodySkin → HairA/HairB 命中 0。
 * - wrongTint：hair graph 换成「错误颜色 graph」——graph.name 仍触发引擎覆写，
 *   但 v14d_hair_tint 改为经单变量实验确认远离两槽目标的红绿偏置 [1.35,0.25,0.25]；
 *   正式目标 Gate 必须分别判 HairA/HairB 不收敛，accept 才记录“预期拒绝”。
 */
export function perturbV14dSkinVariantStyleGroups(groups, kind) {
  if (kind === "missingHairA" || kind === "missingHairB") {
    const missing = kind === "missingHairA" ? V14D_HAIR_A_MATERIAL_NAME : V14D_HAIR_B_MATERIAL_NAME;
    return groups.map((g) => {
      if (g.id === "v14d-skin-variant-hair") {
        return { ...g, materials: g.materials.filter((m) => m !== missing) };
      }
      // 把漏掉的槽回塞 K3 原 hair 分组（该槽保持原始 graph，不命中 V1 composite）。
      if (g.graph && g.graph.name === "Hair") {
        return { ...g, materials: [...g.materials, missing] };
      }
      return g;
    });
  }
  if (kind === "missingBrows" || kind === "missingLashes") {
    const missing = kind === "missingBrows" ? V14D_BROWS_MATERIAL_NAME : V14D_LASHES_MATERIAL_NAME;
    return groups.map((g) => {
      if (g.id === "v14d-skin-variant-brows-lashes") {
        return { ...g, materials: g.materials.filter((m) => m !== missing) };
      }
      // 把漏掉的槽回塞 K3 原 face 分组（该槽保持原始 graph，不命中 V1 composite）。
      if (g.graph && g.graph.name === "Face") {
        return { ...g, materials: [...g.materials, missing] };
      }
      return g;
    });
  }
  if (kind === "swapBrowsLashes") {
    // 真实错槽归属（Stage 2C-M2a 修正轮）：用两个独立身份的克隆 graph 分别承载
    // Brows 与 Lashes，但把 graph 的槽归属交叉——brows graph 绑定到 Lashes、
    // lashes graph 绑定到 Brows。这与仅交换 materials 数组顺序（同槽同 graph 的
    // 恒等 tint 不可判别）不同：独立 graph 名字/槽标记提供逐槽机器身份，使
    // 「Brows 像素是否由 brows 归属的 graph 渲染」成为可判别的错槽条件。
    // accept 的 G2 绑定计数仍各命中 1/1（两组都有 pipeline），但逐槽 graph 归属
    // 被交叉，正式逐槽 Gate（P0-1 原子/像素）据此非零拒绝。
    const browsGraph = {
      ...V14D_BROWS_LASHES_V1_COMPOSITE_GRAPH,
      name: "V14D Brows Lashes V1 Composite (swapped-slot brows)",
      tags: [...V14D_BROWS_LASHES_V1_COMPOSITE_GRAPH.tags, "slot-brows"],
    };
    const lashesGraph = {
      ...V14D_BROWS_LASHES_V1_COMPOSITE_GRAPH,
      name: "V14D Brows Lashes V1 Composite (swapped-slot lashes)",
      tags: [...V14D_BROWS_LASHES_V1_COMPOSITE_GRAPH.tags, "slot-lashes"],
    };
    const retained = groups.filter((g) => g.id !== "v14d-skin-variant-brows-lashes");
    return [
      ...retained,
      { id: "v14d-skin-variant-brows-lashes-brows", label: browsGraph.name, materials: [V14D_LASHES_MATERIAL_NAME], graph: browsGraph, renderClass: "auto", alphaMode: "hashed" },
      { id: "v14d-skin-variant-brows-lashes-lashes", label: lashesGraph.name, materials: [V14D_BROWS_MATERIAL_NAME], graph: lashesGraph, renderClass: "auto", alphaMode: "hashed" },
    ];
  }
  if (kind === "wrongBrowsLashesAlpha") {
    // 错误 alpha 口径负测（Stage 2C-M2a 修正轮 seam，二次修正）：保留权威 graph 名
    // "V14D Brows Lashes V1 Composite"（override/hair helper 正常应用，与生产 V1 同构），
    // 仅在 graph.tags 注入专用 fault tag "v14d-wrong-alpha-fault"。引擎 compile 按该 tag
    // 给 prelude 传 v14dAlphaFault=true，WGSL 在 hashed discard 前把 alpha 乘固定故障因子
    // V14D_BROWS_LASHES_WRONG_ALPHA_FAULT_FACTOR（权威导出，当前 1e-7），真实剔除部分片元、
    // coverage/边界环收缩。正常 graph 无此 tag，alpha 语义不变。
    return groups.map((g) =>
      g.id === "v14d-skin-variant-brows-lashes"
        ? { ...g, graph: { ...g.graph, tags: [...(g.graph.tags ?? []), V14D_BROWS_LASHES_WRONG_ALPHA_FAULT_TAG] } }
        : g,
    );
  }
  if (kind === "wrongBrowsLashesTint") {
    return groups.map((g) =>
      g.id === "v14d-skin-variant-brows-lashes"
        ? {
            ...g,
            graph: {
              ...g.graph,
              // 节点 id 与权威 graph 一致（v14d_brows_lashes_tint）：引擎补丁按该 id
              // 取 tint 写入 WGSL，错误红绿偏置真实进入运行时着色，被 G3 收敛 Gate
              // 非零拒绝（恒等 tint 是权威目标，任何偏置都应拉远两槽目标）。
              // Stage 2C-M2a 收尾：K3 显示链（曝光/Toon/sRGB）对暖色偏置有强抵消，
              // [1.35,0.25,0.25]/[2.2,0.1,0.1]/[6,0,0] 实测仍落在 Gate 上限内（Lashes
              // 暗部被压缩、Brows 红通道溢出后仅饱和）。改用检流红 [0,1,1]（红通道归零、
              // 绿蓝保留）：Brows（红褐眉）与 Lashes（暗红睫）的红通道被完全压掉，
              // 画布对 canonical 目标的红通道误差拉到 100-200 级、远超 Gate 上限 95，
              // 逐槽正式 Gate 必须自然非零拒绝（错误 tint 不能被误判为收敛）。
              nodes: [{ id: "v14d_brows_lashes_tint", type: "rgb", inputs: { color: [0.0, 1.0, 1.0] } }],
            },
          }
        : g,
    );
  }
  if (kind === "wrongHairMaterial") {
    return groups.map((g) =>
      g.id === "v14d-skin-variant-hair"
        ? { ...g, materials: [V14D_BODY_MATERIAL_NAME] }
        : g,
    );
  }
  if (kind === "wrongTint") {
    return groups.map((g) =>
      g.id === "v14d-skin-variant-hair"
        ? {
            ...g,
            graph: {
              ...g.graph,
              // 节点 id 与权威 graph 一致（v14d_hair_tint）：引擎补丁按该 id 取 tint
              // 写入 WGSL，错误青绿真实进入运行时着色，被 G3 收敛 Gate 非零拒绝。
              nodes: [{ id: "v14d_hair_tint", type: "rgb", inputs: { color: [1.35, 0.25, 0.25] } }],
            },
          }
        : g,
    );
  }
  return groups.map((g) => {
    if (kind === "wrongGraph") {
      return { ...g, graph: { ...g.graph, name: "V14D WRONG Non-Authoritative Graph" } };
    }
    // failCompile：注入非法 output 引用（指向不存在的节点/算子）。
    return {
      ...g,
      graph: {
        ...g.graph,
        output: { node: "__missing_node__", socket: "color" },
        nodes: [...(g.graph.nodes ?? []), { id: "__bad__", type: "__nonexistent_op__", inputs: {} }],
      },
    };
  });
}

/**
 * V1 四分区 draw-call 绑定证据收集（Stage 2C-M1 修正轮抽取，消除 boot 与负测钩子
 * 两处深遍历重复）。逐个 drawCall 核对实际安装的 styleGroup pipeline 与 graph.name，
 * 只统计带 baseBindGroupEntries 的真实 draw-call。
 */
export function collectV14dSkinVariantBindingCounts(engine) {
  const counts = {
    faceDrawCalls: 0, faceOnComposite: 0,
    bodyDrawCalls: 0, bodyOnComposite: 0,
    hairADrawCalls: 0, hairAOnComposite: 0,
    hairBDrawCalls: 0, hairBOnComposite: 0,
    browsDrawCalls: 0, browsOnComposite: 0,
    lashesDrawCalls: 0, lashesOnComposite: 0,
  };
  if (!engine) return counts;
  const insts = engine.modelInstances;
  if (!insts) return counts;
  for (const inst of insts.values()) {
    const drawCalls = inst.drawCalls;
    const styleGroups = inst.styleGroups;
    if (!drawCalls) continue;
    for (const dc of drawCalls) {
      if (!dc.baseBindGroupEntries) continue;
      const install = dc.groupId && styleGroups ? styleGroups.get(dc.groupId) : undefined;
      const graphName = install?.group?.graph?.name ?? null;
      const onComposite = Boolean(install?.pipeline);
      if (dc.materialName === V14D_FACE_MATERIAL_NAME) {
        counts.faceDrawCalls += 1;
        if (onComposite && graphName === V14D_FACE_V1_COMPOSITE_GRAPH.name) counts.faceOnComposite += 1;
      } else if (dc.materialName === V14D_BODY_MATERIAL_NAME) {
        counts.bodyDrawCalls += 1;
        if (onComposite && graphName === V14D_BODY_V1_COMPOSITE_GRAPH.name) counts.bodyOnComposite += 1;
      } else if (dc.materialName === V14D_HAIR_A_MATERIAL_NAME) {
        counts.hairADrawCalls += 1;
        if (onComposite && graphName === V14D_HAIR_V1_COMPOSITE_GRAPH.name) counts.hairAOnComposite += 1;
      } else if (dc.materialName === V14D_HAIR_B_MATERIAL_NAME) {
        counts.hairBDrawCalls += 1;
        if (onComposite && graphName === V14D_HAIR_V1_COMPOSITE_GRAPH.name) counts.hairBOnComposite += 1;
      } else if (dc.materialName === V14D_BROWS_MATERIAL_NAME) {
        counts.browsDrawCalls += 1;
        if (onComposite && graphName === V14D_BROWS_LASHES_V1_COMPOSITE_GRAPH.name) counts.browsOnComposite += 1;
      } else if (dc.materialName === V14D_LASHES_MATERIAL_NAME) {
        counts.lashesDrawCalls += 1;
        if (onComposite && graphName === V14D_BROWS_LASHES_V1_COMPOSITE_GRAPH.name) counts.lashesOnComposite += 1;
      }
    }
  }
  return counts;
}
