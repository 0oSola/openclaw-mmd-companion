from __future__ import annotations

import asyncio
from datetime import UTC, datetime
import hashlib
import json
from pathlib import Path
import re
from typing import Any

from app.models.domain_knowledge import DomainKnowledgeDraft
from app.services.codex_openclaw_review_sync import prepare_openclaw_evidence_pack
from app.services.codex_review_fact_extractor import build_codex_review_evidence_pack


KNOWLEDGE_SKILL_NAME = "codex-session-knowledge-extraction"
_REVIEWABLE_STATUSES = {"completed", "failed", "waiting_approval", "file_changed"}
_KNOWLEDGE_LIST_KEYS = (
    "concepts",
    "rule_concepts",
    "methodologies",
    "failure_taxonomy",
    "verification_rules",
    "timeline",
    "code_blocks",
)
_WIKI_DISPOSITIONS = {"no_wiki", "wiki_candidates"}
_WIKI_PUBLISH_STATUSES = {"ready", "needs_review", "needs_evidence"}
_CODE_PATH_PATTERN = re.compile(
    r"(?:\"([^\"]+\.(?:py|js|mjs|cjs|ts|tsx|ps1|sh|sql|md|jsonc?|ya?ml|toml))\"|"
    r"'([^']+\.(?:py|js|mjs|cjs|ts|tsx|ps1|sh|sql|md|jsonc?|ya?ml|toml))'|"
    r"([^\s\"'`<>]+\.(?:py|js|mjs|cjs|ts|tsx|ps1|sh|sql|md|jsonc?|ya?ml|toml)))",
    flags=re.IGNORECASE,
)
_CODE_COMMAND_KEYWORDS = (
    "test",
    "pytest",
    "validate",
    "check",
    "build",
    "lint",
    "render",
    "generate",
    "export",
    "migrate",
    "powershell",
    "python",
    "node",
)
_BACKTICK_PATTERN = re.compile(r"`([^`\n]{2,240})`")
_CODE_SYMBOL_PATTERN = re.compile(r"\b[A-Za-z_][A-Za-z0-9_]{2,}\b")
_KNOWLEDGE_KEYWORDS = (
    "method",
    "methodology",
    "rule",
    "concept",
    "definition",
    "domain",
    "knowledge",
    "lesson",
    "failure",
    "taxonomy",
    "invariant",
    "constraint",
    "validation",
    "verification",
    "acceptance",
    "gate",
    "architecture",
    "pipeline",
    "contract",
    "pattern",
    "anti-pattern",
    "root cause",
    "guard",
    "方法",
    "方法论",
    "规则",
    "概念",
    "定义",
    "领域",
    "知识",
    "经验",
    "复盘",
    "踩坑",
    "失败",
    "根因",
    "约束",
    "校验",
    "验证",
    "验收",
    "架构",
    "流程",
    "模式",
)


def _strip_json_fence(text: str) -> str:
    stripped = text.strip()
    match = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", stripped, flags=re.DOTALL | re.IGNORECASE)
    return match.group(1).strip() if match else stripped


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _compact_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _json_clone(value: dict[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(value, ensure_ascii=False))


def _bounded_text(value: Any, limit: int) -> str | None:
    text = _compact_text(value)
    if not text:
        return None
    return text if len(text) <= limit else text[:limit]


def _command_path(command: str) -> str | None:
    match = _CODE_PATH_PATTERN.search(command)
    if match is None:
        return None
    return next((value for value in match.groups() if value), None)


def _code_kind(path: str | None, command: str | None) -> str:
    text = f"{path or ''} {command or ''}".lower()
    if "test" in text or "pytest" in text:
        return "test"
    suffix = Path(path).suffix.lower() if path else ""
    if suffix in {".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".ps1", ".sh"}:
        return "script"
    if suffix in {".json", ".jsonc", ".yaml", ".yml", ".toml"}:
        return "config"
    if suffix == ".md":
        return "doc"
    return "command" if command else "source_file"


def _code_language(path: str | None) -> str | None:
    suffix = Path(path).suffix.lower() if path else ""
    return {
        ".py": "python",
        ".js": "javascript",
        ".mjs": "javascript",
        ".cjs": "javascript",
        ".ts": "typescript",
        ".tsx": "typescript",
        ".ps1": "powershell",
        ".sh": "bash",
        ".sql": "sql",
        ".json": "json",
        ".jsonc": "jsonc",
        ".yaml": "yaml",
        ".yml": "yaml",
        ".toml": "toml",
        ".md": "markdown",
    }.get(suffix)


def _code_ref_id(*, kind: str, path: str | None, command: str | None, symbol: str | None = None) -> str:
    source = json.dumps(
        {"kind": kind, "path": path, "command": command, "symbol": symbol},
        ensure_ascii=False,
        sort_keys=True,
    )
    return f"code-{hashlib.sha256(source.encode('utf-8')).hexdigest()[:12]}"


def _is_indexable_command(command: str, excerpt: str | None = None) -> bool:
    lowered = command.lower()
    return bool(_command_path(command)) or any(keyword in lowered for keyword in _CODE_COMMAND_KEYWORDS) or bool(excerpt)


def build_codex_knowledge_code_index(evidence_pack: dict[str, Any], *, limit: int = 12) -> list[dict[str, Any]]:
    facts = _as_dict(evidence_pack.get("facts"))
    refs: list[dict[str, Any]] = []
    seen: set[tuple[str | None, str | None, str | None]] = set()

    def add_ref(
        *,
        path: Any = None,
        command: Any = None,
        symbol: Any = None,
        purpose: Any = None,
        outcome: Any = None,
        exit_code: Any = None,
        excerpt: Any = None,
        evidence_ref: str,
    ) -> None:
        if len(refs) >= max(1, int(limit)):
            return
        path_text = _bounded_text(path, 300)
        command_text = _bounded_text(command, 400)
        symbol_text = _bounded_text(symbol, 160)
        excerpt_text = _bounded_text(excerpt, 240)
        if command_text and not _is_indexable_command(command_text, excerpt_text):
            return
        if not path_text and command_text:
            path_text = _command_path(command_text)
        if not path_text and not command_text and not symbol_text:
            return
        dedupe_key = (path_text, command_text, symbol_text)
        if dedupe_key in seen:
            return
        seen.add(dedupe_key)
        kind = "symbol" if symbol_text else _code_kind(path_text, command_text)
        normalized_outcome = _compact_text(outcome).lower() or None
        if normalized_outcome not in {"success", "failure", "pending", "unknown"}:
            normalized_outcome = None
        refs.append(
            {
                "ref_id": _code_ref_id(kind=kind, path=path_text, command=command_text, symbol=symbol_text),
                "kind": kind,
                "path": path_text,
                "symbol": symbol_text,
                "line_start": None,
                "line_end": None,
                "command": command_text,
                "language": _code_language(path_text),
                "snippet": excerpt_text,
                "purpose": _bounded_text(purpose, 160),
                "outcome": normalized_outcome,
                "exit_code": exit_code if isinstance(exit_code, int) else None,
                "evidence_refs": [evidence_ref],
            }
        )

    for index, path in enumerate(_as_list(facts.get("changed_files"))):
        add_ref(path=path, purpose="会话修改文件", outcome="success", evidence_ref=f"facts.changed_files[{index}]")

    for index, raw in enumerate(_as_list(facts.get("successful_checks"))):
        item = _as_dict(raw)
        add_ref(
            command=item.get("command"),
            purpose=item.get("check") or item.get("name") or "成功验证",
            outcome="success",
            exit_code=item.get("exit_code", 0),
            excerpt=item.get("excerpt") or item.get("expected_signal"),
            evidence_ref=f"facts.successful_checks[{index}]",
        )

    for index, raw in enumerate(_as_list(facts.get("failed_commands"))):
        item = _as_dict(raw)
        add_ref(
            command=item.get("command"),
            purpose="失败命令证据",
            outcome="failure",
            exit_code=item.get("exit_code"),
            excerpt=item.get("excerpt"),
            evidence_ref=f"facts.failed_commands[{index}]",
        )

    narrative_refs: list[tuple[str, str]] = []
    session = _as_dict(evidence_pack.get("session"))
    for key in ("last_summary", "first_goal"):
        text = _compact_text(session.get(key))
        if text:
            narrative_refs.append((text, f"session.{key}"))
    for key in ("last_output_excerpt",):
        text = _compact_text(facts.get(key))
        if text:
            narrative_refs.append((text, f"facts.{key}"))
    for key in ("assistant_messages", "work_items"):
        all_items = _as_list(facts.get(key))
        start_index = max(0, len(all_items) - 8)
        for index, raw in enumerate(all_items[start_index:], start=start_index):
            item = _as_dict(raw)
            text = _compact_text(item.get("text") if item else raw)
            if text:
                narrative_refs.append((text, f"facts.{key}[{index}]"))

    narrative_added = 0
    for text, evidence_ref in narrative_refs:
        if narrative_added >= 6 or len(refs) >= max(1, int(limit)):
            break
        for match in _CODE_PATH_PATTERN.finditer(text):
            path = next((value for value in match.groups() if value), None)
            before_count = len(refs)
            add_ref(path=path, purpose="会话结论中的文件引用", evidence_ref=evidence_ref)
            narrative_added += len(refs) - before_count
            if narrative_added >= 6 or len(refs) >= max(1, int(limit)):
                break
        if narrative_added >= 6 or len(refs) >= max(1, int(limit)):
            continue
        for token in _BACKTICK_PATTERN.findall(text):
            if _command_path(token):
                continue
            if " " in token and any(keyword in token.lower() for keyword in _CODE_COMMAND_KEYWORDS):
                before_count = len(refs)
                add_ref(command=token, purpose="会话结论中的命令引用", evidence_ref=evidence_ref)
                narrative_added += len(refs) - before_count
            else:
                for symbol in _CODE_SYMBOL_PATTERN.findall(token):
                    if "_" not in symbol:
                        continue
                    before_count = len(refs)
                    add_ref(symbol=symbol, purpose="会话结论中的代码标识", evidence_ref=evidence_ref)
                    narrative_added += len(refs) - before_count
                    if narrative_added >= 6 or len(refs) >= max(1, int(limit)):
                        break
            if narrative_added >= 6 or len(refs) >= max(1, int(limit)):
                break

    methods = [(index, _as_dict(item)) for index, item in enumerate(_as_list(facts.get("methods")))]
    methods.sort(
        key=lambda indexed_item: (
            0
            if _compact_text(indexed_item[1].get("outcome")).lower() in {"success", "failure"}
            else 1,
            0 if _is_indexable_command(_compact_text(indexed_item[1].get("command"))) else 1,
        )
    )
    for index, item in methods:
        add_ref(
            command=item.get("command"),
            symbol=item.get("name") if not item.get("command") else None,
            purpose=item.get("check") or item.get("name") or item.get("kind"),
            outcome=item.get("outcome"),
            exit_code=item.get("exit_code"),
            excerpt=item.get("excerpt"),
            evidence_ref=f"facts.methods[{index}]",
        )

    return refs


def _keyword_text(evidence_pack: dict[str, Any]) -> str:
    session = _as_dict(evidence_pack.get("session"))
    facts = _as_dict(evidence_pack.get("facts"))
    pieces: list[str] = [
        _compact_text(session.get("first_goal")),
        _compact_text(session.get("last_summary")),
        _compact_text(facts.get("last_error")),
        _compact_text(facts.get("last_output_excerpt")),
    ]
    for key in ("user_messages", "assistant_messages"):
        pieces.extend(_compact_text(item) for item in _as_list(facts.get(key)))
    for key in ("work_items", "methods", "failed_commands", "successful_checks", "errors"):
        for raw in _as_list(facts.get(key)):
            record = _as_dict(raw)
            pieces.extend(_compact_text(value) for value in record.values() if isinstance(value, str))
    return "\n".join(piece for piece in pieces if piece).lower()


def score_codex_knowledge_candidate(evidence_pack: dict[str, Any], *, min_signal_score: int = 5) -> dict[str, Any]:
    session = _as_dict(evidence_pack.get("session"))
    facts = _as_dict(evidence_pack.get("facts"))
    status = _compact_text(session.get("status"))
    reviewable_status = status in _REVIEWABLE_STATUSES
    score = 0
    reasons: list[str] = []

    if reviewable_status:
        score += 2
        reasons.append("reviewable_status")
    else:
        reasons.append("non_terminal_status")

    work_item_count = len(_as_list(facts.get("work_items")))
    method_count = len(_as_list(facts.get("methods")))
    if work_item_count >= 3:
        score += 2
        reasons.append("work_items")
    if method_count >= 2:
        score += 2
        reasons.append("methods")
    if _as_list(facts.get("changed_files")):
        score += 1
        reasons.append("changed_files")
    if _as_list(facts.get("successful_checks")):
        score += 1
        reasons.append("successful_checks")
    if _as_list(facts.get("failed_commands")) or _as_list(facts.get("errors")):
        score += 2
        reasons.append("failures")
    if _compact_text(session.get("last_summary")):
        score += 1
        reasons.append("summary")

    keyword_text = _keyword_text(evidence_pack)
    matched_keywords = []
    for keyword in _KNOWLEDGE_KEYWORDS:
        if keyword.lower() in keyword_text and keyword not in matched_keywords:
            matched_keywords.append(keyword)
    if matched_keywords:
        score += min(3, len(matched_keywords))
        reasons.append("knowledge_keywords")

    return {
        "reviewable_status": reviewable_status,
        "knowledge_candidate": reviewable_status and score >= int(min_signal_score),
        "signal_score": score,
        "min_signal_score": int(min_signal_score),
        "matched_keywords": matched_keywords[:20],
        "reasons": reasons,
        "work_item_count": work_item_count,
        "method_count": method_count,
    }


def build_codex_knowledge_evidence_pack(
    store: Any,
    pet_session_id: str,
    *,
    min_signal_score: int = 5,
    prompt_version: str = "codex-domain-knowledge-v3",
) -> dict[str, Any]:
    review_pack = build_codex_review_evidence_pack(store, pet_session_id)
    evidence_pack = _json_clone(review_pack)
    evidence_pack["kind"] = "codex_knowledge_evidence_pack"
    evidence_pack["prompt_version"] = prompt_version
    evidence_pack["skill"] = {
        "name": KNOWLEDGE_SKILL_NAME,
        "prompt_version": prompt_version,
    }
    evidence_pack["reviewability"] = score_codex_knowledge_candidate(
        evidence_pack,
        min_signal_score=min_signal_score,
    )
    evidence_pack["code_index"] = build_codex_knowledge_code_index(evidence_pack)
    return evidence_pack


def _source_hash(evidence_pack: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(evidence_pack, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def enqueue_codex_knowledge_extraction(
    store: Any,
    pet_session_id: str,
    *,
    min_signal_score: int = 5,
    prompt_version: str = "codex-domain-knowledge-v3",
    force: bool = False,
) -> dict[str, Any]:
    evidence_pack = build_codex_knowledge_evidence_pack(
        store,
        pet_session_id,
        min_signal_score=min_signal_score,
        prompt_version=prompt_version,
    )
    reviewability = _as_dict(evidence_pack.get("reviewability"))
    if force:
        reviewability["forced"] = True
        reviewability["knowledge_candidate"] = True
        evidence_pack["reviewability"] = reviewability
    if not reviewability.get("knowledge_candidate"):
        return {
            "queued": False,
            "reason": "not_knowledge_candidate",
            "pet_session_id": pet_session_id,
            "source_hash": _source_hash(evidence_pack),
            "reviewability": reviewability,
        }

    source_hash = _source_hash(evidence_pack)
    session = _as_dict(evidence_pack.get("session"))
    job = store.enqueue_codex_knowledge_extraction(
        pet_session_id=pet_session_id,
        codex_session_id=str(session.get("codex_session_id") or ""),
        source_hash=source_hash,
        payload=evidence_pack,
        openclaw_session_key=f"codex-knowledge:{pet_session_id}",
        requeue_failed=force,
    )
    return {
        "queued": job.get("status") == "pending",
        "reason": "queued",
        "pet_session_id": pet_session_id,
        "source_hash": source_hash,
        "reviewability": reviewability,
        "job": job,
    }


def parse_openclaw_knowledge_response(text: str) -> dict[str, Any]:
    try:
        payload = json.loads(_strip_json_fence(text))
    except json.JSONDecodeError as error:
        raise ValueError(f"OpenClaw knowledge response was not valid JSON: {error.msg}") from error
    if not isinstance(payload, dict):
        raise ValueError("OpenClaw knowledge response must be a JSON object")
    schema_version = int(payload.get("schema_version") or 0)
    if schema_version == 2:
        disposition = _compact_text(payload.get("disposition"))
        if disposition not in {"no_wiki", "domain_knowledge_candidates"}:
            raise ValueError(
                "OpenClaw Domain Knowledge response disposition must be no_wiki or domain_knowledge_candidates"
            )
        candidates = [item for item in _as_list(payload.get("candidates")) if isinstance(item, dict)]
        rejected_items = [item for item in _as_list(payload.get("rejected_items")) if isinstance(item, dict)]
        if len(candidates) > 3:
            raise ValueError("OpenClaw Domain Knowledge response must contain at most three candidates")
        if disposition == "no_wiki" and candidates:
            raise ValueError("OpenClaw Domain Knowledge no_wiki response must not contain candidates")
        if disposition == "domain_knowledge_candidates" and not candidates:
            raise ValueError("OpenClaw domain_knowledge_candidates response requires at least one candidate")
        normalized_candidates: list[dict[str, Any]] = []
        for raw_candidate in candidates:
            candidate_id = _compact_text(raw_candidate.get("candidate_id"))
            if not candidate_id:
                raise ValueError("OpenClaw Domain Knowledge candidate_id is required")
            if _compact_text(raw_candidate.get("source_kind")) != "session_incremental":
                raise ValueError("OpenClaw Domain Knowledge source_kind must be session_incremental")
            draft = DomainKnowledgeDraft.model_validate(_as_dict(raw_candidate.get("draft"))).model_dump(mode="json")
            evidence_refs = [
                _compact_text(item) for item in _as_list(raw_candidate.get("evidence_refs")) if _compact_text(item)
            ]
            if set(evidence_refs) != set(draft.get("evidence_refs") or []):
                raise ValueError("OpenClaw Domain Knowledge candidate evidence_refs must match draft evidence_refs")
            confidence = raw_candidate.get("confidence")
            if not isinstance(confidence, (int, float)) or isinstance(confidence, bool) or not 0 <= confidence <= 1:
                raise ValueError("OpenClaw Domain Knowledge candidate confidence must be between 0 and 1")
            normalized_candidates.append(
                {
                    "candidate_id": candidate_id,
                    "source_kind": "session_incremental",
                    "draft": draft,
                    "evidence_refs": evidence_refs,
                    "confidence": float(confidence),
                }
            )
        assessment = _as_dict(payload.get("assessment"))
        assessment_count = assessment.get("candidate_count")
        if assessment_count is not None and int(assessment_count) != len(normalized_candidates):
            raise ValueError("OpenClaw Domain Knowledge assessment candidate_count does not match candidates")
        return {
            "schema_version": 2,
            "disposition": disposition,
            "assessment": assessment,
            "candidates": normalized_candidates,
            "rejected_items": rejected_items,
        }
    if schema_version != 1:
        raise ValueError("OpenClaw knowledge response schema_version must be 1 or 2")

    normalized = dict(payload)
    normalized["domain"] = _as_dict(normalized.get("domain"))
    normalized["reusable_summary"] = _as_dict(normalized.get("reusable_summary"))
    for key in _KNOWLEDGE_LIST_KEYS:
        normalized[key] = [item for item in _as_list(normalized.get(key)) if isinstance(item, dict)]
    if any(key in normalized for key in ("disposition", "wiki_candidates", "rejected_items", "code_index")):
        disposition = _compact_text(normalized.get("disposition"))
        if disposition not in _WIKI_DISPOSITIONS:
            raise ValueError("OpenClaw knowledge response disposition must be no_wiki or wiki_candidates")
        normalized["assessment"] = _as_dict(normalized.get("assessment"))
        normalized["wiki_candidates"] = [
            item for item in _as_list(normalized.get("wiki_candidates")) if isinstance(item, dict)
        ]
        normalized["rejected_items"] = [
            item for item in _as_list(normalized.get("rejected_items")) if isinstance(item, dict)
        ]
        normalized["code_index"] = [
            item for item in _as_list(normalized.get("code_index")) if isinstance(item, dict)
        ]
        if len(normalized["wiki_candidates"]) > 3:
            raise ValueError("OpenClaw knowledge response must contain at most three wiki_candidates")
        if len(normalized["code_index"]) > 12:
            raise ValueError("OpenClaw knowledge response must contain at most twelve code_index items")
        if disposition == "no_wiki" and normalized["wiki_candidates"]:
            raise ValueError("OpenClaw no_wiki response must not contain wiki_candidates")
        if disposition == "wiki_candidates" and not normalized["wiki_candidates"]:
            raise ValueError("OpenClaw wiki_candidates response must contain at least one candidate")
        assessment_count = normalized["assessment"].get("candidate_count")
        if assessment_count is not None and int(assessment_count) != len(normalized["wiki_candidates"]):
            raise ValueError("OpenClaw knowledge assessment candidate_count does not match wiki_candidates")
        known_code_refs = {
            _compact_text(item.get("ref_id")) for item in normalized["code_index"] if _compact_text(item.get("ref_id"))
        }
        for candidate in normalized["wiki_candidates"]:
            publish_status = _compact_text(candidate.get("publish_status"))
            if publish_status not in _WIKI_PUBLISH_STATUSES:
                raise ValueError("OpenClaw knowledge candidate publish_status is invalid")
            memory_draft = _as_dict(candidate.get("memory_draft"))
            if not memory_draft:
                raise ValueError("OpenClaw knowledge candidate memory_draft must be an object")
            for key in ("title", "problem", "when_to_use", "source_summary"):
                if not _compact_text(memory_draft.get(key)):
                    raise ValueError(f"OpenClaw knowledge candidate memory_draft missing {key}")
            if not _as_list(memory_draft.get("verification")):
                raise ValueError("OpenClaw knowledge candidate memory_draft verification must not be empty")
            if not _as_list(memory_draft.get("steps")) and not _compact_text(
                memory_draft.get("decision_or_rule")
            ):
                raise ValueError(
                    "OpenClaw knowledge candidate requires steps or a concrete decision_or_rule"
                )
            missing_code_refs = {
                _compact_text(ref) for ref in _as_list(candidate.get("code_refs")) if _compact_text(ref)
            } - known_code_refs
            if missing_code_refs:
                raise ValueError("OpenClaw knowledge candidate references unknown code_refs")
            quality_gate = _as_dict(candidate.get("quality_gate"))
            if publish_status == "ready" and quality_gate.get("verified") is not True:
                raise ValueError("OpenClaw ready knowledge candidate must be verified")
    normalized["schema_version"] = 1
    return normalized


def reconcile_openclaw_knowledge_code_index(
    payload: dict[str, Any], evidence_pack: dict[str, Any]
) -> dict[str, Any]:
    if int(payload.get("schema_version") or 0) == 2:
        repository_evidence = _as_dict(evidence_pack.get("repository_evidence"))
        input_refs = _as_list(repository_evidence.get("evidence_refs")) or _as_list(
            evidence_pack.get("evidence_index")
        )
        known_ref_ids = {
            _compact_text(item.get("ref_id"))
            for item in input_refs
            if isinstance(item, dict) and _compact_text(item.get("ref_id"))
        }
        cited_ref_ids = {
            _compact_text(ref_id)
            for candidate in _as_list(payload.get("candidates"))
            if isinstance(candidate, dict)
            for ref_id in _as_list(candidate.get("evidence_refs"))
            if _compact_text(ref_id)
        }
        if cited_ref_ids - known_ref_ids:
            raise ValueError("OpenClaw Domain Knowledge response references unknown Evidence Reference IDs")
        return payload

    source_refs = {
        _compact_text(item.get("ref_id")): item
        for item in _as_list(evidence_pack.get("code_index"))
        if isinstance(item, dict) and _compact_text(item.get("ref_id"))
    }
    output_refs = _as_list(payload.get("code_index"))
    if not output_refs:
        return payload

    reconciled: list[dict[str, Any]] = []
    for raw in output_refs:
        item = _as_dict(raw)
        ref_id = _compact_text(item.get("ref_id"))
        source = source_refs.get(ref_id)
        if source is None:
            raise ValueError("OpenClaw knowledge response code_index contains unknown input ref_id")
        canonical = _json_clone(source)
        if _compact_text(item.get("purpose")):
            canonical["purpose"] = _compact_text(item.get("purpose"))
        reconciled.append(canonical)

    normalized = dict(payload)
    normalized["code_index"] = reconciled
    return normalized


def save_openclaw_knowledge_payload(store: Any, outbox: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    session = _as_dict(_as_dict(outbox.get("payload")).get("session"))
    return store.upsert_codex_session_knowledge(
        workspace_id=session.get("workspace_id"),
        pet_session_id=outbox["pet_session_id"],
        codex_session_id=outbox["codex_session_id"],
        source_hash=outbox["source_hash"],
        extractor_version=str(
            _as_dict(outbox.get("payload")).get("prompt_version") or "codex-domain-knowledge-v3"
        ),
        payload=payload,
    )


def load_codex_knowledge_skill(skill_path: str | Path | None) -> str:
    if not skill_path:
        return ""
    path = Path(skill_path)
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def _dump_codex_knowledge_debug_file(data_dir: str | Path, outbox_id: str, suffix: str, payload: Any) -> None:
    root = Path(data_dir) / "openclaw" / "codex-knowledge"
    root.mkdir(parents=True, exist_ok=True)
    path = root / f"{outbox_id}-{suffix}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


async def process_next_codex_knowledge_extraction(app: Any) -> bool:
    store = app.state.trace_store
    now = datetime.now(UTC).isoformat()
    outbox = store.claim_next_codex_knowledge_extraction(now_iso=now)
    if outbox is None:
        return False

    settings = app.state.settings
    try:
        evidence_pack = prepare_openclaw_evidence_pack(
            outbox["payload"],
            getattr(settings, "codex_knowledge_max_payload_chars", None),
        )
        if getattr(settings, "codex_knowledge_dump_debug_files", False):
            _dump_codex_knowledge_debug_file(settings.data_dir, outbox["id"], "request", evidence_pack)
        response_text = await app.state.openclaw_client.generate_codex_knowledge(
            user_id=(settings.admin_user_ids[0] if settings.admin_user_ids else "system"),
            session_key=outbox["openclaw_session_key"],
            evidence_pack=evidence_pack,
            skill_instructions=load_codex_knowledge_skill(getattr(settings, "codex_knowledge_skill_path", None)),
            prompt_version=getattr(settings, "codex_knowledge_prompt_version", "codex-domain-knowledge-v3"),
            agent_id=settings.codex_knowledge_agent_id,
            channel=settings.codex_knowledge_channel,
            timeout_seconds=getattr(settings, "codex_knowledge_timeout_seconds", 300),
        )
        payload = reconcile_openclaw_knowledge_code_index(
            parse_openclaw_knowledge_response(response_text),
            evidence_pack,
        )
        if getattr(settings, "codex_knowledge_dump_debug_files", False):
            _dump_codex_knowledge_debug_file(settings.data_dir, outbox["id"], "response", payload)
        save_openclaw_knowledge_payload(store, outbox, payload)
        store.mark_codex_knowledge_extraction_succeeded(outbox["id"])
        return True
    except Exception as error:
        error_text = str(error).strip() or type(error).__name__
        store.mark_codex_knowledge_extraction_failed(outbox["id"], last_error=error_text)
        return False


async def run_codex_knowledge_extraction_worker(app: Any) -> None:
    settings = app.state.settings
    interval = settings.codex_knowledge_sync_interval_seconds
    while True:
        try:
            await process_next_codex_knowledge_extraction(app)
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            raise
        except Exception:
            await asyncio.sleep(interval)
