## Architecture Documentation

When changing project functionality, service topology, external integrations, environment variables, data storage, API contracts, or runtime behavior, update:

- `docs/architecture/current-system-topology.md`

Keep this document aligned with the current running system so it can be used both for project understanding and for handing context to OpenClaw, TTS, frontend, or rendering services during optimization work.



## 动作验收 Gate

动作生成结果必须通过程序化验收 gate。所有阈值来自 PMX 顶点数据和坐标校准结果。

- 规范文档: `imgToAction/docs/motion_acceptance_gate.md` (18 个 gate, G1-G18)
- 执行脚本: `imgToAction/tools/motion_acceptance_gate.py`
- 几何参考: `imgToAction/docs/pmx_geometry_reference.md` (顶点包围盒、骨骼坐标、碰撞体)

验收流程:
1. VMD 生成后导出帧关节数据 JSON
2. 渲染输出使用 `python3 imgToAction/tools/motion_acceptance_gate.py <joints.json> --source render`；叉腰动作追加 `--left-arm-policy akimbo`
3. P0 gate (G1/G2/G3/G5/G7[akimbo]/G8/G11-G18) 全部通过 + P1 gate 警告 < 3 → 验收通过
4. P0 gate 阻断 → 修复后重新生成
5. 叉腰语义动作必须使用 `--left-arm-policy akimbo`；G7 检查左腕、左肘和完整左手代理 bbox，只接受 `side_down`（手指沿髋侧向下）轮廓，横向插入腰身必须判定失败，不能只用左腕点靠近腰部作为通过依据。
6. 思考托下巴动作必须检查 G12-G18：托下巴语义、右臂解剖、半握手型、接近阶段安全、双点接触、腕掌解剖和稳定接触锁定缺一不可。G17 稳定段腕弯曲上限为 55°；接近旧 65° 上限的姿势会被厚袖口放大成视觉断腕，不能发布。
7. Gate 使用骨骼代理点，不能替代网格视觉检查。最终必须提供正/左/右/后四视角截图和 GIF；手贴脸、手贴腰等靠身动作还应使用 Blender/PMX 变形网格逐帧碰撞检查，确认手套、袖口和髋侧装饰等厚网格不遮嘴、不穿脸、不穿腰。

## Code Search Tooling

Semble CLI is available as a project-level semantic code search helper installed through `uv tool install semble`.

Use it when the task is cross-module or intent-based and exact keywords are uncertain, for example:

- "where companion right rail renders the trace card"
- "message bridge auto tts greeting storage audio"
- "MMD stage click motion state machine"

Continue to use `rg` first for exact identifiers, endpoint paths, filenames, and known strings. Scope Semble searches narrowly (`api/app`, `web/src`, `docs`) before searching the repository root, because generated/runtime data can make first indexing slow.

On Windows PowerShell, use the wrappers so Unicode output is safe:

```powershell
scripts\semble-search.ps1 "message bridge auto tts greeting storage audio" api\app -TopK 5
scripts\semble-search.ps1 "podcast audio proxy route" api\app -TopK 5
scripts\semble-savings.ps1
```

When Semble materially reduces file reading, update `docs/architecture/semble-code-search-observability.md` with the query, scope, elapsed time, follow-up files read, and `semble savings --verbose` output.


## ImgToAction Bone Coordinate System

PMX 骨骼坐标系、轴向映射表、基础动作测试结果和渲染验证方法见独立文档：

- `imgToAction/docs/mmd-bone-coordinate-system.md`

该文档包含：
- 17 根 PMX 骨骼的 6 轴完整映射表（102 测试，408 渲染）
- 基础动作测试结果（含正误判定）
- 测试 VMD 生成和渲染方法
- 关键发现（Z 轴反转、Grant solver 修复、镜像对称等）
- 截图和 GIF 文件位置

### Grant solver 修复 (20260702)

之前标记为「无效」的 5 组骨骼（右足首、左足首、下半身、首、頭）实际是由于 PMX 模型使用 Grant（付与）骨骼系统。顶点权重绑定在 'D' 后缀的变形骨上（右足首D: 561顶点, 右足D: 1371顶点），控制骨旋转需通过 Grant solver 传递给变形骨。calibration 模式跳过了 `helper.update()`，导致 Grant solver 不运行。

修复：在 `web/src/features/stage/mmdCompanionRuntime.js` 的 `seekVmdFrame` 和 `renderFrame` 的 calibration 分支中添加 `grantSolver.update()` 调用。

修复后重新渲染：9 骨骼 × 6 轴 × 4 角度 = 216 张截图 + 45 个 GIF，全部验证通过（54/54 截图 MD5 与 baseline 不同）。

### 手指骨骼基准测试 (20260702)

测试范围：30 个手指关节骨 + 8 个手腕扭转骨 + 2 个握拳组合动作，共 231 个 VMD × 4 角度 = 924 张截图 + 12 个 GIF。

关键结论：
- 全部 231 个 VMD 测试通过，无无效骨骼
- 右手 90/90 正确，左手 90/90 正确
- 左手关节 2/3 在前视角和右视角因身体遮挡看不到变化，但左视角和后视角确认 6 轴全部有效
- 手指骨骼不使用 Grant 系统（flags=0x0），顶点权重直接绑定
- 手腕扭转骨全部有效（48/48）

详细表格见 `imgToAction/docs/mmd-bone-coordinate-system.md` 末尾的手指骨骼基准测试章节。

### 前臂扭转测试 (20260702)

测试32个VMD（手腕/手肘X轴15-90度 + Y/Z轴45度 + 序列动画），4角度共236张截图。
全部29个单帧测试有效，3个序列GIF已生成。验证了直接旋转腕骨可产生前臂扭转效果（捩骨自动跟随）。
详细见 `imgToAction/docs/mmd-bone-coordinate-system.md` 末尾章节。

### 完整度量验证 (20260703)

对全部 262 个 VMD（230 手指 + 32 扭转）进行了程序化验证：
- 1168 张截图通过文件大小 + MD5 校验
- 自动遮挡检测：右手左视角遮挡、左手右视角遮挡、左手关节2/3正面+右视角遮挡
- 全部 262 个 VMD 判定正确，0 个无效
- 数据表: `imgToAction/docs/finger_metrics_table.md`, `imgToAction/docs/twist_metrics_table.md`
- 合并度量: `imgToAction/outputs/actions/20260702_finger_shot/combined_metrics.json`
