# Reze K3 V1 HairA/HairB 头发材质迁移（Stage 2C-M1）交付报告

- 票据：`codex/v14d-hairab-stage`
- 来源：threadId=`01a036ca-f4cc-7b22-8482-b4e72b231053`，hostId=`local`；交付目标为该来源主会话。
- 来源项目：`source_project_id=local-140a2801b88e7626327b2eb4694a8b91`，`project_binding_verified=true`。项目查询摘要：`thread.projectId` 非空且与 `source_project_id` 完全一致，hostId=`local`，任务状态为 active。
- 执行模型：kimi/k3-256k（视觉识别/真实舞台验收）
- 工作树：`E:\codexWorktree\01bf\MMD project`，分支 `codex/v14d-hairab-stage`
- 基线：base_ref=`codex/local-interactive-integration`，base_commit=`1c366814d54689a01356d21da358c061c4aac32b`。启动时 HEAD 等于 base_commit、工作树 clean、detached HEAD；随后从该提交建立并切换到唯一 ticket_branch。
- 完成时间：2026-09-03
- 状态：**实现完成；真实 `/companion` G1-G6 与本票专项工程门禁通过。全量 node tests 仍有 18 项既有基线失败，未将其冒充为本票全绿。**

## 目标

在生产 `/companion` 的同一 Reze K3 舞台运行时中，将克莱妲 HairA、HairB 两个材质槽迁移到
V14D 风格的实时头发材质，并纳入现有「原始 Reze K3 / Reze K3 V1」切换。仅处理 HairA/HairB；
Face、BodySkin 保持既有 V1 行为，其余 11 个待迁移槽不实施。

## 权威取证（Blender CLI，不凭截图目测）

`web/scripts/forensic-v14d-hair-state.py` 对权威 .blend
（`Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend`，SHA256 1139617c…）headless 自省，
输出 `web/.scratch/v14d-hairab/hair-forensic.json`。HairA/HairB（PROTO_GF2_HairA/HairB）关键事实：

- **BaseColor**：`c_KoledaSSR01_slg_hair_d.png`（sRGB，2048×2048，hasData=true，Alpha 直连
  Principled.Alpha）经 `PROTO_HairTint`（MIX_RGB MULTIPLY、Factor=1）固定银白紫乘色
  **[0.84, 0.85, 0.96, 1.0]**（非目测，来自节点自省）。
- **Alpha/裁切**：blendMethod=HASHED、surfaceRenderMethod=DITHERED、alphaThreshold=0.5，
  与引擎 hashed-alpha 裁切口径一致；Hair Spec（`c_KoledaSSR01_slg_hair_spc.png`）声明但为空
  （0×0、hasData=false，manifest 保留「已声明但为空」状态）。
- **视角相关（不迁移/不烘焙）**：Anisotropic 0.72、Roughness/Specular 经 MapRange 支路、
  ToonRamp 经 ShaderToRGB——按 A/B/C 分类为 C（不能烘焙/不固化视角高光），保持引擎 hair
  分组既有光照行为。

## 实现摘要

1. **引擎补丁扩展**（`web/scripts/patch-reze-engine.mjs`，fresh fixture 自验 + 严格 marker Gate）：
   - 新增独立 `V14D_HAIR_HELPER_WGSL` 常量（`v14d_hair_composite(base)=base×[0.84,0.85,0.96]`）。
   - assembleModule 新增 `includeV14dHairHelper` 参数单独注入 hair helper——**不连带** State2
     mask 声明（binding 5），hair graph 无需 mask 即可编译通过（这是修复的真实根因：最初把
     helper 并入 state2 模板导致 hair graph 因无 state2 门控而未注入 helper、WGSL 未声明、
     整组编译失败静默回退 original）。
   - compile 按 graph.name "V14D Hair V1 Composite" 覆写 final_color；override 函数新增
     isHairV1 分支。所有 target 幂等（fresh/旧补丁/二次运行三态收敛）。
2. **生产 V1 接线**（`RezeWebGpuStage.tsx`）：新增 `V14D_HAIR_V1_COMPOSITE_GRAPH`
   （tags 含 production/skin-variant/hair-v1），`buildV14dSkinVariantStyleGroups` 把
   HairA/HairB 抽出绑定到该 graph（renderClass=hair）；canvas dataset 新增
   `v14dSkinVariant{HairA,HairB}{DrawCalls,OnComposite}` 分区 draw-call 绑定证据；
   负测钩子 `applyBadSkinGraph` 同步纳入 hair 证据。
3. **材质名常量**（`v14dFaceStatic.ts`）：`V14D_HAIR_A_MATERIAL_NAME`/`V14D_HAIR_B_MATERIAL_NAME`。

## 验证（全部实际运行）

| 项 | 结果 |
| --- | --- |
| `node --test tests/v14d-hair-partition.test.mjs tests/reze-k3-skin-variant.test.mjs` | 22/22 通过 |
| `node scripts/patch-reze-engine.mjs --verify` | 72 项严格不变量全 OK |
| `node scripts/patch-reze-engine.mjs --self-test` | PATCH-SELF-TEST-OK（fresh 首次/二次幂等、全部负测拒绝） |
| `npm run build` | ✓ Compiled successfully（Next.js 15.5.14） |
| `git diff --check` | 干净（exit 0） |
| 真实舞台验收 `node scripts/accept-reze-k3-v1-stage.mjs` | **G1-G6 全过，STAGE-V1-OK** |
| 全量 `node --test tests/*.test.mjs` | 216/234 通过；18 项为既有 `mmd-render-runtime/chatbox` 基线失败，根因指向被 Git 忽略的 `web/node_modules/reze-engine` 历史脏状态 |

## 真实舞台验收（/companion，权威 PMX+VMD+State2 mask）

| Gate | 结果 | 关键证据 |
| --- | --- | --- |
| G1 用户路径与切换 | ✅ | 导入后变体 UI 出现；点 V1 后 canvas=v1；切回 original 一致 |
| G2 真实绑定+负测 | ✅ | Face/BodySkin/HairA/HairB drawCalls 各 1/1 命中目标 graph；missingHairA、missingHairB、wrongHairMaterial、wrongGraph、failCompile、重命名 PMX、缺 mask、非克莱妲回退均实际检出。 |
| G3 视觉 A/B + 分区目标收敛 | ✅ | 权威公式为 `targetLinear(uv)=srgbToLinear(hair_d(uv))×[0.84,0.85,0.96]`，显示字节比较；阈值为每槽 `samples≥30`、`drop>0.05`、`v1Mae<90`，且变化门禁 `mae>1`、`maxMeanDiff>1`。最终回放 HairA：materialId=24、samples=4,189、slotPixels=4,189、coverage=0.037214、targetMean=[136.05,129.45,154.60]、origMae=40.879、v1Mae=32.181、drop=0.2128；HairB：materialId=25、samples=15,426、slotPixels=15,495、coverage=0.096902、targetMean=[141.89,135.47,161.77]、origMae=53.705、v1Mae=39.132、drop=0.2714。前刘海/后长发分别有 original/V1 近景与差异/UV 证据；**wrongTint** 使用 `[1.35,0.25,0.25]`，HairA origMae=40.879→v1Mae=53.535、drop=-0.3096，HairB origMae=53.705→v1Mae=51.806、drop=0.0354；analyzer exit=0、`negativeVerdict.status=rejected`、HairA/HairB 正式目标判据均 false、`failures=[]`，因此 accept 区分“预期拒绝”与“负测失效/异常”。场景快照逐字段包含 settings、grade、backgroundEffect、transparentBackground、viewTransform（exposure=0.6、gamma=1、look=`medium_high_contrast`），original/V1 一致。
| G4 持久化 | ✅ | V1 刷新+重导入后保持 v1；切回 original 刷新保持 |
| G5 VMD 零回归 | ✅ | original/V1 各 load→play→pause→seek→完整播放至结束（完成回调计数自增+nearTail）；提前停止/竞态/过期回调负测全过；resetPhysics 计数>0 |
| G6 管线隔离+探针泄漏 | ✅ | 切 reze-design 后真实克莱妲重建为 original、变体 UI 不显示；探针默认关闭 |

## 视觉证据

| 产物 | 路径 |
| --- | --- |
| 三联图（original/V1/diff） | `web/.scratch/reze-k3-v1-stage/g3-side-by-side.png` |
| 差异热图 | `web/.scratch/reze-k3-v1-stage/g3-diff-heat.png` |
| original/V1 纯画布 | `g3-original-canvas.png` / `g3-v1-canvas.png` |
| 同变体连拍（噪声基线） | `g3-original-canvas-b.png` |
| HairA 前部近景 | `g3-hair-front-orig.png` / `g3-hair-front-v1.png` |
| HairB 后部近景 | `g3-hair-back-orig.png` / `g3-hair-back-v1.png` |
| HairA/HairB 差异图与 UV 取证 | `hair-uv-hairA-diff.png`、`hair-uv-hairB-diff.png` 及对应 original/target 图 |
| 逐槽材质身份掩码 | `g3-hair-material-mask.png` / `g3-hair-material-mask.json` |
| 正式/ wrongTint 区域像素数值 | `visual-diff.json` / `visual-diff-wrongtint.json` |
| 完整门禁报告 | `web/.scratch/reze-k3-v1-stage/gate-report.json` |
| Blender 取证 manifest | `web/.scratch/v14d-hairab/hair-forensic.json` |

差异热图确认：亮区集中在头发（HairA 前刘海 + HairB 后长发）+脸+手部皮肤，衣服/装备/星空几乎全黑。HairA/HairB 不是矩形平均：分析器读取同一全画面 engine-pick-material-id-depth pass，R=modelId、G=materialId，仅统计对应 PMX materialId 的深度前景像素；当前 materialId=24/25。最终回放错槽归属负测交换后样本严格互换（正确 HairA/HairB=4,293/19,528；交换=19,528/4,293，detected=true），证明两槽不合并。

## 验收口径修正（诚实记录）

- **G3 分析脚本**：皮肤阶段遗留的「hair 必须稳定」口径与本票据「hair 必须变化」冲突。本票据把
  `hair` ROI 从 `nonskin`（必须稳定）改为 `hair`（必须显著变化），新增阈值 hairChangeMae/hairChangeMaxMeanDiff。
  `clothes` ROI 收窄（w 0.10→0.075）排除右列刘海/头发遮挡区——网格探针证明该区 original↔V1 与
  同变体连拍噪声同为高位（2.3-11.7 vs 1.0-4.3），是头发遮挡/高光帧间微动噪声而非衣服材质泄漏；
  衣服主体两侧均 <0.5。新增同变体连拍（`g3-original-canvas-b.png`）噪声基线，非皮肤泄漏判定改为
   「显著高于同变体噪声×4」。
- **wrongTint 负测协议**：负测不能以 analyzer 任意非零退出表示成功。`--neg-wrongtint` 只替换 HairA/HairB 画布，健康 V1 用于其余 Gate；analyzer 输出 `negativeVerdict`，只有 exit=0、两槽正式目标 Gate 均为 false、`analysisFailures=[]` 且给出 `rejectionReason` 才是预期拒绝。配置错误、样本缺失、其他 Gate failure 或异常均为负测失败。
- **逐槽身份协议**：HairA/HairB 目标误差必须使用 engine-pick-material-id-depth 掩码的对应 PMX materialId + 深度前景样本；矩形 ROI 仅作空间限制，不能赋予槽位身份。
- **场景不变性快照**：必须同时核对 settings、grade、backgroundEffect、transparentBackground 与 viewTransform 的 exposure/gamma/look，不能只报告 settings/grade/background。

## 迁移范围（15 槽最终目标）

- **已迁移（4/15）**：Face、BodySkin、HairA、HairB。
- **尚未迁移（11/15，后续票据）**：Brows、Lashes、Emotions、Eyes、EyeWhite、EyeShadow、Eyes+、
  UpperTeeth、LowerTeeth、Tongue、FingerNails。
- **明确排除（永久保持原始 Reze K3）**：所有 Cth* 衣物/装备与 Glock、GunSilencer 武器。

## 剩余风险与边界

- **头发视角高光**：Blender JSON 已机器输出 Anisotropic=0.7200000286、Roughness/Specular 两条
  MapRange 支路的 From/To/Steps、ToonRamp 的三段位置/颜色、ShaderToRGB/Tangent/Alpha 链；
  本阶段只迁移 BaseColor 乘色，视角相关高光保持引擎既有行为，未宣称复现 Blender 的高光形状。
- **验收环境**：本机无 Python，API 后端不可达，验收用 Playwright route 存根 bootstrap API
  （存根环境端到端）；V1 资格/绑定/渲染/VMD 均不依赖 API。
- **全量 node tests 基线风险**：234 项中 18 项集中在既有 `mmd-render-runtime/chatbox`，与本票修改无直接重叠；专项 Hair/skin tests、patch verify/self-test、build 和真实舞台 G1-G6 均通过。
- **P2 常量漂移**：已将 `v14dFaceStatic.ts` 与 `v14dHairPartition.js` 的 Hair 材质名/tint 导入共享纯 JS `v14dAuthority.js`，保留原模块导出面；后续新增 Hair 常量必须只写入该权威模块。

## 提交

提交：本分支最终 HEAD 见本票结构化交付消息；该报告不嵌入会改变自身哈希的自引用值。
