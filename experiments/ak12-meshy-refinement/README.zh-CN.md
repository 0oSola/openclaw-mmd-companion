# 静寂苍蓝：Meshy 主体与克莱妲脸部、前发迁移版

## 当前交付

请打开 `AK12_Meshy_Refined.blend`。

这是本轮可继续编辑的静态迁移版，不是整个人物已经完成的精修成品，也不是可直接发布的 PMX。

已经完成：

- 从用户 GLB 中分离最左侧正面人物。该 GLB 原本同时包含三个完整人物视图和右侧局部细节生成物。
- 保留该人物的主体、礼服、后部盘发和长发。
- 迁移克莱妲的脸、眼睛、眉毛、睫毛、牙齿、舌头、表情叠层、刘海与前侧发束。
- 增加前顶发及颈部子集，调整头部比例、倾斜、前发位置、肤色与银发材质。
- 归档被替换的旧脸和旧刘海；新增领圈与独立静态颈部过渡面。
- 输出正面、左侧、右侧、背面、斜前方和脸部六张渲染，以及眨眼、张口测试图。

## 文件与检查

| 文件或目录 | 用途 |
| --- | --- |
| `AK12_Meshy_Refined.blend` | 本轮交付模型；有效贴图和参考图已打包 |
| `Meshy_ImportedReference.blend` | 完整 GLB 的原始导入对照 |
| `Subject_ExtractedReference.blend` | 人物主体分离后的对照 |
| `AK12_Meshy_KoledaFace_Working.blend` | 中间试配存档，不应代替交付文件 |
| `refined_views` | 六视角交付预览 |
| `validation_views` | 眨眼、张口检查图 |
| `face_migration_report.json` | 迁移对象、骨骼、适配参数与来源哈希 |
| `refinement_verification.json` | 复开后的数值验证结果和边界 |

Blender 文件中的集合：

- `01_MeshyBodyAndBackHair`：保留的身体、礼服和后发，仍是一体式生成网格。
- `02_TransferredFace`：脸部、前发、颈部组件、局部骨架及过渡面。
- `00_OriginalFace_Hidden`：被替换的旧脸和旧前发归档，默认隐藏。
- `Inspection_Studio`：展示相机、灯光和地面。

原参考图位于图片数据块 `Reference_AK12_DesignSheet`。来源说明与制作说明位于 Blender 文本数据块。

## 实际验证结果

复开 `AK12_Meshy_Refined.blend` 后运行 `verify_refinement.py`，技术检查通过。

- 14 个迁移组件全部通过来源数据对照；各自的原有 63 个形态键（含 Basis 基础形态）无缺失。
- 基础顶点坐标误差为 0，原形态键坐标误差为 0，权重不一致顶点数为 0，UV 一致。
- 新增适配键独立保留。`Fit_Meshy_Forehead` 是停用的试配键；前发与前顶发使用各自的适配键。
- 迁移骨架有 74 根实际需要的骨骼及父级，迁移组件没有引用缺失骨骼。
- 主体保留区与归档区完整覆盖分离前的 456,536 个面；主体 UV 保留。
- 无非有限坐标，无缺失外部图片。
- 眨眼测试影响 220 个脸部顶点，局部最大位移约 0.01237；张口测试影响 546 个脸部顶点，局部最大位移约 0.00414。两种状态均实际渲染检查。
- 原始 GLB 和克莱妲拆件文件的 SHA-256 哈希未变化。

## 尚未完成的部分

- 身体、Meshy 后发、礼服没有绑定。保留头部表情不能外推为全身可动。
- 颈部使用独立静态过渡面，尚未焊接成连续拓扑。转头、侧倾等动作需要重新处理接缝与权重。
- 原生成模型的手指、后发、衣褶及局部贴图仍有生成式几何的粗糙细节。
- 胸前部分旧长发与衣服融合，未按颜色强行剥离，以免破坏身体与礼服；本轮优先替换刘海和前侧发束。
- 前后发材质与密度存在差异，颈侧和肩部仍需近景精修。
- 没有逐一视觉验收全部表情，没有运行转头、发丝物理、完整 VMD、动作门禁或 PMX 导出。

因此，本轮的“技术验证通过”只覆盖报告中列出的迁移与资源检查，不代表全角色视觉验收或动态验收通过。

## 来源

- 用户 GLB：`C:\Users\KSG\Downloads\meshy_1788865300370.glb`。
- 组件来源：项目内 `koleda-local-parts-study/KoledaSummer_Parts.blend`。
- 克莱妲原说明署名：Sunborn Network Technology；绑定与修正：DesmondChan。
- 原始 Readme 已保留。本次按用户要求进行本地学习研究，不发布或分发，也未将非商用目的表述成作者新增授权。

## 重现命令

在项目根目录运行，所有命令使用独立 Blender 后台进程：

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background 'experiments\ak12-meshy-refinement\Subject_ExtractedReference.blend' --python-exit-code 1 --python 'experiments\ak12-meshy-refinement\refine_subject.py' -- --output AK12_Meshy_Refined.blend --views Front,Left,Right,Back,Hero,Face --samples 64

& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background 'experiments\ak12-meshy-refinement\AK12_Meshy_Refined.blend' --python-exit-code 1 --python 'experiments\ak12-meshy-refinement\verify_refinement.py'
```

不要在尚未保存的其他交互工程中直接执行这些脚本。
