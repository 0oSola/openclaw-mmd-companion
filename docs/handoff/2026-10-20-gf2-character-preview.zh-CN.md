# Codex 会话交接：克莱妲兵营原环境与同帧渲染对照

## 1. 本轮结果

已取得原游戏第7480帧的真实相机、角色灯光、环境球谐系数、反射探针、纹理、着色字节码和绘制状态，并接入本项目的独立MMD预览。

- 动态MMD：http://127.0.0.1:18748/
- 原机位、原姿态对照：http://127.0.0.1:18748/frame.html
- 实际PMX同姿态对照：http://127.0.0.1:18748/pmx-comparison.html
- 可复用资产：output/gf2-barrack-materials/，环境摘要为其中的 barrack-environment.json。
- 完整来源：.scratch/gf2-render-research-20261020/game-match/captures/barrack_frame7480.rdc。

在原生2552×1326画幅下，全画面红绿蓝三通道（RGB）平均绝对误差为0.123150/255，99%的通道误差不超过2/255。人物矩形(980,70,580,1200)平均误差为0.192909/255，99%的通道误差不超过3/255；该矩形包含背景，不是人物遮罩。

以上为SwiftShader软件后端。实际内置浏览器的16纹理限制已修复；本机Direct3D11显卡输出的全画面平均误差为0.067715/255，人物矩形0.124743/255，两项99%通道误差均不超过2/255。两种后端的指标分别保留，不视为PMX动态画面的误差。

动态PMX已补齐刘海模板标记、脸部受影重绘、眼部叠加及刘海透视，并修正披风的材质分区与前后表面。首页提供「原帧姿态」和「PMX同姿态对照」。实际PMX在3470×1803、相同原机位/姿态、黑色背景及同一颜色映射下，408412个非黑前景并集像素的平均通道误差为6.853/255；该数值来自实际PMX，不沿用固定游戏网格的低误差。

## 2. 原问题与影响

早期预览只读取原材质资源并手工移植部分公式，使用估算的33°相机和自配灯光。头发、衣料与金属差异不能靠曝光拟合解决；原图与VMD姿态不同，也不能用整图误差判断材质。

用户选定克莱妲原皮兵营展示页。原进程拒绝关闭后，用户手动关闭游戏；RenderDoc启动的新进程成功进入场景并抓帧。保存后关闭该游戏进程，离线读取捕获数据。

首页早期动态实现只接主材质和描边，缺少脸部/刘海的相互遮挡步骤；PMX的两个披风分区还把原游戏不透明衣料与透明布料合并。VMD起点睁眼，抓帧闭眼，不能直接用两张不同姿态的图片评价材质。

## 3. 根因

游戏实际使用40°相机、主光、顶部聚光灯、七个打包球谐向量及ReflectionProbe-6。它们的实际绑定不在单份材质里。原程序还依赖附加UV、顶点颜色、深度/模板及多个输出目标各自的混合状态。

移植中确认并修复了Y方向引起的绕序变化、常量缓冲实例名附加后缀漏绑、多目标独立混合遗漏。最后一项会污染抗锯齿后的泛光控制量，使窗外过曝。

对照显示还需区分第四颜色通道Alpha与网页透明度。原目标约142万像素的Alpha不是255，网页直接透明合成会改变观感。显示副本仅移除Alpha，RGB逐字节不变，原四通道RGBA文件保留。首次与重复绘制的PNG本来就一致，之前对首次绘制的怀疑已由实际数据排除。

用户内置浏览器另复现后期程序链接失败：片元纹理上限16，而转换后的后期有19个采样器声明。原测试使用上限32的SwiftShader，遗漏了这一环境差异。相同资源即使在链接后绑定同一单元，重复声明仍计入链接限制；[Khronos规范](https://www.opengl.org/registry/doc/glspec45.core.pdf)说明了该计数口径。

动态面部还依赖源事件顺序和模板比较，不能让Three按透明/不透明材质重新排序。原帧对应的UV有重复；只按UV与当前姿态选点会把衣扣连接到错误顶点。新绘制副本也必须在衣发补偿转换为相对形态后创建，否则同一形态数据会被解释为绝对位置并产生异常变形。

## 4. 解决方式

RenderDoc 1.46取得真实帧；原DXBC字节码经vkd3d与SPIRV-Cross转换为GLSL。frame-renderer.js重新计算43次角色绘制及后续环境、时域抗锯齿、泛光和颜色映射，保留原纹理格式、全部反射层级、常量和独立混合。场景前置颜色、深度、环境遮蔽与上一帧历史明确来自捕获。

最终后期及仅颜色映射程序在编译前合并同一资源、同一采样状态的声明，本帧19个声明降为8个。不同过滤、寻址或资源继续分开，源纹理、原程序运算及光照参数保持。仅改变重复声明的真实浏览器实验由失败转为链接成功。

gf2CapturedMaterials.js把原程序接到现有MMD蒙皮和形态通道，使用原压缩/半精度纹理和保留位模式的常量输入。主光4096²、聚光512²投影按原程序随VMD重绘。描边顶点颜色按半精度UV就近舍入对应；面部对象方向由1511组顶点校准并随头骨更新，拟合中位几何误差0.144毫米，眼睑等姿态差异保留在残差中。颜色在线性半精度目标完成混合，再经过原32级颜色查找表。

绘制副本共享PMX骨骼和实际形态权重，按源事件排序；2600、2685、2710分别执行刘海标记、脸部受影和刘海透视。RGB单独写入的阶段保留原Alpha。披风中的2512个不透明三角形转用2469及其描边，5316个透明三角形各执行3356/3368前后表面；两类阴影按相同分区生成。消音器接入2419，材质绑定增为26/27。

主绘制及两张阴影共用一份分组几何，避免每个副本分别上传90个形态纹理层。实际首页几何缓存从114降至7、纹理对象从617降至510，近景及播放操作恢复正常；这不是长期帧率测试。

prepare-pmx-reference.mjs按材质、静止位置、法线与UV建立59727个顶点的原帧对应，625个表情辅助层顶点不参与此姿态。8份静止源Mesh的顶点顺序通过本次捕获UV逐项核对；重新读取源包后，静止位置与UV又与既有Mesh数据逐项相同。面部没有同类静止数据时按UV与当前姿态位置对应。该数据在顶点阶段提供单帧位置/法线等输入，保留PMX拓扑，未写入或生成VMD；动画播放恢复原蒙皮。加载期复用原资源字节，每个可变常量实例另取副本。

## 5. 修改前后行为

默认预览从手工公式与自配环境切换为原捕获程序和兵营环境。可恢复实际机位、自由观察、调曝光、切换PMX基础材质及播放既有动作；默认模式固定原光源方向。原PMX、VMD和既有衣发补偿未改写。

legacy=1保留早期模式；legacy=1&capture=1恢复旧拟合机位。comparison.html标记为早期存档并链接新对照。正式3100网页、8100后端及桌宠入口没有切换。

首页点击「原帧姿态」可旋转检查闭眼及原身体姿态；点击「返回现有动作」、播放或跳帧恢复VMD。原帧校准时基础材质对比按钮禁用，避免把另一姿态误作同模型材质比较。pmx-comparison.html展示同尺度的脸部/衣料或全身原件裁剪和实际测量，来自首页同一渲染模块。

从项目根目录启动：

    & 'C:/Users/KSG/AppData/Local/Programs/Python/Python312/python.exe' -B scripts/gf2/serve-preview.py --assets output/gf2-barrack-materials --port 18748

服务使用HTTP/1.1复用连接，读取导出目录。原抓帧资产通过同卷硬链接保存，新增PMX对应与对照为独立文件；删除研究目录中的对应链接不会删除导出数据。运行仍使用项目Three依赖、D:/mmd/克莱妲原皮和既有动作目录。

## 6. 验证结果

证据根目录为 .scratch/gf2-render-research-20261020/game-match/。

| 证据 | 实际覆盖 |
| --- | --- |
| frame-final-check/result.json | 原程序及后期重绘；衣料主光输入改变最终输出，恢复后PNG逐字节一致 |
| frame-final-check/measurement/metrics.json | 不缩放、不调色的原生RGB度量及相同矩形裁剪 |
| frame-display-final/result.json | 导出目录入口；首次/重复输出一致；人物/场景切换、25%叠图、430像素窄屏及清单缺失恢复 |
| reference-display-conversion.json | 显示副本仅移除Alpha，RGB完全相同 |
| mmd-capture-03/result.json | VMD第150.5帧使两张投影图改变3451/7449像素，返回0帧后恢复一致 |
| mmd-capture-04/result.json | 头部方向校准后的四视角、子帧和材质切换，机位与时间保持 |
| mmd-recovery-final/result.json | 校准资源404可见报错，恢复后真实入口重新加载成功 |
| texture-limit-repair/compile-probe.json | 原内置浏览器16纹理上限；仅合并重复声明后19降8，原失败与成功结果 |
| texture-limit-repair/in-app-state.json | 实际用户页面43次绘制及后期完成，错误为空 |
| texture-limit-repair/measurement/metrics.json | 当前内置浏览器原生输出与游戏原帧的RGB度量 |
| texture-limit-hardware/result.json | RTX 5060／Direct3D11实际16纹理环境；正常、输入变更及恢复、页面切换、窄屏、清单缺失恢复 |
| texture-limit-software/result.json | SwiftShader32纹理环境通过，最终PNG与修复前逐字节相同 |
| dynamic-face/shared-final/result.json | 共享几何最终版本：动态网格、投影变化/恢复、绘制顺序、面部开关像素作用、原帧姿态及VMD恢复、对照页交互均通过 |
| dynamic-face/final-page-behavior/result.json | 补齐UTF-8打包后的对照文字、图像解码、近景/全身切换与430像素布局通过 |
| dynamic-face/browser-final/ | 实际内置浏览器的近景、全身、窄屏截图及首页验收 |
| dynamic-face/final-recovery/result.json | 原帧姿态清单404提示及恢复后真实入口重试通过 |
| dynamic-face/shared-comparison/result.json | 最终实际PMX与原角色同条件前景度量；双方绘制无错误 |
| dynamic-face/shared-comparison/previous-output-difference.json | 共享几何前后只有3个像素各1个通道差1/255，未声明逐字节相同 |
| dynamic-face/static-bind/normals-report.json | 重新读取源Mesh的位置/UV身份核对及静止法线输入 |

主会话已查看原图、重绘、差异图、并排/叠图/窄屏，以及动态MMD四视角和脸部。检查使用Playwright 1.58.2配套Chromium145.0.7632.6及SwiftShader；没有硬件帧率结论。

兼容性返修同时在原内置浏览器和配套无界面浏览器的Direct3D11后端验收，两个硬件入口原生PNG逐字节一致。原浏览器完成三种阶段切换，最终恢复完整场景对照；正式18748服务保留。未运行锁屏或认证事件专项验证。

动态追加的失败原件均保留：check-01为形态解释错误，check-02和comparison-normals为资源连接失败；前者修正初始化顺序，后者改为连接复用后新的完整度量及资源恢复均成功，但未据此宣称所有连接故障根因已证。check-03的原帧映射有衣扣尖刺，使用静止位置/法线消歧后消失。comparison-01的参考画面被检查脚本误翻Y，纠正后才度量；像素偏移实验的最优位置是0偏移。捕获阴影替换使误差增大，未接入产品。final-check的静态对照页因打包默认GBK读取UTF-8失败而404，明确UTF-8并补齐文件后复验通过。静态对照页的无界面截图接口三次拒绝捕获，已停止该截图重试；相同页面的视觉验收由实际内置浏览器完成，命令入口只保留其文字、图像与交互验证。实际首页的输入迟滞由重复形态纹理上传定位，改共享几何后现场按钮与播放/暂停通过。

复跑时使用新的输出目录：

    node web/scripts/check-gf2-frame.mjs output/gf2-frame-check --pipeline --mutate --check-page --recover
    node web/scripts/check-gf2-frame.mjs output/gf2-frame-hardware-check --hardware --pipeline --mutate --check-page --recover
    node web/scripts/check-gf2-preview.mjs output/gf2-mmd-check http://127.0.0.1:18748/ --captured
    node web/scripts/check-gf2-preview.mjs output/gf2-face-check http://127.0.0.1:18748/ --captured --hardware --face-reference
    node web/scripts/check-gf2-preview.mjs output/gf2-reference-recovery http://127.0.0.1:18748/ --hardware --reference-recovery
    node web/scripts/compare-gf2-pmx-reference.mjs output/gf2-pmx-comparison
    node web/scripts/check-gf2-preview.mjs output/gf2-recovery-check http://127.0.0.1:18748/ --capture-recovery
    & 'C:/Users/KSG/AppData/Local/Programs/Python/Python312/python.exe' scripts/gf2/measure-frame.py --reference output/gf2-barrack-materials/frame/reference-post.png --render output/gf2-frame-check/pipeline-final.png --output output/gf2-frame-check/measurement

最终摘要为 .scratch/gf2-render-research-20261020/captured-render-files.json。分支codex/local-interactive-integration，HEAD仍为dbbeb67722891a29d0cab7cdae920a474373bbe2，未提交。原失败、早期交付和拟合记录保留在实施记录及既有证据目录。

16纹理兼容修复的增量摘要为同目录texture-limit-files.json；原摘要保留为前版记录。

动态面部/原帧姿态的最终增量摘要为同目录dynamic-face-files.json。

## 7. 范围边界与遗留风险

固定帧验证与动态MMD验收分开：低误差证明这一帧的着色及后期移植，不证明任意姿态、场景或相机都逐像素一致。固定帧使用捕获几何和前置场景数据；动态预览使用现有PMX与“专属查看”VMD，姿态、眼睛、衣发和独立主武器与捕获不同。

动态MMD已使用实际环境、原材质程序和脸部/刘海多遍绘制，未把固定历史和环境遮蔽套到变化后的角色上。完整游戏场景后期与独立主武器仍不包含在此动态角色交付中。26/27材质槽接入原程序，表情辅助层保留基础材质。原帧姿态是当前PMX顶点对应的单帧校准，不是原游戏整段动画转换，也不证明任意VMD姿态逐像素相同。

PMX前景误差6.853/255与固定游戏网格全画面0.067715/255使用不同对象、背景、后期和像素集合，不能相互替代或计算提升比例。原帧姿态的前景集合为两幅图任一RGB通道达到5的像素并集，避免大块黑背景稀释误差；参考图不平移、不缩放、不调色。仍有头发细线、高光及边缘差异，当前结果不声明逐像素等价。

交付运行于本项目Three.js/WebGL2，不是传统MME的.fx文件。换游戏版本、角色、PMX顶点顺序或后端时，重新提取绑定并验证。

## 8. 可复用知识候选

原游戏捕获着色数据的绑定与验证约定：保留格式、位模式、坐标和绘制状态，先用同机位/姿态隔离验证，再接动态骨架；两类结论分别报告。定义见 workflow/concepts/gf2-captured-rendering.zh-CN.md。单次参数和当前误差不能推广成所有角色的通用阈值。
