# Reze K3 V1 皮肤阶段（V14D）生产路由存根环境视觉与 VMD 验收交付（第四轮收口）

**票据**：`codex/reze-k3-v1-stage-visual-acceptance`（来源 `codex/reze-k3-v1-acceptance-contract-cleanup`）
**执行模型**：kimi/k3-256k（视觉识别/真实浏览器验收）
**工作树**：`E:\codexWorktree\004b\MMD project`，分支 `codex/reze-k3-v1-stage-visual-acceptance`
**基线**：base_commit `6430ee11750c575620b70702ce755e99c9fad88e`
**完成时间**：2026-09-02（第四轮收口）

> **范围纠偏（第三轮）**：本票交付的是「**皮肤阶段**」——只迁移 Face + BodySkin 两个
> PMX 材质槽。最终目标是「Reze K3 + V14D 角色外观材质（**15 槽**）」，其余 13 槽
> （Brows、Lashes、Emotions、HairA、HairB、Eyes、EyeWhite、EyeShadow、Eyes+、
> UpperTeeth、LowerTeeth、Tongue、FingerNails）**本票未迁移**；Cth\* 衣物/装备与
> Glock、GunSilencer 武器**明确排除**、永久保持原始 Reze K3。详见文末「迁移范围」。

## 结论

**G1-G7 全部通过（存根环境端到端）**。生产路由 `/companion` 的存根环境端到端中，
「原始 Reze K3 / Reze K3 V1 皮肤预览（V14D）」切换在**保留 Reze K3 原有灯光与星空背景**的前提下
可用：V1 仅让 Face/BodySkin 材质响应接近 V14D State2 目标风格，用户相机、正常 VMD 播放、K3 灯光、
星空背景与非皮肤材质外观全部保留。**注意**：本结论基于 Playwright route 存根 API（本机无 Python、
API 后端不可达），是「存根环境端到端」而非真实部署生产端到端；V1 资格/绑定/渲染/VMD 均不依赖 API。

> **撤回声明（第一轮）**：第一轮「G1-G7 全部通过」被来源主会话撤回——彼时未在原 K3 舞台环境约束下
> 证明场景不变性，且缺少错误 graph / applyStyleGroups 失败负测、G3 仅算 verdict 未硬阻断、G6 软
> 通过、failedRequests 未入 Gate。第二轮按新硬约束重做并加严。

> **撤回声明（第二轮）**：第二轮结论再次被主会话部分驳回（P0）——(1) G3「收敛」只比较 original↔V1
> 差异、从未读取 V14D 目标参考，无法支撑「向目标收敛」；(2) 通用 VMD effect 的 `engine.resetPhysics()`
> 被误删；(3) G5 完整结束在 `k>8 且 !playing` 时恒置 `endReached=true`（软通过）；(4) 场景不变性
> 只在 V1 后读取一次、未在 original/V1 两侧逐字段硬断言；(Standards) `git diff <base>..HEAD --check`
> 在两文件末尾有 new blank line at EOF。第三轮逐项修复并加负测。

> **撤回声明（第三轮）**：第三轮结论再被主会话部分驳回（P0）——(1) 共享函数
> `loadVmdThroughInteractionPath` 把请求守卫破坏：`await loadVmd` 后直接
> apply/play/写 currentUrl/arm fallback/resetPhysics，调用方直到函数返回后才
> isCurrent(requestId)，较慢完成的旧请求已改写模型，守卫检查太晚；(2)
> `handleRezeVmdFinished` 在验证 `currentName===finishedName` 之前就自增
> `vmdNaturalFinishCount`，过期/错误名称回调也能充当完成证据，且提前停止负测只等
> 500ms、未超过 fallback 窗口；(3) 目标收敛把「整图肤色色比」当作对齐证据，未声明
> 候选指标口径；(4) topology 仍写「生产 /companion 端到端通过」、概念元数据仍是第二轮。
> 第四轮逐项修复并加竞态回归负测，结论以本轮为准。

> **撤回声明（第四轮）**：第四轮结论再被主会话部分驳回（P0）——(1) `handleRezeVmdFinished`
> 仍先 `clearVmdCompletionFallback()` 后才比较 `currentName!==finishedName`，过期/错误
> finishedName 回调虽不计数，却会清掉当前新动作已 arm 的 fallback；(2) 竞态 Gate 计算了
> `finishDelta` 但 `race.ok` 漏掉 `finishDelta===0`；(3) 提前停止负测报告文字与单字段
> `fallbackDelay=4350/waitMs=3650` 看似矛盾（实为 arm 后 1200+3650≈4850ms>4350ms），未显式输出
> 总观察时长。第四轮收口：身份/模型校验移到任何 clear/count/loop/reset/complete 副作用之前；
> `race.ok` 纳入 `finishDelta===0`，并新增可重复负向自验 `--self-test-g5-race`（healthy
> finishDelta=0→true/exit0，finishDelta=1→false/exit1；只验证判定函数、不外推生产运行时）；负测先硬断言
> `Number.isFinite(fallbackDelay) && fallbackDelay>0` 再断言 `totalObservedAfterArmMs` >
> fallbackDelay；过期完成回调负测改用**真实 A 名 `race-a.vmd`**（来自竞态回归的慢请求），
> 并记录 `vmdNaturalFinishName`：注入 A 后名称不得改为 A、B 完成后必须等于 B，证明完成计数
> 不增、currentName 仍为 B、B 的 fallback 保持 armed 未被清、B 后续仍正常完成。结论以本轮为准。

> **环境措辞**：本机无 Python，API 后端（127.0.0.1:8000）不可达，验收用 Playwright route 存根
> bootstrap API。因此本轮结论是「**存根环境端到端**」，不是真实部署生产端到端。V1 资格判定、
> graph 绑定、材质渲染、VMD 播放均不依赖 API（全部由前端 + 本地导入完成），API 仅服务于
> 会话/bootstrap 存根。

## 验收环境

| 项 | 值 |
| --- | --- |
| 页面 | 生产 `/companion`（非 `/mmd-calibration-render`），带 `?v14dAcceptanceProbe=1` 显式验收开关 |
| 端口 | 3114（本工作树独立 dev server） |
| 浏览器 | 系统 Chrome headless + Playwright（`--enable-unsafe-webgpu`） |
| 权威 PMX | `D:\mmd\克莱妲原皮\GirlsFrontline KoledaDefault.pmx` |
| 权威 VMD | `koleda-v14d-authoritative-pose-f120.vmd`（来源 `C:\w\rk3-face-v14d\web\public\assets\mmd\calibration\koleda-v14d\`），SHA256 `2536C886…` |
| State2 mask | `v14d-01234-face-shadow-state-2.png`，SHA256 `42D2F95AF877EBFA9D5266195742DCA95FE0463A8CB093B24A14717D2C33A103` |
| 导入方式 | 真实目录 `setInputFiles`（webkitdirectory），PMX/纹理/mask 同一 FileList |
| API 兜底 | Playwright route 拦截 `/api/backend/**` 与直连 `127.0.0.1:8000/**`（纹理从权威目录真实映射） |

## 门禁结果（gate-report.json）

| Gate | 状态 | 关键证据 |
| --- | --- | --- |
| G1 用户路径与切换 | ✅ pass | 导入后变体 UI 出现；点 V1 后 UI=v1、canvas=v1、faceGraph=V14D Face State2 Live Composite；切回 original 一致；failedRequests=0、httpBad=0（存根环境） |
| G2 真实绑定 + 负测 | ✅ pass | Face/BodySkin drawCalls 各 1/1 命中合成 graph；负测 original不命中/重命名PMX/缺mask/**错误graph(composite命中=0)**/**applyStyleGroups失败(回退original)** 全过 |
| G3 完整模型视觉 A/B | ✅ pass | 皮肤区（掩码采样）face MAE=31.4、neck=11.5、leftHand=23.6、rightHand=26.1 显著变化；**目标收敛**：V1 对 V14D 目标的色比距离 distOrig=0.196→distV1=0.141（drop=28.2%>15%）；非皮肤/星空稳定；waist 标 occluded |
| G4 持久化 | ✅ pass | V1 刷新+重导入后 UI=v1、canvas=v1；切回 original 刷新保持 original |
| G5 VMD 零回归 | ✅ pass | original 与 V1 各 play→pause→seek→**完整播放至结束**：finishBefore→finishAfter 自增（original 0→1、V1 1→2）+ nearTail，非软通过；负测提前停止不计数（totalObservedAfterArmMs=4859>fallbackDelay=4350）；竞态回归 A慢/B快 下旧请求 A 无副作用退出（retA=null、rpDelta=1、finishDelta=0、staleDelta=1）；过期完成回调负测证明其不清当前 fallback、不计数、当前动作仍正常完成；resetPhysics effect 计数=7 |
| G6 管线隔离 | ✅ pass | 切 reze-design 后真实克莱妲导入重建为 original，变体 UI 不显示、无资产/variant 残留（硬阻断，非软通过） |
| G7 工程门禁 | ✅ pass | `node --test reze-k3-skin-variant` 12/12、`npm run build` 通过、patch `--self-test` 62 项、`git diff --check` 干净 |

## 新视觉 Gate（第二轮硬约束，全部由分析脚本以退出码硬阻断）

| Gate | 含义 | 结果 |
| --- | --- | --- |
| A Scene invariance | original/V1 用完全相同 K3 scene/灯光/星空/相机/Bloom/VMD frame | ✅ 探针在 original 与 V1 **两侧**各捕获 settings/grade/gradeIntensity/backgroundEffect/transparentBackground 并**逐字段 JSON 硬断言一致**；星空暗空像素 maxMeanDiff=0.000 |
| B Material-only calibration | 只调 Face/BodySkin 的 V14D graph/参数；禁全局曝光/gamma/tone mapping/灯光/背景 | ✅ 仅 Face/BodySkin 走 V14D 合成 graph，其余材质/全局显示链不变 |
| C 同相机同帧三联图 | original K3 / V1 / diff | ✅ `g3-triptych-labeled.png`；diff 图仅脸部亮、手部微亮、其余全黑 |
| D 隔离 Gate | 头发/衣服/装备/星空保持 original；皮肤向目标收敛 | ✅ 非皮肤 meanMeanDiff 0.09–0.34（≪皮肤 25–36）；皮肤对 V14D 目标**整体色比**距离显著下降（候选指标口径，见 G3/阈值节） |
| E 自由相机与动态 VMD | 不带入固定相机/frame锁定/暂停/stopRenderLoop | ✅ 验收全程用户相机 + 正常 VMD 播放，未用任何诊断固定帧/锁相机 |

### 阈值（visual-diff.json 显式定义，脚本硬阻断）
- 皮肤变化：掩码采样 MAE>1 且 maxMeanDiff>1，且掩码像素数 ≥20（防手部无皮肤假通过）。
- **皮肤向目标收敛（P0-1，第三轮；脸部综合色比候选指标，非同像素/非空间阴影对齐）**：
  用**色比 (R/G, R/B)** 口径（对 K3 舞台灯光强度不敏感），目标侧取整图 isSkin 肤色像素、
  舞台侧取舞台脸框 isSkin 像素（两者样本空间不同、未做 UV/空间配准）。该指标只证明 V1 脸部
  皮肤整体色比比 original 更接近 V14D 目标，**不**证明 State2 空间阴影已逐像素对齐，
  **不**作为皮肤阶段最终完成判据；目标 SHA256 与两侧样本分母记录在 visual-diff.json 的
  `targetMetric` 字段。
  比较 original 与 V1 各自对 V14D 目标参考（`blender-ref-finalFaceComposite.png`）的色比距离，
  要求 `distV1 < distOrig` 且 `(distOrig-distV1)/distOrig > 0.15`；**错误颜色负测**（V1 脸皮肤
  R×0.35/G×1.1 错色）须判为不收敛（实测 negDrop=-5.30，正确拒绝）。
- 非皮肤稳定：meanMeanDiff<1 且 maxMeanDiff<2。阈值依据实测噪声（同变体连拍 maxMeanDiff≈0.13–0.28）
  之上、真实成片改写（皮肤对照 25–36）之下，允许修票明示的「切换重建极小光栅噪声」。
- 星空背景：暗空多数像素（双图 lum<30，排除亮星闪烁）maxMeanDiff<0.5。
- pctOver2（|d|>2 像素占比）仅记录不判定：模型待机微动使含 specular/RMO 的衣服对高光角敏感，
  同变体连拍 pctOver2 即达 ~15%，无法区分真实改写与帧间噪声。

## 生产缺陷修复（本票据内最小修复）

### 1. reze-engine PMX 文本长度上限（阻断性）
- **根因**：引擎 `pmx-loader.ts` 的 `getText()` 硬编码 1000 字节上限，权威克莱妲 PMX offset 647 有合法
  超长注释，导致 `Suspicious string length: 1006` 拒绝加载。
- **修复**：`web/scripts/patch-reze-engine.mjs` 已有补丁；`npm ci` 后手动 `node scripts/patch-reze-engine.mjs`。
- **验证**：`patch --self-test` 62 项不变量通过；G1-G6 全过。

### 2. 验收探针 `__rezeStageProbe`（验收基建，默认关闭）
- **改动**：`RezeWebGpuStage.tsx` 探针仅在显式验收开关 `?v14dAcceptanceProbe=1` 下挂载，生产默认不暴露；
  **探针泄漏硬断言（G6）**：验收脚本另开默认生产入口（不带 `?v14dAcceptanceProbe=1`）页面，
  导入克莱妲至画布 ready 后硬断言 `window.__rezeStageProbe` **不存在**（实测 defaultProbePresent=false、
  defaultCanvasReady=true），同时硬断言显式开关入口**有**探针（explicitProbeOn=true）。证明探针只在
  显式验收开关下暴露、生产默认关闭。
  rAF 进度镜像循环带 `cancelled` 标志 + `cancelAnimationFrame`，卸载时完整清理并删除 dataset。
- **新增负测钩子** `applyBadSkinGraph(kind)`（仅验收开关）：驱动「错误 graph」「applyStyleGroups 失败」
  真实负测，验证回退路径。

### 3. VMD 播放路径 `engine.resetPhysics()`（第三轮恢复 + 共享路径）
- **根因**：第二轮误删了通用 VMD effect（`interaction.vmdUrl` 变更驱动）里的
  `engine.resetPhysics()`；主会话 P0-2 指出 `base...HEAD` diff 中该调用被移除。
- **修复（第三轮）**：抽取共享函数 `loadVmdThroughInteractionPath(url, loopUrls)`，
  通用 VMD effect 与验收探针 `playVmd` 走**同一条**加载路径；成功 load/apply/play 后
  必然 `engine.resetPhysics()`，并自增 canvas dataset `vmdEffectResetPhysicsCount`
  作为可判别证据。G5 据此断言该计数 >0（实测 =5），证明 resetPhysics 在共享路径真实被调用。
- **请求守卫修复（第四轮 P0）**：第三轮的共享函数把守卫破坏——`await loadVmd` 后直接
  apply/play/写 currentUrl/arm fallback/resetPhysics，调用方直到返回后才 isCurrent。第四轮把
  守卫（`isCurrent(requestId) && model===modelRef.current`）作为 `guard` 回调传入共享函数，
  在 `await` 之后、**任何 apply/play/currentUrl/fallback/resetPhysics 副作用之前**硬检查；
  较慢完成的旧请求无副作用退出（返回 null）。探针 `playVmd(url, raceKey)` 用
  `vmdProbeRaceTokenRef` 标识请求，旧请求被覆盖时自增 `vmdRaceStaleCount`。
- **完成回调身份修复（第四轮 P0）**：`handleRezeVmdFinished` 的身份/模型有效性校验
  （`currentName===finishedName` 且 `model===modelRef.current`）现在**先于任何
  clear/count/loop/reset/complete 副作用**；只有匹配当前动作的回调才 `clearVmdCompletionFallback`
  并自增 `vmdNaturalFinishCount`。过期/错误 finishedName 回调不得清当前 fallback、不计数、不改
  `currentVmdUrl`。`pauseVmd`/`seekVmd` 会取消完成兜底计时器，避免中段暂停/跳走被兜底误判为播完。
- **G5 竞态负向自验（可重复、真实执行）**：`node scripts/accept-reze-k3-v1-stage.mjs
  --self-test-g5-race`——healthy（finishDelta=0）→ true/**exit 0**；finishDelta=1 → false/**exit 1**
  （另含 staleRet/wrongCurrent/rpZero/staleZero 各负向用例均须 false）。
  **边界**：该 self-test 只验证 Gate **判定函数** `computeG5RaceOk` 对 finishDelta=1 返回 false
  并以非零退出，证明 Gate 具备判别力；它**不外推生产运行时行为**（运行时行为由上方真实浏览器
  竞态回归覆盖）。判定抽成纯函数 `computeG5RaceOk`，`page.evaluate` 内竞态 Gate 注入同一函数
  源码复用同一口径。
- **验证**：G5 original/V1 各 load→play→pause→seek→完整播放至结束
  （finishBefore→finishAfter 自增、endReached/fullPlayOk=true）；负测提前停止先硬断言
  `Number.isFinite(fallbackDelay) && fallbackDelay>0` 再断言 `totalObservedAfterArmMs` >
  `fallbackDelay`（实测 4859>4350）后计数不增；竞态回归 A慢/B快 下最终播放为 B、A 无副作用退出
  （retA=null、rpDelta=1、staleDelta≥1、finishDelta=0）；过期回调负测用真实 A 名 `race-a.vmd`，
  注入后 `vmdNaturalFinishName` 不改 A、B 完成后等于 B。

## 视觉证据

| 产物 | 路径 |
| --- | --- |
| **带标注三联图（original/V1/diff）** | `.scratch/reze-k3-v1-stage/g3-triptych-labeled.png` |
| original/V1 全身（含 UI） | `.scratch/.../g3-original-full.png`、`g3-v1-full.png` |
| original/V1 纯画布 | `.scratch/.../g3-original-canvas.png`、`g3-v1-canvas.png` |
| 差异热图 | `.scratch/.../g3-diff-heat.png` |
| 区域像素数值 | `.scratch/.../visual-diff.json` |
| 完整门禁报告 | `.scratch/.../gate-report.json` |

差异热图（×6 放大）：仅脸部为亮区（V14D State2 合成），手部微弱，头发/衣服/装备/星空全黑——
证明 V1 零泄漏到非皮肤与背景。

## 可复验步骤

```powershell
cd "E:\codexWorktree\004b\MMD project\web"
npm ci --no-audit --no-fund
node scripts\patch-reze-engine.mjs   # 关键：移除 PMX 文本长度上限
node ./scripts/run-next.mjs dev -p 3114 -H 127.0.0.1
# 另一终端：
node scripts\accept-reze-k3-v1-stage.mjs --self-test-g5-race   # G5 竞态判定负向自验（healthy exit0 / finishDelta=1 exit1）
node scripts\accept-reze-k3-v1-stage.mjs --self-test-g5-stale  # G5 过期回调名称判定负向自验（严格绑定 B 名）
node scripts\accept-reze-k3-v1-stage.mjs    # G1-G6 真实浏览器验收（硬阻断）
node scripts\analyze-reze-k3-v1-diff.mjs    # G3 区域像素差异（退出码硬阻断）
node scripts\finalize-reze-k3-v1-report.mjs # 合并报告 + 生成三联/差异图
```

## 迁移范围（15 槽最终目标 vs 本票皮肤阶段）

**最终切换定义**：「原始 Reze K3 / Reze K3 + V14D 角色外观材质（**15 槽**）」两档。
舞台环境始终保留 Reze K3 原灯光、星空背景、自由相机、动态 VMD——这只约束**环境**，
不表示保留原 K3 的角色材质。角色外观的最终目标是 15 个 PMX 材质槽全部采用权威
Blender V14D 逻辑。

**权威 15 槽清单（唯一权威，非 27/27、非"全部 PMX 材质"）**：
Face、BodySkin、Brows、Lashes、Emotions、HairA、HairB、Eyes、EyeWhite、
EyeShadow、Eyes+、UpperTeeth、LowerTeeth、Tongue、FingerNails。

**本票（皮肤阶段）已迁移（2/15）**：Face、BodySkin。

**本票未迁移（13/15，后续票据）**：Brows、Lashes、Emotions、HairA、HairB、Eyes、
EyeWhite、EyeShadow、Eyes+、UpperTeeth、LowerTeeth、Tongue、FingerNails。

**明确排除（永久保持原始 Reze K3，不在迁移范围）**：所有 Cth\* 衣物/披风/手套/
裤/鞋/口罩/包（Cth1-Cape、Cth1-Cape2、Cth1-Glove、Cth1-Top、Cth2-Pants、
Cth2-Pouch、Cth2-Shoes、Cth3-Mask、Cth4-Glove、Cth5-ShoesZip），以及 Glock、
GunSilencer 武器装备。

**后续全材质票据的完成定义**：15 槽逐槽都有机器可审计状态——已迁移 / 经权威证据确认
等价 / 当前帧不可见但另有验证帧 / 明确阻塞；任何槽不得缺项。本票不越权实现其余 13 槽。

## 剩余风险与边界

- **API 依赖**：本轮为存根环境端到端。真实部署需 API 后端提供模型清单/会话；V1 资格与渲染不依赖 API。
- **纹理兜底**：验收 route 把 `127.0.0.1:8000/assets/mmd/models/<Textures|spa>/...` 从权威目录真实映射；
  真实部署由后端静态服务提供等价内容。
- **探针剥离**：`__rezeStageProbe` 已用 URL 开关门控（生产默认不挂载），彻底剥离可在构建期加 env 门控。
- **check:basic / tsc 基线已知失败**：`check:basic` 断言与代码现状不符、`app-routes-smoke.spec.ts` 的
  `__speechCancelCount` Window 类型缺失，均为基线历史遗留，与本票据无关。
- **next-env.d.ts**：`npm run build` 会改写其 routes.d.ts 引用路径（build 产物），不纳入提交。
