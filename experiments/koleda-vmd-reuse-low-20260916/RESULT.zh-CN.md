# Koleda 头发／披风 Blender→VMD 试播交付

## 结论与等级

**发布级目标未完成。** 已生成包含头发、披风与原身体动作的新 VMD，完成指定源 Blender 缓存全帧复核、独立 VMD 导入、实际变形网格对照、真实项目播放器试播、四视角截图／GIF 与门禁执行。它是本地试播稿，不是无损转换或无穿插成品；不得替换默认动作。

- 用户指定配置：`seasunCodex/gpt-6-astra`，思考等级 `low`，未自行切换。
- 任务：`01a0a9bd-bd44-7b42-a0d8-294360360c8e`，主机 `local`。来源：`01a0a3fe-bde5-7ba2-aed0-bb0bfeab2bc7`。
- 项目：`local-140a2801b88e7626327b2eb4694a8b91`；来源已确认 `project_binding_verified=true`。
- 工作目录：`E:/codexWorktree/a6ef/MMD project`；分支：`codex/koleda-vmd-reuse-low-20260916`；基线：`e64733c3117882722b0e178c4ceda799401c05cf`。
- 预算：放行后预期60分钟、硬限90分钟。本票没有超过20分钟的单命令，没有派生任务、push、修改主工作区或更换 PMX。

## 产物

本报告所在目录为下列路径的基准。第三方衍生二进制与逐顶点大数据保留本地，不提交 Git、不公开部署。

- `Koleda_Entrance_HairCape_Trial.vmd`：5,312,948字节；SHA256 `eabd2ea6e2388914204a5881da53f259989c6d4db32586555f0d2c5e463e258e`。
- `Koleda_HairCape_Baked.blend`：新烘焙工程；`Koleda_Independent_Import.blend`：清空动作后独立回读工程。
- `front.gif`、`left.gif`、`right.gif`、`back.gif`：每个20帧、200毫秒／帧的降采样试播动图；不是逐帧无穿插证明。
- `runtime-final-anchor-noik-nogrant-snap/`：最终四视角全身截图，每方向20个序列帧及第83帧截图；同时有10个对应时刻的网页网格。更早的 `runtime-*` 目录为失败或单变量诊断，不能当最终截图。
- `delivery-metrics.json`：各区域、各时刻的四层误差；`input-manifest.json`：主要只读输入哈希。

## 分层验证结果

| 层次 | 实际结果 | 证据 |
|---|---|---|
| 指定交付 Blender→缓存输入 | 236帧头发、披风最大差均0；两个相对PC2存在；源文件哈希未变 | `source-cache-report.json` |
| 源缓存→旧拟合 | RMS 2.992mm；最大72.019mm | `baseline-audit.json` |
| 源缓存→新拟合 | 源骨映射初值＋80轮拟合；RMS 2.679mm、P95 3.215mm、最大71.992mm | `fit-report.json` |
| 新拟合→Blender实际网格 | 最大0.006742mm；非调整身体骨矩阵最大分量差0.00001830 | `fit-report.json` |
| 导出前实际网格→独立VMD导入 | 119帧全网格最大0.007745mm；局部位置最大差0.0000004842米；四元数点积误差0.0000001788 | `independent-import-report.json` |
| 独立导入→网页 | 10个对应时刻、60,352顶点，最大约0.547mm；静态顶点顺序映射最大差0.000001133个网页模型单位 | `delivery-metrics.json`、最终运行时报告 |
| 非头发披风区域、拓扑、UV、材质 | 原模型与独立回读签名一致；119帧区域外最大差0.002670mm | `preservation-report.json` |

VMD共有401根实际导出骨、47,719条骨关键帧；按名称包含Hair/Cape/Cloth统计有171根动态骨。早期独立导入报告的101根使用“名称前缀”统计，漏掉中文左右前缀披风骨，以 `delivery-metrics.json` 的171为准。实际导出名称最长14个Shift-JIS字节，无15字节截断；4个超长名字是未导出的Blender内部dummy/shadow骨，不是VMD丢骨。

## 最大残差与方案取舍

旧稿最差是第83帧（源第166帧）披风 `PROTO_GF2_Cth1-Cape2` 顶点47006与47511：`Chest_L`占89.57%，两个可调整披风骨合计约10.43%。旧拟合只调整Hair/Cape/Cloth骨，冻结了主要权重骨。

按顶点权重推导源骨对应、直接应用源动画的对照结果：固定身体最大82.362mm；仅数学实验放开Chest_L/R后最大60.418mm。该实验未导出，不是授权改变身体；Chest_L在披风之外仍有显著权重，源/目标映射也不是一一等价。因此只证实“固定身体与权重关系贡献了残差”，没有证明“VMD不可能无损”。

保留原PMX和身体的80轮拟合改善整体误差但最差点仍约72mm。本票不再靠增加轮数冒充解决，也未新增骨、重绑或复活旧四片布料路线。下一步需要来源决定是否授权独立的蒙皮／骨架对应研究或接受此误差等级；若允许重绑／新PMX，应另定范围与全链路验收。

## 真实运行时问题与最小修改

真实项目在独立端口3217运行，使用既有 `/mmd-calibration-render`、`MMDCompanionRuntime`、真实PMX／纹理／VMD。未使用只解析文件的替身。

1. 原 `seekVmdFrame` 设置混合器时间后调用帮助器，帮助器恢复旧骨缓存，导致“时间正确、姿态不动”。真实混合器红灯：请求帧45（1.5秒），骨位置仍0.25。
2. 最小代码改动为：先 `_restoreBones` 恢复原始缓存，再设置时间，再 `_saveBones` 同步新缓存，再零步更新。仅保存不恢复会重复累加Grant，第二个回归测试抓住了该问题。
3. 最终试播仅在自身浏览器实例关闭根骨固定、IK、Grant。该VMD已烘焙完整骨骼，再执行求解会二次改变腿部；不改变生产默认策略。Ammo未加载、`hasPhysicsSupport=false`，没有运行物理。开启Ammo环境尚未验证。
4. 原时间换算在Float32关键帧边界可能采到前一帧；试播使用 `Math.fround(frame/30)*30` 定位到实际轨道时间。末帧独立导入→网页最大差从约5.37mm降至约0.00106mm。没有扩大修改第三方插值器；子帧／60fps平滑等价未验证。
5. 最终真实播放计时由0.0759秒推进到0.3760秒；暂停稳定；251根头发／披风骨在播放期间变化，260根相关骨在定位对照中变化。第二次独立试播同样成功，并导出119帧关节。

完整日志在 `runtime-final-anchor-noik-nogrant-snap-report.json` 与 `runtime-final2-anchor-noik-nogrant-snap-report.json`。页面异常0、网络传输失败0，但有1个HTTP404／控制台错误（PMX球面贴图目录 `spa/`）以及156条材质属性兼容警告。没有伪造补图。classic渲染截图不是Blender游戏最终材质等价证明。

## 时间、碰撞与门禁边界

- 原动画235/60＝3.916667秒；VMD最后帧118／30＝3.933333秒，多1/60秒，末点取源第235帧。这是明确保留的末帧时间量化差，不隐藏。网页帮助器原有1.1秒余辉使clipDuration为5.033333秒；不等于新增了游戏动作。
- 全119帧实际三角内部交叉：源头发119帧、75,770对；VMD头发119帧、75,694对。包含发根嵌入，不等同视觉穿透面积。
- 源披风119帧、17,623对；VMD披风113帧、17,882对。交叉涉及上衣、皮肤、脸、手套／袖口；没有因为局部帧数减少而称碰撞改善。
- 披风重复静态顶点接缝最大分离：源0.4788mm，新VMD3.9522mm；头发约0.000383mm。见 `contact-report.json`。未测自交、共面切触及完整穿透深度。
- 门禁按真实舞台关节逆模型变换回模型坐标，再转换到门禁固定渲染约定，执行 `--source render --left-arm-policy skip`。不能把当前舞台缩放／位移直接冒充门禁固定坐标。
- 门禁实际退出码1，整体FAIL：4通过、2警告、12失败。G2/G3/G5有实际违规；G6/G9警告。G4/G8/G11–G18含托下巴／固定站姿语义，本进场动作不具备这些语义，不得声称通过。G7为明确跳过、G10因没有FK参照跳过，也不算已验证通过。没有放宽或改门禁。
- 四视角全身截图已人工视觉复核：头发、披风、身体、袖口均存在，材质纹理载入；仍可见披风／袖口附近复杂交叠。程序碰撞结果优先，不能用缩小截图掩盖发根交叉。

## 实际命令与复现

以下命令从工作目录执行。`B`为 `C:/Program Files/Blender Foundation/Blender 5.2/blender.exe`，`P`为 `C:/Users/KSG/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe`；Python需 `PYTHONUTF8=1`。脚本前缀均为 `experiments/koleda-vmd-reuse-low-20260916/`。

| 命令 | 结果 |
|---|---|
| `B -b --python <前缀>/audit.py` | 复现旧72mm残差；诊断判据false |
| `B -b --python <前缀>/direct_audit.py` | 源骨映射及单变量数学对照完成 |
| `B -b --python <前缀>/fit_export.py` | 新拟合／新VMD导出完成 |
| `B -b --python <前缀>/verify_import.py` | 独立回读断言通过 |
| `B -b --python <前缀>/source_cache_verify.py` | 指定源交付236帧缓存复核通过 |
| `B -b --python <前缀>/contact_audit.py` | 119帧检查完成，collision_passed=false |
| `B -b --python <前缀>/preservation_audit.py` | 拓扑／UV／材质／身体保留通过 |
| `npm ci --ignore-scripts --no-audit --no-fund`（web目录） | 本地安装45包；锁文件未改 |
| `node scripts/patch-reze-engine.mjs`（web目录） | 原有依赖补丁93项检查通过 |
| `NEXT_DIST_DIR=.next-codex-test node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3217`（web目录） | 独立真实服务启动；不是生产部署 |
| `KOLEDA_PROBE_MODE=final-anchor-noik-nogrant-snap node <前缀>/runtime-probe.mjs` | 四视角真实试播与10帧网格完成 |
| `KOLEDA_PROBE_MODE=final2-anchor-noik-nogrant-snap KOLEDA_QUICK=1 KOLEDA_RENDER_GATE=1 node <前缀>/runtime-probe.mjs` | 第二次真实试播与119帧关节完成 |
| `P <前缀>/run_gate.py` | 内部正式门禁退出1；原输出完整保留 |
| `P <前缀>/package_evidence.py` | 四个GIF及分层指标完成 |
| `node <前缀>/run-tests.mjs` | 聚焦回归2/2通过；旧集基线／修改后同为73通过17失败 |

`test-results.json`记录子进程真实退出码，避免Windows命令包装把失败显示为退出0。旧集17失败的名称与原文均保留于 `baseline-suite.txt`、`fixed-suite.txt`，未宣称全部测试通过。首次试播脚本的正则转义错误、目录读取EISDIR，以及Python默认GBK读UTF8错误均已修正；没有把这些工具问题归因于项目动画。

## 修改范围、恢复条件与主验收

持久代码仅修改 `web/src/features/stage/mmdCompanionRuntime.js` 的定位缓存顺序，更新拓扑文档，新增本目录脚本和文本证据。Next自动改动的 `web/next-env.d.ts` 将恢复。主工作区只读；不修改资产、权重、默认动作、全局设置。

来源需检查本票提交及实际证据，决定是否接收“本地试播稿＋定位修复”。发布、无损与无穿插均未完成。后续若要继续消除72mm残差，应先确认是否允许修改源到目标蒙皮关系／身体辅助骨／新PMX；不得仅把本票试播参数设成生产默认。用户实际使用的v14d-game材质通道、开启Ammo、完整子帧播放和全量项目验收均未运行。

本票交接后停止写入，关闭本票独立服务和测试浏览器，保留工作树及所有本地产物供来源验收。
