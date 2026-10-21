# V14D 显示字节直通捕获（display-passthrough capture）

## 中文名称

V14D 显示字节直通捕获（显示字节闭环）

## 英文机器名

displayPassthrough（引擎视图变换字段，默认 false）；诊断管线「显示字节捕获/反投影」
（display-byte back-projection）；采集脚本 gate-g1-swatch-binding.mjs、
gate-g3-backproject.mjs、gate-g4-face-gate.mjs、decode-face-roi.mjs。

## 概念定义

显示字节直通捕获是一条默认关闭的诊断契约，目标是让 Web 端 Face 材质的最终显示
字节逼近磁盘权威 PNG 的原始 8-bit 显示字节，形成可验证的闭环。**「逐字节等于」
只在两个有界口径成立，不得泛化为任意内容逐字节等同**：

- G1 均匀 Face 色块闭环：注入纯色 [64,128,192] 后，腐蚀 Face mask 上显示字节逐
  通道 MAE ≤ 2/255（证明直通链路对均匀内容无损，无色空间/二次色调映射污染）。
- 端到端 Face Gate（G4）：fresh AgX PNG vs Web passthrough canvas，同一腐蚀 Face
  mask 上逐通道 MAE ≤ 20/255 且相对 base 下降 ≥ 50%（真实带空间渐变内容的有界
  逼近，含 GPU sampler/双线性/反投影覆盖残差，非逐字节 0 误差）。

1. 权威显示源：以 Blender 权威 blend 的 EEVEE frame120 AgX（Medium High Contrast、
   exposure -0.56）渲染 PNG 为显示权威，其原始 8-bit 字节（sharp/纯 JS 等明确字节域
   解码器，不用 image.pixels 猜颜色空间）是唯一反投影源。
2. 反投影（G3）：对屏幕上每个 Face 可见像素，用同帧同相机同栅格的插值 UV
   （uvDebug 模式 HDR readback）把该像素的显示字节按双线性 splatting 写回 Face
   atlas 的对应纹素；冲突纹素按权重均值聚合，未覆盖纹素用有界边界扩张填充。
3. 直通显示（G2）：引擎 composite pass 增加 displayPassthrough 模式，开启时绕过
   Filmic LUT + color grading + gamma 三层色调映射，并把纹理由硬件 sRGB→linear
   解码后的值重新做 linear→sRGB（OETF）编码，使最终 canvas 字节等于注入纹理的
   原始 sRGB 字节。
4. 真绑定（G1）：注入纹理经 materialDiffuseOverrides 在 GPU 材质建立前真实绑定到
   Face 材质，用已知纯色块证明均匀内容闭环无损（MAE ≤ 2/255）。

## 解决的问题

1. 旧路线把权威 AgX PNG 再过 Filmic（非法二次色调映射），或先用 image.pixels 读回
   再猜颜色空间，破坏了「显示字节 = 显示字节」的不变量。
2. 引擎默认 composite 是「HDR + bloom → Filmic LUT → grade → gamma」，无法原样显示
   已是显示域的字节；passthrough 提供受控绕过。
3. 纹理按 rgba8unorm-srgb 上传会被硬件解码为 linear；直通必须补一次 linear→sRGB
   编码，否则显示字节偏暗（实测 [64,128,192] 直出成 [13,55,134]）。

## 适用场景

- 固定黄金帧（frame120/State2/Blend0）下，验证「磁盘权威显示字节 → Face atlas →
  Web 显示」的闭环管线是否正确（G1 色块 MAE≤2/255、G4 对照 MAE≤20/255 且下降≥50%）。
- 需要把外部权威显示参考精确注入 Web Face 材质做 A/B 对照时。

## 不适用场景

- 默认生产渲染路径（默认 finalFaceComposite，displayPassthrough 默认 false，生产
  永远走 Filmic）。
- 动态五档/窄混合/迟滞/实时六灯；修改 PMX/VMD/骨骼/权重/Morph/IK/Grant/Physics/拓扑。
- 跨渲染器像素级几何对齐（本契约只闭「颜色/字节」，不闭「同一屏幕像素对应脸部同一
  物理点」的几何错位——Web 与 Blender 姿态存在已知差异）。

## 核心不变量

1. 反投影源是磁盘 PNG 原始解码字节，不经 image.pixels、不猜颜色空间、不再过 Filmic、
   不手调 RGB、不改写权威参考。
2. passthrough 真正绕过三层（Filmic/grade/gamma），且对纹理 sRGB 解码做对称
   linear→sRGB 编码；默认关闭，生产路径不变。
3. 真绑定证据来自引擎 v14dBakedActual（GPU 材质建立后的
   materialName|diffuseTextureIndex|logicalPath），不是自证名单。
4. 采样一律用腐蚀后的 Face material mask（pick pass 逐像素材质 ID），逐通道误差判定
   不允许用矩形 ROI 或边缘混合解释超标。
5. Face Gate 未通过前不捕获/扩展其他材质。

## 证据与计算口径

- G0：manifest 校验源 blend SHA（前后不变）、camera、AgX/Medium High Contrast、
  exposure -0.56、PNG IHDR、输出 SHA；双独立解码器 Face ROI 均值逐通道差 ≤0.5/255。
- G1：Face 注入 [64,128,192] 纯色块，腐蚀 mask 采样逐通道误差 ≤2/255，且
  v14dBakedActual 证明 Face idx 落在引擎追加纹理区间。
- G3：覆盖纹素数、冲突纹素数、覆盖率、边界扩张迭代数、未覆盖策略入 g3-stats.json。
- G4：fresh PNG vs Web passthrough canvas，同一腐蚀 Face mask 的每通道 MAE、P95、
  样本数、均值、相对 base face=[111.57,81.67,70.68] 的下降率；正式通过要求 MAE
  每通道 ≤20/255 且下降 ≥50%，exit code 与 pass 一致。

## 正例

- G1 色块闭环 MAE≤2（管线无损）；G4 下降率 ≥50% 时记录为「闭环管线建立、显示字节
  直通验证通过」。
- displayPassthrough 仅在 v14dFaceMode=bakedGolden 诊断下置 true。

## 反例

- 把 AgX PNG 再过 Filmic；用 image.pixels 读回后猜颜色空间；手调 RGB。
- passthrough 直出 linear 不做 sRGB 编码（显示偏暗，[64,128,192]→[13,55,134]）。
- 用矩形 ROI 或边缘混合为超标像素开脱。
- G4 MAE 未达 ≤20/255 时宣称「Face 明显对齐完成」。

## 失败后的修正路线

- G4 MAE 超标但下降率达标：**先做离线 atlas 重建 Gate 分离根因，禁止直接归因几何**。
  用 gate-offline-atlas-reconstruct.mjs 在 CPU 按引擎 sampler 语义（srgb 解码+mip0
  双线性+OETF，仅 originalCoverage 采样）重建 Web 采样并对照 fresh PNG：离线 MAE>20
  → 根因在反投影/冲突聚合/覆盖/dilation/过滤口径；离线 MAE≤20 但 Web>20 → 用
  gate-offline-web-vs-predict.mjs 对照「Web 实际显示 vs 离线同 UV 采样预测」，二者
  差异大说明 GPU 链与离线口径不符（GF4 首轮即据此定位根因为反投影 UV 的 v 翻转约定
  错误——引擎采样 v 不翻转 y=v，误用 y=(1-v) 会把 atlas 上下镜像；色块均匀故 G1
  假阳性通过，空间渐变才暴露）。只有几何平移/仿射/光流单变量实验能显著降低误差时，
  才允许把几何升级为已证明根因。
- passthrough 显示偏色：先跑 G1 色块定位是绑定、解码/编码还是色调映射层的问题；G1
  色块对 UV 翻转不敏感，空间变化纹理才会暴露采样约定错误，判定反投影几何时须用
  空间渐变而非纯色块。

## 与现有概念的关系

- 建立在 bakedGolden（黄金帧最终着色烘焙）的逐材质独立绑定不变量之上；本契约复用
  其 materialDiffuseOverrides 真绑定机制，但把「显示权威」从 Cycles COMBINED 烘焙换成
  「磁盘 AgX PNG 原始显示字节反投影」，并用 passthrough 替代「unlit 忠实显示线性纹理」。
