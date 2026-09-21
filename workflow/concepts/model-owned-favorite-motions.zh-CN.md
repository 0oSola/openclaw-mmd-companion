# 模型归属收藏动作

## 定义与适用范围

模型归属收藏动作（model-owned favorite motions）指每个 PMX 模型的收藏 VMD 只存放在该模型自己的 `MMD/usage/vmd/<模型目录名>[动作]/` 目录下，并且只对该模型可见。

`<模型目录名>` 取 PMX 所在父目录名；PMX 位于 MMD 根目录时退化为文件名主体。目录名以 `[动作]` 结尾，是归属判定的唯一标记。

适用于收藏写入、资产同步入库、收藏列表展示、聊天动作解析、点击动作与默认待机池。不适用于 `_builtin` 共享非收藏资产，也不适用于动作本身的骨架兼容性或碰撞安全判断。

## 解决的问题

旧规则把优菈收藏目录当作唯一权威来源，并把它递归复制到 `usage/vmd/_builtin` 供所有模型只读继承。结果是：任何一个模型收藏动作都会被写进优菈目录，其它模型也会看到不属于自己的动作。用户无法让不同模型各自维护独立动作库。

新的归属模型让「谁收藏」和「谁能用」保持一致：收藏时写入当前选中模型的目录，读取时只取当前选中模型目录的内容。

## 核心不变量

- 收藏文件路径的第三段必须等于当前模型的 `<模型目录名>[动作]`。
- `_builtin` 不是收藏目录；其中的资产不计入任何模型的收藏集合。
- 模型之间不继承：`Koleda[动作]` 的内容对 `Eula` 不可见，反之亦然。
- 取消收藏会删除收藏副本并清空 `favorite_relative_path` 与 `favorite_model_relative_path`。
- 收藏文件缺失或路径落在任何 `[动作]` 目录之外时，同步会把该记录的 `is_favorite` 摘掉。

## 计算口径与证据

归属由路径第三段与 `modelFavoriteFolderName(model_relative_path)` 的字符串相等性判定，两侧统一小写比较。后端 `favorite_model_relative_path` 记录归属模型，由 `_infer_model_relative_path_from_favorite_path` 反查得到。

验证证据：后端 `api/tests/test_message_service_v2.py::test_favorite_motions_are_scoped_to_their_own_model_folder` 在真实 MMD 根目录下为 Eula 与 Koleda 各建一条收藏，断言 `motion-context/exports` 各自只返回 1 条且文件名不串；`api/tests/test_universal_builtin_actions.py` 断言不再生成 `_builtin` 副本且克莱妲收藏对优菈解析为空。前端 `web/tests/vmd-preview.test.mjs` 断言目录名映射与跨模型隔离。

## 正例与反例

正例：在选中 `Koleda/Koleda.pmx` 时收藏 `wave.vmd`，文件落到 `usage/vmd/Koleda[动作]/wave.vmd`，克莱妲的收藏页与待机池出现它，优菈看不到。

反例：把任意模型的收藏写进 `优菈_by_原神_...e0b0[动作]/`；从 `_builtin` 反推归属；让 `Eula[动作]` 的动作出现在 Ayaka 的收藏列表或 `motion-context` 导出里。

## 失败后的修正路线

收藏后列表为空时，依次检查：收藏请求是否带了 `model_relative_path`；目标目录是否等于当前模型目录名；`/assets/vmd` 同步是否已把该文件入库并标记 `is_favorite`；文件是否非空（64 字节仅文件头的 VMD 不可播放）。

## 与现有概念的关系

取代 `EulaUniversalFavoriteMotions`（优菈通用收藏动作）与 `usage/vmd/_builtin` 作为收藏来源的旧语义。收藏即待机（`favorite-idle.zh-CN.md`）的「入池」现在以本概念过滤后的集合为输入。
