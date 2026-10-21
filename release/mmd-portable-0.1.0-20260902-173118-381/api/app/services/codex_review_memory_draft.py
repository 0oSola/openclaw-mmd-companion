from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, ValidationError, field_validator, model_validator


def _compact_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _normalize_optional_string_list(value: Any) -> Any:
    if value is None:
        return []
    if not isinstance(value, list):
        return value
    items: list[str] = []
    for item in value:
        text = _compact_text(item)
        if text:
            items.append(text)
    return items


class _MemoryDraftModel(BaseModel):
    model_config = ConfigDict(extra="allow")


class MemoryDraftStep(_MemoryDraftModel):
    order: StrictInt = Field(ge=1)
    instruction: StrictStr
    commands: list[StrictStr] = Field(default_factory=list)
    file_refs: list[StrictStr] = Field(default_factory=list)
    evidence_refs: list[StrictStr] = Field(default_factory=list)

    @field_validator("instruction")
    @classmethod
    def _validate_instruction(cls, value: str) -> str:
        text = _compact_text(value)
        if not text:
            raise ValueError("instruction is required")
        return text

    @field_validator("commands", "file_refs", "evidence_refs", mode="before")
    @classmethod
    def _normalize_lists(cls, value: Any) -> Any:
        return _normalize_optional_string_list(value)


class MemoryDraftVerification(_MemoryDraftModel):
    order: StrictInt = Field(ge=1)
    instruction: StrictStr
    commands: list[StrictStr] = Field(default_factory=list)
    expected_signal: str = ""
    evidence_refs: list[StrictStr] = Field(default_factory=list)

    @field_validator("instruction")
    @classmethod
    def _validate_instruction(cls, value: str) -> str:
        text = _compact_text(value)
        if not text:
            raise ValueError("instruction is required")
        return text

    @field_validator("expected_signal")
    @classmethod
    def _normalize_expected_signal(cls, value: str) -> str:
        return _compact_text(value)

    @field_validator("commands", "evidence_refs", mode="before")
    @classmethod
    def _normalize_lists(cls, value: Any) -> Any:
        return _normalize_optional_string_list(value)


class MemoryDraft(_MemoryDraftModel):
    knowledge_kind: StrictStr
    problem: StrictStr
    root_cause: str = ""
    when_to_use: StrictStr
    prerequisites: list[StrictStr] = Field(default_factory=list)
    steps: list[MemoryDraftStep] = Field(min_length=1)
    verification: list[MemoryDraftVerification] = Field(min_length=1)
    cautions: list[StrictStr] = Field(default_factory=list)
    source_summary: StrictStr
    open_questions: list[StrictStr] = Field(default_factory=list)
    confidence: float | None = Field(default=None, ge=0, le=1)

    @field_validator("knowledge_kind", "problem", "when_to_use", "source_summary")
    @classmethod
    def _validate_required_text(cls, value: str) -> str:
        text = _compact_text(value)
        if not text:
            raise ValueError("field is required")
        return text

    @field_validator("root_cause")
    @classmethod
    def _normalize_root_cause(cls, value: str) -> str:
        return _compact_text(value)

    @field_validator("prerequisites", "cautions", "open_questions", mode="before")
    @classmethod
    def _normalize_lists(cls, value: Any) -> Any:
        return _normalize_optional_string_list(value)

    @model_validator(mode="after")
    def _validate_ordering(self) -> "MemoryDraft":
        _validate_strict_orders(self.steps, field_name="steps")
        _validate_strict_orders(self.verification, field_name="verification")
        return self


def _validate_strict_orders(items: list[Any], *, field_name: str) -> None:
    if not items:
        raise ValueError(f"{field_name} must contain at least one item")
    orders = [int(item.order) for item in items]
    expected = list(range(1, len(items) + 1))
    if orders != expected:
        raise ValueError(f"{field_name} order values must start at 1 and increase by 1")


def normalize_memory_draft(value: Any) -> dict[str, Any]:
    try:
        draft = MemoryDraft.model_validate(value)
    except ValidationError as error:
        message = "; ".join(
            f"{'.'.join(str(part) for part in item['loc'])}: {item['msg']}" if item.get("loc") else item["msg"]
            for item in error.errors()
        )
        raise ValueError(f"invalid memory_draft: {message}") from error
    return draft.model_dump(mode="python", exclude_none=True)


def validate_review_decision_payload(
    *,
    action: str,
    edited_title: str | None,
    edited_summary: str | None,
    snooze_until: str | None,
    memory_draft: Any,
) -> dict[str, Any] | None:
    normalized_memory_draft = normalize_memory_draft(memory_draft) if memory_draft is not None else None
    if action in {"ignore", "snooze"} and normalized_memory_draft is not None:
        raise ValueError(f"{action} does not allow memory_draft")
    if action == "edit_accept" and not (
        _compact_text(edited_title) or _compact_text(edited_summary) or normalized_memory_draft is not None
    ):
        raise ValueError("edit_accept requires edited_title, edited_summary, or memory_draft")
    if action == "snooze" and not _compact_text(snooze_until):
        raise ValueError("snooze requires snooze_until")
    return normalized_memory_draft
