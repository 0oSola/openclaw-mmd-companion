
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