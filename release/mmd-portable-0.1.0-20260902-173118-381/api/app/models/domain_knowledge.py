from __future__ import annotations

from datetime import datetime
from pathlib import PurePosixPath, PureWindowsPath
import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


Sha256 = str
ConceptChangeKind = Literal["introduce", "clarify", "rename", "deprecate", "supersede"]
EvidenceRole = Literal["contract", "implementation", "test", "validation", "git", "session_provenance"]
EvidenceAuthority = Literal["authoritative", "supporting", "provenance"]
TopicKind = Literal[
    "concept",
    "entity",
    "relationship",
    "rule",
    "workflow",
    "contract",
    "gate",
    "policy",
    "decision",
    "failure_classification",
]


class DomainKnowledgeModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class IntroducedFor(DomainKnowledgeModel):
    problem: str = Field(min_length=1, max_length=4000)
    context: str = Field(min_length=1, max_length=4000)
    failure_before_introduction: str = Field(min_length=1, max_length=4000)


class ConceptDefinition(DomainKnowledgeModel):
    term: str = Field(min_length=1, max_length=240)
    definition: str = Field(min_length=1, max_length=8000)


class KnowledgeBoundaries(DomainKnowledgeModel):
    in_scope: list[str] = Field(default_factory=list, max_length=100)
    out_of_scope: list[str] = Field(default_factory=list, max_length=100)
    non_examples: list[str] = Field(default_factory=list, max_length=100)
    confused_with: list[str] = Field(default_factory=list, max_length=100)


class ConceptDelta(DomainKnowledgeModel):
    kind: Literal["codex_concept_delta"]
    schema_version: Literal[1]
    delta_id: str = Field(min_length=1, max_length=160)
    workspace_id: str = Field(min_length=1, max_length=160)
    codex_session_id: str = Field(min_length=1, max_length=160)
    author: str = Field(min_length=1, max_length=160)
    change_kind: ConceptChangeKind
    terms: list[str] = Field(min_length=1, max_length=50)
    introduced_for: IntroducedFor
    definitions: list[ConceptDefinition] = Field(min_length=1, max_length=50)
    relationships: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    boundaries: KnowledgeBoundaries
    invariants: list[str] = Field(default_factory=list, max_length=100)
    technical_solution_claims: list[dict[str, Any] | str] = Field(default_factory=list, max_length=100)
    evidence_hints: list[dict[str, Any] | str] = Field(default_factory=list, max_length=100)
    open_questions: list[str] = Field(default_factory=list, max_length=100)


_WINDOWS_DRIVE = re.compile(r"^[A-Za-z]:[\\/]")


def _is_workspace_relative_path(value: str) -> bool:
    text = value.strip()
    if not text or text.startswith(("/", "\\", "~")) or _WINDOWS_DRIVE.match(text):
        return False
    posix_parts = PurePosixPath(text.replace("\\", "/")).parts
    windows_path = PureWindowsPath(text)
    return ".." not in posix_parts and not windows_path.is_absolute()


class EvidenceReference(DomainKnowledgeModel):
    ref_id: str = Field(min_length=1, max_length=160)
    role: EvidenceRole
    authority: EvidenceAuthority
    repository_id: str = Field(min_length=1, max_length=160)
    revision: str = Field(min_length=1, max_length=160)
    blob_sha: str | None = Field(default=None, max_length=160)
    path: str | None = Field(default=None, max_length=1000)
    symbol: str | None = Field(default=None, max_length=500)
    line_start: int | None = Field(default=None, ge=1)
    line_end: int | None = Field(default=None, ge=1)
    snippet: str | None = Field(default=None, max_length=32000)
    snippet_sha256: Sha256 | None = Field(default=None, max_length=80)
    resolver_uri: str = Field(min_length=1, max_length=2000)
    command: str | None = Field(default=None, max_length=4000)
    outcome: Literal["success", "failure", "pending", "unknown"] | None = None
    exit_code: int | None = None
    source_event_ids: list[str] = Field(default_factory=list, max_length=200)

    @field_validator("path")
    @classmethod
    def _validate_path(cls, value: str | None) -> str | None:
        if value is not None and not _is_workspace_relative_path(value):
            raise ValueError("path must be workspace-relative")
        return value

    @model_validator(mode="after")
    def _validate_line_range(self) -> "EvidenceReference":
        if (self.line_start is None) != (self.line_end is None):
            raise ValueError("line_start and line_end must be provided together")
        if self.line_start is not None and self.line_end is not None and self.line_end < self.line_start:
            raise ValueError("line_end must be greater than or equal to line_start")
        return self


class KnowledgeMeaning(DomainKnowledgeModel):
    definition: str = Field(min_length=1, max_length=12000)
    entities: list[dict[str, Any] | str] = Field(default_factory=list, max_length=100)
    relationships: list[dict[str, Any] | str] = Field(default_factory=list, max_length=100)
    boundaries: KnowledgeBoundaries
    invariants: list[str] = Field(default_factory=list, max_length=100)


class TechnicalSolution(DomainKnowledgeModel):
    summary: str = Field(min_length=1, max_length=12000)
    architecture_flow: list[dict[str, Any] | str] = Field(default_factory=list, max_length=100)
    contract_refs: list[str] = Field(default_factory=list, max_length=100)
    implementation_refs: list[str] = Field(default_factory=list, max_length=100)
    test_refs: list[str] = Field(default_factory=list, max_length=100)
    validation_refs: list[str] = Field(default_factory=list, max_length=100)


class OperationalAppendix(DomainKnowledgeModel):
    steps: list[dict[str, Any] | str] = Field(default_factory=list, max_length=100)
    cautions: list[str] = Field(default_factory=list, max_length=100)


class KnowledgeSource(DomainKnowledgeModel):
    concept_delta_ids: list[str] = Field(default_factory=list, max_length=100)
    codex_session_ids: list[str] = Field(default_factory=list, max_length=100)
    baseline_scan_ids: list[str] = Field(default_factory=list, max_length=100)


class DomainKnowledgeDraft(DomainKnowledgeModel):
    schema_version: Literal[2]
    topic_id: str | None = Field(default=None, max_length=160)
    topic_identity_key: str = Field(min_length=1, max_length=500)
    topic_kind: TopicKind
    domain: str = Field(min_length=1, max_length=240)
    title: str = Field(min_length=1, max_length=240)
    aliases: list[str] = Field(default_factory=list, max_length=100)
    introduced_for: IntroducedFor
    meaning: KnowledgeMeaning
    technical_solution: TechnicalSolution
    failure_signals: list[str] = Field(default_factory=list, max_length=100)
    operational_appendix: OperationalAppendix | None = None
    source: KnowledgeSource
    evidence_refs: list[str] = Field(default_factory=list, max_length=300)
    open_questions: list[str] = Field(default_factory=list, max_length=100)


class TopicMatch(DomainKnowledgeModel):
    proposed_topic_id: str | None = Field(default=None, max_length=160)
    topic_identity_key: str = Field(min_length=1, max_length=500)
    match_status: Literal["unresolved", "new_topic", "single_match", "multiple_matches", "conflict"]
    possible_topic_ids: list[str] = Field(default_factory=list, max_length=50)


class CandidateQualityGate(DomainKnowledgeModel):
    definition_complete: bool
    problem_linked: bool
    relationships_explicit: bool
    boundaries_explicit: bool
    invariants_explicit: bool
    contract_linked: bool
    code_linked: bool
    test_or_validation_linked: bool
    verified: bool


class DomainKnowledgeCandidate(DomainKnowledgeModel):
    kind: Literal["project_domain_knowledge_candidate"]
    schema_version: Literal[2]
    candidate_id: str = Field(min_length=1, max_length=160)
    candidate_revision: int = Field(ge=1)
    workspace_id: str = Field(min_length=1, max_length=160)
    source_kind: Literal["session_incremental", "repository_baseline", "legacy_import", "manual"]
    source_hash: Sha256 = Field(min_length=1, max_length=80)
    content_hash: Sha256 = Field(min_length=1, max_length=80)
    topic_match: TopicMatch
    draft: DomainKnowledgeDraft
    quality_gate: CandidateQualityGate
    status: Literal[
        "draft",
        "needs_author_explanation",
        "needs_evidence",
        "ready_for_review",
        "in_review",
        "accepted",
        "rejected",
        "snoozed",
        "superseded",
    ]
    conflicts: list[dict[str, Any] | str] = Field(default_factory=list, max_length=100)
    evidence_index: list[EvidenceReference] = Field(default_factory=list, max_length=300)
    created_at: datetime
    updated_at: datetime


class WikiTarget(DomainKnowledgeModel):
    topic_id: str | None = Field(default=None, max_length=160)
    path: str = Field(min_length=1, max_length=1000)
    base_content_sha256: Sha256 | None = Field(default=None, max_length=80)
    base_git_revision: str | None = Field(default=None, max_length=160)

    @field_validator("path")
    @classmethod
    def _validate_path(cls, value: str) -> str:
        if not _is_workspace_relative_path(value):
            raise ValueError("path must be workspace-relative")
        return value


class WikiDiff(DomainKnowledgeModel):
    format: Literal["unified"]
    files: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    sha256: Sha256 = Field(min_length=1, max_length=80)


class WikiChangeProposal(DomainKnowledgeModel):
    proposal_id: str = Field(min_length=1, max_length=160)
    proposal_revision: int = Field(ge=1)
    candidate_id: str = Field(min_length=1, max_length=160)
    candidate_revision: int = Field(ge=1)
    match_state: Literal["new_topic", "single_match", "multiple_matches", "conflict"]
    publishable: bool
    publication_action: Literal["create", "update", "merge", "supersede", "none"]
    target: WikiTarget | None = None
    affected_files: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    proposed_markdown: str = Field(max_length=500_000)
    proposed_content_sha256: Sha256 = Field(min_length=1, max_length=80)
    diff: WikiDiff
    conflict_summary: list[str] = Field(default_factory=list, max_length=100)
    created_at: datetime

    @model_validator(mode="after")
    def _validate_publishability(self) -> "WikiChangeProposal":
        if self.match_state == "conflict":
            if self.publishable or self.publication_action != "none" or self.affected_files:
                raise ValueError("conflict proposal must be non-publishable with zero affected files")
            return self
        if self.publishable and self.publication_action == "none":
            raise ValueError("publishable proposal requires a publication action")
        if self.publishable and self.target is None:
            raise ValueError("publishable proposal requires a target")
        if self.publication_action in {"update", "merge", "supersede"} and (
            self.target is None or not self.target.topic_id or not self.target.base_content_sha256
        ):
            raise ValueError("existing-page publication action requires a target and base hash")
        return self


class ContentReview(DomainKnowledgeModel):
    decision: Literal["accept", "edit_accept", "needs_evidence", "reject", "snooze", "keep_existing"]
    approved_knowledge: DomainKnowledgeDraft | None = None
    approved_knowledge_sha256: Sha256 | None = Field(default=None, max_length=80)
    missing_evidence_requests: list[str] = Field(default_factory=list, max_length=100)
    notes: str | None = Field(default=None, max_length=8000)

    @model_validator(mode="after")
    def _validate_approval(self) -> "ContentReview":
        if self.decision in {"accept", "edit_accept"} and (
            self.approved_knowledge is None or not self.approved_knowledge_sha256
        ):
            raise ValueError("accepted content review requires approved knowledge and hash")
        if self.decision == "needs_evidence" and not self.missing_evidence_requests:
            raise ValueError("needs_evidence requires at least one evidence request")
        return self


class PublicationReview(DomainKnowledgeModel):
    decision: Literal["approve", "revise", "defer", "reject"]
    proposal_id: str = Field(min_length=1, max_length=160)
    proposal_revision: int = Field(ge=1)
    action: Literal["create", "update", "merge", "supersede", "none"]
    target_path: str | None = Field(default=None, max_length=1000)
    base_content_sha256: Sha256 | None = Field(default=None, max_length=80)
    approved_document_sha256: Sha256 | None = Field(default=None, max_length=80)
    approved_diff_sha256: Sha256 | None = Field(default=None, max_length=80)

    @field_validator("target_path")
    @classmethod
    def _validate_target_path(cls, value: str | None) -> str | None:
        if value is not None and not _is_workspace_relative_path(value):
            raise ValueError("target_path must be workspace-relative")
        return value

    @model_validator(mode="after")
    def _validate_approval(self) -> "PublicationReview":
        if self.decision == "approve":
            required = (
                self.target_path,
                self.approved_document_sha256,
                self.approved_diff_sha256,
            )
            if self.action == "none" or any(not value for value in required):
                raise ValueError("approved publication requires action, target, document hash, and diff hash")
            if self.action in {"update", "merge", "supersede"} and not self.base_content_sha256:
                raise ValueError("existing-page publication approval requires base_content_sha256")
        return self


class Reviewer(DomainKnowledgeModel):
    user_id: str = Field(min_length=1, max_length=160)
    channel: Literal["openclaw"]
    confirmed_at: datetime


class ReviewDecision(DomainKnowledgeModel):
    kind: Literal["project_domain_knowledge_review_decision"]
    schema_version: Literal[1]
    command_id: str = Field(min_length=1, max_length=160)
    candidate_id: str = Field(min_length=1, max_length=160)
    candidate_revision: int = Field(ge=1)
    input_content_sha256: Sha256 = Field(min_length=1, max_length=80)
    content_review: ContentReview
    publication_review: PublicationReview
    reviewer: Reviewer
    idempotency_key: str = Field(min_length=1, max_length=240)


class AcceptedChangeTarget(DomainKnowledgeModel):
    topic_id: str = Field(min_length=1, max_length=160)
    path: str = Field(min_length=1, max_length=1000)
    base_content_sha256: Sha256 = Field(min_length=1, max_length=80)
    base_git_revision: str = Field(min_length=1, max_length=160)

    @field_validator("path")
    @classmethod
    def _validate_path(cls, value: str) -> str:
        if not _is_workspace_relative_path(value):
            raise ValueError("path must be workspace-relative")
        return value


class AcceptedWikiChangeSet(DomainKnowledgeModel):
    kind: Literal["project_domain_knowledge_wiki_change_set"]
    schema_version: Literal[1]
    change_set_id: str = Field(min_length=1, max_length=160)
    candidate_id: str = Field(min_length=1, max_length=160)
    candidate_revision: int = Field(ge=1)
    decision_command_id: str = Field(min_length=1, max_length=160)
    publication_action: Literal["create", "update", "merge", "supersede"]
    target: AcceptedChangeTarget
    approved_knowledge: DomainKnowledgeDraft
    approved_knowledge_sha256: Sha256 = Field(min_length=1, max_length=80)
    approved_files: list[dict[str, Any]] = Field(min_length=1, max_length=100)
    approved_diff: WikiDiff
    approved_document_sha256: Sha256 = Field(min_length=1, max_length=80)
    approved_diff_sha256: Sha256 = Field(min_length=1, max_length=80)
    confirmed_by: str = Field(min_length=1, max_length=160)
    confirmed_at: datetime
    publish_status: Literal["pending", "publishing", "published", "failed", "conflict"]


class PublicationLint(DomainKnowledgeModel):
    status: Literal["passed", "failed"]
    errors: list[str] = Field(default_factory=list, max_length=200)
    warnings: list[str] = Field(default_factory=list, max_length=200)


class PublicationGit(DomainKnowledgeModel):
    commit_sha: str | None = Field(default=None, max_length=160)
    branch: str | None = Field(default=None, max_length=240)
    pushed: bool


class PublicationReceipt(DomainKnowledgeModel):
    kind: Literal["project_domain_knowledge_publication_receipt"]
    schema_version: Literal[1]
    change_set_id: str = Field(min_length=1, max_length=160)
    status: Literal["published", "failed", "conflict"]
    publication_action: Literal["create", "update", "merge", "supersede"]
    wiki_topic_id: str | None = Field(default=None, max_length=160)
    wiki_path: str | None = Field(default=None, max_length=1000)
    published_content_sha256: Sha256 | None = Field(default=None, max_length=80)
    lint: PublicationLint
    git: PublicationGit
    error: str | None = Field(default=None, max_length=16000)
    published_at: datetime | None = None

    @field_validator("wiki_path")
    @classmethod
    def _validate_wiki_path(cls, value: str | None) -> str | None:
        if value is not None and not _is_workspace_relative_path(value):
            raise ValueError("wiki_path must be workspace-relative")
        return value

    @model_validator(mode="after")
    def _validate_published_state(self) -> "PublicationReceipt":
        if self.status == "published":
            complete = (
                self.wiki_topic_id,
                self.wiki_path,
                self.published_content_sha256,
                self.git.commit_sha,
                self.git.branch,
                self.published_at,
            )
            if self.lint.status != "passed" or not self.git.pushed or self.error or any(value is None for value in complete):
                raise ValueError("published receipt requires passed lint, commit, push, hashes, path, and timestamp")
        return self
