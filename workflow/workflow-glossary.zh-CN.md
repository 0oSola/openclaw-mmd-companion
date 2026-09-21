# 工作流术语表

## 播放器全局骨骼模式

- playerVmdMode（播放器全局骨骼模式）：baked为烘焙、standard为普通MMD，缺省烘焙；两种模式均解除根位置和下半身固定，仅普通模式启用IK/付与。
- 模式按用户保存在本浏览器，不按资源ID或URL分配；覆盖手动预览、收藏、聊天VMD及循环。旧逐资源记忆保留但不读取，不能再作为当前页面的求解依据。
- 仅约束共享MMD播放器；不改变Ammo物理，不承诺Reze独立引擎兼容。完整契约见concepts/player-vmd-mode.zh-CN.md。

## 收藏即待机

- 收藏即待机：当前用户在当前模型自己 `<模型目录名>[动作]` 目录下的非空VMD均进入随机池，不按目录分类、腿部幅度或进场名称排除；无有效收藏时才回退内置待机。归属规则见模型归属收藏动作。
- vmdBakedBoneAnimationByUrl / bakedBoneAnimationByUrl（逐动作烘焙求解表）：舞台交互字段和运行时选项按动作URL存布尔值，循环换片时重新取值，禁止沿用上一片的求解模式。
- 动作求解记忆：浏览器按用户和资源ID保存烘焙标记；只保存布尔设置，不存令牌。该设置不跨浏览器或桌宠同步，不证明模型兼容。契约见concepts/favorite-idle.zh-CN.md。

## 已烘焙骨骼预览

- bakedBoneAnimation（已烘焙骨骼动画）：调用方显式声明当前VMD已包含求解后的骨骼姿态；本播放器据此跳过IK和付与。定义见 concepts/baked-bone-preview.zh-CN.md。
- 允许用法：已验证的配套PMX/VMD手动试播。禁止仅凭文件名、轨道数量自动推断，或把关闭求解当作修复源穿插。
- 路由影响：初始化及循环传递同一标记；切回普通动作恢复求解，不混合两种模式。

## 手动预览根位置固定

- lockRootPosition（根位置固定开关）：VMD 播放选项，缺省保持现有根位置固定；显式 false 时不把全亲、中心和槽骨的位置恢复到初始位置。
- 允许用法：手动预览传 false，并关闭 lockLowerBody（下半身固定）；预览结束后的普通播放重新采用缺省策略。
- 禁止用法：将此开关理解为关闭 IK、付与或物理求解，或宣称已解决所有腿部偏差。
- 路由影响：页面、舞台初始化、后续播放和同段循环均保留显式 false；自动待机策略不变。骨架或播放器更换时重新验证。

## 原动画抽取与复用

- game-motion-extraction（原动画抽取与复用Skill）：定位本地源片段、审计身体/衣服/头发/表情通道、验证原层级与目标适配，并指导Blender/VMD及项目试播。完整定义见concepts/source-motion-reuse.zh-CN.md。
- 允许用法：分别报告解码、映射、缓存、VMD结构、独立导入与运行时验证状态；参数化工具与只读历史案例分开。
- 禁止用法：把源衣发曲线叫作已还原游戏物理解算器，把PC2缓存叫作VMD，或从局部成功外推无穿插成品。
- 路由影响：先清点原衣发曲线和目标对应，再决定是否进入新增物理分支；新游戏/新源哈希重新验证适配器。

## VMD候选交付门禁

- `vmd_delivery_gate`（VMD候选交付门禁）：在复制候选 VMD 前检查直骨回放、VMD独立读写和目标网格适配三份阶段证据的机器清单。
- 允许用法：将唯一 VMD、配套PMX、源输入与每阶段证据 JSON 的路径+SHA256绑定到单一候选；每项必需指标绑定到证据字段，时间含正帧率/首尾帧/采样，骨映射无缺失或冲突，目标阶段包含全帧、子帧及区域覆盖；先 dry-run，全部通过后才复制到不存在的交付路径。
- 禁止用法：将结构检查、读写低误差、文件存在、字符串区域或旧实验数字当作目标网格适配通过；将数值读写阈值外推成跨模型适配阈值；复制与清单资产不同哈希的 VMD；替代正式动作语义Gate。
- 路由影响：Blender→VMD候选在正式交付前必须先运行该门禁；任一阶段缺失、非有限、负阈值、未运行、证据指标不一致、覆盖不全或超差时返回拟合、时间映射、骨映射或目标蒙皮适配排查。

## 桌宠共享舞台接入字段

- assetApiBaseUrl（舞台运行时资源 API 地址）：MMDStage 的可选地址输入，由桌宠主进程运行信息提供；覆盖该舞台的相对资源 URL 解析。未提供时网页仍使用构建配置。禁止把测试端口写死为生产默认地址。适用边界和验证见 docs/architecture/current-system-topology.md 的桌宠本机接入章节。
- appearanceControlsPortal（外观控件跨容器显示）：桌宠把共享微调面板放到窗口拖动接收层上方；不是第二套渲染器，也不改变材质值。
- data-pet-interactive（桌宠交互控件标记）：文档级拖动候选捕获遇到该标记时退出，让滑杆和按钮处理输入；不等同于关闭整个桌宠的拖动。

## V14D 本机资源版本缓存

- v（资源内容版本号）：/assets/v14d-game文件URL携带的SHA256；仅内容匹配时允许长期私有缓存。
- ETag（资源响应版本标识）：用于未带版本URL的重新验证和304响应，不代替客户端字节校验。
- 允许复用未变化的本机资源；禁止以缓存为由跳过身份校验或推断许可。定义和失败路线见concepts/v14d-resource-cache.zh-CN.md。

## Reze K3 皮肤变体

- `V14D_CAPTURE_API_ORIGIN`（验收后端来源）：仅配置验收脚本直接后端存根的精确HTTP(S)来源，默认8000，主页面与默认入口共用，不通配端口、不修改生产API。
- `--entry-only`（入口回放）：仅验证导入→画布就绪→六槽切换与绑定；105秒内未完成即失败并收尾，外层120秒硬限。不得冒充完整G1–G7或真实后端联调；定义与修正路线见 `concepts/v14d-brows-lashes-identity-tint.zh-CN.md` 的“验收后端来源配置与入口回放”。

主会话代码与运行证据验收通过（2026-09-05），六槽已合并。材质阶段验收6/15、已合并6/15（Face、BodySkin、HairA、HairB、Brows、Lashes），其余9槽尚未迁移。合并证据：主会话于2026-09-05在 `D:/workspace/MMD project` 的 `codex/local-interactive-integration` 实际快进合并至 `8267dfb5ae680db0ff5754ae537563422626163b`。2026-09-05执行任务已用原工作树Playwright依赖连接主服务3100，在显式配置验收后端来源8100的受控存根环境完成入口与完整G1–G7，原生退出码0、未超时（完整897.5秒，900秒硬限）。报告见 `web/.scratch/api-origin-20260905/full8100/gate-report.json` 与 `native-exit.json`；主服务提供实际页面和渲染代码，但API/会话为存根、模型为真实本地字节，不证明真实后端、真实登录会话或主目录全部依赖已验证。测试浏览器已关闭，主3100服务保留；这不是已为用户打开并保持的真实登录预览。

验证来源：主会话复跑59项聚焦测试（58通过、1允许跳过）、patch verify 93/93、固定点差异检查和禁止文件范围检查；交叉复核执行任务实际运行的健康、首次异常、中途异常及完整报告、full-native-exit.json、完整日志、构建日志和主舞台及开眼截图。完整 G1–G7 由执行任务运行，原生退出码0且未超时；两处异常原生退出码1且恢复成功。主会话本轮未重复运行完整验收。

范围边界：HairA/HairB仅基础色（BaseColor）迁移，高光及其他头发着色仍待决；浏览器验收使用API/会话/资源列表存根环境，真实本地模型与生产 /companion 渲染链已验证，不等于真实后端联调通过。用户可见V1说明已更新为六槽与剩余9槽，并明确头发仅基础色、高光待决；本次只更新显示文案，不改按钮标识、枚举、资格逻辑或渲染行为。

当前 G7 证据口径：`weightEvidence`=同态请求/运行时/有效/GPU缓冲读回证据；`noiseCalibration`=独立健康重复噪声标定；`sourceAudit`=本态生产源身份与有效读回审计。三者用于 Brows/Lashes 的正式移动判定，禁止以CPU值冒充GPU或让负测自校准。`restore.before/after` 必须证明原非默认相机被真正应用恢复。`--g7-evidence-only` 不替代完整验收，`V14D_G7_OUT` 隔离本轮产物。完整口径见 `concepts/v14d-brows-lashes-identity-tint.zh-CN.md` 当前阶段验收与集成状态；历史“闭合”仅为当轮自评。

- 英文机器名：`rezeK3SkinVariant`
- 含义：`/companion` reze-k3 舞台中克莱妲部分 PMX 材质槽的可选 V14D
  实时合成模式；`original`=原始 Reze K3，`v1`=Reze K3 V1（V14D）。
  持久化按 用户+模型+reze-k3 管线 三维隔离，默认 original。
  截至 Stage 2C-M2a 阶段验收（2026-09-05）：**Face、BodySkin、
  HairA、HairB、Brows、Lashes** 六槽通过材质阶段验收（6/15）；已合并6/15，Brows/Lashes已集成（合并证据见顶部）。
  Brows/Lashes 的正式验收口径（本票最终闭合）：① 逐槽原子同帧 material-ID +
  production-draw-call triUV + 同像素 identity-target 收敛；② Lashes 透明边缘
  屏幕空间形态学边界环 Gate（非空分母，黑框/白边/整槽消失三类自然检出）；③
  生产 GPU Morph 顶点位移 Gate（まばたき/笑い 各 Lashes 506/506 受影响顶点真实
  位移超 same-weight GPU 读回噪声，Brows 取证不受影响并保持稳定）；wrongTint 三次
  独立采集 provenance（captureId e4-4/e5-1/e6-1）经探针隔离 epoch 全局唯一；
  wrongAlpha 经专用 fault graph 自然非零拒绝；missingBrows/missingLashes 经
  composite OnComposite 信号自然非零拒绝。其余 9 个待迁移槽
  （Emotions、Eyes、EyeWhite、EyeShadow、Eyes+、UpperTeeth、LowerTeeth、
  Tongue、FingerNails）尚未迁移。单一当前权威以此节与 topology 的 Stage 2C-M2a 段为准。
  HairA/HairB 口径：hair_d（sRGB）× 银白紫乘色 [0.84,0.85,0.96]，经引擎
  独立 `V14D_HAIR_HELPER_WGSL` 常量 + `includeV14dHairHelper` 注入（不连带
  State2 mask/binding 5），graph.name "V14D Hair V1 Composite" 覆写。
- 允许用法：描述生产舞台两个用户可见效果及其切换、持久化与克莱妲资格门控。
- 禁止用法：不得把它等同诊断 `/mmd-calibration-render` 的 faceStatic
  固定帧预览；不得用 bakedGolden/AgX display-byte atlas 冒充 V1；不得让
  V1 泄漏到 reze-design 或其他管线/非克莱妲模型。
- 路由影响：仅影响 `/companion` + reze-k3 + 克莱妲 + localModelImport
  的 RezeWebGpuStage 皮肤变体分支；完整定义见
  `workflow/concepts/reze-k3-skin-variant.zh-CN.md`。

## V14D Face UV/可见性同口径对账

- 英文机器名：`v14d-face-uv-visibility`
- 含义：固定 frame120/State2/Blend0 下，Blender 与 Web 脸部渲染的「同 UV、同三角形、同可见性」三层离线对账；正式样本为 Web UV 前景 pass 与 HDR 材质 pick 双方都判 Face 且 UV 落在同一 Blender Face 三角形内的像素，参考色由同一 UV 直采 face_d 与 State2 mask 合成。
- 允许用法：描述 Stage 2B-M2 的三层（BaseColor/ShadowFactor/FinalComposite）对账口径与其 Gate。
- 禁止用法：不得把刘海/发绺等使用独立发色纹理的 Face 材质几何纳入 face_d 直采对账；不得手调 RGB 或放宽 MAE 宣称通过。
- 路由影响：对应 `web/scripts/gate-v14d-face-uv-visibility.mjs`；完整定义见 `workflow/concepts/v14d-face-uv-visibility-gate.zh-CN.md`。

# 项目级 Blender MCP 接入

- 英文机器名：`ProjectLocalBlenderMcp`
- 含义：仅由当前项目 `.codex/config.toml` 启用的 Blender 官方 Lab MCP 链路；Codex 通过项目专用 Python 运行时经 stdio 启动服务端，Blender 5.1.1 的官方 `mcp` 扩展通过本机 `127.0.0.1:9876` 提供桥接。
- 允许用法：PMX/VMD 导入、动作姿势检查、Blender 网格碰撞诊断和离线动作修正。
- 禁止用法：不得把它写入 Codex 用户级全局 MCP 配置；不得与旧的第三方 `blenderMCP-addon` 同时启用；不得把 MCP 工具调用当作 `motion_acceptance_gate.py` 或四视角截图/GIF 网格审核的替代。
- 路由影响：只有从 `D:\workspace\MMD project` 启动的 Codex 任务加载 `blender_lab`；Blender 未运行、官方扩展未启用或 `9876` 已被其他桥接占用时，工具链必须视为不可用并先修正连接状态。
- 完整定义：见 `workflow/concepts/project-local-blender-mcp.zh-CN.md`。

## Codex 启动目标

- 英文机器名：`CodexLaunchTarget`
- 设置字段：`codexLaunchTarget`
- 枚举值：
  - `vscode-cli`：通过 VSCode 内置终端启动 Codex CLI。
  - `codex-desktop`：通过 `codex://` 协议打开 Codex Desktop 新任务界面。
- 允许用法：描述 Desktop Pet 为 Codex 新建、恢复和活动会话聚焦选择的宿主工具。
- 禁止用法：不得把它等同于“编程助手”；`agent=codex|claude` 决定助手类型，`codexLaunchTarget` 只决定 Codex 的入口。
- 路由影响：仅影响当前 `agent=codex` 的 `new-session`、`restore-session` 和 `focus-active-session` 分支；Claude、Pet app-server 会话和显式“打开 VSCode 工作区”路径不受影响。
- 完整定义：见 `workflow/concepts/codex-launch-target.zh-CN.md`。
# Codex Desktop SSH 项目

- 英文机器名：`CodexDesktopProject`
- 含义：Codex Desktop 自己登记并通过 `remote-ssh-codex-managed:<name>` 管理的远程项目对象；远程 `path` 是远端 cwd，不得按本地目录处理。
- 允许用法：用于 `desktop-pet` 的项目发现、菜单选择和设置持久化。
- 禁止用法：不得把它等同于 VS Code Remote-SSH URI，也不得在未确认协议时伪造 Codex Desktop 私有 IPC。
- 路由影响：写入独立的 `selectedCodexDesktopProject`；远程新任务必须先显示 Pet 原生确认框，取消时不打开，确认后复制远程路径并打开 `codex://threads/new` 未绑定入口，再提示用户手工打开 Desktop 项目选择器并粘贴；无参数 `codex://new` 是空路由，外部快捷键模拟不可靠，两者都禁止作为降级入口。不能声称已把 `hostId` 或 `projectId` 传给 Desktop，也不能暗示 Desktop 会自动弹出项目选择器。
# 远程项目目录

- 英文机器名：`RemoteProjectCatalog`
- 含义：合并 Codex Desktop 正式项目、受限系统 SSH Git 扫描和最近成功缓存的远程项目选择目录。
- 允许用法：远程项目刷新、搜索、收藏、选择、状态展示和打开降级。
- 禁止用法：不得表示整机文件浏览；不得把猜测的 deeplink 当作正式项目打开链接。
- 路由影响：菜单只消费目录快照；日志解析、SSH 扫描、去重和缓存留在目录模块内部。
- 完整定义：见 `workflow/concepts/remote-project-catalog.zh-CN.md`。

# 受限远程 Codex 账号

- 英文机器名：`sola-codex` / `macCodex-pet`
- 含义：仅供 Desktop Pet 启动远端 Codex CLI 的 macOS 专用 SSH 账号和 Windows OpenSSH Host。该账号仅能读写 `/Users/sola/workspace/**` 与 `/Users/sola/Desktop/kscc/**`，拥有独立的 `~/.codex`。
- 允许用法：远程项目扫描与远端 Codex CLI 启动。
- 禁止用法：不得复用 `sola` 的 SSH Key、`~/.codex`、会话或账号权限；不得将任意 UI 输入直接作为 SSH Host、远端路径或 Shell 命令执行。
- 路由影响：远程项目选择保存 `sshHost=macCodex-pet`；`agent=codex` 且新建会话时，由 Windows Terminal 启动 `ssh -tt macCodex-pet`，在白名单项目目录执行受限账号自己的 Codex CLI。该路线不读取本机 `CODEX_HOME`，因此不启动本地会话 watcher。

# Reze Design 舞台配置

- 英文机器名：`reze-design`
- 含义：当前项目 `renderPipeline` 的独立枚举值；使用 MIT 许可的 `reze-engine` WebGPU 引擎加载 PMX/VMD，并采用用户指定的 Reze Design 灯光、泛光与相机构图，页面仍复用 MIO 星海背景。
- 允许用法：主站渲染模式选择、桌面 Pet 共享配置、校准页面 query 参数和 `RenderPipeline` 类型值。
- 禁止用法：不得把 WebGPU 兼容性失败静默伪装为 Three.js 成功渲染；不得把 reze-engine 的 IK/物理说成已复用 Three.js Grant solver、点击或口型链路；不得替代既有 `reze-npr` 配置。
- 路由影响：选择后由 `RezeWebGpuStage` 创建 `Engine`，真实执行 `init → loadModel → autoStyleGroups → runRenderLoop`；页面同时展示 MIO 星海背景。浏览器无 WebGPU 或 PMX 解析失败时在舞台内显示失败原因，用户可切换至 `reze-npr`（WebGL）恢复既有 Three.js 兼容路径。
- 调试影响：在主站的 `reze-design` 或 `reze-npr` 会话中，点击左侧主导航“工具 / 立方体”按钮打开“场景 / 材质”实时调试器。Dock 必须占满当前视口高度，长内容仅在编辑器主体内滚动。`reze-design` 的场景参数映射至引擎的 world、sun、bloom、ground 和 camera；`reze-npr` 映射至 Three.js 运行时的同类场景参数。材质预设分别写入当前运行时内存，且不写入 PMX、VMD、共享配置或动作资产。
- 透明合成影响：两种 Reze 舞台 canvas 均保持透明，由 MIO CSS 星海背景承接未绘制区域。`reze-npr` 不得启用会回填不透明黑底的 `UnrealBloomPass`；可保留 alpha 安全的调色和轮廓后处理。
- 本地导入影响：资产页可选择含单一 PMX 与完整贴图的本地目录；其 `File[]` 仅在当前浏览器会话内传给 reze-engine 文件映射加载器，刷新后失效，不上传服务器，不改变共享模型配置。
- 场景文档影响：按 `userId + renderPipeline + modelPath` 保存 Reze 场景 JSON，包含场景参数、调色、背景效果和可执行材质图预设；Reze Design 与 Reze NPR 的相机/灯光默认值不得跨管线复用。材质键采用 `mesh:<遍历序号>:material:<槽位>`，不得使用运行时 UUID。
- 资产与导出影响：编辑器资产页复用主站模型目录与 VMD 导入；渲染页当前导出 WebGPU canvas PNG，不包含 CSS 层的 MIO 星海背景。
- 完整定义：见 `workflow/concepts/reze-design-stage.zh-CN.md`。

# 运行中 Agent 会话

- 英文机器名：`ActiveAgentSession`
- 含义：机器或远程主机上已经启动、仍可通过事件、会话存储、进程或运行时接口观察到的编程助手会话。
- 允许用法：描述 Pet 自动发现、归属工作区、显示状态和同步摘要的对象。
- 禁止用法：不得把它等同于当前选中的工作区、单个 JSONL 文件或仅由 Pet 启动的会话。
- 路由影响：工作区由会话元数据反向生成；本地 Desktop、CLI、WSL、Claude 和远程会话可以同时存在并分别显示。
- 完整定义：见 `workflow/concepts/agent-session-discovery.zh-CN.md`。

# 会话发现

- 英文机器名：`AgentSessionDiscovery`
- 含义：从多个 Agent Provider 收集会话事实，按稳定会话身份去重，补充运行方式、工作区、主机、状态和最近活动，并向 Pet 提供统一活动视图的过程。
- 允许用法：描述全局扫描、进程增强、运行时状态合并和活动会话刷新。
- 禁止用法：不得表示只扫描当前工作区；不得把进程存在单独当成会话已绑定；不得把远程 POSIX 路径当作本地路径。
- 路由影响：调用方只消费统一快照；Codex/Claude 文件扫描、进程枚举、app-server 和 SSH 细节隐藏在 Provider 内部。
- 完整定义：见 `workflow/concepts/agent-session-discovery.zh-CN.md`。
# 优菈通用收藏动作（已废弃）

- 英文机器名：`EulaUniversalFavoriteMotions`
- 状态：已废弃，不得再作为收藏归属或待机回退依据。
- 废弃原因：该规则把优菈收藏目录当作所有 PMX 共享的动作库，导致任意模型的收藏都写进优菈目录并被其它模型继承。
- 替代概念：模型归属收藏动作（`ModelOwnedFavoriteMotions`）。现在每个模型只读取自己的 `<模型目录名>[动作]` 目录。
- 禁止用法：不得再让非优菈模型读取优菈 `[动作]` 目录；不得把收藏写入优菈目录来表示其它模型的收藏。

# 模型归属收藏动作

- 英文机器名：`ModelOwnedFavoriteMotions`
- 含义：每个 PMX 的收藏 VMD 只存放在自己的 `usage/vmd/<模型目录名>[动作]/` 目录，并且只对该模型可见；模型之间互不继承。
- 允许用法：收藏写入、资产同步入库、收藏列表、聊天动作解析、点击动作和默认待机池。
- 禁止用法：不得把收藏写入其它模型的目录；不得从 `_builtin` 或其它模型的 `[动作]` 目录反推归属；不得让模型继承不属于自己的收藏。
- 路由影响：`PATCH /assets/vmd/{asset_id}` 按 `model_relative_path` 决定写入目录；`/assets/vmd` 同步只扫描各模型自己的 `[动作]` 目录；`motion-context/exports` 只返回 `selected_model_path` 自己目录下的收藏。
- 完整定义：见 `workflow/concepts/model-owned-favorite-motions.zh-CN.md`。

# Reze K3 舞台配置

- 英文机器名：`reze-k3`
- 含义：当前项目 `renderPipeline` 的并列枚举值；与 `reze-design` 共用 `RezeWebGpuStage`（reze-engine WebGPU）运行时底座，材质、场景、本地 PMX 导入和编辑器 Dock 行为一致，仅语义定位为"复刻 reze-design 项目 MMD 渲染能力"的承接位。
- 透明背景：`reze-k3` 的 WebGPU 画布透明（`background: null`），不绘制 `#4b004f` 紫红底，由页面 MIO 星海 CSS 背景透出；`reze-design` 保持不透明紫红底。
- 允许用法：主站渲染模式选择、校准页面 query 参数和 `RenderPipeline` 类型值；编辑器 Dock 四页（材质 / 场景 / 资产 / 渲染）在主站开放。
- 禁止用法：不得把 WebGPU 兼容性失败静默伪装为 Three.js 成功渲染；不得替代 `reze-design` 或 `reze-npr`；桌面 Pet 无 WebGPU 时不得静默伪装为 Reze K3 成功渲染。
- 路由影响：选择后由 `RezeWebGpuStage` 创建 `Engine`，行为与 `reze-design` 相同；场景文档、相机快照按 `userId + modelPath + pipeline` 隔离存储，互不影响。
- VMD 预览影响：每次预览均携带递增的 `vmdRequestId`；只有最新异步加载可提交到模型，重复点击同一收藏动作也必须重新从首帧播放。
- 局部 VMD 影响：已有姿势上播放只含部分骨骼轨道的 VMD 时，必须保留未覆盖骨骼的当前姿势，禁止因全骨骼重置回退到 PMX 绑定 T 姿势。
- VMD IK 状态影响：Reze K3 播放前读取 VMD 文件尾部的显示/IK 帧；只有文件至少声明一个足 IK 条目、且全部 IK 条目始终关闭时，才允许在该剪辑期间关闭 reze-engine 全局 IK，以保护腿、膝和足首的 FK 轨道。没有 IK 条目、存在开启条目或中途切换状态时必须保持舞台默认 IK；动作结束或退出 VMD 模式后必须恢复默认值。
- 动作完成影响：reze-engine 的 `animationState.setOnEnd()` 必须回传页面动作状态机，并按剪辑时长设置兜底完成计时；单次预览、聊天或点击动作结束后复用同一收藏待机恢复规则，不能停在最终帧。
- 空 VMD 限制：仅含文件头、无骨骼和形态帧的 64 字节 VMD 不是动作，禁止进入预览、角色点击和默认待机候选池；手动点击时必须显示不可预览原因，不能尝试播放后卡住。
- 循环 URL 限制：传给 WebGPU 舞台的首段 VMD、循环 VMD 与备用 VMD 必须全部绝对化为 API 地址，不能让循环段访问前端 `/assets/...`。

# 克莱妲默认外观

- 英文机器名：`KoledaDefaultAppearance`
- 含义：模型名称或路径包含“克莱妲”或 `Koleda` 时，加载后默认闭眼并隐藏口罩材质的角色级外观规则。
- 允许用法：Three.js MMD 舞台与 Reze WebGPU 舞台加载模型、单次动作复原姿势后。
- 禁止用法：不得修改 PMX/VMD 源文件；不得把该规则应用于未命中克莱妲关键字的模型；不得根据固定材质编号隐藏部件。
- 路由影响：按 Morph 名称优先选择同时包含 eye/眼/目 与 close/闭 的闭眼通道，缺失时才使用 blink；Reze WebGPU 在每帧 VMD Morph 采样后重新写入该通道，从而保持闭眼并禁用眨眼；按材质名称匹配 `mask`、`face mask`、`mouth mask`、`口罩`、`面具` 后隐藏；Reze WebGPU 对 body/face/skin/肌/脸/顔 命中的材质强制归入 `cloth_smooth`（柔滑布料）分组。

# V14D Morph 取证默认外观锁隔离

- 英文机器名：`v14d-morph-forensic-lock-isolation`；失败分类：`H6_productionDefaultAppearanceLockInterference`。
- 含义：显式 Morph 取证探针先记录克莱妲默认外观锁对请求权重的控制，再在生产 `model.update()` 返回后仅对探针重写指定权重，并继续使用真实 GPU Morph dispatch、队列等待和生产 `vertexBuffer` 读回，避免把锁造成的同态零 delta 误判为引擎 Morph 丢失。
- 允许用法：`web/scripts/repro-v14d-lashes-morph-offsets.mjs` 的 probe-only 隔离；报告 `defaultAppearanceLockControl`、`defaultAppearanceLockBypassedByProbe`、H6 状态和 `firstLostBoundary`。
- 禁止用法：不得修改生产默认外观锁、正式 G7、`expectedAffectedSlots`、PMX/VMD、视觉公式或材质资产；不得用绕过探针宣称产品默认外观已解除。
- 路由影响：先核对 PMX/Blender 的严格非零偏移、材质交集、生产 draw 索引和 runtime CSR；隔离后 GPU 仍不一致才进入引擎 Morph 输入/compute 路线。完整定义见 `workflow/concepts/v14d-morph-forensic-lock-isolation.zh-CN.md`。

# 通用内置动作库

- 英文机器名：`usage/vmd/_builtin`
- 含义：所有 PMX 可读取的共享动作目录，其中资产不是任何模型的收藏。
- 现状：不再由收藏同步生成。旧规则曾把优菈收藏目录递归复制到这里供全模型继承，该复制已移除，`_builtin` 的存在与内容改为纯人工维护的共享资产。
- 禁止用法：不得把 `_builtin` 中的文件标记为收藏；不得把数据库残留 `is_favorite` 当作收藏来源；不得用 `_builtin` 反推收藏归属。
- 路由影响：收藏只从当前模型自己的 `usage/vmd/<模型目录名>[动作]/` 同步；`_builtin` 只在当前模型没有任何有效收藏时作为待机兜底，且不参与 `favorite-relative-path` 归属判定。
- 完整定义：见 `workflow/concepts/model-owned-favorite-motions.zh-CN.md`。

# Reze 材质类别样式组

- 英文机器名：`RezeMaterialStyleGroupId`
- 含义：按材质语义组织 PMX 材质并提供推荐着色器图的固定类别。标准类别为 `default`、`body`、`eye`、`face`、`hair`、`metal`、`cloth_rough`、`cloth_smooth`、`stockings`，另有 `ungrouped`（未分组）。
- 允许用法：材质树分组、样式组基线、人工跨组移动和自动分类。
- 禁止用法：不得把样式组类别等同于当前使用的着色器图，也不得限制该组只能选择推荐图。
- 路由影响：先解析人工分组覆盖，否则使用自动分类；最终图再按单材质覆盖、组基线、推荐图的顺序解析。
- 完整定义：见 `workflow/concepts/reze-shader-workflow.zh-CN.md`。

# 样式组基线

- 英文机器名：`groupGraphBindings`
- 含义：Reze 场景文档中，材质类别样式组指向稳定着色器图引用的组级绑定。
- 允许用法：组标题快速选择器、恢复推荐图、覆盖数量计算。
- 禁止用法：切换组基线时不得改写已有单材质图覆盖。
- 路由影响：仅在当前材质没有单材质图覆盖时参与最终图解析。
- 完整定义：见 `workflow/concepts/reze-shader-workflow.zh-CN.md`。

# 单材质图覆盖

- 英文机器名：`materialGraphOverrides`
- 含义：Reze 场景文档中，单个稳定 PMX 材质键指向着色器图引用的显式覆盖。
- 允许用法：单材质快速选择、图库应用目标、旧 `materialPresets` 迁移。
- 禁止用法：缺少该字段表示“跟随样式组”，不能用 `默认`图代替继承语义。
- 路由影响：优先级高于样式组基线；材质跨组移动时继续保留。
- 完整定义：见 `workflow/concepts/reze-shader-workflow.zh-CN.md`。

# 本地图资产

- 英文机器名：`RezeShaderGraphAsset`
- 含义：按当前 `userId` 隔离存入 IndexedDB 的可复用着色器图资产，包含稳定 ID、双语名称、`ShaderGraph`、`renderClass`（渲染集成类别）、`alphaMode`（透明度处理模式）、推荐类别、标签、说明和来源元数据。
- 允许用法：跨模型复用、收藏、JSON 导入/导出、复制、重命名和节点编辑。
- 禁止用法：场景文档不得复制资产图 JSON；内置图不得作为可写本地图覆盖。
- 路由影响：场景只保存 `local:<uuid>` 图引用；删除前必须扫描并处理全部引用。
- 完整定义：见 `workflow/concepts/reze-shader-workflow.zh-CN.md`。

# 着色器编辑草稿

- 英文机器名：`RezeShaderGraphDraft`
- 含义：节点编辑器正在修改的本地图资产状态。打开内置图或已可应用本地图进行编辑时创建独立草稿，避免编辑过程改变既有场景绑定。
- 允许用法：自动保存、撤销/重做、临时预览、应用和应用并关闭。
- 禁止用法：不得把临时预览当作正式场景提交；关闭未应用时不得丢弃草稿。
- 路由影响：校验与编译成功只更新临时预览；用户点击应用后才把草稿转为可应用资产并更新目标绑定。
- 完整定义：见 `workflow/concepts/reze-shader-workflow.zh-CN.md`。

# 着色器异步应用事务

- 英文机器名：`RezeShaderApplyTransaction`
- 含义：从用户选择稳定图引用开始，到图校验、WGSL 生成、WebGPU 管线创建、最新世代确认、舞台切换和场景文档提交结束的原子业务操作。
- 允许用法：样式组快速选择、单材质选择、图库应用、节点编辑器应用。
- 禁止用法：不得在异步编译完成前更新已应用勾选或写入场景文档；失败和过期请求不得提交。
- 路由影响：编译期间旧图继续渲染；只有最新请求成功后才同时提交舞台、界面和持久化。
- 完整定义：见 `workflow/concepts/reze-shader-workflow.zh-CN.md`。

# Pet 左键输入路由

- 英文机器名：`PetLeftClickRouting`
- 含义：Desktop Pet 对左键短按、窗口拖动和相机调整进行统一分流的输入规则；按下只记录候选，超过 6px 才启动拖动，静止抬起才选择动作。
- 允许用法：Pet 默认拖动模式、相机调整模式、透明窗口原生点击兜底。
- 禁止用法：不得让 `pointerdown` 立即启动拖动；不得让透明层无条件 `click` 或 MMDStage 内部捕获绕过位移判定选择动作。
- 路由影响：外层文档级指针候选和 Electron 原生候选共同进入同一动作选择入口；WebGPU 舞台矩形由 `MMDStage` 回退到 `RezeWebGpuStage` 画布。
- 完整定义：见 `workflow/concepts/pet-left-click-routing.zh-CN.md`。

# Pet 相机调整退出保护

- 英文机器名：`PetCameraAdjustExitGuard`
- 含义：Desktop Pet 在 `camera-adjust` 模式下由 renderer 和 Electron `webContents` 共同阻断默认上下文菜单，再由主进程拒绝自定义右键菜单入口，并通过独立的“保存并退出相机”悬浮按钮保存当前镜头、锁定相机和恢复 `window-drag`。
- 允许用法：相机拖动、滚轮缩放/旋转、Windows 原生右键和 Electron `webContents` 右键的统一保护。
- 禁止用法：不得在相机模式弹出右键菜单；不得让退出按钮参与角色点击、窗口拖动或另建相机存储格式。
- 路由影响：右键请求在 Electron 主进程入口被拒绝；退出按钮复用 `PetInteractionMode` 切换与既有按模型/管线隔离的相机快照保存路线。
- 完整定义：见 `workflow/concepts/pet-camera-adjust-exit-guard.zh-CN.md`。

# 会话展示清洗

- 英文机器名：`CodexSessionPresentationSanitization`
- 含义：Desktop Pet 在会话汇合和 UI 展示边界，对注入上下文、旧缓存标题、机器输出包装行和敏感值进行统一过滤、回退、脱敏与限长。
- 允许用法：会话标题、prompt/summary 预览、Pet 完成状态卡和独立完成通知窗口的共同展示规则。
- 禁止用法：不得把清洗后的展示文本当作完整 transcript；不得以展示回退值覆盖原始会话证据；不得把进度条、`Exit code` 或分隔线当作用户任务结果。
- 路由影响：Electron 主进程在 `AgentSessionRecord` 汇合点清洗一次，renderer 的完成通知、状态卡和会话选择器再次按同一纯函数规则防御旧数据；无效标题回退到工作区或有效摘要。
- 完整定义：见 `workflow/concepts/codex-session-presentation-sanitization.zh-CN.md`。

# Pet 独立完成通知窗口

- 英文机器名：`PetCompletionNoticeWindow`
- 含义：由 Electron 主进程创建的独立完成通知 `BrowserWindow`；收起态是单个聚合胶囊，展开态最多显示 3 条纵向通知，窗口高度遵循固定收起高度和按条数计算的展开高度；通知加载独立页面，通过受限 preload IPC 支持收起、展开、关闭和聚焦 workspace，并随 Pet 移动/缩放重新定位。
- 允许用法：真实完成事件的桌面悬浮通知、独立窗口边界验收、窗口关闭 key 的主进程持久化。
- 禁止用法：把它描述为 Pet 主窗口 DOM 内容、Windows 系统 Toast，或用历史 completed 扫描直接触发；不能用窗口级截图替代 HWND/bounds 或自动化测试证据。
- 路由影响：主进程 completion tracker/reducer 决定是否弹出；通知窗口与 Pet 主窗口分别拥有生命周期和 bounds；关闭 key 写入 Electron `userData/dismissed-completion-notice.json`；通知文本必须与完成状态卡共享清洗语义。
- 完整定义：见 `workflow/concepts/pet-completion-notice-window.zh-CN.md`。

# Desktop Pet 会话发现 Worker

- 英文机器名：`agentSessionDiscoveryWorker`
- 含义：由 Electron 主进程调度的独立 Node Worker，执行 Codex、Claude、Pet app-server 会话发现和 Windows 进程增强；主进程只接收序列化结果，不执行全局同步 JSONL/进程扫描。
- 允许用法：启动预热、15 秒周期刷新、菜单会话缓存和发现超时隔离。
- 禁止用法：不得把同步全局扫描重新放回 Electron 主进程；Worker 超时不得伪装成空会话，也不得阻塞窗口交互。
- 路由影响：`desktop-pet/electron/main.ts` 通过 `runAgentSessionDiscoveryInWorker()` 串行调度并以 30 秒上限终止；Worker 失败只记录刷新错误并保留主进程可响应性。
- 完整定义：见 `workflow/concepts/pet-agent-session-discovery-worker.zh-CN.md`。

# Codex 作者知识交接

- 英文机器名：`CodexAuthorKnowledgeHandoff`
- 含义：Codex 在完成实质任务并形成稳定领域语义变化后生成的不可变 `3+N` 作者提案包，由人读 `handoff.md`、紧凑 `marker.yaml`、Hook 来源 `metadata.json`、一个或多个纯 Markdown candidate 和 `.complete` 组成。
- 允许用法：把 Codex 的问题、根因、解决方式、边界、知识主张和证据提示交给 Pet、FastAPI 和 OpenClaw 继续治理。
- 禁止用法：不得由普通 Review `accept` 触发；不得在 marker 中决定 Obsidian 路径、主题身份或发布动作；不得把 candidate 声明为 canonical knowledge；不得在无知识变化时生成空包。
- 路由影响：数据主链固定为 `Codex -> Pet -> FastAPI -> OpenClaw -> Obsidian`；FastAPI 负责 Repository Evidence 和 Gate，OpenClaw 负责双审核、Vault Topic Resolution、Accepted Wiki Change Set 和发布。
- 完整定义：见 `workflow/concepts/codex-author-knowledge-handoff.zh-CN.md`。

# 免仓库锚定知识层级

- 英文机器名：`REVISION_EXEMPT_KINDS`（当前仅含 `failure_classification`）
- 含义：失败分类/教训类知识免除 Git 持久锚定门禁，仓库状态只作展示元信息；bad case 教训的时效性高于代码锚定，只要求作者说明完整并如实标注 `pending_verification`。
- 允许用法：bad case、失败分类等不依赖具体代码状态仍可复用的知识。
- 禁止用法：不得把依赖代码实现的知识（规则、契约、架构决策）标记为免锚定层级。
- 路由影响：FastAPI reconcile 时仓库状态不参与判定，直接进入证据与作者解释检查。
- 完整定义：见 `workflow/concepts/codex-author-knowledge-handoff.zh-CN.md` 的“Git 锚定判定口径（2026-09-14 修订）”。

# 恢复锚定

- 英文机器名：`allow_recovery` / 捕获脏恢复锚定
- 含义：候选捕获时缺失 `head_commit` 或处于未提交状态时，reconcile 自动把锚定修正为工作区当前 HEAD；证据按该 commit 读 blob 复核，工作区此刻的脏污不再作为阻断条件。
- 允许用法：日常任务未完成提交时产生的知识候选。
- 禁止用法：不得用恢复锚定绕过证据复核；证据在锚定 commit 上读不到时仍判 `needs_evidence`。
- 路由影响：durable 判定的兜底为“commit 挂在任意本地分支即视为持久”，孤儿 commit 仍为 `needs_durable_revision`。
- 完整定义：同上新概念文档修订章节。

# git 事件防抖

- 英文机器名：`codex_author_knowledge_git_event_debounce_seconds`
- 含义：外部监视器推送的 git 事件按固定间隔（默认 30 秒）防抖，且 reconcile 全链路共享互斥锁，防止每个文件变更事件触发全量 reconcile 形成 git 进程洪峰拖垮 API。
- 允许用法：git-events 路由与周期 reconcile worker 的调度保护。
- 禁止用法：不得为追求“实时”把防抖间隔设为 0（测试环境除外）。
- 路由影响：被防抖命中或锁竞争失败的事件返回 `debounced: true` 且不做 reconcile；周期 worker 仍是最终兜底。
- 完整定义：同上新概念文档修订章节。

# 黄金帧最终着色烘焙（bakedGolden）

- 英文机器名：`bakedGolden`（`v14dFaceMode=bakedGolden`）
- 含义：V14D 固定黄金帧诊断入口下的一个**非默认**模式。[Stage 2A-GF2] 起为「最终着色烘焙」：在**带 UI 的 Blender 会话**（非 `-b` 无头）用 Cycles `bpy.ops.object.bake(type='COMBINED')` 把 frame120 的**六 AREA 灯 + 世界光 + Toon + Face Shadow(State2/Blend0)** 固化进逐材质线性纹理（`baked_<材质>.png`），经 `rgba8unorm-srgb` 绑定 + sRGB 解码注入 Web，对 Face/EyeWhite/Eyes/Eyes+/HairA/HairB/BodySkin/Cth1-Top/Cth1-Cape 套纯纹理 unlit graph 显示（exposure=0）。
- 与旧「反照率烘焙诊断（失败实验）」的区别：旧版用「发射 + 逐材质 mask」只固化 BaseColor 反照率、**不含光照**（实测 ROI MAE 不降反升，已作废）；新版 Cycles COMBINED **含全部光照**，是真正闭合材质/光照视觉 Gate 的路线。带 UI 会话解除了无头环境 `bpy.ops.object.bake` `poll()` 恒 False 的硬阻塞。
- 允许用法：作为固定帧（frame120/State2/Blend0）的视觉对齐诊断与验收；管线与资产政策不变（第三方 PMX/VMD/原始纹理不提交，派生烘焙图由用户本地目录注入）。
- 禁止用法：**不得作为默认模式**（默认仍为 `finalFaceComposite`）；**不得实现动态五档/窄混合/迟滞/通用实时六灯**（那是独立票据）；**不得替代动态 VMD 播放渲染**。
- 逐材质独立绑定不变量（验收修正轮）：烘焙文件以**唯一逻辑键** `Textures/v14d-baked/baked_<key>.png` 注入；真实 GPU 绑定由引擎 `materialDiffuseOverrides` 在 `loadFromReader` 后、GPU 材质建立（`setupMaterialsForInstance` 上传 GPUTexture/建 bind group）前为每个目标材质**追加独立 texture entry 并改 diffuseTextureIndex** 完成——loadModel 返回后才改 `tex.path` 属伪绑定（不重传 GPUTexture）。9 个目标材质一一对应、互不覆盖。禁止复用原始纹理键（face_d/hair_d/cloth1_da）冒充按槽绑定——`fileListToMap()` `Map.set()` 后写覆盖前写曾致 EyeWhite 覆盖 Face、HairB 覆盖 HairA、空 Cape 覆盖 Top。`faceApplied=true` 只证明 graph 应用，不作纹理注入通过证据；逐材质绑定硬 Gate `validateBakedBinding` 要求 9 材质全部命中且数量恰好为 9。
- 路由影响：只影响 `/mmd-calibration-render?v14dFaceStatic=1&v14dFaceMode=bakedGolden` 诊断渲染层，不影响 PMX/VMD Runtime；默认生产入口与 `finalFaceComposite` 默认模式均不启用。
- 完整定义：见 `docs/handoff/2026-08-28-v14d-static-golden-frame.md`「修正轮烘焙尝试与阻塞」与本票交付报告（最终着色烘焙）。
- 完整定义：见 `workflow/concepts/v14d-golden-frame-final-shading-bake.zh-CN.md`、`docs/handoff/2026-08-28-v14d-static-golden-frame.md`「修正轮烘焙尝试与阻塞」与本票交付报告（最终着色烘焙）。

# V14D 显示字节直通捕获（displayPassthrough）

- 英文机器名：`displayPassthrough`（引擎视图变换字段，默认 `false`）；诊断管线「显示字节捕获/反投影」。
- 含义：一条默认关闭的诊断契约，让 Web 端 Face 材质最终显示字节逐字节等于磁盘权威 AgX PNG 的原始 8-bit 显示字节。链路：fresh EEVEE frame120 AgX PNG 原始字节 → 按屏幕像素→UV 反投影到 Face atlas（G3）→ 经 materialDiffuseOverrides 真绑定注入 → 引擎 composite 的 displayPassthrough 绕过 Filmic/grade/gamma 并做 linear→sRGB 编码 → 最终 canvas 字节等于注入纹理字节。
- 允许用法：固定黄金帧（frame120/State2/Blend0）下验证显示字节闭环（G1 色块、G4 对照）；`displayPassthrough` 仅在 `v14dFaceMode=bakedGolden` 诊断下置 true。
- 禁止用法：反投影源不得用 image.pixels 猜颜色空间、不得再过 Filmic、不得手调 RGB、不得改写权威参考；不得作为默认生产路径（默认 finalFaceComposite，displayPassthrough 默认 false）；G4 MAE 未达 ≤20/255 时不得宣称「Face 明显对齐」；Face Gate 未通过前不得扩展其他材质；不得用它闭跨渲染器的像素级几何错位。
- 路由影响：只影响 `/mmd-calibration-render?v14dFaceStatic=1&v14dFaceMode=bakedGolden` 诊断渲染层与 `patch-reze-engine.mjs` 的引擎补丁；不影响 PMX/VMD Runtime、默认生产入口。
- 完整定义：见 `workflow/concepts/v14d-display-byte-passthrough-capture.zh-CN.md`。

# V14D 脸部 State 2 实时合成（固定帧）

- 英文机器名：`v14d-face-state2-live-composite`（契约 / contract id）；Web 实时 State 2 脸部合成。
- 含义：对 PMX 材质名 `Face` 每像素从原始 BaseColor（`face_d`）+ Blender State2 packed mask + 节点常量，在 Web 线性空间实时执行 warm/art/fringe 合成（State=2/Blend=0 恒等）。公式：`warm=faceD_linear*warmColor`、`art=mix(white,artShadowTint,R*(1-B))`、`fringe=mix(white,fringeTint,G*(1-B))`、`shadowFactor=art*fringe`、`composite=warm*shadowFactor`。
- 允许用法：固定帧（frame120/State2/Blend0）实时合成预览与三诊断视图（BaseColor/ShadowFactor/FinalComposite）；经 reze-engine 补丁 materialAuxTextures + binding(5) mask + `v14dState2OverrideFsBodyFixed` 注入。
- 禁止用法：不用屏幕像素→UV 反投影 atlas 作运行时材质；不用 bakedGolden 烘焙冒充生产方案；不把灯光/阴影/高光/AgX 固化进 BaseColor；不手调 RGB；不实现五档动态/Narrow Blend/Hysteresis（范围外）；完整 Face Gate MAE 未达 ≤20/255 时不得宣称完成。
- 路由影响：只影响 `/mmd-calibration-render` faceStatic 的 faceShadowOnly/finalFaceComposite 实时合成模式与 `patch-reze-engine.mjs`；不影响 PMX/VMD Runtime、默认生产入口（诊断开关默认关闭）。当前 Gate 未达标阻塞。
- 完整定义：见 `workflow/concepts/v14d-face-state2-live-composite.zh-CN.md`、`docs/handoff/2026-08-31-v14d-face-state2-runtime.md`。

# V14D 全身皮肤 State 2 实时合成（固定帧）

- 英文机器名：`v14d-body-skin-state2`（契约 / contract id）；Web 全身皮肤（BodySkin）实时合成。
- 含义：在 `v14dFaceStatic=1&v14dFaceMode=finalFaceComposite` 诊断入口下，把「只接入 Face」扩展为「Face + BodySkin 同一 V14D skin family」。BodySkin 用「body_d 线性 × 身体 warm=[1,0.945,0.905]」直出（不套脸部专用 State2 packed mask），与 Face 共享线性色彩处理与显示变换。四区域（neck/torso/leftHand/rightHand）按 BodySkin 三角形顶点主导骨骼归属（V14D_BODY_SKIN_BONE_REGIONS_V1，骨骼主导权重集合）独立对账；旧版 V14D_BODY_SKIN_REGIONS（世界 y 带 + x 符号矩形）已废弃，仅作历史参考。
- 允许用法：固定 frame120 全身皮肤预览；bodyApplied 必须来自真实 graph 状态（组诊断 ok 且实际绑定 graph.name === "V14D Body Skin Composite"）；区域样本不足时诚实标记 occluded/checkpoint（exit 3），不软通过。
- 禁止用法：不把脸部 State2 mask 套到 BodySkin UV；不用 faceResult.ok && 材质存在自证 bodyApplied；不把白衣/头发/眼睛归入皮肤；不在 loadModel 后伪改 path；不写成「完整 V14D/Face Gate 已通过」（本概念是视觉预览范围扩展）。
- 路由影响：只影响 v14dFaceStatic=1&v14dFaceMode=finalFaceComposite 诊断渲染层与 patch-reze-engine.mjs（WGSL v14d_skin_body_composite helper）；不影响 PMX/VMD Runtime、默认生产入口（诊断开关默认关闭）。
- 完整定义：见 workflow/concepts/v14d-body-skin-state2.zh-CN.md、docs/handoff/2026-09-01-v14d-body-skin-state2.md。

# V14D BodySkin 骨骼主导语义分区

- 英文机器名：v14d-bodyskin-bone-semantic-region（概念 id）；常量 V14D_BODY_SKIN_BONE_REGIONS_V1、函数 classifyV14dVerticesByBoneRegion、导出字段 boneRegionLabels。
- 含义：BodySkin 三角形按顶点主导骨骼（蒙皮权重最大的骨骼索引）归属语义区域（neck 颈部 / torso 躯干腰腹 / leftHand 左手 / rightHand 右手），替代旧版 V14D_BODY_SKIN_REGIONS 的世界 y 带 + x 符号矩形分区。骨骼索引序 = reze-engine 运行时 skeleton.bones 顺序（PMX 骨骼段序），版本号 v1 与该索引集合绑定（与常量名 V14D_BODY_SKIN_BONE_REGIONS_V1 一致，单一权威版本名）。
- 允许用法：作为 BodySkin 语义区域正式归属依据；区域集合互不重叠、一个骨骼索引至多属一个区域；模型或引擎更换骨骼排序必须升版本并重新核对索引。
- 禁止用法：不再用世界 y 带 + x 符号矩形作为正式归属（已废弃，仅历史/legacy 诊断字段透传，不参与正式归属、不是兼容回退）；不把 Blender 顶点组索引直接当 PMX joints 索引（两套索引序不同）；不把腕/手捩骨（被袖口覆盖）计入手部可见皮肤。
- 路由影响：只影响 v14dFaceStatic=1 诊断导出（exportMaterialTriRegions）与 web/scripts/gate-v14d-body-skin-state2.mjs 的区域归属计算；不影响生产默认入口、PMX/VMD/骨骼/物理/播放链。
- 完整定义：见 workflow/concepts/v14d-bodyskin-bone-semantic-region.zh-CN.md。

# 头发同材质同三角形同 UV 逐像素门禁

- 英文机器名：v14d-hair-triuv-pixel-gate。
- 含义：HairA/HairB 每个正式屏幕样本同时绑定引擎 materialId、同槽局部 triId、插值 UV 和权威 hair_d 线性双线性采样目标，再应用 v14dAuthority.js 的 V14D_HAIR_TINT 转为显示字节比较；纹理四邻域按 WebGPU `REPEAT` 在宽/高方向 modulo wrap，不能在边缘 clamp。Hair 正式画布与 material-ID/depth、triId、插值 UV、triangleUvs 必须由同一个原子 `captureHairTriUv` probe 在同停帧返回，并共享 `captureId/currentSeconds/currentFrame/fps/fpsProvenance`；其中 pixel/triUV 的 width/height 必须各自为有限正整数且 pair 内相等，fps 必须为有限数 30，来源必须为 `vmd-standard-fixed-30`，不得由 frame/seconds 事后补造。original/V1 还必须分别满足绝对 `4s / frame 120 / 30 FPS / koleda-v14d-authoritative-pose-f120.vmd`，动画名不得为空。`targetBinding.inputsValid` 证明输入合法，`metricGate` 证明误差自然收敛；正式 Gate 由 `hairFormalGate` 唯一组合每槽 changed、目标收敛、绑定一致性和输入合法性。错槽负测使用自身 UV 的同像素 canonical target 与 v1Mae/drop/P95 证据，不能写入强制失败字段。ROI 不能替代材质/三角形身份，旧 targetMean 只保留为历史 checkpoint；合并 `hair` ROI 只能标记为 `diagnosticOnly/report-only`，不得阻断健康样本或污染负测 `analysisFailures`。
- 允许用法：Stage 2C-M1.1/M1.2/M1.3 的 HairA/HairB BaseColor 逐槽 Gate、固定帧同帧 triUV 证据、错槽/错目标语义负测和 wrongTint 预期拒绝协议；独立 analyzer 默认读取 `g3-hair-original-canvas.png` / `g3-hair-v1-canvas.png`。
- 禁止用法：不得用整槽均值、矩形 ROI、材质计数恒等式、`targetBinding.consistent=false` 自证或视角相关高光结果冒充逐像素 BaseColor 目标；不得让 captureHairTriUv 采集后无条件启动 渲染循环（render-loop）；不得扩大到 PMX/VMD/骨骼/物理/播放或其他材质槽。
- 路由影响：由 web/scripts/analyze-reze-k3-v1-diff.mjs 与 web/scripts/accept-reze-k3-v1-stage.mjs 消费，采集只在显式 acceptance probe 下启用；原子采集时间推进、跨帧配对或 triUV 解析率低于 99.9% 时拒绝；`--self-test-hair-gate` 可在无渲染产物时验证正式组合与负测判定契约；完整定义见 workflow/concepts/v14d-hair-triuv-pixel-gate.zh-CN.md。

# V14D Brows/Lashes 恒等 tint 迁移

- 英文机器名：v14d-brows-lashes-identity-tint（概念 id）；常量 V14D_BROWS_MATERIAL_NAME / V14D_LASHES_MATERIAL_NAME / V14D_BROWS_LASHES_TINT，graph V14D_BROWS_LASHES_V1_COMPOSITE_GRAPH（"V14D Brows Lashes V1 Composite"，节点 id v14d_brows_lashes_tint）。
- 含义：把权威克莱妲 Brows/Lashes 两槽从原 K3 face 分组抽出绑定到独立 V14D graph。权威取证确认两槽 BaseColor/Alpha 直连 face_d 纹理、无乘色节点，V1 目标 = 原色通过 + 独立绑定；实现复用 v14d_hair_composite helper 以恒等 tint [1,1,1] 达成原样通过。renderClass=auto（非 hair），alphaMode=hashed（alphaThreshold=0.5）。
- 允许用法：权威克莱妲 Brows/Lashes 的 V1 迁移；任何 BaseColor 无乘色节点的槽可复用同口径。正式 Gate 由 G2 draw-call/graph 绑定证据 + missing/swap 负测承担，不产生颜色变化故不适用逐槽像素收敛 Gate。
- 禁止用法：不得给需变色槽套恒等 tint 冒充迁移；不得用 renderClass=hair 渲染眉毛睫毛；不得复制恒等 tint 字面量形成双权威（必须只从 v14dAuthority.js 读）。
- 路由影响：只影响 V14D V1 变体的 Brows/Lashes 分组绑定；不影响原始模式、Face/BodySkin/HairA/HairB、灯光/星空/相机、PMX/VMD/骨骼/物理。完整定义见 workflow/concepts/v14d-brows-lashes-identity-tint.zh-CN.md。

# V14D 生产绘制调用几何源快照

- 英文机器名：v14d-production-draw-call-source-snapshot；引擎方法 getProductionDrawCallSourceSnapshot(captureId, frame)。
- 含义：reze-engine 在同一 JavaScript realm 内，以只读方式返回生产 material-ID pick 与正常生产 draw call 共同使用的 ModelInstance GPU 顶点、索引、joints、weights、skin matrix buffer、绘制索引范围（draw range）、bind group、pipeline、HDR/mask resolve texture 及 Morph/蒙皮来源。快照句柄只给同 realm 的诊断 pass 消费；落盘 audit 只保存身份、范围、格式、非零统计、索引完整性和 sameAsEngine 核对结果。
- 允许用法：显式 acceptance probe 的 captureHairTriUv 使用 production-draw-call source 生成同帧 triId+UV；核对 Brows/Lashes 等目标槽的真实生产几何来源、pick/main 绘制索引范围（draw range） 和绑定关系；用 captureId/frame 把 pixel、material mask、triUV 与 source audit 关联。
- 禁止用法：不得用 model.getVertices() CPU base、旧的无 COPY_SRC 读回、材质计数、矩形 ROI、屏幕平移、mask 膨胀或 depthBias 冒充生产源；不得把 GPU 句柄序列化到 JSON、localStorage、共享配置或后端；不得用该诊断 seam 改视觉公式、alpha、灯光、相机默认值、PMX/VMD 或 Morph 数据。
- 路由影响：由 web/scripts/patch-reze-engine.mjs 注入 reze-engine src/dist/d.ts 的接口和合法 COPY_SRC usage；web/src/features/stage/v14dColorBaseline.ts 执行只读读回与统计；RezeWebGpuStage.tsx 仅在显式验收 probe 中选择 sourceMode=production-draw-call，默认生产入口不调用。机器错误分类为 interface-unavailable、invalid-capture-request、snapshot-rejected、buffer-readback-failed、buffer-readback-incomplete。
- 验收证据：正常回放的 Brows 为 production/triUV=257/257、overlapRatio=1、centroidShiftPx=0；Lashes 为 9320/9320、overlapRatio=1、centroidShiftPx=0。--neg-wrong-source 与 --neg-mat-swap 均必须 exit=1 且 negativeVerdict.status=rejected。完整定义见 workflow/concepts/v14d-production-draw-call-source-snapshot.zh-CN.md。

# V14D 显示链提交边界

- 英文机器名：`v14d-display-chain-commit-boundary`；诊断接口 `installDisplayChainTrace`、`setDisplayChainTraceCapture`、`captureDisplayChainState`。
- 含义：材质图编译/安装、样式组重绑只是显示链前置状态；从真实 draw-call 的 `setPipeline`/`setBindGroup`/`drawIndexed`，到场景 HDR 目标、resolve、composite/tone mapping 和最终 canvas 的命令提交，才构成一次可见变化。冻结 render loop 时，apply 成功而没有下一次 `renderFrame`/queue submission，画布可以继续保持旧帧。
- 允许用法：在显式 `?v14dAcceptanceProbe=1` 下，以 `pairId` 关联 identity、identity-control、sentinel 对照；每一侧使用唯一 `captureId/frame` 记录 compile/install pipeline、实际 draw pipeline、bind group、绘制索引范围（draw range）、HDR 和最终 canvas，定位首个预期变化消失的边界。报告的 `displayChain`/`stageDeltas` 必须把 HDR resolve 槽差异、composite pipeline/gamma、最终 canvas 和非目标噪声基线落盘，并硬断言 `pageErrors`、`failedRequests`、`httpBad` 均为 0。
- 禁止用法：不得把该诊断接缝启用到默认生产入口；不得用它改 graph 公式、正式视觉阈值、alpha analyzer、灯光、相机、PMX/VMD 或播放链。
- 路由影响：只影响 Reze WebGPU 验收诊断与显示链故障分类；健康回放的 H1–H5 结果必须由实际证据动态产生；`--fault-no-render` 只确认无新提交帧，缺少 observed sentinel draw 时 H2–H5 必须为 `not-evaluated`。完整 Brows/Lashes 逐槽、透明边缘和动态 Morph Gate 仍按各自契约验收。完整定义见 `workflow/concepts/v14d-display-chain-commit-boundary.zh-CN.md`。

# V14D 编译/安装非最终显示证明

- 英文机器名：`v14d-compile-install-not-display-proof`。
- 含义：graph/WGSL 编译成功和 WebGPU pipeline 安装成功，只证明着色器阶段可建立；它不证明目标 draw 实际绑定新 pipeline，也不证明 HDR resolve、后续 composite/tone mapping 或最终 canvas 已使用该结果。
- 允许用法：把 compile/install 作为必要前置证据，再分别核对实际 `setPipeline`、绘制索引范围（draw range）/bind group、pre-tonemap HDR、resolve/composite 与 canvas 差异；在冻结帧场景使用一次明确的零增量 render 提交完成显示链。
- 禁止用法：不得以 pipeline 身份变化、OnComposite 计数、截图存在、配置完整或放宽 analyzer 阈值包装“最终画布未达到拒绝阈值且没有实际 render 证据”为通过。
- 路由影响：当 `wrongTint` 已进入 graph/WGSL/安装但最终画布无变化时，优先路由到显示链提交边界诊断；只有证明 draw 与目标均已变化后，才进入 tone mapping、采集或视觉公式调查。

# V14D 显示链绘制身份唯一性

- 英文机器名：`v14d-display-chain-draw-identity`；相关字段 `drawIdentityKey`、`drawIndex`、`drawOrder`、`matchStatus`。
- 含义：生产 draw 与实际 `drawIndexed` 必须按 `materialName`、`groupId`、`type`、`count`、`firstIndex` 及顺序建立可审计一一对应；生产 `drawIndex` 与实际 `drawOrder` 分开记录。
- 允许用法：Brows/Lashes 各恰好一个唯一匹配，`drawIndex` 非空，实际 pipeline 等于该槽 compile/install pipeline，重复 range 或未匹配必须机器失败。
- 禁止用法：不得按顺序猜配、用目标 mask 扩大掩盖 unmatched、把 `drawOrder` 强行当作生产 `drawIndex`，或用身份核对替代 HDR/canvas 证据。
- 路由影响：只影响显式 acceptance probe 的显示链 trace 与 repro 报告；完整定义见 `workflow/concepts/v14d-display-chain-draw-identity.zh-CN.md`。
