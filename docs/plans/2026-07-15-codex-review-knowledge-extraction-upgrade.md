# Codex Review 知识提炼改造方案

> 状态：Superseded（不再执行）
>
> 替代设计：`docs/superpowers/specs/2026-07-15-codex-review-domain-knowledge-separation-design.md`
>
> 废弃原因：本方案试图通过增强 v1 Review prompt，把工作总结、决策、待办和问题
> 转换成长期知识，混淆了 Review Candidate 与 Domain Knowledge Candidate。v1 现在
> 只承担日常复盘；长期知识必须经过独立的 v2 Concept Delta、固定版本仓库证据、
> Deterministic Gate、OpenClaw 双重审核和 exact publication 流程。
>
> 日期：2026-07-15
> 作者：优菈（OpenClaw 侧） + sola 确认
> 涉及文件：`api/app/services/openclaw_client.py`（review prompt）、`codex_openclaw_review_sync.py`（item 持久化）、`openclaw_control_plane.py`（snapshot 聚合）

---

## 一、问题诊断

### 现状

`generate_codex_review` 的 prompt 要求 LLM 返回 6 类结构化 JSON：
`work_summary` / `pitfalls` / `decisions` / `followups` / `blockers` / `management`

### 症状

07-15 修正版 snapshot 的 17 条 learning candidates 中：
- **3 条 work_summary**：纯复述会话过程，无方法论提炼
- **5 条 decisions**：记录"做了什么决定"，但无 rationale / alternatives / when_to_reuse
- **5 条 followups**：是待办事项，不是知识
- **3 条 pitfalls**：描述问题现象，root_cause / fix / prevention 全是 null 或空
- **1 条 blocker**：空壳，无实质内容

### 根因

1. **prompt 的 JSON shape 缺少知识提炼字段**——没有 `rationale`、`alternatives`、`when_to_reuse`、`reusable_patterns`、`lessons` 等字段
2. **pitfalls 的 root_cause / fix / prevention 允许 null**——模型偷懒直接填 null
3. **followups 被当作知识**——待办事项 ≠ 可迁移知识
4. **work_summary 只要求复述**——没有要求从会话中提炼方法论
5. **没有"拒绝空内容"的约束**——模型可以返回 title="Blocker" summary="" 的空壳

---

## 二、改造目标

让每次 Codex 会话 review 的输出从「**复述发生了什么**」升级为「**提炼可复用的领域知识和解决方案**」。

具体来说，用户确认 review item 后，应该能回答：
- 这个决策为什么是对的？什么场景可以复用？
- 这个坑的根因是什么？下次怎么避免？
- 这套方法论的通用步骤是什么？
- 哪些做法是 anti-pattern？

---

## 三、改造方案

### 3.1 Prompt 改造（`openclaw_client.py` `generate_codex_review`）

#### 3.1.1 新增系统级要求

在现有 prompt 开头追加：

```
你是一个 Codex 会话知识提炼器。你的核心任务不是复述会话过程，而是从会话中提炼可复用的领域知识、方法论和解决方案。

关键原则：
- 每条输出都必须回答"下次遇到类似情况怎么办"，而不是"这次发生了什么"
- 如果证据不足以提炼知识，不要返回空壳——要么标注"证据不足"并说明缺什么，要么不返回该条
- 宁可少返回有价值的条目，也不要用复述填充数量
```

#### 3.1.2 JSON Shape 升级

```json
{
  "schema_version": 2,
  "work_summary": {
    "title": "string",
    "summary": "string | null",
    "goal": "string | null",
    "work_done": ["string"],
    "result": "string | null",
    "lessons": ["string"],
    "evidence_refs": ["string"],
    "confidence": "number | null"
  },
  "pitfalls": [{
    "title": "string",
    "summary": "string | null",
    "symptom": "string（现象描述，必填，不得为 null）",
    "root_cause": "string（根因分析，必填，不得为 null；证据不足时填"证据不足：[说明缺什么]"）",
    "fix": "string（解决方案，必填，不得为 null）",
    "prevention": "string（预防措施，必填，不得为 null）",
    "when_to_apply": "string（什么情况下这个经验适用）",
    "severity": "string | null",
    "tags": ["string"],
    "evidence_refs": ["string"],
    "confidence": "number | null"
  }],
  "decisions": [{
    "title": "string",
    "summary": "string | null",
    "decision": "string（做了什么决定）",
    "rationale": "string（为什么选这个方案，必填，不得为 null）",
    "alternatives": "string（考虑过什么替代方案，无则填"无明确替代方案"）",
    "when_to_reuse": "string（什么场景可以复用这个决策模式，必填）",
    "result": "string | null",
    "tags": ["string"],
    "evidence_refs": ["string"],
    "confidence": "number | null"
  }],
  "followups": [{
    "title": "string",
    "summary": "string | null",
    "description": "string | null",
    "why_it_matters": "string（为什么这个后续事项重要，必填）",
    "severity": "string | null",
    "tags": ["string"],
    "evidence_refs": ["string"],
    "confidence": "number | null"
  }],
  "blockers": [{
    "title": "string",
    "summary": "string（不得为空字符串；如无实质阻塞则不返回此条）",
    "description": "string | null",
    "what_is_blocked": "string（具体什么被阻塞了，必填）",
    "unblock_condition": "string（解除阻塞需要什么条件，必填）",
    "severity": "string | null",
    "tags": ["string"],
    "evidence_refs": ["string"],
    "confidence": "number | null"
  }],
  "reusable_patterns": [{
    "title": "string（方法论/模式的名称）",
    "pattern": "string（通用模式描述，必填）",
    "when_to_apply": "string（触发条件，必填）",
    "how_to_apply": "string（具体步骤，必填）",
    "evidence_refs": ["string"],
    "confidence": "number | null"
  }],
  "management": {
    "importance": "string | null",
    "review_status": "string | null",
    "needs_human_review": "boolean",
    "suggested_next_action": "string | null",
    "knowledge_density": "string（low / medium / high，标注本次会话的知识密度）",
    "tags": ["string"]
  }
}
```

#### 3.1.3 新增硬约束

在 prompt 末尾追加：

```
硬约束：
1. 所有 user-facing 文本必须是简体中文。
2. pitfalls 的 root_cause / fix / prevention 不得为 null 或空字符串。证据不足时填 "证据不足：[说明缺少什么证据]"。
3. decisions 的 rationale / when_to_reuse 不得为 null 或空字符串。
4. blockers 不得返回空壳（title="Blocker" summary=""）。如无实质阻塞，不要返回 blockers。
5. followups 必须包含 why_it_matters，不得为 null。
6. work_summary 的 lessons 至少包含 1 条从本次会话提炼的可迁移经验。如确实无可提炼内容，填 "无可提炼经验" 并在 management.knowledge_density 标为 low。
7. reusable_patterns 是可选的——仅当会话中确实产生了可复用的方法论时才返回。不要为了填充而编造。
8. 不要返回 title 为泛型词（如 "Blocker"、"Pitfall"、"Decision"）且 summary 为空的条目。
9. schema_version 必须为 2。
```

---

### 3.2 Item 持久化改造（`codex_openclaw_review_sync.py`）

#### `_review_items_from_payload` 新增 `reusable_patterns` 类型

```python
def _review_items_from_payload(payload: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    items: list[tuple[str, dict[str, Any]]] = []
    work_summary = _as_dict(payload.get("work_summary"))
    if work_summary:
        items.append(("work_summary", work_summary))
    for item in _as_list(payload.get("pitfalls")):
        if isinstance(item, dict):
            items.append(("pitfall", item))
    for item in _as_list(payload.get("decisions")):
        if isinstance(item, dict):
            items.append(("decision", item))
    for item in _as_list(payload.get("followups")):
        if isinstance(item, dict):
            items.append(("followup", item))
    for item in _as_list(payload.get("blockers")):
        if isinstance(item, dict):
            items.append(("blocker", item))
    # 新增
    for item in _as_list(payload.get("reusable_patterns")):
        if isinstance(item, dict):
            items.append(("reusable_pattern", item))
    return items
```

#### `_validate_openclaw_review_shape` 新增 `reusable_patterns` 键

```python
required = {
    "work_summary": dict,
    "pitfalls": list,
    "decisions": list,
    "followups": list,
    "blockers": list,
    "management": dict,
    "reusable_patterns": list,  # 新增
}
```

#### `_normalize_openclaw_review_payload` 新增 `reusable_patterns` 处理

```python
if "reusable_patterns" in normalized:
    normalized["reusable_patterns"] = _normalize_review_items(
        normalized.get("reusable_patterns"), title="Reusable Pattern"
    )
```

---

### 3.3 Snapshot 聚合改造（`openclaw_control_plane.py`）

#### `_learning_candidate_item` 新增字段映射

```python
def _learning_candidate_item(item: dict[str, Any]) -> dict[str, Any]:
    details = _as_dict(item.get("details"))
    evidence_refs = _string_list(details.get("evidence_refs"))
    summary = _compact_text(item.get("summary"))
    confidence = details.get("confidence")
    if not isinstance(confidence, (int, float)):
        confidence = None
    return {
        "id": str(item.get("id") or ""),
        "pet_session_id": str(item.get("pet_session_id") or ""),
        "codex_session_id": str(item.get("codex_session_id") or ""),
        "candidate_type": str(item.get("item_type") or ""),
        "title": _compact_text(item.get("title"), limit=240),
        "summary": summary,
        "problem": _first_detail_text(details, ("problem", "symptom", "description"), fallback=summary),
        "root_cause": _first_detail_text(details, ("root_cause", "cause")),
        "fix": _first_detail_text(details, ("fix", "result", "decision")),
        "prevention": _first_detail_text(details, ("prevention", "guardrail")),
        "lesson": _first_detail_text(details, ("lesson",), fallback=summary),
        # 新增
        "rationale": _first_detail_text(details, ("rationale", "why")),
        "when_to_reuse": _first_detail_text(details, ("when_to_reuse", "when_to_apply")),
        "alternatives": _first_detail_text(details, ("alternatives",)),
        "how_to_apply": _first_detail_text(details, ("how_to_apply",)),
        "what_is_blocked": _first_detail_text(details, ("what_is_blocked",)),
        "unblock_condition": _first_detail_text(details, ("unblock_condition",)),
        "why_it_matters": _first_detail_text(details, ("why_it_matters",)),
        "lessons": _string_list(details.get("lessons")),
        "knowledge_density": _first_detail_text(details, ("knowledge_density",)),
        "severity": item.get("severity"),
        "tags": _string_list(item.get("tags")),
        "confidence": confidence,
        "priority_score": int(item.get("priority_score") or 0),
        "evidence_refs": evidence_refs,
        "bounded_evidence": _bounded_evidence(details, evidence_refs),
        "created_at": item.get("created_at"),
        "updated_at": item.get("updated_at"),
    }
```

#### `candidate_types` 新增 `reusable_pattern`

```python
candidate_types = {"blocker", "pitfall", "decision", "followup", "work_summary", "reusable_pattern"}
```

#### `_has_learning_candidate_content` 新增字段检查

```python
def _has_learning_candidate_content(candidate: dict[str, Any]) -> bool:
    for key in ("summary", "problem", "root_cause", "fix", "prevention", "lesson",
                "rationale", "when_to_reuse", "how_to_apply", "what_is_blocked",
                "unblock_condition", "why_it_matters"):
        if _compact_text(candidate.get(key)):
            return True
    if candidate.get("lessons"):
        return True
    return bool(candidate.get("evidence_refs") or candidate.get("bounded_evidence"))
```

---

### 3.4 OpenClaw 控制面消费侧（`codex_daily_review.py`）

#### `normalize_snapshot` 兼容 schema_version 2

```python
if schema_version not in (1, 2):
    raise ReviewError(f'unsupported snapshot schema_version: {schema_version!r}')
```

#### `format_opening` 展示新字段

在呈现给用户的消息中，针对不同 candidate_type 显示不同的关键字段：
- `pitfall`：显示 root_cause + fix + prevention
- `decision`：显示 rationale + when_to_reuse
- `reusable_pattern`：显示 when_to_apply + how_to_apply
- `blocker`：显示 what_is_blocked + unblock_condition
- `followup`：显示 why_it_matters

---

## 四、迁移与兼容

| 方面 | 策略 |
|---|---|
| schema_version | 2 = 新版 prompt 输出；1 = 旧版，控制面仍可消费 |
| 旧 codex_review_items | 不迁移，新字段在 details JSON 里按需读取，缺失则返回空字符串 |
| _learning_candidate_item | 用 `_first_detail_text` fallback 链兼容旧数据 |
| prompt 回退 | 如需回退，把 schema_version 改回 1 + 移除 reusable_patterns 即可 |

---

## 五、验证清单

- [ ] prompt 改造后，用 07-15 的 evidence_pack 重新生成一次 review，检查输出
- [ ] pitfalls 的 root_cause / fix / prevention 不再为 null
- [ ] decisions 包含 rationale / when_to_reuse
- [ ] 无空壳 blocker（title="Blocker" summary=""）
- [ ] work_summary 包含 lessons
- [ ] reusable_patterns 仅在有实质方法论时返回
- [ ] FastAPI 侧 `_review_items_from_payload` 正确处理 reusable_patterns
- [ ] OpenClaw 控制面侧 normalize_snapshot 兼容 schema_version=2
- [ ] 呈现给用户的消息包含新字段（rationale / when_to_reuse / how_to_apply 等）
- [ ] 旧 schema_version=1 的 snapshot 仍可正常消费

---

## 六、改动文件清单

| 文件 | 改动 |
|---|---|
| `api/app/services/openclaw_client.py` | `generate_codex_review` prompt 全面改造，schema_version=2 |
| `api/app/services/codex_openclaw_review_sync.py` | `_review_items_from_payload` + `_validate_openclaw_review_shape` + `_normalize_openclaw_review_payload` 新增 reusable_patterns |
| `api/app/services/openclaw_control_plane.py` | `_learning_candidate_item` 新增字段映射；`candidate_types` 新增 reusable_pattern；`_has_learning_candidate_content` 新增字段检查 |
| `scripts/codex_daily_review.py`（OpenClaw 侧） | `normalize_snapshot` 兼容 schema_version=2；`format_opening` 展示新字段 |
