# Stage 2C-M1.2 Hair Gate 固定帧与独立命令契约交付

- 票据：`codex/v14d-hair-gate-contract`
- 来源任务：`01a036ca-f4cc-7b22-8482-b4e72b231053`，hostId=`local`
- 来源项目：`local-140a2801b88e7626327b2eb4694a8b91`
- 项目归属：`project_binding_verified=true`；任务 projectId 与来源项目精确一致
- 工作目录：`E:\codexWorktree\cf8e\MMD project`
- 基线：`base_ref=codex/v14d-hairab-triuv-gate`，`base_commit=f89760df122845517c535841c136e4a0c5db34e8`
- 交付分支：`codex/v14d-hair-gate-contract`
- 日期：2026-09-03

## 交付结论

已收口 HairA/HairB 正式 Gate 契约，不改变 HairA/HairB 视觉公式。`V14D_HAIR_AUTHORITATIVE_CAPTURE` 固定为 `currentSeconds=4`、`currentFrame=120`、`fps=30`、`fpsProvenance="vmd-standard-fixed-30"`、`animationName=koleda-v14d-authoritative-pose-f120.vmd`。`validateV14dHairCapturePair` 逐侧验证 pixel↔triUV 原子证据，再执行绝对秒数、帧号、有限且精确为 30 的 fps、合法 provenance 和非空精确动画名校验；双方同时缺失/错误 fps、错误来源、frame0、错误秒数或同时空/错名不会因彼此相等而通过。

G3 报告现在记录 requested/actual seconds、frame、fps、animationName、每侧 pixel/triUV 的 fps 与 `fpsProvenance`、original/V1 captureId 和 pixel↔triUV pair；硬 Gate 消费原子证据中的这些字段。accept 另外保存 `g3-hair-original-atomic.json` 与 V1 原子摘要，包含 `captureEvidence`、`captureState`、采集前后进度和 HairA/HairB 材质样本/解析计数，不复制 analyzer 不需要的 original 大型 triUV 数组。

## 验收修正

同一 Gate 契约 failure family 的第一次修正闭合了 fps 缺失绕过：原子 probe 生成时直接写入 `fps=30` 与 `fpsProvenance="vmd-standard-fixed-30"`，pixel/triUV 在同一 `captureId` 内共享；accept 删除按 `frame/seconds` 派生 fps 的补造职责。四份证据缺失 fps、同错 24、NaN、Infinity、缺失 provenance 或错误 provenance 均由正式 Gate 拒绝。

同一 failure family 的第二次也是最后一次修正闭合了非法画布尺寸绕过：pixel/triUV 的 width、height 必须各自为有限正整数，且同一原子 pair 内相等；四份证据任一为 null、undefined、NaN、Infinity、0、负数或非整数均由正式 Gate 拒绝。

独立 analyzer 的 Hair 默认输入已改为 `g3-hair-original-canvas.png` / `g3-hair-v1-canvas.png`；legacy `g3-original-canvas.png` / `g3-v1-canvas.png` 只用于 Face/BodySkin/场景稳定性 lane。accept 内部明确删除 Hair 画布环境覆盖，不能依靠 `V14D_HAIR_ORIG_CANVAS` / `V14D_HAIR_V1_CANVAS` 通过正式默认路径。

## 修改文件

- `web/src/features/stage/v14dHairCaptureState.js`：固定权威采集常量、fps provenance 与绝对 pair 校验。
- `web/src/features/stage/RezeWebGpuStage.tsx`：原子 probe 直接生成 fps/provenance 证据。
- `web/scripts/accept-reze-k3-v1-stage.mjs`：固定 Hair 采集口径，记录报告审计字段，持久化 original/V1 原子摘要，正式 analyzer 不注入 Hair 画布覆盖。
- `web/scripts/analyze-reze-k3-v1-diff.mjs`：Hair 默认消费原子画布；legacy 画布保留给非 Hair 场景 lane；合并 Hair ROI 也消费正式 Hair 画布。
- `web/tests/v14d-hair-partition.test.mjs`：先红后绿覆盖健康固定帧、四份 fps 缺失/同错 24/NaN/Infinity/null、provenance 缺失/错误、四份非法画布尺寸、双方 frame0、双方错误秒数、双方空/错名及 captureId/时间错配，并检查 producer/report wiring。
- `docs/architecture/current-system-topology.md`、`workflow/concepts/v14d-hair-triuv-pixel-gate.zh-CN.md`、`workflow/workflow-glossary.zh-CN.md`：同步 M1.2 契约、默认产物和边界。

未修改生产 Hair tint/graph、Face/BodySkin、灯光/星空/相机、VMD/物理、PMX、材质槽或拓扑。

## 实际验证

所有命令均在本票工作树执行；analyzer 与独立命令的 cwd 为 `web/`。

- `node --test tests/v14d-hair-partition.test.mjs`：exit=0，21/21，通过后无跳过项；覆盖四份 fps 缺失/同错 24/NaN/Infinity/null 与 provenance 缺失/错误。
- `node --check scripts/accept-reze-k3-v1-stage.mjs`：exit=0。
- `node --check scripts/analyze-reze-k3-v1-diff.mjs`：exit=0。
- `node scripts/patch-reze-engine.mjs --self-test`：exit=0。
- `node scripts/patch-reze-engine.mjs --verify`：exit=0，72/72 marker 通过。
- `npm run build`：exit=0，Next 编译、类型检查和静态页生成通过。
- 首次未启动服务的 accept 预检得到 `ERR_CONNECTION_REFUSED`；按既定命令 `node scripts/run-next.mjs dev --hostname 127.0.0.1 --port 3114` 启动后复跑 `node scripts/accept-reze-k3-v1-stage.mjs`：exit=0；全新 `127.0.0.1:3114` 的 /companion G1-G6 全部 pass，服务随后停止。
- 无 `V14D_HAIR_*` 环境变量的 `node scripts/analyze-reze-k3-v1-diff.mjs`：exit=0；HairA/HairB `formalGate=true`。
- 无 `V14D_HAIR_*` 环境变量的 `node scripts/analyze-reze-k3-v1-diff.mjs --neg-swap-slot-target`：exit=1；两槽 `naturalMetricGate=false`、`bindingInputsValid=true`、`analysisFailures=[]`，失败来自 v1Mae/P95 自然指标。
- 无 `V14D_HAIR_*` 环境变量的 `node scripts/analyze-reze-k3-v1-diff.mjs --neg-wrongtint`：exit=0；`negativeVerdict.status=rejected`，两槽正式 Gate=false 且无分析失败。
- `git diff --check`：exit=0。

`gate-report.json` 实际审计字段：requested 与 original/V1 actual 均为 4 秒、120 帧、30 FPS、`fpsProvenance="vmd-standard-fixed-30"`、`koleda-v14d-authoritative-pose-f120.vmd`；original captureId=1、V1 captureId=2，四份 pixel/triUV evidence 均分别记录 fps/provenance，双方 pixel↔triUV pair 均 `ok=true`。original 原子摘要的材质键为 HairA/HairB，并含 `captureEvidence`、`captureState` 和解析计数。

## 证据产物

正式 PNG、triUV 数组、热图、visual-diff 和 gate-report 保留在忽略目录 `web/.scratch/reze-k3-v1-stage/`，不进入 Git。关键文件包括：

- `gate-report.json`
- `g3-hair-original-atomic.json`
- `g3-hair-v1-atomic-summary.json`
- `g3-hair-original-canvas.png`、`g3-hair-v1-canvas.png`
- `visual-diff.json`、`visual-diff-swap-slot-target.json`、`visual-diff-wrongtint.json`

## 风险与边界

- 本票只固定 Hair BaseColor 的正式采集与 analyzer 契约，不覆盖视角相关高光、各向异性、Roughness/Specular、ToonRamp、ShaderToRGB 或完整 Blender 最终着色。
- 未运行全量 Node 测试套件；21/21 为票据聚焦测试，不能外推为全量测试通过。
- 构建前新 worktree 没有依赖目录；已在本地执行锁文件一致的 `npm ci`，并使用同版本已验证的忽略依赖补丁副本完成构建。该环境准备不改变提交内容。
- 本文件不自引用最终提交 SHA；最终分支 HEAD 由发送给来源任务的结构化交付字段 `final_branch_head_at_delivery` 记录并由来源主会话验收。
