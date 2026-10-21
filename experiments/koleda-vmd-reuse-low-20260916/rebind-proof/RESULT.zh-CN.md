# 披风源权重重绑：局部修复验证

日期：2026-09-16。用户已授权在独立副本修改局部权重、必要时新增辅助骨；原PMX不得覆盖。沿用用户指定模型seasunCodex/gpt-6-astra、low。

## 结果

本轮单一验证任务完成：**重建披风源骨骼驱动关系后，119帧最大源缓存误差从71.991845mm降到0.001198mm**。独立Blender进程倒序重开119帧，重开前后网格差0。不是完整PMX/VMD或发布交付。

模型副本：`Cape_Source_Rebind.blend`。新建52根RC000等短名披风专用骨，只替换披风材质6483个顶点的变形骨权重；头发与身体继续使用上轮烘焙动作。新骨沿上半身2锚定，变形矩阵由原动画节点世界矩阵和静止绑定矩阵计算，不使用PC2修改器伪装骨骼运动。原PMX与输入烘焙工程SHA256前后相同，记录在build-report.json。

| 项目 | 旧拟合 | 本轮副本 |
|---|---|---|
| 披风最大源缓存误差 | 71.991845mm | 0.001198mm |
| 披风接缝最大分离 | 3.952176mm | 0.478832mm（接近源缓存0.478823mm） |
| 披风外区域相对上轮烘焙最大变化 | — | 0.007775mm |
| 独立倒序回读差 | — | 0mm |
| 披风真实交叉 | 113/119帧 | 119/119帧，17625对 |

结论边界：72mm属于当前目标骨骼/权重表达与冻结约束问题，不能归因于VMD量化。52根独立骨是这次证明用的隔离构造，尚未证明为最少骨骼方案，也没有把这些骨导出为新PMX。该结果证明当前真实样例的Blender骨骼副本能复现目标源缓存，不代表原游戏所有运行时效果或目标UV近似已无误差。

## 四权重兼容性对照

源转移权重最多6个有效影响，377点超过4个。本轮另做每点保留最大4权重并归一化的数学对照，119帧最大误差0.170587mm；未改已通过副本、未执行PMX导出器，不把该值当PMX独立回读实测。后续可以在新的导出候选中验证该裁剪，不能静默丢权重。

## 实际命令

工作目录E:/codexWorktree/a6ef/MMD project，Blender程序C:/Program Files/Blender Foundation/Blender 5.2/blender.exe。依次执行：

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' -b --python-exit-code 1 --python experiments/koleda-vmd-reuse-low-20260916/rebind-proof/build.py
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' -b --python-exit-code 1 --python experiments/koleda-vmd-reuse-low-20260916/rebind-proof/verify.py
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' -b --python-exit-code 1 --python experiments/koleda-vmd-reuse-low-20260916/rebind-proof/weight_limit.py
```

三条命令实际退出0。验证脚本明确data_passed=true、collision_passed=false。build.py拒绝覆盖已有副本。

## 未完成与下一验收边界

完整修复未完成：原缓存的真实穿插被保留，不能以转换误差消失宣称无穿插。未修头发、未运行本副本的新PMX/VMD导出与独立回读、未做网页试播或新四视角截图、未运行正式动作门禁。旧门禁失败仍然有效。

下一步优先把此骨骼副本生成独立的新PMX＋VMD组合，验证权重裁剪、源身体保留、骨名、绑定矩阵、独立导入、网页实际播放和四视角；通过后才考虑在另存动作中修正源穿插。不能把新VMD套给未新增这些骨的原PMX，也不能用旧截图证明本副本视觉通过。
