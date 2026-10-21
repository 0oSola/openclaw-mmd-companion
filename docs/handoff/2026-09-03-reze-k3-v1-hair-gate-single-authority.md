# Stage 2C-M1.3｜Hair 正式 Gate 单一权威

- 日期：2026-09-03
- 状态：实现、聚焦测试、构建与真实 `/companion` 验收已完成，待来源主会话最终验收
- 来源任务：`01a036ca-f4cc-7b22-8482-b4e72b231053`
- 执行任务：`01a06682-e731-7820-aab6-afb6f5ff6158`
- 分支：`codex/v14d-hair-gate-single-authority`
- 实现提交：`d7fba50a`（`fix: make hair formal gate single authority`）

## 问题与边界

全新 3114 实跑中，HairA/HairB 正式 material-ID + 原子 triUV Gate 均通过，但旧合并矩形 `hair` ROI 的差异统计低于阈值，产生 `hairChanged=false`，从而错误阻断健康 analyzer，并把 swap-slot-target 负测污染为额外 `analysisFailures`。本票只收口 Gate 判定与报告消费，不降低 HairA/HairB 正式阈值，不改变 Hair tint/graph、生产渲染、Face/BodySkin、灯光/星空/相机、VMD/物理、PMX、材质槽或拓扑。

## 实现摘要

1. `web/scripts/analyze-reze-k3-v1-diff.mjs` 新增可执行纯函数 `evaluateV14dHairFormalGate`：HairA/HairB 每槽必须同时满足 `Changed=true`、`targetConvergence.formalGate=true`、`targetBinding.consistent=true` 和 `targetBinding.inputsValid=true`；两槽组合结果写入 `hairFormalGate.formalTargetGate` 与 `hairFormalGate.pass`。
2. 旧合并 `hair` ROI 保留为明确的 `diagnosticOnly=true`、`gateRole="report-only"`、`ignoredByFormalGate=true` 诊断，写入 `regions.hair` 与 `diagnostics.legacyAggregateHair`，不再进入正式失败或负测分析失败。
3. 新增 `evaluateV14dHairNegativeProtocol`，统一 swap-slot-target / wrongTint 的“自然指标拒绝 + 合法输入 + 无其他分析失败”协议。
4. `accept-reze-k3-v1-stage.mjs` 消费完整 `hairFormalGate`，正常 G3 要求两槽正式 Gate 均为 true；最终写入 `summary.exitCode`，关闭浏览器后再次显式恢复最终 `process.exitCode`。
5. 聚焦测试通过 `--self-test-hair-gate` 执行实际 analyzer 纯函数，不依赖源码字符串匹配。

## 验证证据

- TDD 红测：实现前 `node --test --test-name-pattern "Hair 正式 Gate 单一权威" tests/v14d-hair-partition.test.mjs` 失败，原因是新契约接缝尚不存在；实现后同命令通过。
- 聚焦/回归测试：`node --test tests/v14d-hair-partition.test.mjs tests/reze-k3-skin-variant.test.mjs` → 33 pass、1 skip（真实 triUV 负测由后续实际 analyzer 回放覆盖）、0 fail。
- 语法：`node --check scripts/analyze-reze-k3-v1-diff.mjs`、`node --check scripts/accept-reze-k3-v1-stage.mjs` 均 exit=0。
- 纯函数契约：`node scripts/analyze-reze-k3-v1-diff.mjs --self-test-hair-gate` exit=0；覆盖健康样本、任一槽 changed 失败、任一槽 targetConvergence 失败、swap 与 wrongTint 负测协议。
- 补丁门禁：`node scripts/patch-reze-engine.mjs --self-test` exit=0；`node scripts/patch-reze-engine.mjs --verify` exit=0，72 项严格不变量通过。
- 构建：`npm run build` exit=0。
- 完整真实验收：在全新 `http://127.0.0.1:3114/companion` 上运行 `accept-reze-k3-v1-stage.mjs`，显式保存并传播 `$LASTEXITCODE`，结果 `ACCEPT_LASTEXITCODE=0`；G1-G6 全部 `pass`，`summary.exitCode=0`。
- `gate-report.json`：requested/actual 均为 4 秒、frame 120、30 FPS、`vmd-standard-fixed-30`、`koleda-v14d-authoritative-pose-f120.vmd`；original/V1 pixel↔triUV pair 均 `ok=true`；实际画布尺寸为有限正整数 `1315×892`。
- 健康 Hair 正式 Gate：`hairFormalGate.pass=true`，HairA/HairB `formalTargetGate=true`；HairA samples=8175、triUvResolution=1，HairB samples=12283、triUvResolution=0.999919；合并 ROI 诊断明确为 report-only 且 ignored。
- 独立 analyzer（`web/` cwd，清除全部 `V14D_HAIR_*` 环境变量）：正常 exit=0 且 HairA/HairB formal=true；swap exit=1、`status=rejected`、两槽 formal/natural=false、bindingInputsValid=true、`analysisFailures=[]`；wrongTint exit=0、`status=rejected`、两槽 formal=false、`analysisFailures=[]`。
- 清理：3114 端口已确认空闲；`web/next-env.d.ts` 未进入 diff；`git diff --check` exit=0。

## 修改文件

- `web/scripts/analyze-reze-k3-v1-diff.mjs`
- `web/scripts/accept-reze-k3-v1-stage.mjs`
- `web/tests/v14d-hair-partition.test.mjs`
- `docs/architecture/current-system-topology.md`
- `workflow/concepts/v14d-hair-triuv-pixel-gate.zh-CN.md`
- `workflow/workflow-glossary.zh-CN.md`
- `docs/handoff/2026-09-03-reze-k3-v1-hair-gate-single-authority.md`（本交接报告）

## 剩余风险与交接动作

- 本票未执行 `npm audit fix`；依赖安装输出报告 4 个 high severity advisories，属于既有依赖风险，不是本票 Gate 回归。
- `.scratch/reze-k3-v1-stage/` 真实截图、GIF、JSON 产物保留在工作树供来源主会话检查，未纳入 Git。
- 执行任务已停止写入与服务；来源主会话应读取本提交及报告，复核 diff、正式命令和工作树后完成最终验收。
