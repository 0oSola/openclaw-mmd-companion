# 当前系统拓扑与架构蓝图

## 请求认证规则（2026-09-21）

身份校验由 `api/app/main.py` 的 `AuthMiddleware` 与 `api/app/security.py` 的 `require_auth` 共同完成，二者职责不同。

中间件按 `APP_STATE` 里的 `jwt_secret` 决定是否启用校验：`jwt_secret` 为空时全部放行，这是测试基座的开关；配了密钥时，请求必须携带 `Authorization: Bearer <token>` 或非空 `x-user-id` 头，否则返回 401。合法 token 解析出的用户会写入 `request.state.authenticated_user_id`，并在请求未携带 `x-user-id` 时回填该头，避免同一次请求在中间件通过、却在路由层被再次判定未登录。以下路径不参与 token 校验：`/healthz`、`/healthz/openclaw`、`/auth/login`、`/auth/register`、`/docs`、`/openapi.json`、`/redoc`，以及前缀 `/assets/mmd/`、`/assets/vmd/`、`/assets/v14d-game/`；OPTIONS 预检也直接放行。

`/tts/proxy/` 前缀单独处理：`<audio src>` 无法携带请求头，这两条代理路由靠查询参数 `user_id` 传身份，归属校验由路由自身完成，中间件不得把它们拦成 401。

路由层统一调用 `require_auth(request)`，身份来源优先级为：中间件已校验的 token → `Authorization` 头 → `x-user-id` 头。路由不再直接调用 `resolve_requester`，否则会被「只认 `x-user-id`」的旧约定挡住，出现中间件放行 Bearer token、路由层却返回 401 的割裂。

业务测试显式传入 `jwt_secret: ""` 并自带身份头，避免继承本地 `api/.env` 里的 `JWT_SECRET`；认证规则本身由 `api/tests/test_auth_middleware.py` 单独覆盖（合法 token 放行、缺失身份 401、过期 401、伪造签名 401、公开路径放行、查询身份路径放行、空密钥关闭校验）。

`api/pytest.ini` 通过 `norecursedirs` 排除 `api/tests/tests_runtime`：测试夹具会在该目录下创建大量临时仓库，历史上已积累数万个目录，不排除会让 pytest 在收集阶段直接中断。

## 本地登录页注册入口（2026-09-17）

登录页“注册账号”可切换为注册表单，通过现有同源代理 `POST /api/backend/auth/register` 提交账号和密码。注册密码至少 6 个字符，前端校验确认密码；请求期间禁止重复提交和切换模式。成功后清除密码并返回登录，提示用户使用新设置的密码登录，不自动保存注册响应中的令牌。错误以中文提示。后端现有规则不变：无密码的同名账号补设密码并保留账号及工作区；已有密码返回 409，不允许注册覆盖。真实用户密码只能由用户输入，不能通过本次修复重置。

## 播放器全局模式（当前权威，替代下文逐动作记忆）

Companion默认烘焙模式，按用户在本浏览器保存单一playerVmdMode（mmd_player_vmd_mode_v1前缀），不读取旧mmd_vmd_baked_memory_v1逐资源设置。页面在舞台输入边界统一覆盖手动预览、收藏待机、聊天VMD的烘焙标记并去除逐URL表；共享MMD运行时的全局模式再次优先于兼容接口的逐动作选项，换片/换模型仍保持。

烘焙模式关闭IK/付与；普通模式开启这两项。两种模式均解除根位置与下半身固定。页面切换立即生效，允许重新开始当前动作；新资源ID无需再配置。旧localStorage值与历史测试工具未删除，但不参与当前页面决策。Ammo物理不变，Reze独立引擎不支持此开关，页面在对应模式禁用并解释。

实际页面验证：默认烘焙时IK=false、grant=false、root=false、lower=false，21动作随机池保持；切普通后两求解器true但两固定开关仍false，刷新保留普通；最终已恢复烘焙。不同URL播放沿用全局模式。22项模式/预览/真实混合器聚焦测试与TypeScript检查通过。普通未烘焙动作可能需要手动切普通；不承诺所有动作无穿插或模型兼容。

## 收藏即随机待机（当前规则）

Companion 读取当前用户在 `asset_model_favorites` 里、归属当前模型完整 `relative_path` 的收藏；不再扫描 `<模型目录名>[动作]` 目录，也不再只取优菈路径或 00_idle_loop。列表按完整模型路径过滤，同名模型（例如两条「克莱妲原皮」）互不继承。其它模型的收藏与旧优菈共享目录都不参与。所有具有 URL 且非空的当前模型收藏进入随机池，取消收藏从池移除；没有有效收藏才回退 `_builtin` 内置待机。收藏时必须带 `model_relative_path`，只写表记录，不复制文件。前端仍禁止修改其他用户资源。收藏不代表任意 PMX 均兼容。

逐动作烘焙标记按用户、asset_id保存于本浏览器localStorage（mmd_vmd_baked_memory_v1前缀），预览或收藏时更新；缺省使用已存记忆，无记录为普通。vmdBakedBoneAnimationByUrl由页面传至舞台并解析URL，运行时bakedBoneAnimationByUrl每次换片重新选择IK/付与和根固定；烘焙动作跳过二次求解，普通动作恢复，不将第一段的模式应用整个池。只在本浏览器持久化，不声称桌宠或跨设备同步。临时预览/聊天结束仍回到最新收藏池。

实际页面核验：当前331收藏中310为空文件，21有效收藏与运行时随机池逐项一致（遗漏0、额外0）；Koleda_CapeRebind.vmd入池，其烘焙记忆刷新后仍为true。已有收藏文件没有为验证而删除或新增。46项聚焦测试、vmd-preview-check及TypeScript通过；完整basic检查在既有Reze initialSettings源码断言失败，未宣称整套检查通过。取消收藏与混合求解的切换已通过测试数据及真实混合器回归，未对用户真实收藏执行取消操作。语义见workflow/concepts/favorite-idle.zh-CN.md。

## 烘焙动作脚部播放修正（2026-09-17）

当前3100已由主工作区web启动；刷新浏览器后采用主工作区代码及8100后端代理。配套453骨Koleda_CapeRebind_Trial与Koleda_CapeRebind.vmd在Classic模式复现：根固定关闭后，默认IK/付与仍会重算已烘焙腿脚。

高级功能新增“预览骨骼求解”，显式选择“已烘焙骨骼（跳过IK与付与）”后下次点击预览生效。bakedBoneAnimation在页面、舞台初始化/更新和循环中传递；播放、普通定位及校准定位/渲染尊重该标记。普通动作及退出VMD恢复IK/付与；跨求解模式禁止淡化混播；同一动作改变模式后点击预览重新播放。缺省仍普通VMD，不按文件名猜测，不改Ammo物理策略。

实际主页面验证：453骨，119帧正序世界位置相对独立无二次求解混合器最大差0；119帧倒序全部世界矩阵16元素最大差0。同机位第15帧等待真实渲染提交后复核旧求解/烘焙模式，旧脚踝弯折可复现，烘焙模式恢复。新增与既有预览/定位16项通过；完整运行时92项75通过17失败，失败名称与原基线一致；TypeScript检查通过。证据摘要见 .scratch/companion-leg-diagnosis-20260916/leg-fix-20260917.md。

只证明此配套资产在无Ammo的Classic播放路径消除二次求解偏差，不证明源碰撞、全子帧、frontline新模型接入或正式发布门禁通过。现有Classic灰色材质及构图裁切不在此项修复范围。

## 主工作区合并状态（2026-09-17）

D:/workspace/MMD project 的 codex/local-interactive-integration 已从 e64733c3 快进至独立动作分支的 641ce2b1。原有未提交修改保留；播放器定位缓存修复与主工作区手动预览解除固定逻辑共存。文档冲突保留双方记录；恢复前的两个重叠文件备份仍在 stash 52aa2fab40ffff222192bbabae1f2f979247f02b，未删除。21项聚焦测试及TypeScript检查通过，未执行完整动作验收。

3100服务尚未切换：停止旧工作树进程的命令被环境策略拦截，未执行。仍需手动停止旧服务，再从主工作区web启动3100；继续使用8000资源API以保留本次预览资源库。旧独立工作树及Git忽略的试播二进制保留，不清理。

## Koleda 头发/披风 VMD 隔离试播（2026-09-16）

后续配套副本验证：`experiments/koleda-vmd-reuse-low-20260916/paired-repair/` 在原PMX副本追加52根披风源骨、仅重绑6483点，原材质/UV/面拓扑/表情及原401骨保持；新PMX+VMD独立回读披风相对源缓存最大0.171mm，真实classic隔离试播52根新骨全部运动。两文件必须配套，不替换生产默认。全帧仍穿插，三档有界骨平移修正未通过，未写入动作；没有新增线上接口或默认播放策略。

- 本票在独立工作树运行 `/mmd-calibration-render` 与真实 `MMDCompanionRuntime`，端口 `3217`；本地 PMX、纹理和 VMD 由 Playwright 精确路由读取，不增加生产接口或发布第三方资源。脚本、分层误差和结果见 `experiments/koleda-vmd-reuse-low-20260916/`。
- 修复普通 `seekVmdFrame`（按帧定位）的缓存顺序：先恢复未施加 IK/Grant 的骨骼缓存，再设置混合器时间、保存目标姿态，最后执行帮助器零步长更新。否则旧缓存会覆盖新定位姿态；只补保存而不先恢复还会重复累加 Grant。两项真实混合器回归测试覆盖这些情况。
- 这份 VMD 已包含完整骨骼烘焙，试播脚本仅在自身浏览器实例清空固定根骨列表、关闭 IK 与 Grant；本次环境未加载 Ammo，不执行物理。上述试播设置不改变生产默认值。默认播放器仍固定根骨并执行原有求解，不能直接声称与 Blender 烘焙等价。
- 原动画长 `235/60` 秒，30 fps 试播 VMD 最后帧 118，长 `118/30` 秒，多 `1/60` 秒；默认帮助器还保留已有的 `1.1` 秒余辉。源缓存→拟合仍有约 72 mm 局部残差和真实网格交叉；产物仅为本地试播稿，动作门禁失败，不得当作发布成品或无损转换。

## 配套披风试播模型本机导入（2026-09-16）

新增本机模型库条目 MMD/Koleda_CapeRebind_Trial/Koleda_CapeRebind.pmx，453骨（含52根RC披风骨），配套VMD同目录。导入仅重写19条贴图路径为相对路径并复制依赖；解析对比确认其它模型数据不变。源PMX及原模型目录未覆盖。原资产的spa目录型球面贴图引用仍保留，不冒充有效图片。

当前8000资源API扫描主工作区MMD目录；3100页面实际由 E:/codexWorktree/a6ef/MMD project/web 提供，不等于主工作区前端代码。页面已选中新条目和Classic，运行时确认453骨及52根RC骨；frontline白名单仍固定原401骨模型，未改。此次仅完成模型导入及加载检查，旧播放器根固定、IK/付与兼容、Classic构图裁切与正式动作验收未解决。

## 手动 VMD 预览解除位置固定（2026-09-16）

/companion 手动预览显式传递 lockRootPosition=false（不固定根位置）、lockLowerBody=false（不固定下半身）及 disableCrossfade=true（不混入上一动作）。页面、MMDStage 后续播放和 applyStageRuntimeState 初始化均保留这些选项；普通播放缺省继续固定根位置，同段循环继承选项。IK、付与和物理求解策略未改。

验证：预览策略12项、运行时聚焦7项通过；真实配套 Koleda PMX/VMD 的10帧隔离对照中，仅根固定导致的最大95.213mm偏差在解除后为0（该对照关闭IK/付与以隔离变量，不等于生产腿部全部正常）。完整运行时92项75通过17失败，失败涉及既有材质、相机和模型测试；尚未完成用户浏览器实际预览的视觉验收。诊断脚本与数据在 .scratch/companion-leg-diagnosis-20260916/。不应以这项修正宣称全骨烘焙动作与默认IK/付与兼容。

## V14D game 桌宠本机接入（2026-09-09）

后续只读复验：独立 Electron 外壳加载现有 pet App 和真实主 8100，当前六个待机 VMD 全部成功解析并推进动画时间，外观保持 ready；页面、HTTP、WebGL 错误均0。上轮隔离库旧动作 ID 的404不适用于当前主目录。证据见 web/.scratch/pet-v14d-followup/playback-report.json；不外推为完整动作库或音频口型同步验收。

- 桌宠继续复用 MMDStage 与 MMDCompanionRuntime，不复制材质、六灯、OCIO、动作或口型循环。已确认的游戏参考外观公式与默认值不变。
- App 等待主进程 runtimeInfo() 返回后才读取共享配置；通过 assetApiBaseUrl 把运行时 API 地址传给共享舞台。清单、模型、材质、遮罩、OCIO 和相对动作 URL 使用同一地址；网页省略该参数时继续沿用原构建配置。
- v14d-game 从白名单清单构造模型目录，不依赖普通 MMD 根目录中存在目录联接。清单不可用或所选模型与清单身份不符时明确拒绝；classic 仍使用普通模型列表。入口沿用主站选择模式后，桌宠右键“同步主站”的共享配置流程。
- 桌宠传入外观保存用户身份。微调栏跨容器渲染到拖动接收层上方，默认收起为左上角小按钮；data-pet-interactive 标记从文档级拖动捕获中排除。参数按用户和模型保存在桌宠自己的 localStorage，不自动同步浏览器内已保存的微调值；默认值与网页一致。加载期间或失败时状态可见，就绪后收起状态提示。
- 本机 Electron 正式构建验证使用独立 API 8117、临时数据库与独立桌宠用户目录。真实资源加载、曝光修改/重载持久化/恢复默认、滑杆不拖动窗口已验证；切回测试必须同时确认模型加载未失败，不能只用画布存在像素判断。53 项桌宠聚焦测试、10 项共享外观测试以及 pet 类型检查和构建通过。执行期间发现主 8100/3142 已停止，随后按原项目入口恢复，未修改其业务配置；3100 未重启。最终证据与范围见 docs/handoff/2026-09-09-v14d-game-pet.md。
- 不扩展为跨机器资源发布许可结论；未验收多显示器 DPI、完整动作库、长时运行或性能收益。既有会话发现 422 提示与旧材质资源警告不属于本次渲染迁移修复范围。

## Companion 加载性能修正

聊天历史由工作线程通过独立只读SQLite快照读取，关联TTS/动作数据按批补全；新增复合索引，保留全部历史与原过滤规则。V14D资源清单与SHA按文件元数据缓存，文件URL以v=SHA256区分版本，固定版本可缓存、旧版本不匹配返回409，客户端仍验证字节。实际3100冷加载约14–16秒、复载约3.4–6秒，已消除8100被聊天历史长时间阻塞导致的灰色加载态。见docs/handoff/companion-loading-performance.md与workflow/concepts/v14d-resource-cache.zh-CN.md；渲染配方不变。

## 2026-09-08：V14D 游戏参考舞台实际外观迁移

本机模型根目录可用V14D_GAME_MODEL_ROOT单独配置，默认仍沿用MMD_ROOT_DIR；不会改变其他模式的模型库。主目录当前本机配置指向D:/mmd，OCIO与mask缓存位于web/.scratch/v14d-head-preview。

主会话接管并修复灰块交付。当前v14d-game通过v14dGameMaterials选择性复用cd973980冻结预览的材质工厂/头发分区/五张脸部遮罩，创建实际物理材质，并在共享MMD渲染循环中进行异常安全表情覆盖。六灯按源power和模型缩放/平移映射；本机OCIO只作用于角色画布，星空由现有CSS背景显示。舞台右上角增加外观微调，参数按用户与模型存本机，支持恢复截图默认。旧类型保留。

资源路由新增material-source及五mask白名单，模型与资源字节核验SHA256；prepare-v14d-game-local-assets.mjs准备Git忽略缓存，第三方LUT不入public/发布包。API、网页默认参数与本地保存职责分开。实际舞台、VMD、遮罩切换、参数保存、相机、切回释放及缺mask负测通过，生产构建通过；这是本机工程接入，不是游戏视觉等价、登录联调或长期物理证书。详情docs/handoff/2026-09-08-v14d-game-migration-repair.md；下方较早的准备态和ec23资源挂载说明为历史检查点。

更新时间：2026-09-08

验收环境适配：`accept-reze-k3-v1-stage.mjs` 使用 `V14D_CAPTURE_API_ORIGIN`（验收后端来源，默认8000）精确匹配直接后端请求，主验收页面与默认入口页面共用；主服务3100的前端配置为8100时显式传8100，不改生产API或服务。`--entry-only`（入口回放）先检查导入、画布就绪和六槽开关/绑定，失败即停止，不继续G2–G7；105秒内部预算、120秒外层硬限。入口结果与完整回放分开，API/会话存根加真实本地模型字节不代表真实后端已修复。

### Stage 2C-M2a 阶段验收通过：六槽已合并

主会话代码与运行证据验收通过（2026-09-05），六槽已合并。材质阶段验收6/15、已合并6/15（Face、BodySkin、HairA、HairB、Brows、Lashes），其余9槽尚未迁移。合并证据：主会话于2026-09-05在 `D:/workspace/MMD project` 的 `codex/local-interactive-integration` 实际快进合并至 `8267dfb5ae680db0ff5754ae537563422626163b`。2026-09-05执行任务已用原工作树Playwright依赖连接主服务3100，在显式配置验收后端来源8100的受控存根环境完成入口与完整G1–G7，原生退出码0、未超时（完整897.5秒，900秒硬限）。报告见 `web/.scratch/api-origin-20260905/full8100/gate-report.json` 与 `native-exit.json`；主服务提供实际页面和渲染代码，但API/会话为存根、模型为真实本地字节，不证明真实后端、真实登录会话或主目录全部依赖已验证。测试浏览器已关闭，主3100服务保留；这不是已为用户打开并保持的真实登录预览。

验证来源：主会话复跑59项聚焦测试（58通过、1允许跳过）、patch verify 93/93、固定点差异检查和禁止文件范围检查；交叉复核执行任务实际运行的健康、首次异常、中途异常及完整报告、full-native-exit.json、完整日志、构建日志和主舞台及开眼截图。完整 G1–G7 由执行任务运行，原生退出码0且未超时；两处异常原生退出码1且恢复成功。主会话本轮未重复运行完整验收。

范围边界：HairA/HairB仅基础色（BaseColor）迁移，高光及其他头发着色仍待决；浏览器验收使用API/会话/资源列表存根环境，真实本地模型与生产 /companion 渲染链已验证，不等于真实后端联调通过。用户可见V1说明已更新为六槽与剩余9槽，并明确头发仅基础色、高光待决；本次只更新显示文案，不改按钮标识、枚举、资格逻辑或渲染行为。

当前 G7 每态分别保存 request/runtime/effective/GPU 权重；GPU 数值来自已有生产源快照的 `morphWeightsBuffer` COPY_SRC 读回，而非 CPU effective。open 在改 closed 前完成所有证据副本；无隔离控制只消费自己的副本。

G7 改机位前保存真实位置、目标和视场角；显式验收探针在 finally 应用原参数并同步 着色器统一参数（uniforms），健康、首次 noIsolation 采集抛错、中途抛错都验证非默认相机恢复。噪声仅取独立 open/openRepeat 健康采集；wrongName/noSwitch 共用正式移动判定，证据非法不能算预期拒绝。生产源审计逐态检查 captureId/frame、缓冲身份、有限读回与 绘制索引范围（draw range），不接受非空字符串证明。实现不改变生产锁、材质公式或场景默认值。详见 `workflow/concepts/v14d-brows-lashes-identity-tint.zh-CN.md`。

本文用于两类场景：

1. 自己快速理解当前项目全景、服务边界和调用关系。
2. 把必要背景交给 OpenClaw、TTS、前端或渲染相关服务做优化时，让对方能先理解上下游约束。

本文只描述当前运行形态，不描述理想重构方案。令牌、密钥等敏感值不写入本文。

## 1. 一句话概览

当前项目是一个浏览器端 MMD 虚拟陪伴系统。前端由 Next.js 承载，后端由 FastAPI 负责会话、资源、OpenClaw 调用、TTS 调用、Codex 交互入口和 trace 记录。文本能力来自 OpenClaw Gateway，语音能力来自独立的 Voice Workflow TTS 服务，工程任务入口来自本地 Codex interactive provider，MMD/PMX/VMD 资源来自本地 `MMD_ROOT_DIR`。

```text
Browser / Next.js UI
  -> Next.js backend proxy /api/backend/*
    -> FastAPI API
      -> OpenClaw Gateway HTTP
      -> OpenClaw Gateway WebSocket RPC
      -> OpenClaw Control Plane HTTP
      -> Voice Workflow TTS
      -> Codex Interactive Provider (disabled by default)
      -> SQLite + NDJSON
      -> Local MMD/VMD files
```

## 1.1 Reze Design WebGPU 舞台分支

`/companion` 的 `renderPipeline=reze-design` 与 `reze-k3` 共用独立的 WebGPU 分支：`web/src/features/stage/RezeWebGpuStage.tsx` 使用 MIT 许可的 `reze-engine@0.26.0`，按 `Engine.init() -> loadModel() -> autoStyleGroups() -> runRenderLoop()` 加载并渲染 PMX；VMD 预览调用模型的 `loadVmd()`、`show()` 和 `play()`。每次 VMD 请求均有递增版本号，只有最新请求完成后才能写入模型，故初始待机或较早预览的异步加载不得覆盖用户刚点击的预览；重复点击同一收藏动作也会生成新请求并从头播放。对于已有姿势上的局部骨骼 VMD，运行时直接切换内部动画状态而不调用会清空所有骨骼的 `Model.show()/play()`，防止缺少轨道的骨骼退回 PMX 绑定 T 姿势。WebGPU 分支须把 `vmdUrl`、`vmdLoopUrls` 和 `standbyVmdUrl` 全部绝对化到 API 地址；不能只绝对化首段动作而让循环段请求前端 `/assets/...` 并 404。引擎 `animationState.setOnEnd()` 的 VMD 结束事件会回传 `CompanionPage` 动作状态机；同时按剪辑时长设置兜底完成计时，防止引擎对异常剪辑漏发结束事件。仅含 VMD 文件头且无骨骼/形态帧的 64 字节空 VMD 不得进入预览、点击或待机候选池；手动选择时必须明确提示不可预览。有效单次手动、聊天或点击动作结束后重新选择收藏待机循环；没有可用待机动作时才回退程序化待机。该分支不复制或嵌入 AGPL-3.0 的参考编辑器源码。

名称或路径包含“克莱妲”或 `Koleda` 的模型启用角色默认外观：Three.js 与 Reze WebGPU 两条舞台分支都会隐藏名称命中 `mask`、`face mask`、`mouth mask`、`口罩` 或 `面具` 的材质，并优先把名称同时命中 eye/眼/目 与 close/闭 的 Morph 设置为闭眼；若模型没有明确闭眼 Morph，才退回 blink Morph。Reze WebGPU 会在每次 `model.update()` 完成 VMD Morph 采样后重新写入闭眼 Morph，防止 `まばたき` 被 VMD 帧重置为睁眼；这等效关闭默认眨眼。对该角色的 Reze WebGPU 分支，名称命中 body/face/skin/肌/脸/顔 的材质通过 `cloth_smooth` 分组使用柔滑布料图。该规则仅是加载后的默认外观，不修改 PMX/VMD 磁盘文件；播放动作可按其自身关键帧覆盖其它表情，但单次动作收尾复原时必须重新应用默认外观。

```text
Companion Reze Design
  -> MMDStage interface facade
    -> RezeWebGpuStage
      -> reze-engine (WebGPU: PMX / VMD / IK / physics / WGSL style groups)
      -> 原生背景色 + Shining Stars WGSL 背景效果
```

`reze-npr`、`classic` 等模式仍由 `MMDCompanionRuntime`（Three.js/WebGL）处理。两条路径的骨骼、Grant 付与求解器、点击、口型和物理实现不能视为等价：WebGPU 舞台使用 reze-engine 自己的 IK/物理，未验证功能不得跨分支承诺。浏览器无 WebGPU 或当前 PMX/VMD 无法被引擎解析时，舞台必须显示错误，用户需手动切换 `reze-npr` 恢复既有兼容路径；不得静默降级并继续显示为 WebGPU。

### 1.1.1 `v14d-game` 第一纵向切片（本机外观接入）

`render_pipeline=v14d-game` 走共享 Three.js/WebGL 舞台，不进入 Reze WebGPU 分支：

```text
CompanionPage 选择/保存 v14d-game
  -> MMDStage
    -> MMDCompanionRuntime
      -> MMDLoader + MMDAnimationHelper
      -> v14dGameAppearanceAdapter (install / release / status)
      -> Three.js/WebGL
```

`v14d-game` 现在使用可安装/释放的 `v14dGameAppearanceAdapter`，并由独立 FastAPI 资产路由提供本机白名单资源。`/assets/v14d-game/manifest` 只登记以下固定身份：

- 模型：`D:\mmd\克莱妲原皮\GirlsFrontline KoledaDefault.pmx`；模型和资源依赖必须命中明确的 `Textures`、`normalmap` 或 `spa` 子目录，路径穿越、未登记键和缺失文件均明确失败，不静默回退 builtin。
- 外观资源：当前模型材质上的 normal/RMO 资源与头发高光资源由适配器安装；安装前保留 PMX 材质状态，释放或切回旧管线时恢复材质、节点和纹理所有权。适配器只接受名称明确包含 `Koleda`/“克莱妲”的模型。
- 灯光：源清单的六盏 `AREA` 灯转换为共享舞台中的 `RectAreaLight`，按源模型缩放 `0.08` 与当前模型 fit 缩放映射位置、尺寸和功率；背景灯放到独立 layer。
- 显示：本机 `processor.json`、GLSL 和两个 3D LUT 通过清单 SHA-256 校验后进入独立 OCIO 显示链。OCIO 身份为 `2.5.0 / AgX - Medium High Contrast / sRGB`；再分发许可未确认，资源只允许本机隔离预览，不能复制到 `public` 或发布包。

真实模型仍由共享 `MMDCompanionRuntime` 的 MMDLoader、MMDAnimationHelper、VMD 播放、口型、物理、自由相机和动作生命周期承担；`v14d-game` 没有独立播放循环，也不把静态参考姿态写入骨骼基线。`clearModel()`/`dispose()` 会释放适配器、六灯、OCIO 显示链和模型；切回 `classic` 等旧管线重新建立旧舞台配置，不修改旧类型。

`V14D_GAME_DEFAULT_SETTINGS` 仅保留截图默认值和下一阶段 settings 接口（`game/ocio`、曝光 `-0.40`、织纹 `2`、纵向细线 `1`、reference 闭眼、smile `0.55`、虹膜 `2`、自动脸部 `true`、手动 mask `2`、六灯开关等），不宣称这些完整微调参数已经全部应用到当前显示路径。当前仍未完成：五个 mask 的显示合成、背景显示后合成隔离、完整 UI/持久化、材质公式和面部/头发视觉对齐、许可确认、真实后端/登录会话联调以及完整验收截图/GIF。

2026-09-08 的本机纵向验证使用 `node web/.scratch/v14d-game-appearance/verify-runtime.cjs`，在独立 `3145` 资产服务和 `8115` VMD 测试服务上完成：真实 Koleda PMX 进入 `ready`，13 项材质资源实际绑定，六灯实际存在，本机 OCIO `2.5.0 / AgX - Medium High Contrast / sRGB` 的 processor、shader、37³/57³ LUT 均返回并执行；真实 `koleda-v14d-authoritative-pose-f120.vmd` 播放约 5.1 秒且共享动作时间推进，自由相机快照发生变化。切回 `classic` 后，适配器、六灯和本机 OCIO 均释放，旧 runtime 仍可加载模型并推进同一 VMD；将 OCIO processor 标记为缺失时页面明确拒绝外观且不创建 runtime。证据保存在忽略目录 `web/.scratch/v14d-game-appearance/verify-report.json` 及三张截图中。该验证使用的是独立本机服务/存根，不等价于主后端、登录会话或生产资产服务联调。

本次真实加载还观察到 PMX 依赖请求 `model/spa/` 和 `model/textures/extra.png` 返回 404；当前共享舞台仍能进入 `ready`，但这只能说明当前适配器显示路径可运行，不能证明 PMX 引用资源已完整闭合。该缺口、Three.js 既有材质属性警告和许可未确认均保留为发布前风险，不通过静默 builtin 或旧渲染回退掩盖。

Reze WebGPU 播放 VMD 前会额外读取文件尾部的显示/IK 帧。`reze-engine@0.26.0` 自身只把骨骼帧和 Morph 帧装入动画剪辑，且默认在每次应用 VMD FK 后运行全局 IK；如果忽略 VMD 中“关闭足 IK”的状态，PMX 足 IK 会覆盖腿、膝和足首轨道，使完整 FK 动作表现为下半身锁定。当前前端只有在 VMD 中至少出现足 IK 条目、且文件内全部 IK 条目始终关闭时，才在该剪辑播放期间调用 `Engine.setIKEnabled(false)`；没有 IK 条目、包含开启条目或中途切换状态时保持舞台默认 IK，避免 Reze 的全局开关误伤其它 IK 链。单次动作完成、退出 VMD 模式或切换到不要求关闭 IK 的剪辑时必须恢复引擎初始 IK 状态。解析结果按 VMD URL 缓存，循环动作不得重复下载整份文件。

WebGPU 场景调试直接写入 engine 的 world、sun、bloom、ground、background、camera 和 color grading；材质预设映射至 WGSL style group。`reze-design` 的默认场景以 `D:\workspace\reze-design\reze-design\lib\default-scene.ts` 为参数参照：世界光 `#ed6aff/0.66`、太阳 `#ffffff/2.0/205°/21°`、Bloom `threshold=0.5/knee=0.5/radius=4/intensity=0.05/#ffc9c9`、背景 `#4b004f + Shining Stars`、地面 `#c800de/160/0.42/#fafaf9/grid=true`、相机 `26.2/[0,11.4,0]`。调色预设采用参考工程 `content/grades.json` 的中性、血色、赛博朋克、神圣、月光和樱色 ASC CDL 数值，并以 0–1 强度实时写入 `engine.setColorGrading()`；它不是只变更界面文本或 CSS 滤镜。Shining Stars 以本项目独立 WGSL 实现写入 reze-engine，不复制参考工程 AGPL 编辑器源码。当前单项透明度、发光强度尚无引擎公开 API 映射，前端禁用这两项而不制造虚假的视觉结果。PNG 导出包含 WebGPU 内的背景和星空，不包含页面其它 CSS 装饰。

Reze 资产页还支持本地 PMX 目录导入。前端只接受一个目录中的单一 PMX 以及全部贴图文件，生成浏览器内存中的 `File[]`，经 `MMDStage` 传给 `RezeWebGpuStage`，最终调用 `engine.loadModel("companion", { files, pmxFile })`。该路径让引擎使用文件映射解析 PMX 的相对贴图路径，不向 FastAPI 上传模型，不改变用户的主站模型选择或 desktop-pet 共享配置；刷新页面后文件集会丢失。

`reze-design` 与 `reze-npr` 共用左侧主导航的“工具 / 立方体”入口。点击时主站关闭普通高级功能面板，打开贴左侧、完整视口高度的 Reze 编辑器 Dock，首屏展示场景调试；Dock 内可切换“材质”和“场景”。Dock 外壳固定为视口高度，内容主体独立纵向滚动，不能让长材质列表或场景控制项逃出外壳并被裁切。前者在 WebGPU 路径中操作 WGSL style group、在 NPR 路径中操作 Three.js 材质实例；后者分别调用对应运行时的灯光、泛光、地面和相机调节 API。两条管线的场景文档必须按“用户 + 模型路径 + 渲染管线”独立保存，且打开编辑器时只能把当前管线自己的相机默认值写入运行时：Reze Design 的相机目标 Y 为 `11.4`，而 Reze NPR 的目标 Y 为 `1.05`。不能跨管线复用这些值，否则编辑器同步会将 NPR 角色移出相机视锥。该入口不能用于其它渲染模式，避免把 Reze 专属控制错误应用到普通 MMD 呈现。

`reze-design` 使用不透明的原生 `#4b004f + Shining Stars` 画布，与参考工程默认场景一致；`reze-npr` 仍保持透明 canvas 并与页面 `MioModeBackground` 合成。后者的 Three.js 后处理链在 `RenderPass` 中显式清为 alpha `0`，调色着色器保留输入 alpha。`three-stdlib` 的 `UnrealBloomPass` 会在最终合成前以不透明基础材质回填画面，不能用于 `background: null` 的透明舞台；NPR 透明模式保留调色和轮廓，跳过该泛光通道，避免打开编辑器或重排画布时将 MIO 背景覆盖成黑色。

Stage 2B-M1（`codex/v14d-face-state2-runtime`，2026-08-31）把 finalFaceComposite 从“整张预烘焙脸图替换”升级为 Web 实时 State 2 合成：仅对 PMX 材质名 `Face`，经 patch-reze-engine.mjs 注入默认关闭的 materialAuxTextures + bind group binding(5) mask（rgba8unorm、禁 mipmap、非 sRGB 视图）+ `V14D_STATE2_HELPERS_WGSL` + `v14dState2OverrideFsBodyFixed`，按 graph.name 精确覆写 final_color，从原始 face_d（sRGB→linear）+ State2 packed mask（Non-Color）+ 节点常量在线性空间实时计算 warm/art/fringe（公式见 forensic-manifest 与概念文档）。faceShadowOnly/finalFaceComposite 走实时 graph，normal/uvDebug 保持既有单纹理/UV 输出；其余材质保持正常 reze-k3。诊断开关默认关闭，默认生产 Filmic/reze-k3 不泄漏新纹理或旁路。bakedGolden 黄金帧烘焙标记为失败实验/内部诊断、默认不选中。概念登记见 workflow/concepts/v14d-face-state2-live-composite.zh-CN.md。 修正轮（2026-09-01）修复三个已证实断点：断点 A（旧 override 用分号在注释后的切片标记，真实编译器分号在注释前导致原样返回）、断点 B（applyStyleGroups 重绑丢失 binding(5) aux mask）、断点 C（assembleModule 把 state2 WGSL helper 插在 prelude 的 fn fs 开头之后，函数嵌套触发 expected } for function body，Face graph 应用失败静默回退到原管线）。修复：v14dState2OverrideFsBodyFixed 健壮行匹配、__auxMaskView 并入 baseBindGroupEntries（binding 5）、helper 移到 prelude 之前注入；patch --verify 升至 56 项不变量。实时管线结构生效已证实（faceApplied=true、三模式 HDR 互异、用户路径 USER-PATH-OK），但完整 Face Gate MAE 仍未达标（UV/通道口径根因待下一张票据）。

Stage 2B-M2（`codex/v14d-face-uv-visibility-gate`，2026-09-01）解决 2B-M1 整屏 PNG 无 Face ID/UV、直接套 Web Face mask 导致 Blender/Web 不可比的问题，建立固定 frame120/State2/Blend0 下「同 UV、同三角形、同可见性」的三层离线对账。新增三个聚焦脚本（均默认关闭诊断路径）：`web/scripts/blender-face-uv-visibility.py` 从权威 .blend 经 raycast 导出 Face 三角形 loop UV 集合（2738 三角形）与 triId/UV/深度图；`web/scripts/export-face-tri-uv.mjs` 在同一次页面加载内导出 Web 侧 Face 前景 UV pass（两段式：pass1 全材质 depth-only，pass2 仅 Face 材质 equal 深度测试输出插值 UV，剔除刘海遮挡）与三模式 pre-tonemap HDR（线性）；`web/scripts/gate-v14d-face-uv-visibility.mjs` 离线 Gate，正式样本为「Web UV 前景 pass ∩ HDR 材质 pick」双方都判 Face 且 UV 落在某 Blender Face 三角形内的像素，参考色用同一 UV 直采 face_d（sRGB→linear）与 State2 mask（Non-Color）按权威公式合成。实测该 UV 交集样本 938 像素三层每通道 MAE 均 ≤20/255（BaseColor [11.29,12.17,11.83]、ShadowFactor [13.23,15.28,13.82]、FinalComposite [15.16,13.84,11.70]），但该样本集仅证明 UV 直采参考与 Web 在这些像素一致，不构成同三角形/同可见性 Gate 通过。错 UV 负测（u→u+0.5 大偏移采到发/体区）MAE [172,123,112]、错三角形负测（UV 质心距离>0.25 的远三角形）MAE [128,115,105]，判别力 >7×。重要边界：正式样本仅覆盖脸部可见皮肤窄条（HDR 材质 pick 口径），UV pass 的完整 Face 前景（18538px，含刘海/发绺几何）对账 FinalComposite MAE 高达 [193,106,93]，因为刘海/发绺虽是 Face 材质但用独立发色纹理、不适用 face_d 直采参考——故同口径只能圈定在「应用 face_d 纹理的脸部皮肤」。诊断钩子（exportFaceTriUv/readV14dFaceTriUvMask）默认关闭，VMD runtime probe 证实默认生产入口零泄漏、play/pause/seek 正常。详见交付报告 `docs/handoff/2026-09-01-v14d-face-uv-visibility-gate.md`。【验收修正轮 2026-09-01 最终结论｜同 UV/同三角形材质公式已通过，同可见性被姿态差阻塞】本轮在路线 B+（真实三角形身份，不走屏幕像素配准）下完成最后一次有证据的单变量重试，落实三项关键修复并定位两个独立根因。修复 1（Web 真实 triId）：v14dColorBaseline.ts 新增 readV14dFaceExpandedTriUv，把 Face 索引按 PMX 顺序展开为非索引缓冲并附 flat triId（= PMX/Blender Face 局部序号，2738/2738 sortedVerts 同序已验证），vertex_index/3 语义可靠；triUv pass 与 HDR pick 改在同一 page.evaluate 原子采集（消除分次 evaluate 的 ~32px 位移，overlap 4092/4639）。修复 2（三模式 HDR 采集）：发现运行时点击 setFaceStaticMode 切模式不会重建 Face graph（faceShadowOnly 与 finalFaceComposite HDR 逐像素相同 maxd=0），改为逐模式 page.goto 重建，三模式 HDR 这才真正区分。修复 3（Blender 可见性）：blender-face-uv-visibility.py 新增 CPU 光栅化 z-test 输出 visibleTri（30836 可见像素）。结果：同 UV/同三角形样本（triIdResolved∩barycentricValid=4092，formal/webEligible=0.882，覆盖 517 个 Face 三角形）三层每通道 MAE 全部 ≤20/255——BaseColor [12.69,10.75,10.89]、ShadowFactor [6.44,6.97,6.93]、FinalComposite [11.94,9.23,9.12]，材质公式本身验证通过。但正式同表面点可见性判据失败（blenderSamePointVisible=0/4092，全部 rejectedVisOther）：根因是 Web 与 Blender 在 frame120 存在系统性姿态差（Web 头前倾更大，Blender 脸 Y≈-0.115m vs Web≈1.35m，同一 PMX 三角形 3D 位置差约 0.16m），同一重心在 Blender world triangle 上的"同表面点"数学上就不是 Web 的同一表面点。这属独立的 VMD/姿态同步 failure family，超出本票材质公式范围，诚实交付 partial-coverage checkpoint（正式 Gate exit 1，verdict=partial-coverage）。负测判别力已验证：tri-permute 使 barycentricValid 4092→1、vis-occlude 改可见性，两负测均 exit 1。npm run build 通过（patch verify 58 项 OK）、gate-v14d-reze-patch-runtime-completeness exit 0、probe-v14d-vmd-runtime exit 0（load→play→pause→seek 正常）；probe-v14d-face-default exit 1 为 headed 浏览器资产注入时序 flake（headless 对照 faceStatic=false 正常），非本票回归。

## 2. 服务清单

| 服务 | 当前地址/位置 | 主要职责 | 当前状态 | 健康检查/验证 |
| --- | --- | --- | --- | --- |
| Next.js Web | `web/`；开发默认 `http://localhost:3000`，发布栈默认 `http://127.0.0.1:3200` | UI、MMD 舞台、Chatbox、设置面板、trace 页面、runtime health 页面；发布栈使用 `.next-codex-release` 的 production server | 本项目内 | 开发页面访问；发布栈 `GET /`、状态文件和 Web PID |
| Next.js API Proxy | `/api/backend/*` | 浏览器同源转发到 FastAPI | 本项目内 | 前端请求是否 2xx |
| FastAPI API | `api/`, 默认 `http://127.0.0.1:8000`；dev-stack 默认 `http://127.0.0.1:8100`；发布栈默认 `http://127.0.0.1:8200` | 会话、消息、OpenClaw/TTS 代理、realtime voice WebSocket、资源、trace、admin API；默认只面向本机 loopback | 本项目内 | `GET /healthz`、`GET /admin/runtime-health`；发布栈启动前做 `app.main:app` 入口检查 |
| Release Stack Controller | `start-release.ps1` / `scripts/release-stack.ps1` | Windows 优先编排 API、Web production server 和 Electron production runtime；保存 PID/端口/日志/产物状态，并按当前包身份证明安全复用、停止和清理 | 本项目内 | `-Action build/start/status/stop/kill`；`.runtime/release-stack.json` |
| Electron desktop-pet | `desktop-pet/`；发布栈由 `dist-electron/main.js` 启动 | 透明 Pet 窗口、菜单、通知、Codex/Claude session 状态；发布模式通过 `MMD_PET_RELEASE=1` 禁用 Vite URL，加载 `dist/index.html`、`dist/menu.html`、`dist/notification.html` | 本项目内 | Pet PID、renderer 文件存在性、`pet-ready.json` 的 `file://` URL 和 renderer shell ready |
| OpenClaw Gateway HTTP | `http://10.11.252.164:18789` | `/v1/models`、`/v1/responses` 文本生成 | 外部服务 | `GET /healthz/openclaw` |
| OpenClaw Gateway WebSocket RPC | `ws://10.11.252.164:18789` | Feishu session 列表、history、实时消息订阅、agent/chat delta 事件 | 外部服务 | Bridge admin 状态、`sessions.list` |
| OpenClaw Control Plane HTTP | `http://10.11.252.164:8765` | v1 Codex daily review，以及 v2 Project Knowledge candidate、review command、exact publish payload、publication receipt | 外部服务 | OpenClaw run 状态、FastAPI durable cursor/change-set/receipt ledger |
| Voice Workflow TTS | `http://10.11.252.164:5555` | 提交 TTS、查询任务、返回音频 URL | 外部服务 | `POST /api/v1/tts` + `GET /api/v1/tasks/{task_id}` |
| Codex Interactive | FastAPI 内 `CodexInteractiveProvider`，目标进程为 `codex app-server --listen stdio://` | 产品内 Codex Console、只读/patch 多轮事件流、worktree diff、approval、checks、apply | 本项目内，默认关闭 | `GET /admin/runtime-health` 的 `codex` 字段 |
| Codex Review Sync | FastAPI `codex_openclaw_review_sync` worker + OpenClaw `/v1/responses` | 把 desktop-pet 管理的 Codex 会话 evidence pack 提交给 OpenClaw，回写 draft 工作总结/踩坑/决策/followup | 本项目内，默认关闭 | `codex_openclaw_sync_outbox` 与 `codex_review_items` |
| Codex Knowledge Extraction | FastAPI `codex_knowledge_extraction` worker + OpenClaw `/v1/responses` + `openclaw/skills/codex-session-knowledge-extraction` | 对可复盘 Codex 会话做信号评分，调用 OpenClaw skill 产出零到三个可读 Wiki 候选；候选包含 `memory_draft`、质量 Gate、发布状态以及可反向索引脚本/测试/命令/文件/符号的 `code_refs -> code_index` | 本项目内，默认关闭 | `codex_knowledge_extraction_outbox` 与 `codex_session_knowledge` |
| Codex Review Control Plane Sync | FastAPI `openclaw_control_plane` worker + OpenClaw control-plane `/v1/apps/mmd/codex-review/*` | 把本地 daily summary/draft snapshot 主动推给 OpenClaw review run，轮询审核命令并回推命令结果 | 本项目内，默认关闭 | OpenClaw `codex-review-daily:YYYY-MM-DD` run 从 `awaiting_snapshot` 进入后续状态；FastAPI `last_codex_review_control_plane_commands` |
| Project Domain Knowledge v2 Control Plane | FastAPI `domain_knowledge_control_plane` + OpenClaw `/v1/apps/mmd/project-knowledge/*` | durable candidate push、双重审核命令应用、exact Accepted Wiki Change Set 回推、publication receipt 落账 | 本项目内，`DOMAIN_KNOWLEDGE_CONTROL_PLANE_ENABLED=false` | `domain_knowledge_candidate_deliveries`、durable run cursors、change sets、receipts |
| Codex Review Memory / OpenClaw Wiki | FastAPI review APIs/outbound worker + OpenClaw `memory-wiki` | 用户确认 draft 后把候选摘要转成结构化、可执行的长期 knowledge memory；FastAPI 主动把确认后的 Obsidian 页面 payload 推给 OpenClaw | 本项目内；OpenClaw wiki 发布在 OpenClaw 侧执行 | `codex_review_memory`、`codex_review_memory_versions`、OpenClaw review run 状态 |
| SQLite | `api/data/sqlite/trace.db` | 会话、消息、TTS、Bridge、trace、资源索引 | 本地数据 | API 查询和测试 |
| NDJSON logs | `api/data/logs/*.ndjson` | trace 双写日志 | 本地数据 | 直接查日志 |
| MMD assets | `MMD_ROOT_DIR=./MMD` | PMX/PMD 模型、贴图、VMD 动作资源；开源仓库只保留 `MMD/README.md`，第三方模型、贴图、动作、音频作为本地未跟踪资源放置 | 本地文件 | `GET /assets/mmd/models` |

## 2.0.1 便携 Release 包服务

便携发布由 start-mmd.ps1 统一入口负责。源码根目录的 package 动作先检查 Python/API 入口、Web 和 desktop-pet 的 Node 依赖，默认调用现有 Release build，再在 release/mmd-portable-<version>-<timestamp>/ 生成包目录和同名 ZIP；latest.json 记录最近包目录，便于源码根目录的 status/stop 找回实际运行包。

包内布局只保留运行所需文件：api/app、api/requirements.txt 和 api/.env.example；web/.next-codex-release、web/scripts/run-next.mjs、web/next.config.mjs 与 web/node_modules；desktop-pet/dist、desktop-pet/dist-electron、desktop-pet/package.json 与 desktop-pet/node_modules；以及存在时的 MMD 和 MMD_stage。本地源码 .git、.runtime 历史、api/data 用户数据库、无效 trace.db、测试临时文件和 debug event 历史均不进入包。包内 manifest.json 记录版本、源提交、布局、运行时前置条件、排除项和资源权利提示。

包内 start-mmd.ps1 检测 manifest.json 后只调用包内 scripts/release-stack.ps1；API、Web、Pet 的状态文件、日志、Pet ready marker 和默认回退数据目录都位于包内 .runtime/。显式 ApiDataDir/API_DATA_DIR 严格使用，未显式设置时无效 api/data SQLite 才回退到包内 .runtime/release-stack/data。Python 解释器和 API Python 依赖没有封装，当前发布物是便携源码包/Node 运行时包，不是安装器；MMD 模型、贴图、动作和音频的复制不改变第三方再分发许可。

## 2.1 Windows release 三端生命周期

仓库根目录的 `start-release.ps1` 是发布栈入口，`start-release.cmd` 仅提供 CMD 包装。`start` 默认先执行 API 入口检查、Web production build 和 desktop-pet build，再按 API → Web → Pet 的顺序逐个对账、启动或复用并等待：

```text
start-release.ps1
  -> API: python -m uvicorn app.main:app --app-dir <package>/api --host <ApiHost> --port <ApiPort>
  -> Web: node web/scripts/run-next.mjs start -p <WebPort> -H <WebHost>
  -> Pet: electron.exe . + MMD_PET_RELEASE=1
```

Web build 和 Pet build 均接收同一个 `NEXT_PUBLIC_API_BASE_URL`/`MMD_PET_API_BASE_URL`；因此 API 地址不是只适用于开发端口的硬编码。Web 运行时仍通过 `NEXT_DIST_DIR=.next-codex-release` 使用 Next production server，不启动 `next dev`。

发布栈的状态文件 `.runtime/release-stack.json` 记录三端根 PID、端口、工作目录、命令身份、包根路径、身份标记、进程启动时间、stdout/stderr、Web 产物目录、Pet renderer 文件和批次 ready marker。`start` 对 API、Web、Pet 独立判断：状态记录中的进程仍在运行、命令身份匹配且健康检查通过时标记 `reused`；缺失、不健康或身份不匹配时只启动该组件。状态文件缺失或只记录部分组件时，API/Web 可通过当前包路径标记、命令身份、监听端口 owner 的父进程树恢复，Pet 可通过当前包 Electron 根进程与包内 renderer ready marker 恢复；无法证明归属或端口属于其它包/其它命令时保留进程并报告冲突。`stop` 与 `kill` 都先验证当前包归属，再递归处理 API/Node/Electron 的受控子进程；`kill` 还可在状态缺失时执行同样的严格发现，并只删除当前包的状态/ready 文件。任何路径都不按端口、进程名或 PID 泛杀，批次日志、构建产物和 API 数据保留。

Pet production runtime 的路径由 `desktop-pet/electron/rendererPaths.ts` 统一计算：编译后的 `dist-electron` 旁边的 `../dist` 是默认 renderer 根目录；`main.ts` 在 release mode 下用 `BrowserWindow.loadFile()` 加载三个 HTML 入口。Vite production `base` 为 `./`，确保 `file://` 页面把 JS/CSS 解析到同一 `dist/assets` 目录，而不是错误请求磁盘根路径。

Pet renderer 的 Vite 构建还会通过 `@` 别名直接复用 `web/src` 的舞台和共享组件。由于 `desktop-pet` 与 `web` 各自拥有独立的 `node_modules`，`desktop-pet/vite.config.ts` 必须用 `resolve.dedupe: ["react", "react-dom"]` 把 React、ReactDOM 及 JSX runtime 统一解析到 desktop-pet 包根；否则同一 production renderer 会内联两份 React，组件导出的 Hook 与 `createRoot` 使用不同 dispatcher，最终在 Release 窗口中出现 `useRef` 的 null dispatcher 崩溃并清空 Pet DOM。`desktop-pet/vite.config.test.ts` 以不写入磁盘的真实 Vite module graph 检查该约束，必须证明 React 和 ReactDOM 都只来自 desktop-pet 的包根，不能只依赖窗口可见性或 renderer 文件存在性。

主 Pet 窗口 renderer shell 挂载后写入 `pet-ready.json`，其中包含 PID、`file://` URL、本地 renderer 文件和 shell ready 状态；Electron GUI 不可观察时，状态仍区分进程、文件证据和 renderer window 未验证。

发布入口的数据目录解析保留显式配置优先级：显式 `-ApiDataDir` 优先，其次是非空 `API_DATA_DIR`，两者均未指定时才检查默认 `api/data/sqlite/trace.db`。默认文件缺失、被识别为 Git LFS pointer 或无法通过 SQLite 连接检查时，release build/start 创建并使用 `.runtime/release-stack/data` 及其 `sqlite`、`logs` 子目录；原始 `api/data` 不会被覆盖或修复。显式数据目录若无效则严格失败，不会静默回退。状态文件记录最终实际使用的 `api_data_dir`。

## 3. 当前关键配置

```env
OPENCLAW_BASE_URL=http://10.11.252.164:18789
OPENCLAW_MODEL=openclaw
OPENCLAW_AGENT_ID=main
OPENCLAW_MESSAGE_CHANNEL=feishu
OPENCLAW_PROXY_URL=http://127.0.0.1:7897
OPENCLAW_VERIFY_SSL=true
OPENCLAW_TIMEOUT_SECONDS=120

TTS_SERVICE_ENABLED=true
TTS_SERVICE_BASE_URL=http://10.11.252.164:5555

REALTIME_VOICE_ENABLED=true
REALTIME_VOICE_MAX_QUEUE_SIZE=3
REALTIME_VOICE_CHUNK_TIMEOUT_SECONDS=30
REALTIME_VOICE_CIRCUIT_FAILURE_THRESHOLD=5
REALTIME_VOICE_CIRCUIT_WINDOW_SECONDS=60
REALTIME_VOICE_CIRCUIT_OPEN_SECONDS=120
REALTIME_VOICE_MAX_QUEUE_WAIT_SECONDS=120
OPENCLAW_STREAM_MODE=http_sse

API_DATA_DIR=api/data
MMD_ROOT_DIR=./MMD
ADMIN_USER_IDS=admin-1,sola

CODEX_INTERACTIVE_ENABLED=false
CODEX_BIN=codex
CODEX_HOME=api/data/codex-home
CODEX_TRANSPORT=stdio
CODEX_ALLOWED_USERS=admin-1,sola
CODEX_ALLOWED_WORKSPACES=mmd-companion
CODEX_WORKSPACE_MMD_COMPANION=.
CODEX_DEFAULT_SANDBOX=read-only
CODEX_PATCH_SANDBOX=workspace-write
CODEX_ALLOW_DANGER_FULL_ACCESS=false
CODEX_ALLOW_YOLO=false
CODEX_USE_WORKTREE=true
CODEX_WORKTREE_ROOT=api/data/codex-worktrees
CODEX_BRANCH_PREFIX=codex/
CODEX_MAX_CONCURRENT_SESSIONS=1
CODEX_SESSION_IDLE_TIMEOUT_SECONDS=1800
CODEX_TURN_TIMEOUT_SECONDS=900
CODEX_PROCESS_START_TIMEOUT_SECONDS=30
CODEX_MAX_PROMPT_CHARS=12000
CODEX_REQUIRE_GIT_REPO=true
CODEX_REQUIRE_GIT_CLEAN_FOR_APPLY=true
CODEX_REQUIRE_HUMAN_APPROVAL=true
CODEX_TRACE_REDACT_SECRETS=true

CODEX_OPENCLAW_REVIEW_ENABLED=true
CODEX_OPENCLAW_REVIEW_AGENT_ID=codex-manager
CODEX_OPENCLAW_REVIEW_CHANNEL=codex-pet
CODEX_OPENCLAW_REVIEW_SYNC_INTERVAL_SECONDS=10
CODEX_OPENCLAW_REVIEW_MAX_PAYLOAD_CHARS=8000
CODEX_OPENCLAW_REVIEW_DUMP_DEBUG_FILES=false
CODEX_KNOWLEDGE_EXTRACTION_ENABLED=false
CODEX_KNOWLEDGE_AGENT_ID=codex-manager
CODEX_KNOWLEDGE_CHANNEL=codex-pet
CODEX_KNOWLEDGE_SYNC_INTERVAL_SECONDS=10
CODEX_KNOWLEDGE_MAX_PAYLOAD_CHARS=12000
CODEX_KNOWLEDGE_MIN_SIGNAL_SCORE=5
CODEX_KNOWLEDGE_TIMEOUT_SECONDS=300
CODEX_KNOWLEDGE_PROMPT_VERSION=codex-domain-knowledge-v3
CODEX_KNOWLEDGE_SKILL_PATH=openclaw/skills/codex-session-knowledge-extraction/SKILL.md
CODEX_KNOWLEDGE_DUMP_DEBUG_FILES=false
CODEX_OPENCLAW_CONTROL_PLANE_ENABLED=true
OPENCLAW_CONTROL_PLANE_BASE_URL=http://10.11.252.164:8765
OPENCLAW_CONTROL_PLANE_TOKEN=
CODEX_OPENCLAW_CONTROL_PLANE_WORKSPACE_ID=mmd-companion
CODEX_OPENCLAW_CONTROL_PLANE_SYNC_INTERVAL_SECONDS=60
CODEX_OPENCLAW_CONTROL_PLANE_SNAPSHOT_LIMIT=20
DOMAIN_KNOWLEDGE_CONTROL_PLANE_ENABLED=false

CODEX_REVIEW_MEMORY_ENABLED=false
CODEX_REVIEW_MEMORY_EXPORT_ROOT=api/data/openkb/codex-review
CODEX_REVIEW_MEMORY_TARGET=openclaw_wiki
OPENKB_SYNC_ENABLED=false
OPENKB_BASE_URL=
OPENKB_TOKEN=
```

当前文本生成应使用：

```text
payload.model = openclaw
x-openclaw-agent-id = main
x-openclaw-message-channel = feishu
```

不要把 `OPENCLAW_MODEL` 配成 `minimax-portal/MiniMax-M2.7`。当前 Gateway 对这种 model 名会返回无效模型或导致链路不可用。OpenClaw 默认 agent 当前走 `main`，默认模型由 OpenClaw 侧维护；MMD 项目不固定到业务专用 agent。OpenClaw `/v1/audio/speech` 当前实测为 404，实际音频链路不走这个接口。

Codex interactive 默认关闭。打开时必须配置 `CODEX_ALLOWED_USERS`；启动时的固定 workspace 仍来自 `CODEX_ALLOWED_WORKSPACES` 和对应的 `CODEX_WORKSPACE_*` 路径。浏览器不直连 Codex app-server；当前实现由 FastAPI 管理 `/companion/tasks` Codex Console、workspace 列表/登记、只读和 patch session、WebSocket 事件流、SQLite 事件/approval/artifact 落库。前端可通过 `GET /codex/workspaces` 读取 env workspace 和 UI 登记的 workspace，可通过 `POST /codex/workspaces/path-picker` 请求后端在本机拉起目录选择框并返回用户选择的绝对路径，也可通过 `POST /codex/workspaces` 登记新的本地 git 仓库根目录；后端要求 admin + Codex allowlisted user、slug workspace id、绝对路径、无 `..` traversal segment、已存在目录、且登记路径本身必须是 git repository root。UI 登记结果写入 SQLite `codex_workspaces`，不会改写 `.env`。这是对原始“configured root”措辞的有意偏离：UI 登记 repo 不要求位于 MMD 项目根目录下，安全边界由 admin+allowlist、路径 canonicalization、git root 校验和 Codex sandbox/worktree gate 共同提供。`desktop-pet` 右键菜单除读取该接口外，还会读取 Codex Desktop 日志中已出现的 `hostId=remote-ssh-codex-managed:<name>` 线程记录，聚合成独立的 Codex Desktop 项目对象（`projectId`、`projectKind`、`label`、`path`、`hostId`、`hostDisplayName`）；远程 `path` 只作为远端 cwd 保存，禁止对其执行本地 `statSync`，也不再把它当成 VS Code Remote-SSH URI。历史兼容代码仍可识别旧 VS Code Remote-SSH URI，但 Codex Desktop SSH 项目优先使用 Desktop 自己的 `hostId` 模型。当前 Codex Desktop `newThread` deeplink 只接受本机可访问的 `path`、可选 `prompt` 或 Git `originUrl`，不接受远程 `hostId`/`projectId`；`--open-project` 也只处理本地绝对目录。因此 Pet 选择远程项目后会保存该对象，并用 `codex://new` 打开未绑定的新任务入口，菜单和状态必须提示用户在 Desktop 中确认对应 SSH 项目；不得声称已直接创建或绑定远程任务。

`desktop-pet/electron/remoteProjectCatalog.ts` 进一步提供 macCodex 远程项目目录：默认复用实际 Windows 用户 OpenSSH 的 `Host macCodex`，只扫描 `/Users/sola/workspace` 与 `/Users/sola/Desktop/kscc`，最大深度 4。SSH 调用固定使用 `BatchMode=yes`、5 秒连接超时、严格 host key、30 秒进程超时、2 MiB 输出上限和 500 项仓库上限；Pet 不读取私钥正文、不保存密码或口令。扫描结果按 `hostProfileId + remotePath` 与 Codex Desktop 项目记录合并，正式 Desktop `projectId` 优先，未登记仓库标记为 `ssh_discovered`。最近成功快照原子写入 Electron `userData/remote-project-catalog.v1.json`；SSH 失败时显示 `cached_offline`。右键菜单只读取缓存和 Desktop 记录，不同步执行 SSH，避免网络异常阻塞原生菜单；只有点击“刷新 macCodex 项目”才运行 SSH 扫描。

生产 provider 会为每个 Codex session 启动本地 `codex app-server --listen stdio://`，通过 stdin/stdout JSONL JSON-RPC 调用 pinned schema 中的 `initialize`、`thread/start`、`turn/start` 和 `turn/interrupt`。app-server JSON Schema 固定在 `api/app/codex_schema/generated/`，前端 TypeScript protocol 绑定固定在 `web/src/codex-schema/generated/`，兼容层常量位于 `api/app/codex_schema/methods.py` 和 `web/src/codex-schema/methods.ts`。本地升级 Codex CLI 后用以下命令重新生成 schema bundle，并检查 diff 后再提交：

```powershell
scripts\generate-codex-app-server-schema.ps1
```

服务启动脚本 `scripts/dev-stack.ps1` 会在启动 API 前调用 `scripts/check-codex-app-server-schema.ps1`。当 `CODEX_INTERACTIVE_ENABLED=true` 时，该 preflight 会读取本地 `codex --version`、`api/.env`/环境变量中的 `CODEX_BIN`、以及 pinned manifest；schema 缺失或版本不一致时默认 fail fast，并提示手动运行生成脚本。开发环境如果确实要在启动时自动刷新 schema，可显式设置 `CODEX_SCHEMA_AUTO_UPDATE=true`，此时 preflight 会调用 `scripts\generate-codex-app-server-schema.ps1`；生产或正常启动不应静默自动更新 repo 文件。

FastAPI 只给 app-server 传白名单环境变量：`PATH`、`HOME`、`CODEX_HOME`、`NO_COLOR`，以及 Windows 网络/TLS/用户目录运行所需的 `SystemRoot`、`WINDIR`、`COMSPEC`、`PATHEXT`、`TEMP`、`TMP`、`USERPROFILE`、`APPDATA`、`LOCALAPPDATA`、`PROGRAMDATA`。不会传 OpenClaw、TTS、数据库、Feishu、OpenAI API key 或其他项目密钥。Windows 上如果 `CODEX_BIN` 解析到 npm 的 `codex.cmd` shim，后端会优先定位同包内的 native `codex.exe` 再启动，避免 shim 进程的 stdio/lifecycle 问题；找不到 native executable 时才退回 shim。当 `CODEX_WSL_ENABLED=true` 时，后端改为通过 `wsl.exe` 桥接启动 WSL 内的 codex 进程：命令行为 `wsl.exe -- bash -lc "codex app-server --listen stdio://"`，stdin/stdout 的 JSON-RPC 透传不受 `wsl.exe` 改动；此模式下 `build_env` 只传 `PATH`/`HOME`/`CODEX_HOME`/`NO_COLOR`，不传任何 Windows 环境变量。`CODEX_HOME` 应使用 WSL 路径格式（如 `/home/ksg/.codex`），`CODEX_WSL_EXEC` 可覆盖 `wsl.exe` 的路径（默认 `wsl.exe`）。运行时仍只支持本地 stdio app-server transport；不暴露浏览器直连 app-server，不启用 TCP/WebSocket app-server transport、Cloud Codex、Codex MCP、真实 PTY/xterm shell embedding、auto-apply 或 approval bypass。前端 `/companion/tasks` 的 Codex Console 仅使用 xterm.js 作为只读 transcript 渲染器，把后端 WebSocket UI 事件格式化显示为终端行；它不接入本地 shell，不向浏览器暴露 Codex app-server stdin/stdout，也不改变审批、diff、checks、apply 的现有 API 边界。Codex prompt 输入框采用聊天式快捷键：`Enter` 发送当前 turn，`Shift+Enter` 保留换行编辑。

Patch session 会通过 `CodexWorktreeManager` 在 `CODEX_WORKTREE_ROOT` 下为当前选中的 workspace 创建独立 git worktree，sandbox 固定为 `workspace-write`；read-only session 在当前选中的 env 或 SQLite 登记 workspace 下运行，sandbox 固定为 `read-only`。`CODEX_MAX_CONCURRENT_SESSIONS` 在创建 session 前强制执行；执行前会按 `CODEX_SESSION_IDLE_TIMEOUT_SECONDS` 关闭超时 idle session，并同步关闭 provider runtime、更新 SQLite session status、写入 lifecycle trace。FastAPI shutdown 会调用 provider `close_all_sessions()` 关闭仍活跃的本地 Codex runtimes。turn request 或 event stream 超时会稳定产出 `turn_failed`，app-server stdout/process 关闭会产出 `session_closed`/`process_exit`，并把 session 标记为 failed 且写入 runtime-health last error。

app-server notification 会在 FastAPI 归一化为稳定 UI 事件，例如 `item/agentMessage/delta -> text_delta`、`item/plan/delta -> plan_delta`、`item/commandExecution/outputDelta -> command_output`、`item/fileChange/patchUpdated -> file_changed`、`turn/completed -> turn_completed`、`process/exited -> process_exit`。`error` notification 只有在 `willRetry=false` 时归一化为终态 `turn_failed`；`willRetry=true` 的临时连接恢复提示归一化为非终态 `turn_retrying`，继续保持当前 turn running 并等待后续完成或最终失败。未知 app-server notification 继续以 `raw_codex_event` 原样落 SQLite，避免 schema drift 造成事件丢失。app-server 发起的 approval server request，例如 `item/commandExecution/requestApproval`、`item/fileChange/requestApproval`，以及旧式 `execCommandApproval`、`applyPatchApproval`，会先落 SQLite，再等待前端 approve/deny；用户决策会通过同一个 JSON-RPC request id 回传给 app-server。approval 决策既支持 REST `POST /codex/interactive/{session_id}/approvals/{approval_id}`，也支持 Codex WebSocket `{ type: "approval_decision", approval_id, decision }`。

Diff/check/apply 都围绕 worktree 执行；patch turn 完成后会自动生成 diff artifact，也支持前端手动刷新 diff。Apply 必须满足无 unresolved approval、显式 `confirm=true`、主 workspace 干净，并通过 `git apply --check` 后才会把 patch 写回主 workspace。Codex lifecycle 同时写入 `codex_events` 和通用 `trace_events`/NDJSON，覆盖 `codex.session.create|ready|failed`、`codex.turn.start|event|completed|failed`、`codex.approval.required|decided`、`codex.diff.ready`、`codex.checks.started|completed`、`codex.apply.started|completed|failed`、`codex.process.exit`；当 `CODEX_TRACE_REDACT_SECRETS=true` 时，trace payload 中 secret-like key 或 `TOKEN=...`/`SECRET=...` 等字符串值会先被替换为 `[REDACTED]`。测试可通过 `codex_use_deterministic_provider` 覆盖使用 deterministic provider，不启动真实 app-server。

Codex Review Sync 是 desktop-pet/Codex 管理回顾链路，不是执行链路。desktop-pet 继续扫描用户既有 `CODEX_HOME/sessions/**/rollout-*.jsonl`，但只抽取 bounded facts 到 `desktop_pet_sessions.metadata.facts`，例如 failed commands、changed files、approval titles、error excerpts、event counts，以及会话叙事字段（user messages、assistant messages、function call summaries）。scanner 现在以分块流式方式读取完整 JSONL 事件序列，不再只看 head/tail；同时兼容 `function_call/function_call_output` 与当前 `custom_tool_call/custom_tool_call_output`，并按 `call_id` 把交错的工具输出回填到对应 method。`apply_patch` 输入中的 Add/Update/Delete File 会进入 workspace-relative changed files。scanner 还会生成结构化 `work_items` 与 `methods`：`work_items` 是按事件抽出的目标、助手更新、文件变更、审批和错误；`methods` 是工具/命令/检查/审批方法、命令文本、执行结果、exit code 与 bounded 输出片段；其中 `kind=check` 且 `outcome=success` 的 method 会被 FastAPI 提升为 `successful_checks`，供知识 evidence pack 和验证证据索引复用。scanner 会对这些事实字段做 secret-like 文本脱敏，不把完整 transcript 写入 SQLite；payload 还携带 `session_parser_version=codex-jsonl-stream-v2` 和 `review_facts_version=codex-review-facts-v2`，FastAPI 把这两个版本纳入 evidence/source hash，使旧的不完整抽取可以重新入队。会话叙事字段和结构化 work/method 字段是 OpenClaw 做会话总结的主要信息源，在 evidence pack 超过 `CODEX_OPENCLAW_REVIEW_MAX_PAYLOAD_CHARS` 时优先裁剪 function call summaries 和 methods，再把 work_items 裁成小骨架，最后才裁剪 assistant/user messages。FastAPI 在 review-worthy status（`completed`、`failed`、`waiting_approval`、`file_changed`）上报后，若 `CODEX_OPENCLAW_REVIEW_ENABLED=true` 且存在 `OPENCLAW_TOKEN`，会用 `codex_review_fact_extractor` 合并 `desktop_pet_sessions`、`codex_events`、`codex_artifacts` 和 `codex_approvals` 生成 `codex_review_evidence_pack`，按 hash 写入 `codex_openclaw_sync_outbox`。`POST /desktop-pet/sessions` 如果收到旧版/本地 JSONL scanner payload 且 `workspace_id` 缺失，会默认归入 `CODEX_OPENCLAW_CONTROL_PLANE_WORKSPACE_ID`，避免 review drafts 因 workspace 为空而从 OpenClaw daily snapshot 中消失。后台 worker 调用 OpenClaw `/v1/responses`，发送前按 `CODEX_OPENCLAW_REVIEW_MAX_PAYLOAD_CHARS` 对 evidence pack 做 best-effort 裁剪，并使用 `x-openclaw-agent-id=CODEX_OPENCLAW_REVIEW_AGENT_ID`、`x-openclaw-message-channel=CODEX_OPENCLAW_REVIEW_CHANNEL`、`x-openclaw-session-key=codex-review:{pet_session_id}`，要求 OpenClaw 返回单个 JSON object，且 prompt 内明确 `work_summary` object、各 item list 和 `management` object 的 shape。Codex review JSON key、枚举、命令、文件路径、代码标识和引用的错误原文保持英文/原文，但 `title`、`summary`、`description`、`symptom`、`root_cause`、`fix`、`prevention`、`decision`、`result`、`work_done`、`management` 等用户可读字段要求输出简体中文。FastAPI 解析层会把 OpenClaw 偶发返回的 scalar/null `work_summary`、null list 或 null `management` 归一化为可保存结构，避免单个格式偏差导致整条 outbox 永久失败；解析成功后拆成 `codex_review_items(status=draft, source=openclaw)`。`CODEX_OPENCLAW_REVIEW_DUMP_DEBUG_FILES=true` 时，请求/响应 debug JSON 写入 `API_DATA_DIR/openclaw/codex-review/`，默认关闭。OpenClaw 不读取本机 Codex 文件、不接收完整 diff/patch、不直接 resume Codex、approve 权限或 apply patch。

Codex Knowledge Extraction 是 review 事实之后的领域知识合成入口，仍然不让 OpenClaw 读取本机 rollout 或仓库。FastAPI 继续用 bounded `codex_review_evidence_pack` 派生 `codex_knowledge_evidence_pack`，保留 `reviewability` 和最多十二项的 legacy `code_index`，用于 v1/v2 兼容与会话线索；默认 `CODEX_KNOWLEDGE_PROMPT_VERSION=codex-domain-knowledge-v3`，`codex-session-knowledge-extraction` Skill 现在只合成 Domain Knowledge v2 草稿，输出 `schema_version=2`、`disposition=no_wiki|domain_knowledge_candidates`、`candidates[*].draft` 和 Evidence Reference ID，不再让模型输出 Runbook `memory_draft`、质量 Gate、发布状态或 locator 对象。FastAPI response parser 同时接受旧 `schema_version=1/wiki_candidates` 与新 v2 synthesis response；旧响应仍按 `code_index` reconciliation 保存，新响应只允许引用输入中已有的 canonical Repository Resolver Evidence Reference ID。`codex_session_knowledge.raw_response_json` 保留完整响应，read model 同时暴露 legacy `wiki_candidates` 与新 `domain_knowledge_candidates`。

Domain Knowledge v2 的 Phase 2 基础模块和 Phase 3/4 FastAPI 控制面基础已经落地：`api/app/models/domain_knowledge.py` 定义 Concept Delta、Evidence Reference、Draft、Candidate、Proposal、Review Decision、Accepted Wiki Change Set 和 Publication Receipt 契约；SQLite additive tables 保存 Concept Delta、候选、immutable candidate revision、证据、candidate delivery、durable command/publish cursor、审核、exact change set、receipt、scan 和 control-plane ledger；Concept Delta Collector、fixed-revision Repository Resolver、Deterministic Gate 与 Topic Identity Resolver 继续负责事实和主题边界。`api/app/services/domain_knowledge_review_ledger.py` 会兼容 OpenClaw wire command 的 `id/input_payload_sha256/message_id/base_git_revision`，但归一化后仍严格校验 candidate delivery hash、candidate/proposal revision、approved knowledge、Markdown、完整 unified diff、target/base hash；同 command ID 的相同 payload 幂等重放，异内容硬失败。`api/app/services/domain_knowledge_control_plane.py` 负责 candidate batch、command result、exact publish payload 和 publication receipt，并且 cursor 只在整批命令或 receipt 持久化完成后推进。当前 `CODEX_KNOWLEDGE_EXTRACTION_ENABLED=false`，旧 synthesis worker 尚未自动收集 Concept Delta、调用 Resolver/Gate 并生成 delivery；`DOMAIN_KNOWLEDGE_CONTROL_PLANE_ENABLED=false`，v2 worker 默认不运行，因此仍不会自动发布 Obsidian。2026-07-14 重启后已用 Git HEAD `62e24257b025423fb085ef4c7534c19354785111` 的 Contract/实现/测试证据跑通 shadow candidate，OpenClaw 返回 item `accepted`；完整人工审核到最终 receipt 仍待实际操作验收。

当前已实现的 Codex review memory 流程由 FastAPI 持有状态机。本地 review API 仍可用于 Web/Pet/manual 工具：`GET /codex/reviews/daily-summary` 获取数量摘要，`GET /codex/reviews/drafts` 拉取完整待确认 backlog，`POST /codex/reviews/items/{item_id}/decision` 写入 `accept`、`edit_accept`、`ignore` 或 `snooze` 决策。`decision` payload 现在在兼容旧 `edited_title` / `edited_summary` 的同时，支持优先级更高的结构化 `memory_draft`；该结构只允许出现在 `accept` / `edit_accept`，要求至少包含 `knowledge_kind`、`problem`、`when_to_use`、非空 `steps`、非空 `verification`、`source_summary`，且 `steps[*].order`、`verification[*].order` 必须从 1 开始严格递增。`edit_accept` 现在允许仅携带 `memory_draft` 而不强制依赖 legacy summary 字段。生产跨机设计不要求 OpenClaw 反连本机 FastAPI；OpenClaw 侧提供 review run / command queue。FastAPI daily snapshot 已拆成两层：兼容字段 `drafts`、`daily_new_items`、`work_units`、`learning_candidates` 和 `rollup` 只包含按 Asia/Shanghai 自然日筛选、当天新建或 `updated_at` 有实质更新的 review items；`pending_review_backlog` 只携带全部历史未处理项的数量、高优先级数量和建议批次，不再每天重复传完整旧候选。`summary.draft_count/high_priority_count` 表示当天增量，同时附带 `pending_backlog_count/pending_backlog_high_priority_count`。outbound worker 每轮重新计算 daily snapshot cursor，先查询 SQLite `codex_review_control_plane_snapshot_state`：同一 daily session key 已成功提交相同 cursor 时返回本地 `snapshot_unchanged`，不再发送 HTTP POST；当天增量、backlog 数量、日期发生变化或上次提交失败才调用 snapshot endpoint。OpenClaw 返回 `idempotent=true` 也作为成功提交持久化。snapshot 是否变化不影响后续 `GET {OPENCLAW_CONTROL_PLANE_BASE_URL}/v1/apps/mmd/codex-review/runs/codex-review-daily:YYYY-MM-DD/commands?cursor=...` 命令轮询和 publish-status 轮询。在本地应用 `review_decision` 后，FastAPI 调用 `POST {OPENCLAW_CONTROL_PLANE_BASE_URL}/v1/apps/mmd/codex-review/commands/{command_id}/result` 回推 `{ session_key, command_id, status, result, error, completed_at }`。FastAPI 当前支持的 control-plane command 类型是 `review_decision`，动作与本地 API 一致：`accept`、`edit_accept`、`ignore`、`snooze`；control-plane `review_decision` 使用与本地 API 相同的 `memory_draft` 校验规则。成功结果的 `result` 包含 `item_id`、`item_status` 和可选 `memory_id`，失败结果回传错误文本。command cursor 保存在进程内 `app.state.last_codex_review_control_plane_command_cursor`，最近一次处理结果保存在 `app.state.last_codex_review_control_plane_commands`。

daily snapshot 推送由 `CODEX_OPENCLAW_CONTROL_PLANE_ENABLED` 控制，目标是 `POST {OPENCLAW_CONTROL_PLANE_BASE_URL}/v1/apps/mmd/codex-review/runs/codex-review-daily:YYYY-MM-DD/snapshot`，token 默认复用 `OPENCLAW_TOKEN`，也可用 `OPENCLAW_CONTROL_PLANE_TOKEN` 覆盖。snapshot 构建时会把历史 `desktop_pet_sessions.workspace_id IS NULL` 的 unscoped draft 临时视为当前 `CODEX_OPENCLAW_CONTROL_PLANE_WORKSPACE_ID`，本地 `/codex/reviews/drafts?workspace_id=...` API 仍保持严格 workspace 过滤。snapshot 现在包含四层语义：`drafts` 是兼容旧 OpenClaw 审核队列的逐条 draft；`work_units` 按 `pet_session_id` 聚合 goal/outcome/status、review item counts、top review items、changed files 和 checks/failures，用于项目工作总结；`learning_candidates` 从 blocker/pitfall/decision/followup/work_summary draft 派生 problem/root_cause/fix/prevention/lesson/证据，用于 OpenClaw 让用户确认哪些经验值得沉淀；`rollup` 汇总 work unit count、状态分布、review item/candidate 类型分布、高优先级 candidate 数、top tags、changed files、失败命令数和成功检查数，作为 OpenClaw 日报和复盘入口。空 title-only/无摘要/无证据的 draft 仍保留在 `drafts`，但不会进入 `learning_candidates`，避免污染经验沉淀候选。`work_units`、`learning_candidates` 和 `rollup` 都是 outbound snapshot 的派生视图，不直接写入 memory-wiki；只有用户确认后 FastAPI 才创建 memory。`accept` 和 `edit_accept` 会创建去重的 `codex_review_memory` 行，并在 `codex_review_memory_versions` 写入版本 1；如果决策 payload 带有 `memory_draft`，FastAPI 直接把它作为 canonical `details_json` 持久化，并优先用它渲染 memory `body`，不会再从 `edited_summary` 或 review summary 反推结构。未携带 `memory_draft` 时，仍保留旧的 summary-only 兼容路径，把 review draft 的 `summary/symptom/root_cause/fix/prevention/decision/result` 等候选信息归一化成结构化 knowledge memory。当前 body 渲染支持 `Problem`、`Root Cause`、`When To Use`、`Prerequisites`、`Steps`、`Verification`、`Cautions`、`Open Questions`、`Source Summary` 等分节，并会把 per-step `commands`、`file_refs`、`evidence_refs` 和 verification `expected_signal` 写入 Markdown。也就是说，`codex_review_items` 继续是待审核摘要候选，`codex_review_memory` 才是确认后的可执行知识沉淀；两者不复用同一语义层。历史 unscoped item 被确认时也使用当前 `CODEX_OPENCLAW_CONTROL_PLANE_WORKSPACE_ID` 作为 memory workspace，避免落到 `unknown`。后续编辑通过 append-only version 记录 `title/body/details_json`，不覆盖历史版本。`snooze` 的 `snooze_until` 保存在 review item details 中，未到期的 snoozed item 不会出现在 drafts 列表。默认 decision target 是 `openclaw_wiki`，所有本地 review API 目前使用 `x-user-id`，且必须命中 `ADMIN_USER_IDS`。

长期记忆主路径是 OpenClaw `memory-wiki` + Obsidian Git vault。FastAPI 会为已确认 memory 生成 bounded wiki payload，包括 deterministic wiki path、frontmatter、Markdown、结构化 `memory.details`、evidence refs 和 provenance；本地 `GET /codex/reviews/memory/{memory_id}/wiki-payload` 仍作为渲染/调试入口，生产跨机链路由 FastAPI outbound worker 扫描 `codex_review_memory.export_status='pending'` 的记录并调用 `POST {OPENCLAW_CONTROL_PLANE_BASE_URL}/v1/apps/mmd/codex-review/runs/codex-review-daily:YYYY-MM-DD/memory-payloads` 主动推送 `{ payloads: [...] }`。OpenClaw ack 后 FastAPI 把本地 memory 标记为 `export_status='submitted'`，表示 payload 已交给 OpenClaw，但还不代表 Obsidian wiki 已发布；随后 worker 调用 `GET {OPENCLAW_CONTROL_PLANE_BASE_URL}/v1/apps/mmd/codex-review/runs/codex-review-daily:YYYY-MM-DD/publish-status?cursor=...` 轮询发布状态，OpenClaw 返回 `published` 时本地标记 `export_status='synced'` 并把 `wiki_path` 保存为 `openkb_document_id` 兼容字段，返回 `failed` 时标记 `export_status='export_failed'` 并保存错误。payload 会脱敏 secret-like 文本，不包含完整 transcript 或本地文件路径。OpenClaw 侧负责 `wiki_apply`、`wiki_lint`、dashboard 更新、每日 git commit 和 push，并暴露 publish status 供 FastAPI 轮询。兼容导出路径仍由 `POST /codex/reviews/memory/export` 提供：FastAPI 可把确认后的 memory 渲染成 Markdown frontmatter 文件，默认目录为 `CODEX_REVIEW_MEMORY_EXPORT_ROOT/{workspace_id}/{category}/...md`；前置正文就是结构化 knowledge memory 本体，而不是 review summary 原文。请求 `target=openkb` 且 `OPENKB_SYNC_ENABLED=true` 时，FastAPI 再通过 `OpenKbClient.upsert_document()` 调用 `OPENKB_BASE_URL`。OpenKB/Markdown export 不接收 draft item，不接收未确认 memory。

本地 Codex Tool facade 当前暴露在 `/openclaw/tools/codex/*`，它是 FastAPI 执行 OpenClaw Codex tool command 时复用的受控入口，不替代浏览器 `/codex/interactive/*`。生产跨机链路应由 OpenClaw 把 Codex tool request 写入 OpenClaw command queue，FastAPI outbound worker 轮询后调用本地 facade；不要求 OpenClaw 直接访问本机 `/openclaw/tools/codex/*` URL。`POST /openclaw/tools/codex/sessions` 复用现有 Codex interactive session 创建逻辑，因此仍执行 admin、`CODEX_ALLOWED_USERS`、workspace allowlist、sandbox、worktree 和 provider 初始化校验；`GET /openclaw/tools/codex/sessions/{session_id}/status` 只返回 bounded session snapshot，包括 session/status、last output preview、pending approval refs、latest artifact refs 和 recent event headers，不返回完整 transcript、artifact metadata 或本地文件路径；`POST /openclaw/tools/codex/approvals/{approval_id}/decision` 复用现有 approval 决策逻辑。MMD project 是 OpenClaw 的 application channel/domain；LLM/model backend 只是 OpenClaw 在该 channel 内使用的能力之一。

## 4. Codex Domain Knowledge v2 拓扑与调用链

这一链路负责把 Codex 会话、显式 Concept Delta 与固定 Git revision 的仓库事实转成 Domain Knowledge Candidate，并在 OpenClaw 审核后只发布 exact Accepted Wiki Change Set。Review Sync 与 Knowledge Extraction 仍从同一份本地会话事实分叉；Phase 2 模块和 v2 控制面/ledger 已实现，但从 legacy synthesis outbox 自动生成 v2 candidate delivery 的编排尚未接上。当前 `CODEX_KNOWLEDGE_EXTRACTION_ENABLED=false` 且 `DOMAIN_KNOWLEDGE_CONTROL_PLANE_ENABLED=false`，自动抽取和 v2 控制面默认都不启动。

### 4.1 当前已实现拓扑

```mermaid
flowchart LR
    A["Codex rollout JSONL<br/>CODEX_HOME/sessions/**/rollout-*.jsonl"] --> B["desktop-pet Electron scanner<br/>full streaming scan + bounded facts"]
    B --> C["POST /desktop-pet/sessions"]
    C --> D[("desktop_pet_sessions")]
    D --> A1{"自动入口 Gate<br/>feature + token + reviewable status"}
    A1 -- "满足" --> E["build_codex_review_evidence_pack"]
    A1 -- "不满足" --> G0["不调用抽取器"]
    O[("codex_events<br/>codex_artifacts<br/>codex_approvals")] --> E
    E --> F["build_codex_knowledge_evidence_pack<br/>reviewability + code_index <= 12"]
    M["Admin manual extract API<br/>admin + feature + token"] --> E
    F --> G{"signal score 达标<br/>或 manual force"}
    G -- "不满足" --> G1["不入队<br/>not_knowledge_candidate"]
    G -- "满足" --> H[("codex_knowledge_extraction_outbox<br/>pending")]
    H --> I["FastAPI background worker"]
    S["local SKILL.md<br/>codex-domain-knowledge-v3"] --> I
    I --> J["OpenClaw Gateway<br/>POST /v1/responses"]
    J --> K["response parser<br/>legacy v1 + Domain Knowledge v2"]
    K --> L[("codex_session_knowledge<br/>raw_response_json")]
    L --> N["Admin read APIs<br/>latest / items"]
    D -.-> CD["Concept Delta Collector<br/>(尚未编排)"]
    REPO["Repository / Git<br/>fixed revision"] -.-> RR["Repository Evidence Resolver<br/>(read-only)"]
    CD -.-> DG["Deterministic Domain Knowledge Gate"]
    RR -.-> DG
    DG -.-> TI["Topic Identity Resolver"]
    TI -.-> V2[("domain_knowledge_candidates<br/>candidate versions + evidence")]
    V2 --> DEL[("candidate deliveries<br/>durable + idempotent")]
    DEL --> OC2["OpenClaw Project Knowledge<br/>candidate + proposal + human review"]
    OC2 --> CMD[("durable review command")]
    CMD --> LEDGER["FastAPI Review Ledger<br/>exact hash/revision validation"]
    LEDGER --> CS[("Accepted Wiki Change Set<br/>exact files + full diff")]
    CS --> PUB["OpenClaw memory-wiki publish<br/>base hash + lint + Git push"]
    PUB --> REC[("Publication Receipt")]
```

`desktop-pet/electron/codexSessionFiles.ts` 分块流式扫描 rollout JSONL 的完整事件序列，同时只保留脱敏、限长的 `metadata.facts`、`work_items` 和 `methods`；完整 transcript 不会进入 FastAPI 或发给 OpenClaw。当前 scanner 兼容旧 `function_call` 和新 `custom_tool_call` 事件，并按 `call_id` 关联输出。Electron 主进程会在正常 session 扫描、完成态 watcher 以及每天凌晨 4 点补扫时调用 `POST /desktop-pet/sessions`。知识抽取使用的是 FastAPI 基于 SQLite 事实重新构建的 evidence pack，不允许 OpenClaw 回读本机 rollout、源码或文件系统。

### 4.2 自动触发与手动触发

自动入口是 `api/app/routes/desktop_pet.py` 的 `POST /desktop-pet/sessions`：

1. 先 upsert `desktop_pet_sessions`；缺少 `workspace_id` 时使用 `CODEX_OPENCLAW_CONTROL_PLANE_WORKSPACE_ID`。
2. 只有 `CODEX_KNOWLEDGE_EXTRACTION_ENABLED=true`、存在 `OPENCLAW_TOKEN`，且 `last_status` 为 `completed`、`failed`、`waiting_approval` 或 `file_changed` 时，才进入知识候选构建。
3. `build_codex_knowledge_evidence_pack()` 先复用 review evidence builder，再加入 `kind=codex_knowledge_evidence_pack`、`prompt_version`、Skill 标识、`reviewability` 和 deterministic `code_index`。
4. 信号分数未达到 `CODEX_KNOWLEDGE_MIN_SIGNAL_SCORE` 时直接返回 `queued=false / not_knowledge_candidate`，不会写 outbox。
5. 入队使用 `(pet_session_id, source_hash)` 唯一键保证幂等；同一份 evidence 不会重复创建任务。普通自动上报不会把已失败的同 hash job 重排为 `pending`。

手动入口是 admin-only API：

```http
POST /codex/knowledge/sessions/{pet_session_id}/extract
Content-Type: application/json
x-user-id: <admin>

{
  "force": true,
  "min_signal_score": null
}
```

该 API 仍要求 feature flag 已开启且 `OPENCLAW_TOKEN` 存在。默认 `force=true`：它绕过信号阈值，并把相同 `(pet_session_id, source_hash)` 的 `failed` job 原地重置为 `pending`、清空错误和 attempt count；它不会创建无限自动重试。`force=false` 时与自动链使用相同的候选 Gate。

### 4.3 Worker 到 OpenClaw 的调用时序

```mermaid
sequenceDiagram
    participant W as Knowledge Worker
    participant DB as SQLite
    participant OC as OpenClaw Gateway

    W->>DB: claim oldest pending job
    DB-->>W: status= sending, attempt_count + 1
    W->>W: trim evidence to max payload<br/>load local SKILL.md
    W->>OC: POST /v1/responses<br/>Bearer token + agent/channel/session headers
    OC-->>W: one JSON object
    W->>W: parse legacy schema v1 or Domain Knowledge synthesis v2
    W->>W: reconcile legacy code_index or validate v2 Evidence Reference IDs
    alt valid response
        W->>DB: upsert codex_session_knowledge
        W->>DB: outbox status= succeeded
    else request or validation failure
        W->>DB: outbox status= failed + last_error
    end
```

FastAPI 启动时只有在 feature flag 开启、token 存在且 worker 未被测试 override 禁用时，才创建 `run_codex_knowledge_extraction_worker()`。worker 每 `CODEX_KNOWLEDGE_SYNC_INTERVAL_SECONDS` 处理最多一个最早的 `pending` job，请求使用独立的 `CODEX_KNOWLEDGE_TIMEOUT_SECONDS`，默认 300 秒。

OpenClaw 请求为：

```text
POST {OPENCLAW_BASE_URL}/v1/responses
Authorization: Bearer <OPENCLAW_TOKEN>
x-openclaw-agent-id: {CODEX_KNOWLEDGE_AGENT_ID}
x-openclaw-message-channel: {CODEX_KNOWLEDGE_CHANNEL}
x-openclaw-session-key: codex-knowledge:{pet_session_id}

model = OPENCLAW_MODEL（当前为 openclaw）
stream = false
input = prompt_version + 完整 SKILL.md contract + bounded evidence pack
```

这里的 Skill 执行方式是：FastAPI 从 `CODEX_KNOWLEDGE_SKILL_PATH` 读取本地 `SKILL.md`，把它完整嵌入 prompt 作为 authoritative contract，再由指定 OpenClaw agent 执行。OpenClaw 不会自行访问本仓库里的 Skill 文件；Skill 文件缺失时客户端才使用内置的最小 fallback contract。

### 4.4 返回解析、证据约束与 Deterministic Gate

response parser 保留两类输入合同：

- Legacy `schema_version=1` 继续接受 `no_wiki|wiki_candidates`、`memory_draft`、`publish_status` 和最多十二项 `code_index`，保存前仍以输入 code index 覆盖模型 locator。
- Domain Knowledge synthesis `schema_version=2` 接受 `no_wiki|domain_knowledge_candidates`。每个 candidate 必须是 `source_kind=session_incremental`，包含合法的 Domain Knowledge v2 draft，显式 `introduced_for/meaning/technical_solution/source/evidence_refs`，且 `confidence` 在 0 到 1 之间。
- v2 candidate 只返回 Evidence Reference ID；当 worker 输入提供 `repository_evidence.evidence_refs` 或 canonical `evidence_index` 时，所有 candidate ref 必须存在于该索引。模型不返回、也不能修改 revision、blob、path、symbol、line 或 snippet hash。
- `assessment.candidate_count` 必须与实际候选数一致；`no_wiki` 不允许携带候选。

Phase 2 的 `evaluate_domain_knowledge_candidate()` 是独立的程序化 Gate，不由 OpenClaw prompt 代替。它重新校验 Candidate schema，从 Repository Evidence Pack 取 canonical refs 覆盖模型 evidence index，检查引入问题、定义、关系、四类边界、不变量、Contract/实现和测试/验证证据，并为 Contract/Workflow/Rule/Gate/Policy 检查 Concept Delta。未知 ref 或内容/证据缺口进入 `needs_evidence`，缺作者解释进入 `needs_author_explanation`，全部满足才进入 `ready_for_review`。当前 legacy outbox worker 尚未调用该 Gate。

### 4.5 数据状态、查询 API 与 Wiki 发布边界

Outbox 状态机是：

```text
pending -> sending -> succeeded
                   -> failed

failed -- manual force=true --> pending
```

成功结果完整保存在 `codex_session_knowledge.raw_response_json`。兼容字段 `domain/concepts/rule_concepts/...` 仍保留，但 v2 消费方应直接使用：

```text
disposition
assessment
wiki_candidates
domain_knowledge_candidates
rejected_items
code_index
```

读取入口均为 admin-only：

```http
GET /codex/knowledge/sessions/{pet_session_id}/latest
GET /codex/knowledge/items?workspace_id={workspace_id}&limit=20
```

legacy knowledge worker 的终点仍是 `codex_session_knowledge`；它返回的 v2 `domain_knowledge_candidates` 尚未自动进入 Resolver/Gate/topic identity 与 candidate delivery。另一方面，手工或后续编排产生的合格 candidate 已可以写入 immutable candidate version、进入 durable delivery，并走 OpenClaw Project Knowledge v2 控制面。现有 v1 人工审核链继续兼容运行：

```text
codex_review_items(status=draft)
  -> user accept / edit_accept
  -> codex_review_memory + codex_review_memory_versions
  -> bounded wiki payload
  -> OpenClaw control plane
  -> memory-wiki / Obsidian Git vault
```

剩余自动化接线必须把 v2 draft 经 Repository Resolver、Deterministic Gate 和 Topic Identity Resolver 后保存成 immutable candidate revision 并 enqueue delivery；不能把 v2 draft 降级映射为 Runbook memory，也不能从 `codex_session_knowledge` 直接绕过审核写 Wiki。

2026-07-14 已冻结 Domain Knowledge v2 目标合同：

- 总执行 Spec：`docs/plans/2026-07-14-project-domain-knowledge-wiki-execution-spec.md`
- OpenClaw 独立交付 Spec：`docs/plans/2026-07-14-openclaw-project-domain-knowledge-review-publish-spec.md`

Phase 1 与 Phase 2 已实现；OpenClaw 侧 Wiki Change Proposal/双重审核路由，以及 FastAPI 侧 durable delivery/cursor、exact proposal validation、Accepted Wiki Change Set、publish payload 和 receipt ledger 也已实现。`create/update/merge/supersede` 的最终 Vault 行为由 OpenClaw 负责。当前缺口是 legacy synthesis 到 v2 candidate 的自动编排，以及一次真实用户审核后从 command 到 Obsidian Git receipt 的端到端验收。

### 4.6 代码入口索引

| 环节 | 当前实现 |
| --- | --- |
| Codex JSONL bounded scanner | `desktop-pet/electron/codexSessionFiles.ts` |
| Desktop Pet 全局会话发现 Worker | `desktop-pet/electron/agentSessionDiscoveryWorker.ts` |
| Electron 扫描调度与 session upsert | `desktop-pet/electron/main.ts` |
| 自动触发入口 | `api/app/routes/desktop_pet.py` |
| 手动触发与查询 API | `api/app/routes/codex_knowledge.py` |
| 基础 review evidence 构建 | `api/app/services/codex_review_fact_extractor.py` |
| 信号评分、`code_index`、outbox、worker、schema Gate 与 reconcile | `api/app/services/codex_knowledge_extraction.py` |
| Domain Knowledge v2 Pydantic contracts | `api/app/models/domain_knowledge.py` |
| Concept Delta Collector 与缺口 finding | `api/app/services/domain_knowledge_concept_delta.py` |
| Fixed-revision Repository/Git evidence | `api/app/services/domain_knowledge_repository_resolver.py` |
| Deterministic candidate Gate | `api/app/services/domain_knowledge_gate.py` |
| Stable topic identity / alias matching | `api/app/services/domain_knowledge_topic_identity.py` |
| Durable review ledger / exact proposal validation | `api/app/services/domain_knowledge_review_ledger.py` |
| Project Knowledge v2 candidate/command/publish/receipt orchestration | `api/app/services/domain_knowledge_control_plane.py` |
| OpenClaw `/v1/responses` 请求和 prompt 组装 | `api/app/services/openclaw_client.py` |
| SQLite schema 与状态读写 | `api/app/db/store.py` |
| OpenClaw 抽取 contract | `openclaw/skills/codex-session-knowledge-extraction/SKILL.md` |
| 定向回归测试 | `api/tests/test_codex_knowledge_extraction.py`, `api/tests/test_domain_knowledge_*.py` |

### 4.7 Codex 作者知识交接 Hook（KH-01）

KH-01 在 Codex 边界内增加了独立的作者交接捕获器，但当前不会自动注册到用户级
`C:\Users\KSG\.codex\hooks.json`。其运行入口位于：

```text
scripts/codex-knowledge-handoff/stop-hook.mjs
```

有效最终回复的局部链路为：

```text
Codex final response
  -> Stop Hook YAML safe-subset validator
  -> %CODEX_HOME%/knowledge-handoffs/<workspace-key>/<handoff-id>/
       handoff.md
       marker.yaml
       metadata.json
       candidates/*.md
       .complete
```

没有固定作者载荷的普通回复直接放行；已声明但非法的载荷会阻止 Stop，且不创建半成品。
Hook 只负责分割、校验、来源 metadata、哈希和原子落盘，不负责仓库证据、Gate、Vault
主题解析或 Obsidian 发布。

KH-02 已在 `desktop-pet/electron/knowledgeHandoffTransport.ts` 增加 Pet 侧扫描与运输
边界：启动补扫、`.complete` 文件监听、包清单/hash 校验、持久化离线队列、幂等上传、
accepted/duplicate ACK、重试、重启恢复和 FastAPI Git 事件提示。Pet 只向
`/codex/knowledge/handoffs` 与 `/codex/knowledge/git-events` 发送请求，不直接访问
OpenClaw，也不执行仓库证据、Gate、Vault 主题解析或发布。

该运输器由 `MMD_PET_KNOWLEDGE_HANDOFF_TRANSPORT_ENABLED=1` 显式启用；默认关闭，
因此 KH-02 不会提前启用新知识链。FastAPI 接收端、Repository Evidence Resolver、
Gate 和 OpenClaw 双审核仍待后续票据接通；旧的 Review/Knowledge 运行链继续按本节
前文所述保持关闭或兼容运行。

Pet 会解析普通仓库和 Git worktree 的 `.git`/`commondir`，监听 checkout、commit
和远端 refs 变化作为加速提示；真实 `push` 可由 Git Hook 调用
`desktop-pet/scripts/knowledge-handoff-git-hint.mjs --workspace-key <key> --event push`。
当前只提供这个显式桥接入口，不自动安装或修改用户仓库的 Git Hook；提示失败不会阻塞
Git 操作，目录监听、启动补扫和周期性 FastAPI reconciliation 仍是可靠兜底。

KH-03 在 FastAPI 内增加独立的作者知识交接账本，数据库文件为
`api/data/sqlite/knowledge_handoff.db`，不复用旧 Review v1 派生表，也不在 feature flag
关闭时创建。接收端点为：

```text
POST /codex/knowledge/handoffs
POST /codex/knowledge/git-events
POST /codex/knowledge/reconcile
GET  /codex/knowledge/openclaw-deliveries
POST /codex/knowledge/openclaw-deliveries/{delivery_id}/ack
```

FastAPI 会校验 3+N 文件清单、`.complete`、metadata、candidate 引用和两级 SHA-256，
用 `workspace_key + handoff_id + package_sha256` 幂等接收并返回持久化 ACK。随后为每个
candidate 创建不可变 `candidate_revision`，在固定 Git revision 上解析 `evidence_revision`
并运行确定性 Gate。只有 `ready_for_review` 才会生成脱敏的候选级 bounded delivery；
FastAPI 不决定 Vault topic、目标路径、create/update/merge/supersede 或 Accepted Wiki
Change Set，也不直接调用 OpenClaw。

KH-03 的 reconciliation worker 由 `CODEX_AUTHOR_KNOWLEDGE_HANDOFF_ENABLED=1` 控制，
Git event 只负责加速，周期扫描负责兜底。启用时所有 Pet、Git 提示和 OpenClaw
delivery ACK 都必须分别携带 `CODEX_AUTHOR_KNOWLEDGE_HANDOFF_TOKEN`（Pet/运输）
或 `CODEX_AUTHOR_KNOWLEDGE_OPENCLAW_TOKEN`（OpenClaw/交付 ACK）；
作者交接中的命令证据只允许固定的无副作用 Git 状态查询，其他命令不会被 FastAPI
自动执行。KH-04 增加独立的 `CODEX_AUTHOR_KNOWLEDGE_OPENCLAW_DELIVERY_ENABLED`
开关；开启后 FastAPI 才会把 pending bounded delivery 映射为
`project_domain_knowledge_candidate_batch`，并通过
`POST /v1/apps/mmd/project-knowledge/runs/{run_id}/candidates`
推送给 OpenClaw（不新增 `codex-author-knowledge` 路由命名）。OpenClaw 侧由
`openclaw/project_knowledge/review_publisher.py` 保存审核任务、执行 Vault Topic
Resolution、内容审核、独立发布审核、Accepted Wiki Change Set 冻结和 exact
Publisher；发布通过前不会写入 Obsidian。当前测试使用注入式 memory-wiki fake，
不触碰真实 Obsidian Vault；真实 OpenClaw 运行时接线仍需部署该 Skill/适配器。
发布后的 `Publication Receipt` 由 FastAPI 主动轮询
`GET /v1/apps/mmd/project-knowledge/runs/{run_id}/publish-status` 拉取并写入
独立审计镜像表；`POST /codex/knowledge/publication-receipts` 仅保留为本地测试/
兼容入口，生产回执不回跳、不重新创建 delivery。如果 Git 已创建提交但 push 失败，
Publisher 保留失败回执和提交信息，不自动 reset 旧 revision。

## 5. 主调用链：前端发消息

```text
User sends message in Chatbox
  -> web/src/lib/api.ts postSessionMessage()
  -> POST /sessions/{session_id}/messages
  -> FastAPI Message Service
  -> SQLite insert user message
  -> OpenClawClient.stream_reply() when OPENCLAW_STREAM_MODE=http_sse
  -> POST {OPENCLAW_BASE_URL}/v1/responses stream=true
  -> normalize_assistant_reply()
  -> SQLite insert assistant message
  -> resolve motion action against favorite VMD assets
     (exact token first; then controlled fallback for think/thinking_tilt or akimbo/叉腰)
  -> optional TTS flow
  -> response returns user_message + assistant_message
  -> frontend updates Chatbox and MMD stage
  -> Chatbox receives chatAutoScrollRevision and scrolls the normal-flow message list to latest for the optimistic user message and assistant reply
```

如果当前 Chatbox 会话来自 OpenClaw Bridge 绑定，`sessions.openclaw_session_key` 必须等于 Bridge 的 `external_session_key`，也就是 Feishu session key。这样用户从本项目继续发送文本时，HTTP `/v1/responses` 会通过 `x-openclaw-session-key` 回到同一个 Feishu channel 会话，而不是创建本地 `openclaw:{uuid}` 分支。

Companion 顶栏只常驻显示 `USER` 和短 `SESSION`，不再把长会话 title/Feishu 标识直接铺在 header 上。完整当前会话标识由右侧 `#` 浮窗在 hover/focus 时展示，优先取 `sessions.openclaw_session_key`，否则回退到本地 session id 和会话 title。`#` 按钮和浮窗之间保留透明 hover 桥接区域，且浮窗本身允许 pointer events，因此鼠标可以从按钮移动到浮窗内容上继续查看。

核心文件：

| 层 | 文件 |
| --- | --- |
| 前端 API 包装 | `web/src/lib/api.ts` |
| Message Service | `api/app/routes/message_service.py` |
| OpenClaw HTTP client | `api/app/services/openclaw_client.py` |
| 回复解析 | `api/app/services/response_parser.py` |
| 数据存储 | `api/app/db/store.py` |

失败行为：

| 失败点 | 当前行为 |
| --- | --- |
| OpenClaw 调用失败 | 写入 fallback assistant message，`degraded=true`，写 retry job |
| OpenClaw `/v1/responses` 读超时 | 主消息链路默认走 `stream=true`；收到完整 JSON 后立即返回，不强等 `response.completed`；若 stream 超时但已有内容，会以 partial 结果继续解析，避免直接丢弃；非流式/关闭 streaming 时不做同请求立即重试 |
| OpenClaw 空内容 | 视为失败，进入 fallback |
| 回复 JSON 不完整 | `normalize_assistant_reply()` 做兼容，缺动作时 fallback idle |
| 动作无法匹配 VMD | 先按 `asset_id`、显示名、文件名和 motion template 精确匹配；如果请求是 `think`/`thinking`/`thinking_tilt`，再从当前模型 `03_thinking_waiting` 收藏目录中按 `100pct`、`reference`、`思考` 命名优先级选择参考 VMD；如果请求是 `akimbo`/`hands_on_hips`/`hands-on-hips`/`arms_akimbo`/`arms-akimbo`/`叉腰`，再从当前模型 `06_strong_personality` 收藏目录中按 `100pct`、`reference`、`叉腰` 命名优先级选择参考 VMD；仍未命中时 `motion_resolution.status=fallback_idle`，前端会随机抽取当前模型 `00_idle_loop` 中的 VMD 作为兜底；没有 idle VMD 时才回退默认 procedural idle |

## 6. 音频服务调用链

当前音频由独立 Voice Workflow TTS 服务提供，不由 OpenClaw `/v1/audio/speech` 提供。

### 6.1 消息内 TTS

```text
POST /sessions/{session_id}/messages
  with tts_enabled=true
    -> create assistant message
    -> VoiceWorkflowTtsClient.submit_task()
       POST {TTS_SERVICE_BASE_URL}/api/v1/tts
    -> wait_for_reference(TTS_SYNC_WAIT_SECONDS)
       GET {TTS_SERVICE_BASE_URL}/api/v1/tasks/{task_id}
    -> if completed:
         message_tts.status=ready
         remote_audio_url saved
       else:
         message_tts.status=pending
         tts_jobs enqueue
         background worker continues polling
```

后台 worker：

```text
run_message_tts_worker()
  -> claim_next_tts_job()
  -> GET /api/v1/tasks/{task_id}
  -> completed: finalize_message_tts(status=ready)
  -> failed: finalize_message_tts(status=failed)
  -> pending/processing: reschedule_tts_job()
```

`pending`/`processing` 是 TTS 服务的非终态。后台 worker 不再因为本地轮询次数达到 `TTS_SERVICE_MAX_POLL_ATTEMPTS` 就把任务置为 failed；只有 TTS 服务显式返回 `failed`，或状态查询连续异常达到阈值时，才会失败。这样较长文本可以继续排队等待完成。

播放代理：

```text
Frontend sees assistant_message.tts.proxy_audio_url
  -> GET /api/backend/tts/proxy/{tts_id}?user_id={user_id}
  -> FastAPI fetches remote_audio_url
  -> returns audio bytes to browser
```

浏览器 `<audio>` 不能附带 `x-user-id` header，因此消息内 TTS proxy 同时接受 `?user_id=...`。前端播放顺序优先使用 `proxy_audio_url` 经 Next.js `/api/backend/*` 同源代理访问；只有代理播放失败时才回退到 `remote_audio_url`，避免浏览器直接访问 TTS 内网地址。

Bridge 会话中的前端消息刷新不只比较 message id，也会比较消息内容和 TTS 引用签名（`tts.status`、`remote_audio_url`、`proxy_audio_url`、`task_id`、`error` 等）。因此长文本 TTS 先返回 `pending`、后台 worker 后续写成 `ready` 时，即使 message id 不变，Chatbox 也会用服务端最新消息覆盖本地旧状态，并拿到可播放的音频代理 URL。

### 6.2 直接 Server TTS

```text
Frontend requestServerTts()
  -> POST /tts/speak
  -> VoiceWorkflowTtsClient.synthesize()
  -> submit task
  -> poll until completed
  -> download audio
  -> FastAPI returns audio bytes
```

### 6.3 Realtime Voice 侧链路

Phase 1 已接入为“消息服务主链路 + 语音 WebSocket 侧链路”：

```text
POST /sessions/{session_id}/messages with tts_enabled=true
  -> Message Service 保存 user/assistant message
  -> 长任务 message_tts 仍作为 fallback 兜底
  -> frontend prepareAndPlayAssistantTts()
  -> WS /ws/sessions/{session_id}/voice?user_id={user_id}
  -> send synthesize(message_id, job_id, text)
  -> FastAPI session voice queue
  -> VoiceWorkflowTtsClient.synthesize_chunk()
     POST {TTS_SERVICE_BASE_URL}/api/v1/tts/chunk
  -> in-memory realtime chunk registry
  -> audio_ready(job_id, sequence, audio_url)
  -> frontend AudioQueue ordered playback
  -> GET /api/backend/tts/proxy/realtime/{session_id}/{job_id}/{sequence}?user_id={user_id}
  -> FastAPI fetches remote chunk audio and returns bytes
```

当前前端策略：

- 同一时间只播放一个 realtime chunk，按 job 首次入队顺序 + sequence 顺序播放。
- Companion 页面采用前端音频互斥策略：任意新的消息 TTS、浏览器朗读、realtime voice 或右侧每日播客开始播放前，都会先停止旧的播放源，保证同一页面内只有一个语音/音频在播放。
- 新的 realtime voice job 发送前会取消旧 realtime queue 并向 WebSocket 发送 `cancel(scope="all")`；取消后的旧 job id 会被前端记录，后续晚到的 `audio_ready/error/done` 事件会被忽略，避免旧片段在新语音之后重新响起。
- 右侧每日播客 `<audio>` 会向 Companion 页面注册 stop 回调；播放播客前会先停止消息 TTS、浏览器朗读和 realtime voice，播放消息语音或 realtime voice 前也会停止播客。
- 会话切换、新建会话、组件卸载会发送 `cancel(scope="all")` 并清空本地 AudioQueue。
- chunk 播放前失败时自动回退到长任务 `message_tts`；已经播放过部分 chunk 后失败时标记 `partial_failed`，不自动重播完整语音。
- realtime chunk 合成出现未预期异常时，WebSocket 返回 `error { message_id, job_id, detail }`，前端按“未播放 chunk”路径回退到长任务 `message_tts`。

## 7. OpenClaw Bridge 调用链

Bridge 是“同步 OpenClaw/Feishu 已有会话消息到本地”的链路，不是前端发消息的主链路。

```text
FastAPI lifespan
  -> if admin_user_ids and OPENCLAW_TOKEN:
       MessageBridgeService.run_forever(admin_user_ids[0])
         -> OpenClawGatewayProvider.connect()
         -> WebSocket RPC connect
         -> sessions.list
         -> prefer Feishu direct sessions, then choose latest updated_at
         -> resolve local session by external_session_key
            -> first reuse a local session that already has message_bridge messages for the same key
            -> otherwise reuse an existing binding session for the same key
            -> otherwise create a new local session
         -> create/update local binding
         -> chat.history(limit=100)
         -> insert messages into local SQLite
         -> sessions.messages.subscribe
          -> receive session.message events
          -> insert realtime messages into local SQLite
```

Bridge 创建或修复默认 binding 时，会让本地 `sessions.openclaw_session_key` 对齐到 `message_bridge_bindings.external_session_key`。启动自动选择默认 binding 时，如果当前默认 binding 已经是 `agent:<agent_id>:feishu:direct:<target_id>` 形式的 Feishu 私聊 session，且该 session 仍出现在 OpenClaw sessions 列表中，后端会保留这个 direct 默认绑定，避免 WebSocket 重连或自动 ensure 把前端会话漂移到 `agent:main:main`。只有不存在可用的既有 direct 默认绑定时，后端才会优先选择 direct session 并按 `updated_at` 选择最新项；不存在 direct session 时才回退到 `agent:main:main`、subagent、group 等其他 session。切换默认 binding 或启动自动选择 session 时，后端会先查本地 `messages.metadata.external_session_key`，如果已有同一外部会话的 Bridge 消息，会复用该历史 `local_session_id`，避免把同一个 Feishu 私聊切到一个新的空本地 session。只有找不到历史消息和既有 binding session 时，才创建新的本地 session；随后仍会调用 `chat.history(limit=100)` 拉取远端历史。前端启动后会静默读取 Bridge 状态；当 Bridge 启用且存在默认 binding 时，Chatbox 会自动打开该 binding 的 `local_session_id`，再按 `MESSAGE_BRIDGE_POLL_INTERVAL_MS` 刷新消息。Bridge 轮询刷新会用本地当前消息 id 与服务端消息 id 对比出新增项；如果新增项来自 Dashboard/Feishu 远端同步，前端会触发 `chatAutoScrollRevision` 滚到最新，避免消息已入库但停留在历史滚动位置导致看起来“没拿到”。这样 Feishu channel、OpenClaw HTTP 生成链路和当前 UI 会话会落在同一个 session key 上。

`POST /admin/message-bridge/bindings/default` 的主路径是“更新默认 binding -> 对齐本地 session key -> 拉取 `chat.history` -> 前端打开本地 session”。`sessions.messages.unsubscribe/subscribe` 只负责后续实时增量订阅刷新；如果这一步 RPC 报错，后端会记录 `message_bridge.openclaw.unsubscribe` 或 `message_bridge.openclaw.subscribe` 的 error trace，并把 `message_bridge_state.websocket_status` 标为 `reconnecting`、`last_error` 写入错误原因，同时关闭当前 provider 连接，让后台 `run_forever` 重新建连并重新订阅；接口仍返回新的 binding，避免历史消息已经同步成功却因为订阅刷新异常导致前端不打开会话。

Bridge 实时 consumer 不只依赖 `sessions.messages.subscribe` 推送。`_consume_events()` 等待实时事件时，每隔约 15 秒会对当前默认 binding 调用一次 `chat.history(limit=20)`，以 `source=realtime_backfill` 写入本地。这样 Dashboard/Feishu 侧更新了同一个 OpenClaw session 但 WebSocket subscription 漏推时，本地最多延迟一个 backfill 周期也会补齐；写入仍走 `openclaw_message_id` 去重。

当本项目在 Bridge 绑定会话里通过 HTTP `/v1/responses` 发送消息时，OpenClaw/Feishu 侧可能同时通过 Bridge WebSocket 回流同一条 user/assistant 消息。后端会把本项目主链路插入的带 `trace_id` 消息作为权威展示消息：Bridge ingest 若发现同 session 近期已有同 role/content 的本地 trace 消息，会跳过该回声；Message Service 完成本次 user/assistant 落库后，也会软删除本次请求期间已经写入的同 `openclaw_session_key` Bridge 回声；`GET /sessions/{session_id}/messages` 和 Message Service 组装 OpenClaw history 时还会做列表层兜底过滤，隐藏 5 分钟窗口内同 session、同 role、同内容、无 `trace_id` 且 `metadata.source=message_bridge` 的 echo。OpenClaw WebSocket 有时会为同一条 Feishu 实时消息给出两个不同 external id；Bridge ingest 对 `realtime`/`realtime_backfill` 的同 external session、同 role、同内容、30 秒窗口重复项做语义去重，覆盖约 15 秒一次的 backfill 延迟回放；Chat API 也会对已经落库的近邻重复项做展示兜底过滤。原始 Bridge 消息仍保留在 SQLite，方便排障，但 Chatbox 不再展示这些重复项。

Bridge ingest 会保留 OpenClaw 原生隐藏字段 `openclawMetadata`，并在 `openclawMetadata.source == "greeting-cron"` 时写入本地 `messages.metadata.openclaw_metadata`、`messages.metadata.greeting_cron` 和 `messages.metadata.auto_tts=true`。如果历史消息没有原生 metadata，后端会读取 `OPENCLAW_GREETING_DASHBOARD_INDEX_PATH` 指向的 JSONL 旁路索引，默认路径为 `api/data/openclaw/greeting-dashboard-injections.jsonl`；按 `dashboardSessionKey` 加 `dashboardMessageId`/`feishuMessageId`、正文或 180 秒时间窗口 join 后，把问候来源补到本地 metadata。匹配到 `auto_tts=true` 且消息尚无 `message_tts` 时，Bridge 会调用同一套 `message_tts` 长任务链路提交 Voice Workflow TTS；同步等待超时则写入 pending 引用和 `tts_jobs`，由后台 worker 继续轮询。

`messages.visibility` 是 Chat API 的展示边界，默认值为 `chat`。Bridge 同步到的内部控制事件仍落库，但会写为 `visibility=internal` 并在 metadata 中标记 `message_kind=control`、`control_reason`；当前包括 `system: Compaction` 和 assistant 失败占位 `[assistant turn failed before producing content]`。`GET /sessions/{session_id}/messages` 通过 SQLite 索引 `(workspace_id, account_id, session_id, deleted_at, visibility, created_at)` 只查询 `visibility=chat` 的消息，因此 Chatbox 默认不展示内部控制消息；`list_messages()`、Bridge/debug/health 相关读取仍可查看原始落库消息。

Bridge 不再落库 OpenClaw assistant 空消息占位。当外部 assistant 消息正文为空，且本地解析结果为 `parse_mode=empty` 时，后端只写 `message_bridge.openclaw.message.skipped` trace，reason 为 `empty_assistant_message`，不会把 `I am here. Let's keep going.` 这类本地 fallback 文案写入 `messages`。

Admin API：

| Endpoint | 作用 |
| --- | --- |
| `GET /admin/message-bridge/status` | 查看 Bridge 状态和当前绑定 |
| `PATCH /admin/message-bridge/settings` | 开关 Bridge 和实时驱动 |
| `GET /admin/message-bridge/openclaw/feishu/sessions` | 列出 OpenClaw Feishu sessions |
| `POST /admin/message-bridge/bindings/default` | 切换默认绑定 |
| `GET /admin/runtime-health` | 只读本地运行状态快照：API 进程、OpenClaw 配置、Bridge 状态/绑定/最新消息、TTS 队列、SQLite 计数、recent error trace |

Codex Interactive API：

| Endpoint | 作用 |
| --- | --- |
| `GET /codex/workspaces` | 列出 env 配置的 Codex workspace 和 SQLite 中 UI 登记的 workspace |
| `POST /codex/workspaces/path-picker` | 由后端在本机拉起目录选择框，返回用户选择的 workspace 路径或 `null` |
| `POST /codex/workspaces` | 由 admin allowlisted 用户登记新的本地 git repo root workspace，写入 `codex_workspaces` |
| `POST /codex/interactive/sessions` | 创建只读或 patch Codex session；patch 模式会创建独立 git worktree |
| `WS /ws/codex/interactive/{session_id}` | Codex Console 事件流，支持 user message、cancel、approval decision、close |
| `GET /codex/interactive/{session_id}/diff` | 从 session worktree 读取 changed files、stat 和 patch，并写入 diff artifact |
| `POST /codex/interactive/{session_id}/approvals/{approval_id}` | 持久化 `approve_once` 或 `deny` 决策、写入 approval event，并回传给 app-server |
| `POST /codex/interactive/{session_id}/checks` | 在 worktree 内运行后端配置的 checks，并写入 checks artifact |
| `POST /codex/interactive/{session_id}/apply` | 在 approval/clean/confirm/apply-check gate 后，把 worktree patch apply 到主 workspace |
| `POST /codex/interactive/{session_id}/discard` | 关闭 session，并按请求移除对应 worktree |
| `POST /codex/reviews/sessions/{pet_session_id}/enqueue` | 手动为指定 desktop-pet Codex session 生成 evidence pack 并写入 OpenClaw review outbox |

`GET /messages/greetings/latest` 会从本地 SQLite 查当前用户最新一条 `metadata.greeting_cron` 或 `metadata.auto_tts=true` 的 assistant 消息，并返回同一个 message response 结构（含 `tts` 引用）。Companion 页面进场时会调用该接口，气泡优先显示这条问候文本；如果该消息的 `tts.status=ready` 且有 `remote_audio_url` 或 `proxy_audio_url`，前端会在本页会话内只自动播放一次对应语音。找不到问候消息时，气泡回退到当前 Chatbox 最新 assistant 消息或默认文案。

`GET /admin/runtime-health` 不主动调用 `sessions.list`，因此 OpenClaw Gateway WebSocket 握手慢或 Feishu session list 不稳定时，健康后台仍能打开并显示本地已经收到的消息、最后连接时间、最新错误和 TTS/SQLite 状态。Codex health 同样是只读快照，不会为了探测版本而启动 Codex；`codex.codex_version` 来自已 prepare 的真实 app-server session 或 SQLite 中最近的非空版本，`codex.last_error` 来自 provider/runtime 或 SQLite session error，`codex.workspaces` 同时列出 env workspace 和 SQLite UI-mounted workspace。前端 `/status` 页面每 5 秒读取一次该接口；Companion 页面里的 Bridge 状态加载也已经把 `GET /admin/message-bridge/status` 和 `GET /admin/message-bridge/openclaw/feishu/sessions` 解耦，后者超时只会标记 session list 不可用，不会清空本地 Bridge status，也不会停止 2.5 秒一次的消息刷新轮询。`/admin/message-bridge/openclaw/feishu/sessions` 失败时返回 502，并写入 `message_bridge.openclaw.sessions.list` error trace，避免 ASGI 500 堆栈遮蔽根因。

Bridge 依赖 OpenClaw WebSocket RPC 的 operator 权限和 scopes：

```text
operator.admin
operator.read
operator.write
operator.approvals
operator.pairing
```

Cron 问候正文仍来自 OpenClaw/Feishu history 或 `OPENCLAW_GREETING_DASHBOARD_INDEX_PATH` 旁路索引，API 不会用 Voice Workflow 的 `.txt` 覆盖 `messages.content`。Cron 问候语音优先走远程 Voice Workflow 接口 5：`metadata.greeting_cron.audioFile` 或 `textFile` 存在时，后端只接受包含 `/eula_emotion_revelation/` 的 Voice 存储绝对路径、明确相对存储路径，或明确文件名兜底。`audioFile` 是 `.ogg`/`.wav` 时优先按 metadata 的真实音频路径探测，例如 `关心温柔/afternoon_20260518_1400.ogg`；如果该路径短时间内仍不可用，再尝试同名前缀 `.wav` 兜底。`textFile` 和 `.meta.json` 仍推导为同名前缀 `.wav`。后端会用 ranged GET 轻量探测 `{TTS_SERVICE_BASE_URL}/api/v1/eula-storage-audio/{path}`，每个候选路径最多短重试 3 次；重试等待按线性累加，基准值为 `min(TTS_SERVICE_POLL_INTERVAL_SECONDS, 1s)`，默认等待序列为 `1s -> 2s`。只有响应为 2xx/206 且 `content-type` 是 `audio/*` 时，才直接写成 ready 的 `message_tts.remote_audio_url`，不调用 `POST /api/v1/tts`。如果接口 5 返回 404、非音频 2xx 或探测失败，则回到原 `submit_task + wait_for_reference` 链路，用当前问候正文生成对应语音。

## 8. MMD/VMD 资源链路

```text
Frontend model selector
  -> GET /assets/mmd/models
  -> FastAPI scans MMD_ROOT_DIR recursively for .pmx/.pmd
  -> returns model url
  -> MMDStage loads /assets/mmd/{file_path}
  -> textures resolved relative to model package
```

VMD/favorite motion：

```text
Upload VMD
  -> POST /assets/vmd
  -> asset_registry insert
  -> file stored under API data storage
  -> PATCH /assets/vmd/{asset_id}
       favorite=true
       model_relative_path=<selected model>
  -> Message Service resolves assistant action/motion_plan
       against favorites owned by the selected model only
        usage VMD auto-sync is serialized before SQLite asset_registry writes
```

收藏 VMD 按模型归属存取，归属关系保存在 SQLite 表 `asset_model_favorites`，主键为 `(user_id, model_relative_path, asset_id)`。`PATCH /assets/vmd/{asset_id}` 收藏时必须提供 `model_relative_path`，并校验该模型确实存在于 MMD 根目录下；同一个 asset 可以被多个模型各自收藏，互不影响，取消其中一个模型的收藏不会影响其它模型。收藏不复制文件、不建软链，也不依赖 `MMD/usage/vmd/<模型目录名>[动作]/` 这类目录布局：动作文件仍存放在 `MMD/usage/vmd/` 共享素材目录，模型归属由表记录表达。模型相对路径做归一化，反斜杠与正斜杠视为同一路径。重命名也按模型隔离，只改该模型自己看到的名称。

`MMD/usage/vmd/<模型目录名>[动作]/` 的分类子目录（`00_idle_loop`、`02_greeting_social` 等）仍然作为动作意图分类使用，但它不再决定收藏归属；分类信息由 asset 的 slot 与动作目录名推断。

不再存在「优菈目录作为唯一权威来源」和「递归复制到 `_builtin` 供所有模型继承」这两条旧规则：旧优菈目录，连同由它复制出的 `_builtin` 共享动作库，都不再被登记为收藏，也不再进入其它模型的收藏页、聊天动作解析、点击动作或待机池。`_builtin` 目录本身若存在，仍会被读取为共享非收藏资产，但不参与收藏归属判定。

默认待机优先使用当前模型在 `asset_model_favorites` 中的有效收藏（所有分类，不做腿部幅度筛选）；没有任何有效收藏时才回退 `_builtin` 的 `00_idle_loop`，最后才 procedural idle。`01_entry_fallback` 不得进入默认待机循环。

收藏 VMD 可按动作意图存放在各模型动作目录的分类子目录中：

```text
MMD/usage/vmd/<模型目录名>[动作]/
  00_idle_loop/              # 默认待机随机循环
  01_entry_fallback/         # 初始化、兜底姿态
  02_greeting_social/        # 打招呼、行礼、社交开场
  03_thinking_waiting/       # 思考、等待、超时
  04_answering_explain/      # 回答、介绍、解释、结论
  05_soft_emotion/           # 安抚、害羞、偷笑等轻情绪
  06_strong_personality/     # 炫耀、叉腰、轻蔑、暧昧等强语气
```

`/assets/mmd/vmds` 和 `/assets/vmd` 都支持递归扫描这些子目录。`asset_registry.favorite_relative_path` 需要保存完整分类路径，`asset_registry.favorite_model_relative_path` 记录归属模型；如果移动收藏 VMD 文件，必须同步更新 SQLite 中对应的 `favorite_relative_path`，并在 `relative_path` 或 `source_relative_path` 指向 `MMD_ROOT_DIR` 文件时同步更新这些字段。

收藏、下载和删除三条路径必须共用 `_resolve_vmd_asset_file_path` 定位源文件：动作可能只存在于 `MMD_ROOT_DIR`（例如 `usage/vmd/_builtin/` 共享动作目录，或同步登记进库的 `[动作]` 目录文件）而不在 API 存储目录，只查 `data_dir` 会让这类动作点收藏时报 `Asset file missing.`，删除时又会漏删 MMD 目录里的真实文件并让资源扫描把它重新登记回来。

`_sync_favorite_copy` 必须处理源文件与收藏目标文件是同一路径的情况：动作本身就在 `usage/vmd/<模型目录名>[动作]/` 内时不能再调用 `shutil.copyfile`（抛 `SameFileError`，接口变成 500）。目标文件已存在时直接复用并返回既有路径，不生成编号副本。

本地运行中的 API 进程不会热加载已修改的源码。改动 `api/app/**` 后必须重启 8100 上的 uvicorn 进程，否则浏览器仍然拿到旧行为，表现为「代码已修但接口还是报错」。

同一模型、同一规范化动作名在磁盘上只保留一个收藏文件。重复收藏同一动作（同一个 VMD 被导入成多条资产记录）复用既有文件，不退化成 `name (2).vmd` 编号副本；多条资产记录可以指向同一个 `favorite_relative_path`。

VMD 收藏动作按 canonical 资产维护：同一用户、同一模型、同一分类、同一规范化动作名只保留一条 `asset_registry` 记录，磁盘上不保留 `name (2).vmd` 这类同名编号副本。重复收藏同一动作会复用既有收藏路径，不会在 `[动作]` 目录里堆出编号副本。新增或重新导入动作后，需要检查 `MMD_ROOT_DIR/usage/vmd/**` 和 `asset_registry`，避免编号副本重新进入前端待机池、点击动作池或 OpenClaw motion_key inventory。

给 OpenClaw 或其他 agent 选择 VMD 动作用的 motion_key、分类策略和各模型动作 inventory 维护在 `docs/architecture/openclaw-vmd-motion-selection-guide.md`。导出接口 `POST /motion-context/exports` 与 `GET /motion-context/exports/latest` 按 `selected_model_path` 返回该模型自己目录下的收藏集合。

前端舞台动作状态机：

```text
CompanionPage stageInteractionState
  -> stageInteractionMachine
     modes: default_idle / autoplay_loop / manual_preview / chat_vmd_action / chat_procedural_action / stage_click_vmd_action / stage_click_procedural_action / recovering
  -> MMDStage receives the current interaction only
  -> MMDCompanionRuntime（Three.js）或 RezeWebGpuStage（reze-design/reze-k3）执行 procedural/VMD playback
  -> MMDStage reports complete/error back to CompanionPage
  -> CompanionPage returns to fresh favorite autoplay loop, or default procedural idle when no favorite loop exists
```

`stageInteractionMachine` 是页面业务状态层，负责把“`00_idle_loop` 待机循环、手动预览、聊天触发动作、人物点击触发动作、VMD 异常立即恢复、完成后回到待机”统一成显式状态。`MMDStage` 和 `MMDCompanionRuntime` 仍只负责加载模型、播放 VMD/程序动作、上报播放完成或错误，不持有业务队列或恢复策略。

语音播放向 `MMDStage` 传递 `speaking` 状态，同时 server/remote TTS 和 realtime voice chunk 会复用播客波形逻辑生成音频 envelope：前端用 `AudioContext.decodeAudioData()` 解码音频，再用 `computePeaks()` 得到幅度序列。播放时按 `audio.currentTime` 采样当前 level，并通过 `MMDStage.setSpeechLevel()` 传给 `MMDCompanionRuntime.updateMorph()` 驱动口型开合；停顿或低幅度会收嘴，音量越大开口越大。

中文口型同步在前端先走轻量 viseme 层：`speechViseme.js` 根据 TTS 文本把常见汉字映射到拼音，再按韵母生成 `A/I/U/E/O/M/sil` 时间轴；`b/p/m` 等双唇音会先给一个闭嘴 `M`，`ao/iao/uo` 等复合韵母会拆成连续嘴型。server/remote TTS 和 realtime voice chunk 在播放时通过 `createSpeechVisemeSync()` 按 `audio.currentTime` 调用 `MMDStage.setSpeechViseme()`，Runtime 优先按 viseme 驱动 `mouthA/mouthI/mouthU/mouthE/mouthO`，并继续用 envelope level 控制开口强度。若没有可用文本、文本无法识别、音频无法解码、跨域获取失败，或使用浏览器 `speechSynthesis`，Runtime 会回退到相对语音开始时间的慢周期嘴型，默认 520ms 一个开合周期、开口范围约 `0.18-0.60`，避免旧的绝对时间 `abs(sin)` 在约 150ms 内完成一次快速 flap。后续 Voice Workflow 若返回真实 viseme 时间戳，可直接替换前端文本推断出的时间轴。

渲染模式仍由前端 `renderPipeline` 隔离选择。`classic`、`hero-shot`、`genshin`、`mio-reference` 保持既有 Three.js/MMD runtime；新增 `k3` 是视觉向的高精细渲染模式：复用 classic 的透明背景与截图构图，把 pixelRatio 上限放宽到 3，key 光阴影贴图提升到 4096，卡通渐变从 3 阶细化到 4 阶；材质策略在 Project2 式清理（alphaTest、DoubleSide、mask 抑制、glow 识别）基础上按 face/skin/hair/cloth/metal/eye 分档调节高光与环境反射，皮肤保留微暖 emissive，非皮肤材质保留并按分档打折 MMDLoader 从 PMX ambient 写入的 emissive（ambient×0.2，深色系模型暗部可读性的关键），眼睛提亮 emissive 与环境反射，眼部高光/阴影叠加层（如 Eyes+/EyeShadow）不做 alphaTest 裁切、改透明渲染并用 polygonOffset 提到眼球表面前（否则会被眼球深度挡掉），模型加载完成后延迟扫描替换加载失败的 gradientMap（PMX toon 指向空贴图路径时 MeshToonMaterial 的 direct light 会被采样成 0，虹膜、牙齿等材质会发闷变黑），同时启用细轮廓线和色彩分级；postfx 色彩分级 shader 负责最终的 linear→sRGB 转换（`linearToSRGB`，仅 k3 开启）：EffectComposer 链在渲染目标里是线性空间而 ShaderPass 不做色彩空间转换，缺少这一步整条链会以线性值直接上屏导致画面发暗，renderer 的 toneMapping 设置在 postfx 链内不生效；bloom 关闭（`bloomStrength: 0`），因为 three-stdlib 的 UnrealBloomPass 在透明画布上会把 `background: null` 的舞台涂黑（reze-npr 在校准页同样受影响），K3 改用色彩分级维持通透感。它不接管模型加载、VMD 播放、骨骼捕获或交互状态，只改变呈现层。`reze-npr` 是 reze-engine 启发的实验模式，只迁移可在现有 Three.js 管线中低风险复刻的显示能力：按 PMX 材质名推断 face/body/hair/eye/stockings/metal/cloth 预设、对丝袜和 cutout 材质启用 Three.js `alphaHash`/`alphaToCoverage`、启用独立轮廓、ACES tone mapping、轻量 bloom 和 reze 风格灯光。`reze-design` 则是对 `D:\workspace\reze-design\reze-design` 默认示例舞台的独立复刻配置：使用 `#4b004f` 紫红底色、`Shining Stars` 同类星空层、`#ed6aff` 世界光、205° 方位/21° 仰角的白色主光、强度 0.05 的低泛光，以及 `#c800de` 半透明地面和 `#fafaf9` 网格；在 Three.js 中继续复用 `reze-npr` 的 PMX 材质分类。二者均不接管 reze-engine 的 WebGPU renderer、PMX loader、VMD/IK/物理或 picking，因此不会改变现有模式的模型加载、VMD 播放和交互语义。`mio-reference` 当前默认开放镜头来自 2026-05-21 导出的 `Render Config`：`fov=32`、`position=[-9.39,12.522935,43.63]`、`target=[-1.861732,-2.847643,1.048369]`、`locked=false`，OrbitControls 的 `maxDistance` 仍为 72；页面启动时会把本地会话里的 `mio-reference` 镜头迁移到这组默认参数，避免旧 localStorage 覆盖默认构图。

`reze-design` 的当前定义以用户提供的参数截图为准，并覆盖上述早期紫红网格描述：白色主光强度为 1.35、方位 55°/仰角 28°，环境光为 `#fef2f2` / 0.40，泛光为 `#fef2e2`、阈值 0.81、强度 0.09；相机距离为 26.2，目标为 `[0,11.4,0]`。该模式不自行绘制背景或网格地面：`MioModeBackground` 在 `reze-design` 下与 `mio-reference` 一样启用，透明 WebGL 画布只保留 MIO 兼容的 shadow catcher/contact shadow 接地层；材质仍复用 `reze-npr` 分类。

主站 `/companion` 的高级功能在 Reze 渲染模式下切换为贴左侧、全高的 Reze 编辑器 Dock：窄工具轨提供“材质 / 场景”入口，右侧检查器沿用原项目的分组顺序。场景页通过 `MMDStage` 转发 `MMDCompanionRuntime.setSceneDebugSettings()`，实时更新 ambient/hemisphere/key 光、`UnrealBloomPass`、阴影接地层与 OrbitControls/camera；支持调色占位、锁定的 MIO 星海背景、主光/世界光/泛光颜色与强度、方位/仰角、接地层阴影/透明度以及相机目标。“恢复默认”回到用户截图参数。材质页以 PMX 实际材质建立与参考编辑器一致的“样式组”树：Body、Eye、Face、Hair、Smooth Cloth 和未分组。每个已映射样式组提供右侧的可执行预设入口；顶部“素材库”会对当前选中材质提供 `角色皮肤`、`面部`、`眼睛`、`头发`、`柔滑布料`、`金属`、`半透材质`等预设。选择单个预设或批量应用样式组都会调用 `setMaterialPreset()`，真正更新 Three.js 材质或 WebGPU style group；选中项详情继续通过 `updateMaterialDebug()` 临时修改 `visible`、`opacity`、`emissiveIntensity`，可按条目重置。该接口只持有运行时内存状态，模型重载、模式切换、页面重建或重置均不写回 PMX/VMD、共享配置或动作数据；材质 ID 在清除模型时一并清空，避免模型切换后引用失效对象。它复刻编辑器结构和可由 Three.js 真实执行的控制，不包含 reze-engine WebGPU/WGSL 节点材质图。

Reze 编辑器场景文档位于 `web/src/features/stage/rezeEditorScene.ts`，使用浏览器 localStorage 键 `mmd_reze_editor_scene_v1:<userId>:<modelPath>` 按用户和模型隔离保存。文档存场景参数、调色预设、背景效果和材质预设分配，并支持 JSON 导入/导出。材质分配不能使用 Three.js `uuid`：每次加载 PMX 都会创建新对象；`getMaterialDebugEntries()` 改用模型遍历顺序中的稳定键 `mesh:<meshIndex>:material:<materialIndex>`。`setMaterialPreset()` 是当前可执行的独立 Three.js 材质图适配层，映射眼睛、金属、半透、皮肤/面部、头发和布料预设到 `MeshToonMaterial` 的 shininess、emissive、opacity、transparent、alphaTest 等字段；不在这一列表中的 reze-engine WGSL 节点不得标记为可渲染。

编辑器工具轨的“资产”页只调用现有的 `handleCharacterSwitch()` 与 `handleAdvancedUpload()`，因此 PMX 选择、VMD 导入、MMDLoader、VMD helper、Grant solver 和动作资产目录仍由既有主站链路负责。“渲染”页通过 `MMDStage.captureStagePng()` 调用 `MMDCompanionRuntime.capturePngDataUrl()`；后者先走 runtime 正常 `renderScene()`，再读取 `renderer.domElement.toDataURL("image/png")`。该输出是 Three.js WebGL canvas，不包含页面 `MioModeBackground` 的 CSS 星海层，也不合成 UI；视频导出与 CSS/WebGL/音频合成必须作为单独后续链路实现，不能以 PNG 能下载推断为视频导出完成。

`reze-k3` 是与 `reze-design` 并列的 `RenderPipeline` 枚举值，复用同一个 `RezeWebGpuStage`（reze-engine WebGPU）运行时底座，材质、场景、本地 PMX 导入和编辑器 Dock 行为与 `reze-design` 完全一致，仅语义定位为"复刻 reze-design 项目 MMD 渲染能力"的承接位；两者场景文档、相机快照按 `userId + modelPath + pipeline` 隔离存储，互不影响。桌面 Pet 的 `/desktop-pet/shared-config` 已支持 `reze-k3`：API Literal、`COMPANION_RENDER_PIPELINES` 与 SQLite CHECK 同步扩展，Pet 从主站同步后会复用 `MMDStage` 的 WebGPU 分支加载该模式。

`reze-k3` 的 WebGPU 画布透明（`RezeWebGpuStage` 新增 `transparentBackground` prop，引擎构造 `background: null` 且 `applySceneSettings()` 传 `setBackgroundColor(null)`），不绘制 `#4b004f` 紫红底，由页面 `MioModeBackground` 星海 CSS 背景透出；`MioModeBackground` 激活条件追加 `reze-k3`。`reze-design` 保持不透明紫红底。页面当前管线的 `rezeSceneDebugSettings` 由 `CompanionPage -> MMDStage -> RezeWebGpuStage` 传递，WebGPU 引擎创建时直接使用该配置；运行时变更会先缓存，待 `Engine.init()` 完成后再写入 world、sun、bloom、ground、background 和 camera，避免在 GPU device 尚未就绪时调用引擎写入接口。默认值不再依赖打开 Reze 编辑器 Dock 才首次生效。另修复 `MMDStage` 传给 WebGPU 分支的 `interaction.vmdUrl` 未 `toAbsolute` 的预存缺陷：相对路径 `/assets/...` 此前被请求到 web 前端导致 404，现构造 `webGpuInteraction` 统一绝对化，同时作用于 `reze-design` 与 `reze-k3`。

**历史快照（2026-09-02，已被下方 Stage 2C-M1 取代）**：`reze-k3` 皮肤变体初版仅把 Face/BodySkin 两个 PMX 材质槽绑定到 V14D graph（2/15）；其余角色材质保持原始分组。该轮真实 `/companion` G1-G6、持久化、VMD、管线隔离与独立工程门禁结论仍保留在 `docs/handoff/2026-09-02-reze-k3-v1-stage-visual-acceptance.md`，但不再是当前迁移范围或当前 Hair 门禁。
Stage 2C-M1（codex/v14d-hairab-stage，2026-09-03）定义当前生产变体接线：在权威克莱妲 PMX（GirlsFrontline KoledaDefault.pmx）+ State2 mask 资格满足时，V1 从原分组抽出 Face、BodySkin、HairA、HairB 并分别绑定 V14D graph；默认仍为 original，按「用户 + 模型 + reze-k3 管线」隔离持久化，非克莱妲、缺 mask 或 applyStyleGroups 失败时安全回退 original。Face/BodySkin 继续使用既有实时合成，HairA/HairB 使用 V14D_HAIR_V1_COMPOSITE_GRAPH（renderClass=hair）与独立 V14D_HAIR_HELPER_WGSL，canvas dataset 暴露四槽 draw-call 绑定计数。Face、BodySkin、HairA、HairB为本段历史接线范围；当前Brows/Lashes亦已合并，材质阶段验收与已合并均为6/15，其余9槽尚未迁移；Cth* 衣物/装备、Glock、GunSilencer 永久排除。
Stage 2C-M1.1（codex/v14d-hairab-triuv-gate，2026-09-03）是当前 HairA/HairB 正式门禁定义：每个正式屏幕样本必须同时命中 `engine-pick-material-id-depth` 的对应材质 ID、同槽非索引展开 `triId`、插值 UV 及其三角形 UV 重心校验；目标由权威 `hair_d` 同 UV 线性双线性采样 × `v14dAuthority.js` 唯一导出的 `V14D_HAIR_TINT`，再转显示字节得到。纹理寻址固定为 WebGPU `REPEAT`：四邻域 texel 索引在宽/高方向分别做 modulo，`u/v` 接近 0、1 或越界时跨首尾接缝，不能用边缘 clamp；旧 `targetMean` 仅保留为历史 checkpoint，正式 Gate 不再读取它。
本修正轮把 canvas 像素与材质/triUV 绑定收敛为单个原子 `captureHairTriUv` probe：停止 渲染循环（render-loop）、暂停 VMD、flush、固定渲染帧并等待 GPU 后，在恢复前同时返回 canvas 显示字节、material-ID/depth、triId、插值 UV、`triangleUvs` 及 `captureId/currentSeconds/currentFrame/fps/fpsProvenance`。pixel/triUV 的 width/height 各自必须是有限正整数且 pair 内相等。调用方不得在 probe 外提前抓 Hair 正式 `v1Pix`；读回前后时间推进或 `captureId/currentSeconds/currentFrame/fps/fpsProvenance/画布尺寸` 不一致时拒绝。original 与 V1 各自重建后加载同一权威 `koleda-v14d-authoritative-pose-f120.vmd`，pause+seek 到 `4s / frame 120 / 30 FPS`，`pair.ok` 硬断言为 true，结束或异常均恢复原时间、播放/暂停和循环状态。
本修正轮的 `implementation_commit` 为 `dab71fcd790c9d083c8574a64e4620938e067f96`（仅实现/测试提交；最终分支 HEAD 由交付字段 `final_branch_head_at_delivery` 记录）。正式 `/companion` G1-G6 全过：HairA materialId=24、samples=8,175、coverage=0.072625、origMae=24.554→v1Mae=17.341、drop=0.2938、P95=67→62；HairB materialId=25、samples=12,298、coverage=0.076909、origMae=49.429→v1Mae=34.197、drop=0.3082、P95=102.667→88.667。两槽正式 `targetBinding.consistent=true`、`inputsValid=true`、`triUvResolution=1`，解析/拒绝计数均保留且本次三类拒绝均为 0。错槽/错目标交换负测使用另一槽完整、真实且 triUV 合法的目标流，不再写入强制失败布尔值：analyzer exit=1、`negativeVerdict.status=rejected`、两槽正式/自然指标 Gate 均 false、`inputsValid=true`、`analysisFailures=[]`；HairA 的错目标 `drop=0.0582`、`v1Mae=39.771` 对 canonical `17.341` 的 penalty=22.430，HairB 的 `drop=0.2246`、`v1Mae=37.538` 对 canonical `34.197` 的 penalty=3.341。wrongTint 按既有协议 analyzer exit=0、`negativeVerdict.status=rejected`、两槽正式 Gate=false、`analysisFailures=[]`，错误画布 HairA `v1Mae=65.728`/drop=-1.6769、HairB `v1Mae=75.392`/drop=-0.5253。
`captureHairTriUv` 与所有诊断 pass 只在显式 acceptance probe 下启用；`captureV14dHairRuntimeState` 快照 VMD `currentSeconds`、`playing`/`paused`、`looping` 和采集前 渲染循环（render-loop） 运行态，原子 probe 成功、提前返回或异常都在 `finally` 中恢复原时间与播放状态，且只在采集前循环运行时重新启动。原子 pixel/triUV 证据共享 `captureId/currentSeconds/currentFrame/画布尺寸`，时间推进负测与 original/V1 跨帧配对负测均拒绝，健康证据通过；正式输入门槛为 triUV 解析率至少 99.9%，并保留 `triUvResolvedPixels`、`triUvResolution`、`rejectedNoTriUv`、`rejectedInvalidTri`、`rejectedBarycentric`，当前正式回放两槽均为 100% 解析、三类拒绝均为 0。验收脚本消费 analyzer 完整 JSON，而不是只依赖精简 stdout，避免把预期指标失败误判为 `analysisFailures`。本阶段只迁移 BaseColor，不迁移视角相关高光/各向异性/ToonRamp/ShaderToRGB，也不修改 PMX、VMD、骨骼、权重、Morph、IK、Grant、Physics、拓扑或材质槽。证据位于 `web/.scratch/reze-k3-v1-stage/`、`visual-diff.json`、`visual-diff-swap-slot-target.json`、`visual-diff-wrongtint.json` 与交付报告。

Stage 2C-M1.2（`codex/v14d-hair-gate-contract`，2026-09-03）进一步固定正式 Hair 采集契约：`web/src/features/stage/v14dHairCaptureState.js` 导出的 `V14D_HAIR_AUTHORITATIVE_CAPTURE` 规定 `currentSeconds=4`、`currentFrame=120`、`fps=30`、`fpsProvenance="vmd-standard-fixed-30"`、`animationName=koleda-v14d-authoritative-pose-f120.vmd`；`validateV14dHairCapturePair` 对 original 与 V1 的四份 pixel↔triUV 原子证据执行绝对 fps、来源、秒数、帧号、动画名和配对校验，因此双方同时缺失/错误 fps、错误来源、frame0、错误秒数或同时空/错名不能因彼此相等而通过。`captureHairTriUv` 在 probe 生成时将固定 VMD 标准 fps 与 provenance 写入 pixel/triUV，accept 不再按 frame/seconds 事后补造。G3 的 `gate-report.json` 同时记录 requested/actual seconds、frame、fps、animationName，并逐侧记录 pixel/triUV 的 fps 与 `fpsProvenance`、两侧 captureId、pixel↔triUV pair；同时持久化 `g3-hair-original-atomic.json` 的 `captureEvidence`、`captureState` 和 HairA/HairB 材质解析计数摘要，不要求复制原始 triUV 数组。`analyze-reze-k3-v1-diff.mjs` 的 Hair 默认输入改为 `g3-hair-original-canvas.png` / `g3-hair-v1-canvas.png`，legacy `g3-original-canvas.png` / `g3-v1-canvas.png` 只服务 Face/BodySkin/场景稳定性 lane；accept 内部不注入 Hair 画布环境覆盖。
本修正轮已用四份证据缺失/错误 fps、NaN、Infinity、null、provenance 缺失/错误以及非法画布尺寸负测锁定该硬约束；正式报告中的 pixel/triUV 原子 evidence 是 Gate 的消费输入，不是仅供展示的派生字段。

Stage 2C-M1.3（`codex/v14d-hair-gate-single-authority`，2026-09-03）收口 Hair 正式 Gate 的唯一权威：`web/scripts/analyze-reze-k3-v1-diff.mjs` 的 `evaluateV14dHairFormalGate` 对 HairA/HairB 分别组合 `Changed`、同槽 materialId/原子 triUV 输入合法、绑定一致性和 `targetConvergence.formalGate`；两槽结果写入 `hairFormalGate.formalTargetGate` 与 `hairFormalGate.pass`，任一槽失败都硬阻断正常 analyzer。旧合并矩形 `hair` ROI 不再参与失败数组，只作为 `regions.hair`/`diagnostics.legacyAggregateHair` 的 `diagnosticOnly=true`、`gateRole=report-only` 指标，不能阻断健康样本或污染负测 `analysisFailures`。`evaluateV14dHairNegativeProtocol` 统一 swap-slot-target 与 wrongTint 的拒绝语义：两槽自然指标失败、输入仍合法且无其他分析失败才可 `status=rejected`；swap 保持 analyzer exit=1，wrongTint 保持 exit=0。`accept-reze-k3-v1-stage.mjs` 消费完整 `hairFormalGate`，并在关闭浏览器后显式恢复最终 `process.exitCode`，报告 `summary.exitCode`；PowerShell 复验保存 `$LASTEXITCODE` 后显式 `exit`。本阶段仅修改 Gate 判定/报告消费和文档/测试，不改 Hair tint/graph、生产渲染、Face/BodySkin、灯光/星空/相机、VMD/物理、PMX、材质槽或阈值。


`/mmd-calibration-render` 是给 `imgToAction` 和 Playwright 脚本使用的无外壳渲染入口。页面复用同一个 `MMDStage` / `MMDCompanionRuntime`，通过 query string 接收 `modelUrl`、`vmdUrl`、`renderPipeline` 和可选 camera snapshot；`imgToAction/tools/render-axis-calibration.mjs` 和 `imgToAction/tools/render_action_4view.mjs` 会启动本地静态文件服务，把校准 PMX/VMD 暴露给该页面，再调用 runtime 的 `setCalibrationCaptureMode(true)` 和 `seekVmdFrame(frame, fps)` 对 CSV 帧表中的 target/hold 帧逐帧截图。`render_action_4view.mjs` 可在 WSL 原生 Node 下运行；如果项目根目录存在 `.local-playwright-libs/usr/lib/x86_64-linux-gnu`，脚本会把该路径注入 Chromium 子进程的 `LD_LIBRARY_PATH`，用于补齐无 root WSL 环境里的 Playwright runtime 依赖。校准模式只在脚本捕获时启用：`seekVmdFrame` 直接采样当前 VMD `AnimationClip` 的骨骼 position/quaternion track 并写回 bone transform，而不是依赖 `AnimationMixer` 的非线性 seek；render frame 同时暂停 VMD 时间推进、跳过 MMD helper update、关闭待机 loop、呼吸骨骼偏移和口型/表情叠加，避免截图混入 companion runtime 的 procedural 覆盖；正常 `/companion` 页面仍按原有播放循环和交互状态运行。

历史过程记录（含已被顶部当前口径取代的候选自评，不作为当前验收证书）：Stage 2C-M2a（`codex/v14d-brows-lashes-stage`，2026-09-03）把权威克莱妲 Brows 与 Lashes 两个材质槽接入同一「原始 Reze K3 / Reze K3 V1」切换：`v14dAuthority.js` 新增 `V14D_BROWS_MATERIAL_NAME`/`V14D_LASHES_MATERIAL_NAME` 与 `V14D_BROWS_LASHES_TINT`，`v14dSkinVariantGraphs.js` 新增 `V14D_BROWS_LASHES_V1_COMPOSITE_GRAPH`（graph.name "V14D Brows Lashes V1 Composite"，节点 id `v14d_brows_lashes_tint`），`buildV14dSkinVariantStyleGroups` 把两槽从原 face 分组抽出绑定到独立 V1 分组（renderClass=auto、alphaMode=hashed）。与 Hair 不同，Brows/Lashes 的权威取证（`forensic-v14d-brows-lashes.py` → `brows-lashes-forensic.json`，blend SHA256 1139617c…）确认两槽 Principled BaseColor 与 Alpha 直连 `c_Koleda_slg_face_d.png`（sRGB 1024×1024）、**无额外乘色节点**，因此 V1 语义目标是「原色通过 + 独立分组绑定」而非颜色变化：实现复用引擎 `v14d_hair_composite` helper 并以恒等 tint [1,1,1] 达成原样通过（targetLinear(uv)=srgbToLinear(face_d(uv))）。引擎补丁（patch-reze-engine.mjs）把 `v14dState2OverrideFsBodyFixed` 的 guard/expr 与 compile 的 helper 注入门控/tint 读取泛化识别该 graph（幂等收敛，verify 升至 78 项不变量）。alpha 口径与引擎 hashed-alpha 裁切一致（取证 blendMethod=HASHED、surfaceRenderMethod=DITHERED、alphaThreshold=0.5、backfaceCulling=false）。验收口径：因恒等 tint 不产生颜色变化，G3 逐槽像素收敛 Gate（materialId/triUV 目标收敛）只覆盖 HairA/HairB；Brows/Lashes 的正式 Gate 由 G2 真实 draw-call/graph 绑定证据（`v14dSkinVariant{Brows,Lashes}{DrawCalls,OnComposite}` 各 1/1）+ missingBrows/missingLashes/swapBrowsLashes 负测（单变量抽出回塞原 face 分组，对应槽 OnComposite 归 0）承担，G3 新增脸部特写（original/V1 对照）证明恒等 tint 不破坏眉毛/睫毛渲染。【验收修正轮 2026-09-03 → 2026-09-04 最终收口】早期 swapBrowsLashes 仅交换同一 graph 的 materials 数组顺序、不能构成错槽拒绝，本轮已改为两个独立身份克隆 graph 的真实错槽归属（graph 名字/槽标记交叉，正式 Gate 据此非零拒绝）。本轮（Stage 2C-M2a 最终视觉 Gate）闭合全部正式 Gate：① 逐槽原子同帧 material-ID + production-draw-call 三角 UV + 同像素 identity-target 正式 Gate（Brows 19/19、Lashes 159/159 样本、triUvResolution=1.0、targetBinding consistent、两槽 formalTargetGate 双 true）；② Lashes 透明边缘专门 Gate（core=159/edge=0/transparentZone=0、minVisibleAlpha=1、无黑框/白边、cutout 一致性 true；权威取证确认 face_d 在两槽几何覆盖区纹理 alpha 恒=1.0，边缘靠 hashed 几何抖动，可见像素全落不透明核心，edgeBand 样本恒为空，故分母采用核心/边缘/透明三区 + 可见像素最小 alpha 贴近裁切阈值口径）；③ 动态 Morph Gate（开眼 Brows=1843/Lashes=8969、闭眼 1807/8935，权威闭眼 Morph「まばたき」真实移动网格，逐槽不闪烁、不错常显、不整槽丢失）+ 错误 Morph/状态不切换负测（超闭眼权重 2.0 让逐槽前景像素集合与开眼基线 Jaccard 距离>0，自然判别）。wrongTint 负测改用恒等画布红通道参考基线的通道指纹判别（baselineShift≥20）：恒等 target 绝对 MAE 受 K3 显示链（曝光0.6/Toon/sRGB）强压缩，tint 归零红通道不足以越过 slotAbsMae，改用 baselineShift=idVsId-wrongVsId（恒等≈0、wrongTint 实测 48-58）自然拒绝。missing/missingBrows/missingLashes/真实错槽 swap/wrongGraph/failCompile/failApply/wrongAlpha 负测全部自然非零拒绝；整槽消失判别力由 G3 逐槽 identity-target Gate 天然承担（槽移除→样本=0<minSlotTargetSamples→非零拒绝）。【Stage 2C-M2a 候选收口 2026-09-04，待主会话验收】本轮自评闭合全部正式验收项并修正前期缺口，完整 G1-G7 全绿（allPass=true、exit=0）：① Lashes 透明边缘改为屏幕空间形态学边界环 Gate（非空 core/edge/transparent 分母），黑框/白边/整槽消失三类自然检出，wrongAlpha 经专用 acceptance fault graph（仅 ?v14dAcceptanceProbe=1 可达、正常 graph 与共享 hashed 材质不受影响）自然非零拒绝；② 动态 Morph Gate 改为「验收探针控制的生产 GPU 顶点位移」：clip 挂起 + 正常权重 0→1，按 PMX 取证 expectedAffectedSlots 逐槽判定（まばたき/笑い 各 Lashes 506/506 受影响顶点 max 位移 0.279/0.158，超 same-weight GPU 读回噪声；Brows 取证不受影响并保持稳定），屏幕投影 Jaccard/质心降级为 diagnosticOnly；③ wrongTint 三次独立采集 provenance 经探针隔离 epoch（sessionStorage 持久化、跨 reload 全局唯一 captureId e4-4/e5-1/e6-1）证明独立，阈值 20 有实测裕量。整槽消失负测（missingBrows/missingLashes）用 composite OnComposite 信号（missing 槽=0、另一槽=1）自然非零拒绝，替代失效的前景塌缩判据（missing 槽仍被 material-ID pick 栅格化、恒等 tint 下渲染仍收敛）。KoledaDefaultAppearance 的生产默认外观锁（lockKoledaMorphWeights 强制 まばたき=1）保持不改，探针用 post-update 隔离包裹（保存 exact originalUpdate、wrapper 后写回 probeWeights、finally 恢复）。当前状态以顶部为准：材质阶段验收6/15，已合并6/15，Brows/Lashes已集成（合并证据见顶部）；Emotions/Eyes/EyeWhite/EyeShadow/Eyes+/UpperTeeth/LowerTeeth/Tongue/FingerNails 仍未迁移，Cth* 衣物/装备、Glock、GunSilencer 永久排除。概念登记见 `workflow/concepts/v14d-brows-lashes-identity-tint.zh-CN.md`。

Stage 2C-M2a.3（`codex/v14d-brows-lashes-display-chain`，2026-09-04）定位并修正了 Brows/Lashes `wrongTint` 的显示链断点：`applyStyleGroups` 成功、graph/WGSL 与 compile/install pipeline 已变化，并不等于下一次真实 draw 已执行或最终 canvas 已更新。固定 frame120 的 acceptance probe 在 identity、identity-control、sentinel 三次观测前保持 render loop 停止，以 `pairId=v14d-bl-pair` 关联对照，三侧使用唯一 `captureId`，并逐侧记录 `requestSerial/frame`；健康路径通过 `engine.renderFrame(0)` 提交一次零增量帧。最新健康证据 `web/.scratch/repro-v14d-brows-lashes-display-chain/final-correction-healthy-dynamic-final/report.json` 的 `displayChain/stageDeltas` 显示 identity `captureId=v14d-bl-pair-identity`/`requestSerial=1`/`frame=120`/pipeline `gpu-1`，sentinel `captureId=v14d-bl-pair-sentinel`/`requestSerial=3`/`frame=120`，compile/install 与实际 Brows/Lashes draw pipeline 为 `gpu-36`；两槽 material/group/range/bind group 唯一匹配且生产 `drawIndex=18/19`、实际 `drawOrder=17/18`。Brows HDR resolve 红通道均值为 `0.162648 -> 0.026491`（绝对差 `0.136157`），Lashes 为 `0.077978 -> 0.019728`（绝对差 `0.05825`）；目标 canvas changedRatio=`0.918941`、meanAbsRgbSum=`41.792051`。identity-control 非目标噪声基线为 `0.005562`/`0.401686`，identity→sentinel 非目标为 `0.007`/`0.600659`，超额 `0.001438`/`0.198973`；composite pipeline/gamma 两侧均为 `gpu-35`/`1`，HDR NaN/Infinity 与 pageErrors/failedRequests/httpBad 均为 0。故障 `web/.scratch/repro-v14d-brows-lashes-display-chain/final-correction-fault-no-render-dynamic-final/report.json` 的 `--fault-no-render` 保持 `applied.ok=true` 与 sentinel compile/install pipeline 更新但不提交新帧，`renderObserved=false`、trace 回到旧 identity-control、HDR/canvas 保持上一提交帧并 exit 1；其 H1 为 `confirmed`，H2–H5 为 `not-evaluated`。历史 `report-red-before-fix.json` 的 `meanAbsRgbSum=8.663076` 不是严格 no-effect，只能表述为“强 sentinel 未达到正式拒绝阈值且缺少实际新帧 render 证明”。该接缝只在 `?v14dAcceptanceProbe=1` 下挂载，卸载时恢复引擎方法；默认生产入口不安装，不改变正式材质公式、alpha、灯光、相机或 Gate 阈值。该诊断修正不等于 Brows/Lashes 正式逐槽 identity-target、透明边缘或动态 Morph Gate 已闭合，后者仍需独立票据。概念登记见 `workflow/concepts/v14d-display-chain-commit-boundary.zh-CN.md`、`workflow/concepts/v14d-display-chain-draw-identity.zh-CN.md` 与 `workflow/concepts/v14d-compile-install-not-display-proof.zh-CN.md`，复现脚本为 `web/scripts/repro-v14d-brows-lashes-display-chain.mjs`，原始报告位于 `web/.scratch/repro-v14d-brows-lashes-display-chain/`。

### Koleda V14D 脸部 State 2 静态黄金帧预览（默认关闭的诊断入口）

`web/src/features/stage/v14dFaceStatic.ts` 在 `/mmd-calibration-render` 上追加一个默认关闭、仅显式 `v14dFaceStatic=1`（可选 `v14dFaceMode=normal|faceShadowOnly|finalFaceComposite`）才启用的静态合成分量诊断入口。它把权威 `Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend` 的初始脸部阴影（State=2、LayerA=2、LayerB=2、BlendWeight=0）落地为 Web 可直接预览的固定初始状态：固定权威 PMX、权威 frame-120 VMD、frame 120、近景相机锁定（PROTO_GameCamera）、动画暂停、固定 640×640 backing size，停止实时循环后单帧渲染。页面自身提供本地资产选择 UI（`<input type=file webkitdirectory>` 选 Koleda 模型目录 + 独立 VMD / State2 mask 选择器），资产未注入时显示「请选择本地资产」面板而非无反馈等待；资产就绪后页面内提供「正常基线 / 脸部阴影分量 / 最终脸部合成」三个可点击模式按钮，切换不重选资产。为查看整体模型，该诊断页另提供默认关闭的交互相机工具条：点击「自由相机」后只恢复相机输入与渲染循环，VMD 继续停在 frame 120；支持拖动旋转、滚轮或按钮缩放、重新锁定；「全身视角」切换到 `V14D_FACE_STATIC_FULL_BODY_CAMERA` 检查机位，「重置截图机位」恢复 `V14D_FACE_STATIC_CAMERA` 权威近景。相机工具仅在 `v14dFaceStatic=1` 且本地资产就绪时显示，不进入生产默认入口。

三模式脸部 diffuse 语义相互独立：`normal` 用 PMX 包内原始 `face_d`（未应用 State 2 的现有 Web 脸部基线），`faceShadowOnly` 用纯阴影衰减分量（黑底 `1 - shadowFactor` 灰阶），`finalFaceComposite` 用 BaseColor + State 2 且 Blend 0 的合成结果。三模式都只把 Face 材质切到纯纹理 unlit graph（仅纹理不同，保证「只有 Face 纹理变化」的严格 A/B），其余材质保持 reze-k3 正常分组，不套全局 unlit。合成公式与所有视觉常量（阴影颜色、遮蔽颜色、混合权重、frame/相机/色彩管理）全部来自权威 `.blend` 取证，Web 侧不手调 RGB。页面徽标显示 `V14D Static Golden Frame`、`Frame 120`、`Face State 2`、`Blend 0.00`、`Camera Locked`、`Animation Paused`，并明确标注「静态脸部合成分量预览，不代表完整 Blender 最终视觉」。

资产解析方式与仓库资产政策一致（README：第三方资产不可再分发）：仓库只提交可发布代码/脚本/文档，不捆绑权威 PMX、VMD、纹理或派生纹理。运行时权威资产由页面 UI（或采集脚本经 `page.route`/`addInitScript`）以浏览器 `File` 形式注入 `window.__v14dFaceStaticAssets`，`RezeWebGpuStage` 通过引擎 `loadModel("companion", { files, pmxFile })` files 变体配合 `createFileMapAssetReader` 完全局部解析：不发网络请求、无 404、**不全局包装 `window.fetch`**。Face 材质的 pick ID 由材质名（`Face`）在 vertexCount>0 材质列表中推导，不硬编码材质索引。faceStatic 在 boot 内一次性加载权威 VMD 并 seek frame120→pause→stopRenderLoop→renderFrame(0)，通用 VMD effect 已显式排除 faceStatic（不再二次 play/resetPhysics）。该逻辑对 PMX/VMD runtime 只读消费求值后的几何/UV/法线，不写回动画 Runtime，骨骼、权重、Morph、IK、Physics、VMD 文件与播放链（play/pause/seek）零改动；默认生产入口（无 `v14dFaceStatic=1`）不启用此路径，其它 PMX 模型不受影响。同口径验收拆为两层：纯合成分量门禁用 Blender 白光 Emission（Standard/曝光0/gamma1）与 Web unlit，统一线性空间并用同一 Face 材质 pick mask（Web 导出 `web-face-mask.png`，5865 脸部像素）在相同 ROI 内量化，输出正式误差；最终显示门禁仅在 Web 与权威 `.blend` 使用相同固定灯光与 AgX/Look/曝光时才宣称视觉对齐，本票只做分量层。

Stage 2A-M1.1（`codex/v14d-face-uv-texel-align`）在同一入口追加只读诊断能力：`v14dFaceMode=uvDebug` 把 Face 材质切到几何 UV 调试图（fragment 输出插值 `input.uv` 的 R=u、G=v，该值在场景 HDR pass 写入 pre-tonemap 的 `hdrResolveTexture`），`window.__v14dFaceStatic.exportFaceUvPng()` 用与 `exportFaceMaskPng()` 相同的 Face pick mask 导出逐像素 UV（仅 faceStatic 模式、默认关闭、不改变三模式语义与生产渲染）。

Stage 2A-M1.1-R 恢复修正（`codex/v14d-face-uv-texel-align-recovery`）纠正了旧版的两处显示变换污染：旧 `exportFaceUvPng` 从最终 canvas（`readV14dCanvasDisplay`）反推 UV，被 composite 的 bloom/exposure/Filmic LUT/grade/gamma 污染；旧 UV-direct Gate 拿 tonemap 后的 `page.screenshot` 对比未 tonemap 的 baker 参考，口径不一致。修正后两者都改用 `readV14dColorBaselineResolveTargets` 的 pre-tonemap GPU readback（blit → COPY_SRC → readback）：`exportFaceUvPng` 读 HDR 的 R/G 得浮点 UV（导出 `web-face-uv.float.json`），capture 新增 `exportFaceHdrFloat` 导出三模式 pre-tonemap 浮点 RGB（`face-static-<mode>.hdr.json`）。诊断链源纹理 `hdrResolveTexture` 的格式随硬件为 `rg11b10ufloat` 或 `rgba16float`（`Engine.hdrFormat`），统一先 blit 到 `rgba16float` 读回目标再 COPY_SRC/readback。

UV-direct Gate（`.scratch/v14d-face-static/uv-align/uv-direct-gate.py`）的正式口径为全 Face 每通道 mean≤0.005 / P95≤0.01，正式输入仅是 pre-tonemap 浮点证据（无 8-bit PNG/tonemap 截图 fallback；旧路径仅在显式 `--legacy-diagnostic` 下作历史对照并标记 `formalEvidence=false`），进程退出码反映正式 Gate 状态（未过 exit 1）。修正后同 Web UV 的纹理采样域均值量级降至 ~0.005–0.02，但**正式全 Face Gate 仍未通过**；normal/composite 内部像素的剩余 ~0.005–0.008 残差根因**尚未证明**（MSAA 平均、UV 亚纹素偏移两个候选均已被单变量实验排除，引擎 `rgba8unorm-srgb` 硬件解码精度为待验证假设）。脸部轮廓边缘（约 1174/5865 像素）的高误差来自 MSAA 4x resolve 的抗锯齿混合（光栅域，生产固定配置），仅作辅助诊断拆分（内部/边缘），不重定义正式通过口径。Web 固定相机与 Blender `PROTO_GameCamera` 的几何/姿态口径差异（脸部屏幕覆盖宽 5.2×/高 8.6×、质心偏移约 298px）只影响 same-mask 同屏视觉 Gate（该 Gate 未通过），与 UV-direct（同 Web UV 纹理域）是不同域；闭合 Blender/Web 同屏脸部颜色口径需独立票据先对齐相机/姿态几何。

Stage 2A-GF（`codex/v14d-static-golden-frame`）完成上述独立票据要求的【相机/构图对齐】（数量级口径错位消除），但主验收【肉眼明显视觉对齐】未达成——修正轮发现剩余差异由光照主导，把六灯/世界光/Toon 固化进纹理的 Cycles bpy.ops.object.bake 在当前无头环境被禁用(poll 恒 False)，发射/ID 图两条替代路线均被单变量实验排除，新增 bakedGolden 黄金帧烘焙模式只固化了 BaseColor 反照率(不含光照)、实测 ROI MAE 反而更高。该入口的固定相机更新为真实可用值：`V14D_FACE_STATIC_CAMERA.fov=28.0725°`（Blender PROTO_GameCamera lens 72mm / sensor 36mm AUTO 在方形画幅下的垂直视场角）、`position=[0.564, 18.55, -13.0]`、`target=[0.564, 16.4125, -1.26]`（PMX 单位，锁定）。对齐依据是三项实测结论而非米单位假设：其一，reze-engine 以 PMX 单位渲染（CPU 皮肤后脸部世界包围盒 y≈15.8–17.6、z≈-1.8~-0.4），上一票 same-mask 的米单位相机假设不成立；其二，Web 与 Blender 的骨骼局部旋转逐轴一致（头 [-2.4°, 2.3°, 5.0°] vs Blender [2.4°, -1.2°, 5.4°]，仅镜像约定差异），但 Web 头部姿态应用效果使脸部法线朝向 Blender 坐标系的 -Y 方向，因此相机从 Web 头正面 +Z 一侧取 2× Blender 距离（补偿 Blender 投影头高 12mm 与 Web 14.3mm 的剩余姿态差）；其三，画面纵切覆盖显示变换——faceStatic 分支把背景压到 `#050505`、地面/泛光关闭、`setViewTransformOptions({exposure:-0.56, gamma:1.0})` 对齐 Blender AgX Medium High Contrast 曝光，默认模式改为 `finalFaceComposite`（Face State 2 预烘焙合成图经浏览器 File 注入真实作用于画面，normal/composite 的 meanLinear [0.427,0.296,0.275] vs [0.409,0.262,0.233] 证明合成生效）。诊断读回（capture/mask/HDR 导出）由新 prop `v14dFaceStaticGated` 单独门控，与画面纵切解耦；`web/scripts/capture-v14d-face-static.mjs` 支持 `--mode=<名称>` 单模式采集。对齐后 Blender/Web 并排（`.scratch/v14d-static-golden-frame/side-by-side.png`）构图、角色尺寸与胸口装备高度一致，脸部 ROI 平均绝对差（0–255 域）约 [46.6,44.95,44.01]，剩余差异主要是光照色调（Blender 多 AREA 暖光 vs reze-k3 白光），UV-direct 精度调查未作为本票前置。

`imgToAction` 的 BVH→VMD 思考动作当前走位置驱动 + IK 后处理链路。`imgToAction/tools/gen_v9e.py` 读取 `imgToAction/samples/bvh/sample0_repeat0_len196_ik.bvh`，用统一 torso scale `8.54` 和 PMX Z 轴翻转做 BVH→PMX 坐标映射；arm_down 阶段不再把 BVH wrist 位置直接作为 IK 目标，而是用 ShoulderC 为链根生成左右臂自然下垂姿态，避免手臂被 FABRIK 折到身体前方。raise/hold 阶段用 `smoothstep` 混合自然下垂和摸下巴目标，再通过 FABRIK、关节角限制和多轮 SLERP 平滑输出 `imgToAction/outputs/vmd/front_depth_v9e.vmd`。渲染验证由 Node/Playwright 脚本通过 `/mmd-calibration-render` 生成四视角截图、GIF 和 `rendered_bone_frames.json`，再由 `imgToAction/tools/motion_acceptance_gate.py --source render` 按 G1-G18 验收。G11-G14 检查手部高度、托下巴语义、右臂解剖和半握手型；G15-G18 继续检查接近阶段安全、拇指/食指双点接触、腕掌解剖和稳定接触锁定。当前 G13 稳定段阈值为右肘角 55°-100°、肩腕距离 2.95-4.1 PMX。骨骼 gate 不能覆盖手套和袖口网格厚度，最终仍必须用正/左/右/后四视角截图与 GIF 做网格遮挡、穿脸和动态轨迹复核。G7 的 strict `akimbo` 策略在稳定段同时检查左腕、左肘和完整左手代理 bbox，并只接受 Blender 网格验证过的 `side_down` 轮廓：手指沿髋侧向下，禁止横向插入腰身；`akimbo` 下 G7 是 P0 阻断 gate。

2026-07-14 当前程序化“优雅思考 + 左手叉腰”输出是 `imgToAction/outputs/vmd/eula_elegant_thinking_generated_v13.vmd`，生成脚本为 `imgToAction/tools/gen_elegant_thinking_generated_v13.py`，部署目标为 `03_thinking_waiting/优雅思考_generated_v13.vmd`，并保留 v12。v13 不读取、复制或拼接现有 VMD；从自然下垂开始，左手最终叉腰，右手经收拢接近后托下巴。最终右腕目标 PMX `[-1.35, 17.15, -3.20]`、右肘 pole `[-2.20, 15.05, -1.75]`、右手首 Euler `[-14, -50, -38]`。完整 0-240 逐帧 gate 为 `16 PASS / 2 WARN / 0 FAIL`，G11-G18 全部通过；稳定段右肘角 `55.2°`、肩腕距离 `2.982 PMX`、五指 Y 展开 `0.291 PMX`、腕弯曲 `59.5°`、掌面夹角 `66.9°`、拇指/食指下巴距离 `1.097/0.594 PMX`，接触漂移为 0。两个 P1 WARN 为旧腕点距离 G4 和 f130-f140 翻腕平滑度 G6，符合警告少于 3 的验收规则。最终证据在 `imgToAction/outputs/actions/elegant_thinking_generated_v13_final_review/`，包含 196 张四视角截图、5 个 GIF、review sheet、手部 review sheet、数据表和 `gate_report.json`；网格视觉确认嘴部可见、手套位于下巴下缘且侧视角不穿脸。`asset_registry` 已同步为收藏资产 `3dcdccb8-bd73-4d0b-89e1-e9eddbafac94`。

2026-07-14 专业时序优化版本为 `imgToAction/outputs/vmd/eula_elegant_thinking_generated_v14.vmd`，生成脚本为 `imgToAction/tools/gen_elegant_thinking_generated_v14.py`，收藏资产为 `03_thinking_waiting/优雅思考_generated_v14.vmd`，资产 ID `b1541c79-bc75-457d-8e14-af8d8158b4c2`。v14 保留 v13 最终坐标和接触拓扑，但把右臂改为 f122 到达预备位、f122-f130 蓄势、f130-f150 托起；f126-f149 对右手首和右手捩执行零相位邻域 SLERP，并用 f130-f146 的局部 `Z+5°` 宽缓冲避开中间手部轮廓抬高。完整逐帧 gate 为 `17 PASS / 1 WARN / 0 FAIL`，G6 从 WARN 提升为 PASS：右手首最大加速度 `0.1024 -> 0.0476`、最大 jerk `0.0597 -> 0.0200`，运动平滑违规 `25 -> 0`。最终证据在 `imgToAction/outputs/actions/elegant_thinking_generated_v14_professional_review/`，包含 196 张截图、5 个 GIF、review sheet、手部 review sheet、数据表、`professional_motion_metrics.md` 和 gate 报告。v13、v12 均保留用于回归对比。

2026-07-14 Blender 网格校正版为 `imgToAction/outputs/vmd/eula_elegant_thinking_generated_v15.vmd`，生成脚本为 `imgToAction/tools/gen_elegant_thinking_generated_v15.py`，并以新文件部署到 `03_thinking_waiting/优雅思考_generated_v15.vmd`，不覆盖 v12-v14。v15 不读取或拼接现有 VMD，只保留 v14 的右臂、头颈和下半身时序，并根据优菈 PMX 实际变形网格把左腕目标改为 `[2.52, 13.46, -0.97]`、左手首 Euler 改为 `[-2°, 6°, 0°]`，使手指沿髋侧向下。Blender 审查工程是 `imgToAction/outputs/blender/eula_elegant_thinking_generated_v15_review.blend`；f0-f240 共 241 帧的左手对全模型网格扫描为 0 个碰撞帧，f160 净空 `0.014774 PMX`，左腕最大帧间旋转 `1.7445°`。最终渲染 Gate 为 `17 PASS / 1 WARN / 0 FAIL`，所有 P0 均通过；唯一 G4 WARN 是腕点代理距离，而 G12/G16-G18 的真实手指接触、腕掌解剖和接触锁定均通过。证据目录 `imgToAction/outputs/actions/elegant_thinking_generated_v15_blender_review/` 包含 196 张四视角截图、49 帧四视角 GIF、5 个 GIF、完整 `rendered_bone_frames.json`、review sheets、数据表和 Gate 报告。

2026-07-14 右腕解剖校正版为 `imgToAction/outputs/vmd/eula_elegant_thinking_generated_v16.vmd`，生成脚本为 `imgToAction/tools/gen_elegant_thinking_generated_v16.py`，并以 `03_thinking_waiting/优雅思考_generated_v16.vmd` 新文件部署，保留 v12-v15。用户视觉复核发现 v15 的右掌在厚袖口下接近断腕；根因是 G17 旧上限 65° 过宽，而 v15 实测腕弯曲已达 59.5°。v16 将 G17 上限收紧为 55°，把右手首终态从 `[-14°, -50°, -38°]` 改为 `[-14°, -40°, -38°]`，并通过头手联动与手指微调维持接触。最终稳定段腕弯曲 `52.7°`、掌面夹角 `63.7°`、右肘角 `55.2°`、肩腕距离 `2.982 PMX`、指尖 Y 展开 `0.249 PMX`、拇指/食指到下巴距离 `1.057/0.499 PMX`。完整 Gate 为 `17 PASS / 1 WARN / 0 FAIL`，证据目录 `imgToAction/outputs/actions/elegant_thinking_generated_v16_anatomical_review/` 包含 196 张截图、5 个 GIF、review sheets、数据表和完整骨骼 JSON。

当目标是“尽可能 100% 还原自然思考动作”而不是严格从 BVH 重建时，当前稳定输出是 `imgToAction/outputs/vmd/eula_thinking_100pct_reference.vmd`。它复制自已验证的 `eula_thinking_elegant_reference_v12_single_raise.vmd`，保留社区 VMD 的自然手指、手腕、肩线、下半身节奏和左臂腰前支撑；对应 manifest 是 `imgToAction/outputs/vmd/eula_thinking_100pct_reference_manifest.json`，渲染证据在 `imgToAction/outputs/actions/thinking_100pct_reference_render/`。该 VMD 同步部署到当前模型动作目录 `MMD/usage/vmd/优菈_by_原神_339146e6e418d79e85a515b26414c0b0[动作]/03_thinking_waiting/思考_100pct_reference.vmd`，用于被资产扫描/动作选择链路发现。这个 reference 路线和 `front_depth_v9e` 的语义不同：它是左臂支撑/抱臂式思考动作，因此验收时应使用 `motion_acceptance_gate.py --left-arm-policy support`；默认 `down` 策略仍用于左臂自然下垂的单手动作。`render_v9e_win.mjs` 现在支持 `IMGTOACTION_VMD_NAME` 和 `IMGTOACTION_RENDER_DIR` 环境变量，用同一渲染入口验证不同 VMD 候选。

当目标是“尽可能 100% 还原叉腰动作”时，当前稳定输出是 `imgToAction/outputs/vmd/eula_akimbo_100pct_reference.vmd`。它复制自当前模型已验证社区 VMD `06_strong_personality/叉腰扭头.vmd`，但以 `叉腰_100pct_reference.vmd` 独立部署，避免 OpenClaw 只想表达稳定叉腰时误选带扭头语义的旧命名。渲染证据在 `imgToAction/outputs/actions/akimbo_100pct_reference_render/`，包含四视角 80 张截图、四视角 GIF、review sheet 和 `akimbo_pose_report.json`。该动作是叉腰专用轻量验收，不使用摸下巴 thinking gate；稳定阶段定义为 f120-f190，目标是双腕贴近腰/髋两侧、双肘外张、上半身保持站立姿态。该 VMD 同步部署到当前模型动作目录 `MMD/usage/vmd/优菈_by_原神_339146e6e418d79e85a515b26414c0b0[动作]/06_strong_personality/叉腰_100pct_reference.vmd`，当前资产 ID 是 `0d3b39a3-13d7-47b8-bbab-349bc8079702`。

`imgToAction` 的首版 landmark fitting 也复用同一个渲染入口。参考图人工关键点存放在 `imgToAction/config/reference_landmarks.eula_signature.json`；多角度图片批次可先通过可选的 `imgToAction/tools/extract_mediapipe_landmarks.py` 运行 MediaPipe Pose Landmarker IMAGE mode，生成 `imgToAction/config/reference_landmarks.eula_thinking.json` 和 `imgToAction/outputs/mediapipe/.../raw_mediapipe_landmarks.json`，其中低置信度 wrist/elbow/ankle/toe 点仍需要人工复核。`imgToAction/tools/export-model-landmarks.mjs` 会加载 PMX/VMD、seek 指定帧、把 reference config 中绑定的 PMX 骨骼投影为屏幕坐标；`imgToAction/tools/fit_pose_nodes.py` 用 neck/pelvis/ankle anchors 做 2D similarity alignment 后计算 weighted RMSE 和 worst landmark 列表，避免相机缩放/平移主导评分。`imgToAction/tools/run_landmark_fit_step.py` 是当前拟合 runner：它从 pose node DSL 生成一批语义参数候选 VMD，逐个通过 `/mmd-calibration-render` 导出骨骼投影，再写入 `outputs/fitting/.../candidate_step_*/fit_step_manifest.json`，用于选择下一轮 pose 参数调整。该链路只读主项目渲染 runtime，不改变 `/companion` 的用户动作播放状态。

`mio-reference` 的默认渲染也同步到该导出配置：renderer 使用 `toneMapping=none`、`exposure=1.57`，低环境光 `ambientIntensity=0.2`，暖色 hemisphere sky `#ff6929`，主光位于 `[-18.5,-25.6,64.3]` 且强度 1.43，地面阴影透明度 0.22。Bloom 和全身 outline 默认关闭但保留导出参数；材质调节在 Project2/Genshin 清理后应用，默认发色 tint 为 `#02c2f2`、强度 0.61，其它 face/skin/eye/cloth tint 也随 preset 保存。

MMD 相机状态只按渲染管线保存到 `session.mmdCamera[renderPipeline]`。VMD 预览、聊天动作、人物点击动作和待机 VMD 只改变 `stageInteractionMachine` 的动作播放状态，不再选择、应用或清空相机快照。`MMDStage` 收到明确的 camera snapshot 时才调用 runtime 应用相机；snapshot 为 null 时保留当前 runtime 视角，只有切换模型/渲染管线重建 runtime 或用户点击 Reset Camera 才回到当前 pipeline 默认相机。

`mio-reference` 保留一个可回滚的面部细节层 `faceDetails.chinLine`，但默认 `enabled=false`，因此当前不会画下巴描边。若后续需要继续试验，可重新设为 `true`；Runtime 会在模型加载、骨骼捕获之后把细 `TubeGeometry` 曲线挂到 head 骨骼，并在清理模型时随 `disposeFaceDetails()` 一起移除，不影响 VMD、材质调优、相机或全身 outline。

人物点击交互：

```text
Pointer down on MMDStage
  -> store pointer candidate only
Pointer up on MMDStage
  -> ignore long press and drag gestures
  -> MMDCompanionRuntime.hitTestModelAtClientPoint(clientX, clientY)
  -> only continue when raycast intersects the loaded MMD model
  -> CompanionPage creates a click ripple at the pointer position
  -> resolveStageCharacterClickInteraction()
     -> de-duplicate motions by category + normalized VMD name
     -> random single-shot VMD from 02_greeting_social / 05_soft_emotion / 06_strong_personality
     -> avoid immediately repeating the previous click motion when alternatives exist
     -> fallback safe favorite VMD excluding 00_idle_loop and 01_entry_fallback
     -> fallback procedural wave when no favorite VMD is available
  -> startStageClickInteraction()
  -> normal completion or VMD error returns immediately to 00_idle_loop/default idle
```

相关接口：

| Endpoint | 作用 |
| --- | --- |
| `GET /assets/mmd/models` | 扫描本地 MMD 模型 |
| `GET /assets/mmd/vmds` | 扫描本地 VMD 动作 |
| `GET /assets/mmd/validate` | 验证模型路径 |
| `GET /assets/mmd/{file_path}` | 提供模型和贴图文件 |
| `POST /assets/vmd` | 上传 VMD |
| `GET /assets/vmd` | 列出 VMD |
| `PATCH /assets/vmd/{asset_id}` | favorite/显示名/模型绑定 |
| `GET /assets/vmd/file/{asset_id}` | 提供 VMD 文件 |

## 9. 数据落点

| 数据 | 落点 |
| --- | --- |
| 用户、workspace、session | SQLite `accounts`, `workspaces`, `sessions` |
| `/companion` 与 `desktop-pet` 共享配置 | SQLite `companion_shared_config`：per-user `selected_model_path`、`render_pipeline`、`updated_at` |
| 聊天消息 | SQLite `messages` |
| TTS 状态 | SQLite `message_tts`, `tts_jobs` |
| OpenClaw Bridge | SQLite `message_bridge_bindings`, `message_bridge_state` |
| 动作解析结果 | SQLite `message_motion_resolution` |
| VMD 资产索引 | SQLite `asset_registry` |
| Motion context exports | SQLite `motion_context_exports` |
| Codex UI workspace 登记 | SQLite `codex_workspaces` |
| Codex session/turn/event/approval/artifact | SQLite `codex_interactive_sessions`, `codex_turns`, `codex_events`, `codex_approvals`, `codex_artifacts` |
| Codex Review Sync | SQLite `codex_openclaw_sync_outbox` 保存待提交/已提交 evidence pack；SQLite `codex_review_items` 保存 OpenClaw 返回的 draft work_summary/pitfall/decision/followup/blocker |
| Codex Review Control Plane Snapshot | SQLite `codex_review_control_plane_snapshot_state` 按 daily session key 保存最后成功提交的 snapshot cursor 和 ACK；worker 对未变化 cursor 本地去重，不重复 POST |
| Project Domain Knowledge v2 | SQLite `domain_knowledge_candidates` / `domain_knowledge_candidate_versions` / `domain_knowledge_candidate_evidence` 保存 immutable candidate；`domain_knowledge_candidate_deliveries` 与 `domain_knowledge_control_plane_runs` 保存 outbound delivery 和 durable cursors；`domain_knowledge_control_plane_commands` / `domain_knowledge_review_decisions` / `domain_knowledge_wiki_change_sets` / `domain_knowledge_publication_receipts` 保存审核和发布闭环 |
| Codex Knowledge Wiki v2 | SQLite `codex_knowledge_extraction_outbox` 保存去重的 pending/sending/succeeded/failed 抽取任务与 evidence pack；SQLite `codex_session_knowledge.raw_response_json` 保存 `disposition`、Wiki 候选、拒绝项和 canonical `code_index`。当前不自动写入 `codex_review_items` 或 `codex_review_memory` |
| desktop-pet Codex session registry | SQLite `desktop_pet_sessions`：metadata-only menu/resume registry，保存 `pet_session_id`、`codex_session_id`、workspace path、`CODEX_HOME` path、title/status/server metadata；prompt preview 和 summary 只保存 length-bounded 摘要字段，`metadata.facts` 保存 bounded review facts、结构化 `work_items` 和 `methods`，不保存完整 transcript。仅 Codex agent 写入该 registry；Claude agent 走纯本地 JSONL 链路，不 upsert 到该 registry |
| desktop-pet 本地设置 | Electron `userData/pet-settings.json`：当前选中的 workspace path、菜单语言、通知详情精度、置顶开关、当前 coding agent（`codex`/`claude`，默认 `codex`）、Codex 运行环境（`win`/`wsl`，默认 `win`）、Pet window x/y/width/height；workspace 缺失时回退 `MMD_PET_WORKSPACE_PATH` 或 cwd 默认 workspace，window 默认 360x420，用户可通过原生窗口边缘调整大小并恢复到上次尺寸 |
| desktop-pet 完成通知 | 主进程维护完成通知 reducer；通知通过独立 Electron `BrowserWindow` 加载 `notification.html`，不属于 Pet 主窗口 DOM，也不等同于 Windows 系统 Toast。状态最多保留最新 3 条：收起态必须是单个聚合胶囊，展开态为最多 3 条纵向通知。收起态目标高度固定为 `78px`；展开态目标高度为 `n * 190px + (n - 1) * 8px`（`n=min(count,3)`）。已关闭的 completion key 持久化到 Electron `app.getPath("userData")/dismissed-completion-notice.json` |
| trace event | SQLite `trace_events` + NDJSON |
| chat mirror | SQLite `chat_mirror` |
| retry job | SQLite `retry_jobs` |
| 本地 PMX/PMD/贴图 | `MMD_ROOT_DIR` |
| 上传/存储的 VMD | `API_DATA_DIR` 下的 storage；收藏副本在 `MMD_ROOT_DIR/usage/vmd/{model}[动作]/`，可按动作意图继续分子目录 |

`/companion` 的“保存到桌面 Pet”手动请求有 8 秒客户端超时边界：网络代理或 API 无响应时必须中止请求、解除 `Saving...` 状态并提示用户重试，不能无限占用保存按钮。SQLite 主连接启用 WAL 与 busy timeout；共享配置读写另用专用短连接，不与聊天和消息桥接的长生命周期连接跨线程争用。

当当前舞台为 `reze-k3` 或 `reze-design` 时，共享配置还会携带该模型和管线对应的 Reze 场景文档：场景参数、调色、背景特效及按稳定材质 ID 记录的材质预设。桌面 Pet 同步后把场景文档传入 `MMDStage`，并在 WebGPU 模型材质就绪后重试应用材质预设。

Desktop Pet 的 Reze-K3 小窗口首屏固定使用 `30` 的安全距离，并保留主舞台目标点：画布铺满窗口后按全高视图重新取值，既保留完整角色，又允许交互模式继续缩放；Pet 的 Reze 画布保持透明，桌面或主站背景可以从完整舞台后方透出。Pet 专用 CSS 将 `.mio-stage` 与 `.mio-stage-webgpu-shell` 固定为 `position:absolute; inset:0`，不再让主站网格按内容高度居中 WebGPU 画布。用户进入“调整相机”交互模式后仍可手动拉近或拉远。相机远近不提供独立控件：用户仍从右键菜单切换至“调整相机”交互模式；仅在该模式中，鼠标悬停 Pet 舞台并滚动滚轮会改变 Reze WebGPU 相机距离。切回“拖动整个应用”后，滚轮不再劫持窗口交互，角色点击也恢复为动作切换入口。

`companion_shared_config` 只保存 `/companion` 和 `desktop-pet` 共同需要的当前模型与渲染管线选择；主站会在模型目录加载完成后优先恢复其中仍存在的 `selected_model_path`，目录中不存在该模型才回退默认模型。主站舞台模式另外按 user ID 写入浏览器 localStorage，并优先于共享配置恢复；`reze-k3` 已纳入共享配置，Pet 的“从主站同步”会加载同一模式；未知或已废弃的模式安全回退 `mio-reference`。不保存 pet camera、pet window position、notification profile 等 desktop-pet 专属状态。Pet camera 由 `desktop-pet` renderer 的 localStorage 独立维护，按 `selectedModel.relative_path + render_pipeline` 隔离，不写入 SQLite，也不复用主站 session 的 `mmdCamera`。Codex workspace 选择、菜单语言、通知详情精度、置顶开关和 Pet window 位置是 desktop-pet 本地设置，由 Electron 主进程 merge 写入 `userData/pet-settings.json` 的 `selectedWorkspacePath`、`menuLanguage`、`notificationProfile`、`alwaysOnTop` 和 `windowBounds`；workspace 路径只影响 Pet 的菜单扫描、VSCode 打开、新建 Codex 和默认恢复目标，不写入 SQLite 或 shared config。`desktop_pet_sessions` 只保存可读菜单、`codex resume` 和 review evidence 所需 metadata，不复制、不移动、不落库 Codex transcripts；`first_prompt_preview` 最多 240 chars，`last_summary` 最多 1000 chars，Codex session 持久化仍留在用户既有 `CODEX_HOME`。desktop-pet 主进程会按 `CODEX_HOME`（默认 `%USERPROFILE%\.codex` 或 `$HOME/.codex`）扫描 `sessions/**/rollout-*.jsonl`，分块读取完整事件序列，但只持久化 `session_meta.payload.id/cwd`、首条真实用户 prompt preview、最后 assistant summary、最后事件推断状态，以及 bounded review facts（failed command excerpt、changed file path、approval title、error excerpt、event counts）；扫描仍限制为当前 workspace 的最近候选文件，不会把完整 JSONL 内容写入 SQLite。当前 `desktop-pet` 是独立 Electron + Vite 子项目，dev 默认 renderer 为 `http://127.0.0.1:5174`；端口冲突时可用 `MMD_PET_DEV_PORT` 覆盖 Vite 端口，并用 `MMD_PET_RENDERER_URL` 指向 Electron dev renderer。`desktop-pet/start-pet.ps1` 是本地一键启动入口：在 `desktop-pet` 工作目录后台启动 `npm run dev` renderer，等待 renderer ready 后用同一 renderer URL 启动 Electron，并把日志写入 `.codex-pet/logs`；renderer helper 作为后台进程隐藏启动，但 Electron Pet GUI 不使用 `-WindowStyle Hidden`，避免 Windows 把交互式 BrowserWindow 也隐藏；如果已存在 `MMD Codex Pet` 窗口，默认会先停止当前 Electron 主进程再重新拉起，传 `-ReuseExisting` 才返回现有 PID，传 `-ForceNew` 才保留旧实例并额外新开。Pet BrowserWindow 的 `webPreferences.backgroundThrottling=false`，常驻窗口即使未聚焦也不会让 renderer 状态刷新和 MMD 动画进入后台节流。renderer 会读取 `/desktop-pet/shared-config`、`/assets/mmd/models` 和 `/assets/vmd`，复用 `web/src/features/stage/MMDStage` 在 transparent bare window 中渲染 MMD；当 shared config 为空时会跳过明显不可加载的 tiny placeholder PMX，选择第一个可加载模型作为 fallback。pet 待机 VMD 只使用当前模型绑定的 favorite VMD，并复用主站 `buildAutoFavoriteInteraction()` 规则：优先 `00_idle_loop` 中的 companion-safe 可播放动作，缺失时回退排除 entry standby 的安全 favorite 池，再缺失才回到 procedural idle；传给 desktop runtime 前会把 lead `vmdUrl`、循环 URL、standby URL 和 emotion map key 转成 API 绝对地址。renderer 用 `buildPetAutoplayIdleState()` 把该结果包装成 `source="autoplay"` 的 stage state；启动、主站同步 remount、点击动作完成或失败后的恢复都回到这份状态，避免首屏停在 procedural idle。

Electron 原生右键菜单当前由主进程构建，API 地址来自 `MMD_PET_API_BASE_URL`（默认 `http://127.0.0.1:8000`），菜单查询身份来自 `MMD_PET_USER_ID`（默认 `admin-1`）。菜单即时路径只读取主进程内存中的最近会话缓存并立即 `Menu.popup`，不得在 `context-menu:open` 与 `context-menu:popup` 之间同步递归扫描 Codex/Claude JSONL 会话目录；renderer 完成加载时会预热缓存，菜单 popup 后再通过现有刷新路线更新本地扫描结果、执行 `POST /desktop-pet/sessions` upsert 并请求 `GET /desktop-pet/sessions?limit=10`。首次预热尚未完成时，菜单可以暂时不显示最近会话，刷新完成后的下一次菜单使用新缓存；API 不可用时缓存仍可由本地扫描结果更新。菜单显示标签压缩成 title / time / status 组合，避免在菜单里暴露 UUID-heavy 字符串。当前菜单项包括 `Workspace` / `工作区`（显示当前 workspace，并可通过 `Select Workspace...` / `选择工作区...` 打开系统目录选择器）、`New Codex Session`、`Send Prompt...` / `发送 Prompt...`、`Recent Sessions`、`More Sessions...`、`Interaction Mode`、`Notification Detail`、`Language / 语言`、`Coding Agent` / `编程助手`、`Always on Top` / `固定在顶部`、`Open VSCode Workspace` / `打开 VSCode 工作区`、`Sync from Main Site` / `从主站同步` 和 `Close`；主进程会把带 `submenu` 的模型项转换成 Electron native `type="submenu"`，因此 `Workspace`、`Interaction Mode`、`Notification Detail`、`Language / 语言` 和 `Coding Agent` 在 Windows 原生菜单中以可展开子菜单呈现。其中 `Interaction Mode` 的 `Drag Whole App` / `Adjust Camera` 会立即生效：preload 以 CommonJS `preload.cjs` 加载并暴露 `window.desktopPet`，renderer 始终把 shell、stage 和 WebGL canvas 保持为 `-webkit-app-region: no-drag`，确保透明 frameless window 仍能收到 DOM `contextmenu`；由于 Windows transparent layered window 的全透明像素可能鼠标穿透，pet 会在 WebGL 上方绘制一个真实 DOM 覆盖层 `.pet-input-hit-surface`（`rgba(255,255,255,0.035)`），保证整窗区域有可命中的合成像素。Pet BrowserWindow 默认 360x420，`resizable=true`，最小尺寸为 240x280，不设置最大尺寸，用户可通过原生窗口边缘调整大小；整窗拖动优先由 renderer 在 `Drag Whole App` 模式以 document capture listener 捕获左键 pointer，并通过 `pet:window-drag:start|move|end` IPC 让主进程按系统 cursor delta 调整 BrowserWindow bounds，移动时保留当前 width/height。主进程同时在 Windows 下用 `hookWindowMessage` 监听 `WM_RBUTTONUP`、`WM_LBUTTONDOWN`、`WM_MOUSEMOVE` 和 `WM_LBUTTONUP` 作为透明 WebGL 子窗口不分发 DOM 鼠标事件时的兜底路径；同一次拖动中第一条到达的 IPC/native source 持有 drag 状态，后到 source 不会覆盖 origin bounds，非持有 source 的 move 会被忽略，任一 end 信号都可释放 drag 状态，避免重复事件把拖动变成系统 resize 或把异常尺寸写回。右键菜单优先走 renderer document capture `contextmenu -> pet:menu:open-context({x,y})`，主进程的 `system-context-menu` / `webContents context-menu` / native mouse hook 监听保留为 fallback；renderer/webContents 提供的是窗口内坐标，native/system hook 提供的是屏幕坐标。主进程会把两类输入统一解析成两份坐标：`Menu.popup({ window, x, y })` 使用 clamp 到 Pet window bounds 的窗口内 popup 坐标，避免屏幕坐标被当成窗口 offset 造成菜单远离 Pet；右键去重使用对应屏幕坐标。native/system screen 坐标如果不在当前 Pet BrowserWindow bounds 内，会被直接丢弃，不会 clamp 到窗口边缘打开菜单，并且会记录为一次 native/system 右键触发以压掉随后迟到的 renderer/webcontents fallback，避免 Windows hook 的窗口外 `WM_RBUTTONUP` 造成桌面其他区域也弹 Pet 菜单。主进程对同一次右键做 source-aware 去重：350ms 内所有 popup 请求直接丢弃，1500ms 内同屏幕坐标（4px 容差）的重复请求会丢弃；如果 native popup 已打开或 native/system 外部右键刚被忽略，随后 1500ms 内迟到的 renderer/webcontents fallback 也会丢弃，即使 renderer 坐标失真，避免第二个菜单出现在窗口左上角。去重不依赖 menu close callback 维持右键可用性。切到相机调整时 renderer 停止发送窗口拖动 IPC，native mouse hook 也不会启动窗口拖动；renderer 向 `MMDStage` 传 `cameraLocked=false` 并关闭 bare stage 的角色点击 pointer capture，让 OrbitControls 在 WebGL canvas 上接管 zoom/pan/rotate；切回拖动整窗时重新锁住 camera 并恢复角色点击捕获。需要诊断真实右键/拖动事件时，可用 `MMD_PET_DEBUG_EVENTS=1` 开启主进程 NDJSON 事件日志，默认写入当前工作目录 `desktop-pet-debug-events.ndjson`，也可用 `MMD_PET_DEBUG_EVENTS_LOG` 指定路径；默认不开启。`Notification Detail` 和 `Language / 语言` 由主进程写入 Electron `userData/pet-settings.json`，下次启动会先从 settings 初始化菜单语言和勾选态；语言切换只影响 desktop-pet 右键菜单标签，不切换主站语言，也不写入 SQLite。Pet window bounds 在 move/resize、drag end 和 close 时保存，恢复时采用 x/y/width/height，width/height 会被归一到 240x280 以上。主站 `/companion` 高级面板提供显式 `保存到桌面 Pet` 按钮，用当前模型和渲染管线写入 shared config；pet 右键 `Sync from Main Site` / `从主站同步` 会让 renderer 重新读取模型、动作和 shared-config，成功后显示同步到的模型名与 render pipeline，并递增 stage reload revision 以强制 MMDStage remount 一次。`New Codex Session` 由主进程执行系统启动动作：目标 workspace 优先使用右键 `Workspace -> Select Workspace...` 持久化的 `selectedWorkspacePath`；缺失时才回退 `MMD_PET_WORKSPACE_PATH`，再回退 Electron 当前工作目录（若当前工作目录是 `desktop-pet`，则自动上提到父级项目根目录）。主进程先在目标 workspace 写入 `.codex-pet/vscode-terminal-request.json` 和 `<os.tmpdir()>/mmd-codex-pet/vscode-terminal-request.json`，其中包含 `codex` 或 `codex resume --cd <workspace> <codex_session_id>` 命令，再按 `MMD_PET_VSCODE_HELPER_MODE` 打开 VSCode：默认或未知值为 `development`，使用 `MMD_PET_VSCODE_CLI`（默认 `code`）执行 `code --new-window --user-data-dir <os.tmpdir()/mmd-pet-vscode-ud/...> --extensionDevelopmentPath <desktop-pet/vscode-helper> <workspace>`，确保新窗口加载 helper 并处理 terminal request；`installed` 模式执行 `code --new-window --user-data-dir <os.tmpdir()/mmd-pet-vscode-ud/...> <workspace>`，要求 helper extension 已通过 `desktop-pet/scripts/install-vscode-helper.ps1` 或等效方式安装并启用。Windows shell 启动时会显式 quote VSCode CLI、helper 路径、user-data-dir 和 workspace 路径，确保 `D:\workspace\MMD project` 这类含空格路径不会被拆成 open editors。`MMD_PET_VSCODE_HELPER_EXTENSION_PATH` 可覆盖 development helper extension 路径。VSCode helper 扩展启动后读取该 request，创建或复用 VSCode 内置终端 `Codex Pet`，并在该终端执行 `MMD_PET_CODEX_CLI`（默认 `codex`）或 resume 命令；执行成功后 helper 会删除 request 文件，超过 5 分钟的旧 request 会被忽略并清理，避免后续打开 workspace 时误启动 Codex。Pet 不再启动外部 `cmd.exe`。`Send Prompt...` / `发送 Prompt...` 先在 renderer 打开 `.pet-panel` prompt 面板，preload 通过 `pet:prompt:send` 调主进程；当前优先走 app-server relay，relay 不可用时把 prompt 暴露为状态卡上的 copyable command，不直接写 terminal request。启动后主进程仍会短轮询当前选中 workspace 的本地 JSONL，把新 session metadata 同步到 registry。`Recent Sessions` 子菜单现在会缓存最近 session；点击任一项会打开该 session 记录的 VSCode workspace，并通过同一 helper request 在 VSCode 内置终端执行 `codex resume --cd <workspace> <codex_session_id>`，因此 Codex 原有 `CODEX_HOME` session 存储保持不变，CLI 可正常 resume 会话。主进程会同步维护 `pet:codex-status`：启动前发布 `starting`，成功拉起 terminal request 后发布 `launched`，恢复时发布 `resuming`/`running`，发送 prompt 成功后发布 `running`，本地 JSONL 推断状态会发布 `running`、`command_running`、`waiting_approval`、`completed`、`failed` 或 `disconnected`，失败时发布 `failed` 和错误信息；每次 `pet:codex-status:changed` IPC 发送后都会调用 `webContents.invalidate()` 调度 transparent Pet 窗口重绘，避免未聚焦窗口的状态卡等到 focus/hover 才刷新。preload 暴露 `codexStatus.get/onChanged` 给 renderer，pet 状态条会把该状态作为常驻状态显示（短暂菜单 toast 结束后仍保留，例如 `Codex running · <session title>`）。`Open VSCode Workspace` 和 renderer 审批 fallback 按钮都通过当前选中 workspace 打开新的 VSCode window；focus 成功只在 renderer 里短暂显示 `VSCode workspace open` toast，不发布新的 Codex 状态，也不覆盖当前 running/output/approval 状态。`More Sessions...` 点击后主进程会拉取最多 50 条 session（API registry 加当前 workspace 本地 JSONL fallback），通过 `pet:menu:action` 发送给 renderer，renderer 在 Pet 窗口内显示可搜索 session 面板，按 title/workspace/status/time 生成搜索文本并展示可读 title、workspace、状态和最近时间；点击面板中的 active session 会调用 `pet:sessions:focus-active` IPC，主进程先用内存映射或 `<user-data-dir>/.codex-pet/session-window.json` marker 按 session id 找回已有 VSCode 窗口；marker 缺失时会扫描 VSCode `User/workspaceStorage/*/workspace.json` 做一次性 workspace 兜底，以已有 `user-data-dir` 调 `focusVscodeWorkspace`，不写入精确 session marker；非 active session 才调用 `pet:sessions:restore` IPC，复用 `restore-session` 分支在 VSCode 内置终端执行 `codex resume --cd <workspace> <codex_session_id>`。

Pet window bounds 启动恢复会按当前 Electron `screen.getAllDisplays().workArea` 校验。保存坐标仍有至少 80px 可见边时继续使用原坐标和保存尺寸；如果 RDP、多屏切换、DPI 变化或断开副屏导致保存坐标不在任何当前显示器工作区内，主进程会按保存 width/height 把 Pet 窗口回退到主显示器工作区居中，并写入 `window-bounds:restored-to-visible-area` debug event，避免窗口只出现在任务栏缩略图而桌面不可见。

桌面 Pet 主窗口的可见性契约：主 renderer 触发 `did-finish-load` 后，Electron 主进程先检查窗口是否处于最小化状态；若 Windows/Electron 继承了最小化状态，先调用 `restore()`，再以不抢焦点的 `showInactive()` 显示；若窗口未最小化但被隐藏，则只调用 `showInactive()`。该恢复路径不调用 `focus()`、不重置已经解析并持久化的 bounds，也不改变 always-on-top、拖动或菜单窗口行为；随后才写入 `pet-ready.json` 的 renderer ready 标记，因此 ready marker 不再代表一个仍停留在最小化状态的 Pet 窗口。

右键 `Workspace` / `工作区` 子菜单会基于当前菜单可见的 session 集合额外聚合 `Active Workspaces` / `活跃工作区`：来源包括主进程内存缓存、当前选中 workspace 的本地 JSONL 扫描结果，以及 API registry 成功刷新后的 recent sessions。聚合只统计 `starting`、`running`、`command_running`、`file_changed`、`waiting_approval` 这类仍活跃状态，排除 `completed`、`failed`、`disconnected`。`Active Workspaces` 先按 workspace 分组，每个 workspace 以目录 basename、最近活跃状态和活跃任务数显示为二级子菜单；展开后列出该 workspace 下按最近更新时间排序的活跃任务，点击任务项发送 `focus-active-session`，主进程使用运行时内存映射或 `<user-data-dir>/.codex-pet/session-window.json` marker 按 session id 找回 VSCode `user-data-dir`，再调 `focusVscodeWorkspace({ workspacePath, userDataDir })`，只聚焦该任务已有窗口，不执行 `codex resume` / `claude --resume`。new/restore 启动 VSCode 时会先写 workspace 级 marker，JSONL watcher 识别出真实 session id 后会补写 session 级 marker；Pet 重启后仍可按 marker 聚焦对应任务。若 marker 缺失，主进程会扫描 VSCode `User/workspaceStorage/*/workspace.json` 做一次性 workspace 兜底，但不会把该猜测写成 session marker；完全找不到时才发布 failed 状态提示窗口元数据不可用，仍不退回 restore，以避免同一工作区重复开新 VSCode window。当前选中的 workspace 在分组内显示为已勾选的 `Current workspace`，其他 workspace 分组内提供 `Switch to workspace`，点击后写入 Electron `userData/pet-settings.json` 的 `selectedWorkspacePath`、发布 idle `pet:codex-status`、清空当前菜单 session cache 并后台刷新该 workspace 的 sessions。该切换只影响 desktop-pet 的后续菜单扫描、新建/恢复/打开 VSCode 目标，不写入 SQLite 或主站 shared config。

当前实现准则（替代上文旧的 workspace/global singleton request 与独立 `--user-data-dir` 描述）：Codex 新建/恢复会在 `<os.tmpdir()>/mmd-codex-pet/vscode-workspaces/<launch-id>/` 生成唯一 `session.code-workspace`，其中只挂载真实目标 workspace；随后执行 `code --new-window --skip-add-to-recently-opened [--extensionDevelopmentPath <desktop-pet/vscode-helper>] <session.code-workspace>`。该命令复用默认 VSCode profile/main process 的 CLI IPC，但唯一 workspace-file URI 会形成独立窗口，因此即使 Windows 的 `vscode-updating` mutex 被更新器占用，只要默认 VSCode 实例仍在运行，也不会再因新建隔离 profile 而进入更新锁等待。`MMD_PET_VSCODE_HELPER_MODE=installed` 仍不传 `--extensionDevelopmentPath`；默认 development 模式加载仓库内 helper。

每个 launch 的 terminal request 和 ACK 都只保存在该临时 workspace 目录的 `.codex-pet/vscode-terminal-request.json` 与 `.codex-pet/vscode-terminal-ack.json`。request 带 `targetWorkspaceFilePath`、`ackPath`、`expiresAt`、真实 `workspacePath` 与 `codex`/resume 命令；helper 从当前 `vscode.workspace.workspaceFile.fsPath` 推导自己的 scoped request，只在目标路径归一化匹配时消费，防止其他已打开 VSCode 窗口通过旧 global pointer 抢单。helper 在 integrated terminal `sendText` 成功后写匹配 request id 的 ACK，ACK 落盘成功才删除 request；ACK 写失败会重试但不会重复发送命令。Pet 主进程保持 `starting`/`resuming`，只有读到匹配 ACK 才发布 `launched`/`running`、缓存窗口目标并启动 JSONL watcher；20 秒内无 ACK 则发布 `failed`，错误会明确提示 VSCode 可能仍在更新或 helper 未加载。request 同时在 20 秒后过期，迟到窗口不会再误启动 Codex。

desktop-pet 的 `Codex Environment` / `Codex 环境` 菜单选择会写入 `pet-settings.json` 的 `codexEnvMode`，菜单每次打开时按当前持久值勾选，并在新建/恢复开始时快照传给 launcher。`win` 模式继续在 integrated terminal 执行 `MMD_PET_CODEX_CLI`（默认 `codex`）或 `codex resume --cd <Windows workspace> <session-id>`；`wsl` 模式先执行 `MMD_PET_WSL_EXEC`（默认 `wsl.exe`）的 `--cd <workspace> --exec` 桥接，再运行 WSL 内的 `MMD_PET_WSL_CODEX_CLI`（默认 `codex`），并附加 `-c model_provider=kscc -c model=gpt-5.5`。`wsl.exe --cd` 可直接接收绝对 Windows 路径或绝对 Linux 路径，因此含空格 workspace 作为单独 quoted 参数传入，无需预先调用 `wslpath`；恢复命令在 WSL 已切换的工作目录中使用 `resume --cd . <session-id>`，不会把 `D:\...` 再交给 Linux Codex。这里的菜单选择只控制 desktop-pet 的 VSCode terminal launcher，与 FastAPI app-server 的 `CODEX_WSL_ENABLED` 是两套独立开关。

`Codex Launch Target` / `Codex 启动目标` 持久化在 `userData/pet-settings.json` 的 `codexLaunchTarget` 字段，默认值为 `vscode-cli`。当当前 agent 为 Codex 且选择 `codex-desktop` 时，新建本地会话通过 `codex://new?path=<URL 编码工作区>` 打开 Codex Desktop；最近会话的 restore，以及 `Recent Sessions`/`Active Workspaces` 中活动会话的 focus，则通过 `codex://threads/<codex_session_id>` 打开对应已有 Desktop 线程，不再调用 `resumeCodexSession` 或 `focusVscodeWorkspace`。IPC 的 `pet:sessions:focus-active` 与右键菜单共用同一主进程 action dispatcher，避免 renderer/IPC 路径绕过启动目标判断。Claude、Pet app-server 会话、显式 `Open VSCode Workspace` 以及切回 `vscode-cli` 后的 CLI 路径保持原行为；远程 Codex Desktop 项目仍只支持确认后复制远程路径并打开未绑定的新任务入口，不能通过 session deeplink 自动绑定远程项目。协议构造和调用路径由 `codexDesktopLauncher.test.ts`、`mainIntegration.test.ts` 覆盖；真实 Codex Desktop UI 是否按当前安装版本导航，仍需手工点击验收。

补充：状态卡点击、无 approval id 的审批 fallback，以及完成通知正文/按钮的聚焦操作统一调用 `pet:codex:focus`，由主进程按当前 `agent` 与 `codexLaunchTarget` 分派。Codex Desktop 路径要求存在 `codex_session_id`，并打开 `codex://threads/<codex_session_id>`；缺少会话 id 时明确报错，不静默退回 VSCode。只有用户显式选择 `Open VSCode Workspace` / `打开 VSCode 工作区` 时才调用 VSCode 聚焦入口。

补充：纯 `Open VSCode Workspace` / 状态卡 focus 新开窗口时同样生成唯一临时 `.code-workspace`，但不写 terminal request；聚焦已存在的活跃 Codex 任务时则执行 `code <该任务的 session.code-workspace>`，由 VSCode 按 workspace identity 聚焦原窗口，不传 `--new-window`、不执行 resume。主进程内存映射和持久 marker 现在优先保存 `workspaceFilePath`；旧版隔离 profile 的 `userDataDir` marker 仍可读取兼容。启动时会对旧 `<os.tmpdir()>/mmd-pet-vscode-ud/` 与新 `<os.tmpdir()>/mmd-codex-pet/vscode-workspaces/` 中超过 7 天的目录做最佳努力清理。focus 成功仍只显示 renderer toast，不覆盖当前 `pet:codex-status`。

补充：terminal 新建/恢复/fallback prompt 不再只依赖固定 1.5s/5s/12s 短轮询；主进程会启动一个有上限的 JSONL watcher 持续刷新当前 workspace/session 的 `last_output`，让 VSCode 内置终端里启动的 Codex 输出能进入 Pet 状态卡。

watcher 的首轮绑定区分“尚无 session id 的新建会话”和“已绑定/resume 会话”。Codex 与 Claude scanner 的 summary 都带 `sessionStartedAt`，优先取已读取 JSONL 事件中最早的有效 `timestamp`，完全缺失时回退文件 `birthtime`/`ctime`，并通过 payload metadata 的 `session_started_at` 传递。新建 watcher 尚无 session id 时，用 `sessionStartedAt >= launchedAt - 1s` 过滤候选，避免一个启动前已存在、但仍在写入且 file mtime 更新较新的长会话抢占新窗口；首个候选命中后立即固定 `codexSessionId`。已固定 id 的 watcher 与 resume watcher 则继续按精确 session id + file mtime 判断后续更新。Codex scanner 同时读取 Windows `CODEX_HOME` 与可选 WSL Codex home 时，会先合并所有 root candidate、按 mtime 全局降序并去重，再应用全局 `maxFiles`/`limit`，不会因为 Windows root 先填满 limit 而跳过更新的 WSL session。

workspace 比较统一使用 `normalizeWorkspacePathIdentity()`：Windows `<drive>:\...`、正反斜杠/大小写/末尾分隔符差异，以及 WSL `/mnt/<drive>/...` 都折叠为同一个 `<drive>:/...` identity；非 WSL POSIX 路径仍保持大小写敏感。Codex/Claude scanner 的 workspace filter、workspace+agent generation context gate、active-session workspace cache key，以及菜单/background/daily 的当前 workspace publisher 都复用该归一化。因此 Pet 选择 `D:\workspace\Project` 时，WSL rollout 记录的 `cwd=/mnt/d/workspace/Project` 仍属于当前 workspace，不会被过滤、误判为 stale context 或被当成跨 workspace session。

所有可能跨 await 的 session refresh/list/new/restore 操作都捕获 `{ generation, workspacePath, agent }` context。选择或切换 workspace、切换 Coding Agent 时会推进 generation；异步 upsert、API list、background refresh、More Sessions、VSCode helper ACK 以及 new/restore launch 结果在写 cache、发布 status 或启动 watcher 前重新校验 context，旧 generation 或 workspace/agent 不匹配的迟到结果直接丢弃。菜单 immediate publisher、background refresh 和 daily scan 只从当前 workspace/agent 选择 session；只要当前 Pet window 仍有 active watcher，这些普通 publisher 就不覆盖 watcher 状态。watcher 自身继续用 WeakMap identity 复检，已被替换或停止的 tick 即使 await 返回也不会发布。

完成通知窗口的显示状态独立于 `codexStatus`。收到新的显式 `completionNoticeKey` 时，新 notice 替换旧 notice；普通 running、历史 completed、菜单/background/daily 等不带显式 key 的状态更新只刷新状态卡，不会让尚未关闭的通知消失。只有用户点击 `x` 才把当前 key 加入 dismissed 有界集合并清除同 key notice；已 dismissed 的 key 不会重新进入通知状态。这样 A 通知显示期间的普通状态刷新会保留 A，新显式 B 会替换为 B，而关闭过 A、B 后再次收到相同 A key 仍保持关闭。收起态聚合胶囊、展开态最多 3 条纵向通知及对应 bounds 高度规则，另由 `PetCompletionNoticeWindow` 概念契约约束。

当前实现中，上述 `Send Prompt...` 的 terminal `mode=prompt` 路径只作为 app-server relay 失败后的 fallback；正常情况下 Pet prompt 会优先走 `/codex/interactive/sessions` + websocket relay，审批按钮也只有 relay 状态携带 approval id 时才直接显示。

Coding Agent 切换：desktop-pet 右键菜单新增 `Coding Agent` / `编程助手` 子菜单，可在 `Codex` 与 `Claude`（Claude Code）之间切换当前编程助手，选择持久化到 `userData/pet-settings.json` 的 `agent` 字段（默认 `codex`，启动时读取）。切换是新建/恢复/发 prompt/会话扫描/状态卡文案的统一分派维度，菜单 `New {agent} Session` 标签和状态卡前缀（`Claude running …` / `Codex running …`）都随当前 agent 变化。两个 agent 复用同一套 VSCode 终端启动机制（同一 `.codex-pet/vscode-terminal-request.json` 请求文件 + 全局临时指针 + helper），仅终端名区分：Codex 用 `Codex Pet` 终端、Claude 用 `Claude Pet` 终端，互不串扰；命令行不同——Codex 为 `codex` / `codex resume --cd <workspace> <id>`，Claude 为 `claude` / `claude --resume <id>`（Claude CLI 无 `--cd`，靠终端 cwd 锁定 workspace，由 helper 用 `request.workspacePath` 作为终端 cwd 保证）。Claude CLI 可用 `MMD_PET_CLAUDE_CLI` 覆盖（默认 `claude`）。Claude 会话扫描读取 `CLAUDE_CONFIG_DIR`（默认 `%USERPROFILE%/.claude` 或 `$HOME/.claude`）下的 `projects/**/<session-id>.jsonl`，按每行 `cwd` 字段过滤当前 workspace（不依赖目录名编码），抽取首条真实用户 prompt、尾部 assistant 文本、tool_use/tool_result 推断的 bounded review facts 与状态；可推断 `running`/`command_running`（Bash 系工具）/`file_changed`（Edit/Write/MultiEdit/NotebookEdit）/`completed`（`stop_reason=end_turn`），但 Claude 的审批是交互式 UI、不落 JSONL，因此 Claude agent 下不会出现 `waiting_approval` 状态、也没有 approval id。Claude 是纯本地链路：不调用 FastAPI `/codex/interactive/*` relay，也不把会话 upsert 到 `desktop_pet_sessions` registry；app-server relay 与 approval 直显仅在 Codex agent 且 API 可用时启用。`desktop_pet_sessions` SQLite registry 仍只承载 Codex；Claude session 持久化保持在用户既有 `CLAUDE_CONFIG_DIR`，Pet 不复制、不移动、不落库 Claude transcripts。

More Sessions renderer 面板当前在每条 session row 内显示 title、workspace、status、最近时间、首条 prompt preview 和最近 summary preview。`desktop-pet/src/codex/sessionPicker.ts` 会把 prompt/summary 压缩成单行、做长度截断，并对明显 `token`、`password`、`secret`、`key`/`api_key` 等 `key=value` 或 `key: value` 形式替换为 `[redacted]`；搜索索引使用脱敏后的 title/workspace/status/time/prompt/summary，避免面板搜索文本保留原始 secret。picker 同时按 `starting`、`running`、`command_running`、`file_changed`、`waiting_approval` 标记 `isActive`：active row 点击调用 `pet:sessions:focus-active`，复用主进程内存映射、session-window marker 或 workspaceStorage 兜底聚焦任务窗口；非 active row 继续调用 `pet:sessions:restore` 恢复历史会话。面板沿用 `.pet-panel` pointer 保护和 row 级 `-webkit-app-region: no-drag`，不触发整窗拖动。

desktop-pet 右键菜单还有一个 active 生命周期保护：主进程从准备 `Menu.popup` 到 native menu close callback 结束期间设置 `contextMenuActive`，此时任何 native、renderer、system 或 webcontents 来源的新 popup 请求都会被 dedupe，避免连续右键重入 Electron native menu。`desktop-pet/scripts/stress-pet-right-click.ps1` 使用真实 Windows 输入循环验证菜单 open/popup/closed 计数、`context-menu:error` 数量和 Electron 进程存活；脚本默认拒绝控制真实鼠标，必须显式传 `-AllowMouseControl`，并在退出或失败时释放鼠标按钮、恢复鼠标位置和 Pet 窗口位置。脚本关闭菜单时只向 Pet BrowserWindow owner hwnd 投递 `WM_CANCELMODE`/targeted Escape window message，不使用全局 `keybd_event`，避免把 `Esc` 发送到用户当前命令行或 Codex 终端。该脚本还提供 `-EdgePlacement Right|Bottom|BottomRight`，可把 Pet 移到当前显示器工作区边缘后执行短烟测或压力测，并断言右键后窗口漂移不超过 `MaxWindowDriftPx`、尺寸不变、菜单 popup/closed 数量满足 sequential click 数量且没有 error 事件；`desktop-pet/scripts/desktop-pet-manual-acceptance.md` 固定记录启动、右键、拖动、相机、同步、Codex 新建/恢复的真实桌面验收步骤。Pet 相机状态不走共享配置 API；renderer 在从 `Adjust Camera` 切回 `Drag Whole App` 时 capture 当前 `MMDStage` camera snapshot，归一成 drag-mode 初始化用的 locked snapshot，并按 `selectedModel.relative_path + render_pipeline` 写入 localStorage。后续同一模型和 render pipeline 的 Pet 初始化、同步后 remount 或应用重启会把该 snapshot 传给 `MMDStage.cameraSnapshot`；不同模型或管线不会复用该镜头。Pet 角色点击动作复用主站 `resolveStageCharacterClickInteraction()`：在 `Drag Whole App` 模式下，renderer 顶层透明 hit surface 记录 pointer click，再通过 `MMDStage.hitTestCharacterAtClientPoint()` 确认是否点中角色；命中后优先播放 greeting/soft/strong click reaction favorite VMD，并在有其他可用动作时避开上一条 click VMD，缺失 VMD 时回退 procedural wave。点击动作完成或失败后，Pet 清空 click override，回到当前模型的 idle/autoplay loop；`Adjust Camera` 模式仍关闭角色点击捕获，让 OrbitControls 接管鼠标。

desktop-pet 当前有两类 Codex 状态源。VSCode terminal 新建/恢复流程仍保留用户既有 `CODEX_HOME` session 存储：主进程在 Pet renderer 每次 `did-finish-load` 后、右键菜单打开、`More Sessions...` 打开，以及 terminal 新建/恢复/fallback prompt 后扫描当前 workspace 的 `CODEX_HOME/sessions/**/rollout-*.jsonl`，分块流式读取完整事件序列并只抽取 bounded metadata。此外，主进程在 Pet 窗口创建后会调度每天凌晨 4 点的定时扫描（`setTimeout` 递归调度），扫描最近 20 条会话并 upsert 到 FastAPI，确保夜间完成的 Codex 会话也会被 review sync 链路捕获；窗口关闭时清除该定时器。白天会话结束时，codex-session output watch 在检测到 `completed` 状态时会立即触发一次完整扫描上报，不需要等到凌晨 4 点；该 sibling scan 使用 `publishStatus=false`，不会再用其他最近 session 覆盖刚完成的状态。这样状态卡在 Pet 窗口首次显示时就会同步最近 session/output，不再依赖“先打开一次右键菜单”才看到最新内容。terminal 路径启动后会开启 `codex-session` JSONL watcher：先立即扫描一次，随后约每 2.5s 刷新一次，最长保留 1 小时；新建 watcher 第一次匹配到 launch 时间之后的 JSONL 后会把 `codexSessionId` 固定到该 session，避免同 workspace 其他并发 rollout 仅凭较新的 mtime 抢占状态。新 watcher 会替换同一 Pet 窗口上的旧 watcher，窗口关闭时停止，扫描到 `failed`、`disconnected` 或 `completed` 都会提前停止；`completed` 路径先发布该 completion、完成一次不发布状态的 scan/upsert，再以 `reason=status:completed` 停止。用户选择/切换 workspace 或切换 Coding Agent 时，主进程也会先停止旧 watcher，并重置 completion transition tracker，旧上下文的迟到异步结果在 watcher identity 复检后直接丢弃。JSONL 状态精度受 Codex CLI 写入时机和 Pet 扫描节奏限制：该源可推断 `running`、`command_running`、`file_changed`、`waiting_approval`、`completed`、`failed` 和 `disconnected`，但没有 approval id 或实时 token stream。Pet 内直接 `Send Prompt...` 在 API 可用且 `MMD_PET_CODEX_RELAY_ENABLED` 未显式设为 `0/false/off/no` 时优先使用 app-server relay：Electron 主进程通过 `CodexInteractiveRelayClient` 登记当前 git workspace、创建 `/codex/interactive/sessions` session（默认 `MMD_PET_CODEX_RELAY_MODE=patch`，可设为 `read_only`）、打开 `/ws/codex/interactive/{session_id}`，发送 `{ type: "user_message", text, mode }`，并把 websocket 事件实时折叠为 `pet:codex-status`。relay 状态源可提供 `approval_required` 的 approval id、审批 title/detail、`text_delta`/`command_output`/`turn_completed` 的最近输出；renderer 因此可以显示 direct `Approve`/`Deny`，并通过 `pet:approval:decide` 调 `POST /codex/interactive/{session_id}/approvals/{approval_id}`。如果 API 不可用、workspace 登记失败、session capacity 限制或 websocket 连接失败，主进程记录 `codex-relay:send-prompt-fallback`，再回退到 VSCode terminal prompt request；该回退仍只向当前 `Codex Pet` 内置终端 `sendText(prompt, true)`，不具备协议级 approval id。

renderer 侧 Codex 状态纯函数把 scanner/relay 状态映射为 `motionIntent`、`statusTone` 和 `shouldInterruptIdle`：`running -> thinking/active`、`command_running -> command/active`、`file_changed -> file_change/attention`、`waiting_approval -> approval/attention`、`completed -> complete/success`、`failed -> failure/danger`、`disconnected -> disconnected/offline`。MMD stage 纯函数再把这些 intent 转为 procedural status interaction；如果当前 click reaction 仍 active，Codex status motion 返回 `click-interaction` 优先级和 blocked reason，不覆盖点击动作。App 在把 Codex status interaction 传给 `MMDStage` 前会先做可播放命中解析：VMD interaction 必须有 runtime 可直接播放的 `vmdUrl`，procedural interaction 必须命中 runtime 支持的 action 或 sequence step；未命中时直接使用当前模型的 `petAutoplayIdleState.interaction`，优先进入 favorite idle/autoplay VMD loop。如果兜底本身也没有可播放 VMD，App 返回 null 并保留当前 stage interaction，不再应用 procedural idle 去触发 runtime 重置，避免停在 base pose。因为 procedural status action 播完后 runtime 会清空当前 action，Pet 对 `starting`、`launched`、`resuming`、`running`、`command_running`、`file_changed`、`waiting_approval` 和 `disconnected` 这类活跃状态会在 completion 回调中递增 replay revision，重新 apply 同一个 Codex status interaction，避免执行中状态只播一个周期后长期回到待机；`completed` 和 `failed` 仍按一次性提示处理，播完后可恢复待机。`Notification Detail` 的 renderer 策略为 low/medium/high：low 只给短状态并省略 workspace/path/session id；medium 给可读 session title、workspace basename 或错误信息，仍不暴露完整 path/id；high 用于诊断，可包含完整 workspace path、Codex session id 和 updatedAt。`waiting_approval` 分两种处理：`source="app-server-relay"` 且状态包含 `pendingApprovals[].id` 时，状态条显示 direct `Approve`/`Deny` 按钮；本地 JSONL scanner 没有 approval id 时仍只显示 fallback message 和 `Open VSCode`，引导用户在 VSCode Codex terminal 内审批。

desktop-pet Electron API runtime helper 位于 `desktop-pet/electron/apiRuntime.ts`，用于主进程统一集成 API 可用性判断和可选自启动。主进程创建 Pet window 后会后台调用 `ensureApiRuntime()`，把最近一次结构化结果保存到 `currentApiRuntimeStatus`，用 `pet:api-runtime:changed` 发送给 renderer，并记录 `api-runtime:status` 或 `api-runtime:error` debug event；该状态不会阻塞 Pet 窗口启动。`runtimeInfo()` 同时返回 `apiBaseUrl` 和最近 runtime status；preload 还暴露 `apiRuntime.get()`、`apiRuntime.retry()` 和 `apiRuntime.onChanged()`。renderer 首次 API 加载失败时显示 `API unavailable` 和 `Retry` 按钮；用户点击 Retry 会让主进程重新 probe/autostart，若后续 status 变为 available，renderer 会自动重新读取 shared config、模型和 VMD 资产。helper 默认检查 `MMD_PET_API_BASE_URL`（缺省 `http://127.0.0.1:8000`）的 `/healthz`；fetch 失败或非 2xx 会返回结构化 `state="unavailable"`、health URL、失败原因、attempts、checkedAt 和 autostart 状态，让菜单/session 流程继续走本地 JSONL fallback。默认不启动 API；只有 `MMD_PET_API_AUTOSTART=1` 且 `MMD_PET_API_START_COMMAND` 非空时，helper 才会以 hidden detached background process 执行该命令，stdout/stderr 写入 `MMD_PET_API_LOG_DIR` 或 `<cwd>/.codex-pet/api-runtime/` 下的 `api-runtime.out.log` / `api-runtime.err.log`，随后按 retry 配置重新 probe `/healthz`。启动命令作为单条 shell command 传给 `spawn(command, [], { shell: true, windowsHide: true })`，因此 Windows 上包含空格的脚本路径应由 env 值自身加引号，例如 `"D:\workspace\MMD project\scripts\start api.ps1" --port 8000`。

`desktop-pet/start-pet.ps1` 未显式传 `-ApiBaseUrl` 且当前 shell 未设置 `MMD_PET_API_BASE_URL` 时，会读取项目根目录 `.runtime/dev-stack.json` 中的 `api.url`，并先验证该 URL 的 `/healthz` 可访问；验证通过后脚本会把该 URL 注入 Electron 进程的 `MMD_PET_API_BASE_URL`。因此 dev-stack 改用 8100 等非 8000 端口时，Pet 通过该脚本启动会自动连接当前运行的 API；只有 dev-stack state 不存在、解析失败或 health check 不通时才回退 `http://127.0.0.1:8000`。

desktop-pet 启动时会在 Electron main 进程尽早安装 crash diagnostics。`crashReporter.start({ uploadToServer: false })` 会收集后续 renderer、GPU/utility 等子进程 crash dump，dump 目录默认是 `desktop-pet/.codex-pet/crash-dumps`，可用 `MMD_PET_CRASH_DUMPS_DIR` 覆盖；结构化事件默认写入 `desktop-pet/.codex-pet/logs/crash-events.ndjson`，可用 `MMD_PET_CRASH_EVENTS_LOG` 覆盖。该 NDJSON 不依赖 `MMD_PET_DEBUG_EVENTS`，会记录 `crash-reporter:started`、`renderer:gone`、`child-process:gone`、main process `uncaughtExceptionMonitor`、`unhandledRejection`、Node warning，以及 preload 转发的 renderer `error` / `unhandledrejection`。真正的 native main-process 崩溃仍可能只能留下 Electron crash dump 或 Windows Error Reporting 记录；renderer/GPU 崩溃会优先通过 Electron gone events 写入 reason、exitCode、webContents id 和 URL。

desktop-pet 右键菜单提供 `Always on Top` / `固定在顶部` checkbox，用于切换当前 Pet BrowserWindow 是否保持置顶。启动默认仍为置顶开启，但会被 Electron `userData/pet-settings.json` 中的 `alwaysOnTop` 覆盖；用户点击后主进程 merge 写回该设置，调用 `BrowserWindow.setAlwaysOnTop(true, "floating")` 或 `BrowserWindow.setAlwaysOnTop(false)` 立即生效，并把动作发送给 renderer 显示短暂状态提示。该状态不写入 SQLite、shared config 或 renderer localStorage。

共享配置 API 合约：

Codex 状态卡补充：desktop-pet 的本地 JSONL scanner 除了 session title/status，也会提取最近一条 assistant 文本或 `function_call_output`，通过 registry payload 的 `metadata.last_output` 进入 renderer；app-server relay 则直接从 websocket `text_delta`、`command_output`、`approval_required`、`turn_completed` 等事件折叠最近输出。renderer 的常驻 Codex 状态卡用状态灯表达 `active/attention/success/danger/offline` 状态，文字标题只保留给无障碍文本和 tooltip；当 MMD 模型已加载且没有 active Codex 状态、加载错误或菜单 toast 时，renderer 仍显示 `Codex idle` / `No active Codex output` 占位状态卡，避免桌面 Pet 只剩角色而看不到消息框。

完成态通知使用 `PetCompletionNoticeWindow`（Pet 独立完成通知窗口）实现：主进程 completion tracker 只有在真实 `running -> completed` transition，或新 watcher 首轮即捕获 launch 后快速完成时，才附加显式 `completionNoticeKey`；key 优先使用 `<codexSessionId>:<last_event_at>`，缺少事件时间时回退 session id。启动、菜单或 background refresh 首次看到的历史 `completed` 只更新状态卡，不携带通知 key，因此不会弹通知。主进程 reducer 根据显式 key 生成通知状态，并创建透明、无边框、置顶、跳过任务栏的独立 Electron `BrowserWindow`，加载 `notification.html`；通知 renderer 通过独立的 `pet:completion-notice:*` preload IPC 实现收起、展开、关闭和通过统一目标路由聚焦对应会话。通知最多保留最新 3 条：收起态渲染为一个聚合胶囊，展开态按时间倒序显示最多 3 条纵向通知，不能把收起态实现成逐条卡片堆叠。窗口宽度为 `286px`，收起态高度固定为 `78px`；展开态高度为 `n * 190px + (n - 1) * 8px`（`n=min(count,3)`），即 1/2/3 条为 `190/388/586px`。通知文本由 `codexPresentation.ts` 的 `buildCodexCompletedPresentation()` 统一投影，Pet 完成状态卡和独立通知共享工作区名、任务标题回退、注入上下文过滤、机器包装行过滤、敏感值脱敏、限长和限行语义；通知状态另外保留 `outputLines`，收起胶囊和展开卡片都从同一投影消费。当前单条通知默认按 Pet 主窗口水平居中、显示在 Pet 上方，通知底部与 Pet 顶部保留固定间距；若显示器顶部空间不足，则将通知窗口裁切到当前显示器 `workArea` 内，不再优先放在 Pet 左右两侧。Pet 移动、缩放、显示器工作区变化时，主进程重新计算通知窗口位置和尺寸，收起/展开分别调整窗口高度。关闭后的 key 由主进程持久化到 `app.getPath("userData")/dismissed-completion-notice.json`，最多保留最近 100 个且去重。该实现不是浏览器 DOM 内嵌通知，也不等同于 Windows 系统 Toast；自动化测试覆盖 reducer、去重、聚合高度、dismiss、IPC sender 和文本投影一致性，HWND/bounds 记录证明 Pet 与通知是两个 OS 窗口，窗口级截图证明收起、展开、最多 3 条、移动跟随和关闭后的真实桌面表现。状态卡、审批 fallback 与完成通知点击统一调用 `pet:codex:focus`，Codex Desktop 目标通过 `codex://threads/<codex_session_id>` 聚焦对应线程；只有显式 `Open VSCode Workspace` 菜单项仍打开 VSCode。Pet 的角色点击命中和动作选择继续复用主站 `stageCharacterClick` helper：renderer 用共享 `shouldTriggerStageCharacterClick()` 判断 click 手势和共享 `createStageClickRipple()` 生成波纹，Pet stage state 用共享 `resolveStageCharacterClickInteraction()` 选择 click reaction VMD，后续维护只改这一份主站 helper。

- `GET /desktop-pet/shared-config`：按 `x-user-id` requester identity 返回该 user 的共享 companion config。
- `PUT /desktop-pet/shared-config`：按 `x-user-id` requester identity 写入共享配置；body 字段为 `selected_model_path: string | null`（max 1000）与 `render_pipeline: "classic" | "hero-shot" | "genshin" | "mio-reference" | "reze-npr" | "reze-design" | "k3"`（default `classic`）。
- 无效 `render_pipeline` 会被拒绝并返回 `422`。

desktop-pet session registry API 合约：

- 所有 session registry routes 都要求 `x-user-id` requester identity；缺失会返回 `401`。
- `GET /desktop-pet/sessions?limit=N`：返回最近 desktop-pet Codex session registry rows，response shape 为 `{ sessions, limit }`；`limit` 会限制在 `1..50`。
- `POST /desktop-pet/sessions`：upsert 一条 registry metadata row，保存 pet/Codex session id、workspace path、`CODEX_HOME`、display title、status/server metadata、bounded prompt preview/summary；旧版 payload 若未带 `workspace_id`，FastAPI 会写入当前 `CODEX_OPENCLAW_CONTROL_PLANE_WORKSPACE_ID`，让后续 Codex review snapshot 能按 workspace 汇总；key payload limits 为 `display_title <= 48`、`first_prompt_preview <= 240`、`last_summary <= 1000`，`metadata` 保持 JSON object，但 serialized JSON 超过 30000 chars 会返回 `422`。
- `DELETE /desktop-pet/sessions/{pet_session_id}`：删除指定 pet registry row，response shape 为 `{ deleted }`，只影响 `desktop_pet_sessions` registry metadata。
- 这些接口不读取、不复制、不移动、不落库 Codex transcripts；`codex resume` 仍使用用户既有 `CODEX_HOME` 中的 Codex session 持久化。

## 10. 给其他服务做优化时的交接包

### 10.1 给 OpenClaw 服务

需要说明：

```text
本项目调用 /v1/responses。
payload model 固定为 openclaw。
目标 agent 使用 OpenClaw 默认配置，当前为 main；如需固定 agent，可改成 openclaw/<agentId>。
channel 通过 x-openclaw-message-channel=feishu 传递。
session 通过 x-openclaw-session-key 传递；Bridge 绑定会话时该值应为 Feishu external_session_key。
HTTP 请求带 x-openclaw-scopes。
```

希望 OpenClaw 关注：

| 优化点 | 背景 |
| --- | --- |
| `/v1/responses` 响应稳定性 | `model=openclaw` 当前可走默认 `main`，OpenClaw 侧默认模型已切到 `custom/gpt-5.5` |
| `/v1/responses stream=true` | 已验证返回 `text/event-stream`、`response.output_text.delta`、`response.completed` |
| model 参数约束 | 当前 responses 要求 `model` 字符串，`openclaw` 有效 |
| `/v1/audio/speech` | 当前返回 404，如要统一音频需 Gateway 侧支持 |
| WebSocket RPC | Bridge 依赖 `sessions.list`, `chat.history`, `sessions.messages.subscribe`；realtime 可选用 `agent`/`chat` delta 事件 |

### 10.2 给 TTS 服务

需要说明：

```text
本项目通过 POST /api/v1/tts 提交任务。
通过 GET /api/v1/tasks/{task_id} 轮询状态。
完成后读取 audio_url。
FastAPI 保存 remote_audio_url，不把音频写入 SQLite。
前端播放时走 Next.js /api/backend/tts/proxy/{tts_id}?user_id={user_id}，由 FastAPI 再代理 remote_audio_url。
```

希望 TTS 关注：

| 优化点 | 背景 |
| --- | --- |
| 任务完成时间 | 前端同步等待有限，超时会进入 pending + worker |
| 错误信息 | 当前错误会写入 trace 和 message_tts.error |
| audio_url 可访问性 | `/tts/proxy/{tts_id}` 依赖 remote URL 仍可下载 |
| emotion/pause 参数 | 请求会传 `emotion_label` 和 `pause_profile` |

### 10.3 给前端/MMD 渲染侧

需要说明：

```text
前端不直接调用 OpenClaw 和 TTS 外部服务。
前端统一调用 Next.js /api/backend/*，由其转发 FastAPI。
前端会在有用户 session 后静默加载 Bridge 状态，并在 Bridge 启用时跟随默认 binding 的本地会话。
Chatbox 消息列表使用普通文档流渲染，不再使用绝对定位虚拟行；滚动容器直接依赖 DOM 内容高度，避免长回复、窄面板或 TTS/trace 状态变化时因行高测量失准造成 chat item 重叠。
MMD 舞台业务状态由 stageInteractionMachine 维护，MMDStage/Runtime 只执行当前 interaction。
点击人物时，MMDStage 只接受短按、小位移的普通点击；长按和拖动不会触发。通过 runtime raycast 确认真正命中模型后，前端显示一次点击波纹，并切到当前模型 favorite VMD 随机单次动作。点击动作会优先使用 `02_greeting_social`、`05_soft_emotion`、`06_strong_personality` 中有 URL 的 VMD；这些单次点击动作即使 `motion_profile.companion_safe=false` 也允许进入候选池，播放时统一 `lockLowerBody=true`/`disableCrossfade=true`。候选会按 category + 规范化文件名去重，并在存在其它候选时避开上一次点击动作，避免连续触发同一动作；没有分类候选时回退到全部非空收藏（含未分类、companion_safe=false），播放时同样锁下半身；没有任何非空收藏才回退 procedural wave。
Chatbox 消息动作由后端 `motion_resolution` 决定。主路径仍是精确 token 匹配；`think`、`thinking`、`thinking_tilt` 是思考动作的受控语义 fallback，会在当前模型 `03_thinking_waiting` favorite VMD 中优先选择 `100pct/reference/思考` 命名的参考动作；`akimbo`、`hands_on_hips`、`hands-on-hips`、`arms_akimbo`、`arms-akimbo`、`叉腰` 是叉腰动作的受控语义 fallback，会在当前模型 `06_strong_personality` favorite VMD 中优先选择 `100pct/reference/叉腰` 命名的参考动作。Bridge/realtime assistant 消息也复用同一 resolver，但前提是本地绑定 session 已有 `selected_model_path`；没有选中模型时仍保持 `bridge_default_idle`。
MMD 模型 URL 来自 /assets/mmd/models。
VMD 动作 URL 来自 /assets/vmd/file/{asset_id}。
```

希望前端关注：

| 优化点 | 背景 |
| --- | --- |
| 消息状态展示 | assistant_message 可能 degraded/fallback |
| TTS 状态展示 | `tts.status` 可能 ready/pending/failed/expired/partial_failed |
| 动作 fallback | `motion_resolution.status` 可能 fallback_idle；思考和叉腰动作有受控语义 fallback，目标分别是 `03_thinking_waiting/思考_100pct_reference.vmd` 和 `06_strong_personality/叉腰_100pct_reference.vmd` |
| 人物点击 | 点击命中检测在 `MMDCompanionRuntime.hitTestModelAtClientPoint()`，视觉波纹在 `MMDStage` 层，动作选择在 `stageCharacterClick`；优先随机 `02_greeting_social`、`05_soft_emotion`、`06_strong_personality`，候选会按动作名去重并避开上一次点击动作 |
| 收藏 VMD 的角色隔离 | 收藏资产以 `favorite_model_relative_path` 绑定一个 PMX；自动播放、聊天回退、人物点击、收藏页与资源库预览均只允许当前 PMX 的收藏动作。资源库会隐藏其他角色已收藏的动作，且预览/取消收藏入口保留运行时归属校验，防止残留 UI 状态跨角色播放或改写收藏。未收藏的通用 VMD 仍可在任意角色下浏览并收藏到当前角色 |
| 动作状态机 | `default_idle/autoplay_loop/manual_preview/chat_vmd_action/chat_procedural_action/stage_click_vmd_action/stage_click_procedural_action/recovering` 在 `stageInteractionMachine` 中显式维护，避免页面里多处 setter 各自拼状态 |
| 动作完成/异常恢复 | 聊天或预览动作正常完成后会重新从当前模型的 `00_idle_loop` 随机生成本次待机 VMD loop interaction，不依赖 `pendingAutoResume` 标记，也不复用上一次固定 lead VMD；没有分类待机循环时回退旧安全收藏动作池，再没有则默认 procedural idle。VMD/动作播放失败会由 Stage 上报页面，页面立即走同一套收藏优先恢复逻辑 |
| 资源加载错误 | PMX 贴图依赖原包相对路径 |

### 10.4 给 realtime voice 实现侧

当前 realtime voice 已有 Phase 1 可用链路：后端提供 session WebSocket、TTS chunk client、session queue、chunk proxy；前端提供 WebSocket URL helper、AudioQueue 和 Companion 页面接入。它仍是语音侧链路，消息文本生成和持久化仍以 Message Service v2 为主链路。

第一版熔断和限流边界：

```text
只做 session 级 realtime voice circuit breaker。
不做全局 user/workspace 级 rate limit。
queue_full 立即 rejected(queue_full, fallback=message_tts)，并计入 session failure window。
TTS chunk timeout/failed、OpenClaw stream failed、proxy failed、frontend playback failed 计入同一 session failure window。
failure window 达到阈值后，该 session circuit 进入 open，新 job rejected(circuit_open, fallback=message_tts)。
half_open 只允许一个探测 job，其余 job 仍 fallback。
```

第一版 WebSocket 身份合同：

```text
WS /ws/sessions/{session_id}/voice?user_id={user_id}
```

后端将 query `user_id` 映射到 Message Service v2 当前使用的 `x-user-id` 权限模型。缺失、为空或无权访问 `session_id` / workspace 时拒绝连接。第一版不使用首个 `auth` message，也不引入 token。

主要 WebSocket 事件：

```text
client -> synthesize { job_id, message_id, text, emotion_label? }
server -> queued { queue_position }
server -> synthesis_started
server -> audio_ready { job_id, sequence, text, audio_url, duration, elapsed_seconds }
server -> done
server -> rejected { reason, fallback=message_tts }
server -> error { detail }
client -> cancel { scope=all }
server -> cancelled
```

音频代理合同：

```text
GET /tts/proxy/realtime/{session_id}/{job_id}/{sequence}?user_id={user_id}
```

前端播放合同：

```text
sessionVoiceWebSocketUrl(sessionId, userId)
AudioQueue.enqueue({ jobId, messageId, sequence, url })
AudioQueue.hasPlayedChunk(jobId)
AudioQueue.fallbackForJobError(jobId)
```

fallback 规则：

| 场景 | 行为 |
| --- | --- |
| queue/circuit/realtime 失败且该 job 尚未播放任何 chunk | 自动回退到现有长任务 `message_tts` |
| 已经播放过至少一个 chunk 后失败 | 标记 `tts.status=partial_failed`，只提示手动重播 |
| 会话切换/新建会话/组件卸载 | 发送 `cancel(scope="all")`，清空本地 AudioQueue |
| 新用户消息 | 不默认取消旧 realtime voice job |

## 11. 排障入口

| 症状 | 优先检查 |
| --- | --- |
| 前端请求 502 | Next.js `/api/backend/*` 到 FastAPI 的转发 |
| FastAPI 不可用 | `GET /healthz` |
| 服务端全景状态 | 前端 `/status` 或 `GET /admin/runtime-health` |
| OpenClaw 文本失败 | `GET /healthz/openclaw` |
| OpenClaw 超时 | 检查 `OPENCLAW_MODEL`, OpenClaw 默认 agent/model, Gateway 状态 |
| TTS 无声音 | 查 `message_tts.status`, `tts_jobs`, TTS 服务任务状态，浏览器 Network 里 `/api/backend/tts/proxy/{tts_id}?user_id=...` 是否 2xx |
| TTS 引用 `tts_job_max_attempts_exceeded` | 旧 worker 会在 TTS 仍 processing 时提前失败；当前逻辑应保持 pending 并继续轮询，既有 failed 记录需要重新生成或恢复为 pending 后再轮询 |
| 音频 URL 过期 | `POST /message-tts/{tts_id}/mark-expired` 或重新生成 |
| Bridge 不同步 | 先看 `/status` 或 `GET /admin/runtime-health` 的 Bridge latest_message / recent_errors，再看 `GET /admin/message-bridge/status` |
| 找不到 Feishu session | `GET /admin/message-bridge/openclaw/feishu/sessions`；该接口会实时连 OpenClaw WebSocket，失败时应看 502 detail 和 trace 中的 `message_bridge.openclaw.sessions.list` |
| MMD 模型不显示 | `GET /assets/mmd/validate?model_path=...` |
| 模型贴图丢失 | 检查模型包相对路径和 `GET /assets/mmd/{file_path}` |
| 动作不匹配 | 检查 favorite VMD 是否绑定到当前 selected model |

## 12. 当前已知事实

| 项 | 当前事实 |
| --- | --- |
| OpenClaw `/v1/models` | 可用 |
| OpenClaw `/v1/responses` | `model=openclaw` 可用，默认走 OpenClaw 当前默认 agent/model |
| OpenClaw `/v1/responses stream=true` | 可用，返回 `response.output_text.delta` |
| OpenClaw `/v1/chat/completions` | 可返回 SSE envelope，但主链路当前走 responses |
| OpenClaw `/v1/audio/speech` | 当前 404 |
| OpenClaw WebSocket RPC | 可连接，`sessions.list` 可返回 Feishu sessions；`agentId=main` 可返回 assistant delta |
| Voice Workflow TTS `/api/v1/tts` | 可用；2026-05-13 优化后 smoke test：提交 `202` 耗时 147ms，约 17.456s ready，返回 `audio/wav` 184400 bytes，`RIFF` header |
| Voice Workflow TTS `/api/v1/tts/chunk` | 可用；2026-05-13 优化后 smoke test：响应字段包含 `duration`，两次短句请求耗时 14.992s / 14.687s，服务端 `elapsed_seconds=14.975/14.675`，返回 `audio/wav` 138320 bytes，`RIFF` header；较旧基线约 22.7s / `20.063s` 改善，但仍是 realtime 首段延迟瓶颈 |
| Voice Workflow TTS | 当前作为实际服务端语音链路 |
| Message TTS audio proxy | 前端通过 `/api/backend/tts/proxy/{tts_id}?user_id={user_id}` 播放，后端也兼容旧的 `x-user-id` header 访问 |
| Realtime Voice WebSocket | Phase 1 已接入 `WS /ws/sessions/{session_id}/voice?user_id={user_id}`，后端按 session queue 生成 chunk，前端 AudioQueue 顺序播放 |
| Realtime Voice audio proxy | Phase 1 已接入 `/tts/proxy/realtime/{session_id}/{job_id}/{sequence}?user_id={user_id}`，使用内存 chunk registry 代理远端 chunk URL |
| 本地健康检查 | `/healthz/openclaw` 已用于 models/responses 探测；`/admin/runtime-health` 和前端 `/status` 用于只读查看 API/OpenClaw/Bridge/TTS/SQLite 当前运行状态 |

## 13. 系统边界

本项目负责：

- UI 和 MMD 渲染。
- 会话、消息、资源、trace 的本地持久化。
- 调用 OpenClaw 生成文本。
- 调用 Voice Workflow TTS 生成音频。
- 把 OpenClaw/Feishu 消息通过 Bridge 同步回本地。

本项目不负责：

- OpenClaw Gateway 内部模型路由和 agent 运行。
- Feishu channel 的底层连接实现。
- TTS 模型文件和音频生成服务本身。
- PMX 包内贴图路径修复。

因此做跨服务优化时，先确认问题落在哪个边界：

```text
UI 体验问题 -> web/
API 编排问题 -> api/app/routes + api/app/services
文本生成质量/延迟 -> OpenClaw Gateway / target agent
语音生成质量/延迟 -> Voice Workflow TTS
消息同步问题 -> OpenClaw WebSocket RPC + MessageBridgeService
模型/动作显示问题 -> MMD_ROOT_DIR + assets API + MMDStage
```

## 14. Daily Podcast Topology

Updated: 2026-05-21

Daily Podcast is owned by FastAPI. The browser and Next.js UI do not assemble
Voice Workflow storage URLs directly. Next.js calls the FastAPI podcast API
through the existing same-origin `/api/backend/*` proxy, and audio playback
uses the same proxy path so browser `<audio>` and Canvas waveform fetches do
not expose Voice Workflow internals.

FastAPI podcast routes:

```text
GET /podcasts/daily/latest
POST /podcasts/daily/refresh
GET /podcasts/daily?days=30
GET /podcasts/daily/{date}
GET /podcasts/daily/{date}/audio?format=preferred
```

Voice Workflow interface 5 relationship:

```text
FastAPI -> Voice Workflow optional POST /api/v1/podcast/daily/refresh
FastAPI -> Voice Workflow /api/v1/eula-storage-audio/podcast/latest.json
FastAPI -> Voice Workflow /api/v1/eula-storage-audio/podcast/YYYY/MM/DD/podcast_YYYYMMDD.meta.json
FastAPI -> Voice Workflow audio OGG/WAV with ranged GET
```

`POST /podcasts/daily/refresh` is the only browser-facing manual generation
entrypoint. It applies a FastAPI in-memory 10 second cooldown before calling
Voice Workflow, so repeated clicks return the latest readable podcast payload
without repeatedly hitting the Voice service. The current Voice Workflow
OpenAPI exposes storage and TTS endpoints but may not expose an HTTP podcast
refresh route; if the optional refresh call returns `404` or otherwise fails,
the route still reads and returns the latest podcast metadata/audio state and
adds the refresh error to the response metadata instead of clearing the card.

Voice Workflow may return Eula storage references either as relative
`podcast/YYYY/...` paths or as absolute paths on the Voice host. FastAPI
normalizes absolute paths by extracting the `podcast/...` suffix before calling
the storage-audio endpoint, so host filesystem prefixes are not exposed to the
browser and do not break proxy resolution. Podcast `meta.json` is accepted in
both the older flat shape (`docUrl`, `audio.oggPath`, `audio.wavPath`) and the
current published shape (`artifacts.docUrl`,
`artifacts.audio.oggPath`, `artifacts.audio.wavPath`).

If Voice Workflow disconnects or times out during Daily Podcast metadata reads,
FastAPI returns a normalized degraded podcast payload instead of surfacing a
500 response: latest maps to `status="failed"` with `audio_error`, and recent
history returns an empty list when the latest pointer cannot be read.

Frontend surfaces:

```text
/companion right rail Daily Podcast card
/podcasts Daily Podcast history/playback page
```

The root `/` route is the AETHER V2 login entry. It uses the source bitmap
assets in `web/public/images/loginV2`, keeps real HTML inputs and buttons over
the visual shell, saves `mmd_companion_session_v1` in browser localStorage, and
routes to `/companion`. The panel element itself is transparent and the
`::before` overlay is disabled so no extra frosted-glass/tint rectangle sits
behind the source bitmap. The visible floating window comes from the translucent
source-bitmap `::after` frame, and the primary login CTA now uses the custom
center-beacon button asset
`login_button-v2-transparent.png`. Before the form appears, the root login
route plays `/images/loginV2/login_video.mp4` as a full-screen intro overlay.
The intro state machine is `active -> revealing -> complete`: video `ended` or
a double-click on the intro overlay starts `revealing`, the intro layer is
hidden immediately, and `/images/loginV2/idle_loginV4.mp4` takes over as the muted
looping page background without a CSS video fade. The login UI then fades upward
like surfacing from water, and the panel animation end moves the state to
`complete`. The older static `login_background.png` image is hidden while this
video-backed login scene is active. The desktop login panel keeps the source
bitmap frame ratio but enforces a content-height floor so the register button
and footnote remain inside the glass frame on mid-width desktop viewports. The login entry
preserves `ttsEnabled` while
normalizing `ttsMode` to the default
server-backed mode; `/companion` applies the same migration on startup so older
`browser` selections do not leak into the new UI. The visible voice mode
control is an on/off playback toggle, not a browser/server selector; clicking
it updates `ttsEnabled`, persists that value, and immediately stops any current
audio when toggled off. On short desktop viewports (`min-width: 901px` and
`max-height: 720px`), the login panel keeps its compressed spacing but lets the
panel height follow its content so the footnote and actions stay inside the
source-bitmap window instead of being clipped by the fixed aspect ratio. On
middle-width compact viewports (`521px-900px`, `max-height: 700px`), the same
login entry also caps the panel width from viewport height and tightens the
brand/form spacing so the window, security strip, and copyright remain visible
without oversized tablet-style scaling. Across desktop, tablet-width, and phone
breakpoints, the floating login window keeps a protected left/right content
inset for the title, fields, action buttons, and footnote; very short phone
viewports compress vertical spacing instead of sacrificing that inline padding.
The compact `598x622` layout uses the measured login CTA as the scale anchor:
the CTA is reduced from about `363.6x46` to `327.2x41` and sibling controls,
titles, and wordmark dimensions are derived from the same roughly 0.9 scale.

The `/companion` bottom command bar is tied to the Penpot bottom-bar design
file in `Design/*.pen`. Its desktop fidelity metrics are checked by
`npm --prefix web run check:basic`: command bar height 83px, shell side padding
6px, shell gap 10px, TTS toggle 110px, mic button 54px, send button 64px,
voice-mode button 108px, and advanced-mode button 118px.

The `/companion` right rail card keeps the hidden podcast `<audio>` element at
the `CompanionRightRail` level instead of inside the overview card body. The
overview card can unmount when the user switches to chat/tasks/tools panels,
but the audio element and playback state stay mounted in the right rail so the
play action is still available when the user returns to overview. The card shows
one SVG-style play/pause button, a primary Feishu document action, and a
secondary podcast list entry. Manual refresh calls `POST /podcasts/daily/refresh`
through `/api/backend/*`; the backend enforces the 10 second Voice cooldown,
then returns the current latest podcast payload so the existing card state can
update in place.

Audio policy:

```text
Daily Podcast only: audio/ogg preferred, audio/wav fallback, ranged GET probe.
Older TTS/realtime audio OGG migration remains deferred.
```

## 15. Local ImgToAction Text-to-Motion/VMD Pipeline

Updated: 2026-06-18

`imgToAction` now contains a local, CLI-first motion-to-VMD pipeline for the
first `thinking_chin_edge` action. It accepts external MoMask `.npy` candidates
and BVH candidates. This path is development/offline tooling; it is not called
by the FastAPI API, Next.js UI, desktop pet runtime, or the main MMD asset
endpoints in v1.

Current responsibility split:

```text
External MoMask / HumanML3D environment
  -> one or more 22-joint .npy or BVH motion candidates
    -> imgToAction/tools/generate_action_vmd.py
      -> skeleton.json import
      -> bvh_motion.json sidecar for BVH local channels/rotations/world positions
      -> draft.vmd retarget
      -> mode branch:
         action-fit:
           -> right-wrist-to-chin-edge constraint
           -> static hand preset overlay
           -> thinking_chin_edge quality score
         preserve-source-motion:
           -> no action constraint
           -> no hand preset overlay
           -> retarget_fidelity_report.json
      -> quality_report.json per candidate
      -> selection_report.json
      -> final.vmd + requested --out VMD
```

The pipeline accepts existing `.npy` and `.bvh` outputs only. It does not
download, install, launch, or supervise MoMask or any video generator. Generated
artifacts remain local under `imgToAction/outputs/actions/<action>/run_*` plus
the explicit `--out` VMD path.

`generate_action_vmd.py` defaults to `--mode action-fit`, which keeps the
first Eula thinking-pose fitting behavior. `--mode preserve-source-motion` is
for BVH/MoMask source debugging and first-pass retarget validation: it writes
the imported skeleton and draft/final VMD from the same unconstrained retarget,
skips the action semantic score, skips contact IK and hand presets, and records
a `retarget_fidelity_report.json`. The first fidelity report only proves the
source skeleton was preserved through the local generator branch; it does not
measure rendered PMX fidelity yet.

The Eula PMX retargeter treats the upper-arm, elbow, and wrist chains as
horizontal T/A-pose rest axes (`right=-X`, `left=+X`) before aiming them at the
imported skeleton joint directions. This is required for BVH motions whose
source skeleton contains relaxed/down arms or right-hand-to-face poses; using a
downward rest axis leaves the PMX model close to its default arms-out pose.
The current action-fit contact target for Eula is calibrated to
`target_offset=[0.12, 0.105, 0.09]` in the imported skeleton head-relative
coordinate space. This value was selected by repeated PMX render checks through
`imgToAction/tools/render-vmd-pose-check.mjs`, minimizing the projected
right-wrist-to-chin distance over the final hold frames while keeping the left
hand near the waist.

`imgToAction` also keeps the existing optional MediaPipe reference-landmark
extraction path for generated multi-view reference images. MediaPipe outputs are
used as reference landmarks and target descriptions; they are not a video
motion-capture runtime and do not directly generate VMD.

For reference-image fitting, `imgToAction` also has a direct local-bone pose
branch:

```text
reference_landmarks.eula_thinking.json + seed VMD
  -> imgToAction/tools/optimize-direct-pose.mjs
     -> Playwright opens /mmd-calibration-render once
     -> captures seed local PMX bone quaternions
     -> optimizes head/torso/arm local quaternions against rendered landmarks
     -> writes direct_pose.json
  -> imgToAction/tools/direct_pose_to_vmd.py
     -> writes a VMD directly from local bone quaternions
  -> imgToAction/tools/render-vmd-pose-check.mjs
     -> screenshot/contact-sheet verification
```

This branch is still offline tooling. It intentionally writes only local bone
rotations by default; captured Three.js `bone.position` values are PMX rest
offsets and must not be written as VMD translation channels unless a future
tool explicitly marks a bone with `writePosition=true`. Current reference
landmark scoring is useful for wrists/elbows/contact but not yet a full visual
similarity metric: PMX shoulder/head bone origins do not exactly match
MediaPipe person landmarks, and the next quality step should use silhouette or
mesh-aware scoring rather than synthetic shoulder-width penalties.

Direct-pose visual iteration can now use
`imgToAction/tools/create-direct-pose-variants.mjs` to apply local-axis bone
delta sweeps or one-off delta combinations to an existing `direct_pose.json`.
The tool writes variant `direct_pose.json` files and a manifest only; each
candidate still has to be converted through `direct_pose_to_vmd.py` and
verified through `render-vmd-pose-check.mjs` because optimizer RMSE and wrist
bone origins do not reliably predict rendered PMX visual similarity.

The direct-only visual candidate
`imgToAction/outputs/vmd/eula_thinking_direct_fit80_candidate.vmd` is now
explicitly rejected as a final action. It can satisfy a front-view wrist/contact
projection gate, but multi-angle renders under
`imgToAction/outputs/actions/thinking_chin_edge/human_check_fit80_*` show
non-human arm composition: the left arm moves behind the body and the right hand
contact relies on front-view projection/occlusion rather than a readable
shoulder-elbow-wrist chain.

The current local first-loop candidate is instead a composite VMD:

```text
community natural baseline
  MMD/usage/vmd/优菈_by_原神_339146e6e418d79e85a515b26414c0b0[动作]/03_thinking_waiting/思考1.vmd
    -> imgToAction/tools/vmd_io.py
       reads/writes full bone-frame payloads and preserves 64-byte interpolation
    -> imgToAction/tools/overlay_vmd_bone_frames.py
       overlays only selected direct-pose bones in a target frame window
       keeps lower body, fingers, center, and natural timing from the baseline
       adds a low-strength left-arm waist-support overlay from the community watch-time VMD
    -> imgToAction/outputs/vmd/eula_thinking_elegant_reference_v1.vmd
    -> imgToAction/tools/render-vmd-pose-check.mjs
       front / front-right 45 / right-side screenshots with explicit camera snapshots
```

For `eula_thinking_elegant_reference_v1.vmd`, the selected candidate is
`eula_thinking_composite_elegant_v16_leftsupport_delayed90.vmd` copied to the stable
output name. The first overlay window maps direct-pose frames 30-90 onto
baseline frames 60-178. It keeps the baseline `右肩` instead of hard-overriding
it, then overlays `右腕`, `右ひじ`, `右手首`, `上半身`, `上半身2`, `首`, and
`頭`. A second 90-178 overlay applies `左肩`, `左腕`, `左ひじ`, and `左手首`
from
`MMD/usage/vmd/优菈_by_原神_339146e6e418d79e85a515b26414c0b0[动作]/03_thinking_waiting/看时间.vmd`
at strength `0.55`, giving the final pose a restrained waist/front support arm
without crowding the chest or locking the support arm during the early f60
transition. This preserves the community VMD's natural lower body, fingers,
center, motion timing, and calmer shoulder line while bringing the right hand
close to the chin/lips. Verification artifacts live under:

```text
imgToAction/outputs/actions/thinking_chin_edge/composite_elegant_v16_default/
imgToAction/outputs/actions/thinking_chin_edge/composite_elegant_v16_front45/
imgToAction/outputs/actions/thinking_chin_edge/composite_elegant_v16_right_side/
```

`render-vmd-pose-check.mjs` now parses `--camera` as strict JSON, applies the
requested camera directly through `window.__mmdCompanionRuntime.applyCameraSnapshot`,
and records both `requestedCamera` and `actualCamera` in `render_metrics.json`.
This is required for trustworthy multi-angle validation; without it, invalid
PowerShell-escaped camera JSON silently fell back to the default front camera.
The same checker now samples shoulders and elbows, computes per-frame elbow
angles, reports all-frame `quality_violations`, and makes the visible sheet
pass/fail status depend on `overall_motion_quality` instead of only final
right-hand contact. Final right-hand contact now has two checks: the final hold
must be under the contact threshold, and once sampled frames enter the
chin-contact region the contact distance must remain stable instead of drifting
across the hold. The same contact-hold region also checks elbow and shoulder
angle drift, so the final thinking pose cannot keep changing arm shape while
the wrist remains close to the chin. A separate thinking-hand approach-phase
gate starts once the right wrist enters the configured approach region and
blocks large regressions away from the chin before the final hold, so a motion
cannot satisfy the final frame by snapping back after a non-human
away-and-return transition. The checker also derives a head/chin-facing front
vector from the shoulder midpoint and chin samples and blocks frames where the
right thinking hand has entered the approach/contact region but the wrist is on
the back side of the torso path. This catches the previous right-side f90
failure mode where quaternion interpolation moved the thinking hand behind the
body while the final contact still passed. It also has explicit
thinking-hand raise-phase and hold-entry gates: sampled preparation/approach
frames must move through the front-side raise corridor, and the first hold frame
must already be inside the chin-contact corridor instead of relying on a later
snap. The right-hand contact target is a model-profile
`render_target_offsets` region on the head/chin bone rather than one projected
point; the checker records the nearest selected chin sample in
`contact_pairs.right_wrist_to_chin`, which avoids side-view false negatives from
a single head-bone proxy. The first transition-phase rule blocks frames where
the left support arm locks near the waist before the right thinking hand has
approached the chin, but it now requires both 2D projection proximity and
`left_wrist_to_waist_world` proximity so front-right/side camera overlap does
not masquerade as an early support-arm lock. The visible contact sheet includes
both projected pixel distances and the left-wrist-to-waist world distance used
by that rule. A temporal elbow-angle delta gate also compares adjacent sampled
frames and blocks sudden left/right elbow flips that remain inside the static
angle range but would not be plausible human joint-chain motion. The checker
also samples hip/knee/ankle bones, blocks impossible knee angles across all
sampled frames, and compares adjacent sampled frames for sudden knee-angle
jumps, so lower-body retarget failures are no longer invisible to the upper-body
contact gates. It also records ankle world-space stance metrics and blocks
stationary actions where either ankle or the stance width drifts across sampled
frames. A shoulder upper-arm direction gate measures each
upper arm against the torso-down vector and blocks sampled frames where the
shoulder chain folds into a non-human direction; a matching shoulder
temporal-delta gate blocks sudden upper-arm direction snaps between adjacent
sampled frames. Render rows and contact sheets record these shoulder and knee
angles next to the elbow angles. The checker also
computes conservative torso-core clearance
from shoulder midpoint to lower body and blocks elbow/wrist endpoints that enter
that core volume, giving the first automated guard against obvious arm/torso
penetration without forbidding valid across-body support poses. Render rows also
record upper-arm/forearm segment-to-torso-core distances; the blocking segment
gate currently checks forearms only, because upper arms naturally start near the
shoulder midpoint and would otherwise create false positives on valid poses.
The summary still records upper-arm and forearm segment lengths and rejects
large relative length drift across sampled frames, catching non-human retarget
failures where a limb is stretched or compressed by incorrect bone position
channels.

`overlay_vmd_bone_frames.py` now includes a stationary stabilization pass that
can lock selected bone positions and rotations to a reference frame after VMD
composition, and `generate_action_vmd.py` applies the same pass when an action
recipe defines `vmd_stationary_stabilization`. The current stable Eula thinking
candidate uses this policy to lock center, foot IK, toe IK, waist, groove, leg,
and ankle lower-body channels while preserving the tuned upper-body thinking
gesture. The current single-raise candidate trims residual 48-58 frame keys from
the shoulder and left-arm support chains after the v11 right-arm cleanup, so
frames 30-60 are one continuous front-side raise instead of a second inherited
raise segment. The right arm, upper body, neck, and head keys are sparse through
`0,30,60,90,119,178`, and `holdStartFrame=60` is the action-specific hold
boundary for this pose. The validated VMD is:

```text
imgToAction/outputs/vmd/eula_thinking_elegant_reference_v12_single_raise.vmd
```

The current three-view dense verification artifacts sample
`0,30,36,42,48,54,60,90,120,178` and pass all coordinate gates with zero
blocking violations:

```text
imgToAction/outputs/actions/thinking_chin_edge/composite_elegant_v25_single_raise_default/
imgToAction/outputs/actions/thinking_chin_edge/composite_elegant_v25_single_raise_front45/
imgToAction/outputs/actions/thinking_chin_edge/composite_elegant_v25_single_raise_right_side/
```

The current built-in target is Eula + `thinking_chin_edge`: stationary upper
body, right wrist near the chin edge, left arm near waist support, conservative
finger presets, and candidate scoring for contact distance, elbow naturalness,
head tilt, stance stability, smoothness, and blocking violations.

For the "100% restorable" display route, the current production candidate is a
deterministic reference-playback VMD rather than the BVH+IK retarget result. This
keeps the natural PMX-specific shoulder, wrist, finger, waist-support, and lower
body details that are not present in the BVH input:

```text
imgToAction/outputs/vmd/eula_thinking_100pct_reference.vmd
MMD/usage/vmd/优菈_by_原神_339146e6e418d79e85a515b26414c0b0[动作]/03_thinking_waiting/思考_100pct_reference.vmd
imgToAction/outputs/actions/thinking_100pct_reference_render/
```

The rendered gate for this reference route passes `motion_acceptance_gate.py`
with `--source render --left-arm-policy support` at `10/10 PASS, 0 WARN, 0
FAIL`. The companion message path now resolves `think`/`thinking_tilt` to this
category by a controlled semantic fallback after exact token matching, preferring
VMD names containing `100pct`, `reference`, or `思考`.

## 16. Development Code Search Tooling

Semble CLI is integrated as a development-only semantic code search helper. It
is not part of the runtime topology and is not called by FastAPI or Next.js.
Use it when a task is intent-based and cross-module, while keeping `rg` as the
first choice for exact identifiers, endpoint paths, filenames, and known
strings.

PowerShell wrappers:

```text
scripts/semble-search.ps1
scripts/semble-savings.ps1
```

Operational rules:

- Scope searches to `api/app`, `web/src`, or `docs` before searching the repo root.
- Use the wrappers on Windows so `PYTHONIOENCODING=utf-8` is set for Unicode output.
- Track notable token-saving observations in `docs/architecture/semble-code-search-observability.md`.
- Current integration remains CLI-only; Blender MCP is enabled only through the project-local `.codex/config.toml`, not through Codex's user-level global MCP configuration.

### 16.1 Blender MCP 动作审查辅助

Blender MCP 是开发期动作审查工具，不进入 FastAPI、Next.js 或桌面 Pet 的生产运行链路。Windows Blender 5.1.1 的官方 Blender Lab 扩展 `bl_ext.user_default.mcp` 监听 `127.0.0.1:9876`；Codex 仅在本项目通过 `.codex/config.toml` 启动 `C:\Users\KSG\.codex\project-mcp\mmd-project-blender-lab\venv\Scripts\python.exe -m blmcp`，由 stdio 适配器转发官方工具。2026-08-20 已重建该专用虚拟环境：运行时来自 `https://projects.blender.org/lab/blender_mcp` 的源码提交 `98b0e49d98321d321c7e631389200f513f765d59`，并将 `mcp` 固定为兼容官方代码的 `1.29.0`；不能直接解析到 `mcp 2.0.0`。旧环境已保留为 `venv.pre-reconfigure-20260820`，用于回溯，不再作为正式入口。Blender 插件必须先启用、允许在线访问并保持 Blender 实例运行；Codex 已打开的会话不会热加载新的 MCP 配置或 transport，重建后必须重启连接器或新开会话。2026-08-20 的独立链路验收已完成：使用 `--online-mode --background --command blender_mcp` 启动官方桥接后，向 `127.0.0.1:9876` 发送带 `strict_json=true` 的执行请求，成功返回 `{"ok":true,"blender":"5.1.1"}`。当前交互式 Blender 旧会话仍可能持有失效的定时器连接，不能把该旧会话的工具超时当作新环境失败；重连后应重新验证 `initialize`、`tools/list`、`get_blendfile_summary_path_info` 和 `get_objects_summary`。原先的第三方 `blenderMCP-addon` 已停用，避免与官方扩展共同抢占 `9876` 端口。该链路只用于 PMX/VMD 导入、姿势检查、骨架/网格碰撞分析与离线动作矫正，最终动作仍必须通过 `imgToAction/tools/motion_acceptance_gate.py` 和四视角截图/GIF 视觉审核。

2026-07-15 的 Blender-first 思考动作 POC 使用 `imgToAction/tools/blender_first_thinking_poc.py` 重建 frame 150 控制链，并用 `imgToAction/tools/blender_sleeve_corrective_morph.py` 验证派生 PMX 顶点 Morph 路径。后者只在内存中创建 `思考_右袖修正` Shape Key，不保存源 `.blend`，也不导出 PMX/VMD；它通过每顶点批量 XYZ 微扰 Jacobian，把当前姿势的世界空间推出量反解为 Shape Key 局部位移，并输出 Morph 0/1 四视图、近景和 JSON 指标。当前基础链选为 `pole3d_0227__comp_065`：右肘 `55.553°`、下巴距离 `0.029175`、接触 patch `6`，但有 69 个右袖对 `上半身2` 的重叠和 20 个旧中指手型重叠。Morph-only 虽可把袖口重叠降到 0，网格质量 Gate 会阻断该结果：初版出现 11 个翻转面和明显尖片；加入累计 Laplacian 平滑及最多 8 个前臂拓扑支持环后，仍无法同时满足零重叠、面积比 `0.60-1.50`、零翻转面和最大位移不超过 3 个模型中位边长。因此当前状态是诊断性 `FAIL`，不得据此导出派生 PMX。下一阶段必须联合优化右臂/躯干姿势以先把深穿透降为浅接触，再用局部 Morph 收尾；最终还需叠加已选 G14 半握手型重新检查手指碰撞，并在用户确认 Blender A/B 后才允许 PMX/VMD 导出。

### 16.2 Desktop Pet 右键菜单单一事件入口与窗口内展示（2026-07-22）

Desktop Pet 的右键菜单以 Electron 主进程的 `webContents.on("context-menu")` 事件为常规入口，并在 Windows 下保留 `hookWindowMessage(WM_RBUTTONUP)` 原生消息兜底。preload 不暴露 `openContextMenu`，主进程也不注册 `pet:menu:open-context` IPC；两个主进程入口统一进入 `openPetContextMenu()`，由同一套 source-aware 去重状态确保一次物理右键最多弹出一个菜单。

该约束用于避免 renderer IPC、系统菜单和多个原生 hook 同时形成独立菜单实现。Windows 原生消息钩子负责 `WM_LBUTTONDOWN`、`WM_MOUSEMOVE`、`WM_LBUTTONUP` 的整窗拖动兜底，并用 `WM_RBUTTONUP` 保证相机调整模式下 OrbitControls 即使拦截网页 `contextmenu`，右键菜单仍能到达主进程。`webContents` 提供窗口内坐标，原生 hook 使用 `screen.getCursorScreenPoint()` 提供屏幕坐标，两者经 `resolveContextMenuPosition()` 归一后进入同一原生菜单路径。

右键菜单不再渲染在承载 MMD/WebGL 的 Pet renderer 中。主进程启动时会额外预加载一个独立、轻量、非透明的 `BrowserWindow`，开发环境入口为 `/menu.html`，生产入口为 `dist/menu.html`；该窗口不导入 `MMDStage` 或 `mmdCompanionRuntime`，并使用独立 Electron partition `desktop-pet-menu`，确保与 Pet renderer 使用不同的 OS renderer 进程。

菜单不得依赖预热后隐藏、移到屏幕外或新建 HTML renderer。2026-07-22 的真实桌面诊断证明：复用的后台 renderer 会让 `pet:menu:show` IPC 延迟约 15 秒；即使每次新建可见 HTML 菜单窗口，窗口外壳约 61ms 创建、页面约 512ms load 完成，renderer 仍可能到约 15.79 秒才处理 React/IPC。相同环境中，不加载页面的纯空白 `BrowserWindow` 约 70ms 创建且 Win32 `IsHungAppWindow=False`。Pet 主窗口现在显式配置 `focusable=true`；重启后的 Win32 扩展样式从 `WS_EX_NOACTIVATE=True` 变为 `False`，避免真实用户右键时窗口天然失去前台激活资格。因此正式路径使用一个逻辑尺寸 1x1、`focusable=true`、`opacity=0` 的原生 owner `BrowserWindow`，并以该 owner 调用 Electron `Menu.buildFromTemplate(...).popup(...)`。Windows 会把无边框窗口扩展到系统最小像素尺寸，若保持不透明会在菜单旁露出约 70x66 的黑框，因此 owner 在构造参数和每次复用显示前都强制零透明度；这里的透明度只隐藏不加载页面的原生 owner 外观，不承担菜单 renderer。owner 首次右键时创建，菜单关闭后只隐藏、不销毁，后续右键重新定位、显示并复用。该常驻隐藏 owner 同时避免菜单关闭时销毁临时窗口进入 Electron 的 `window-all-closed -> app.quit()` 退出链路；Pet 主窗口真正关闭时才连同 owner 一起关闭。

主进程继续使用 `buildPetMenuModel()` 从内存同步构建菜单模型，再通过 `toElectronMenuTemplate()` 转成 Electron 原生菜单模板；submenu、radio、checkbox、enabled 和 click action 均由该转换层保留。owner 显示后立即调用 `Menu.popup({ window: owner, x: 0, y: 0 })`，实测右键到 owner 创建约 59ms、到 popup 调用约 79ms。菜单动作仍由 Pet 主窗口对应的 `dispatchMenuAction()` 执行；动作触发前记录 `context-menu:action-selected`，菜单关闭回调隐藏 owner、释放 `contextMenuActive` 并记录 `context-menu:closed`。Pet 主窗口和应用退出路径还会记录 `pet-window:close-requested`、`pet-window:closed`、`app:window-all-closed`、`app:before-quit` 与 `app:will-quit`，用于区分用户选择“关闭”、窗口生命周期退出和真正的进程崩溃。右键打开、菜单关闭以及空白诊断路径均不得启动会话扫描或 API 刷新：`refreshRecentSessionsInBackground()` 在首个 `await` 前会同步扫描本地会话文件，真实右键日志曾出现 popup 80ms、菜单约 27 秒后才关闭的主线程阻塞；即使把刷新延迟到第一次菜单关闭后，下一次菜单仍会与尚未结束的扫描/upsert 重叠并出现转圈。因此菜单链路只读内存缓存，会话缓存由 Pet renderer 加载完成、Codex watcher、每日扫描，以及工作区/编程助手等显式状态切换路径更新。

右键显示延迟的单变量诊断可设置 `MMD_PET_CONTEXT_MENU_DIAGNOSTIC_BLANK=1`。该模式在主进程收到右键后临时创建一个全新的、立即可见的空白 `BrowserWindow`，不加载 HTML、不设置 preload、不发送 `pet:menu:show`，也不触发 React；失焦后直接关闭并在下一次右键重新创建。日志事件 `context-menu:diagnostic-blank-created` 的 `presentToCreateMs` 用于测量右键事件到新窗口创建/显示调用完成的主进程耗时，`diagnostic-blank-unresponsive/responsive` 用于记录 Electron 对新窗口 renderer 响应状态的判断。该模式只用于区分复用后台 renderer、窗口创建显示与正式菜单渲染链路，不提供正式菜单功能。

源码回归测试必须证明：`installNativeMouseHooks()` 注册 `WM_RBUTTONUP` 并把屏幕坐标交给 `openPetContextMenu(..., "native")`；Pet window 不注册 `system-context-menu`；全项目只有一个运行时 `webContents.on("context-menu")` 常规入口；正式路径调用 `createNativeMenuOwnerWindow()`、`Menu.buildFromTemplate()`、`toElectronMenuTemplate()` 和 `menu.popup()`；owner 必须是可复用、`opacity=0` 的逻辑 1x1 窗口，菜单回调后隐藏而非销毁，并记录菜单动作及 Pet/应用退出生命周期。源码不得在正式路径等待 `pet:menu:received`、`pet:menu:committed` 或 `requestAnimationFrame`，也不得因菜单打开或关闭触发会话扫描。真实桌面右键验收会使用用户鼠标或 Chromium 输入句柄并使原生菜单获得焦点，执行前必须获得用户明确确认。

### 16.3 Desktop Pet Codex 启动目标（2026-07-22）

Desktop Pet 通过持久化字段 `codexLaunchTarget` 提供两个 Codex 新建入口：`vscode-cli` 与 `codex-desktop`。默认值为 `vscode-cli`，以保持升级前行为；设置保存在 Electron `userData/pet-settings.json`，右键菜单以“Codex 启动工具”单选子菜单展示。该概念与 `agent` 分离：`agent` 决定 Codex/Claude，`codexLaunchTarget` 只在当前 agent 为 Codex 且执行 `new-session` 时参与路由。

`vscode-cli` 对本地工作区继续使用现有 `launchNewCodexSession()`：生成唯一临时 `.code-workspace`、写 scoped terminal request、打开 VSCode、等待 Helper ACK，并启动 JSONL watcher。对选择的受限远程项目，`remoteCodexCliLauncher.ts` 只接受目录快照中记录的 `sshHost=macCodex-pet` 和两个受限根目录内的 POSIX 路径；它以参数数组调用 Windows Terminal，再以 `ssh -tt` 启动 `sola-codex` 账号自己的 `/Users/sola-codex/.local/bin/codex`。`sola-codex` 是独立 macOS 账号，ACL 仅允许读写 `/Users/sola/workspace/**` 和 `/Users/sola/Desktop/kscc/**`，明确拒绝 `sola` 的 `.ssh`、`.codex`、Documents 和家目录枚举；专用 Key 禁止 agent、端口和 X11 转发。远程 CLI 不读取 Windows 本地 `CODEX_HOME`，也不启动本地 JSONL watcher，避免把远端会话误报为本地状态。`codex-desktop` 使用独立 `codexDesktopLauncher.ts`，通过标准 `URL`/`URLSearchParams` 构建 `codex://new?path=<当前工作区>` 后调用 Electron `shell.openExternal()`。本机安装的 `OpenAI.Codex` Windows 包注册了 `codex` protocol，其当前 deeplink parser 将 `new` host 的 `path` 查询参数解释为新任务工作区；该协议属于外部应用契约，未来 Codex Desktop 升级后仍须通过真实点击验收。

Desktop 本地路线打开绑定工作区的新任务编辑界面；远程路线在调用协议前先显示 Pet 的 Electron 原生确认框，明确告知当前 Codex Desktop 无法由 deeplink 自动绑定所选远程项目，也不提供可由 Pet 调用的远程项目选择器，并展示主机名与远程路径。用户取消时记录 `codex-desktop-launch:remote-confirmation-cancelled`、恢复空闲状态且不得调用 Desktop 协议；用户确认“复制路径并打开”后，Pet 先把远程路径写入剪贴板并记录 `codex-desktop-launch:remote-path-copied`，再打开 `codex://threads/new` 未绑定新任务入口。状态只提示用户在 Codex Desktop 中手工打开项目选择器并粘贴路径，不得声称或暗示项目选择器会自动弹出。当前 Codex Desktop 解析器对无参数 `codex://new` 返回空路由，Windows 虽能完成协议激活但界面不会发生变化；无参数新任务必须使用解析器明确支持并兜底生成 `newThread` 的 `codex://threads/new`。尝试从外部发送 Codex 内部项目选择器快捷键 `Ctrl+Alt+Shift+O` 也无法可靠获得窗口焦点，正式实现禁止依赖鼠标或键盘模拟。两条路线都不自动提交第一条消息，因此用户发送第一条消息后任务才正式创建。成功时记录 `codex-desktop-launch:new-session-requested` 并发布 `launched` 状态；协议未注册或 `openExternal()` 失败时发布 `failed`，不得静默回退到 VSCode。Claude 新建和所有历史会话恢复继续走既有 VSCode/CLI 路线；`Codex Environment` 的 Windows/WSL 设置只影响 `vscode-cli`。

完整定义见 `workflow/concepts/codex-launch-target.zh-CN.md`。回归测试必须覆盖设置归一化和 merge、菜单 radio 状态、路径中特殊字符的 URI 编码、Desktop/CLI/Claude 主进程分支。程序门禁为 `desktop-pet` 目录下 `npm run check`；在没有用户真实点击验证前，只能表述为“路由与 URI 构造已验证”，不能声称 Codex Desktop 端到端拉起已验证。

### 16.8 Pet 本地全局 Agent 会话发现（首期）

`desktop-pet` 的会话刷新不再把当前选中的本地工作区作为 Codex 扫描过滤条件。主进程通过统一的本地会话发现模块同时扫描 Windows `CODEX_HOME/sessions`、配置的 WSL `CODEX_HOME/sessions`、Claude `CLAUDE_CONFIG_DIR/projects` 和 Pet 自有 app-server 会话列表，从会话自身的 `cwd` 或 app-server workspace path 反向生成工作区归属，因此多个工作区的 Codex Desktop、Codex CLI、WSL CLI、Claude Code 和 Pet app-server 会话可以同时进入 Pet 的最近会话列表。Codex JSONL 记录会保留 `originator`、`source`、运行方式、会话文件和 bounded facts；app-server 记录保留运行状态、进程号、transport、sandbox 和 bounded 输出预览。同一 Provider 的稳定 session id 被重复观察时按最近活动证据去重，并保留 evidence 列表。当前工作区/编程助手仍用于启动、恢复、watcher 上下文和旧状态隔离，不再限制全局最近会话发现。
全局发现列表本身只读；在独立活动 registry 接入前，既有 `desktop_pet_sessions` review upsert 只对当前选中的 Codex 工作区保留兼容同步，不会因为观察到其它工作区或 app-server 会话就写入 review registry。Pet 启动后首次刷新，并以 15 秒有界定时器在原生菜单临界路径之外持续刷新；扫描资源按 Provider 的 `maxFiles` 约束，过期活动证据显示为 `idle`，WSL `/mnt/<drive>/...` cwd 映射为对应 Windows 工作区路径。由于 JSONL 文件扫描和 Windows 进程枚举包含同步文件系统/PowerShell 操作，`desktop-pet/electron/agentSessionDiscoveryWorker.ts` 在独立 Node Worker 中执行三个 Provider 的发现和进程增强，Electron 主进程只接收序列化结果；同一时刻只允许一个 Worker 扫描，超过 30 秒自动终止并保留窗口交互，失败只记录 `agent-session:provider-error` 或刷新错误，不把扫描失败升级为主进程卡死。进程增强器只读取 Windows 进程名、PID 和启动时间，并只给已有 session id 或已有 app-server PID 的记录追加 `process` 证据；孤立的 `ChatGPT`、`codex` 或 `claude` 进程不会伪造会话。app-server PID 绑定还会校验已知的进程启动时间，并以会话创建时间作为保守边界，避免 PID 重用把无关进程绑定到旧会话。只有 Windows 上完成且适用的进程扫描才允许把已登记 app-server PID 的消失解释为 `disconnected`；非 Windows 或进程扫描失败均保留原有状态。

### 16.9 Desktop Pet 会话展示清洗（2026-08-05）

会话发现、旧 API 缓存和状态通知最终都经过 `desktop-pet/electron/codexPresentation.ts` 的统一展示清洗规则。`<recommended_plugins>`、`<environment_context>`、`<app-context>`、AGENTS 注入块和 Codex agent history 等运行时上下文不能作为任务标题或用户 prompt 预览；如果候选标题无效，则回退到真实工作区名称或有效摘要。状态卡输出会移除 `Exit code`、`Wall time`、`Total output lines`、进度百分比、纯分隔线以及 `Output`/`warnings` 等机器包装行，仅保留脱敏、限长的可读输出行。完成状态卡与独立完成通知窗口共同调用 `buildCodexCompletedPresentation()`，因此同一完成状态的标题、任务行和输出行必须保持一致；通知窗口只负责聚合/展开布局，不重新解释原始 transcript。

独立完成通知的证据必须分层记录：自动化测试证明 reducer、最多 3 条、去重、dismiss 持久化、IPC sender、尺寸逻辑和文本投影一致性，但不能证明 OS 窗口；HWND/bounds 日志必须记录 Pet 与通知窗口各自 HWND、PID、bounds 和 `workArea`；窗口级截图必须来自真实桌面或窗口句柄，覆盖收起、展开、最多 3 条、移动/缩放跟随和关闭后的状态，不能用 DOM 截图替代。

Electron 的运行入口仍是 `package.json` 的 `dist-electron/main.js`；展示清洗模块必须保持在 Electron 编译根目录，避免 TypeScript 因跨目录共享模块改变输出层级后，开发脚本继续启动旧的主进程产物。

### 16.4 Desktop Pet 左键点击兜底（2026-08-05）

Pet 的左键交互定义为“静止短按切换动作、超过 6px 位移才拖动窗口”；`Adjust Camera` 模式同样保留静止左键点击动作，移动则交给相机交互，滚轮负责远近调整。Pet 不再使用没有位移判定的透明层 `click` 作为动作入口，也关闭 Pet 内部 `MMDStage` 的独立点击捕获，统一由 `App` 的文档级指针候选和 Electron 原生候选处理，避免一次拖动结束同时被判定为动作点击。
文档级指针入口在按下时只记录候选，移动超过 6px 后才调用 `pet:window-drag:start`；未越过阈值则在抬起时执行角色命中和动作选择。Electron 原生层同样只记录 `WM_LBUTTONDOWN`，以 `WM_MOUSEMOVE` 的窗口内坐标判断是否越过 6px，越过后才建立原生拖动；未建立拖动状态的静止候选会向 renderer 发送 `pet:native-left-click`。使用消息内窗口坐标而不是屏幕坐标判定阈值，避免多显示器/DPI 换算抖动把静止点击误判为拖动。WebGPU 分支没有 Three.js 容器时，`MMDStage.getStageRect()` 回退到 `RezeWebGpuStage` 画布矩形，保证原生点击命中后能继续进入动作选择。

### 16.5 Desktop Pet Reze 相机状态持久化（2026-08-06）

Pet 的 Reze-K3 与 Reze Design 相机状态按“模型相对路径 + 渲染管线”写入 renderer localStorage；滚轮每次调整后立即保存距离，renderer 卸载前再保存由 Reze 引擎实时相机生成的完整 snapshot。Reze 舞台启动时把 snapshot 的 target、distance、orbit alpha/beta 和 FOV 应用回引擎；舞台重载、模型切换和应用重启时优先恢复该状态。首次没有保存值时，Reze-K3 使用 Pet 全窗口构图默认距离，Reze Design 使用 Pet 自己的场景默认距离；不能使用主站共享文档中的 `scene.cameraDistance`。普通 Three.js 相机继续沿用同一条 snapshot 保存路线。

### 16.6 Desktop Pet 相机调整模式退出与右键菜单保护（2026-08-05）

Pet 进入 `camera-adjust` 后，renderer 的捕获阶段和 Electron `webContents.on("context-menu")` 都先调用 `preventDefault()`，同时 Electron 主进程拒绝 Windows 原生右键、WebContents 右键及其它统一入口的上下文菜单请求，避免默认菜单或自定义菜单抢占相机拖动。renderer 在舞台右上角显示 `Save & Exit Camera` 悬浮按钮；点击后先切回 `window-drag`，由既有模式切换 effect 捕获当前 `MMDStage` 相机快照，按“模型相对路径 + 渲染管线”写入 Pet renderer localStorage、锁定运行时相机并恢复窗口拖动。renderer 在 `beforeunload` 和 `pagehide` 前再次捕获当前相机快照，因此即使用户保持 `camera-adjust` 直接关闭 Pet，最后一次相机位置也会被保存并在下次启动恢复。Three.js 与 Reze WebGPU 都必须提供有效的 `captureCamera()`；Reze 不能返回空快照，也必须在启动时应用传入的 `cameraSnapshot`。按钮自身使用独立的非拖动命中区域，不参与角色点击和窗口拖动候选。

透明无边框 BrowserWindow 在创建时可能先落到最小边界；`createPetWindow()` 在构造窗口后再次用已解析的 `windowOptions` 调用 `setBounds()`，再注册 resize/move/close 持久化监听，保证下一次启动恢复的尺寸真正成为可见窗口尺寸。

### 16.7 主舞台到 Desktop Pet 的 Reze 材质与场景自动同步（2026-08-05）

主站 `/companion` 的共享配置自动同步不再只写入 `selected_model_path` 和 `render_pipeline`。当当前管线为 `reze-k3` 或 `reze-design` 时，防抖后的 PUT 请求必须同时写入 `reze_stage_document`，其中包含当前 `materialPresets`、调色预设、背景效果以及合并后的 `scene` 调试参数，但明确剔除 `scene.cameraDistance`：相机距离属于每个窗口的本地构图状态，不属于跨窗口共享配置。材质选择、调色、背景特效或场景滑杆变化后，都会经过同一个配置载荷构造器同步到 FastAPI 的 `companion_shared_config`，Desktop Pet 的“从主站同步”再读取同一份文档并应用到其 WebGPU 引擎。切换到非 Reze 管线时写入 `reze_stage_document: null`，防止 Pet 继续保留旧的 Reze 材质与场景文档。手动“保存到桌面 Pet”与自动同步共用该载荷构造器；客户端超时边界仍只用于手动保存，自动同步失败不得阻断主站交互。

### Stage 2C-M2a.2 生产绘制调用几何源与可审计快照（codex/reze-production-vertex-snapshot，2026-09-03）

Stage 2C-M2a.2 收口 reze-engine 生产 material-ID/HDR pick 与 triUV 诊断之间的几何来源契约。旧诊断把 model.getVertices() 的 CPU 基础顶点作为 triUV 展开源，而生产 draw call 实际使用 modelInstances[name].vertexBuffer、indexBuffer、jointsBuffer、weightsBuffer 和 skinMatrixBuffer；GPU Morph 还会原地写入生产 vertexBuffer。两条路径因此可能在同一 VMD 帧使用不同几何。旧的“production instance.vertexBuffer 全零”读回也不具备证据效力，因为源 GPUBuffer 没有 COPY_SRC usage，违反 WebGPU copyBufferToBuffer 前提。

patch-reze-engine.mjs 现在只向 reze-engine 的 src/engine.ts、dist/engine.js 和 dist/engine.d.ts 注入一个默认被动、只读的 getProductionDrawCallSourceSnapshot(captureId, frame) seam，并给生产 vertex/index/joints/weights/skin-matrix 与 GPU Morph weights buffer 补齐合法 COPY_SRC usage。快照返回实际生产 GPU 句柄、production draw 与 pick draw 的 count/firstIndex、drawIndex/pickDrawCallIndex、main/pick bind group、主管线与 graph、pick pipeline/layout、HDR/mask resolve texture、蒙皮矩阵和 Morph 来源；它不渲染、不写回、不改变默认生产状态，GPU 句柄只在同一 JavaScript realm 内供诊断 pass 使用。

v14dColorBaseline.ts 的 readV14dProductionDrawCallSourceSnapshot 对上述句柄做只读 GPU 读回，并输出可序列化 audit：buffer 字节/值统计、非零位置顶点数、位置包围盒、有限值/NaN/Infinity、索引范围完整性、draw/pick range 与绑定身份、skin matrix/Morph 状态以及 HDR/mask resolve texture sameAsEngine。RezeWebGpuStage.tsx 的 captureHairTriUv 在显式 acceptance probe 中默认选择 sourceMode=production-draw-call；readV14dProductionSourceTriUv 复用生产顶点布局、索引、蒙皮 buffer、per-frame/per-instance/per-material pick bind group 和原始 绘制索引范围（draw range），先做生产顺序 depth prepass，再以 equal 深度测试输出 triId+插值 UV，depthBias.constant/slopeScale 固定为 0。pixel、materialMask、triUV 和 source audit 通过同一 captureId/frame 关联。

该诊断契约的机器失败分类为 interface-unavailable、invalid-capture-request、snapshot-rejected、buffer-readback-failed 和 buffer-readback-incomplete。--neg-wrong-source 只允许用来证明 cpu-base 错源会被检出，不能成为正常 fallback；--neg-mat-swap 用来证明材质槽交换会被同像素身份 Gate 拒绝。验收近景 cameraOrbit("face") 只属于显式 probe，为 frame120 目标材质提供可见像素，不改默认生产相机；实现不得用屏幕平移、mask 膨胀、depthBias 或放宽阈值制造重叠。完整概念定义见 workflow/concepts/v14d-production-draw-call-source-snapshot.zh-CN.md。

## 17. 文档维护规则

后续只要更新功能、服务拓扑、外部服务集成、环境变量、数据落点、API 契约或运行时行为，都需要同步更新本文。

本文的目标不是记录所有实现细节，而是持续保持项目全景准确：

- 自己回看时，能快速理解当前系统怎么跑。
- 交给 OpenClaw、TTS、前端或渲染相关服务做优化时，对方能快速理解上下游边界。
- 排障时，能从症状快速定位到对应服务、接口、配置或数据落点。

## 近期渲染对齐票据状态（V14D 黄金帧）

Stage 2A-GF2（`codex/v14d-ui-final-shading-bake`，2026-08-29）在带 UI Blender 5.1.1 会话（非 `-b`）中解除了无头环境 `bpy.ops.object.bake` `poll()` 恒 False 的硬阻塞，完成 9 材质 Cycles COMBINED 最终着色烘焙（face/eyeWhite/eyes/eyesPlus/body/top/cape/hairA/hairB）。**验收修正轮**发现原「按材质名精确注入」不成立——重复逻辑键（Face/EyeWhite 共用 face_d 等）被 `fileListToMap()` `Map.set()` 后写覆盖前写，已改为逐材质独立绑定（唯一逻辑键 `Textures/v14d-baked/baked_<key>.png` 注入 + 加载后按 PMX 材质名改写 diffuse 纹理路径）并新增逐材质绑定硬 Gate。【二次验收修正】此前在 loadModel 返回后改 path 不重传 GPUTexture/建 bind group（伪绑定）；已改为 patch-reze-engine.mjs 注入默认关闭的 materialDiffuseOverrides，在 loadFromReader 后、GPU 材质建立前为每个目标材质追加独立 texture entry 并改 diffuseTextureIndex（真实 GPU 绑定）；绑定 Gate 改读引擎实际绑定状态 v14dBakedActual（独立 diffuseTextureIndex 19–27 + 最终 logicalPath）并加错绑/漏绑负测。环境 Gate、烘焙资产 Gate、Web 注入 Gate 通过，模式默认关闭、生产入口不启用；但**视觉 Gate 未通过**，四 ROI（face/frontHair/backHair/chest）三通道 MAE 全部远超 ≤20/255 且未相对基线下降 ≥50%。映射修正后对照显示 Web 脸色偏亮偏白、缺少 EEVEE 暖色调与 State2 阴影层次，**Cycles/EEVEE 口径差异仅为候选根因**（修正前 ROI 由覆盖链主导，不能据此归因）；下一 failure family 为 EEVEE 等价最终着色捕获或 Web 实时六灯近似（均未在本票实施）。详见 `docs/handoff/2026-08-29-v14d-ui-final-shading-bake.md`。

Stage 2A-GF4（`codex/v14d-agx-display-byte-capture`，2026-08-30，验收修正轮）建立「显示字节直通捕获」诊断契约并让正式 Face Gate 通过：以磁盘权威 AgX PNG 原始 8-bit 字节（非 image.pixels/不再过 Filmic）为唯一显示权威，按屏幕像素→UV 双线性 splatting 反投影到 Face atlas（G3，8972 纹素覆盖），经 materialDiffuseOverrides 真绑定注入，引擎 composite 新增默认关闭的 displayPassthrough 模式（绕过 Filmic LUT/grade/gamma 三层，并对 rgba8unorm-srgb 纹理的硬件 sRGB→linear 解码做对称 linear→sRGB OETF 编码，否则显示字节偏暗 [64,128,192]→[13,55,134]）。patch-reze-engine.mjs 补丁含 displayPassthrough 与诊断纹理禁 mipmap（第四补丁 __v14dNoMipmapPaths），--verify 对 21 项声明不变量（material override 4 项 + displayPassthrough 的 src/dist setter、uniform、merge default、ViewTransformOptions 类型、src/dist srgb helper、src/dist passthrough 早退、src/dist grade-gamma 门控、src/dist 禁 mipmap、override 纹理集合）逐项断言恰好一次，strictVerifyAll() 供 predev/prebuild/--verify 共用，anchor-miss/missing-file/重复 marker/计数异常均非零失败（--self-test 在临时副本证明 missing-file exit=1，不碰真实 node_modules）；displayPassthrough 仅在 v14dFaceMode=bakedGolden 置 true，生产默认 finalFaceComposite+Filmic 不变（default capture normal 模式 GATE-OK 佐证）。**验收修正轮根因**：首轮 G4 MAE 27 一度被归因为「几何/姿态错位主导」，该结论未经证明且已被证伪——离线 atlas 重建 Gate（gate-offline-atlas-reconstruct.mjs，CPU 按引擎 sampler 语义 srgb 解码+mip0 双线性+OETF、仅在 originalCoverage 采样）显示反投影/覆盖本身 MAE=8.6（≤20），离线对照（gate-offline-web-vs-predict.mjs，Web 显示 vs 离线同 UV 采样预测）MAE=27 揭示 GPU 链与离线口径不符，最终定位根因为**反投影 UV 的 v 翻转约定错误**（引擎采样 diffuse 纹理 v 不翻转 y=v，首轮误用 y=(1-v) 把 atlas 上下镜像；色块均匀故 G1 假阳性通过，空间渐变才暴露）。修正 v 不翻转后正式 G4 通过：fresh AgX PNG vs Web passthrough 同腐蚀 Face mask（2801 样本）MAE=[14.23,13.59,12.32]（≤20/255）、P95=64、相对 base face=[111.57,81.67,70.68] 下降 [87.2%,83.4%,82.6%]（≥50%），exit 0 与 pass 一致；三层证据自洽（反投影保真 8.6 → GPU 链残差 11.4 → 端到端 14.2）。概念登记见 workflow/concepts/v14d-display-byte-passthrough-capture.zh-CN.md。

Stage 2B-M1（`codex/v14d-face-state2-runtime`，2026-08-31）详见 1.1 节与交付报告 `docs/handoff/2026-08-31-v14d-face-state2-runtime.md`：实时合成链已接线并通过配准 Gate（fov=28.0725 精确匹配、cameraPos/Target 非空、负测 shift/null 判别失败）与双纹理绑定 Gate（liveBound=true、liveMaskPath=Textures/v14d-state2-mask/state2.png），full Face 覆盖率 1.0、pageErrors=0；完整 Face Gate 的**修正轮最终实测**仍未达 ≤20/255（faceShadowOnly `[88.20,90.23,71.00]`、finalFaceComposite `[75.58,34.53,31.98]`），阈值未放宽、按阻塞交付。报告中 `[58.41,54.83,62.96]` / `[50.96,26.51,29.41]` 仅保留为修正前中间记录，不是最终 Gate 数值。
Stage 2B-P1（`codex/v14d-reze-fresh-patch-completeness`，2026-09-01）完成 `patch-reze-engine.mjs` 的 fresh-patch 注入完整性闭环：`--self-test` 在真实隔离的干净 `reze-engine@0.26.0` tarball fixture 上要求首次 exit=0、二次 exit=0、覆盖 11 个生产 target 文件的逐项哈希不变；anchor-miss、missing-file、重复 marker、断点 A 缺失、断点 B 缺失和 PMX 长度补丁 anchor-miss 全部从 clean seed 硬拒绝。普通补丁、predev、prebuild 与 `--verify` 共用严格不变量计数，当前 58 项满足预期（56 个注入 marker 各 1 次、2 个 PMX 移除 marker 各 0 次）。生产注入覆盖 materialAuxTextures 类型、断点 A 的 override/import/接线、断点 B 的 binding(5) baseEntries/fallback/重绑展开、bind-group layout、旧 PMX 长度补丁及 src/dist 路径；无 aux 材质的 binding(5) 由有效 fallback GPUTextureView 兜底，aux 材质保留真实 mask view。聚焦运行时 Gate、fresh self-test、A/B/C 回归、`npm run build`、默认入口和 VMD runtime 均通过。详见 `docs/handoff/2026-09-01-v14d-reze-fresh-patch-completeness.md`。
Stage 2B-M3（`codex/v14d-body-skin-state2`，2026-09-02）把 V14D 皮肤渲染体系从 Face 扩展到 BodySkin：Blender 取证确认 BodySkin 无离散阴影 mask、身体是 body_d 线性 × 身体 warm=[1,0.945,0.905] 直出（与 Face 同 skin family、同乘法暖肤结构，但 warm 常量与 mask 均为脸部专用，禁止套用）。finalFaceComposite 额外把 BodySkin 切到 V14D Body Skin Composite graph（按 graph.name 精确覆写 final_color 为 v14d_skin_body_composite），仅 v14dFaceStatic=1 诊断入口生效，生产默认不变。详见 `docs/handoff/2026-09-01-v14d-body-skin-state2.md`。

修正轮（同 failure family 第一次修正，2026-09-02）：四区域（neck/waist/leftHand/rightHand）改为独立数值对账——BodySkin 三角形蒙皮世界质心按 `V14D_BODY_SKIN_REGIONS`（世界 y 带 + x 符号）分区，映射回屏幕像素（triId per pixel + pick mask 前景），每区域独立给出样本数/覆盖率/HDR 线性均值/Blender 同区域参考（body_d×warm）/逐通道 MAE/通过状态，不再用整块 BodySkin 均值替代。bodyApplied 改为真实 graph 状态证据（applyStyleGroups 组诊断 ok 且引擎 getStyleGroups 中 BodySkin 实际绑定 graph.name === "V14D Body Skin Composite"），dataset 暴露 `v14dBodySkinGraph`/`v14dBodySkinGroupOk` 供 Gate 核对；负测（漏绑/错 graph/错材质 HairA）见 `web/scripts/gate-v14d-body-graph-negative.mjs`。四区域近景按区域世界质心自动定位相机并叠加区域轮廓/样本数。腰部在 frame120 叉腰姿势下被长袖/手臂全角度遮挡（真实几何），Gate 诚实标记 occluded 并 exit 3（checkpoint），不软通过。概念登记见 `workflow/concepts/v14d-body-skin-state2.zh-CN.md`。

二次修正（同 failure family 最后一次修正，2026-09-02）：
- **同 UV 逐像素区域参考**（替代初修的整图 body_d×warm 全材质均值 `bodyDMeanLinear`）：每个正式 Web 像素带 triId+UV，在 body_d 同 UV 采样 × 身体 warm=[1,0.945,0.905] 得逐像素参考，逐区域聚合 refLinear/refSamples/逐像素 MAE/P95；blenderTris 仅用于分区与质心定位，不再作为颜色参考。同 UV 参考后四区域 MAE 显著下降（neck 0.110→0.025，leftHand 0.017→0.042，rightHand 0.015→0.009）。
- **Face 五区域统一 schema**：Face 补齐区域定义/有效 mask/coverage/同 UV 参考 refLinear/refSamples/逐通道 MAE/P95/状态，参考口径为 face_d×Face warm=[1,0.935,0.89] 基色×warm（不含脸部专用 State2 art/fringe）。
- **标注图证据修正**：全身图只对全身可见的左右手用 triId+pick 重建真实 mask 提轮廓绘制；neck/waist 全身不可见改为文字标注 "fullbody occluded / see closeup"；每张 closeup 在自身坐标系叠加真实 mask 轮廓+区域名+样本数+状态；补侧面全身 side-{normal,finalFaceComposite}.png。
- **draw-call 级绑定证据与真实运行时负测**：引擎新增 `exportBodySkinDrawBinding()`（读 modelInstances→drawCalls→styleGroups→graph.name/pipeline），dataset 暴露 `v14dBodySkinDrawCalls`/`v14dBodySkinDrawOnComposite`；Gate 核对每个 BodySkin draw call 实际 graph.name 与 pipeline 命中 "V14D Body Skin Composite"。负测改为真实浏览器运行时 fault injection（URL 参数 `v14dBodyFault`=missing/wrongGraph/wrongMaterial，默认关闭），见 `web/scripts/gate-v14d-body-graph-runtime-negative.mjs`：漏绑/错 graph/错材质 HairA 三种场景 Gate 均 exit 1，正确绑定 exit 0 且 drawOnComposite=1/1。`web/scripts/gate-v14d-body-graph-negative.mjs` 保留为静态辅助核对，并改为基于 import.meta.url 解析路径（仓库根与 web/ 两种 cwd 均可运行）。

Stage 2B-M3.1（codex/v14d-bodyskin-semantic-pixel-gate，2026-09-02）修复 BodySkin 语义分区与真逐像素 Gate：区域归属从「世界 y 带 + x 符号」改为版本化骨骼主导权重集合（V14D_BODY_SKIN_BONE_REGIONS_V1，顶点主导骨骼 → neck/torso/leftHand/rightHand），解决旧版左手 y 带误吞腰腹皮肤；Gate 参考采样改 GPU 口径双线性（替代最近点），MAE 改为真逐像素逐通道 mean(abs(web_i-ref_i))（替代均值差，消除正负误差抵消），Face 与 BodySkin 强制同一像素样本集合（numerator/denominator），正式 Gate 消费 draw-call 级绑定证据（exportBodySkinDrawBinding），新增语义负测（左右手交换/腰腹注入/UV 集合错位/均值抵消构造）。概念登记见 workflow/concepts/v14d-bodyskin-bone-semantic-region.zh-CN.md。仅诊断入口生效，生产默认入口、PMX/VMD/骨骼/物理/播放链零改动。

**验收修正轮（2026-09-02，同 failure family 二次闭合，已被下方最终收口取代）**：本轮为历史中间态，其 coverage=像素/三角形（量纲像素/三角形、非 0..1）、N5=剔除 torso 骨集合、remainingRootCause=color-gate-unresolved 等口径均已被最终收口的 ∈[0,1] 集合语义、checkBoneNames 错骨名/骨序负测、candidate-color-gate-passed 取代。机制结论（版本统一 v1、语义负测在真实 joints/weights 上扰动重跑、N3 配置失败 exit 2、骨名硬断言、探针正名、Git 清理、draw-call 证据消费）仍有效并被最终收口继承；当前权威口径以最终收口段与正式 gate-report.json 为准。

**最终收口（2026-09-02，三次闭合）**：来源主会话二次验收要求阻断 1-5 闭合。修正并复验通过（正式 Gate exit 0、独立语义负测红绿全过）：(1) 本票所有 .scratch/**/*.png（gate-m31-final 与残留 gate-m31-v3 共 36 张）从 Git 索引移除（git rm --cached，磁盘保留供重生成），未移到其他 tracked 目录、未碰其他票据 .scratch；(2) coverage 改为 ∈[0,1] 的集合语义——visibleTriCoverageNumerator=正式样本命中的唯一三角形数、visibleTriCoverageDenominator=regionTriTotal、coverage=唯一可见三角形/regionTriTotal，samples/samplesPerTriangle 另列，四区域硬断言 numerator>0/denominator>0/0<coverage<=1，近景/全身分母同一语义；(3) 骨名硬断言抽为可测试纯函数 checkBoneNames，正式 Gate 内对 skeletonBoneNames 做真实扰动自验（交换骨名 6/8 报 2 处失配、index6 改错名报 1 处失配均检出），原集合扰动保留为 boneSetRemoval（不再命名 boneOrderDrift）；(4) regionIdOf/labelOf 硬要求 boneRegionLabels（缺失即 null→Gate 失败，不回退旧矩形分区），正式 Gate 硬断言 boneRegionLabels 非空 + boneRegionIds 顺序 + boneRegionVersion=1；(5) remainingRootCause(color-gate-unresolved) 移除，改 colorGate.status=candidate-color-gate-passed，mip/LOD/sampler/色彩空间链放入 limitations/unexcludedRisks。N1/N2 红绿：新增 web/scripts/gate-v14d-body-skin-semantic-negative.mjs 独立进程（每场景起页面，扰动骨骼集合重跑 exportMaterialTriRegions 分类），healthy exit0、hand-swap/torso-inject/wrong-bone-name/wrong-bone-order 均 exit1 非零拒绝，===SEMANTIC-NEG-OK===。复验：build exit 0、正式 Gate exit 0、N3 配置失败 exit 2、graph runtime negative exit 0、default/VMD exit 0、diff-check exit 0、PMX/VMD 零 diff。
\n\n## 云端部署（2026-09-14）\n\n系统新增云端部署层，FastAPI 和 Next.js 前端部署到腾讯云 `43.130.14.178`，OpenClaw 和 TTS 保留在家中 Mac。\n\n```\n用户浏览器/手机 App\n    |\n    v  HTTPS (443, 自签名证书)\nNginx (43.130.14.178)\n    |-- /api/*         --> FastAPI (127.0.0.1:8100)\n    |-- /api/backend/* --> Next.js (127.0.0.1:3000) --> FastAPI\n    |-- /*             --> Next.js 前端页面\n\nFastAPI --> 反向 SSH 隧道 --> 家中 Mac (10.11.252.164)\n    |-- OpenClaw Gateway (18789)\n    |-- Qwen3-TTS (5555)\n```\n\n### 关键配置\n\n| 项目 | 云端值 | 说明 |\n|------|--------|------|\n| API 部署根 | `/srv/mmd-companion-api/` | FastAPI + venv + MMD 模型 |\n| 前端部署根 | `/srv/mmd-companion-web-full/` | Next.js 源代码 + 构建产物 |\n| Nginx 配置 | `/etc/nginx/sites-available/mmd-companion` | 443 HTTPS + 80 重定向 |\n| SSL 证书 | `/etc/nginx/ssl/mmd-companion.crt` | 自签名，365 天 |\n| API 端口 | 8100（仅回环） | 通过 Nginx 暴露 |\n| 前端端口 | 3000（仅回环） | 通过 Nginx 暴露 |\n| 反向隧道端口 | 18789, 5555（仅回环） | 从家中 Mac 建立 |\n\n### 认证\n\n- 账号密码登录（`/auth/login`），JWT Token 72 小时有效\n- 全局 `AuthMiddleware` 拦截，公开路径：`/healthz`、`/healthz/openclaw`、`/auth/*`、`/docs`、`/openapi.json`、`/redoc`\n- `JWT_SECRET` 配置在云端 `.env` 中\n\n### 一键部署\n\n```powershell\n.\scripts\deploy-cloud.ps1              # 完整部署\n.\scripts\deploy-cloud.ps1 -Action web  # 只重建前端\n.\scripts\deploy-cloud.ps1 -Action api  # 只重启后端\n.\scripts\deploy-cloud.ps1 -Action status  # 查看状态\n.\scripts\deploy-cloud.ps1 -Action tunnel  # 重建隧道\n```\n\n### 详细文档\n\n- [云端部署指南](cloud-deployment.md)\n


## 云端部署（2026-09-14）

系统新增云端部署层，FastAPI 和 Next.js 前端部署到腾讯云 `43.130.14.178`，OpenClaw 和 TTS 保留在家中 Mac。

```
用户浏览器/手机 App
    |
    v  HTTPS (443, 自签名证书)
Nginx (43.130.14.178)
    |-- /api/*         --> FastAPI (127.0.0.1:8100)
    |-- /api/backend/* --> Next.js (127.0.0.1:3000) --> FastAPI
    |-- /*             --> Next.js 前端页面

FastAPI --> 反向 SSH 隧道 --> 家中 Mac (10.11.252.164)
    |-- OpenClaw Gateway (18789)
    |-- Qwen3-TTS (5555)
```

### 关键配置

| 项目 | 云端值 | 说明 |
|------|--------|------|
| API 部署根 | `/srv/mmd-companion-api/` | FastAPI + venv + MMD 模型 |
| 前端部署根 | `/srv/mmd-companion-web-full/` | Next.js 源代码 + 构建产物 |
| Nginx 配置 | `/etc/nginx/sites-available/mmd-companion` | 443 HTTPS + 80 重定向 |
| SSL 证书 | `/etc/nginx/ssl/mmd-companion.crt` | 自签名，365 天 |
| API 端口 | 8100（仅回环） | 通过 Nginx 暴露 |
| 前端端口 | 3000（仅回环） | 通过 Nginx 暴露 |
| 反向隧道端口 | 18789, 5555（仅回环） | 从家中 Mac 建立 |

### 认证

- 账号密码登录（`/auth/login`），JWT Token 72 小时有效
- 全局 `AuthMiddleware` 拦截，公开路径：`/healthz`、`/healthz/openclaw`、`/auth/*`、`/docs`、`/openapi.json`、`/redoc`
- `JWT_SECRET` 配置在云端 `.env` 中

### 一键部署

```powershell
.\scripts\deploy-cloud.ps1              # 完整部署
.\scripts\deploy-cloud.ps1 -Action web  # 只重建前端
.\scripts\deploy-cloud.ps1 -Action api  # 只重启后端
.\scripts\deploy-cloud.ps1 -Action status  # 查看状态
.\scripts\deploy-cloud.ps1 -Action tunnel  # 重建隧道
```

### 详细文档

- [云端部署指南](cloud-deployment.md)

## 本地原动画抽取工具箱（2026-09-16）

离线入口为 imgToAction/game-extraction/README.zh-CN.md；流程契约见 workflow/concepts/source-motion-reuse.zh-CN.md，Skill权威源位于 imgToAction/game-extraction/skill/，安装名 game-motion-extraction。工具箱新增参数化指定包提取、全通道/映射覆盖审计、原节点层级播放和VMD结构预检，游戏资产只读输入、结果写私有新目录，不接入或替换线上API/默认动作/渲染链。

2026-09-18 增加离线 `vmd_delivery_gate.py`：检查直接骨回放、VMD独立读写、源目标网格适配的数值证据与资产哈希，失败返回2并阻止交付复制。Koleda兵营互动旧导出实验增加候选输出路径限制，不能直接写ak012/vmd；候选先留实验目录，通过门禁后才可受控复制。该检查不重新运行Blender、不证明报告生产者诚实，也不替代网页试播、碰撞或正式动作门禁；现有7份旧VMD及摸头修正候选均没有获得通过。当前网站播放策略与资产数据库未改。

当前验证覆盖GF2 Koleda指定哈希的流式＋常量片段，不宣称通用游戏格式支持；原衣发曲线、运行时物理和VMD分别验收。历史28份脚本作为.reference只读案例归档，包含未通过转换与物理试验，不是可直接运行的生产脚本。源PC2衣发复用版仍有穿插，VMD独立转换任务尚未完成来源验收，不能据工具箱发布状态宣称动作已可正式发布。
