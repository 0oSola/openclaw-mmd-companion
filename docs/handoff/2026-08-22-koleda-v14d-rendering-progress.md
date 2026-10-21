# 克莱妲 V14D / reze-k3 渲染进度交接

> 快照日期：2026-08-22  
> 目标对象：克莱妲 PMX（`GirlsFrontline KoledaDefault.pmx`）  
> 目标链路：Blender V13/V14D 参考效果 → `reze-k3` WebGPU  
> 当前实现 worktree：`C:\w\rk3-face-v14d`  
> 本文用途：交给新的 agent 直接接续诊断、票据拆解、实施和验收  
> 上一版交接：`D:\workspace\MMD project\docs\handoff\2026-08-20-koleda-v14d-rendering-progress.md`

## 1. 一页结论

项目目前已经建立相机、姿势、像素注册、真实 Chrome WebGPU 捕获、头发/非头发 ROI 和正式 GO/NO-GO Gate，但尚未达到“与 Blender V13/V14D 100% 对齐”。

当前与下一步最相关的已验证结论如下：

1. 相机与像素注册已经达到亚像素级；hair-space 正式证据中 7 个锚点最大误差约 `0.031px`。后续不应再默认把头发差异归因于相机不一致。
2. 头发面积灯空间常量已经从 Blender 米制/轴序修正到 reze 空间，但 frame120 的视觉变化接近零。它是正确性修复，不是宽带高光修复。
3. 只提高头发高光能量的 `spec_energy_gain=1/4/15/30` 实验已经真实验证为 `NO-GO`。
4. 只给 HairA/HairB 增加专用面积灯并扫描水平角、俯仰角、灯面半径和最小能量诊断，也已经真实验证为 `NO-GO`。
5. 方向扫描中评分最高的 `az=60° / el=-10° / radiusScale=4` 仍是红色候选，不能作为生产推荐或默认配置。
6. 当前不应继续盲扫灯光方向、半径或提高能量。下一条最小、信息增益更高的路线是 Blender 逐像素 BRDF/AOV 分量取证，再与 Web 的 PBR、toon 和最终混合分量逐像素对齐。
7. 专用面积灯方向扫描的实验产物和正式 Gate 已存在，但原执行任务没有按协议主动发送结构化交付，也没有完成正式交付握手。因此“实验结论可读”不等于“任务生命周期已完整关闭”。

## 2. 最终目标与统一验收口径

最终目标是让克莱妲在网页端 `reze-k3` 预览中的角色渲染尽可能接近 Blender V13/V14D，重点包括：

- 头发发顶、刘海和长发的连续宽带高光；
- 白皮肤和受控的脸部阴影状态；
- 白色上衣、披风、裤子、丝袜、金属和装饰件的亮度、粗糙度和材质层次；
- 与 Blender 一致的相机、姿势、曝光、颜色管理和灯光契约；
- 网页端可旋转、缩放观察；
- 每个视觉结论都有真实捕获、manifest、ROI、对比图和 Gate 支撑。

后续实验继续遵守以下顺序：

1. 固定权威 frame120、相机、姿势、640×640 画布、曝光和非目标材质。
2. 每张实验票只改变一个可解释变量或一个同类 failure family。
3. 使用真实 Chrome WebGPU 或真实 Blender 渲染，不用 `--list`、静态夹具或主观截图替代端到端证据。
4. 同时检查目标区域改善与非目标区域冻结。
5. 只有相关正式 Gate 通过，才能表述为“已验证可解决”。

## 3. 工作区、分支和保护边界

当前实现 worktree：

```text
C:\w\rk3-face-v14d
```

分支与 HEAD：

```text
branch: codex/koleda-v14d-face-shadow
HEAD:   387239b977c078c34ef974c1cf3cb9ca40f012ce
```

该 worktree 有大量历史未提交修改和未跟踪实验产物。不能声称工作区干净，也不能把全部脏改动归因于最近一张票据。

禁止执行：

```text
git reset --hard
git checkout --
git clean
自动删除 worktree
覆盖或回滚用户及历史实验改动
```

保护文件：

```text
C:\w\rk3-face-v14d\api\data\sqlite\trace.db
```

2026-08-22 只读核对：

```text
Git status: M（历史状态）
size:       503103488 bytes
mtime:      2026-08-13 09:58:40.8951246
```

准确表述应为：

> `trace.db` 仍显示历史 Git 脏状态；本轮只读核对未发现 size/mtime 变化。

任何后续 agent 都不得修改、迁移、重建或清理该数据库。

## 4. 已确认的基础契约

### 4.1 相机、坐标和像素注册

- Blender → reze 的坐标映射包含轴重排与 `×12.5` 尺度换算。
- hair-space 正式 manifest 记录 `pixelAligned=true`。
- 7 个权威锚点最大误差约 `0.031px`。
- 所有头发实验应继续使用权威 frame120、固定姿势和相机。

除非新证据证明相机契约失效，否则不要重新把“相机没对齐”列为头发宽带缺失的默认根因。

### 4.2 非头发冻结

头发实验至少冻结并检查：

- 脸部皮肤；
- 白上衣；
- 披风；
- 裤子。

矩形 ROI 只用于冻结检查，不能单独证明材质级隔离。正式结论还要结合图指纹、实际 WGSL 状态和实验开关状态。

### 4.3 生产默认

静态代码与 i6 baseline 证据均指向：

```text
spec_energy_gain 默认值 = 1
专用面积灯默认关闭
dedicated_area_az = 0
dedicated_area_el = 0
dedicated_area_radius_scale = 1
dedicated_area_energy = 1
```

专用面积灯未显式设置环境变量时：

```text
V14D_DEDICATED_AREA_ACTIVE = false
WGSL da_enabled = 0.0
```

但是当前 worktree 有大量未提交修改。下一位 agent 在继续实验前，仍必须读取当前 `node_modules/reze-engine/dist` 的实际 WGSL，确认没有残留候选被烘焙进去，不能只相信源码默认值。

## 5. 已完成实验

### 5.1 头发面积灯空间常量修复

旧值：

```text
key_center = vec3f(0.3903, -3.5575, 2.8665)
key_radius_world = 1.175
```

修正值：

```text
key_center = vec3f(4.87875, 35.83125, -44.46875)
key_radius_world = 14.6875
```

证据：

```text
C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\gate\evidence\hair-light-space-probe-20260818\README.zh-CN.md
```

已验证边界：

- 三个 hair WGSL 函数的 source/dist 状态可判定为 `legacy` 或 `fixed`；
- 请求标签与实际 WGSL 不一致时 fail-closed；
- 实际 A/B 采集证明空间契约已经修正；
- frame120 头发发顶亮度基本未变化；
- 该修复没有恢复 Blender 的发顶/刘海连续宽带。

### 5.2 头发高光能量倍率

实验档位：

```text
spec_energy_gain = 1 / 4 / 15 / 30
```

证据：

```text
C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\gate\evidence\hair-spec-energy-gain-sweep-20260818\README.zh-CN.md
```

关键结果：

| 区域 | Blender 高亮覆盖 | i6 基线 | gain=4/15/30 |
| --- | ---: | ---: | ---: |
| 发顶 | 0.5513 | 0 | 0 |
| 刘海 | 约 0.7822 | 约 0.0014 | 约 0.0013 |
| 右侧长发 | 0.3128 | 0.2067 | 0.1841 / 0.1838 / 0.1745 |

正式结论：`NO-GO`。

能量倍率真实生效，非头发 ROI 也保持冻结，但发顶/刘海宽带没有恢复，右侧长发的高亮连通性反而退化。因此不得继续仅靠放大当前高光能量寻找答案。

### 5.3 i9 采样和能量审计

概念文档：

```text
C:\w\rk3-face-v14d\workflow\concepts\koleda-v14d-hair-spec-energy-quantify.zh-CN.md
```

已确认：

- `17 → 1024` 点当前方向采样的最大差异小于 `8%`；
- 仅增加当前方向采样数量不足以恢复目标；
- `4096` 点结果只是本地简化面积灯诊断模型；
- `0.0197` 等数值是当前 Web 公式内部诊断口径，不是跨渲染器输出上限；
- Blender/EEVEE 的面积灯积分、单位、solid angle、发光面语义、BRDF 多重散射和能量补偿仍未完成端到端归因；
- Blender 灯的 `370W` 与 Web 的 `1.07` 没有已验证的同单位契约，不能直接相除为能量倍率。

## 6. 头发专用面积灯方向扫描：正式 `NO-GO`

票据：

```text
C:\w\rk3-face-v14d\.scratch\koleda-v14d-hair-dedicated-area-light-direction-scan\issues\01-hair-dedicated-area-light-direction-scan.md
```

证据根目录：

```text
C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\gate\evidence\hair-dedicated-area-light-scan-20260820
```

正式 Gate：

```text
C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\gate\evidence\hair-dedicated-area-light-scan-20260820\gate\dedicated-area-gate-result.json
C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\gate\evidence\hair-dedicated-area-light-scan-20260820\gate\dedicated-area-gate.report.zh-CN.md
```

正式状态：

```text
overallVerdict = NO-GO
status = failed
greenCandidates = []
```

### 6.1 实际扫描顺序

1. 水平角：`-60/-30/0/+30/+60/+90`
2. 冻结阶段评分最高的 `az=+60°`，扫描俯仰：`-20/-10/0/+10/+20`
3. 冻结 `az=+60° / el=-10°`，扫描半径：`×0.5/×1/×2/×4`
4. 触发一次专用灯能量 `×4` 的最小诊断

分阶段评分得到：

```text
bestAz = +60°
bestEl = -10°
bestRadiusScale = 4
```

这里的“best”只表示扫描评分最高，不表示通过 Gate。所有候选最终均为 `RED`。

### 6.2 最佳几何候选

候选：

```text
id = azpos60-elneg10-rx4
az = 60
el = -10
radiusScale = 4
energy = 1
```

高亮覆盖：

| 区域 | Blender | i6 | 候选 |
| --- | ---: | ---: | ---: |
| 发顶 | 0.5513 | 0 | 0 |
| 刘海 | 0.7814 | 0.0013 | 0.0014 |

最大连通高亮分量：

| 区域 | i6 | 候选 |
| --- | ---: | ---: |
| 发顶 | 0 | 0 |
| 刘海 | 26 | 27 |
| 右侧长发 | 3041 | 5856 |

过曝率：

```text
commonRoi = 0
hair_crown = 0
hair_bangs = 0
hair_right_long = 0
```

非头发 ROI 相对 i6：

| 区域 | 亮度变化 |
| --- | ---: |
| 脸部皮肤 | +0.315470% |
| 白上衣 | -0.384991% |
| 披风 | -0.002534% |
| 裤子 | +0.225043% |

阈值均为 `0.5%`，因此非头发冻结通过。但是发顶和刘海宽带没有恢复，失败项为：

```text
highlight_error_not_significantly_improved
band_connectivity_not_recovered
```

方向和半径确实会明显改变右侧长发的高光分布，但没有恢复目标区域的连续宽带。

### 6.3 能量 ×4 最小诊断

候选：

```text
id = azpos60-elneg10-rx4-en4
```

结果：

- 发顶高亮覆盖仍为 `0`；
- 刘海只从约 `0.0013` 变为约 `0.0014`；
- 白上衣相对 i6 变化 `-0.642652%`，超过 `0.5%` 冻结阈值；
- Gate 仍为 `RED`。

失败项：

```text
non_hair_frozen_roi_exceeded:white_top
highlight_error_not_significantly_improved
band_connectivity_not_recovered
```

### 6.4 扫描结论边界

已真实排除：

- 在当前专用面积灯模型下继续盲扫水平角、俯仰角和半径；
- 把 `az=60 / el=-10 / radiusScale=4` 冻结成生产默认；
- 在该候选上继续提高能量来恢复发顶/刘海宽带。

尚未排除：

- Blender Principled 与 Web PBR 的 BRDF/lobe 语义差异；
- 面积灯真实积分与多重散射差异；
- Blender 材质节点、纹理或法线链路带来的宽带；
- toon 混合或后处理/颜色管理对最终宽带的贡献；
- 其他帧和视角，但本次结论对权威 frame120 正面成立。

## 7. 方向扫描执行任务的协议状态

原执行任务：

```text
title:    V14D 头发专用面积灯方向扫描
threadId: 01a01d81-88ef-7803-8291-60c2f4081dee
hostId:   local
model:    kimi/k3-256k
thinking: max
```

2026-08-22 读取到的最新状态：

```text
status = idle
```

该任务已经生成完整实验产物和正式 `NO-GO` Gate，但存在两个任务管理缺陷：

1. 没有按派发协议形成并主动发送完整结构化最终交付；
2. 没有实际调用跨任务通知工具唤醒来源主会话，因而没有完成正式交付握手。

所以后续应区分：

> 实验 Gate 结果已经存在且可审查；执行任务本身尚未满足主动通知和交付握手协议，不能直接把票据生命周期标为“已完整验收关闭”。

不要因为该缺陷再次创建一个并行写者。需要补交付时，应先向原任务发送消息，要求它基于现有结果停止写入、形成结构化交付并实际发送回来源主会话；若原任务确实不可恢复，再按新的 failure family 创建替代任务。

## 8. 项目归属缺陷

主会话项目：

```text
projectId: local-140a2801b88e7626327b2eb4694a8b91
threadId:  01a0043b-1453-7f31-848b-9b274866c1d9
hostId:    local
```

方向扫描任务虽然被要求使用 `C:\w\rk3-face-v14d`，但实际任务元数据中的目录为：

```text
C:\Users\KSG\Documents\Codex\2026-08-20\c-w-rk3-face-v14d
```

它属于 projectless 目录目标，不符合当前 `AGENTS.md` 的“与主会话同项目绑定”规则。

后续创建可见执行任务时必须同时满足：

- 复用主会话项目绑定；
- 使用已经确认的短路径 worktree；
- 明确分支、base commit、工作目录和单写者租约；
- 任务在侧边栏显示于主会话同一项目分组。

如果当前任务创建接口无法同时绑定现有短路径目录和主会话项目，必须报告阻塞，不能继续用 projectless 任务替代。

## 9. 捕获环境与临时依赖

第一轮方向扫描曾因 8100 资产后端未启动而失败。后来通过以下环境恢复真实捕获：

- 启动 FastAPI 资产后端 `127.0.0.1:8100`；
- 设置：

```text
MMD_ROOT_DIR=D:\mmd
```

- 建立与模型 URL 目录结构匹配的 `D:\mmd` 资产路径/目录联接；
- 新增诊断或启动文件：

```text
C:\w\rk3-face-v14d\api\.env
C:\w\rk3-face-v14d\.scratch\koleda-v14d-hair-dedicated-area-light-direction-scan\start-backend.ps1
C:\w\rk3-face-v14d\.scratch\koleda-v14d-hair-dedicated-area-light-direction-scan\diagnose-webgpu.mjs
```

这些文件当前仍存在。

后续 agent 必须注意：

- 8100 是当前真实模型捕获的依赖，运行 Gate 前先验证资产 URL；
- `api\.env` 和 `D:\mmd` 路径可能只是临时诊断配置；
- 未经审查不要把它们视为生产部署配置；
- 当前也不要自动删除，因为方向扫描任务尚未完成正式交付握手；
- 不要假设历史 3400/3480/3496/3500 等预览端口仍在运行，应重新检查端口与实际 URL。

## 10. 当前尚未实现的能力

### 10.1 网页实时调参

第七盏头发专用灯目前是编译期烘焙进 WGSL：

- 改参数需要重新运行 patch；
- 重新编译/重载后才生效；
- `dedicated_area_*` 节点输入主要用于 manifest 和图指纹审计；
- 真正生效的是 patch 脚本写入的 WGSL 字面量。

讨论过但未实现：

1. “调参面板 → 应用 → 重新编译/重载”；
2. 把方向、半径和能量改成运行时 uniform，实现拖动实时更新。

因为专用灯方向扫描已经 `NO-GO`，当前不建议先投入较高成本改造实时 uniform。除非新的 BRDF/AOV 证据证明灯光方向仍是有效控制变量，否则该工具只能更实时地重现已失败路线。

### 10.2 Blender 实时/MCP 控制

原方向扫描执行任务当时没有可用或已连接的 Blender MCP，因此只讨论了 Blender background + Python `bpy` 路线，没有实施新脚本。

下一位 agent 应先检查当前环境是否已有可连接的 Blender 工具：

- 若 Blender MCP 已连接，可先只读检查场景、灯光、材质节点和渲染引擎；
- 若不可用，则使用 `blender --background --python <script.py>`；
- Blender 灯光是运行时场景对象，调整位置、半径和强度后重渲染，不需要像当前 Web WGSL 那样重新烘焙 shader 常量。

不要把“讨论过 Blender 批量扫描”写成已完成能力。

## 11. 推荐下一路线：Blender 逐像素 BRDF/AOV 取证

方向扫描 `NO-GO` 后，最小信息增益路线不再是继续调灯，而是回答：

> Blender 的发顶/刘海连续宽带到底来自哪个渲染分量，而 Web 对应分量在哪一步丢失？

建议先用 `$to-spec` 明确跨渲染器分量取证的可验证接缝，再用 `$to-tickets` 拆成纵向票据。第一张票应只建立一个权威 frame120 的端到端分量提取与像素对齐链路，不要一开始同时重写 Web BRDF。

候选分量至少包括：

- Blender beauty/final；
- Blender 高光或 glossy/specular 分量；
- Blender diffuse/base 分量；
- 必要的 normal、roughness、material mask 辅助通道；
- Web PBR 高光分量；
- Web toon 分量；
- Web PBR/toon 最终混合分量。

第一张票的建议 Gate：

1. 使用同一权威 frame120、相机、姿势、分辨率和颜色管理；
2. 每个分量都输出可读取的 EXR/PNG 或等价数值产物及 manifest；
3. Blender beauty 与可加和分量在定义允许的误差内闭合，若不能加和必须明确解释口径；
4. 使用现有像素注册锚点确认 Blender/Web 对齐；
5. 对发顶、刘海、右侧长发输出逐像素分布、覆盖率和连通性；
6. 不修改生产默认，不触碰非头发材质；
7. 给出“宽带首次出现在哪个分量”的可复核结论。

决策树：

1. 如果 Blender 的宽带主要存在于 specular/glossy：
   - 优先审计 BRDF lobe、roughness 映射、各向异性切线、面积灯积分和多重散射。
2. 如果宽带已经存在于 diffuse/base 或材质纹理：
   - 优先审计头发纹理、渐变、法线、Matcap 或 toon/base 混合，不再把灯光当主因。
3. 如果单独分量都没有，只有 beauty/compositor 出现：
   - 审计颜色管理、曝光、合成、泛光和后处理。
4. 如果 Blender 与 Web 的对应高光分量都存在，但空间形状不同：
   - 再开单变量票验证 roughness/lobe 宽度或面积灯积分。
5. 如果 Blender 对应高光分量能量足够，但 Web 分量能量不足：
   - 再讨论单位、F0、能量补偿或多重散射；不要直接恢复 `spec_energy_gain` 盲乘路线。

## 12. 下一位 agent 的严格启动清单

### 12.1 先读规则和现有证据

必须读取：

```text
D:\workspace\MMD project\AGENTS.md
D:\workspace\MMD project\docs\handoff\2026-08-22-koleda-v14d-rendering-progress.md
C:\w\rk3-face-v14d\.scratch\koleda-v14d-hair-dedicated-area-light-direction-scan\issues\01-hair-dedicated-area-light-direction-scan.md
C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\gate\evidence\hair-dedicated-area-light-scan-20260820\gate\dedicated-area-gate.report.zh-CN.md
C:\w\rk3-face-v14d\workflow\concepts\koleda-v14d-hair-spec-energy-quantify.zh-CN.md
```

用户此前明确要求不使用 MMD 渲染 Skill；除非用户重新授权，不要调用相关 MMD Skill。

### 12.2 核对工作区而不清理

在 `C:\w\rk3-face-v14d` 运行：

```powershell
git branch --show-current
git rev-parse HEAD
git status --short
git diff --cached --name-status
Get-Item -LiteralPath .\api\data\sqlite\trace.db |
  Select-Object FullName,Length,LastWriteTime
```

预期：

- 分支和 HEAD 与本文一致，或明确报告后续合法变化；
- 暂存区为空；
- 不清理历史改动；
- `trace.db` 只读。

### 12.3 核对实际 shader 默认

继续前至少：

- 读取 `node_modules/reze-engine/dist` 中三个 hair 函数的 `key_center`、`key_radius_world`；
- 确认 `spec_energy_gain=1.0`；
- 确认专用面积灯 `da_enabled=0.0`；
- 运行现有 hair-space 和 dedicated-area 聚焦测试；
- 如果实际状态与标签或默认不一致，立即 fail-closed，不采集新证据。

### 12.4 先补原任务交付握手

优先复用原任务：

```text
threadId: 01a01d81-88ef-7803-8291-60c2f4081dee
hostId: local
```

要求它：

- 不再继续写入；
- 基于已生成 Gate 形成结构化最终交付；
- 实际调用跨任务通知工具；
- 发送给来源主会话；
- 结束回合并释放单写者租约。

如果它无法恢复，记录原始错误，再按新的 failure family 建立后续任务。不要创建第二个并行写者覆盖同一 worktree。

### 12.5 再拆 Blender AOV 取证

该路线跨 Blender、Web、证据和 Gate，属于大块任务：

1. 先用 `$to-spec` 形成规格；
2. 用户确认最高层可验证接缝；
3. 再用 `$to-tickets` 拆成 tracer-bullet 纵向票据；
4. 只启动所有阻塞已解除的 frontier 票据；
5. 可见任务必须属于主会话同一 Codex 项目；
6. 视觉判断任务优先使用用户指定的 `kimi/k3-256k`；实现和高风险验证按当前 `AGENTS.md` 的模型规则执行；
7. 每张任务完成后必须实际跨任务通知，不能只在自身 final 写“已通知”。

## 13. 关键文件索引

### 当前交接

```text
D:\workspace\MMD project\docs\handoff\2026-08-22-koleda-v14d-rendering-progress.md
```

### 旧版交接

```text
D:\workspace\MMD project\docs\handoff\2026-08-20-koleda-v14d-rendering-progress.md
```

### 空间修复证据

```text
C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\gate\evidence\hair-light-space-probe-20260818\README.zh-CN.md
```

### 能量倍率证据

```text
C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\gate\evidence\hair-spec-energy-gain-sweep-20260818\README.zh-CN.md
```

### i9 概念与诊断

```text
C:\w\rk3-face-v14d\workflow\concepts\koleda-v14d-hair-spec-energy-quantify.zh-CN.md
C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\gate\evidence\hair-i9-spec-energy-quantify-20260818
```

### 专用面积灯扫描

```text
C:\w\rk3-face-v14d\.scratch\koleda-v14d-hair-dedicated-area-light-direction-scan\issues\01-hair-dedicated-area-light-direction-scan.md
C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\gate\evidence\hair-dedicated-area-light-scan-20260820
```

### 生产实现与默认状态

```text
C:\w\rk3-face-v14d\web\scripts\patch-reze-engine-gf2.mjs
C:\w\rk3-face-v14d\web\src\features\stage\rezeGf2Graphs.ts
C:\w\rk3-face-v14d\web\src\features\stage\rezeGf2Nodes.ts
C:\w\rk3-face-v14d\docs\architecture\current-system-topology.md
```

## 14. 最终交接结论

截至 2026-08-22：

1. 相机、姿势和像素注册足以支撑继续做跨渲染器逐像素诊断；
2. 头发空间常量修复正确，但没有恢复宽带；
3. 头发高光能量倍率实验为 `NO-GO`；
4. HairA/HairB 专用面积灯方向、俯仰、半径和最小能量诊断全部为 `NO-GO`；
5. `az=60 / el=-10 / radiusScale=4` 只是失败候选中的最高评分项，不是生产参数；
6. 不应继续盲调灯光方向、半径或能量；
7. 下一步应进入 Blender 逐像素 BRDF/AOV 分量取证，先定位宽带来自哪个渲染分量，再决定调整 BRDF、roughness/lobe、面积灯积分、多重散射、纹理/toon 或后处理；
8. 原方向扫描任务仍需补正式交付握手，且其 projectless 项目归属缺陷必须在后续任务创建时修正。
