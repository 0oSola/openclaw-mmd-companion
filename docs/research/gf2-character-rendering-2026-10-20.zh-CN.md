# 少女前线2角色渲染提取与MMD适配研究

## 结论

2026-10-20 对 `F:/GF2Exilium/GF2 Game` 的实际资源读取确认：角色着色器、材质参数及贴图引用可以从本机游戏资源中解析。已读取六种角色着色器和三个关联资源片段中的21个材质对象；这些对象包含皮肤及低细节版本，不表示当前角色同时绘制21个材质。

项目使用 Three.js 播放 PMX/VMD。可行候选路线是提取原始材质及贴图，根据实际使用的着色器分支移植光照计算，再与游戏画面比较。现有武器材质已经提供部分原游戏公式的接入样例；人物仍有基于 Blender 参考及截图美术调整的实现。角色完整移植与视觉一致性尚未验证。

## 本机证据

结构化原始参数：`.scratch/gf2-render-research-20261020/evidence.json`。
只读提取入口：`.scratch/gf2-render-research-20261020/read_render_evidence.py`。

资源根目录为游戏目录下的 `GF2_Exilium_Data/LocalCache/Data/AssetBundles_Windows`。

| 对象 | 文件 | 片段偏移 |
| --- | --- | ---: |
| 六种角色着色器 | `76c182bd6e11756c0057f24eae69e958.bundle` | 0 |
| 克莱妲服装材质 | `f0b673e5d0620e282384123cf988ca6b.bundle` | 7553966 |
| 克莱妲脸部、头发、眼睛材质 | `3f2ccb4c3134891e273b83ca9bf486e5.bundle` | 9147824 |
| 身体皮肤材质 | `73a0d2dbc7eb21f64440fdd499af1af1.bundle` | 5603959 |

着色器资源序列化版本是 `2019.4.29f1`；这只描述该资源，不据此认定整个当前客户端的引擎版本。当前着色器源包 SHA256 为 `98a68ad7772012d1a3119b6d9508470e4a8b73db11f987af69d6340247de3cc1`；解析后片段 SHA256 为 `ed79ef3cb13181303aaf376ac7adedbe44aac934970c7887eb03763168caeb80`，与之前武器研究的提取原件逐字节一致。

角色层级位于 `252a07acdadccb57ea81726ec2b13493.bundle`。旧记录偏移6958923已不适用；本次从头解析包内233个片段，在7327414处找回原角色片段，片段SHA256仍为 `4a182ff02a8166d39d35715f9bcfa0e54e8427454fda5e3a05a2817d6d5a0dc5`。外层文件当前SHA256为 `31e56a5af495f8bf7ee58e9456784e4083e4980d38308a08b38abd616ad0bda4`。本次未修改旧动作提取配方。

## 已读取的渲染结构

六种着色器均处于 `gf_shader/pbr/character/` 路径：

| 名称 | 作用及实际证据 |
| --- | --- |
| `uber` | 通用角色材质；包含主绘制、描边、头发阴影、脸部阴影及头发透明相关通道 |
| `ubertrans` | 透明材质；包含前后表面绘制、透明描边及阴影通道 |
| `eye` | 眼睛本体；属性包含角膜视差、高光视差、阴影强度 |
| `eyeblend_add` | 眼部加亮叠加材质 |
| `eyeblend_multiply` | 眼部乘色叠加材质 |
| `shadowcaster` | 阴影和角色遮挡相关通道 |

通用材质的 `GFCharForward`（角色主绘制通道）有2808个片元程序变体。另有 `GFOutline`（描边）、`GFHairShadow`（头发阴影）、`GFCharFaceShadow`（脸部阴影）和 `GFCharHairTransE`（头发透明相关通道）。这些名称和变体数量证明资源存在；实际绘制顺序、启用条件、采样方程还须结合对应程序与运行画面核对。

克莱妲关联材质的实际序列化配置：

- 五组服装使用 `_BaseMap`（底色）、`_BumpMap`（法线）、`_RMOTex`（粗糙度/金属度/遮蔽数据）、`_RampMap`（明暗响应渐变）。`_RAMPMAP` 关键字存在，`_UseRampMap=1`；另有服装透明版本。
- 头发和刘海材质启用 `_ANISOTROPIC_SPECULAR`（方向相关高光）、`_BLEND_UV2`（第二套纹理坐标相关分支）、`_RAMPMAP` 与 `_SHADOW_ADDITIONAL_BIAS`（附加阴影偏移分支）。相应的混合纹理引用也存在。
- `c_Koleda_slg_faceuber`（脸部材质）包含 `_GI_FLATTEN`（间接光平坦化分支）、`_RAMPMAP_INDI`（独立渐变相关分支）、`_USE_BLEND_TEX`（混合纹理分支）。这些关键字的精确公式尚未从当前脸部分支反汇编核实，不能直接称为SDF脸部阴影。
- 眼睛对象分别引用 `eye`、`eyeblend_add`、`eyeblend_multiply`。属性存在不代表每项效果都在最终画面生效。
- 身体皮肤材质启用 `_GI_FLATTEN` 与 `_RAMPMAP`，并引用底色、法线、表面参数及渐变图。

角色层级的实际材质引用已用于定位资源：脸部五个材质和头发两个材质均指向 `CAB-dd022ccbe6bde20d9ea922ea178d40d9`，身体两个材质指向 `CAB-e02a0b5ae76165bfed774eff1e008974`。同包中其他皮肤版本须按对象引用选择，不能仅凭名称全部装入。

## 当前项目可以复用的部分

- `web/src/features/stage/koledaWeaponMaterials.js`：已有原游戏部分直接光和环境反射渐变计算、原始半精度渐变图读取和Three材质接入；场景反射环境与显示变换仍为网页适配。
- `.scratch/koleda-weapon-skins-20261019/disassemble-weapon.py`：从Unity程序数据提取DirectX字节码并调用 `D3DDisassemble`（反汇编接口）。
- `.scratch/koleda-weapon-skins-20261019/source/weapon-fragment.asm`：原武器基础分支的反汇编原件；不能替代头发和脸部分支。
- `web/src/features/stage/mmdCompanionRuntime.js`：共享PMX加载、骨骼、VMD和交互生命周期，可在呈现层增加独立模式。
- `web/src/features/stage/v14dGameMaterials.js` 与 `v14dGameSource/gameReferenceLook.mjs`：当前人物实现包含物理材质、Blender参考以及截图美术调整；不能把其“游戏版”名称视为原游戏着色器已经移植。

## 建议执行顺序

1. 以项目已有克莱妲原皮为样例，按角色网格的实际材质引用提取对应贴图原始数据、采样设置、参数和关键字。核对游戏网格与PMX的材质分区、纹理坐标、第二套纹理坐标、法线和切线；发现缺项后再决定补充哪项数据。
2. 从武器已有解析路径取得这些材质真正使用的程序分支。先移植皮肤和服装的基础光照及渐变，再移植头发方向高光、脸部与头发阴影、眼部各层和透明绘制。编译字节码可供还原计算过程，但没有直接可放进Three.js的完整原工程源码。
3. 将结果接入独立角色材质模式，沿用共享PMX/VMD生命周期。先完成一个角色的外观和动作兼容，再评估其他角色；其他角色仍须提供对应分区和贴图。
4. 取原游戏同一展示场景，对齐模型、姿态、相机、主光方向和曝光。比较脸部明暗边界、头发高光位置、眼部层次、服装反射和描边。程序记录材质绑定及绘制结果，模型实际查看正、侧、背面和转头画面；通过数值或编译检查不等于视觉一致。
5. 基础材质对上后再补对应场景的灯光、反射环境、阴影与色彩处理。只有原游戏与网页真实画面对照通过，才可判断还原程度。

第一项可使用交付建议是：克莱妲原皮的独立渲染预览，可旋转镜头、播放现有VMD并对比当前模式。完整游戏场景的效果一致性需在此基础上验收。

## 复跑与结果边界

在项目根目录执行；输出文件必须使用新的名称：

```powershell
uv run --offline --no-project --python 3.12 --with UnityPy==1.25.3 python -B .scratch/gf2-render-research-20261020/read_render_evidence.py --source "F:/GF2Exilium/GF2 Game/GF2_Exilium_Data/LocalCache/Data/AssetBundles_Windows" --out ".scratch/gf2-render-research-20261020/evidence-rerun.json"
```

本次退出码0，六种着色器、21个材质对象读取成功，待找的头部及身体材质资源均定位成功。脚本面向本次已定位资源，游戏更新后若文件和片段变化，应重新定位；它不是通用资源导出器。

探索中实际出现两项失败：旧角色配方因源包摘要改变拒绝读取，随后重新定位找回相同角色片段；研究脚本最初命名 `inspect.py` 与Python标准库重名，改为 `read_render_evidence.py` 后运行成功。辅助只读研究代理因所配置模型不可用而未启动，本次结论均由主会话直接核验。

尚未导出全部角色贴图像素、逐分支还原头发/脸部/眼睛程序、接入新角色渲染模式或进行游戏画面的实时视觉对照。本次证明资源读取和定位路线可用，不表示完整角色还原已完成。

## 一手工具资料

- [UnityPy源码与说明](https://github.com/K0lb3/UnityPy)：Unity资源解析、对象类型树和纹理访问能力；本次实际使用1.25.3版本和项目已有读取代码。
- [GF2AssetBundleDecryption作者仓库](https://github.com/nijinekoyo/GF2AssetBundleDecryption)：公开的游戏资源包处理工具；本次复用项目已有解析实现，未运行该工具。

以上资料说明工具能力，游戏着色器与材质结论来自本机原始资源。
