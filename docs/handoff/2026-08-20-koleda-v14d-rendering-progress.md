# 克莱妲 V14D / reze-k3 渲染项目会话交接

> 交接日期：2026-08-20  
> 目标对象：克莱妲 PMX（`GirlsFrontline KoledaDefault.pmx`）  
> 目标渲染链路：`reze-k3` WebGPU，参考 Blender V13/V14D 场景  
> 当前实现 worktree：`C:\w\rk3-face-v14d`

## 1. 当前总状态

当前项目已经完成从 Blender 参考效果到 WebGPU 可验证实验链路的基础建设，但还没有达到“与 Blender 参考图 100% 对齐”的目标。

当前最重要的判断是：

- 相机、姿势、像素注册和部分灯光空间映射已经具备可复核证据；
- 头发专用面积灯的空间常量已经修正，但在当前 frame120 正面画面中几乎没有视觉贡献；
- 只提高头发高光能量的单变量实验已经真实 WebGPU 验证为 `NO-GO`；
- 头发宽带高光的真正差异仍未定位到可以直接实施的单一根因；
- 下一步已经拆成一张纵向票据：扫描只作用于 HairA/HairB 的专用面积灯方向、俯仰和灯面半径；
- 这张票据已准备，但截至本交接文档生成时，尚未得到新的方向扫描子任务交付。

因此，当前不能表述为“头发问题已解决”，也不能表述为“V14D 已经完全对齐 Blender”。

## 2. 项目目标与对齐口径

最终目标是让克莱妲在 `reze-k3` 的网页预览中尽可能接近 Blender 中的 V14D 参考效果，重点包括：

- 头发的连续宽带高光；
- 脸部受控的分组阴影；
- 白色上衣、披风、裤子等衣物的材质亮度和质感；
- 与 Blender 一致的相机、姿势、曝光、灯光方向和颜色管理；
- 可以在网页端旋转和缩放模型进行观察；
- 所有视觉结论都要基于同一权威 frame120、相机、姿势、画布和曝光进行程序化对比。

当前实验统一采用以下优先级：

1. 先固定相机、姿势、曝光、默认灯光和非目标材质；
2. 每次只改变一个目标变量；
3. 使用真实 Chrome WebGPU 捕获，而不是只依靠静态代码检查；
4. 同时检查目标区域改善和非目标区域冻结；
5. 只有正式 Gate 通过，才能称为“已验证可解决”。

## 3. 已经确认的基础契约

### 3.1 权威相机和像素注册

Blender 到 reze 的相机/坐标映射已经有端到端证据：

- Blender 世界坐标到 reze 的映射为轴重排并乘以 `12.5`；
- 权威相机锚点重投影误差已经达到亚像素级；
- 相关 manifest 记录 `pixelAligned=true`；
- hair-space 正式采集的 7 个锚点误差不超过约 `0.031px`；
- 其他相机审计记录的最大重投影误差约为 `0.045px`。

这意味着后续头发实验不应再把“相机没有对齐”当作默认解释。若新增实验改变相机，必须另开票据并重新建立像素注册证据。

### 3.2 权威 frame120 和姿势

头发实验均以权威 frame120 和固定姿势为基准。实验不能在改变头发参数的同时改变动作、头部朝向或相机，否则无法判定高光变化来自哪一个变量。

### 3.3 非头发冻结

脸、白上衣、披风和裤子采用非头发 ROI 检查。头发候选必须证明：

- 目标高光发生变化；
- 非头发 ROI 在噪声阈值内保持冻结；
- 图构建和 WGSL 状态没有出现未授权的旁路变化。

矩形 ROI 只能作为冻结检查口径，不能单独替代材质级逐像素隔离证明。正式结论还需要结合图指纹和实际 WGSL 状态。

## 4. 已完成实验和结论

### 4.1 头发空间常量修复：正确性已验证，视觉问题未解决

证据目录：

```text
C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\gate\evidence\hair-light-space-probe-20260818
```

修复前，i6/i7/i8 头发 WGSL 中面积灯空间常量使用了旧的 Blender 米制/轴序：

```text
key_center = vec3f(0.3903, -3.5575, 2.8665)
key_radius_world = 1.175
```

修复后的 reze 空间常量为：

```text
key_center = vec3f(4.87875, 35.83125, -44.46875)
key_radius_world = 14.6875
```

三函数的 source/dist WGSL 实际状态已经通过 A/B manifest 自证为 `legacy` 或 `fixed`，请求标签与实际状态不一致时会 fail-closed。

结论边界：

- 空间契约修复是必要的正确性修复；
- 真实 A/B 捕获显示，头发发顶 luma 约 `77.88 -> 77.88`，视觉变化约为零；
- 原因之一是当前路径中的 `disk_radius` 触发了 `0.3` 下限，空间修复没有形成足够的面积灯视觉贡献；
- 不能把这张票据写成“宽带高光已修复”；
- 该结果只说明空间契约已对齐，不说明 Blender/EEVEE 面积灯积分语义已对齐。

### 4.2 头发高光能量倍率实验：正式 `NO-GO`

证据目录：

```text
C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\gate\evidence\hair-spec-energy-gain-sweep-20260818
```

实验只改变 HairA/HairB 的：

```text
spec_sum * spec_energy_gain
```

档位为：

```text
gain = 1 / 4 / 15 / 30
```

其他变量冻结，包括：

- `roughness=0.34`
- `specularLevel=0.38`
- `anisotropy=0.72`
- `disk_radius=0.3`
- PBR/toon 混合权重 `0.62 / 0.38`
- 权威相机、姿势、曝光、画布和默认六灯

真实 Chrome WebGPU 结果：

| 区域 | Blender 高亮覆盖 | i6 基线 | gain=4/15/30 |
| --- | ---: | ---: | ---: |
| 发顶 | 0.5513 | 0 | 0 |
| 刘海 | 0.7822 | 0.0014 | 约 0.0013 |
| 右侧长发 | 0.3128 | 0.2067 | 0.1841 / 0.1838 / 0.1745 |

关键结论：

- 能量倍率确实被写入实际 WGSL，并且候选与请求值一致；
- 非头发 ROI 全部在冻结阈值内；
- 发顶和刘海没有恢复连续宽带；
- 右侧长发的高亮连通性反而下降；
- 继续把当前高光能量乘得更大，不是合理的下一步；
- 这张票据排除的是“仅提高当前高光能量就能恢复宽带”这一假设，不是跨渲染器能量单位已经完全定标。

正式 Gate 结论：`NO-GO`。

### 4.3 i9 能量审计：采样数量已收敛，但跨渲染器能量语义仍未归因

相关概念文档：

```text
C:\w\rk3-face-v14d\workflow\concepts\koleda-v14d-hair-spec-energy-quantify.zh-CN.md
```

已经确认的诊断事实：

- `17 -> 1024` 点方向采样的 max 差异小于 `8%`；
- 提高当前方向采样数量本身不足以恢复目标；
- `4096` 点结果属于本地简化面积灯诊断模型；
- `0.0197` 是当前 Web 公式内部的完整链路诊断输出，不是跨渲染器理论上限；
- Blender/EEVEE 的真实面积灯积分、发光面语义、单位、solid angle、BRDF 多重散射和能量补偿尚未完成端到端归因；
- 不得把 Blender 灯的 `370W` 与 Web 的 `1.07` 直接当成同单位能量倍率。

因此，以下路线暂时都只能作为候选，不能写成事实：

- LTC 或其他面积灯积分替代；
- 多重散射/能量补偿；
- Blender Principled 与 Web 单散射 GGX 的语义差异；
- 发光体几何和灯光单位换算；
- 继续加大高光倍率。

## 5. 当前尚未解决的问题

### 5.1 头发宽带高光的形状和入射几何仍不一致

当前 Web 结果与 Blender 的差距主要不是“整体不够亮”这么简单，而是：

- Blender 发顶和刘海出现连续宽带；
- Web 发顶几乎没有达到高亮阈值；
- 刘海只有零散高亮；
- 右侧长发虽然存在部分高亮，但空间分布和连通性不匹配；
- 统一乘能量不会把零散高光变成连续宽带。

因此下一步优先验证入射方向和专用光源几何，而不是继续调强度。

### 5.2 场景灯光不是“全部参数已经完全一致”

相机和坐标注册已经较强地对齐，但 Blender 与 Web 的面积灯语义尚未完全一致。当前应区分：

- 已验证：方向映射、相机注册、部分灯光位置/方向契约；
- 未完全验证：面积灯的真实发光面几何、功率单位、solid angle、积分方式、BRDF 语义和多重散射；
- 未验证：专门为头发引入的局部面积灯是否能在不改变其他材质的前提下恢复目标宽带。

### 5.3 视觉版本和实验版本必须分开

现有 V13 baseline 和 V14D 实验代码共存。后续预览时必须在 URL 或运行环境中明确：

- `contract=koleda-v13-render-baseline`；
- `renderPipeline=reze-k3`；
- `model=koleda` 或显式 `modelUrl`；
- 是否启用 `faceShadowTest`、`previewBackground`、`hairExperiment` 等实验开关。

不能把旧端口、旧 URL 或默认 baseline 的截图误认为当前 V14D 结果。

## 6. 当前准备中的下一张票据

票据文件：

```text
C:\w\rk3-face-v14d\.scratch\koleda-v14d-hair-dedicated-area-light-direction-scan\issues\01-hair-dedicated-area-light-direction-scan.md
```

状态：

```text
ready-for-agent
Blocked by: None
```

实验目标：

> 只给 HairA/HairB 增加专用面积灯，固定强度和颜色，依次扫描水平角、俯仰角、灯面半径，验证是否能恢复发顶/刘海宽带高光。

必须按以下顺序执行：

1. 固定强度和颜色，扫描水平角；
2. 冻结最佳水平角，扫描俯仰角；
3. 冻结方向，扫描灯面半径；
4. 只有方向/几何已有可解释改善时，才允许做最小强度/颜色诊断；
5. 每组使用真实 Chrome WebGPU 捕获；
6. 程序化比较头发 ROI 和非头发冻结 ROI；
7. 运行正式 GO/NO-GO Gate；
8. 结束时恢复权威默认状态。

明确禁止：

- 继续把 `spec_energy_gain` 作为主实验变量；
- 解除 `disk_radius` clamp 作为本票变量；
- 全局增亮；
- 修改默认六灯；
- 让专用灯影响脸、衣物或其他材质；
- 覆盖旧的正式证据 PNG/manifest；
- 触碰 `api/data/sqlite/trace.db`。

当前交接时的真实状态：

- 票据文件已准备；
- 之前尝试派发可见子任务时，Codex 工具调用超时/被用户中止；
- 没有新的方向扫描证据、Gate 或结构化交付可供验收；
- 后续会话需要重新确认子任务是否真实创建，不能根据票据存在就假设实验已启动。

## 7. 工作区、分支和保护项

当前实现 worktree：

```text
C:\w\rk3-face-v14d
```

当前分支：

```text
codex/koleda-v14d-face-shadow
```

当前 HEAD：

```text
387239b977c078c34ef974c1cf3cb9ca40f012ce
```

该 worktree 有大量历史未提交改动，不能执行以下操作：

- `git reset --hard`
- `git checkout --`
- `git clean`
- 自动删除 worktree
- 将历史脏改动误当成本票新改动

保护项：

```text
C:\w\rk3-face-v14d\api\data\sqlite\trace.db
```

最近核对记录：

```text
size = 503103488 bytes
mtime = 2026-08-13 09:58:40（此前实验记录）
```

任何后续任务都必须只读核对该文件，不能写入、迁移或重建。

## 8. 后续会话的推荐执行顺序

### 第一步：确认子任务状态

先检查是否存在标题为“V14D 头发专用面积灯方向扫描”的可见任务：

- 如果存在且仍运行，按单写者租约等待其完成；
- 如果已完成，先读取其主动交付，再检查 worktree、diff、证据和 Gate；
- 如果不存在，重新创建可见子任务，模型按当前项目规则使用 `kimi/k3-256k`、思考深度 `max`，绑定 `C:\w\rk3-face-v14d`；
- 派发说明必须携带来源主会话准确的 `threadId` 和 `hostId`；
- 完成后必须实际调用 `send_message_to_thread`，仅在自身 final 中写“已通知”不算完成。

### 第二步：验收方向扫描

验收时重点检查：

- 请求的方向/半径是否与实际 WGSL/图构建状态一致；
- HairA/HairB 之外是否完全冻结；
- 发顶/刘海是否出现连续宽带，而不是单纯亮度增加；
- 非头发 ROI 是否保持在重复捕获噪声阈值内；
- 是否有真实 WebGPU PNG、manifest、ROI 结果、对比图和正式 Gate；
- 结束时是否恢复 `spec_energy_gain=1.0` 及权威 shader 状态。

### 第三步：按结果选择下一条路线

如果方向扫描 `GO`：

- 冻结最佳方向/半径；
- 另开票据验证材质形状参数，如 roughness/lobe 宽度；
- 不把专用灯实验直接合并成默认生产配置，先完成跨帧/跨视角验证。

如果方向扫描 `NO-GO`：

- 不再继续盲调方向和强度；
- 进入 Blender 侧逐像素 BRDF/AOV 提取；
- 对比 Blender 的高光分量、Web 的 PBR 分量和 toon 混合分量；
- 再决定是面积灯积分、BRDF、多重散射还是材质纹理问题。

## 9. 关键文件索引

### 实验票据

```text
C:\w\rk3-face-v14d\.scratch\koleda-v14d-hair-dedicated-area-light-direction-scan\issues\01-hair-dedicated-area-light-direction-scan.md
```

### 头发空间证据

```text
C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\gate\evidence\hair-light-space-probe-20260818\README.zh-CN.md
```

### 头发能量倍率证据

```text
C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\gate\evidence\hair-spec-energy-gain-sweep-20260818\README.zh-CN.md
```

### 头发能量审计概念

```text
C:\w\rk3-face-v14d\workflow\concepts\koleda-v14d-hair-spec-energy-quantify.zh-CN.md
```

### 生产架构登记

```text
C:\w\rk3-face-v14d\docs\architecture\current-system-topology.md
```

## 10. 交接结论

截至 2026-08-20：

1. 相机和像素注册已经足够支撑继续做头发单变量实验；
2. 头发空间常量修复已验证正确，但没有解决宽带高光；
3. 头发高光能量倍率 `1/4/15/30` 已真实验证为 `NO-GO`；
4. 当前不能继续盲目增加高光能量；
5. 下一条最小可验证路线是 HairA/HairB 专用面积灯方向、俯仰和半径扫描；
6. 该票据已经准备但尚未形成可验收的子任务结果；
7. 如果方向/几何仍不能恢复宽带，下一步应转向 Blender 逐像素 BRDF/AOV 证据，而不是继续凭视觉猜参数。
