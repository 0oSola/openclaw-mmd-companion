# Project Domain Knowledge Wiki Execution Spec

Date: 2026-07-14

Status: Active execution contract. Phase 1 session evidence correctness, the
Phase 2 foundation, and the FastAPI/OpenClaw Phase 3/4 transport and ledger
foundation are implemented. FastAPI now has durable candidate deliveries,
command/publish cursors, exact proposal/hash validation, Accepted Wiki Change
Sets, exact publish payloads, and publication receipt application. OpenClaw v2
routes accepted a fixed-revision shadow candidate after restart. A complete
human review through final Obsidian receipt, incremental extraction automation,
and baseline scanning remain pending. The current running topology is
documented in `docs/architecture/current-system-topology.md`.

OpenClaw handoff:

- `docs/plans/2026-07-14-openclaw-project-domain-knowledge-review-publish-spec.md`

## 1. Purpose

This spec defines how Codex sessions and repository facts become an
Obsidian-based project domain knowledge Wiki.

The result is not a session summary, a changed-file list, or a daily review
archive. Every published topic must answer:

1. What project-specific domain knowledge exists?
2. What problem caused the concept, rule, workflow, contract, gate, policy, or
   decision to be introduced?
3. What does it mean, including entities, relationships, boundaries,
   non-examples, and invariants?
4. What technical solution implements it?
5. Which Contract, code, test, and validation evidence supports it?
6. How can a reader or agent resolve the Wiki reference back to the exact code
   revision and code block?

The target closed loop is:

```text
Codex session + Concept Delta + repository/Git evidence
  -> Domain Knowledge Candidate
  -> Wiki Change Proposal
  -> OpenClaw content and publication review
  -> FastAPI accepted change set
  -> OpenClaw memory-wiki publish
  -> Obsidian canonical Domain Wiki
  -> publication receipt returned to FastAPI
```

## 2. Confirmed Product Decisions

The following decisions are frozen for the first implementation:

1. Contract, code, tests, validation results, and Git history are implementation
   facts. The Wiki explains and indexes those facts; it does not replace them.
2. Obsidian Markdown is the published canonical knowledge surface.
3. One canonical Note serves one primary retrieval intent.
4. A workspace/domain MOC links canonical Notes; raw session summaries do not
   become canonical domain pages by default.
5. The first delivery is a session-driven incremental closed loop. Repository
   baseline scanning is added only after that loop is stable.
6. Codex must emit a `Concept Delta` when it introduces, renames, clarifies,
   deprecates, or supersedes a project domain term.
7. OpenClaw is the only human review surface before publication.
8. Review includes both knowledge content and the proposed Wiki action, target
   page, affected files, and complete diff.
9. Unreviewed candidates never enter Obsidian.
10. OpenClaw publishes only the exact version and content hash accepted by the
    user and persisted by FastAPI.
11. A conflict with an existing canonical Note cannot overwrite it
    automatically. OpenClaw must show both definitions, evidence, and the diff,
    then ask the user to keep, update, merge, supersede, reject, or request more
    evidence.
12. Historical versions and superseded pages are retained.

## 3. Current State And Required Upgrade

### 3.1 Reusable current capabilities

The current project already has:

- bounded Codex session evidence extraction;
- a knowledge extraction outbox and OpenClaw prompt contract;
- `wiki_candidates`, quality-gate fields, and a bounded `code_index`;
- `codex_review_items` and review decision routes;
- `codex_review_memory` with append-only versions;
- FastAPI outbound OpenClaw Control Plane synchronization;
- accepted-memory Wiki payloads;
- OpenClaw publication status polling and failure recording.

The existing review and publication tests remain useful as compatibility and
transport tests.

### 3.2 Current blocking gaps

The v2 flow must address these concrete gaps:

1. `desktop-pet/electron/codexSessionFiles.ts` parses the older
   `function_call/function_call_output` event shape but not the current
   `custom_tool_call/custom_tool_call_output` shape. Commands, patches, tests,
   and outputs are therefore incomplete for current Codex Desktop sessions.
2. The current knowledge worker terminates at `codex_session_knowledge`.
   `wiki_candidates` are not bridged into the review and publish state machine.
3. The current `MemoryDraft` model is a Runbook model. It requires procedural
   `steps` and `verification`, but lacks first-class definitions,
   relationships, boundaries, invariants, and technical-solution evidence.
4. Current review actions are only `accept`, `edit_accept`, `ignore`, and
   `snooze`.
5. Current Wiki payloads always create a date/session-oriented source page and
   do not represent an existing canonical page, target base hash, semantic
   merge, supersede operation, or reviewed diff.
6. Current code references are session-derived hints. They do not consistently
   include repository revision, blob hash, exact snippet hash, or durable symbol
   resolution.
7. There is no repository baseline scanner, Repository/Git Resolver, term
   coverage audit, Concept Delta persistence, or stable cross-session topic
   identity.

### 3.3 Compatibility boundary

Domain Knowledge v2 is additive. It must not silently change the meaning of the
existing Review Memory v1 tables or endpoints.

```text
Review Memory v1
  = daily review, pitfall, runbook, work-summary compatibility flow

Domain Knowledge v2
  = stable project concepts, rules, workflows, contracts, gates, policies,
    decisions, technical realization, and exact evidence
```

Existing `sources/codex-review/...` pages remain historical provenance. They are
not automatically promoted into canonical Domain Notes.

## 4. Ubiquitous Language

### 4.1 Domain Term

A project-specific term whose meaning cannot be safely inferred from general
software vocabulary.

Examples include a named project Contract, Workflow, Rule, Gate, Policy,
failure classification, or project-specific entity.

### 4.2 Concept Delta

A structured author explanation produced by Codex when a session introduces or
changes a Domain Term. It states why the term was introduced, its intended
meaning, boundaries, invariants, technical claims, and unresolved questions.

A Concept Delta is an author claim, not verified repository fact.

### 4.3 Evidence Reference

A deterministic locator for a Contract, implementation, test, validation
result, Git fact, or session provenance item. LLMs may cite an existing
reference but may not create or mutate its factual locator fields.

### 4.4 Domain Knowledge Candidate

An unreviewed proposal for one domain topic and one primary retrieval intent. A
candidate may be generated from a Codex session, a repository baseline scan, or
an explicitly requested legacy import.

### 4.5 Canonical Domain Note

The current approved Obsidian page for one domain topic. Its stable identity is
the `topic_id`, not its title or mutable path.

### 4.6 Wiki Change Proposal

A candidate mapped against the current Vault. It contains a proposed action,
target page, base revision, resulting Markdown, all affected files, and a full
diff.

### 4.7 Conflict Proposal

A non-publishable proposal created when a new candidate conflicts with the
current definition, boundary, invariant, Contract, or implementation evidence.
It causes zero Vault writes until a user resolves it in OpenClaw.

### 4.8 Accepted Wiki Change Set

The exact content, hashes, action, target, and diff approved in OpenClaw and
persisted by FastAPI. Publication is authorized only from this object.

### 4.9 Publication Receipt

The OpenClaw acknowledgement containing the final page path, published content
hash, lint result, Git commit, push result, and any error.

### 4.10 Baseline Scan

A repository-wide or scoped scan bound to a fixed Git revision. It inventories
existing terms and creates candidates through the same Resolver, Gate, review,
and publication flow as session-driven extraction.

## 5. Authority And Ownership

| Concern | Authority / owner |
| --- | --- |
| Contract and code behavior | Repository at a fixed Git revision |
| Test and validation result | Recorded command/result or deterministic artifact |
| Meaning intended by a new Codex-created term | Codex Concept Delta, pending verification |
| Candidate schema, evidence reconciliation, review ledger | FastAPI |
| Final terminology and conflict decision | Human reviewer in OpenClaw |
| Review conversation and Wiki action proposal | OpenClaw |
| Canonical human/AI knowledge surface | Obsidian Domain Wiki |
| Wiki publication execution | OpenClaw memory-wiki |
| Wiki file history and sync | Git repository backing the Vault |

FastAPI must remain the local source of truth for candidate versions, accepted
change sets, and publication state. OpenClaw must remain the durable review and
publication executor. OpenClaw must not call the local FastAPI host directly;
FastAPI initiates all cross-machine network traffic.

## 6. Target Topology

```text
Codex rollout JSONL
  -> Electron Session Evidence Normalizer
  -> FastAPI session evidence store

Codex Concept Delta
  -> FastAPI Concept Delta store

Repository / Git
  -> FastAPI read-only Repository Evidence Resolver

session evidence + Concept Delta + repository evidence
  -> Domain Knowledge Synthesizer
  -> deterministic Domain Knowledge Gate
  -> Topic Identity Resolver
  -> Domain Knowledge Candidate store

FastAPI outbound candidate bundle
  -> OpenClaw durable review run
  -> Vault Resolver
  -> Wiki Change Proposal
  -> user content review + publication review

OpenClaw command queue
  -> FastAPI review command application
  -> Accepted Wiki Change Set

FastAPI outbound publish payload
  -> OpenClaw preflight
  -> memory-wiki apply
  -> wiki lint
  -> Git commit and push
  -> Obsidian canonical Note

OpenClaw publication receipt
  -> FastAPI publish ledger
```

## 7. Main Flows

### 7.1 Session-driven incremental extraction

1. Electron scans the bounded Codex session file.
2. The normalizer parses both legacy and current tool-call shapes and correlates
   calls and outputs by `call_id`.
3. FastAPI stores normalized session evidence and detected Concept Deltas.
4. If the session contains a Domain Term change without a Concept Delta,
   FastAPI records `needs_author_explanation` and does not claim synchronization
   is complete.
5. The Repository Evidence Resolver fixes a repository revision and resolves
   Contract, implementation, test, and validation evidence.
6. The synthesizer produces zero or more Domain Knowledge Candidates.
7. The deterministic Gate reconciles evidence, rejects fabricated refs, checks
   required sections, and assigns readiness state.
8. The Topic Identity Resolver finds exact IDs, aliases, related topics, and
   possible semantic conflicts.
9. FastAPI pushes a bounded candidate bundle to OpenClaw.
10. OpenClaw resolves the current Vault state and creates a Wiki Change
    Proposal.
11. The user reviews content and publication action in OpenClaw.
12. FastAPI validates the returned candidate version, proposal revision, base
    hash, approved document hash, and approved diff hash.
13. FastAPI persists an Accepted Wiki Change Set.
14. FastAPI pushes the exact change set to OpenClaw.
15. OpenClaw rechecks the base hash, applies the approved files, lints, commits,
    pushes, and returns a Publication Receipt.

### 7.2 Repository baseline scan

1. An administrator starts a scan for a workspace, scope, and Git revision.
2. The scanner inventories project-specific terms from authoritative docs,
   Contracts, code, tests, and validation tooling.
3. Coverage findings classify terms as:
   - `defined`;
   - `mentioned_only`;
   - `codex_created`;
   - `missing_author_explanation`;
   - `missing_implementation_evidence`;
   - `conflicting_definition`.
4. The scanner creates candidates in bounded batches.
5. Candidates use the same evidence, Gate, topic identity, OpenClaw review, and
   publication state machines as incremental extraction.
6. The scan updates workspace and domain MOCs only through reviewed change
   sets.

### 7.3 Conflict flow

1. A new candidate matches an existing topic but has incompatible definitions,
   boundaries, invariants, or authoritative evidence.
2. OpenClaw creates a Conflict Proposal with `publishable=false` and no affected
   files.
3. OpenClaw displays old and new content, both evidence sets, and the reason for
   conflict.
4. The user chooses:
   - keep the current Note;
   - request more evidence;
   - update the current Note;
   - merge overlapping topics;
   - supersede the old topic;
   - reject the candidate.
5. Any publishing choice creates a new proposal revision and a new full diff.
6. The revised proposal must be reviewed again before FastAPI can create an
   Accepted Wiki Change Set.

## 8. Core Data Contracts

The JSON examples below are normative shapes. Implementation may add bounded
metadata, but it must not change required semantics.

### 8.1 Concept Delta

```json
{
  "kind": "codex_concept_delta",
  "schema_version": 1,
  "delta_id": "concept_delta_01...",
  "workspace_id": "mmd-companion",
  "codex_session_id": "019f...",
  "author": "codex",
  "change_kind": "introduce",
  "terms": ["motion acceptance gate"],
  "introduced_for": {
    "problem": "Prevent invalid generated motion from being accepted.",
    "context": "VMD generation and validation",
    "failure_before_introduction": "Visual plausibility alone allowed semantic or collision failures."
  },
  "definitions": [
    {
      "term": "motion acceptance gate",
      "definition": "A deterministic set of checks that decides whether generated motion can be accepted."
    }
  ],
  "relationships": [],
  "boundaries": {
    "in_scope": [],
    "out_of_scope": [],
    "non_examples": [],
    "confused_with": []
  },
  "invariants": [],
  "technical_solution_claims": [],
  "evidence_hints": [],
  "open_questions": []
}
```

Allowed `change_kind` values:

```text
introduce
clarify
rename
deprecate
supersede
```

Rules:

- Contract, Workflow, Rule, Gate, or Policy changes without a Concept Delta must
  become `needs_author_explanation`.
- A Concept Delta may suggest evidence but cannot declare an unverified command
  successful.
- FastAPI must preserve the original author text and hash.

### 8.2 Evidence Reference

```json
{
  "ref_id": "evidence_ref_01...",
  "role": "implementation",
  "authority": "authoritative",
  "repository_id": "mmd-project",
  "revision": "<git-commit-sha>",
  "blob_sha": "<git-blob-sha>",
  "path": "imgToAction/tools/motion_acceptance_gate.py",
  "symbol": "main",
  "line_start": 100,
  "line_end": 140,
  "snippet": "bounded exact excerpt",
  "snippet_sha256": "sha256:...",
  "resolver_uri": "repo://mmd-project/<commit>/imgToAction/tools/motion_acceptance_gate.py#L100-L140",
  "command": null,
  "outcome": null,
  "exit_code": null,
  "source_event_ids": []
}
```

Allowed `role` values:

```text
contract
implementation
test
validation
git
session_provenance
```

Evidence invariants:

- `revision + path + snippet_sha256` is the durable source anchor. Line numbers
  are a reader hint, not identity.
- Repository paths are workspace-relative and may not contain an absolute local
  path.
- LLM output can only cite existing `ref_id` values.
- Reconciliation replaces all locator fields with Resolver-generated values.
- A `ready_for_review` candidate requires at least one implementation or
  Contract ref and at least one test or validation ref.
- When the topic describes a formal Contract, the Contract ref is mandatory.

### 8.3 Domain Knowledge Draft

```json
{
  "schema_version": 2,
  "topic_id": null,
  "topic_identity_key": "mmd-companion/motion-generation/motion-acceptance-gate",
  "topic_kind": "gate",
  "domain": "motion-generation",
  "title": "动作生成验收 Gate",
  "aliases": [],
  "introduced_for": {
    "problem": "阻止语义错误或存在穿模风险的 VMD 被当作有效结果。",
    "context": "图片到动作与 VMD 生成链路",
    "failure_before_introduction": "仅依赖肉眼检查会漏掉可程序化检测的失败。"
  },
  "meaning": {
    "definition": "一组基于 PMX 几何和语义约束执行的程序化动作验收规则。",
    "entities": [],
    "relationships": [],
    "boundaries": {
      "in_scope": [],
      "out_of_scope": [],
      "non_examples": [],
      "confused_with": []
    },
    "invariants": []
  },
  "technical_solution": {
    "summary": "导出帧关节数据后运行程序化 Gate，并保留测试与渲染证据。",
    "architecture_flow": [],
    "contract_refs": ["evidence_ref_contract"],
    "implementation_refs": ["evidence_ref_code"],
    "test_refs": ["evidence_ref_test"],
    "validation_refs": ["evidence_ref_validation"]
  },
  "failure_signals": [],
  "operational_appendix": {
    "steps": [],
    "cautions": []
  },
  "source": {
    "concept_delta_ids": [],
    "codex_session_ids": [],
    "baseline_scan_ids": []
  },
  "evidence_refs": [],
  "open_questions": []
}
```

Allowed `topic_kind` values:

```text
concept
entity
relationship
rule
workflow
contract
gate
policy
decision
failure_classification
```

The `operational_appendix` is optional. It preserves useful Runbook material
without forcing every domain concept to pretend to be a procedure.

### 8.4 Domain Knowledge Candidate

```json
{
  "kind": "project_domain_knowledge_candidate",
  "schema_version": 2,
  "candidate_id": "dkc_01...",
  "candidate_revision": 1,
  "workspace_id": "mmd-companion",
  "source_kind": "session_incremental",
  "source_hash": "sha256:...",
  "content_hash": "sha256:...",
  "topic_match": {
    "proposed_topic_id": null,
    "topic_identity_key": "mmd-companion/motion-generation/motion-acceptance-gate",
    "match_status": "unresolved",
    "possible_topic_ids": []
  },
  "draft": {},
  "quality_gate": {
    "definition_complete": true,
    "problem_linked": true,
    "relationships_explicit": true,
    "boundaries_explicit": true,
    "invariants_explicit": true,
    "contract_linked": true,
    "code_linked": true,
    "test_or_validation_linked": true,
    "verified": true
  },
  "status": "ready_for_review",
  "conflicts": [],
  "evidence_index": [],
  "created_at": "2026-07-14T12:00:00+08:00",
  "updated_at": "2026-07-14T12:00:00+08:00"
}
```

Allowed `source_kind` values:

```text
session_incremental
repository_baseline
legacy_import
manual
```

### 8.5 Wiki Change Proposal

```json
{
  "proposal_id": "dkp_01...",
  "proposal_revision": 1,
  "candidate_id": "dkc_01...",
  "candidate_revision": 1,
  "match_state": "single_match",
  "publishable": true,
  "publication_action": "update",
  "target": {
    "topic_id": "dkt_01...",
    "path": "projects/mmd-companion/domains/motion-generation/motion-acceptance-gate.md",
    "base_content_sha256": "sha256:...",
    "base_git_revision": "<vault-commit>"
  },
  "affected_files": [],
  "proposed_markdown": "---\n...",
  "proposed_content_sha256": "sha256:...",
  "diff": {
    "format": "unified",
    "files": [],
    "sha256": "sha256:..."
  },
  "conflict_summary": [],
  "created_at": "2026-07-14T12:05:00+08:00"
}
```

Allowed `publication_action` values:

```text
create
update
merge
supersede
none
```

`conflict` is a match/review state, not a write action. A Conflict Proposal has
`publishable=false`, `publication_action=none`, and no affected files. It must
be revised into a new publishable proposal after human resolution.

### 8.6 Review Decision

Content review and publication review are distinct even when the user confirms
them in one OpenClaw interaction.

```json
{
  "kind": "project_domain_knowledge_review_decision",
  "schema_version": 1,
  "command_id": "openclaw_knowledge_cmd_01...",
  "candidate_id": "dkc_01...",
  "candidate_revision": 1,
  "input_content_sha256": "sha256:...",
  "content_review": {
    "decision": "accept",
    "approved_knowledge": {},
    "approved_knowledge_sha256": "sha256:...",
    "missing_evidence_requests": [],
    "notes": null
  },
  "publication_review": {
    "decision": "approve",
    "proposal_id": "dkp_01...",
    "proposal_revision": 1,
    "action": "update",
    "target_path": "projects/mmd-companion/domains/motion-generation/motion-acceptance-gate.md",
    "base_content_sha256": "sha256:...",
    "approved_document_sha256": "sha256:...",
    "approved_diff_sha256": "sha256:..."
  },
  "reviewer": {
    "user_id": "admin-1",
    "channel": "openclaw",
    "confirmed_at": "2026-07-14T12:10:00+08:00"
  },
  "idempotency_key": "knowledge-review:sha256:..."
}
```

Content decisions:

```text
accept
edit_accept
needs_evidence
reject
snooze
keep_existing
```

Publication decisions:

```text
approve
revise
defer
reject
```

### 8.7 Accepted Wiki Change Set

```json
{
  "kind": "project_domain_knowledge_wiki_change_set",
  "schema_version": 1,
  "change_set_id": "dkcs_01...",
  "candidate_id": "dkc_01...",
  "candidate_revision": 1,
  "decision_command_id": "openclaw_knowledge_cmd_01...",
  "publication_action": "update",
  "target": {
    "topic_id": "dkt_01...",
    "path": "projects/mmd-companion/domains/motion-generation/motion-acceptance-gate.md",
    "base_content_sha256": "sha256:..."
  },
  "approved_knowledge": {},
  "approved_knowledge_sha256": "sha256:...",
  "approved_files": [],
  "approved_document_sha256": "sha256:...",
  "approved_diff_sha256": "sha256:...",
  "confirmed_by": "admin-1",
  "confirmed_at": "2026-07-14T12:10:00+08:00",
  "publish_status": "pending"
}
```

### 8.8 Publication Receipt

```json
{
  "kind": "project_domain_knowledge_publication_receipt",
  "schema_version": 1,
  "change_set_id": "dkcs_01...",
  "status": "published",
  "publication_action": "update",
  "wiki_topic_id": "dkt_01...",
  "wiki_path": "projects/mmd-companion/domains/motion-generation/motion-acceptance-gate.md",
  "published_content_sha256": "sha256:...",
  "lint": {
    "status": "passed",
    "errors": [],
    "warnings": []
  },
  "git": {
    "commit_sha": "<vault-commit>",
    "branch": "main",
    "pushed": true
  },
  "error": null,
  "published_at": "2026-07-14T12:15:00+08:00"
}
```

## 9. State Machines

### 9.1 Candidate state

```text
draft
  -> needs_author_explanation
  -> resolving_evidence
  -> needs_evidence
  -> ready_for_review
  -> in_review
       -> approved
       -> keep_existing
       -> rejected
       -> snoozed
       -> conflict_needs_decision

needs_author_explanation -> resolving_evidence
needs_evidence -> resolving_evidence
snoozed -> ready_for_review
conflict_needs_decision -> ready_for_review
```

`approved` means the exact change set was accepted. It does not mean the Wiki
was published.

### 9.2 Publication state

```text
pending
  -> submitted
  -> preflight
  -> applying
  -> linting
  -> committed
  -> pushing
  -> published

preflight/applying/linting/committed/pushing
  -> failed
  -> conflict
  -> blocked

failed -- explicit retry --> pending
conflict -> regenerate proposal -> in_review
blocked -> user resolves external state -> explicit retry
```

### 9.3 Baseline scan state

```text
queued -> running -> completed
                  -> partial
                  -> failed
                  -> cancelled

partial -> running
failed -- explicit retry --> queued
```

## 10. Required Modules And Interfaces

The design uses deep modules with small interfaces. Internal filesystem, Git,
symbol, LLM, and persistence adapters remain hidden behind these seams.

### 10.1 Session Evidence Normalizer

Location: Electron main process.

```text
normalize_session_events(session_file, parser_version)
  -> SessionEvidenceEnvelope
```

Responsibilities:

- stream or incrementally scan the complete JSONL event sequence while
  persisting only bounded normalized facts; a fixed head/tail window is not
  sufficient because domain explanations, commands, patches, and validation can
  occur in the middle of a long session;
- parse both old and current Codex tool-call events;
- correlate calls and outputs by `call_id` instead of one global last-call
  pointer;
- extract bounded commands, patches, files, checks, and results;
- preserve event IDs and timestamps;
- redact secrets and reject paths outside the workspace;
- make no domain-knowledge judgment.

### 10.2 Concept Delta Collector

```text
collect_concept_deltas(session_evidence)
  -> ConceptDelta[] + CoverageFinding[]
```

It accepts only explicit structured Codex output or user-authored corrections.
It may report a missing Concept Delta but may not fabricate one on Codex's
behalf.

### 10.3 Repository Evidence Resolver

```text
resolve_evidence(request, workspace, revision)
  -> RepositoryEvidencePack
```

The implementation may use filesystem, Git, code search, symbol, Contract, and
test adapters. The interface exposes only a bounded, deterministic evidence
pack.

Responsibilities:

- operate read-only at a fixed revision;
- resolve Contracts, implementation symbols, tests, validation scripts, and
  relevant Git history;
- generate canonical Evidence References and hashes;
- never expose secrets or arbitrary unbounded files;
- never allow OpenClaw to read the local repository directly.

### 10.4 Domain Knowledge Synthesizer

```text
synthesize_domain_knowledge(concept_deltas, session_evidence, repository_evidence)
  -> CandidateSet
```

The synthesizer may use an OpenClaw/Codex LLM Skill. Its output remains an
untrusted draft until the deterministic Gate succeeds.

### 10.5 Domain Knowledge Gate

```text
evaluate_candidate(candidate, evidence_pack)
  -> GateResult
```

Responsibilities:

- validate schema and enumerations;
- reconcile every evidence ref against Resolver input;
- check problem, definition, relationships, boundaries, invariants, and
  technical-solution coverage;
- enforce Contract/code/test evidence requirements;
- reject invented paths, commands, snippets, results, and line numbers;
- assign `needs_author_explanation`, `needs_evidence`, or
  `ready_for_review` deterministically.

### 10.6 Topic Identity Resolver

```text
resolve_topic_identity(candidate, canonical_topic_index)
  -> TopicMatch
```

Responsibilities:

- match stable `topic_id` first;
- match aliases and prior names second;
- provide bounded semantic match suggestions;
- distinguish same topic, overlapping topics, distinct topics, and conflict;
- never merge or supersede without human review.

A new `topic_id` is generated by FastAPI on first accepted creation. It must not
be derived from a session ID, date, mutable title, or file path.

### 10.7 Review Ledger

```text
apply_review_decision(command)
  -> ReviewApplicationResult
```

Responsibilities:

- validate candidate and proposal revisions;
- validate all approved hashes;
- make command replay idempotent;
- persist content review and publication review separately;
- create an Accepted Wiki Change Set only for a valid approved proposal;
- prevent stale candidate or stale base-revision approval.

### 10.8 OpenClaw Control Plane Adapter

```text
push_candidate_bundle(run_id, bundle)
poll_review_commands(run_id, cursor)
post_command_result(command_id, result)
push_change_sets(run_id, change_sets)
poll_publication_receipts(run_id, cursor)
```

All methods are FastAPI outbound calls. Cursors and processed-command ledgers
must be durable, not process-memory-only.

### 10.9 Baseline Scanner

```text
scan_workspace(workspace_id, revision, scope, cursor)
  -> ScanBatch
```

It reuses the Resolver, Synthesizer, Gate, Topic Identity Resolver, Review
Ledger, and OpenClaw Adapter. A second independent knowledge pipeline is not
allowed.

## 11. FastAPI Persistence Model

Use additive migrations. Recommended tables:

- `codex_concept_deltas`;
- `domain_knowledge_evidence_refs`;
- `domain_knowledge_topics`;
- `domain_knowledge_candidates`;
- `domain_knowledge_candidate_versions`;
- `domain_knowledge_candidate_evidence`;
- `domain_knowledge_review_decisions`;
- `domain_knowledge_wiki_change_sets`;
- `domain_knowledge_publication_receipts`;
- `domain_knowledge_wiki_page_snapshots`;
- `domain_knowledge_scan_runs`;
- `domain_term_coverage_findings`;
- `domain_knowledge_extraction_outbox`;
- `domain_knowledge_control_plane_commands`.
- `domain_knowledge_candidate_deliveries`;
- `domain_knowledge_control_plane_runs`.

Do not compress v2 state into `codex_review_items.details_json`. The v1 table
continues serving Review Memory compatibility.

Required uniqueness and version rules:

- `(workspace_id, source_kind, source_hash)` prevents duplicate candidate
  generation;
- `(candidate_id, candidate_revision)` is immutable;
- `(command_id)` is globally unique and replayable;
- `(change_set_id)` is immutable;
- `(topic_id)` is stable across rename and path changes;
- `(publish_ticket_id, approved_document_sha256)` is idempotent;
- one active canonical Note exists per `topic_id`;
- every published receipt refers to one exact change set.

## 12. Control Plane v2 Contract

Use a new namespace and message kinds. Do not disguise domain knowledge as a v1
Codex review memory payload.

Recommended OpenClaw routes:

```http
POST /v1/apps/mmd/project-knowledge/runs/{run_id}/candidates
GET  /v1/apps/mmd/project-knowledge/runs/{run_id}/commands?cursor=...
POST /v1/apps/mmd/project-knowledge/commands/{command_id}/result
POST /v1/apps/mmd/project-knowledge/runs/{run_id}/publish-payloads
GET  /v1/apps/mmd/project-knowledge/runs/{run_id}/publish-status?cursor=...
```

Message kinds:

```text
project_domain_knowledge_candidate_batch
project_domain_knowledge_review_decision
project_domain_knowledge_wiki_payload_batch
project_domain_knowledge_publication_receipt
```

Run ID formats:

```text
project-knowledge:{workspace_id}:incremental:{YYYY-MM-DD}
project-knowledge:{workspace_id}:baseline:{scan_id}
```

Contract requirements:

- canonical JSON hashing must be deterministic;
- idempotency keys with a different payload hash hard-fail;
- candidate revision and content hash are mandatory in decisions;
- proposal revision, target base hash, approved document hash, and approved diff
  hash are mandatory for publishing actions;
- per-item acknowledgements are mandatory for batches;
- publication receipt must bind to the change set and approved document hash;
- stale candidate, stale proposal, stale Vault revision, and stale target hash
  are explicit error classes.

The complete OpenClaw-side route, payload, review, and publish behavior is in
the companion OpenClaw handoff spec.

## 13. Canonical Obsidian Contract

### 13.1 Layout

Recommended layout:

```text
projects/
  {workspace_id}/
    domain-knowledge-map.md
    domains/
      {domain}/
        _MOC.md
        {topic-slug}.md
```

The stable `topic_id` lives in frontmatter. File path and title are mutable
presentation properties and must not be used as database identity.

### 13.2 Frontmatter

Every canonical Domain Note contains at least:

```yaml
topic_id:
workspace_id:
domain:
topic_kind:
title:
aliases: []
status: current
relations: []
contract_refs: []
code_refs: []
test_refs: []
validation_refs: []
source_sessions: []
source_scans: []
repository_revisions: []
version: 1
content_sha256:
reviewed_by:
reviewed_at:
supersedes: []
superseded_by: []
merged_from: []
merged_into: null
```

Allowed `status` values:

```text
current
merged
superseded
```

### 13.3 Body structure

```text
# Title

## 为什么引入
## 定义与含义
## 实体与关系
## 边界、非例和易混淆概念
## 不变量
## 技术方案
### Contract
### 实现代码
### 测试与验证
## 失败信号
## 演进与来源
## 未决问题
```

Empty sections are allowed only when the candidate is explicitly marked
incomplete and cannot be published as `ready`. Published Notes must explain why
a section is not applicable instead of silently omitting it.

### 13.4 Code reference rendering

Render bounded references, not entire source files:

```text
[evidence_ref_01]
repository=mmd-project
revision=<commit>
blob=<blob-sha>
path=imgToAction/tools/motion_acceptance_gate.py
symbol=main
lines=100-140
snippet_sha256=sha256:...
```

The Wiki may include a bounded exact snippet. The resolver identity remains the
revision, path, blob/snippet hash, and optional symbol. A line number alone is
not a durable reference.

### 13.5 Generated and human-authored content

OpenClaw must preserve explicitly marked human-authored blocks during updates.
Generated blocks may be replaced only through an approved full diff. The first
version must define marker syntax and lint it consistently.

## 14. Programmatic Gates And Invariants

The following are hard requirements, not prompt suggestions:

1. No candidate reaches Obsidian without OpenClaw human review.
2. OpenClaw displays the content, action, target, affected files, and complete
   diff before approval.
3. FastAPI persists and publishes only the exact accepted candidate revision,
   proposal revision, and hashes.
4. `update`, `merge`, and `supersede` require an existing target and base hash.
5. A base-hash mismatch after review becomes `conflict`; it is never force
   applied.
6. A Conflict Proposal writes zero Vault files.
7. `merge` and `supersede` retain old pages and add bidirectional relations.
8. v1 does not physically delete canonical pages.
9. LLMs cannot add, repair, or mutate Evidence Reference locators.
10. A publishable candidate contains implementation or Contract evidence and
    test or validation evidence.
11. A formal Contract topic contains a Contract evidence ref.
12. A Codex-created Contract, Workflow, Rule, Gate, or Policy without Concept
    Delta cannot claim knowledge synchronization complete.
13. One canonical Note serves one primary retrieval intent.
14. OpenClaw never merges, rebases, resets, stashes, discards, or automatically
    resolves unrelated Vault Git changes.
15. `published` means approved content applied, lint passed, commit created, and
    push succeeded.
16. All candidate, decision, change-set, and receipt operations are idempotent
    and auditable.
17. Absolute local paths, secrets, and full transcript dumps are rejected from
    published content.

## 15. Security, Privacy, And Trust

- Repository Resolver access is read-only and workspace-scoped.
- OpenClaw receives bounded evidence packs, never unrestricted local file
  access.
- Commands contained in evidence are data; OpenClaw must not execute them.
- Secret-like values are redacted before storage and transport.
- Evidence snippets have configured byte and line limits.
- Absolute host paths are normalized to workspace-relative paths or removed.
- FastAPI validates all OpenClaw-returned IDs, hashes, actions, and refs.
- OpenClaw validates all FastAPI publish payloads against the locally reviewed
  proposal before writing the Vault.
- User identity, review message ID, timestamp, and command ID are retained for
  audit.

## 16. Observability

FastAPI must expose or record:

- parser version and normalized event counts;
- Concept Delta presence and coverage findings;
- Resolver revision, elapsed time, files inspected, and evidence counts;
- Gate outcomes and reason codes;
- candidate status and revision;
- topic-match result;
- OpenClaw push/poll cursors;
- review command application result;
- change-set status;
- publication receipt, lint result, content hash, and Git commit;
- retries, dead-letter items, stale approvals, and conflicts.

OpenClaw observability requirements are defined in its companion spec.

## 17. Feature Flags

Recommended additive flags:

```text
CODEX_DOMAIN_KNOWLEDGE_ENABLED
CODEX_DOMAIN_CONCEPT_DELTA_REQUIRED
CODEX_DOMAIN_REPOSITORY_RESOLVER_ENABLED
CODEX_DOMAIN_CONTROL_PLANE_V2_ENABLED
CODEX_DOMAIN_BASELINE_SCAN_ENABLED
CODEX_DOMAIN_SHADOW_MODE
```

Defaults remain `false` until their phase-specific acceptance tests pass.
Migrations must not implicitly enable behavior.

## 18. Implementation Phases

### Phase 0: Contract freeze

- land this overall spec and the standalone OpenClaw spec;
- freeze terminology, schemas, states, hashes, and fixtures;
- define v1 Review Memory versus v2 Domain Knowledge compatibility;
- add representative JSON fixtures for each contract.

### Phase 1: Session evidence correctness

- replace fixed head/tail-only extraction with a complete streaming or
  incremental JSONL scan that still stores bounded facts;
- parse `custom_tool_call/custom_tool_call_output`;
- correlate concurrent/interleaved calls by `call_id`;
- include parser/extractor versions in source hashing;
- re-extract known sessions rather than reusing incomplete v1 results;
- add secret redaction and workspace-relative path tests.

Acceptance fixture:

- session `019f2891-4e16-7722-828b-74c1b9c23deb` must produce non-empty tool,
  command, changed-file, and validation evidence when those events exist.

### Phase 2: Domain Knowledge v2 and Repository Resolver

- add Pydantic contracts and additive SQLite tables;
- add Concept Delta collection and missing-delta findings;
- implement read-only Repository/Git Resolver;
- replace or version the current
  `openclaw/skills/codex-session-knowledge-extraction/SKILL.md` contract with a
  Domain Knowledge v2/v3 synthesis contract while preserving its `no_wiki`
  default and evidence-discipline rules;
- update `api/app/services/openclaw_client.py` prompt fallback,
  `CODEX_KNOWLEDGE_PROMPT_VERSION`, response parser, and fixtures together so
  the embedded Skill contract and FastAPI schema cannot drift;
- implement deterministic Gate and evidence reconciliation;
- implement stable topic identity and alias matching.

### Phase 3: OpenClaw candidate review

- implement Control Plane v2 candidate bundle;
- implement OpenClaw durable review runs and Vault Resolver;
- render content review and publication review;
- implement create/update/merge/supersede and conflict proposal behavior;
- persist durable commands, results, and cursors.

### Phase 4: Exact change-set publication

- persist Accepted Wiki Change Sets in FastAPI;
- push exact authorized files and hashes;
- implement OpenClaw base-hash preflight, apply, lint, Git commit, push, and
  publication receipt;
- bind receipt to change-set ID and approved document hash;
- implement crash recovery and idempotent replay.

### Phase 5: Incremental automation

- trigger extraction for terminal/reviewable sessions;
- require Concept Delta for domain changes;
- add retry, dead-letter, health, and metrics;
- disable any path that bypasses OpenClaw review;
- run in shadow mode before enabling publication.

### Phase 6: Repository baseline scan

- scan one bounded module at a fixed revision;
- generate term coverage findings;
- create candidates through the same v2 pipeline;
- update MOCs only through reviewed change sets;
- support resumable cursors and explicit retry.

### Phase 7: Compatibility convergence

- keep v1 data and APIs readable;
- stop generating new summary-only canonical pages;
- import selected v1 memories only as `legacy_import` candidates in
  `needs_review`;
- retain old source pages and publication history;
- document the final running topology.

## 19. Testing Strategy

### 19.1 Session parser

- legacy tool call/output fixture;
- current custom tool call/output fixture;
- interleaved calls correlated by `call_id`;
- patch and changed-file extraction;
- success/failure command result extraction;
- redaction and path-scope tests.

### 19.2 Resolver and evidence

- fixed-revision filesystem/Git fixture;
- Contract, symbol, test, and validation resolution;
- blob and snippet hashing;
- line movement with stable snippet hash;
- missing file, renamed symbol, and stale revision behavior;
- bounded payload and secret rejection.

### 19.3 Candidate and Gate

- complete concept candidate;
- missing Concept Delta;
- missing definition, boundary, invariant, code, or validation evidence;
- hallucinated ref rejection;
- duplicate and cross-session topic matching;
- conflicting authoritative evidence.

### 19.4 Review

- create, update, merge, and supersede proposals;
- keep-existing, reject, snooze, and needs-evidence decisions;
- conflict produces zero affected files;
- edited content gets a new hash;
- stale candidate/proposal revision rejected;
- replayed command returns the original result.

### 19.5 Publication

- accepted-only payload generation;
- exact approved diff verification;
- target modified after approval;
- unrelated dirty Vault files;
- lint failure;
- commit succeeds but push fails;
- ACK loss and recovery by publish ticket;
- repeated payload does not create a second commit;
- published hash equals approved hash.

### 19.6 Baseline scan

- fixed revision and scoped scan;
- resumable cursor;
- duplicate scan does not duplicate topics;
- partial/failure/retry behavior;
- coverage report classification.

## 20. End-to-End Acceptance Criteria

The v2 system is complete only when all of the following are true:

1. A current Codex Desktop session produces complete bounded tool and result
   evidence.
2. A domain-changing session produces or explicitly lacks a Concept Delta.
3. FastAPI resolves Contract, implementation, test, and validation evidence at
   a fixed repository revision.
4. The candidate explains the introduction problem, definition, relationships,
   boundaries, invariants, and technical solution.
5. Every code reference resolves to the exact revision/path/blob/snippet.
6. A candidate enters OpenClaw review without entering Obsidian.
7. OpenClaw displays content, action, target, affected files, and full diff.
8. The user can keep, edit, reject, request evidence, create, update, merge, or
   supersede.
9. Conflict resolution never writes before a revised proposal is approved.
10. FastAPI persists the exact accepted content and hashes.
11. OpenClaw publishes only the exact accepted files after base-hash preflight.
12. Lint, commit, push, and receipt succeed before FastAPI marks the item
    published.
13. Obsidian can browse the workspace MOC, domain MOC, canonical Note, aliases,
    and relations.
14. The canonical Note points back to Contract, code, test, validation, session,
    and repository revision evidence.
15. Replays and process restarts do not duplicate decisions, pages, or commits.

## 21. Ownership Checklist

### Codex / Electron

- emit Concept Delta for domain changes;
- parse current and legacy tool events;
- provide complete bounded evidence.

### FastAPI

- persist v2 contracts and versions;
- resolve repository evidence;
- enforce deterministic gates;
- assign stable topic identity;
- synchronize Control Plane v2;
- persist review decisions and exact change sets;
- reconcile publication receipts.

### OpenClaw

- receive bounded candidates;
- resolve current Vault state;
- generate complete publication proposals and diffs;
- host all human review;
- publish exact accepted change sets;
- lint, commit, push, recover, and acknowledge.

### Obsidian / memory-wiki

- store the canonical Markdown and MOCs;
- expose canonical knowledge to humans and agents;
- retain superseded and merged history.

## 22. Related Documents

Current and historical contracts:

- `docs/architecture/current-system-topology.md`
- `docs/plans/2026-06-15-openclaw-codex-review-consumption-spec.md`
- `docs/plans/2026-06-18-openclaw-knowledge-memory-generation-spec.md`
- `docs/plans/2026-06-18-review-decision-memory-draft-contract-spec.md`
- `docs/plans/2026-06-09-openclaw-memory-wiki-obsidian-execution-spec.md`

The 2026-06 specs remain authoritative for the currently implemented v1
Review Memory flow. This document and its OpenClaw companion are authoritative
for the target Domain Knowledge v2 implementation.
