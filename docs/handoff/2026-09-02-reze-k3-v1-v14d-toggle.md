# Reze K3 V1（V14D）舞台接入与切换 — 交付报告

- 票据：`codex/reze-k3-v1-v14d-toggle`（来源 threadId=01a036ca-f4cc-7b22-8482-b4e72b231053）
- base_commit：`49c982df33a9765640776b5c33bb4c16e600043e`
- HEAD：见本报告「提交」一节
- 状态：**实现完成、静态验证通过；生产舞台端到端验收未在本票据预算内完成（标注为未验证假设）**

## 目标

把已验证的克莱妲实时 V14D Face State2 + BodySkin 渲染，从 `/mmd-calibration-render`
诊断入口接入真实 `/companion` 的 reze-k3 WebGPU 舞台，形成用户可见且可持久
选择的两个效果：原始 Reze K3 与 Reze K3 V1（V14D）。

## 实现摘要

1. 新增 `web/src/features/stage/rezeSkinVariantPreference.ts`：
   `RezeK3SkinVariant = "original" | "v1"`，按 用户+模型+reze-k3 管线 三维
   隔离的 localStorage 持久化（默认 original，original 时清除键），克莱妲资格
   判定 `isRezeK3V1Eligible` 复用 `V14D_FACE_STATIC_AUTHORITY.pmxFileName`。
2. `RezeWebGpuStage.tsx` 新增 `v14dSkinVariant` prop 与生产 V1 分支：
   - `V14D_FACE_V1_COMPOSITE_GRAPH` / `V14D_BODY_V1_COMPOSITE_GRAPH`：与诊断
     finalFaceComposite / BodySkin composite 同一 graph.name（共享引擎补丁五的
     WGSL 覆写），tags 标记为生产皮肤变体（去掉 diagnostic/face-static）。
   - `resolveV14dV1AssetsFromImport`：从 localModelImport 的 File[] 定位权威
     State2 mask（按 webkitRelativePath 后缀），以唯一逻辑键
     `Textures/v14d-state2-mask/state2.png` 注入 `materialAuxTextures`。
   - `buildV14dSkinVariantStyleGroups`：把 Face/BodySkin 抽出并绑定到 V1 graph，
     其余材质保持 reze-k3 正常分组；applyStyleGroups 真实重新编译。
   - boot 依赖数组追加 `v14dSkinVariant`，切换时真实重建引擎与材质图。
   - 运行时 canvas dataset 暴露 `v14dSkinVariant`、`v14dSkinVariantFaceGraph`、
     Face/BodySkin draw-call 级绑定证据（DrawCalls/OnComposite）。
3. `MMDStage.tsx` 透传 `v14dSkinVariant`（仅 chrome="bare" 的 `/companion`
   分支；chrome="panel" 旧诊断入口不接 V1）。
4. `/companion` 页面：reze-k3 + 克莱妲 + localModelImport 时显示
   「原始 Reze K3 / Reze K3 V1（V14D）」切换，读写持久化，按资格安全回退。
5. 概念登记：`workflow/concepts/reze-k3-skin-variant.zh-CN.md` +
   `workflow/workflow-glossary.zh-CN.md`；`docs/architecture/current-system-topology.md`
   补 reze-k3 皮肤变体段落。

## 验证（已运行）

- `npm run build`：编译成功（Next.js 15.5.14，✓ Compiled successfully），
  引擎补丁 62 项严格不变量全部 OK。
- `node web/scripts/patch-reze-engine.mjs --verify`：62 项 OK。
- `node web/scripts/patch-reze-engine.mjs --self-test`：`PATCH-SELF-TEST-OK`
  （真实隔离 fixture 首次/二次幂等、负测全部拒绝）。

## 验证边界（诚实标注）

以下为**未验证假设 / 候选方案**，需独立验收票据在真实舞台完成：

- **A/B 视觉变化**：未在真实 `/companion` 对克莱妲同一相机/同一 VMD 帧截取
  生产舞台全模型 A/B 截图；V1 脸部/脖子/手部皮肤真实变化未在浏览器端到端证实。
- **VMD 行为保持**：未在真实舞台对两个模式各跑权威 PMX+VMD 的
  load→play→pause→seek 与循环/结束回调。实现上 V1 只改 style group 绑定、
  不触碰 VMD 链（playRezeVmd/loadVmd/结束回调与 original 完全同路径），
  但该保持性为静态推断，未实测。
- **非克莱妲负测与泄漏**：隐藏/回退逻辑已实现（isRezeK3V1Eligible + 条件渲染），
  但未在浏览器端到端验证 reze-design/其他模型无泄漏。
- **持久化恢复**：localStorage 读写逻辑已实现，但刷新后恢复未端到端实测。

原因：端到端验收需启动前后端 + Playwright/Chromium 实测 + 本地克莱妲资产，
超出本票据 60/90 分钟预算；且资产（State2 mask）在本 worktree 不可用。

## 提交

- `7cb15f19` feat(reze-k3): add V1 (V14D) skin variant toggle for Koleda stage
- `2e08857a` refactor(reze-k3): source V1 eligibility from V14D_FACE_STATIC_AUTHORITY

## 剩余风险与下一步

1. 独立验收票据：真实舞台 A/B 截图 + draw-call 证据 + VMD 行为 + 非克莱妲
   负测 + 持久化恢复（需本地克莱妲模型目录与 State2 mask）。
2. 若 V1 在真实舞台未生效，优先读 `v14dSkinVariant{Face,Body}OnComposite`
   与 console 的 `[v14d-skin-variant]` 警告定位。
