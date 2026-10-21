# V14D 脸部 State 2 实时合成（固定帧）

- 中文名称：V14D 脸部 State 2 实时合成（固定帧）
- 英文机器名：`v14d-face-state2-live-composite`（契约 / contract id）
- 票据：Stage 2B-M1（`codex/v14d-face-state2-runtime`）
- 状态：**已实跑、Gate 未达标阻塞**（实时合成链已接线并通过配准 / 双纹理绑定 Gate，但完整 Face Gate MAE 未达 ≤20/255，详见交付报告）

## 概念定义

把旧 finalFaceComposite 的“整张预烘焙脸图替换”升级为真正的 Web 实时合成：对 PMX 材质名 `Face` 的每个像素，
从原始 Face BaseColor（`c_Koleda_slg_face_d.png`）+ Blender State2 packed mask + Blender 节点常量，
在 Web 线性空间执行与权威 Blender 节点等价的 warm / art / fringe 合成。State 固定为 2、Blend 固定为 0；
不实现五档动态、Narrow Blend 或 Hysteresis。

## 解决的问题

旧路线用屏幕像素→UV 反投影 atlas 或 bakedGolden 最终着色烘焙冒充生产方案，把灯光、阴影、AgX 固化进 BaseColor。
本概念改为运行时从两张原始纹理实时计算公式，保证「只有 Face 材质变化、其余材质走正常 reze-k3 路径」的严格 A/B。

## 权威来源（全部来自 `.blend` 取证，不手调 RGB）

- 权威 Blender：`Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend`（sha256 `1139617c…53cd4`，Blender 5.1.1 / AgX）。
- Face 材质：`PROTO_V14D_GF2_Face`。
- BaseColor：`c_Koleda_slg_face_d.png`，sRGB，1024×1024，源 sha256 `1e963c09…fd44e`。
- State2 mask：`PROTO_V14D_FaceShadow_State2`（节点 `PROTO_V14D_MaskState2`），Non-Color，1024×1024 packed，sha256 `42d2f95a…a103`。
- 通道含义：R=art 阴影权重，G=fringe 权重，B=narrow face-valid/protect（用于 `(1-B)` 门控），alpha=faceValid（State=2/Blend=0 恒为 1）。

## 线性合成公式（State=2 / Blend=0 恒等取 LayerA=State2）

```
warm         = faceD_linear * warmColor            // warmColor    = [1, 0.935, 0.890]
art          = mix(white, artShadowTint, R*(1-B))  // artShadowTint= [0.660, 0.580, 0.600]
fringe       = mix(white, fringeTint,   G*(1-B))  // fringeTint   = [0.700, 0.640, 0.690]
shadowFactor = art * fringe
composite    = warm * shadowFactor
```

空间约定：线性空间执行；face_d 需 sRGB→linear 解码，mask 为 Non-Color 不解码。State=2/Blend=0 时 faceValid=1、
FinalMixAlphaFaceValid 为恒等，occlusion 链对本票退化为 shadowFactor。

## 适用与不适用

- 适用：`/mmd-calibration-render` 固定 frame120 的 State2 实时合成预览、三诊断视图（BaseColor / ShadowFactor / FinalComposite）。
- 不适用：五档状态选择、动态头部/灯光角度、Narrow Blend、Hysteresis、RMO/Normal、Toon、Hair Spec、六灯、AgX 等价实现（全部范围外）。

## 核心不变量

- 只对 PMX 材质名 `Face` 生效；EyeWhite/Eyes/Eyes+/Hair/Body/Clothes 保持正常 reze-k3 路径。
- 不在 loadModel 后伪改 path；GPU 双纹理绑定必须在材质建立前闭合并有真实绑定证据（liveBound/liveMaskPath）。
- 诊断开关默认关闭；默认生产 Filmic/reze-k3 不得泄漏新纹理或旁路。

## 证据与计算口径

- 取证 manifest：`.scratch/v14d-face-state2-runtime/forensic-manifest.json`（脚本 `web/scripts/forensic-v14d-face-state2.py`）。
- Blender 参考：`blender-ref-state2-final-composite.png` / `blender-ref-state2-shadow-factor.png`（`web/scripts/blender-ref-v14d-face-state2.py`）。
- Gate：`web/scripts/gate-v14d-face-state2-live.mjs` → `.scratch/v14d-face-state2-runtime/gate/gate-report.json`。

## 正例 / 反例

- 正例：faceShadowOnly/finalFaceComposite 从 face_d + mask 实时计算，配准 ok、双纹理绑定 liveBound=true、pageErrors=0。
- 反例（禁止）：整模型 alpha 包含率自证配准；用 bakedGolden 烘焙图冒充实时生产方案；凭肉眼手调 RGB。

## 相关 contract / gate

- reze-engine 补丁 `web/scripts/patch-reze-engine.mjs`：materialAuxTextures + binding(5) mask + `V14D_STATE2_HELPERS_WGSL` + `v14dState2OverrideFsBodyFixed`（`--verify` 56 项不变量恰好一次）。
- 完整 Face Gate 阈值：full Face 覆盖率 ≥95%，每通道 MAE ≤20/255，不放宽。

## 失败后的修正路线

（2026-09-01 修正轮）已定位并修复三个断点：断点 A（旧 override 分号在注释后的切片标记与真实编译器行格式不匹配，原样返回）、断点 B（applyStyleGroups 重绑丢失 binding(5) aux mask）、断点 C（assembleModule 把 state2 helper 插在 prelude 的 fn fs 开头之后，WGSL 函数嵌套导致 Face graph 应用失败静默回退到原管线）。修复后实时管线结构生效已证实（faceApplied=true、三模式 HDR 互异、用户路径 USER-PATH-OK）。完整 Face Gate MAE 仍未达标；剩余根因候选：face_d/mask 的 UV 采样坐标与 Blender 参考像素坐标的配准（翻转/偏移）、mask 采样同源、或 mask 通道在 Blender 侧的 faceValid 调制口径。下一张票据优先用 exportFaceUvPng 做 UV-direct 逐纹素对账。见 `docs/handoff/2026-08-31-v14d-face-state2-runtime.md` 修正轮。

## 与现有概念的关系

- 取代旧的「整张预烘焙脸图替换」finalFaceComposite 路线；bakedGolden 黄金帧烘焙明确标记为失败实验/内部诊断，默认不选中。
- 与 `v14d-display-byte-passthrough-capture`、`v14d-golden-frame-final-shading-bake` 同属 V14D 黄金帧对齐系列，本概念为其中的实时合成切片。
