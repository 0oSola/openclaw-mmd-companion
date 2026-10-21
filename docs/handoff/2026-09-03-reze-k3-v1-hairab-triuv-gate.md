# Reze K3 V1 HairA/HairB 同材质同三角形同 UV 逐像素门禁交付

- 票据：Stage 2C-M1.1 修正轮
- 分支：`codex/v14d-hairab-triuv-gate`
- 来源任务：`01a036ca-f4cc-7b22-8482-b4e72b231053`，hostId=`local`
- 来源项目：`local-140a2801b88e7626327b2eb4694a8b91`，`project_binding_verified=true`
- 工作目录：`E:\codexWorktree\a29b\MMD project`
- 基线：`base_ref=codex/v14d-hairab-stage`，`base_commit=b8b2b35c7f28510b8814e975c8602ea1081fd403`
- implementation_commit（本轮实现/测试提交）：`dab71fcd790c9d083c8574a64e4620938e067f96`
- 注意：`implementation_commit` 只标识实现提交；本文件不记录自引用的最终分支 HEAD。最终分支 HEAD 仅由结构化交付字段 `final_branch_head_at_delivery` 在发送时记录。
- 日期：2026-09-03
- 状态：修正闭合；代码、聚焦测试、补丁检查、构建、分析器和真实 `/companion` G1-G6 均通过。

## 交付结论

HairA/HairB 正式 Gate 已使用真实逐屏幕 triUV 目标：每个样本同时绑定引擎 `materialId`、同槽局部 `triId`、插值 UV 和三角形 UV 重心合法性，再对权威 `hair_d` 按 WebGPU `REPEAT` 语义进行线性双线性采样，应用 `v14dAuthority.js` 唯一导出的 `V14D_HAIR_TINT`，转换到显示字节后比较。正式 JSON 不使用整槽 `targetMean`。

本轮还闭合了同帧证据边界：`captureHairTriUv` 是单个原子 probe。它先快照 VMD 时间、播放/暂停、循环和 render-loop 状态，停止循环、暂停 VMD、flush 并固定渲染帧，然后在恢复前同时返回 canvas 显示 PNG、material-ID/depth、triId、插值 UV、triangleUvs 及 `captureId/currentSeconds/currentFrame`。调用方不再在 probe 外提前抓 Hair 正式 `v1Pix`；读回前后时间若推进则拒绝。original 与 V1 各自重建后加载同一 `koleda-v14d-authoritative-pose-f120.vmd`，pause+seek 到 `4s / frame 120 / 30 FPS`，报告硬断言两侧时间、帧和原子证据配对一致；最后按 `finally` 恢复原运行态。

本轮同时闭合五个修正项：纹理边界四邻域改为宽/高 modulo wrap；错槽负测改为交换另一槽完整真实 triUV 目标流并由正式误差自然拒绝；`captureHairTriUv` 建立 canvas+material-ID/depth+triUV 原子同停帧采集并在 `finally` 中恢复采集前 VMD 时间、播放状态和 render-loop 状态；original/V1 固定到同一权威时间/帧并硬断言配对；验收脚本改为读取 analyzer 完整 JSON，避免把精简 stdout 缺字段误判成分析失败。

## 正式逐槽结果

数据来自 `web/.scratch/reze-k3-v1-stage/visual-diff.json`：

| 槽位 | materialId | samples | coverage | origMae | v1Mae | drop | P95 orig→v1 | metric/formal Gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| HairA | 24 | 8,175 | 0.072625 | 24.554 | 17.341 | 0.2938 | 67→62 | true/true |
| HairB | 25 | 12,298 | 0.076909 | 49.429 | 34.197 | 0.3082 | 102.667→88.667 | true/true |

两槽 `targetBinding.consistent=true`、`inputsValid=true`，`targetV1MaePenalty=0`；本次正式回放两槽 `triUvResolution=1`，`rejectedNoTriUv`、`rejectedInvalidTri`、`rejectedBarycentric` 均为 0。输入门槛固定为 triUV 解析率至少 99.9%；即使边缘出现未解析像素，也必须保留解析率和三类拒绝计数，不能吞掉或包装成自然 Gate 失败。

## 修正项与真实负测

### REPEAT 边界

`web/src/features/stage/v14dHairPartition.js` 的四邻域采样索引现在在纹理宽、高方向分别 modulo。聚焦红绿测试覆盖 `u/v` 接近 0、接近 1、等于 1、负越界、正越界以及左右/上下首尾接缝；测试证明不是边缘 clamp。

### 错槽/错目标交换

命令：`node scripts/analyze-reze-k3-v1-diff.mjs --neg-swap-slot-target`

- analyzer exit=`1`；`negativeVerdict.status=rejected`，`semanticMismatch=true`；
- HairA/HairB `formalTargetGate=false`、`naturalMetricGate=false`；
- HairA/HairB `bindingInputsValid=true`，样本与目标样本均非零，triUV 解析率均为 1，三类拒绝计数均为 0；
- `analysisFailures=[]`；失败来自正式目标指标，而不是写入 `targetBinding.consistent=false` 自证；
- HairA：samples=8,175、targetSamples=15,141、drop=0.0582、`v1Mae=39.771`，同像素 canonical `v1Mae=17.341`，penalty=22.430，P95=81.667（canonical 62）；
- HairB：samples=12,298、targetSamples=11,162、drop=0.2246、`v1Mae=37.538`，同像素 canonical `v1Mae=34.197`，penalty=3.341，P95=87.383（canonical 88.667）。

交换失败保留在正式 `failures` 中，证明正式 Gate 非零阻断；`accept-reze-k3-v1-stage.mjs` 读取完整 JSON 后已正确将其识别为预期语义负测。

### wrongTint

命令：`node scripts/analyze-reze-k3-v1-diff.mjs --neg-wrongtint`

- analyzer exit=`0`；`negativeVerdict.status=rejected`；
- HairA/HairB 正式 Gate 均为 `false`，`failures=[]`、`analysisFailures=[]`；
- HairA 错误画布 `v1Mae=65.728`、drop=-1.6769；HairB `v1Mae=75.392`、drop=-0.5253。

### 采集状态恢复

`captureV14dHairRuntimeState` 保存 `animationName`、`currentSeconds`、`playing`、`paused`、`looping` 和采集前 render-loop 运行态。`captureHairTriUv` 的成功、提前返回和异常路径都经过 `finally` 恢复；播放状态使用无参 `model.play()` 后 seek 回原时间，暂停页面不被无条件启动 render-loop。聚焦测试覆盖暂停且 `currentSeconds=5.5`、播放且 `currentSeconds=2.25`、循环原本运行和原本未运行；新增原子证据测试在 pixel/triUV 时间推进或 original/V1 跨帧时明确拒绝，健康同帧证据通过。真实 G3 报告记录 original/V1 均为 `currentSeconds=4`、`currentFrame=120`、`playing=false`、`paused=true`，pair.ok=true。

## 修改文件

- `web/src/features/stage/v14dHairPartition.js`：REPEAT modulo 双线性采样。
- `web/src/features/stage/v14dHairCaptureState.js`：运行时快照/恢复纯函数。
- `web/src/features/stage/RezeWebGpuStage.tsx`：原子 canvas+material-ID/depth+triUV 采集、时间推进拒绝和 finally 恢复。
- `web/scripts/analyze-reze-k3-v1-diff.mjs`：自然错槽指标、canonical target、P95/输入证据和负测退出语义。
- `web/scripts/accept-reze-k3-v1-stage.mjs`：读取完整报告并严格验收 swap/wrongTint 协议。
- `web/tests/v14d-hair-partition.test.mjs`：REPEAT、错槽、状态恢复和原子跨帧拒绝聚焦测试。
- `docs/architecture/current-system-topology.md`、`workflow/concepts/v14d-hair-triuv-pixel-gate.zh-CN.md`、`workflow/workflow-glossary.zh-CN.md`：同步架构、概念、术语和边界。

`patch-reze-engine.mjs` 未新增手写 tint；它继续动态加载并验证 `web/src/features/stage/v14dAuthority.js`，`V14D_HAIR_TINT` 仍只有该模块作为权威来源。

## 实际验证与退出码

- `node --test tests/v14d-hair-partition.test.mjs tests/reze-k3-skin-variant.test.mjs`：exit=`0`，30/30。
- `node --check scripts/accept-reze-k3-v1-stage.mjs`：exit=`0`。
- `node --check scripts/analyze-reze-k3-v1-diff.mjs`：exit=`0`。
- `node scripts/patch-reze-engine.mjs --self-test`：exit=`0`，隔离 fixture 首次/二次幂等和全部负测通过，真实 `node_modules` hash 不变。
- `node scripts/patch-reze-engine.mjs --verify`：exit=`0`，72 项严格不变量通过。
- `npm run build`：exit=`0`，Next.js 编译、类型检查和静态页生成通过；构建产生的 `next-env.d.ts` 临时 `.next-codex-build` 指向已恢复为 `.next-codex-dev`，未提交副作用。
- `node scripts/analyze-reze-k3-v1-diff.mjs`：exit=`0`，正式 HairA/HairB Gate 通过。
- `node scripts/analyze-reze-k3-v1-diff.mjs --neg-swap-slot-target`：exit=`1`，真实错槽自然拒绝。
- `node scripts/analyze-reze-k3-v1-diff.mjs --neg-wrongtint`：exit=`0`，wrongTint 预期拒绝协议通过。
- `node scripts/accept-reze-k3-v1-stage.mjs`：exit=`0`，真实 `/companion` G1、G2、G3、G4、G5、G6 全部 pass。G5 的 original/V1 播放、暂停、seek、自然完成、提前停止负测、慢旧请求竞态和过期完成回调均通过。
- `git diff --check`：exit=`0`。
- 临时服务使用 `node scripts/run-next.mjs dev --hostname 127.0.0.1 --port 3114` 启动，验收后已停止，端口 3114 已确认空闲；本次回放 G1-G6 的真实 exit=0。

## 证据产物

以下产物保留在忽略目录 `web/.scratch/reze-k3-v1-stage/`，不进入提交：

- `g3-hair-material-mask.png` / `g3-hair-material-mask.json`；
- `g3-hair-tri-uv.json`；
- `g3-hair-hairA-triuv-target.json`、`g3-hair-hairA-triuv-target-heat.png`；
- `g3-hair-hairB-triuv-target.json`、`g3-hair-hairB-triuv-target-heat.png`；
- `g3-hair-front-orig.png`、`g3-hair-front-v1.png`、`g3-hair-back-orig.png`、`g3-hair-back-v1.png`；
- `visual-diff.json`、`visual-diff-swap-slot-target.json`、`visual-diff-wrongtint.json`、`gate-report.json`。

## 范围边界与遗留风险

- 本票只迁移 HairA/HairB BaseColor；视角相关高光、各向异性、Roughness/Specular、ToonRamp、ShaderToRGB 和完整 Blender 最终着色不在本票。
- 未修改 PMX、VMD、骨骼、权重、Morph、IK、Grant、Physics、拓扑或材质槽；Face、BodySkin、衣服、装备、武器、K3 灯光、星空、自由相机、动态 VMD/物理/播放链保持既有行为。
- 诊断探针默认关闭，仅 `?v14dAcceptanceProbe=1` 暴露；默认生产入口探针泄漏检查通过。
- 本轮未运行全量 `node` 测试套件；已运行票据相关 30/30 聚焦测试和真实 `/companion` 端到端 Gate，不能把聚焦结果外推为全量测试通过。
- 大 PNG、triUV 原始 JSON 和临时 `.scratch` 目录均未提交；最终分支 HEAD 不在本文内自引用，交付时由来源主会话读取结构化字段 `final_branch_head_at_delivery`，再核对本分支终态 HEAD、diff 和提交接收。
