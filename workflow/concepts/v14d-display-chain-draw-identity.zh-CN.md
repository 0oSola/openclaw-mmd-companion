# V14D 显示链绘制身份唯一性

## 中文名称

V14D 显示链绘制身份唯一性。

## 英文机器名

- 契约 id：`v14d-display-chain-draw-identity`。
- 相关字段：`drawIdentityKey`、`drawIndex`、`drawOrder`、`matchStatus`。
- 相关函数：`findV14dDisplayChainDrawMatch`、`validateV14dDisplayChainDrawTrace`。

## 概念定义

显示链绘制身份唯一性，是把生产 draw-call 与真实 `drawIndexed` 调用建立可审计一一对应关系的规则。一个目标 draw 的身份至少由 `materialName`、`groupId`、`type`、`count`、`firstIndex` 和顺序信息组成；生产源的 `drawIndex` 与实际命令流中的 `drawOrder` 分开记录，不能把生产数组索引直接当作实际发出顺序。

## 解决的问题

它解决“按 type/count/firstIndex 顺序猜配”造成的假证据：生产源可能存在重复 range、未实际发出的槽位，或实际 draw 顺序与源数组索引不连续。没有唯一身份核对时，trace 可能把旧 pipeline、错误材质或相邻槽位误标为 Brows/Lashes。

## 适用范围

- `/companion` Reze WebGPU 的显式 acceptance probe 显示链 trace。
- Brows/Lashes identity 与 sentinel 对照中的生产 draw、pipeline、bind group 和最终 canvas 证据。
- 需要把 duplicate、ambiguous、unmatched 作为机器失败而不是人工解释的诊断脚本和纯函数测试。

## 不适用范围

- 不改变生产 draw-call、材质槽、几何、拓扑、绑定、管线生成或正式视觉阈值。
- 不用 `drawIdentityKey` 替代 pre-tonemap HDR、resolve/composite 或最终 canvas 证据。
- 不把连续的 `drawOrder` 强行等同于可能跳号的生产 `drawIndex`；只核对目标槽相对顺序和各自索引。

## 核心不变量

1. 在同一 instance/type 的生产 draw 列表中，目标 range 候选必须恰好一个；零候选为 `unmatched`，多候选为 `ambiguous`。
2. Brows 与 Lashes 在生产源和实际 trace 中必须各恰好出现一次；目标 `drawIndex` 必须是非负整数。
3. 目标身份的 `materialName`、`groupId`、`type`、`count`、`firstIndex` 必须逐字段一致。
4. 生产 `drawIndex` 与实际 `drawOrder` 必须分别落盘；目标的实际顺序必须与生产目标顺序一致且不重复。
5. 实际 `setPipeline` 必须等于该槽 compile/install pipeline；material bind group 必须等于生产源 bind group。
6. 任一实际 draw 的 `matchStatus` 为 `duplicate`、`ambiguous` 或 `unmatched` 时，报告必须失败，不能用目标区域差异包装通过。

## 证据或计算口径

生产源先按 `type/count/firstIndex` 建立 range 候选；只有一个候选时，才读取其材质名、分组、生产 `drawIndex` 和绑定身份。trace 为每个实际 draw 记录 `drawOrder`、候选索引、`matchStatus` 和 `drawIdentityKey`。验收函数再对 Brows/Lashes 做唯一计数、逐字段身份、索引、相对顺序、pipeline 与 bind group 核对。

`drawIdentityKey` 使用 `materialName`、`groupId`、`type`、`count`、`firstIndex`、`drawIndex`、`drawOrder` 组成；生产索引缺失或实际顺序重复都会被单独拒绝。该身份规则只说明“这一次 draw 是谁”，不说明它已经写入 HDR 或最终 canvas。

## 正例

- Brows/Lashes 各只有一个 range 候选，实际 trace 的 `matchStatus=unique`，生产 `drawIndex` 为 18/19，实际 `drawOrder` 保持相对顺序，pipeline 与 bind group 逐槽相等。
- 生产源数组中存在一个未发出的 draw，使实际 `drawOrder` 为 17/18 而生产目标 `drawIndex` 为 18/19；两者分别记录且相对顺序一致，仍可通过。

## 反例

- 两个 draw 共享同一 `type/count/firstIndex`，匹配状态为 `ambiguous`，机器拒绝。
- 实际 draw 的 range 不在生产源中，匹配状态为 `unmatched`，机器拒绝。
- 实际 Brows 使用 sentinel pipeline 以外的旧 pipeline，或 `drawIndex`/`groupId` 不一致，机器拒绝。

## 相关 contract/gate

- `v14d-display-chain-commit-boundary`：规定绘制身份是 graph 到 canvas 证据链中的必要节点。
- `v14d-production-draw-call-source-snapshot`：提供生产 draw range、索引、pipeline 和 bind group 来源。
- `v14d-brows-lashes-identity-tint`：定义 Brows/Lashes 目标材质槽和 identity 语义。
- `web/scripts/repro-v14d-brows-lashes-display-chain.mjs`：消费验证结果并在不唯一时 exit 1。

## 失败后的修正路线

1. 先查看 `matchStatus` 与候选索引，确认是 duplicate、ambiguous 还是 unmatched。
2. 再核对生产快照的 `materialName/groupId/type/count/firstIndex/drawIndex`，不能改顺序或猜材质。
3. 若生产快照本身不唯一，修正生产源快照接口或引擎数据契约；若只有 trace 不唯一，修正 acceptance-only 观测接缝。
4. 身份唯一性通过后，继续核对实际 pipeline、HDR、resolve/composite 和最终 canvas；不得把身份通过误报为视觉通过。

## 重新审查条件

当 reze-engine 改变 draw list、pass 顺序、`drawIndexed` 参数、材质重绑或生产快照字段时，必须重新验证 range 唯一性、目标顺序和负测覆盖。
