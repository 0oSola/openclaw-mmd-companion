# Stage 2C-M2a.3：Brows/Lashes 显示链诊断交付

## 状态与边界

- 状态：本轮显示链修正已完成，等待主会话按提交和双轴审查结果进行最终验收。
- cwd：`E:/codexWorktree/5b40/MMD project`。
- ticket branch：`codex/v14d-brows-lashes-display-chain`。
- base commit：`2fe3af77b99e2f34ee80453a08671e1a90af1278`。
- 本轮起始 HEAD：`456e081349c8d4965994fbc60dec516e15515461`。
- 票据边界：只诊断和修正 acceptance-only Brows/Lashes 显示链；不修改正式 identity tint、其他材质公式、灯光/星空/曝光/gamma/tone mapping/相机、PMX/VMD/Morph/骨骼/物理、alpha analyzer 或正式视觉阈值。

## 1. 问题与根因

Stage 2C-M2a 已证明 graph/WGSL/compile-install pipeline 成功，但这不等于目标 draw 使用了新 pipeline，也不等于最终 canvas 已更新。最小冻结帧复现确认首个丢失边界为：

`applyStyleGroups` 返回之后 → 下一次 `renderFrame`/command submission 之前。

H1 被确认：render loop 被停止后没有新的真实帧提交。H2 pipeline cache/signature 复用、H3 stale draw rebind、H4 HDR resolve/composite/tone mapping 覆盖、H5 采集/重建撤销 sentinel 均被实际 trace、HDR/canvas 或错误计数证伪。健康路径在冻结循环中补一次 `engine.renderFrame(0)` 后，Brows/Lashes 实际 draw、pre-tonemap HDR、resolve/composite 后的 canvas 都出现强 sentinel 差异。

## 2. 观测身份契约

- `pairId=v14d-bl-pair` 只表示 identity、identity-control、sentinel 的固定对照组。
- identity：`captureId=v14d-bl-pair-identity`；identity-control：`captureId=v14d-bl-pair-identity-control`；sentinel：`captureId=v14d-bl-pair-sentinel`。三侧 captureId 各自唯一。
- 每侧报告自己的 `captureId`、`requestSerial` 和 trace `frame=120`；一次 `captureId/frame` 请求至多对应一个 observed render frame。
- `requestSerial` 只用于防止旧 trace 假阳性，不承担跨观测身份。

## 3. 证据与修正

- `RezeWebGpuStage.tsx` 仅在 `?v14dAcceptanceProbe=1` 下挂载只读 trace；卸载时恢复 wrapper。报告的 `displayChain`/`stageDeltas` 将每侧 `captureId`、`requestSerial`、`frame` 与 trace、HDR resolve、composite、最终 canvas 绑定；三类页面/网络错误计数必须为 0。
- acceptance probe 在三次采集前停止 render loop，identity-control 建立非目标区域噪声基线；健康 sentinel 只提交一次零增量帧，故障注入使用 `render:false`。
- `v14dDisplayChainEvidence.mjs` 以 `materialName`、`groupId`、`type`、`count`、`firstIndex` 及顺序建立绘制身份；range 候选为零或多于一个时分别拒绝 unmatched/ambiguous。生产 `drawIndex` 与实际 `drawOrder` 分开记录。
- Brows/Lashes 各恰好一个唯一 match，生产 `drawIndex` 非空，实际 pipeline 必须等于 compile/install pipeline，bind group、draw range、目标相对顺序必须一致。重复/未匹配纯函数负测已锁定。
- 非目标 canvas 统计固定使用 identity 的 material-ID mask：报告 samples、changed、changedRatio、meanAbsRgbSum、maxAbsRgbSum、P95，并同时报告 identity-control 噪声基线；sentinel 与基线均受固定诊断预算硬约束，不通过扩大 mask 或放宽正式阈值。

## 4. 实际健康证据

证据：`web/.scratch/repro-v14d-brows-lashes-display-chain/final-correction-healthy-dynamic-final/report.json`。

- identity：`captureId=v14d-bl-pair-identity`、`requestSerial=1`、trace `frame=120`、`renderObserved=true`、pipeline `gpu-1`。
- sentinel：`captureId=v14d-bl-pair-sentinel`、`requestSerial=3`、trace `frame=120`、`renderObserved=true`、compile/install 与实际 Brows/Lashes draw pipeline `gpu-36`。
- Brows HDR resolve 红通道均值：`0.162648 -> 0.026491`，绝对差 `0.136157`；Lashes：`0.077978 -> 0.019728`，绝对差 `0.05825`。
- 目标 canvas：samples `10844`、changedRatio `0.918941`、meanAbsRgbSum `41.792051`、P95 `159`。
- 非目标 canvas：samples `1162136`、changedRatio `0.007`、meanAbsRgbSum `0.600659`、max `765`、P95 `0`；identity-control 噪声基线为 `0.005562`/`0.401686`，超额为 `0.001438`/`0.198973`。
- identity/sentinel composite pipeline 都为 `gpu-35`、gamma 都为 `1`；两侧 HDR NaN/Infinity 均为 `0`。
- page error、failed request、HTTP bad response 均为 0。

## 5. 红灯与历史事实

- 当前可重复 no-commit 红灯：`node scripts/repro-v14d-brows-lashes-display-chain.mjs --fault-no-render`，证据 `web/.scratch/repro-v14d-brows-lashes-display-chain/final-correction-fault-no-render-dynamic-final/report.json`；`applied.ok=true`、sentinel compile/install pipeline 为 `gpu-36`，但 `renderObserved=false`、trace 回到 identity-control、HDR 与目标 canvas 保持旧提交帧，机器拒绝。
- 历史 `web/.scratch/repro-v14d-brows-lashes-display-chain/report-red-before-fix.json` 的真实 `canvas meanAbsRgbSum=8.663076`、`changedRatio=0.268802`，不是严格 no-effect；准确口径是“强 sentinel 未达到正式拒绝阈值，且缺少实际新帧 render 证明”。
- 历史健康报告不能再描述 identity/sentinel 共用 captureId；当前报告以 `pairId` 关联、各侧 captureId 独立。

## 6. 假设与证伪

| 假设 | 可证伪预测 | 实际结果 |
| --- | --- | --- |
| H1 冻结帧缺少新的 `renderFrame`/提交 | 补一次零增量帧后实际 draw、HDR、canvas 变化 | 确认；健康 exit 0，故障 `renderObserved=false` |
| H2 pipeline cache/signature 复用旧对象 | identity/sentinel compile-install 或实际 draw pipeline 相同 | 证伪；`gpu-1` 与 `gpu-36` 不同 |
| H3 apply 后 draw group/pipeline 未重建 | 实际 `setPipeline` 仍为 identity | 证伪；健康 sentinel 实际 draw 为 `gpu-36` |
| H4 后续 pass 覆盖 | HDR 变化但 resolve/composite/canvas 不变化 | 证伪；`stageDeltas.hdrResolve.allSlotsChanged=true`、`compositeTarget.changed=true`、composite pipeline/gamma 稳定 |
| H5 采集/重建撤销 sentinel | graph/tint/pipeline 回退或出现错误 | 证伪；sentinel graph/tint/实际 draw pipeline 保持，错误计数为 0 |

故障报告只验证“无新提交帧”负测：H1 为 `confirmed`，H2–H5 为 `not-evaluated`，因为没有合法的 sentinel observed draw，不能把旧 trace 当作 H2–H5 的证伪证据。

## 7. 实际命令与结果

| 命令 | 结果 |
| --- | --- |
| `node scripts/repro-v14d-brows-lashes-display-chain.mjs` | exit 0；`final-correction-healthy-dynamic-final/report.json` |
| `node scripts/repro-v14d-brows-lashes-display-chain.mjs --fault-no-render` | exit 1；`final-correction-fault-no-render-dynamic-final/report.json` |
| `node --check scripts/repro-v14d-brows-lashes-display-chain.mjs` | exit 0 |
| `node --check src/features/stage/v14dDisplayChainEvidence.mjs` | exit 0 |
| `node --test tests/v14d-brows-lashes-partition.test.mjs tests/v14d-hair-partition.test.mjs tests/reze-k3-skin-variant.test.mjs tests/v14d-display-chain-evidence.test.mjs` | exit 0；48 tests，47 pass，1 个既有 triUV skip |
| `node scripts/patch-reze-engine.mjs --verify` | exit 0；基线 87 项全部通过 |
| `node scripts/patch-reze-engine.mjs --self-test` | exit 0；fresh fixture 幂等和负测全部通过 |
| `npm run build` | exit 0；Next.js 编译、类型检查、静态页生成通过；随后已恢复 `web/next-env.d.ts` 的 `.next-codex-dev` 生成路径 |
| `node scripts/probe-v14d-vmd-runtime.mjs`（`V14D_CAPTURE_ORIGIN=http://127.0.0.1:3000`） | exit 0；默认非 acceptance 入口完成 load→play→pause→seek 到 `2.000s`，无 probe/资产泄漏 |
| `git diff --check` | exit 0（仅 Windows 换行提示） |

## 8. P1 设计判断

`RezeWebGpuStage.tsx` 中约 313 行 acceptance trace 闭包暂保留。它只在显式开关下挂载、只读、卸载时恢复 wrapper，不进入默认生产路径；本轮优先保证真实 draw/HDR/canvas 证据与根因闭合。为形式重构成独立深模块会扩大生产接线和时序风险，故本轮作为有边界的 Standards 判断项保留，后续若继续扩展显示链证据再单独重构。

## 9. 未运行项与风险

- 本轮已完成 `patch --verify/self-test`、48 项聚焦回归、`npm run build`、默认 VMD probe 和双轴复审；`npm run check:basic` 的旧字面量断言仍是基线既有失败，未纳入本票修正。
- 不同浏览器/WebGPU 后端的 HDR readback/队列时序矩阵未运行。
- full G1-G7/fast-bl、Lashes 透明边缘、Brows/Lashes 逐槽 identity-target 和动态 Morph Gate 不属于本票。
- `maxAbsRgbSum=765` 出现在透明/边缘单点噪声中，正式非目标硬断言使用 mean、P95、changedRatio 与 identity-control 基线；不得把该诊断统计外推为正式视觉阈值。

## 10. 修改文件与证据

- `web/scripts/repro-v14d-brows-lashes-display-chain.mjs`
- `web/src/features/stage/RezeWebGpuStage.tsx`
- `web/src/features/stage/v14dDisplayChainEvidence.mjs`
- `web/tests/v14d-display-chain-evidence.test.mjs`
- `workflow/concepts/v14d-display-chain-commit-boundary.zh-CN.md`
- `workflow/concepts/v14d-display-chain-draw-identity.zh-CN.md`
- `workflow/workflow-glossary.zh-CN.md`
- `docs/architecture/current-system-topology.md`
- 本 handoff 文件。
- `.scratch` 证据不提交，`node_modules` 不提交。
