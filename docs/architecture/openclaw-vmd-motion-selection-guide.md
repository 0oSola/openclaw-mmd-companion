# OpenClaw VMD Motion Selection Guide

更新时间：2026-07-07

本文用于给 OpenClaw 这类外部 agent 选择 MMD/VMD 动作。目标不是描述文件目录，而是让 agent 能稳定输出可被本项目后端命中的 `motion_key`。

当前适用模型：

```text
model_key: 优菈_by_原神_339146e6e418d79e85a515b26414c0b0/优菈.pmx
motion_root: MMD/usage/vmd/优菈_by_原神_339146e6e418d79e85a515b26414c0b0[动作]/
user_id: admin-1
```

## 1. Agent 输出契约

OpenClaw 返回 assistant JSON 时，VMD 动作通过 `action` 命中：

```json
{
  "text": "要回复给用户的文本",
  "emotion": "neutral",
  "action": "411a73ef-3169-400a-9f32-d193d171e65c",
  "motion_plan": null,
  "tts_emotion_label": null,
  "tts_pause_profile": "podcast"
}
```

规则：

- `action` 优先填写下方表格中的 `motion_key`，也就是当前 SQLite `asset_registry.asset_id`。
- `motion_key` 是最稳定命中方式；中文动作名只是 alias，适合给人看，不建议作为主键。
- 当前后端主路径是精确匹配。可命中的 token 包括：`asset_id`、`display_name` 去后缀、`display_name`、`filename`。
- 受控语义 fallback 只开放给少数已验证动作：`think`/`thinking`/`thinking_tilt` 会从当前模型 `03_thinking_waiting` 中优先选择 `100pct/reference/思考` 命名 VMD；`akimbo`/`hands_on_hips`/`hands-on-hips`/`arms_akimbo`/`arms-akimbo`/`叉腰` 会从当前模型 `06_strong_personality` 中优先选择 `100pct/reference/叉腰` 命名 VMD。
- 不要把自定义 VMD 动作写进 `motion_plan.sequence.template`。当前 parser 只稳定支持固定 procedural template：`agree_nod`、`celebrate_big`、`comfort_lean`、`disagree_headshake`、`greet_wave`、`listen_lean`、`shy_look_away`、`thinking_tilt`。
- 不确定动作时返回 `action: "idle"`。后端会进入 `fallback_idle`；只要没有 resolved VMD，前端会从当前模型 `00_idle_loop` 随机抽取一个 VMD 作为兜底。当前模型没有 idle VMD 时才回退默认 procedural idle。

## 2. 后端命中机制

消息链路中，后端会在当前 `selected_model_path` 对应的收藏 VMD 中解析动作：

```text
OpenClaw response
  -> normalize_assistant_reply()
  -> assistant_message.action
  -> _resolve_motion_resolution()
  -> store.list_favorite_assets_for_model(user_id, selected_model_path)
  -> exact token match
  -> controlled semantic fallback for think/thinking_tilt or akimbo/叉腰
  -> resolved_asset_url=/assets/vmd/file/{asset_id}
  -> frontend plays matched VMD once
```

候选优先级：

1. `assistant_message.action`
2. `motion_plan.sequence[0].template`
3. `motion_plan.sequence[1..].template`

实际建议：让 agent 直接把 `action` 写成 `motion_key`，不要依赖 `motion_plan` 兜底。思考和叉腰是例外：不知道当前 `motion_key` 时，思考可返回 `emotion: "thinking"`、`action: "think"` 和 `thinking_tilt`，后端会优先命中 `03_thinking_waiting/思考_100pct_reference.vmd`；叉腰可返回 `emotion: "neutral"`、`action: "akimbo"`，后端会优先命中 `06_strong_personality/叉腰_100pct_reference.vmd`。

## 3. 分类选择策略

| Category | 用途 | Agent 使用策略 |
| --- | --- | --- |
| `00_idle_loop` | 安静待机循环 | 默认待机池。一般不由 OpenClaw 主动选择，除非明确要求“保持待机”。 |
| `01_entry_fallback` | 进场、初始化、兜底姿态 | 仅用于初始化、异常恢复、没有语义动作时的兜底。 |
| `02_greeting_social` | 打招呼、行礼、社交开场 | 用户问候、开场、感谢、轻社交回应。 |
| `03_thinking_waiting` | 思考、等待、看时间 | 分析问题、需要等待、确认进度、暂时不能立即给结论。 |
| `04_answering_explain` | 回答、介绍、解释、结论 | 常规回答主体，优先用于技术解释、项目说明、明确建议。 |
| `05_soft_emotion` | 安抚、害羞、偷笑 | 安慰、温和反馈、轻松玩笑、收到夸奖后的反应。 |
| `06_strong_personality` | 炫耀、叉腰、轻蔑、暧昧 | 强个性表达。只在语气明确需要时使用，避免用于普通技术答复。 |

默认策略：

- 普通回答：优先 `04_answering_explain`。
- 用户问候：优先 `02_greeting_social`。
- 等待、查询、推理中：优先 `03_thinking_waiting`。
- 错误、失败、用户焦虑：优先 `05_soft_emotion/安抚`。
- 强个性动作只在用户明确接受或场景明显合适时使用。
- `00_idle_loop` 应主要交给前端待机状态机随机循环，不建议 agent 主动频繁触发。

## 4. Motion Inventory

| motion_key | alias | category | intent | emotion | intensity | use_when | avoid_when |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `6369c84f-530c-4ed6-8c8e-591b2f54f2be` | `Smelling Something in the Air` | `00_idle_loop` | idle_observe | neutral | low | 安静待机、环境感、轻微观察 | 主动回答、严肃结论、道歉 |
| `fb3f7ded-52a9-4500-a9f0-1097dbac596c` | `待机2` | `00_idle_loop` | idle_relaxed | neutral | low | 默认待机、无明确语义动作 | 用户正在等待明确答复 |
| `65183151-22a8-4654-85d9-cdf451e64d65` | `待机3` | `00_idle_loop` | idle_relaxed_variant | neutral | low | 默认待机循环变化 | 需要表达强情绪时 |
| `3562bdd5-7726-4540-b221-ec8a77e37a3b` | `进场待机` | `01_entry_fallback` | entry_standby | neutral | low | 初始化、进场、异常恢复兜底 | 常规聊天回复 |
| `8f961238-fc13-4abb-ab9b-1e225cc8a19e` | `打招呼1` | `02_greeting_social` | greet_wave | happy | medium | 你好、hi、开场、欢迎 | 严肃问题、错误说明 |
| `1345ba02-5bfb-4021-8d5e-c6049e704940` | `腼腆打招呼` | `02_greeting_social` | shy_greeting | happy | soft | 温和问候、感谢、轻松开场 | 自信结论、强指令 |
| `86c19a3b-c99f-4e05-beaa-41b155d3ef45` | `行礼1` | `02_greeting_social` | formal_bow | neutral | medium | 正式问候、致谢、礼貌收束 | 随意吐槽、强个性表达 |
| `439d9f31-a7c7-46d3-bd71-94fbfebffdae` | `思考1` | `03_thinking_waiting` | thinking_pose | thinking | low | 分析中、需要推理、暂时确认 | 已经给出明确最终结论 |
| `ab1ce767-55e1-4adf-b3f6-a846c3851cb5` | `看时间` | `03_thinking_waiting` | check_time_waiting | thinking | low | 等待、查询进度、耗时操作 | 情绪安抚、欢迎开场 |
| `8a2b552f-2986-4f99-9e22-067c881203ba` | `回答-介绍` | `04_answering_explain` | introduction_answer | neutral | medium | 介绍项目、解释背景、说明结构 | 强烈反驳、安慰 |
| `e0151055-9c95-4af0-99dd-e2f90f2fb34b` | `回答-比喻` | `04_answering_explain` | analogy_explain | thinking | medium | 用类比解释复杂概念 | 简短问候、直接报错 |
| `411a73ef-3169-400a-9f32-d193d171e65c` | `回答-自信` | `04_answering_explain` | confident_answer | neutral | medium | 明确建议、确定结论、方案说明 | 不确定、道歉、用户焦虑 |
| `9cd58328-b3ca-4124-95e1-670df1078149` | `回答-自信2` | `04_answering_explain` | confident_answer_variant | happy | medium | 有把握的补充说明、确认方案 | 模糊猜测、失败说明 |
| `59718add-e706-4a75-8a2f-d1af868f4d5d` | `偷笑` | `05_soft_emotion` | chuckle_tease | happy | soft | 轻松玩笑、俏皮回应 | 严肃故障、用户不安 |
| `a672d84b-92f3-41db-966e-c2d55967c3ad` | `安抚` | `05_soft_emotion` | comfort_reassure | caring | soft | 出错、失败、用户焦虑、道歉 | 庆祝、炫耀、强硬纠正 |
| `068835f0-0636-4025-8b84-f13843115037` | `害羞` | `05_soft_emotion` | shy_react | happy | soft | 收到夸奖、轻微不好意思、温和互动 | 技术结论、严肃提醒 |
| `0d3b39a3-13d7-47b8-bbab-349bc8079702` | `叉腰_100pct_reference` | `06_strong_personality` | arms_akimbo | neutral | strong | 坚定边界、自信提醒、轻微不服气；需要稳定叉腰姿态时优先使用 | 安抚、道歉、普通解释 |
| `10769a61-cbab-4912-a70d-55a74e000157` | `叉腰扭头` | `06_strong_personality` | arms_akimbo_turn | neutral | strong | 需要叉腰并带扭头过渡/个性动作时 | 安抚、道歉、普通解释；只需要稳定叉腰时优先用 `叉腰_100pct_reference` |
| `c4934e40-3e2e-4b9b-afea-5fd078e6853f` | `暧昧` | `06_strong_personality` | teasing_flirt | happy | strong | 明确轻佻、暧昧、亲密玩笑场景 | 专业答复、严肃问题、陌生用户 |
| `c4db4b31-b140-4df2-a6ef-291d99f41145` | `炫耀` | `06_strong_personality` | show_off | excited | strong | 成果展示、得意、自夸式玩笑 | 用户失败、求助、负面情绪 |
| `0d429a41-7110-4dda-b650-b8d423935f38` | `轻蔑说教` | `06_strong_personality` | disdain_lecture | neutral | strong | 明确需要强纠正、角色扮演式说教 | 大多数普通聊天、敏感/脆弱场景 |

## 5. 推荐命中示例

问候：

```json
{
  "text": "你好，我在。我们继续看这个问题。",
  "emotion": "happy",
  "action": "8f961238-fc13-4abb-ab9b-1e225cc8a19e",
  "motion_plan": null,
  "tts_pause_profile": "podcast"
}
```

技术解释：

```json
{
  "text": "这里的关键是把待机池和语义动作池分开，否则随机循环会命中强情绪动作。",
  "emotion": "neutral",
  "action": "411a73ef-3169-400a-9f32-d193d171e65c",
  "motion_plan": null,
  "tts_pause_profile": "podcast"
}
```

等待或分析中：

```json
{
  "text": "我先核对一下链路和本地状态，再给你结论。",
  "emotion": "thinking",
  "action": "439d9f31-a7c7-46d3-bd71-94fbfebffdae",
  "motion_plan": null,
  "tts_pause_profile": "podcast"
}
```

错误或失败：

```json
{
  "text": "当前连接遇到超时，我会保留上下文并走降级处理。",
  "emotion": "caring",
  "action": "a672d84b-92f3-41db-966e-c2d55967c3ad",
  "motion_plan": null,
  "tts_pause_profile": "podcast"
}
```

## 6. 存储和更新规则

分类目录约定：

```text
MMD/usage/vmd/{model_folder}[动作]/
  00_idle_loop/
  01_entry_fallback/
  02_greeting_social/
  03_thinking_waiting/
  04_answering_explain/
  05_soft_emotion/
  06_strong_personality/
```

更新动作时必须同步：

- VMD 文件放到正确分类目录。
- SQLite `asset_registry.favorite_relative_path` 使用完整分类路径。
- 同一用户、同一模型、同一分类、同一规范化动作名只保留一个 canonical `asset_id`；不要保留 `name (2).vmd` 这类编号副本，也不要把编号副本写进 Motion Inventory。
- 如果 `relative_path` 或 `source_relative_path` 也指向 `MMD_ROOT_DIR` 下的同一个文件，移动文件后要同步更新。
- 新增、删除、重命名或重新分类 VMD 后，同步更新本文的 Motion Inventory。
- 如果要把语义传给 OpenClaw，优先把本文作为 system/developer context 的 motion guide，而不是只传文件名列表。

## 7. 当前运行规则和限制

- 前端待机 autoplay 池优先只使用 `favorite_relative_path` 中的 `00_idle_loop/`；如果当前模型没有该分类，才回退到旧安全收藏动作池，再没有则 procedural idle。
- 聊天/Bridge 消息的 `motion_resolution.status=fallback_idle` 也会优先走当前模型 `00_idle_loop` 随机 VMD 兜底，不再因为 `source_action` 是 `idle`、`think`、`comfort` 等 procedural action 就直接打回默认 procedural idle。
- Chatbox 消息中 `think`/`thinking_tilt` 会先尝试当前模型 `03_thinking_waiting` 的受控语义 fallback，并优先 `思考_100pct_reference.vmd`；`akimbo`/`叉腰` 会先尝试当前模型 `06_strong_personality` 的受控语义 fallback，并优先 `叉腰_100pct_reference.vmd`。只有找不到可用参考 VMD 时才进入 `fallback_idle`。Bridge/realtime assistant 消息也复用同一 resolver，但要求本地绑定 session 已有 `selected_model_path`；没有选中模型时仍保持 `bridge_default_idle`。
- 人物点击动作优先从 `02_greeting_social`、`05_soft_emotion`、`06_strong_personality` 中随机选择；这些分类动作只要求有可播放 URL，允许 `motion_profile.companion_safe=false` 的完整动作进入候选池，播放时统一锁下半身并关闭 crossfade。候选会按分类和规范化 VMD 名去重，并在有其它候选时避开上一次点击动作；没有这些分类动作时，才回退到排除 `00_idle_loop` 和 `01_entry_fallback` 的安全收藏动作池。
- VMD 播放失败会立即回到待机恢复流程，不再等待 3 秒。
- 除上述思考/叉腰 fallback 外，后端 motion resolution 仍是精确 token 匹配，不读取本文中的 `intent`、`use_when`、`avoid_when`。这些字段是给 OpenClaw/agent 选择动作时使用的上下文。
