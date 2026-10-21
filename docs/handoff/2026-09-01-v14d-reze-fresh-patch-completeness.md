# Stage 2B-P1｜reze-engine fresh-patch 注入完整性

- 日期：2026-09-01
- 状态：**完成**（本票 fresh-patch Gate 已闭合）
- 来源主会话：`01a036ca-f4cc-7b22-8482-b4e72b231053`，`hostId=local`
- 项目：`source_project_id=local-140a2801b88e7626327b2eb4694a8b91`，`project_binding_verified=true`
- 工作目录：`E:\codexWorktree\425f\MMD project`
- 分支：`codex/v14d-reze-fresh-patch-completeness`
- 冻结基线：`base_ref=codex/v14d-face-state2-runtime`，`base_commit=4a97096bd2724b2cd5bf295c1881c7c3b2a19efc`
- 初始实现提交：`d5691bd060d60872a90c62364e0118632b8cfd74`
- 本轮验收修正提交：`d011f3423820f76ffd156661649caac769d21425`

## 1. 交付行为与范围

`web/scripts/patch-reze-engine.mjs` 现在能从干净的 `reze-engine@0.26.0` 确定性重建 Stage 2B 所需的生产注入，并在补丁目标缺失、锚点不唯一、marker 重复或严格不变量不完整时非零退出。

本票只修改了：

- `web/scripts/patch-reze-engine.mjs`
- `web/scripts/gate-v14d-state2-override-regression.mjs`
- `web/scripts/gate-v14d-reze-patch-runtime-completeness.mjs`
- `docs/architecture/current-system-topology.md`
- 本交付报告

未修改 PMX/VMD、动画运行时、骨骼/权重/Morph/IK/Grant/Physics、动画时钟、拓扑、材质槽、视觉颜色或灯光；没有把 `node_modules` 第三方文件作为交付改动提交。

## 2. 真实红灯与根因链

修复前执行 `node web/scripts/patch-reze-engine.mjs --self-test` 时，外层命令错误地返回 exit=0 并打印成功；但其真实隔离的 `reze-engine@0.26.0` fixture 首次、二次生产补丁均为 exit=1。严格校验暴露约 17 个 fresh 注入缺口，集中在 materialAuxTextures 类型、断点 A 的 override/import/接线、断点 B 的 binding(5) baseEntries/重绑，以及 bind-group layout。原 self-test 还把子进程失败降格成 info。

按诊断纪律建立红灯后，形成并验证了以下候选根因：

| 候选 | 预测 | 单变量实验与结论 |
| --- | --- | --- |
| 完成 marker 共用导致同文件 target 互相跳过 | 实现 target 注入后类型 target 被误判为已完成，fresh 只剩部分 marker | 将实现/类型拆成独立 marker；fresh fixture 的缺失 marker 消失，假设成立 |
| compile/assembleModule 同一行由多个顺序 replace 竞争 | 某个 target 先执行后会让后续 target 找不到原 anchor，结果依赖顺序 | 合并成单一结构化 target，一次完成 override 与 State2 tag 门控；首次/二次均稳定 |
| `assignDrawCallGroups` 重绑丢掉 binding(5) | 初次材质可能有 mask，样式重绑后 mask 消失 | 仅加入 `baseBindGroupEntries` 展开并门控 fallback；断点 B 回归全绿 |
| binding(5) 已预留但 resource 可为 undefined | 普通材质仍会把无效资源交给 GPU，因为旧 fallback 只判断 binding 是否存在 | baseEntries 初始写入 fallback，createMaterialBindGroup 再按 resource 归一化；聚焦运行时 Gate 13 项全绿 |
| fresh 0.26.0 layout 说明文字可变 | 以整段说明文字为 anchor 会在干净 tarball 上 miss | 改为结构闭合行/结构化 block anchor；fresh 首次注入通过 |
| override 行格式与 WGSL helper 位置不稳 | 分号/注释位置或 `\n` 语义不符会静默不覆写；helper 在 prelude 后会形成函数嵌套 | 使用真实换行的完整行替换，并把 helper 放在 prelude 前；A/C 回归全绿 |

根因链为：原 self-test 未传播真实 fixture 失败 → fresh install 缺少手工修正 target → 部分 target 由共享 marker/顺序竞争静默跳过；同时运行时存在 binding(5) 重绑丢失、layout anchor 脆弱和 WGSL helper 错位风险。

### 主会话验收追加红灯

主会话验收进一步在当前已交付状态复现了 P0：直接执行实际 dist `createMaterialBindGroup`，对普通/default 材质传入含 `binding:5` 但 `resource: undefined` 的 `baseEntries`，结果仍为 undefined，原 fallback 条件因“binding 已存在”而不执行。聚焦 Gate `node web/scripts/gate-v14d-reze-patch-runtime-completeness.mjs` 修复前连续两次 exit=1，失败信号为 `normal/default ... resource 非 undefined/null`。

同时确认旧 PMX 文本长度补丁仍在 manifest 外静默 `continue`；这与报告中“全部生产注入统一硬失败”的承诺不一致，也纳入本轮修正。

## 3. 实现结果

- 所有生产注入（包括旧 PMX 文本长度补丁）统一走 `applyPatchManifest()`；每个 target 支持互斥 anchor，但必须恰好匹配一个，0 个或多个均记录失败。
- binding(5) 在 baseEntries 初始构造和 `createMaterialBindGroup` 汇合点双重保证：无 aux 材质使用有效 fallback GPUTextureView，aux 材质保留真实 mask view；已有/缺失/空 resource 都归一化为恰好一个有效资源。
- `--self-test` 使用真实 npm tarball 构造临时干净 fixture，子进程首次/二次退出码均被检查；不再把 fixture 非零降为 info。
- strict verify 在普通补丁、predev、prebuild 和 `--verify` 共用，当前 58 项严格不变量满足预期计数：56 个注入 marker 恰好一次，2 个旧 PMX 移除 marker 为 0 次。
- fresh 注入覆盖 `materialAuxTextures` 类型、断点 A 的 `v14dState2OverrideFsBodyFixed`/compile import/调用接线、断点 B 的 binding(5) baseEntries/fallback/重绑展开、bind-group layout，以及 src/dist 两条路径。
- 真实 `web/node_modules` 只读校验或由脚本按需重打；没有手工改第三方文件。

## 4. Fresh fixture 与负测 Gate

fixture 来源为干净 `reze-engine@0.26.0` npm tarball。

| 检查 | 实际结果 |
| --- | --- |
| 首次生产补丁 | exit=0 |
| 二次生产补丁 | exit=0 |
| 二次文件哈希 | 与首次补丁后完全相同 |
| 必需 marker | strict verify 58 项满足预期计数（注入=1，PMX 移除=0） |
| 全 target 二次哈希 | 覆盖 11 个 src/dist engine、slots、compile、engine.d.ts、composite、pmx-loader 文件，逐项不变 |
| 断点 C helper/prelude 顺序 | src/dist 均 helper 在 prelude 前 |
| anchor-miss | 被拒绝，exit=1 |
| missing-file | 被拒绝，exit=1 |
| 重复 marker | 被拒绝，exit=1 |
| 断点 A 缺失 | 被拒绝，exit=1 |
| 断点 B 缺失 | 被拒绝，exit=1 |
| PMX 长度补丁 anchor-miss | 被拒绝，exit=1 |

关键命令：`node web/scripts/patch-reze-engine.mjs --self-test` → exit=0，并输出 `PATCH-SELF-TEST-OK`；成功文案明确列出六类负测，且全部从干净 tarball seed 构造。

## 5. 实际验收命令

- `node --check web/scripts/patch-reze-engine.mjs` → exit=0。
- `node --check web/scripts/gate-v14d-reze-patch-runtime-completeness.mjs` → exit=0。
- `npm ci --no-audit --no-fund`（`web/`）→ exit=0，45 个包。
- `node web/scripts/patch-reze-engine.mjs` → exit=0；随后 `--verify` → exit=0，58 项严格不变量满足预期计数。
- `node web/scripts/gate-v14d-reze-patch-runtime-completeness.mjs` → 修复前连续两次 exit=1；修复后 exit=0，13 项实际 src/dist 绑定资源断言通过。
- 实际 `web/node_modules/reze-engine` 关键文件（`src/dist` 的 `slots`、`compile`、`engine`）补丁前后 SHA256 相同。
- `node web/scripts/gate-v14d-state2-override-regression.mjs` → exit=0，`OVERRIDEREGRESSION-OK`，26 项断点 A/B/C 断言通过。
- `$env:V14D_CAPTURE_ORIGIN='http://127.0.0.1:3104'; node web/scripts/probe-v14d-face-default.mjs` → exit=0，`DEFAULT-GATING-OK`；`faceStaticMain=false`、无徽章、无资产注入、无页面错误。首次使用其他工作树占用的 3100 端口曾产生环境假失败，改用本票工作树 3104 后通过。
- `$env:V14D_CAPTURE_ORIGIN='http://127.0.0.1:3104'; node web/scripts/probe-v14d-vmd-runtime.mjs` → exit=0，`VMD-RUNTIME-PROBE-OK`；真实 load→play→pause→seek，seek 到 `2.000s`。
- `npm run build`（`web/`）→ exit=0，Next.js 生产构建完成。
- `git diff --check` → exit=0。
- 相对冻结基线的 PMX/VMD/动画运行时文件 diff 为空。

## 6. Stage 2B-M1 数值口径修正

拓扑文档已将 Stage 2B-M1 的最终修正轮数值统一为实际 Gate 结果：

- `faceShadowOnly`：`[88.20,90.23,71.00]`
- `finalFaceComposite`：`[75.58,34.53,31.98]`

修正前的 `[58.41,54.83,62.96]` / `[50.96,26.51,29.41]` 仍作为历史中间记录标注保留；本票没有放宽 MAE 阈值，也没有改写 Stage 2B-M1 的阻塞结论。

## 7. 未完成项与风险

- 本票没有未完成的 fresh-patch 交付项。
- Stage 2B-M1 完整 Face 视觉 MAE 仍是既有阻塞项，本票只修复依赖补丁的 fresh 可重建性，不宣称视觉 Gate 已解决。
- 补丁 target 绑定 `reze-engine@0.26.0` 的结构；未来上游升级若改变这些结构，新的 anchor-miss 会按设计硬失败，需要更新 manifest 与 fixture Gate。
- `.next`、Playwright 临时 profile 和本票运行产生的临时 scratch 报告未纳入提交。

## 8. 交付握手

- 初始实现与拓扑提交于 `d5691bd060d60872a90c62364e0118632b8cfd74`；本轮验收修正提交于 `d011f3423820f76ffd156661649caac769d21425`；本报告随票据最终文档提交。完成后停止写入并向来源主会话发送同内容结构化交付。
