# 通用内置动作库

## 中文名称

通用内置动作库。

## 英文机器名

`usage/vmd/_builtin`。

## 概念定义

通用内置动作库是 `MMD/usage/vmd/_builtin/`。它是优菈规范收藏目录 `MMD/usage/vmd/优菈_by_原神_339146e6e418d79e85a515b26414c0b0[动作]/` 的递归物理副本，供所有 PMX 作为默认动作源读取；它不是收藏目录，库内资产不得标记为 `is_favorite=true`。

## 解决的问题

此前数据库中任意 PMX 的 `is_favorite` 标记都会进入收藏和动作候选池，导致非优菈规范目录的动作被误显示为收藏。现在收藏只有一个物理权威来源，而通用动作以独立副本服务所有模型。

## 适用场景

- 所有模型的默认待机、手动预览、聊天和点击动作候选；
- 优菈规范收藏目录内容的跨模型内置复用。

## 不适用场景

- 不用于表示用户收藏；
- 不用于从其它 PMX 目录继承收藏；
- 不用于覆盖或删除原优菈规范收藏目录。

## 核心不变量

1. 只有 `MMD/usage/vmd/优菈_by_原神_339146e6e418d79e85a515b26414c0b0[动作]/` 及其子目录中的 VMD 可以是收藏。
2. 任何不在该目录中的历史 `is_favorite` 数据在资源同步时必须撤销收藏标记。
3. `_builtin` 的文件来自规范收藏目录的副本，所有 PMX 可读取，但永远不显示在“收藏”页。
4. 手动收藏一条资源时，系统必须把副本写入规范收藏目录；不能再写入当前 PMX 自己的 `[动作]` 目录。

## 证据或计算口径

- 资源同步与收藏写入：`api/app/routes/assets.py`。
- 前端收藏、待机和资源库筛选：`web/src/app/companion/page.tsx`、`web/src/features/mapping/vmdPreview.js`。
- 后端聊天与动作上下文选择：`api/app/services/motion_resolution.py`。

## 正例

优菈规范收藏目录中的 `03_thinking_waiting/思考_100pct_reference.vmd` 在收藏页出现；其副本在 `_builtin/03_thinking_waiting/`，可被克莱妲等其它 PMX 作为内置动作读取，但副本本身不显示为收藏。

## 反例

`MMD/usage/vmd/克莱妲原皮[动作]/wave.vmd` 或数据库中只有 `is_favorite=true`、但没有规范优菈目录路径的资产，不是收藏动作。

## 相关契约与门禁

- `GET/PATCH /assets/vmd`；
- `/motion-context/exports`；
- `list_available_favorite_motion_assets()`；
- web VMD 预览测试与 API 消息服务测试。

## 失败后的修正路线

1. 收藏页混入非规范目录动作时，检查资源同步的路径判定和历史收藏清理。
2. 某模型没有默认内置动作时，检查 `_builtin` 副本与其数据库索引。
3. 手动收藏写入其它模型目录时，检查收藏副本目标是否固定为规范优菈目录。

## 与现有概念的关系

通用内置动作库复用优菈规范收藏目录的内容，但与“优菈收藏动作”不同：前者是所有模型可读的默认库，后者是唯一的收藏判定来源。
