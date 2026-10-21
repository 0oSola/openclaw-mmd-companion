# 前臂扭转测量数据表

生成时间: 2026-07-03

测试范围: 32 个 VMD × 4 角度 = 236 张截图 + 3 个序列动画 GIF

测试目的: 验证直接旋转腕骨(右腕/左腕)和肘骨(右ひじ)能否产生前臂扭转效果


## 单帧测试 (29 VMD)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | vs基线front | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|---|
| `twist_l_wrist_xn45` | twist_l_wrist_xn45 | X-45° | 344673 | 215985 | 286030 | 246927 | 3120 | 有变化 | 有效 |
| `twist_l_wrist_xn90` | twist_l_wrist_xn90 | X-90° | 341631 | 221099 | 284593 | 252771 | 78 | 有变化 | 有效 |
| `twist_l_wrist_xp45` | twist_l_wrist_xp45 | X+45° | 337849 | 212151 | 285897 | 239266 | 3704 | 有变化 | 有效 |
| `twist_l_wrist_xp90` | twist_l_wrist_xp90 | X+90° | 335442 | 217689 | 284968 | 251799 | 6111 | 有变化 | 有效 |
| `twist_r_elbow_xn15` | twist_r_elbow_xn15 | X-15° | 342201 | 209963 | 287297 | 228826 | 648 | 有变化 | 有效 |
| `twist_r_elbow_xn30` | twist_r_elbow_xn30 | X-30° | 343726 | 209927 | 288019 | 228940 | 2173 | 有变化 | 有效 |
| `twist_r_elbow_xn45` | twist_r_elbow_xn45 | X-45° | 344028 | 210717 | 286330 | 228524 | 2475 | 有变化 | 有效 |
| `twist_r_elbow_xn60` | twist_r_elbow_xn60 | X-60° | 343649 | 213752 | 284644 | 229624 | 2096 | 有变化 | 有效 |
| `twist_r_elbow_xn90` | twist_r_elbow_xn90 | X-90° | 342060 | 215974 | 283039 | 231781 | 507 | 有变化 | 有效 |
| `twist_r_elbow_xp15` | twist_r_elbow_xp15 | X+15° | 341772 | 208799 | 286979 | 228219 | 219 | 有变化 | 有效 |
| `twist_r_elbow_xp30` | twist_r_elbow_xp30 | X+30° | 342272 | 209942 | 286341 | 227407 | 719 | 有变化 | 有效 |
| `twist_r_elbow_xp45` | twist_r_elbow_xp45 | X+45° | 342002 | 210668 | 286328 | 227485 | 449 | 有变化 | 有效 |
| `twist_r_elbow_xp60` | twist_r_elbow_xp60 | X+60° | 341617 | 210677 | 286003 | 227958 | 64 | 有变化 | 有效 |
| `twist_r_elbow_xp90` | twist_r_elbow_xp90 | X+90° | 339910 | 211496 | 284723 | 228603 | 1643 | 有变化 | 有效 |
| `twist_r_wrist_xn15` | twist_r_wrist_xn15 | X-15° | 343036 | 210908 | 289820 | 229171 | 1483 | 有变化 | 有效 |
| `twist_r_wrist_xn30` | twist_r_wrist_xn30 | X-30° | 343951 | 215812 | 287340 | 232709 | 2398 | 有变化 | 有效 |
| `twist_r_wrist_xn45` | twist_r_wrist_xn45 | X-45° | 343698 | 221991 | 286089 | 237229 | 2145 | 有变化 | 有效 |
| `twist_r_wrist_xn60` | twist_r_wrist_xn60 | X-60° | 342182 | 226828 | 284602 | 241224 | 629 | 有变化 | 有效 |
| `twist_r_wrist_xn90` | twist_r_wrist_xn90 | X-90° | 340411 | 229969 | 281265 | 242971 | 1142 | 有变化 | 有效 |
| `twist_r_wrist_xp15` | twist_r_wrist_xp15 | X+15° | 340896 | 208544 | 284752 | 227227 | 657 | 有变化 | 有效 |
| `twist_r_wrist_xp30` | twist_r_wrist_xp30 | X+30° | 341313 | 212789 | 282929 | 229269 | 240 | 有变化 | 有效 |
| `twist_r_wrist_xp45` | twist_r_wrist_xp45 | X+45° | 342116 | 218056 | 284498 | 233972 | 563 | 有变化 | 有效 |
| `twist_r_wrist_xp60` | twist_r_wrist_xp60 | X+60° | 341393 | 221265 | 284745 | 236869 | 160 | 有变化 | 有效 |
| `twist_r_wrist_xp90` | twist_r_wrist_xp90 | X+90° | 340239 | 225882 | 283036 | 239187 | 1314 | 有变化 | 有效 |
| `twist_r_wrist_yn45` | twist_r_wrist_yn45 | Y-45° | 342722 | 222500 | 279516 | 239322 | 1169 | 有变化 | 有效 |
| `twist_r_wrist_yp45` | twist_r_wrist_yp45 | Y+45° | 334292 | 224021 | 282918 | 243415 | 7261 | 有变化 | 有效 |
| `twist_r_wrist_zn45` | twist_r_wrist_zn45 | Z-45° | 341606 | 206636 | 285836 | 228382 | 53 | 有变化 | 有效 |
| `twist_r_wrist_zp45` | twist_r_wrist_zp45 | Z+45° | 325146 | 211624 | 260469 | 228157 | 16407 | 有变化 | 有效 |
| `twist_rest` | 基线 | 基线(0°) | 341553 | 208367 | 286621 | 228350 | - | 基线 | 基线 |

## 序列动画测试 (3 VMD)

| 文件夹 | 骨骼 | 旋转序列 | 帧数 | 4角度截图 | GIF |
|---|---|---|---|---|---|
| `twist_r_wrist_xseq30` | 右腕 | X轴 0→90→-90→0 | 10帧 | 40张 | 已生成 |
| `twist_r_wrist_yseq30` | 右腕 | Y轴 0→90→-90→0 | 10帧 | 40张 | 已生成 |
| `twist_r_wrist_zseq30` | 右腕 | Z轴 0→90→-90→0 | 10帧 | 40张 | 已生成 |

## 截图和GIF位置

- 四角度截图: `imgToAction/outputs/actions/20260702_twist_shot/{vmd_name}/{front,right,back,left}/`
- 对比图: `imgToAction/outputs/actions/20260702_twist_gif/twist_comparison.png`
- 序列GIF: `imgToAction/outputs/actions/20260702_twist_gif/twist_r_wrist_{x,y,z}seq30_4angle.gif`
- 度量数据: `imgToAction/outputs/actions/20260702_twist_gif/twist_metrics.json`