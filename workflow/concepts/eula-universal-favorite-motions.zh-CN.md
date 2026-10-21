# 优菈通用收藏动作

## 中文名称

优菈通用收藏动作。

## 英文机器名

`EulaUniversalFavoriteMotions`。

## 概念定义

这是把归属到优菈 PMX 的收藏 VMD 作为可由所有 PMX 只读复用的动作库的规则。资产仍只有一条 canonical（规范）记录，`favorite_model_relative_path` 仍记录优菈原始归属；其它 PMX 不复制资产、不改写收藏归属。

## 解决的问题

优菈已整理好的招呼、思考、回答和性格动作此前被前端和消息动作解析严格限制在优菈 PMX，切换其它 PMX 后只剩少量待机回退，不能复用完整收藏库。

## 适用与不适用场景

- 适用：主站收藏列表、手动预览、角色点击动作、聊天 motion_key 与语义动作解析。
- 适用：其它 PMX 缺少自己的 `00_idle_loop` 时的默认待机回退。
- 不适用：收藏/取消收藏的归属修改；其它 PMX 不得借此取消优菈收藏或把其迁移为本模型收藏。
- 不适用：把所有优菈动作当作待机循环；待机只使用 `00_idle_loop`。

## 核心不变量

1. 当前 PMX 自己收藏的同一资产优先，随后合并优菈收藏并按 `asset_id` 去重。
2. 默认待机优先级为：当前 PMX 的 `00_idle_loop` → 优菈的 `00_idle_loop` → 其它安全收藏的 `00_idle_loop` → 当前 PMX 的安全非进场收藏 → 优菈的安全非进场收藏 → 其它安全非进场收藏 → procedural idle。
3. `01_entry_fallback` 永远不得进入默认待机循环；只有整个收藏库没有已分类的 `00_idle_loop` 时，安全的非进场收藏才可作为兼容回退。
4. 聊天动作导出和消息解析必须使用同一可用动作库，避免前端能预览、后端却无法解析。
5. 所有跨 PMX 使用均为只读复用，不复制 VMD 文件、不创建重复 `asset_registry` 行、不改变 `favorite_model_relative_path`。

## 证据与计算口径

- 前端合并与待机选择：`web/src/features/mapping/vmdPreview.js`。
- 主站消费：`web/src/app/companion/page.tsx`。
- 后端聊天动作导出与解析：`api/app/services/motion_resolution.py`、`api/app/routes/message_service.py`。
- 优菈识别依据为收藏模型路径中包含 `优菈` 或 `eula`（大小写无关）。

## 正例

切换到绫华 PMX 后，收藏页可预览优菈的“思考”和“招呼”；聊天返回优菈动作的 `motion_key` 时能播放该 VMD。绫华没有自己的 `00_idle_loop` 时，默认待机优先随机播放优菈的 `00_idle_loop`；若优菈收藏也没有该分类，则回退到安全且非进场的优菈收藏，避免舞台停在 bind pose。

## 反例

切换到其它 PMX 后只借用一条优菈待机、收藏页不显示其它优菈动作，或在已存在 `00_idle_loop` 时把“思考 / 回答 / 招呼”混入默认待机循环，均不符合本规则。

## 相关契约与门禁

- `VmdAsset.favorite_model_relative_path`
- `POST /motion-context/exports`
- Message Service 的 `motion_resolution`
- `web/tests/vmd-preview.test.mjs`
- `api/tests/test_message_service_v2.py`

## 失败后的修正路线

1. 如果其它 PMX 看不到优菈动作，检查前端合并池是否同时传给收藏列表和角色点击动作。
2. 如果聊天动作仍回退待机，检查 motion context export 与 `resolve_motion_resolution()` 是否都使用通用收藏库。
3. 如果待机播放了招呼或思考，先检查是否已有可播放的 `00_idle_loop`；有时不得放宽分类过滤，无时才允许安全非进场收藏回退。
4. 如果跨 PMX 资产可被错误取消收藏，保留原有归属校验，不允许从非归属模型取消收藏。

## 与现有概念的关系

本规则扩展既有“收藏 VMD / 舞台待机”规则：收藏归属仍按模型保存，但优菈收藏的播放可见性和聊天可解析范围扩展到所有 PMX。
