# MMD PMX 骨骼坐标系与轴向映射

本文档记录 PMX Eula 模型每根骨骼的 X/Y/Z 轴旋转方向，用于 BVH→PMX retargeter 的轴向校正和 IK 后处理。

## 测试方法

### VMD 生成

通过 `imgToAction/tools/direct_pose_to_vmd.py` 将旋转角度 `[X, Y, Z]`（度）直接写入 PMX 骨骼的 quaternion，不经过 retargeter，隔离测试 PMX 骨骼坐标系。

测试 VMD 存放路径：`imgToAction/outputs/vmd/basic_tests/basic_{test_name}.vmd`

### 渲染

使用 `imgToAction/tools/render-vmd-pose-check.mjs` 从正面/左/右/后面四个角度渲染。

相机参数（来自 T-pose 探测数据）：
- Target: `[-2.075385, -2.771828, 0.642287]`
- Distance: 46.4
- Camera Y: 0.017
- FOV: 33

从主工程目录运行（`node.exe` 需要 Windows 上的 `node_modules/playwright`）：

```
cd "D:\workspace\MMD project"
node.exe imgToAction/tools/render-vmd-pose-check.mjs \
  --vmd imgToAction/outputs/vmd/basic_tests/basic_{name}.vmd \
  --out imgToAction/outputs/actions/{date}_basic_shot/{name}/{angle} \
  --frames 0,30 --hold-start-frame 30 \
  --web-url http://localhost:3100 \
  --camera '{"position":[...],"target":[...],"fov":33,"locked":true}' \
  --render-pipeline genshin
```

截图和度量数据存放路径：
```
imgToAction/outputs/actions/{YYYYMMDD}_{HHMM}_basic_shot/{test_name}/{front,left,right,back}/
  frame_000.png   # T-pose baseline
  frame_030.png   # Target pose
  render_metrics.json
```

## 基础动作测试结果

T-pose baseline: R_shldr=22.8, R_elbow=158.3, R_wrist_front=-0.81

| 文件夹 | 骨骼 | 输入旋转 | R_shldr | R_elbow | 腕前偏移 | 效果 | 判定 |
|---|---|---|---|---|---|---|---|
| `r_arm_horizontal` | 右腕 | [0,0,90] | 22.8 | 158.3 | -0.81 | 无效果，与T-pose一致 | 错误 |
| `r_arm_zneg90` | 右腕 | [0,0,-90] | 124.8 | 159.5 | +0.29 | 手臂外展抬起 | 正确 |
| `r_arm_forward` | 右腕 | [90,0,0] | 81.3 | 167.4 | +2.84 | 手臂前举 | 正确 |
| `r_arm_xneg90` | 右腕 | [-90,0,0] | 92.8 | 175.2 | -3.28 | 手臂后伸 | 正确 |
| `r_arm_y90` | 右腕 | [0,90,0] | 59.6 | 164.5 | -4.58 | 手臂内旋 | 正确 |
| `r_arm_45deg` | 右腕 | [45,0,45] | 37.5 | 160.6 | +2.74 | 前偏移对，肩角偏小 | 部分正确 |
| `r_arm_x90z90` | 右腕 | [90,0,90] | 73.5 | 160.4 | +3.69 | X前举有效，Z无效 | 正确 |
| `r_arm_vertical` | 右腕 | [0,0,180] | 145.4 | 158.1 | +0.17 | 接近垂直举起 | 正确 |
| `r_elbow_bend` | 右腕+右ひじ | arm+elbow Z=90 | 22.8 | 70.3 | -0.36 | 肘弯曲对，手臂未抬起 | 部分正确 |
| `r_shoulder_z90` | 右肩 | [0,0,90] | 34.1 | 171.7 | -0.93 | 肩骨Z正方向几乎无效 | 错误 |
| `r_shoulder_x90` | 右肩 | [90,0,0] | 80.9 | 171.7 | +3.23 | 肩骨前举有效 | 正确 |

## 完整骨骼轴向映射表 (20260701)

完整 17 根 PMX 骨骼、每根 6 轴（共 102 个测试，4 角度 = 408 张渲染）。

T-pose baseline: R_elbow=168.8, L_elbow=171.7, R_shldr=63.2, L_shldr=59.6, R_knee=171.8, L_knee=170.8, ankle_span=1.363

### 右臂

| 骨骼 | 轴 | 效果 | 判定 |
|---|---|---|---|
| 右腕 (r_upper_arm) | +X | 无效果 (change=0) | 错误 |
| 右腕 | -X | 后伸，肩角63→72.5 | 正确 |
| 右腕 | +Y | 内旋，肩角63→62.3 | 微弱 |
| 右腕 | -Y | 外旋，肩角63→53 | 正确 |
| 右腕 | +Z | 手臂内收，肩角63→27.6 | 正确 |
| 右腕 | -Z | 手臂外展，肩角63→91.6 | 正确 |

### 右肘

| 骨骼 | 轴 | 效果 | 判定 |
|---|---|---|---|
| 右ひじ (r_elbow) | +X | 肘伸，168→148 | 正确 |
| 右ひじ | -X | 肘弯，168→161 | 微弱 |
| 右ひじ | +Y | 肘弯，168→149 | 正确 |
| 右ひじ | -Y | 肘弯加深，168→136 | 正确 |
| 右ひじ | +Z | 肘弯最大，168→130 | 正确 |
| 右ひじ | -Z | 肘弯，168→139 | 正确 |

### 右肩

| 骨骼 | 轴 | 效果 | 判定 |
|---|---|---|---|
| 右肩 (r_shoulder) | +X | 微弱 (change=2.9) | 无效 |
| 右肩 | -X | 后伸，肩角63→75.8 | 正确 |
| 右肩 | +Y | 微弱 (change=2.9) | 无效 |
| 右肩 | -Y | 下降，肩角63→53.6 | 正确 |
| 右肩 | +Z | 手臂内收，肩角63→18.6 | 正确 |
| 右肩 | -Z | 手臂外展，肩角63→103.9 | 正确 |

### 左臂（右臂镜像）

| 骨骼 | 轴 | 效果 | 判定 |
|---|---|---|---|
| 左腕 (l_upper_arm) | +X | 微弱 (change=3.6) | 无效 |
| 左腕 | -X | 后伸，肩角60→72.5 | 正确 |
| 左腕 | +Y | 外旋，肩角60→53 | 正确 |
| 左腕 | -Y | 内旋，肩角60→62.3 | 微弱 |
| 左腕 | +Z | 外展，肩角60→91.6 | 正确 |
| 左腕 | -Z | 内收，肩角60→27.6 | 正确 |
| 左ひじ (l_elbow) | +X | 肘伸，172→148 | 正确 |
| 左ひじ | +Y | 肘弯，172→136 | 正确 |
| 左ひじ | -Y | 肘弯，172→149 | 正确 |
| 左ひじ | +Z | 肘弯，172→139 | 正确 |
| 左ひじ | -Z | 肘弯最大，172→130 | 正确 |
| 左肩 (l_shoulder) | -X | 后伸，肩角60→75.8 | 正确 |
| 左肩 | +Z | 外展，肩角60→103.9 | 正确 |
| 左肩 | -Z | 内收，肩角60→18.6 | 正确 |

### 右腿

| 骨骼 | 轴 | 效果 | 判定 |
|---|---|---|---|
| 右足 (r_hip) | +X | 腿前伸，ankle_span 1.36→7.51 | 正确 |
| 右足 | -X | 腿后伸，ankle_span 1.36→7.51 | 正确 |
| 右足 | +Y | 腿外展，ankle_span 1.36→1.14 | 正确 |
| 右足 | -Y | 腿内收，ankle_span 1.36→1.82 | 正确 |
| 右足 | +Z | 腿外旋，ankle_span 1.36→6.16 | 正确 |
| 右足 | -Z | 腿内旋，ankle_span 1.36→8.66 | 正确 |
| 右ひざ (r_knee) | +X | 膝伸，172→143 | 正确 |
| 右ひざ | -X | 膝弯，172→127 | 正确 |
| 右ひざ | +Z | 膝弯，172→134 | 正确 |
| 右ひざ | -Z | 膝弯，172→135 | 正确 |
| 右足首 (r_ankle) | 所有轴 | 已修复 (Grant solver) | 正确 |

### 左腿（右腿镜像）

| 骨骼 | 轴 | 效果 | 判定 |
|---|---|---|---|
| 左足 (l_hip) | +X | 腿前伸 | 正确 |
| 左足 | -X | 腿后伸 | 正确 |
| 左足 | +Y | 腿内收 | 正确 |
| 左足 | -Y | 腿外展 | 正确 |
| 左足 | +Z | 腿内旋 | 正确 |
| 左足 | -Z | 腿外旋 | 正确 |
| 左ひざ (l_knee) | +X | 膝伸，171→144 | 正确 |
| 左ひざ | -X | 膝弯，171→126 | 正确 |
| 左ひざ | +Z | 膝弯，171→134 | 正确 |
| 左ひざ | -Z | 膝弯，171→134 | 正确 |
| 左足首 (l_ankle) | 所有轴 | 已修复 (Grant solver) | 正确 |

### 躯干

| 骨骼 | 轴 | 效果 | 判定 |
|---|---|---|---|
| 上半身 (upper_body) | +X | 微弱前倾 | 微弱 |
| 上半身 | -X | 微弱后仰 | 微弱 |
| 上半身 | +Y | 微弱侧旋 | 微弱 |
| 上半身 | -Y | 微弱侧旋 | 微弱 |
| 上半身 | +Z | 侧弯，右肩57.9/左肩61.4 | 正确 |
| 下半身 (lower_body) | X/Z有效, Y微弱 | 已修复 | 正确 |
| 上半身2 (upper_body2) | -X | 后仰，肩角59→66.6 | 正确 |
| 上半身2 | +Z | 右侧弯，右肩36/左肩84 | 正确 |
| 上半身2 | -Z | 左侧弯，右肩84/左肩36 | 正确 |

### 头/颈

| 骨骼 | 轴 | 效果 | 判定 |
|---|---|---|---|
| 首 (neck) | 所有轴 | 已修复 (Grant solver) | 正确 |
| 頭 (head) | 所有轴 | 截图MD5全部不同 | 正确(视觉) |

## 关键发现

1. **右腕 +X 无效**: 前举应该用 -X（非 +X）。45° 测试显示 +X 零效果但 90° 测试有效，可能是阈值问题或骨骼有旋转限制。
2. **右肩 +X 和 +Y 无效**: 肩胛骨只对 -X、-Y 和 Z 轴响应。
3. **左右镜像对称**: 左腕 Z 正方向是外展（右腕 Z 正方向是内收），符合镜像对称。
4. **踝关节和下半身无效**: 右足首、左足首、下半身、首、頭 对所有轴旋转无响应。可能是 IK 骨骼或被物理引擎控制。
5. **上半身效果微弱**: 45° 旋转只产生 <6° 的变化，可能需要更大角度才能看到明显效果。
6. **右腕 Z 轴反转**: `Z=+90` 产生内收而非外展，retargeter 必须对 BVH 手臂外展的 Z 分量取反。

## 早期轴向映射摘要（已被上方完整表替代，保留作参考）

`右腕` (right upper arm):
- X+ = forward raise (correct)
- X- = backward extension (correct)
- Y+ = internal rotation (correct)
- Z+ = no effect (BUG - should be arm abduction)
- Z- = arm abduction / horizontal raise (correct but inverted)

`右肩` (right shoulder blade):
- X+ = forward raise (correct)
- Z+ = almost no effect (BUG)

## 下半身+头颈 重新验证 (20260702 Grant solver 修复后)

Baseline (rest): r_pitch=-55.0, r_yaw=-4.8, l_pitch=-55.2, l_yaw=4.8, r_knee=171.8, l_knee=170.8

**根因**: PMX 模型使用 Grant（付与）骨骼系统。顶点权重绑定在 'D' 后缀的变形骨上（右足首D: 561顶点, 右足D: 1371顶点）。控制骨旋转需要通过 Grant solver 传递给变形骨。之前 calibration 模式跳过了 helper.update()，导致 Grant solver 不运行。修复方案：在 seekVmdFrame 和 renderFrame 的 calibration 分支中添加 grantSolver.update()。

### 右足首 (r_ankle) — 之前标记为「无效」，现已修复

| 文件夹 | 骨骼 | 输入旋转 | r_pch_Δ | r_yaw_Δ | l_pch_Δ | l_yaw_Δ | r_knee_Δ | l_knee_Δ | t_lean_Δ | h_pch_Δ | h_yaw_Δ | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `basic_r_ankle_xp` | 右足首 | +X | 44.9 | 2.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | pitch+45° | 正确 |
| `basic_r_ankle_xn` | 右足首 | -X | -24.5 | -159.8 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | pitch-24°, yaw-160° | 正确 |
| `basic_r_ankle_yp` | 右足首 | +Y | 0.0 | -45.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | yaw-45° | 正确 |
| `basic_r_ankle_yn` | 右足首 | -Y | 0.0 | 45.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | yaw+45° | 正确 |
| `basic_r_ankle_zp` | 右足首 | +Z | 17.2 | 48.5 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | pitch+17°, yaw+49° | 正确 |
| `basic_r_ankle_zn` | 右足首 | -Z | 22.0 | -42.2 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | pitch+22°, yaw-42° | 正确 |

### 左足首 (l_ankle) — 之前标记为「无效」，现已修复

| 文件夹 | 骨骼 | 输入旋转 | r_pch_Δ | r_yaw_Δ | l_pch_Δ | l_yaw_Δ | r_knee_Δ | l_knee_Δ | t_lean_Δ | h_pch_Δ | h_yaw_Δ | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `basic_l_ankle_xp` | 左足首 | +X | 0.0 | 0.0 | 44.9 | -2.0 | 0.0 | -0.0 | 0.0 | 0.0 | 0.0 | pitch+45° | 正确 |
| `basic_l_ankle_xn` | 左足首 | -X | 0.0 | 0.0 | -24.2 | 160.1 | 0.0 | -0.0 | 0.0 | 0.0 | 0.0 | pitch-24°, yaw+160° | 正确 |
| `basic_l_ankle_yp` | 左足首 | +Y | 0.0 | 0.0 | 0.0 | -45.0 | 0.0 | -0.0 | 0.0 | 0.0 | 0.0 | yaw-45° | 正确 |
| `basic_l_ankle_yn` | 左足首 | -Y | 0.0 | 0.0 | 0.0 | 45.0 | 0.0 | -0.0 | 0.0 | 0.0 | 0.0 | yaw+45° | 正确 |
| `basic_l_ankle_zp` | 左足首 | +Z | 0.0 | 0.0 | 22.0 | 42.4 | 0.0 | -0.0 | 0.0 | 0.0 | 0.0 | pitch+22°, yaw+42° | 正确 |
| `basic_l_ankle_zn` | 左足首 | -Z | 0.0 | 0.0 | 17.3 | -48.6 | 0.0 | -0.0 | 0.0 | 0.0 | 0.0 | pitch+17°, yaw-49° | 正确 |

### 右ひざ (r_knee)

| 文件夹 | 骨骼 | 输入旋转 | r_knee_Δ | 效果 | 判定 |
|---|---|---|---|---|---|
| `basic_r_knee_xp` | 右ひざ | +X | -28.6 | 膝角变化-29° | 正确 |
| `basic_r_knee_xn` | 右ひざ | -X | -45.0 | 膝角变化-45° | 正确 |
| `basic_r_knee_yp` | 右ひざ | +Y | 1.5 | 膝角变化+1° | 微弱 |
| `basic_r_knee_yn` | 右ひざ | -Y | -0.9 | 膝角变化-1° | 微弱 |
| `basic_r_knee_zp` | 右ひざ | +Z | -37.7 | 膝角变化-38° | 正确 |
| `basic_r_knee_zn` | 右ひざ | -Z | -37.2 | 膝角变化-37° | 正确 |

### 左ひざ (l_knee)

| 文件夹 | 骨骼 | 输入旋转 | l_knee_Δ | 效果 | 判定 |
|---|---|---|---|---|---|
| `basic_l_knee_xp` | 左ひざ | +X | -26.6 | 膝角变化-27° | 正确 |
| `basic_l_knee_xn` | 左ひざ | -X | -45.0 | 膝角变化-45° | 正确 |
| `basic_l_knee_yp` | 左ひざ | +Y | -0.8 | 膝角变化-1° | 微弱 |
| `basic_l_knee_yn` | 左ひざ | -Y | 1.6 | 膝角变化+2° | 微弱 |
| `basic_l_knee_zp` | 左ひざ | +Z | -36.4 | 膝角变化-36° | 正确 |
| `basic_l_knee_zn` | 左ひざ | -Z | -36.9 | 膝角变化-37° | 正确 |

### 下半身 (lower_body) — 之前标记为「无效」，现已修复

| 文件夹 | 骨骼 | 输入旋转 | r_pch_Δ | l_pch_Δ | r_yaw_Δ | l_yaw_Δ | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_lower_body_xp` | 下半身 | +X | 44.9 | 44.9 | 2.0 | -2.0 | 踝pitch+45° | 正确 |
| `basic_lower_body_xn` | 下半身 | -X | -24.5 | -24.2 | -159.8 | 160.1 | 踝pitch-24° | 正确 |
| `basic_lower_body_yp` | 下半身 | +Y | 0.0 | 0.0 | -45.0 | -45.0 | 变化小(度量) | 微弱(度量) |
| `basic_lower_body_yn` | 下半身 | -Y | 0.0 | 0.0 | 45.0 | 45.0 | 变化小(度量) | 微弱(度量) |
| `basic_lower_body_zp` | 下半身 | +Z | 17.2 | 22.0 | 48.5 | 42.4 | 踝pitch+17° | 正确 |
| `basic_lower_body_zn` | 下半身 | -Z | 22.0 | 17.3 | -42.2 | -48.6 | 踝pitch+22° | 正确 |

### 首 (neck) — 之前标记为「无效」，现已修复

| 文件夹 | 骨骼 | 输入旋转 | h_pch_Δ | h_yaw_Δ | 效果 | 判定 |
|---|---|---|---|---|---|---|
| `basic_neck_xp` | 首 | +X | -33.9 | 180.0 | pitch-34°, yaw+180° | 正确 |
| `basic_neck_xn` | 首 | -X | -45.0 | -0.0 | pitch-45° | 正确 |
| `basic_neck_yp` | 首 | +Y | 0.0 | -45.0 | yaw-45° | 正确 |
| `basic_neck_yn` | 首 | -Y | 0.0 | 45.0 | yaw+45° | 正确 |
| `basic_neck_zp` | 首 | +Z | -39.7 | -82.2 | pitch-40°, yaw-82° | 正确 |
| `basic_neck_zn` | 首 | -Z | -39.7 | 82.2 | pitch-40°, yaw+82° | 正确 |

### 頭 (head) — 之前标记为「无效」，现已修复

| 文件夹 | 骨骼 | 输入旋转 | h_pch_Δ | h_yaw_Δ | 效果 | 判定 |
|---|---|---|---|---|---|---|
| `basic_head_xp` | 頭 | +X | 0.0 | 0.0 | 度量小但截图MD5全部不同 | 正确(视觉) |
| `basic_head_xn` | 頭 | -X | 0.0 | 0.0 | 度量小但截图MD5全部不同 | 正确(视觉) |
| `basic_head_yp` | 頭 | +Y | 0.0 | 0.0 | 度量小但截图MD5全部不同 | 正确(视觉) |
| `basic_head_yn` | 頭 | -Y | 0.0 | 0.0 | 度量小但截图MD5全部不同 | 正确(视觉) |
| `basic_head_zp` | 頭 | +Z | 0.0 | 0.0 | 度量小但截图MD5全部不同 | 正确(视觉) |
| `basic_head_zn` | 頭 | -Z | 0.0 | 0.0 | 度量小但截图MD5全部不同 | 正确(视觉) |

> 頭骨的度量数据(head_orientation: neck→head 向量)变化小，但截图 MD5 全部不同(视觉有变化)。这是因为頭骨旋转改变的是头部顶点朝向，但 neck→head 的向量本身很短且方向变化不大。

## 截图和 GIF 位置

- 四角度截图: `imgToAction/outputs/actions/20260701_axis_shot/{bone_id}/{front,left,right,back}/`
- 四角度 GIF 动画: `imgToAction/outputs/actions/20260701_axis_gif/{bone_id}_4angle.gif` (2x2 grid: left|front / right|back)
- 单角度 GIF: `imgToAction/outputs/actions/20260701_axis_gif/{bone_id}_{angle}.gif`

## 截图和 GIF 位置 (20260702 Grant solver 修复后)

- 四角度截图: `imgToAction/outputs/actions/20260702_axis_shot/{bone_id}/{front,left,right,back}/basic_{bone_id}_{axis}.png`
- 四角度 GIF 动画: `imgToAction/outputs/actions/20260702_axis_gif/{bone_id}_4angle.gif` (2x2 grid: left|front / right|back)
- 单角度 GIF: `imgToAction/outputs/actions/20260702_axis_gif/{bone_id}_{angle}.gif`
- 度量数据: `imgToAction/outputs/actions/20260702_lower_metrics/all_metrics.json`

新增骨骼: r_ankle, l_ankle, r_hip, l_hip, r_knee, l_knee, lower_body, neck, head (共 9 骨骼 × 6 轴 × 4 角度 = 216 张截图)

## 手指骨骼基准测试 (20260702)

测试范围：30 个手指关节骨 + 8 个手腕扭转骨 + 2 个握拳组合动作，共 231 个 VMD × 4 角度 = 924 张截图。

手指骨骼不使用 Grant 系统（flags=0x0），顶点权重直接绑定在骨骼上。Grant solver 修复对此无影响。


### 右手拇指

| 文件夹 | 骨骼 | 输入旋转 | 截图变化 | 判定 |
|---|---|---|---|---|
| `basic_r_thumb0_xp` | 右親指０ | +X | 是 | 正确 |
| `basic_r_thumb0_xn` | 右親指０ | -X | 是 | 正确 |
| `basic_r_thumb0_yp` | 右親指０ | +Y | 是 | 正确 |
| `basic_r_thumb0_yn` | 右親指０ | -Y | 是 | 正确 |
| `basic_r_thumb0_zp` | 右親指０ | +Z | 是 | 正确 |
| `basic_r_thumb0_zn` | 右親指０ | -Z | 是 | 正确 |
| `basic_r_thumb1_xp` | 右親指１ | +X | 是 | 正确 |
| `basic_r_thumb1_xn` | 右親指１ | -X | 是 | 正确 |
| `basic_r_thumb1_yp` | 右親指１ | +Y | 是 | 正确 |
| `basic_r_thumb1_yn` | 右親指１ | -Y | 是 | 正确 |
| `basic_r_thumb1_zp` | 右親指１ | +Z | 是 | 正确 |
| `basic_r_thumb1_zn` | 右親指１ | -Z | 是 | 正确 |
| `basic_r_thumb2_xp` | 右親指２ | +X | 是 | 正确 |
| `basic_r_thumb2_xn` | 右親指２ | -X | 是 | 正确 |
| `basic_r_thumb2_yp` | 右親指２ | +Y | 是 | 正确 |
| `basic_r_thumb2_yn` | 右親指２ | -Y | 是 | 正确 |
| `basic_r_thumb2_zp` | 右親指２ | +Z | 是 | 正确 |
| `basic_r_thumb2_zn` | 右親指２ | -Z | 是 | 正确 |

### 右手食指

| 文件夹 | 骨骼 | 输入旋转 | 截图变化 | 判定 |
|---|---|---|---|---|
| `basic_r_index1_xp` | 右人指１ | +X | 是 | 正确 |
| `basic_r_index1_xn` | 右人指１ | -X | 是 | 正确 |
| `basic_r_index1_yp` | 右人指１ | +Y | 是 | 正确 |
| `basic_r_index1_yn` | 右人指１ | -Y | 是 | 正确 |
| `basic_r_index1_zp` | 右人指１ | +Z | 是 | 正确 |
| `basic_r_index1_zn` | 右人指１ | -Z | 是 | 正确 |
| `basic_r_index2_xp` | 右人指２ | +X | 是 | 正确 |
| `basic_r_index2_xn` | 右人指２ | -X | 是 | 正确 |
| `basic_r_index2_yp` | 右人指２ | +Y | 是 | 正确 |
| `basic_r_index2_yn` | 右人指２ | -Y | 是 | 正确 |
| `basic_r_index2_zp` | 右人指２ | +Z | 是 | 正确 |
| `basic_r_index2_zn` | 右人指２ | -Z | 是 | 正确 |
| `basic_r_index3_xp` | 右人指３ | +X | 是 | 正确 |
| `basic_r_index3_xn` | 右人指３ | -X | 是 | 正确 |
| `basic_r_index3_yp` | 右人指３ | +Y | 是 | 正确 |
| `basic_r_index3_yn` | 右人指３ | -Y | 是 | 正确 |
| `basic_r_index3_zp` | 右人指３ | +Z | 是 | 正确 |
| `basic_r_index3_zn` | 右人指３ | -Z | 是 | 正确 |

### 右手中指

| 文件夹 | 骨骼 | 输入旋转 | 截图变化 | 判定 |
|---|---|---|---|---|
| `basic_r_middle1_xp` | 右中指１ | +X | 是 | 正确 |
| `basic_r_middle1_xn` | 右中指１ | -X | 是 | 正确 |
| `basic_r_middle1_yp` | 右中指１ | +Y | 是 | 正确 |
| `basic_r_middle1_yn` | 右中指１ | -Y | 是 | 正确 |
| `basic_r_middle1_zp` | 右中指１ | +Z | 是 | 正确 |
| `basic_r_middle1_zn` | 右中指１ | -Z | 是 | 正确 |
| `basic_r_middle2_xp` | 右中指２ | +X | 是 | 正确 |
| `basic_r_middle2_xn` | 右中指２ | -X | 是 | 正确 |
| `basic_r_middle2_yp` | 右中指２ | +Y | 是 | 正确 |
| `basic_r_middle2_yn` | 右中指２ | -Y | 是 | 正确 |
| `basic_r_middle2_zp` | 右中指２ | +Z | 是 | 正确 |
| `basic_r_middle2_zn` | 右中指２ | -Z | 是 | 正确 |
| `basic_r_middle3_xp` | 右中指３ | +X | 是 | 正确 |
| `basic_r_middle3_xn` | 右中指３ | -X | 是 | 正确 |
| `basic_r_middle3_yp` | 右中指３ | +Y | 是 | 正确 |
| `basic_r_middle3_yn` | 右中指３ | -Y | 是 | 正确 |
| `basic_r_middle3_zp` | 右中指３ | +Z | 是 | 正确 |
| `basic_r_middle3_zn` | 右中指３ | -Z | 是 | 正确 |

### 右手无名指

| 文件夹 | 骨骼 | 输入旋转 | 截图变化 | 判定 |
|---|---|---|---|---|
| `basic_r_ring1_xp` | 右薬指１ | +X | 是 | 正确 |
| `basic_r_ring1_xn` | 右薬指１ | -X | 是 | 正确 |
| `basic_r_ring1_yp` | 右薬指１ | +Y | 是 | 正确 |
| `basic_r_ring1_yn` | 右薬指１ | -Y | 是 | 正确 |
| `basic_r_ring1_zp` | 右薬指１ | +Z | 是 | 正确 |
| `basic_r_ring1_zn` | 右薬指１ | -Z | 是 | 正确 |
| `basic_r_ring2_xp` | 右薬指２ | +X | 是 | 正确 |
| `basic_r_ring2_xn` | 右薬指２ | -X | 是 | 正确 |
| `basic_r_ring2_yp` | 右薬指２ | +Y | 是 | 正确 |
| `basic_r_ring2_yn` | 右薬指２ | -Y | 是 | 正确 |
| `basic_r_ring2_zp` | 右薬指２ | +Z | 是 | 正确 |
| `basic_r_ring2_zn` | 右薬指２ | -Z | 是 | 正确 |
| `basic_r_ring3_xp` | 右薬指３ | +X | 是 | 正确 |
| `basic_r_ring3_xn` | 右薬指３ | -X | 是 | 正确 |
| `basic_r_ring3_yp` | 右薬指３ | +Y | 是 | 正确 |
| `basic_r_ring3_yn` | 右薬指３ | -Y | 是 | 正确 |
| `basic_r_ring3_zp` | 右薬指３ | +Z | 是 | 正确 |
| `basic_r_ring3_zn` | 右薬指３ | -Z | 是 | 正确 |

### 右手小指

| 文件夹 | 骨骼 | 输入旋转 | 截图变化 | 判定 |
|---|---|---|---|---|
| `basic_r_pinky1_xp` | 右小指１ | +X | 是 | 正确 |
| `basic_r_pinky1_xn` | 右小指１ | -X | 是 | 正确 |
| `basic_r_pinky1_yp` | 右小指１ | +Y | 是 | 正确 |
| `basic_r_pinky1_yn` | 右小指１ | -Y | 是 | 正确 |
| `basic_r_pinky1_zp` | 右小指１ | +Z | 是 | 正确 |
| `basic_r_pinky1_zn` | 右小指１ | -Z | 是 | 正确 |
| `basic_r_pinky2_xp` | 右小指２ | +X | 是 | 正确 |
| `basic_r_pinky2_xn` | 右小指２ | -X | 是 | 正确 |
| `basic_r_pinky2_yp` | 右小指２ | +Y | 是 | 正确 |
| `basic_r_pinky2_yn` | 右小指２ | -Y | 是 | 正确 |
| `basic_r_pinky2_zp` | 右小指２ | +Z | 是 | 正确 |
| `basic_r_pinky2_zn` | 右小指２ | -Z | 是 | 正确 |
| `basic_r_pinky3_xp` | 右小指３ | +X | 是 | 正确 |
| `basic_r_pinky3_xn` | 右小指３ | -X | 是 | 正确 |
| `basic_r_pinky3_yp` | 右小指３ | +Y | 是 | 正确 |
| `basic_r_pinky3_yn` | 右小指３ | -Y | 是 | 正确 |
| `basic_r_pinky3_zp` | 右小指３ | +Z | 是 | 正确 |
| `basic_r_pinky3_zn` | 右小指３ | -Z | 是 | 正确 |

### 左手拇指

| 文件夹 | 骨骼 | 输入旋转 | 截图变化 | 判定 |
|---|---|---|---|---|
| `basic_l_thumb0_xp` | 左親指０ | +X | 是 | 正确 |
| `basic_l_thumb0_xn` | 左親指０ | -X | 是 | 正确 |
| `basic_l_thumb0_yp` | 左親指０ | +Y | 是 | 正确 |
| `basic_l_thumb0_yn` | 左親指０ | -Y | 是 | 正确 |
| `basic_l_thumb0_zp` | 左親指０ | +Z | 是 | 正确 |
| `basic_l_thumb0_zn` | 左親指０ | -Z | 是 | 正确 |
| `basic_l_thumb1_xp` | 左親指１ | +X | 是 | 正确 |
| `basic_l_thumb1_xn` | 左親指１ | -X | 是 | 正确 |
| `basic_l_thumb1_yp` | 左親指１ | +Y | 是 | 正确 |
| `basic_l_thumb1_yn` | 左親指１ | -Y | 是 | 正确 |
| `basic_l_thumb1_zp` | 左親指１ | +Z | 是 | 正确 |
| `basic_l_thumb1_zn` | 左親指１ | -Z | 是 | 正确 |
| `basic_l_thumb2_xp` | 左親指２ | +X | 是 | 正确 |
| `basic_l_thumb2_xn` | 左親指２ | -X | 是 | 正确 |
| `basic_l_thumb2_yp` | 左親指２ | +Y | 是 | 正确 |
| `basic_l_thumb2_yn` | 左親指２ | -Y | 是 | 正确 |
| `basic_l_thumb2_zp` | 左親指２ | +Z | 是 | 正确 |
| `basic_l_thumb2_zn` | 左親指２ | -Z | 是 | 正确 |

### 左手食指

| 文件夹 | 骨骼 | 输入旋转 | 截图变化 | 判定 |
|---|---|---|---|---|
| `basic_l_index1_xp` | 左人指１ | +X | 是 | 正确 |
| `basic_l_index1_xn` | 左人指１ | -X | 是 | 正确 |
| `basic_l_index1_yp` | 左人指１ | +Y | 是 | 正确 |
| `basic_l_index1_yn` | 左人指１ | -Y | 是 | 正确 |
| `basic_l_index1_zp` | 左人指１ | +Z | 是 | 正确 |
| `basic_l_index1_zn` | 左人指１ | -Z | 是 | 正确 |
| `basic_l_index2_xp` | 左人指２ | +X | 是(左/后角度) | 正确 |
| `basic_l_index2_xn` | 左人指２ | -X | 是(左/后角度) | 正确 |
| `basic_l_index2_yp` | 左人指２ | +Y | 是(左/后角度) | 正确 |
| `basic_l_index2_yn` | 左人指２ | -Y | 是(左/后角度) | 正确 |
| `basic_l_index2_zp` | 左人指２ | +Z | 是(左/后角度) | 正确 |
| `basic_l_index2_zn` | 左人指２ | -Z | 是(左/后角度) | 正确 |
| `basic_l_index3_xp` | 左人指３ | +X | 是(左/后角度) | 正确 |
| `basic_l_index3_xn` | 左人指３ | -X | 是(左/后角度) | 正确 |
| `basic_l_index3_yp` | 左人指３ | +Y | 是(左/后角度) | 正确 |
| `basic_l_index3_yn` | 左人指３ | -Y | 是(左/后角度) | 正确 |
| `basic_l_index3_zp` | 左人指３ | +Z | 是(左/后角度) | 正确 |
| `basic_l_index3_zn` | 左人指３ | -Z | 是(左/后角度) | 正确 |

### 左手中指

| 文件夹 | 骨骼 | 输入旋转 | 截图变化 | 判定 |
|---|---|---|---|---|
| `basic_l_middle1_xp` | 左中指１ | +X | 是 | 正确 |
| `basic_l_middle1_xn` | 左中指１ | -X | 是 | 正确 |
| `basic_l_middle1_yp` | 左中指１ | +Y | 是 | 正确 |
| `basic_l_middle1_yn` | 左中指１ | -Y | 是 | 正确 |
| `basic_l_middle1_zp` | 左中指１ | +Z | 是 | 正确 |
| `basic_l_middle1_zn` | 左中指１ | -Z | 是 | 正确 |
| `basic_l_middle2_xp` | 左中指２ | +X | 是(左/后角度) | 正确 |
| `basic_l_middle2_xn` | 左中指２ | -X | 是(左/后角度) | 正确 |
| `basic_l_middle2_yp` | 左中指２ | +Y | 是(左/后角度) | 正确 |
| `basic_l_middle2_yn` | 左中指２ | -Y | 是(左/后角度) | 正确 |
| `basic_l_middle2_zp` | 左中指２ | +Z | 是(左/后角度) | 正确 |
| `basic_l_middle2_zn` | 左中指２ | -Z | 是(左/后角度) | 正确 |
| `basic_l_middle3_xp` | 左中指３ | +X | 是(左/后角度) | 正确 |
| `basic_l_middle3_xn` | 左中指３ | -X | 是(左/后角度) | 正确 |
| `basic_l_middle3_yp` | 左中指３ | +Y | 是(左/后角度) | 正确 |
| `basic_l_middle3_yn` | 左中指３ | -Y | 是(左/后角度) | 正确 |
| `basic_l_middle3_zp` | 左中指３ | +Z | 是(左/后角度) | 正确 |
| `basic_l_middle3_zn` | 左中指３ | -Z | 是(左/后角度) | 正确 |

### 左手无名指

| 文件夹 | 骨骼 | 输入旋转 | 截图变化 | 判定 |
|---|---|---|---|---|
| `basic_l_ring1_xp` | 左薬指１ | +X | 是 | 正确 |
| `basic_l_ring1_xn` | 左薬指１ | -X | 是 | 正确 |
| `basic_l_ring1_yp` | 左薬指１ | +Y | 是 | 正确 |
| `basic_l_ring1_yn` | 左薬指１ | -Y | 是 | 正确 |
| `basic_l_ring1_zp` | 左薬指１ | +Z | 是 | 正确 |
| `basic_l_ring1_zn` | 左薬指１ | -Z | 是 | 正确 |
| `basic_l_ring2_xp` | 左薬指２ | +X | 是(左/后角度) | 正确 |
| `basic_l_ring2_xn` | 左薬指２ | -X | 是(左/后角度) | 正确 |
| `basic_l_ring2_yp` | 左薬指２ | +Y | 是(左/后角度) | 正确 |
| `basic_l_ring2_yn` | 左薬指２ | -Y | 是(左/后角度) | 正确 |
| `basic_l_ring2_zp` | 左薬指２ | +Z | 是(左/后角度) | 正确 |
| `basic_l_ring2_zn` | 左薬指２ | -Z | 是(左/后角度) | 正确 |
| `basic_l_ring3_xp` | 左薬指３ | +X | 是(左/后角度) | 正确 |
| `basic_l_ring3_xn` | 左薬指３ | -X | 是(左/后角度) | 正确 |
| `basic_l_ring3_yp` | 左薬指３ | +Y | 是(左/后角度) | 正确 |
| `basic_l_ring3_yn` | 左薬指３ | -Y | 是(左/后角度) | 正确 |
| `basic_l_ring3_zp` | 左薬指３ | +Z | 是(左/后角度) | 正确 |
| `basic_l_ring3_zn` | 左薬指３ | -Z | 是(左/后角度) | 正确 |

### 左手小指

| 文件夹 | 骨骼 | 输入旋转 | 截图变化 | 判定 |
|---|---|---|---|---|
| `basic_l_pinky1_xp` | 左小指１ | +X | 是(左/后角度) | 正确 |
| `basic_l_pinky1_xn` | 左小指１ | -X | 是 | 正确 |
| `basic_l_pinky1_yp` | 左小指１ | +Y | 是 | 正确 |
| `basic_l_pinky1_yn` | 左小指１ | -Y | 是(左/后角度) | 正确 |
| `basic_l_pinky1_zp` | 左小指１ | +Z | 是 | 正确 |
| `basic_l_pinky1_zn` | 左小指１ | -Z | 是 | 正确 |
| `basic_l_pinky2_xp` | 左小指２ | +X | 是(左/后角度) | 正确 |
| `basic_l_pinky2_xn` | 左小指２ | -X | 是(左/后角度) | 正确 |
| `basic_l_pinky2_yp` | 左小指２ | +Y | 是(左/后角度) | 正确 |
| `basic_l_pinky2_yn` | 左小指２ | -Y | 是(左/后角度) | 正确 |
| `basic_l_pinky2_zp` | 左小指２ | +Z | 是(左/后角度) | 正确 |
| `basic_l_pinky2_zn` | 左小指２ | -Z | 是(左/后角度) | 正确 |
| `basic_l_pinky3_xp` | 左小指３ | +X | 是(左/后角度) | 正确 |
| `basic_l_pinky3_xn` | 左小指３ | -X | 是(左/后角度) | 正确 |
| `basic_l_pinky3_yp` | 左小指３ | +Y | 是(左/后角度) | 正确 |
| `basic_l_pinky3_yn` | 左小指３ | -Y | 是(左/后角度) | 正确 |
| `basic_l_pinky3_zp` | 左小指３ | +Z | 是(左/后角度) | 正确 |
| `basic_l_pinky3_zn` | 左小指３ | -Z | 是(左/后角度) | 正确 |

### 右手腕扭转

| 文件夹 | 骨骼 | 输入旋转 | 截图变化 | 判定 |
|---|---|---|---|---|
| `basic_r_wrist_twist0_xp` | 右手捩 | +X | 是 | 正确 |
| `basic_r_wrist_twist0_xn` | 右手捩 | -X | 是 | 正确 |
| `basic_r_wrist_twist0_yp` | 右手捩 | +Y | 是 | 正确 |
| `basic_r_wrist_twist0_yn` | 右手捩 | -Y | 是 | 正确 |
| `basic_r_wrist_twist0_zp` | 右手捩 | +Z | 是 | 正确 |
| `basic_r_wrist_twist0_zn` | 右手捩 | -Z | 是 | 正确 |
| `basic_r_wrist_twist1_xp` | 右手捩1 | +X | 是 | 正确 |
| `basic_r_wrist_twist1_xn` | 右手捩1 | -X | 是 | 正确 |
| `basic_r_wrist_twist1_yp` | 右手捩1 | +Y | 是 | 正确 |
| `basic_r_wrist_twist1_yn` | 右手捩1 | -Y | 是 | 正确 |
| `basic_r_wrist_twist1_zp` | 右手捩1 | +Z | 是 | 正确 |
| `basic_r_wrist_twist1_zn` | 右手捩1 | -Z | 是 | 正确 |
| `basic_r_wrist_twist2_xp` | 右手捩2 | +X | 是 | 正确 |
| `basic_r_wrist_twist2_xn` | 右手捩2 | -X | 是 | 正确 |
| `basic_r_wrist_twist2_yp` | 右手捩2 | +Y | 是 | 正确 |
| `basic_r_wrist_twist2_yn` | 右手捩2 | -Y | 是 | 正确 |
| `basic_r_wrist_twist2_zp` | 右手捩2 | +Z | 是 | 正确 |
| `basic_r_wrist_twist2_zn` | 右手捩2 | -Z | 是 | 正确 |
| `basic_r_wrist_twist3_xp` | 右手捩3 | +X | 是 | 正确 |
| `basic_r_wrist_twist3_xn` | 右手捩3 | -X | 是 | 正确 |
| `basic_r_wrist_twist3_yp` | 右手捩3 | +Y | 是 | 正确 |
| `basic_r_wrist_twist3_yn` | 右手捩3 | -Y | 是 | 正确 |
| `basic_r_wrist_twist3_zp` | 右手捩3 | +Z | 是 | 正确 |
| `basic_r_wrist_twist3_zn` | 右手捩3 | -Z | 是 | 正确 |

### 左手腕扭转

| 文件夹 | 骨骼 | 输入旋转 | 截图变化 | 判定 |
|---|---|---|---|---|
| `basic_l_wrist_twist0_xp` | 左手捩 | +X | 是 | 正确 |
| `basic_l_wrist_twist0_xn` | 左手捩 | -X | 是 | 正确 |
| `basic_l_wrist_twist0_yp` | 左手捩 | +Y | 是 | 正确 |
| `basic_l_wrist_twist0_yn` | 左手捩 | -Y | 是 | 正确 |
| `basic_l_wrist_twist0_zp` | 左手捩 | +Z | 是 | 正确 |
| `basic_l_wrist_twist0_zn` | 左手捩 | -Z | 是 | 正确 |
| `basic_l_wrist_twist1_xp` | 左手捩1 | +X | 是 | 正确 |
| `basic_l_wrist_twist1_xn` | 左手捩1 | -X | 是 | 正确 |
| `basic_l_wrist_twist1_yp` | 左手捩1 | +Y | 是 | 正确 |
| `basic_l_wrist_twist1_yn` | 左手捩1 | -Y | 是 | 正确 |
| `basic_l_wrist_twist1_zp` | 左手捩1 | +Z | 是 | 正确 |
| `basic_l_wrist_twist1_zn` | 左手捩1 | -Z | 是 | 正确 |
| `basic_l_wrist_twist2_xp` | 左手捩2 | +X | 是 | 正确 |
| `basic_l_wrist_twist2_xn` | 左手捩2 | -X | 是 | 正确 |
| `basic_l_wrist_twist2_yp` | 左手捩2 | +Y | 是 | 正确 |
| `basic_l_wrist_twist2_yn` | 左手捩2 | -Y | 是 | 正确 |
| `basic_l_wrist_twist2_zp` | 左手捩2 | +Z | 是 | 正确 |
| `basic_l_wrist_twist2_zn` | 左手捩2 | -Z | 是 | 正确 |
| `basic_l_wrist_twist3_xp` | 左手捩3 | +X | 是 | 正确 |
| `basic_l_wrist_twist3_xn` | 左手捩3 | -X | 是 | 正确 |
| `basic_l_wrist_twist3_yp` | 左手捩3 | +Y | 是 | 正确 |
| `basic_l_wrist_twist3_yn` | 左手捩3 | -Y | 是 | 正确 |
| `basic_l_wrist_twist3_zp` | 左手捩3 | +Z | 是 | 正确 |
| `basic_l_wrist_twist3_zn` | 左手捩3 | -Z | 是 | 正确 |

### 握拳组合动作

| 文件夹 | 动作 | 截图变化 | 判定 |
|---|---|---|---|
| `basic_r_fist_xn90` | 右手握拳(所有手指X=-90°) | 是 | 正确 |
| `basic_l_fist_xn90` | 左手握拳(所有手指X=-90°) | 是 | 正确 |

### 关键发现

1. **全部 30 个手指关节骨有效**：右手 90/90 正确，左手 90/90 正确（其中左手关节2/3在前视角和右视角因身体遮挡看不到变化，但左视角和后视角确认 6 轴全部有效）。
2. **左手小指第1关节**：前视角 4/6 有效，左/后视角 6/6 有效，判定正确。
3. **手腕扭转骨全部有效**：8 个扭转骨 × 6 轴全部有视觉变化。
4. **握拳组合全部有效**：左右手握拳截图均与 baseline 不同，4 角度截图均存在且有效。
5. **手指骨骼不使用 Grant 系统**：flags=0x0，顶点权重直接绑定。Grant solver 修复对此无影响。
6. **结论**：全部 231 个 VMD 测试通过，所有手指骨骼在三轴旋转下均产生视觉变化，无无效骨骼。

### 截图和 GIF 位置

- 四角度截图: `imgToAction/outputs/actions/20260702_finger_shot/{bone_id}/{front,left,right,back}/basic_{bone_id}_{axis}.png`
- 手指组 GIF: `imgToAction/outputs/actions/20260702_finger_gif/{finger_group}_4angle.gif`
- 握拳四角度图: `imgToAction/outputs/actions/20260702_finger_gif/{fist}_4angle.png`
- 度量数据: `imgToAction/outputs/actions/20260702_finger_metrics/all_metrics.json`
## 前臂扭转测试 (20260702)

测试范围：32个VMD × 4角度 = 236张截图（含3个序列动画VMD）。
测试目的：验证直接旋转腕骨（右腕/左腕）和肘骨（右ひじ）能否产生前臂扭转效果。

### 测试结论

1. **全部29个单帧测试有效**：手腕X轴（15-90度）、手肘X轴（15-90度）、手腕Y/Z轴全部产生视觉变化。
2. **3个序列动画GIF已生成**：X/Y/Z三轴0→90→-90→0度旋转，10帧×4角度。
3. **手腕X轴旋转产生前臂扭转**：文件大小随角度递增呈规律变化，说明捩骨（手捩）跟随父骨骼旋转自动分配扭转量。
4. **手肘X轴旋转也产生前臂扭转**：但变化幅度较小，说明肘骨旋转传递到前臂的扭转量较少。

### 截图和GIF位置

- 四角度截图: `imgToAction/outputs/actions/20260702_twist_shot/{vmd_name}/{front,right,back,left}/`
- 对比图: `imgToAction/outputs/actions/20260702_twist_gif/twist_comparison.png`
- 序列GIF: `imgToAction/outputs/actions/20260702_twist_gif/twist_r_wrist_{x,y,z}seq30_4angle.gif`
- 度量数据: `imgToAction/outputs/actions/20260702_twist_gif/twist_metrics.json`

## 完整度量验证 (20260703)

### 验证范围

对全部手指和扭转测试进行了程序化文件大小 + MD5 校验验证：

- 手指测试: 230 个 VMD × 4 角度 = 920 张截图
- 扭转测试: 32 个 VMD × 4 角度 = 236 张截图 + 12 张序列帧
- 总计: 262 个 VMD, 1168 张截图, 15 个 GIF

### 遮挡分析

通过比较同一骨组内 6 轴截图的文件大小差异，自动检测遮挡：

右手骨骼: 左视角被身体遮挡（手指朝远离左侧相机的方向）
- r_thumb0: 全角度可见
- r_thumb1/2, r_index1/2/3, r_middle1/2/3, r_ring1/2/3, r_pinky1/2/3: 左视角遮挡, 正面/右/后可见

左手骨骼: 右视角被身体遮挡
- l_thumb0/1/2, l_index1, l_middle1, l_ring1, l_pinky1: 右视角遮挡, 正面/左/后可见
- l_index2/3, l_middle2/3, l_ring2/3, l_pinky2/3: 正面+右视角遮挡, 左/后视角可见（关节弯曲幅度小，正面无法观测）

### 判定结果

| 类别 | VMD数 | 正确 | 无效 | GIF数 |
|---|---|---|---|---|
| 手指关节骨 | 180 | 180 | 0 | 10 |
| 手腕扭转骨 | 48 | 48 | 0 | 2 |
| 握拳组合 | 2 | 2 | 0 | 0 (对比图) |
| 前臂扭转 | 32 | 32 | 0 | 3 |
| **合计** | **262** | **262** | **0** | **15** |

### 数据表文件

- 手指数据表: `imgToAction/docs/finger_metrics_table.md`
- 扭转数据表: `imgToAction/docs/twist_metrics_table.md`
- 合并度量JSON: `imgToAction/outputs/actions/20260702_finger_shot/combined_metrics.json`
- 手指度量JSON: `imgToAction/outputs/actions/20260702_finger_metrics/all_metrics.json`
- 扭转度量JSON: `imgToAction/outputs/actions/20260702_twist_gif/twist_metrics.json`
