# 手指与手腕基础运动测量数据表

生成时间: 2026-07-03

测试范围: 30 个手指关节骨 + 8 个手腕扭转骨 + 2 个握拳组合 = 230 个 VMD × 4 角度 = 920 张截图

测试角度: 45° (±45° for each axis)

渲染帧: 10


判定逻辑: 同一骨组内 6 轴截图文件大小有差异则该角度「可见」；若某角度 6 轴完全相同则为「遮挡」；只要有一个角度可见即判定为「正确」。


## r_thumb0 (右親指０)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_r_thumb0_xn` | 右親指０ | -X | 341924 | 208135 | 286939 | 228345 | 全角度可见 | 正确 |
| `basic_r_thumb0_xp` | 右親指０ | +X | 341125 | 208016 | 285819 | 228345 | 全角度可见 | 正确 |
| `basic_r_thumb0_yn` | 右親指０ | -Y | 341712 | 208482 | 286241 | 228357 | 全角度可见 | 正确 |
| `basic_r_thumb0_yp` | 右親指０ | +Y | 341457 | 208078 | 286714 | 228345 | 全角度可见 | 正确 |
| `basic_r_thumb0_zn` | 右親指０ | -Z | 341115 | 208139 | 285684 | 228345 | 全角度可见 | 正确 |
| `basic_r_thumb0_zp` | 右親指０ | +Z | 341659 | 208316 | 286260 | 228355 | 全角度可见 | 正确 |

## r_thumb1 (右親指１)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_r_thumb1_xn` | 右親指１ | -X | 341646 | 208094 | 286808 | 228345 | 全角度可见 | 正确 |
| `basic_r_thumb1_xp` | 右親指１ | +X | 341244 | 208365 | 286111 | 228345 | 全角度可见 | 正确 |
| `basic_r_thumb1_yn` | 右親指１ | -Y | 341648 | 208441 | 286367 | 228343 | 全角度可见 | 正确 |
| `basic_r_thumb1_yp` | 右親指１ | +Y | 341670 | 208124 | 286922 | 228345 | 全角度可见 | 正确 |
| `basic_r_thumb1_zn` | 右親指１ | -Z | 341139 | 208411 | 285948 | 228345 | 全角度可见 | 正确 |
| `basic_r_thumb1_zp` | 右親指１ | +Z | 341778 | 208297 | 286412 | 228343 | 全角度可见 | 正确 |

## r_thumb2 (右親指２)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_r_thumb2_xn` | 右親指２ | -X | 341622 | 208229 | 286686 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_thumb2_xp` | 右親指２ | +X | 341421 | 208372 | 286570 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_thumb2_yn` | 右親指２ | -Y | 341501 | 208392 | 286524 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_thumb2_yp` | 右親指２ | +Y | 341602 | 208248 | 286837 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_thumb2_zn` | 右親指２ | -Z | 341376 | 208366 | 286659 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_thumb2_zp` | 右親指２ | +Z | 341480 | 208357 | 286549 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |

## r_index1 (右人指１)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_r_index1_xn` | 右人指１ | -X | 341639 | 208362 | 286575 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_index1_xp` | 右人指１ | +X | 341858 | 208333 | 286799 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_index1_yn` | 右人指１ | -Y | 341612 | 208555 | 287032 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_index1_yp` | 右人指１ | +Y | 341513 | 208392 | 286475 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_index1_zn` | 右人指１ | -Z | 342175 | 208486 | 287093 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_index1_zp` | 右人指１ | +Z | 342003 | 208124 | 287316 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |

## r_index2 (右人指２)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_r_index2_xn` | 右人指２ | -X | 341557 | 208376 | 286489 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_index2_xp` | 右人指２ | +X | 341658 | 208375 | 286654 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_index2_yn` | 右人指２ | -Y | 341581 | 208474 | 286788 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_index2_yp` | 右人指２ | +Y | 341648 | 208414 | 286464 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_index2_zn` | 右人指２ | -Z | 341982 | 208435 | 286719 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_index2_zp` | 右人指２ | +Z | 341683 | 208263 | 287010 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |

## r_index3 (右人指３)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_r_index3_xn` | 右人指３ | -X | 341512 | 208370 | 286522 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_index3_xp` | 右人指３ | +X | 341525 | 208399 | 286605 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_index3_yn` | 右人指３ | -Y | 341553 | 208425 | 286699 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_index3_yp` | 右人指３ | +Y | 341566 | 208378 | 286545 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_index3_zn` | 右人指３ | -Z | 341747 | 208404 | 286609 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_index3_zp` | 右人指３ | +Z | 341678 | 208337 | 286829 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |

## r_middle1 (右中指１)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_r_middle1_xn` | 右中指１ | -X | 341760 | 208492 | 287373 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_middle1_xp` | 右中指１ | +X | 342011 | 208531 | 286911 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_middle1_yn` | 右中指１ | -Y | 341386 | 208569 | 286891 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_middle1_yp` | 右中指１ | +Y | 341425 | 208621 | 286510 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_middle1_zn` | 右中指１ | -Z | 342231 | 208293 | 287470 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_middle1_zp` | 右中指１ | +Z | 341911 | 208430 | 287292 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |

## r_middle2 (右中指２)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_r_middle2_xn` | 右中指２ | -X | 341651 | 208401 | 286844 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_middle2_xp` | 右中指２ | +X | 341822 | 208440 | 286679 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_middle2_yn` | 右中指２ | -Y | 341453 | 208589 | 286647 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_middle2_yp` | 右中指２ | +Y | 341507 | 208453 | 286488 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_middle2_zn` | 右中指２ | -Z | 342136 | 208428 | 287148 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_middle2_zp` | 右中指２ | +Z | 341693 | 208385 | 286951 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |

## r_middle3 (右中指３)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_r_middle3_xn` | 右中指３ | -X | 341546 | 208365 | 286685 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_middle3_xp` | 右中指３ | +X | 341610 | 208415 | 286652 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_middle3_yn` | 右中指３ | -Y | 341487 | 208427 | 286580 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_middle3_yp` | 右中指３ | +Y | 341495 | 208383 | 286489 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_middle3_zn` | 右中指３ | -Z | 341784 | 208447 | 286794 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_middle3_zp` | 右中指３ | +Z | 341636 | 208358 | 286803 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |

## r_ring1 (右薬指１)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_r_ring1_xn` | 右薬指１ | -X | 341702 | 208579 | 287468 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_ring1_xp` | 右薬指１ | +X | 341839 | 208563 | 286711 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_ring1_yn` | 右薬指１ | -Y | 341701 | 208555 | 286934 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_ring1_yp` | 右薬指１ | +Y | 341655 | 209071 | 286980 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_ring1_zn` | 右薬指１ | -Z | 342380 | 208501 | 287621 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_ring1_zp` | 右薬指１ | +Z | 342173 | 208282 | 287419 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |

## r_ring2 (右薬指２)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_r_ring2_xn` | 右薬指２ | -X | 341598 | 208439 | 287058 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_ring2_xp` | 右薬指２ | +X | 341656 | 208473 | 286725 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_ring2_yn` | 右薬指２ | -Y | 341662 | 208489 | 286702 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_ring2_yp` | 右薬指２ | +Y | 341641 | 208614 | 286848 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_ring2_zn` | 右薬指２ | -Z | 342032 | 208484 | 287354 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_ring2_zp` | 右薬指２ | +Z | 341767 | 208373 | 286872 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |

## r_ring3 (右薬指３)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_r_ring3_xn` | 右薬指３ | -X | 341524 | 208400 | 286735 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_ring3_xp` | 右薬指３ | +X | 341531 | 208370 | 286607 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_ring3_yn` | 右薬指３ | -Y | 341557 | 208393 | 286638 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_ring3_yp` | 右薬指３ | +Y | 341582 | 208462 | 286685 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_ring3_zn` | 右薬指３ | -Z | 341685 | 208429 | 286849 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_ring3_zp` | 右薬指３ | +Z | 341687 | 208333 | 286744 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |

## r_pinky1 (右小指１)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_r_pinky1_xn` | 右小指１ | -X | 341371 | 208852 | 286723 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_pinky1_xp` | 右小指１ | +X | 341373 | 208340 | 286394 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_pinky1_yn` | 右小指１ | -Y | 341567 | 208372 | 286659 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_pinky1_yp` | 右小指１ | +Y | 341598 | 209021 | 286874 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_pinky1_zn` | 右小指１ | -Z | 341560 | 208392 | 286788 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_pinky1_zp` | 右小指１ | +Z | 341509 | 208273 | 286508 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |

## r_pinky2 (右小指２)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_r_pinky2_xn` | 右小指２ | -X | 341503 | 208480 | 286665 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_pinky2_xp` | 右小指２ | +X | 341445 | 208370 | 286482 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_pinky2_yn` | 右小指２ | -Y | 341595 | 208372 | 286675 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_pinky2_yp` | 右小指２ | +Y | 341563 | 208625 | 286653 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_pinky2_zn` | 右小指２ | -Z | 341370 | 208424 | 286769 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_pinky2_zp` | 右小指２ | +Z | 341508 | 208355 | 286513 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |

## r_pinky3 (右小指３)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_r_pinky3_xn` | 右小指３ | -X | 341526 | 208399 | 286671 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_pinky3_xp` | 右小指３ | +X | 341493 | 208357 | 286590 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_pinky3_yn` | 右小指３ | -Y | 341557 | 208380 | 286615 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_pinky3_yp` | 右小指３ | +Y | 341496 | 208452 | 286659 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_pinky3_zn` | 右小指３ | -Z | 341433 | 208400 | 286677 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |
| `basic_r_pinky3_zp` | 右小指３ | +Z | 341493 | 208359 | 286591 | 228345 | 遮挡: left; 可见: front/right/back | 正确 |

## r_wrist_twist0 (右手捩)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_r_wrist_twist0_xn` | 右手捩 | -X | 344044 | 209643 | 286764 | 229538 | 全角度可见 | 正确 |
| `basic_r_wrist_twist0_xp` | 右手捩 | +X | 342355 | 209395 | 289048 | 228930 | 全角度可见 | 正确 |
| `basic_r_wrist_twist0_yn` | 右手捩 | -Y | 342172 | 210081 | 284248 | 228571 | 全角度可见 | 正确 |
| `basic_r_wrist_twist0_yp` | 右手捩 | +Y | 340239 | 210556 | 286332 | 230020 | 全角度可见 | 正确 |
| `basic_r_wrist_twist0_zn` | 右手捩 | -Z | 339907 | 206566 | 282982 | 228514 | 全角度可见 | 正确 |
| `basic_r_wrist_twist0_zp` | 右手捩 | +Z | 339904 | 210558 | 282726 | 228157 | 全角度可见 | 正确 |

## r_wrist_twist1 (右手捩1)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_r_wrist_twist1_xn` | 右手捩1 | -X | 341551 | 208699 | 286980 | 228246 | 全角度可见 | 正确 |
| `basic_r_wrist_twist1_xp` | 右手捩1 | +X | 341962 | 208464 | 286056 | 228537 | 全角度可见 | 正确 |
| `basic_r_wrist_twist1_yn` | 右手捩1 | -Y | 341970 | 208443 | 286050 | 228381 | 全角度可见 | 正确 |
| `basic_r_wrist_twist1_yp` | 右手捩1 | +Y | 340952 | 208570 | 286701 | 228326 | 全角度可见 | 正确 |
| `basic_r_wrist_twist1_zn` | 右手捩1 | -Z | 341581 | 208487 | 286422 | 228278 | 全角度可见 | 正确 |
| `basic_r_wrist_twist1_zp` | 右手捩1 | +Z | 340967 | 208439 | 286233 | 228304 | 全角度可见 | 正确 |

## r_wrist_twist2 (右手捩2)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_r_wrist_twist2_xn` | 右手捩2 | -X | 343296 | 209312 | 285814 | 227908 | 全角度可见 | 正确 |
| `basic_r_wrist_twist2_xp` | 右手捩2 | +X | 341417 | 209944 | 289096 | 228494 | 全角度可见 | 正确 |
| `basic_r_wrist_twist2_yn` | 右手捩2 | -Y | 341212 | 209779 | 286841 | 228499 | 全角度可见 | 正确 |
| `basic_r_wrist_twist2_yp` | 右手捩2 | +Y | 341600 | 209498 | 285674 | 228273 | 全角度可见 | 正确 |
| `basic_r_wrist_twist2_zn` | 右手捩2 | -Z | 341596 | 208171 | 286998 | 228441 | 全角度可见 | 正确 |
| `basic_r_wrist_twist2_zp` | 右手捩2 | +Z | 341015 | 210083 | 285772 | 227972 | 全角度可见 | 正确 |

## r_wrist_twist3 (右手捩3)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_r_wrist_twist3_xn` | 右手捩3 | -X | 342347 | 209202 | 287961 | 228332 | 全角度可见 | 正确 |
| `basic_r_wrist_twist3_xp` | 右手捩3 | +X | 343110 | 209703 | 288485 | 228863 | 全角度可见 | 正确 |
| `basic_r_wrist_twist3_yn` | 右手捩3 | -Y | 343568 | 209707 | 287924 | 228304 | 全角度可见 | 正确 |
| `basic_r_wrist_twist3_yp` | 右手捩3 | +Y | 341432 | 209396 | 288297 | 228352 | 全角度可见 | 正确 |
| `basic_r_wrist_twist3_zn` | 右手捩3 | -Z | 340784 | 208891 | 285717 | 228496 | 全角度可见 | 正确 |
| `basic_r_wrist_twist3_zp` | 右手捩3 | +Z | 342469 | 209623 | 288120 | 228364 | 全角度可见 | 正确 |

## r_fist (右手握拳)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_r_fist_xn90` | 右手握拳 | X=-90°(全手指) | 340981 | 208662 | 285712 | 228345 | 握拳可见变化 | 正确 |

## l_thumb0 (左親指０)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_l_thumb0_xn` | 左親指０ | -X | 341983 | 208359 | 286942 | 228098 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_thumb0_xp` | 左親指０ | +X | 341256 | 208359 | 286136 | 228128 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_thumb0_yn` | 左親指０ | -Y | 341572 | 208359 | 286744 | 227995 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_thumb0_yp` | 左親指０ | +Y | 341631 | 208359 | 286608 | 228412 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_thumb0_zn` | 左親指０ | -Z | 341755 | 208359 | 286845 | 228328 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_thumb0_zp` | 左親指０ | +Z | 341273 | 208359 | 286176 | 228186 | 遮挡: right; 可见: front/back/left | 正确 |

## l_thumb1 (左親指１)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_l_thumb1_xn` | 左親指１ | -X | 341634 | 208359 | 286777 | 228108 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_thumb1_xp` | 左親指１ | +X | 341488 | 208359 | 286378 | 228376 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_thumb1_yn` | 左親指１ | -Y | 341624 | 208359 | 286851 | 228088 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_thumb1_yp` | 左親指１ | +Y | 341580 | 208359 | 286637 | 228460 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_thumb1_zn` | 左親指１ | -Z | 341744 | 208359 | 286632 | 228288 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_thumb1_zp` | 左親指１ | +Z | 341386 | 208359 | 286357 | 228420 | 遮挡: right; 可见: front/back/left | 正确 |

## l_thumb2 (左親指２)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_l_thumb2_xn` | 左親指２ | -X | 341614 | 208359 | 286787 | 228227 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_thumb2_xp` | 左親指２ | +X | 341579 | 208359 | 286654 | 228401 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_thumb2_yn` | 左親指２ | -Y | 341611 | 208359 | 286815 | 228241 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_thumb2_yp` | 左親指２ | +Y | 341599 | 208359 | 286709 | 228413 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_thumb2_zn` | 左親指２ | -Z | 341653 | 208359 | 286620 | 228333 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_thumb2_zp` | 左親指２ | +Z | 341547 | 208359 | 286726 | 228354 | 遮挡: right; 可见: front/back/left | 正确 |

## l_index1 (左人指１)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_l_index1_xn` | 左人指１ | -X | 341544 | 208359 | 286815 | 228414 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_index1_xp` | 左人指１ | +X | 341547 | 208359 | 286621 | 228395 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_index1_yn` | 左人指１ | -Y | 341546 | 208359 | 286756 | 228419 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_index1_yp` | 左人指１ | +Y | 341545 | 208359 | 286857 | 228572 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_index1_zn` | 左人指１ | -Z | 341545 | 208359 | 287072 | 228256 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_index1_zp` | 左人指１ | +Z | 341544 | 208359 | 287291 | 228477 | 遮挡: right; 可见: front/back/left | 正确 |

## l_index2 (左人指２)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_l_index2_xn` | 左人指２ | -X | 341546 | 208359 | 286617 | 228386 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_index2_xp` | 左人指２ | +X | 341546 | 208359 | 286572 | 228395 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_index2_yn` | 左人指２ | -Y | 341546 | 208359 | 286647 | 228427 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_index2_yp` | 左人指２ | +Y | 341546 | 208359 | 286660 | 228557 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_index2_zn` | 左人指２ | -Z | 341546 | 208359 | 286919 | 228330 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_index2_zp` | 左人指２ | +Z | 341546 | 208359 | 287075 | 228447 | 遮挡: front,right; 可见: back/left | 正确 |

## l_index3 (左人指３)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_l_index3_xn` | 左人指３ | -X | 341546 | 208359 | 286605 | 228379 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_index3_xp` | 左人指３ | +X | 341546 | 208359 | 286598 | 228397 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_index3_yn` | 左人指３ | -Y | 341546 | 208359 | 286626 | 228411 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_index3_yp` | 左人指３ | +Y | 341546 | 208359 | 286653 | 228467 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_index3_zn` | 左人指３ | -Z | 341546 | 208359 | 286810 | 228332 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_index3_zp` | 左人指３ | +Z | 341546 | 208359 | 286775 | 228457 | 遮挡: front,right; 可见: back/left | 正确 |

## l_middle1 (左中指１)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_l_middle1_xn` | 左中指１ | -X | 341543 | 208359 | 287156 | 228460 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_middle1_xp` | 左中指１ | +X | 341542 | 208359 | 286738 | 228561 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_middle1_yn` | 左中指１ | -Y | 341543 | 208359 | 286492 | 228631 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_middle1_yp` | 左中指１ | +Y | 341543 | 208359 | 286725 | 228537 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_middle1_zn` | 左中指１ | -Z | 341543 | 208359 | 287156 | 228497 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_middle1_zp` | 左中指１ | +Z | 341545 | 208359 | 287574 | 228141 | 遮挡: right; 可见: front/back/left | 正确 |

## l_middle2 (左中指２)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_l_middle2_xn` | 左中指２ | -X | 341546 | 208359 | 286929 | 228457 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_middle2_xp` | 左中指２ | +X | 341546 | 208359 | 286630 | 228500 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_middle2_yn` | 左中指２ | -Y | 341546 | 208359 | 286600 | 228506 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_middle2_yp` | 左中指２ | +Y | 341546 | 208359 | 286645 | 228666 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_middle2_zn` | 左中指２ | -Z | 341546 | 208359 | 286980 | 228482 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_middle2_zp` | 左中指２ | +Z | 341546 | 208359 | 287370 | 228475 | 遮挡: front,right; 可见: back/left | 正确 |

## l_middle3 (左中指３)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_l_middle3_xn` | 左中指３ | -X | 341546 | 208359 | 286784 | 228361 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_middle3_xp` | 左中指３ | +X | 341546 | 208359 | 286702 | 228384 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_middle3_yn` | 左中指３ | -Y | 341546 | 208359 | 286624 | 228370 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_middle3_yp` | 左中指３ | +Y | 341546 | 208359 | 286614 | 228454 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_middle3_zn` | 左中指３ | -Z | 341546 | 208359 | 286850 | 228399 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_middle3_zp` | 左中指３ | +Z | 341546 | 208359 | 286949 | 228401 | 遮挡: front,right; 可见: back/left | 正确 |

## l_ring1 (左薬指１)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_l_ring1_xn` | 左薬指１ | -X | 341545 | 208359 | 287184 | 228560 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_ring1_xp` | 左薬指１ | +X | 341546 | 208359 | 286815 | 228549 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_ring1_yn` | 左薬指１ | -Y | 341545 | 208359 | 286688 | 229118 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_ring1_yp` | 左薬指１ | +Y | 341545 | 208359 | 286831 | 228502 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_ring1_zn` | 左薬指１ | -Z | 341546 | 208359 | 287311 | 228122 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_ring1_zp` | 左薬指１ | +Z | 341545 | 208359 | 287554 | 228430 | 遮挡: right; 可见: front/back/left | 正确 |

## l_ring2 (左薬指２)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_l_ring2_xn` | 左薬指２ | -X | 341546 | 208359 | 286993 | 228426 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_ring2_xp` | 左薬指２ | +X | 341546 | 208359 | 286695 | 228452 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_ring2_yn` | 左薬指２ | -Y | 341546 | 208359 | 286612 | 228607 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_ring2_yp` | 左薬指２ | +Y | 341546 | 208359 | 286675 | 228470 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_ring2_zn` | 左薬指２ | -Z | 341546 | 208359 | 286985 | 228187 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_ring2_zp` | 左薬指２ | +Z | 341546 | 208359 | 287285 | 228437 | 遮挡: front,right; 可见: back/left | 正确 |

## l_ring3 (左薬指３)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_l_ring3_xn` | 左薬指３ | -X | 341546 | 208359 | 286716 | 228369 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_ring3_xp` | 左薬指３ | +X | 341546 | 208359 | 286628 | 228368 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_ring3_yn` | 左薬指３ | -Y | 341546 | 208359 | 286671 | 228449 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_ring3_yp` | 左薬指３ | +Y | 341546 | 208359 | 286631 | 228397 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_ring3_zn` | 左薬指３ | -Z | 341546 | 208359 | 286747 | 228287 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_ring3_zp` | 左薬指３ | +Z | 341546 | 208359 | 286892 | 228440 | 遮挡: front,right; 可见: back/left | 正确 |

## l_pinky1 (左小指１)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_l_pinky1_xn` | 左小指１ | -X | 341545 | 208359 | 286736 | 228846 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_pinky1_xp` | 左小指１ | +X | 341546 | 208359 | 286543 | 228296 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_pinky1_yn` | 左小指１ | -Y | 341546 | 208359 | 286629 | 229021 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_pinky1_yp` | 左小指１ | +Y | 341546 | 208359 | 286784 | 228331 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_pinky1_zn` | 左小指１ | -Z | 341791 | 208359 | 286621 | 228268 | 遮挡: right; 可见: front/back/left | 正确 |
| `basic_l_pinky1_zp` | 左小指１ | +Z | 341548 | 208359 | 286970 | 228422 | 遮挡: right; 可见: front/back/left | 正确 |

## l_pinky2 (左小指２)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_l_pinky2_xn` | 左小指２ | -X | 341546 | 208359 | 286612 | 228495 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_pinky2_xp` | 左小指２ | +X | 341546 | 208359 | 286633 | 228323 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_pinky2_yn` | 左小指２ | -Y | 341546 | 208359 | 286549 | 228572 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_pinky2_yp` | 左小指２ | +Y | 341546 | 208359 | 286647 | 228327 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_pinky2_zn` | 左小指２ | -Z | 341546 | 208359 | 286635 | 228354 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_pinky2_zp` | 左小指２ | +Z | 341546 | 208359 | 286927 | 228377 | 遮挡: front,right; 可见: back/left | 正确 |

## l_pinky3 (左小指３)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_l_pinky3_xn` | 左小指３ | -X | 341546 | 208359 | 286687 | 228347 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_pinky3_xp` | 左小指３ | +X | 341546 | 208359 | 286573 | 228333 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_pinky3_yn` | 左小指３ | -Y | 341546 | 208359 | 286635 | 228413 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_pinky3_yp` | 左小指３ | +Y | 341546 | 208359 | 286627 | 228332 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_pinky3_zn` | 左小指３ | -Z | 341546 | 208359 | 286592 | 228341 | 遮挡: front,right; 可见: back/left | 正确 |
| `basic_l_pinky3_zp` | 左小指３ | +Z | 341546 | 208359 | 286663 | 228343 | 遮挡: front,right; 可见: back/left | 正确 |

## l_wrist_twist0 (左手捩)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_l_wrist_twist0_xn` | 左手捩 | -X | 345111 | 209874 | 287600 | 229714 | 全角度可见 | 正确 |
| `basic_l_wrist_twist0_xp` | 左手捩 | +X | 340218 | 209115 | 288439 | 229064 | 全角度可见 | 正确 |
| `basic_l_wrist_twist0_yn` | 左手捩 | -Y | 343005 | 210258 | 287148 | 230536 | 全角度可见 | 正确 |
| `basic_l_wrist_twist0_yp` | 左手捩 | +Y | 343721 | 208321 | 286044 | 230264 | 全角度可见 | 正确 |
| `basic_l_wrist_twist0_zn` | 左手捩 | -Z | 343767 | 208100 | 286108 | 231621 | 全角度可见 | 正确 |
| `basic_l_wrist_twist0_zp` | 左手捩 | +Z | 339854 | 208550 | 285515 | 225657 | 全角度可见 | 正确 |

## l_wrist_twist1 (左手捩1)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_l_wrist_twist1_xn` | 左手捩1 | -X | 341593 | 208275 | 287003 | 228701 | 全角度可见 | 正确 |
| `basic_l_wrist_twist1_xp` | 左手捩1 | +X | 342120 | 208559 | 286206 | 228311 | 全角度可见 | 正确 |
| `basic_l_wrist_twist1_yn` | 左手捩1 | -Y | 341148 | 208313 | 286784 | 228502 | 全角度可见 | 正确 |
| `basic_l_wrist_twist1_yp` | 左手捩1 | +Y | 341802 | 208402 | 286144 | 228564 | 全角度可见 | 正确 |
| `basic_l_wrist_twist1_zn` | 左手捩1 | -Z | 341163 | 208280 | 286285 | 228596 | 全角度可见 | 正确 |
| `basic_l_wrist_twist1_zp` | 左手捩1 | +Z | 341641 | 208396 | 286208 | 228443 | 全角度可见 | 正确 |

## l_wrist_twist2 (左手捩2)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_l_wrist_twist2_xn` | 左手捩2 | -X | 343818 | 208084 | 285575 | 229530 | 全角度可见 | 正确 |
| `basic_l_wrist_twist2_xp` | 左手捩2 | +X | 341224 | 208800 | 288719 | 230042 | 全角度可见 | 正确 |
| `basic_l_wrist_twist2_yn` | 左手捩2 | -Y | 341719 | 208169 | 285576 | 229962 | 全角度可见 | 正确 |
| `basic_l_wrist_twist2_yp` | 左手捩2 | +Y | 341076 | 208398 | 286676 | 229948 | 全角度可见 | 正确 |
| `basic_l_wrist_twist2_zn` | 左手捩2 | -Z | 341000 | 208139 | 285428 | 230798 | 全角度可见 | 正确 |
| `basic_l_wrist_twist2_zp` | 左手捩2 | +Z | 342227 | 208566 | 286576 | 228221 | 全角度可见 | 正确 |

## l_wrist_twist3 (左手捩3)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_l_wrist_twist3_xn` | 左手捩3 | -X | 342979 | 208266 | 287699 | 229923 | 全角度可见 | 正确 |
| `basic_l_wrist_twist3_xp` | 左手捩3 | +X | 342365 | 208785 | 287896 | 230034 | 全角度可见 | 正确 |
| `basic_l_wrist_twist3_yn` | 左手捩3 | -Y | 341884 | 208217 | 287717 | 229855 | 全角度可见 | 正确 |
| `basic_l_wrist_twist3_yp` | 左手捩3 | +Y | 342638 | 208261 | 286903 | 229953 | 全角度可见 | 正确 |
| `basic_l_wrist_twist3_zn` | 左手捩3 | -Z | 342780 | 208391 | 287488 | 230840 | 全角度可见 | 正确 |
| `basic_l_wrist_twist3_zp` | 左手捩3 | +Z | 341049 | 208539 | 285741 | 228780 | 全角度可见 | 正确 |

## l_fist (左手握拳)

| 文件夹 | 骨骼 | 输入旋转 | front | right | back | left | 效果 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `basic_l_fist_xn90` | 左手握拳 | X=-90°(全手指) | 341839 | 208359 | 286742 | 228697 | 握拳可见变化 | 正确 |
