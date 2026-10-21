# AK12 Meshy 精修 v2

交付文件：[AK12_Meshy_Refined_v2.blend](D:/workspace/MMD%20project/experiments/ak12-meshy-refinement/AK12_Meshy_Refined_v2.blend)

本版基于已验证的 `AK12_Meshy_Refined.blend` 继续处理：

- 归档 3 个肩颈区域的独立旧发残片，共 645 个三角面；原几何保存在隐藏集合 `00_NeckRemnants_Hidden`。
- 撤回上一轮耳后局部过度拉伸的 415 个顶点。
- 添加 8 组有体积的耳后过渡发束，固定到头部骨骼；没有新增物理系统。
- 保留脸部、前发、表情、礼服和后部盘发；没有修改源 GLB 或克莱妲拆件文件。

验证：

- Blender 5.2.1 复开成功。
- 44 个网格、1 个骨架。
- 496,842 个网格面，顶点坐标均为有限值。
- 归档集合和耳后过渡发束集合均存在。

当前仍不是最终可动 PMX：身体、礼服和 Meshy 后发没有完成统一绑定，颈部仍是静态过渡结构；尚未运行完整 VMD、物理和 PMX 导出验收。

近景预览位于 `v2_views/`，原始 v1 保留在 `AK12_Meshy_Refined.blend`。
