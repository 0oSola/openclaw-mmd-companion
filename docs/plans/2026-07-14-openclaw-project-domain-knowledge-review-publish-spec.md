# OpenClaw Project Domain Knowledge Review And Publish Spec

Date: 2026-07-14

Status: Standalone target execution contract for OpenClaw. This file is the
minimum handoff artifact for implementing the OpenClaw side of Project Domain
Knowledge v2.

FastAPI dependency status: the core Pydantic contracts and Phase 2 evidence/Gate
foundation are implemented, but candidate revision orchestration, review
ledger, Control Plane v2 routes, accepted change-set persistence flow, and
end-to-end publication hash checks are not connected yet. OpenClaw may implement
and test its durable stores and adapters first, but it must not publish v2
content until those Phase 3/4 dependencies are available.

## 1. Purpose

OpenClaw is the only human review surface for project domain knowledge. It must:

1. receive bounded Domain Knowledge Candidates from FastAPI;
2. resolve the current Obsidian Vault state;
3. propose the knowledge content, target page, publication action, affected
   files, and complete diff;
4. ask the user to review both content and publication action;
5. queue a durable review command for FastAPI;
6. wait for FastAPI to persist the exact accepted version;
7. publish only the exact accepted change set through memory-wiki;
8. run lint and Git synchronization safely;
9. return a durable publication receipt to FastAPI.

The required flow is:

```text
FastAPI candidate bundle
  -> OpenClaw candidate store
  -> Vault Resolver
  -> Wiki Change Proposal
  -> OpenClaw user review
  -> durable decision command
  -> FastAPI accepted change set
  -> OpenClaw exact publish
  -> memory-wiki / Obsidian / Git
  -> publication receipt
```

## 2. Scope

This spec covers OpenClaw responsibilities for:

- durable review runs;
- candidate ingestion and idempotency;
- Vault lookup and page snapshotting;
- topic match presentation;
- content review;
- publication action review;
- `create`, `update`, `merge`, and `supersede` proposals;
- conflict review;
- durable command queueing;
- accepted change-set ingestion;
- exact Markdown application;
- memory-wiki lint and compilation;
- Git commit and push;
- publication status, retries, and crash recovery;
- security, redaction, and audit records.

## 3. Non-Goals And Trust Boundary

OpenClaw must not:

- read Codex rollout JSONL files;
- read the local MMD project repository directly;
- call the local FastAPI host directly;
- execute commands, tests, patches, or scripts found in evidence;
- invent or repair file paths, commands, symbols, line numbers, snippets,
  results, or Git revisions;
- publish unreviewed candidates;
- rewrite a candidate after FastAPI has persisted the accepted version;
- force-apply a stale page diff;
- automatically merge, rebase, reset, stash, discard, or resolve unrelated Git
  changes in the Vault;
- physically delete canonical pages in v1 of this flow;
- publish full transcripts, absolute local paths, or secrets.

OpenClaw may use only:

- bounded candidate and evidence payloads pushed by FastAPI;
- memory-wiki/Vault search and read operations;
- user edits made inside the OpenClaw review interaction;
- the exact accepted publish payload later pushed by FastAPI.

All network connections between the local project and OpenClaw are initiated by
FastAPI. OpenClaw exposes Control Plane endpoints and durable command/status
queues; it does not initiate an inbound connection to the local machine.

## 4. Authority Model

| Concern | Authority |
| --- | --- |
| Candidate version and evidence locators | FastAPI |
| Contract, code, tests, validation, Git facts | FastAPI Resolver payload at a fixed revision |
| Current Wiki page content and Vault revision | OpenClaw Vault Resolver |
| Final terminology and conflict choice | Human reviewer in OpenClaw |
| Accepted content and publication authorization | FastAPI accepted change set |
| Wiki write execution | OpenClaw memory-wiki |
| Published file history | Vault Git repository |

OpenClaw can propose and render, but it cannot unilaterally authorize a write.
FastAPI can persist authorization, but it cannot publish a version that differs
from what OpenClaw presented and the user approved.

## 5. Ubiquitous Language

### 5.1 Knowledge Candidate

An unreviewed, evidence-linked proposal for one project domain topic and one
primary retrieval intent.

### 5.2 Canonical Note

The current approved Obsidian page for one stable `topic_id`. The title and path
may change; `topic_id` is the identity.

### 5.3 Content Review

The user's confirmation that the problem, definition, entities,
relationships, boundaries, invariants, technical solution, and evidence are
correct.

### 5.4 Publication Proposal

The OpenClaw object containing the action, target, base revision, resulting
files, and full diff that would update the Vault.

### 5.5 Publication Review

The user's confirmation of the Publication Proposal independently from content
review.

### 5.6 Conflict Proposal

A non-publishable proposal indicating incompatible definitions, boundaries,
invariants, authority, or page state. It has no affected files and cannot create
a publish ticket.

### 5.7 Accepted Change Set

The exact reviewed files and hashes persisted and returned by FastAPI after a
successful review command.

### 5.8 Revision Fingerprint

The Vault Git revision plus target-page content hash used for optimistic
concurrency.

### 5.9 Publication Receipt

The final OpenClaw record binding an accepted change set to lint, commit, push,
path, and content-hash results.

## 6. Durable OpenClaw Data

OpenClaw must persist at least these logical entities:

- `project_knowledge_review_runs`;
- `project_knowledge_candidate_revisions`;
- `project_knowledge_candidate_evidence`;
- `project_knowledge_vault_snapshots`;
- `project_knowledge_publication_proposals`;
- `project_knowledge_content_reviews`;
- `project_knowledge_publication_reviews`;
- `project_knowledge_commands`;
- `project_knowledge_command_results`;
- `project_knowledge_publish_payloads`;
- `project_knowledge_publish_jobs`;
- `project_knowledge_publish_events`;
- `project_knowledge_publication_receipts`.

Raw inbound and outbound JSON must be retained in bounded audit storage. Parsed
columns must retain IDs, revisions, hashes, status, timestamps, and error codes.

Process-memory cursors are insufficient. Command cursors, publication cursors,
processed IDs, and retry state must survive restart.

## 7. Review Run Model

Run ID formats:

```text
project-knowledge:{workspace_id}:incremental:{YYYY-MM-DD}
project-knowledge:{workspace_id}:baseline:{scan_id}
```

Minimum run shape:

```json
{
  "run_id": "project-knowledge:mmd-companion:incremental:2026-07-14",
  "workspace_id": "mmd-companion",
  "run_kind": "incremental",
  "status": "awaiting_candidates",
  "candidate_cursor": null,
  "command_cursor": null,
  "publish_cursor": null,
  "vault_revision": null,
  "last_user_prompt_at": null,
  "error": null,
  "created_at": "2026-07-14T09:00:00+08:00",
  "updated_at": "2026-07-14T09:00:00+08:00"
}
```

Allowed run statuses:

```text
awaiting_candidates
candidates_received
resolving_vault
needs_user_review
commands_queued
awaiting_fastapi_results
awaiting_publish_payloads
publishing
published
no_publishable_candidates
blocked
failed
```

Run status is a summary only. Per-candidate and per-publish-job state remain the
source for detailed recovery.

## 8. Candidate Ingestion Contract

Endpoint:

```http
POST /v1/apps/mmd/project-knowledge/runs/{run_id}/candidates
Authorization: Bearer <service-token>
Content-Type: application/json
```

Request:

```json
{
  "kind": "project_domain_knowledge_candidate_batch",
  "schema_version": 1,
  "run_id": "project-knowledge:mmd-companion:incremental:2026-07-14",
  "workspace_id": "mmd-companion",
  "items": [
    {
      "candidate_id": "dkc_01...",
      "candidate_revision": 1,
      "source_kind": "session_incremental",
      "source_hash": "sha256:...",
      "content_hash": "sha256:...",
      "trigger": {
        "type": "codex_session",
        "pet_session_id": "codex:...",
        "codex_session_id": "019f...",
        "concept_delta_ids": ["concept_delta_01..."]
      },
      "repository_snapshot": {
        "repository_id": "mmd-project",
        "commit_sha": "<repository-commit>"
      },
      "topic_match": {
        "proposed_topic_id": null,
        "topic_identity_key": "mmd-companion/motion-generation/motion-acceptance-gate",
        "possible_topic_ids": []
      },
      "knowledge": {
        "schema_version": 2,
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
          "contract_refs": ["ref_contract_01"],
          "implementation_refs": ["ref_code_01"],
          "test_refs": ["ref_test_01"],
          "validation_refs": ["ref_validation_01"]
        },
        "failure_signals": [],
        "operational_appendix": {
          "steps": [],
          "cautions": []
        },
        "source": {
          "concept_delta_ids": ["concept_delta_01..."],
          "codex_session_ids": ["019f..."],
          "baseline_scan_ids": []
        },
        "evidence_refs": [
          "ref_contract_01",
          "ref_code_01",
          "ref_test_01",
          "ref_validation_01"
        ],
        "open_questions": []
      },
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
      "review_readiness": "ready_for_review",
      "evidence_index": [
        {
          "ref_id": "ref_code_01",
          "role": "implementation",
          "authority": "authoritative",
          "repository_id": "mmd-project",
          "revision": "<repository-commit>",
          "blob_sha": "<blob-sha>",
          "path": "imgToAction/tools/motion_acceptance_gate.py",
          "symbol": "main",
          "line_start": 100,
          "line_end": 140,
          "snippet": "bounded exact source excerpt",
          "snippet_sha256": "sha256:...",
          "resolver_uri": "repo://mmd-project/<commit>/imgToAction/tools/motion_acceptance_gate.py#L100-L140",
          "command": null,
          "outcome": null,
          "exit_code": null
        }
      ],
      "payload_sha256": "sha256:..."
    }
  ],
  "idempotency_key": "knowledge-candidates:sha256:..."
}
```

Response:

```json
{
  "status": "candidate_batch_received",
  "run_id": "project-knowledge:mmd-companion:incremental:2026-07-14",
  "items": [
    {
      "candidate_id": "dkc_01...",
      "candidate_revision": 1,
      "status": "accepted",
      "error": null
    }
  ]
}
```

Allowed item statuses:

```text
accepted
duplicate
rejected
```

Allowed candidate `review_readiness` values:

```text
needs_author_explanation
needs_evidence
ready_for_review
```

Rules:

- Validate service authentication, `kind`, version, run/workspace consistency,
  enum values, sizes, and hashes.
- Preserve the complete inbound candidate revision for audit.
- The same idempotency key and same payload hash returns the original response.
- The same idempotency key with a different payload hash returns
  `idempotency_conflict`.
- A new `candidate_revision` makes unexecuted proposals and approvals for older
  revisions stale.
- OpenClaw may reject a candidate contract, but it may not silently alter it.
- `needs_evidence` or `needs_author_explanation` candidates may be shown for
  triage, but they cannot produce a publishable proposal.

All payload hashes use a jointly tested canonical JSON representation. The
preferred representation is RFC 8785. `payload_sha256` is calculated with its
own field omitted.

## 9. Vault Resolver

For each reviewable candidate, OpenClaw must snapshot the current Vault before
creating a proposal.

Resolution order:

1. exact `topic_id` lookup;
2. exact canonical identity-key lookup when present;
3. alias and prior-name lookup;
4. relation and bounded semantic lookup;
5. no match.

The resolver must use memory-wiki operations equivalent to:

```text
wiki_status
wiki_search
wiki_get
```

It must capture:

- Vault Git revision;
- page path;
- frontmatter `topic_id` and aliases;
- page status;
- complete page content;
- content SHA-256;
- generated/human block boundaries;
- relevant MOC content and hash;
- related, merged, superseded, and superseding pages.

Allowed match states:

```text
no_match
single_match
multiple_matches
overlap
conflict
stale_or_invalid_page
```

`multiple_matches`, `conflict`, and `stale_or_invalid_page` are not publishable
until resolved.

## 10. Canonical Note Contract

### 10.1 Paths

```text
projects/{workspace_id}/domain-knowledge-map.md
projects/{workspace_id}/domains/{domain}/_MOC.md
projects/{workspace_id}/domains/{domain}/{topic-slug}.md
```

`topic_id` is stable identity. Path and title are mutable presentation fields.

### 10.2 Frontmatter

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

Allowed status values:

```text
current
merged
superseded
```

### 10.3 Body

```text
# Title

<!-- project-knowledge:generated:start -->
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
<!-- project-knowledge:generated:end -->

<!-- project-knowledge:human:start -->
## 人工补充
<!-- project-knowledge:human:end -->
```

Rules:

- OpenClaw may update the generated block only through an approved full diff.
- The human block is preserved byte-for-byte unless the reviewed proposal
  explicitly includes a human edit supplied by the user.
- Missing or nested markers cause `stale_or_invalid_page` and block update.
- A new page contains both marker pairs.
- A merged or superseded page retains its history and human block.

### 10.4 Evidence rendering

Code and Contract references must show deterministic locators:

```text
[ref_code_01]
repository=mmd-project
revision=<commit>
blob=<blob-sha>
path=imgToAction/tools/motion_acceptance_gate.py
symbol=main
lines=100-140
snippet_sha256=sha256:...
```

A bounded exact snippet may be included. OpenClaw may omit the snippet for size
or privacy but cannot alter it.

## 11. Publication Proposal

OpenClaw creates one proposal revision per candidate revision and Vault
snapshot. A proposal must be deterministic for the same inputs.

```json
{
  "proposal_id": "dkp_01...",
  "proposal_revision": 1,
  "candidate_id": "dkc_01...",
  "candidate_revision": 1,
  "input_payload_sha256": "sha256:...",
  "vault_revision": "<vault-commit>",
  "match_state": "single_match",
  "publication_action": "update",
  "publishable": true,
  "target": {
    "topic_id": "dkt_01...",
    "path": "projects/mmd-companion/domains/motion-generation/motion-acceptance-gate.md",
    "base_content_sha256": "sha256:...",
    "base_git_revision": "<vault-commit>"
  },
  "source_pages": [],
  "supersedes": [],
  "affected_files": [
    {
      "role": "canonical_target",
      "path": "projects/mmd-companion/domains/motion-generation/motion-acceptance-gate.md",
      "operation": "modify",
      "base_content_sha256": "sha256:...",
      "result_content_sha256": "sha256:..."
    },
    {
      "role": "domain_moc",
      "path": "projects/mmd-companion/domains/motion-generation/_MOC.md",
      "operation": "modify",
      "base_content_sha256": "sha256:...",
      "result_content_sha256": "sha256:..."
    }
  ],
  "document": {
    "frontmatter": {},
    "markdown": "---\n...",
    "sha256": "sha256:..."
  },
  "diff": {
    "format": "unified",
    "files": [
      {
        "path": "projects/mmd-companion/domains/motion-generation/motion-acceptance-gate.md",
        "patch": "@@ ..."
      }
    ],
    "sha256": "sha256:..."
  },
  "reason": "候选与相同 topic_id 的 canonical Note 匹配。",
  "conflict_summary": [],
  "created_at": "2026-07-14T12:05:00+08:00"
}
```

Proposal rules:

- Every affected file must be allowlisted and included in the diff.
- The diff shown for approval must not be truncated. If it is too large, split
  the work into smaller proposals.
- Frontmatter, relation updates, MOC updates, and source-page status changes are
  part of the reviewed diff.
- The proposal stores both base and resulting hashes for every file.
- OpenClaw must not recompute different Markdown after approval.
- A changed Vault revision or target hash makes the proposal stale.

## 12. Publication Action Semantics

### 12.1 `create`

Use when no canonical Note matches the candidate.

Requirements:

- target path does not exist;
- a new stable `topic_id` is present in the FastAPI accepted result before
  publication;
- workspace and domain MOCs include the new Note when required;
- no existing canonical Note has the same `topic_id`.

### 12.2 `update`

Use for the same `topic_id` and same primary retrieval intent.

Requirements:

- target exists;
- base content hash matches;
- human block is preserved;
- approved diff shows all frontmatter, generated-block, relation, and MOC
  changes.

### 12.3 `merge`

Use when two or more existing topics overlap and one canonical Note should own
the combined retrieval intent.

Requirements:

- one target canonical Note is selected;
- all source pages are listed in `source_pages`;
- source pages remain on disk with `status: merged` and `merged_into`;
- target records `merged_from`;
- relations and MOCs are updated;
- all affected pages appear in the reviewed diff.

### 12.4 `supersede`

Use when a new definition, Contract, method, or rule replaces an older topic
without pretending the old knowledge never existed.

Requirements:

- old page remains on disk with `status: superseded` and `superseded_by`;
- new/current page records `supersedes`;
- MOCs and relations reflect current and historical status;
- no physical deletion occurs.

### 12.5 Conflict

Conflict is a match/review state, not a publication action.

A Conflict Proposal must have:

```text
publishable=false
publication_action=none
affected_files=[]
```

The user may choose to keep current content, request evidence, reject, or create
a new proposal revision using `update`, `merge`, or `supersede`. The new
proposal must be reviewed again.

## 13. Review Conversation

OpenClaw must review one candidate/proposal at a time by default.

The user-facing order is:

1. topic title, kind, domain, and aliases;
2. why it was introduced and the failure it addresses;
3. definition and meaning;
4. entities and relationships;
5. boundaries, non-examples, and confused concepts;
6. invariants;
7. technical solution;
8. Contract, implementation, test, and validation evidence;
9. unresolved questions and quality-gate failures;
10. Vault match result;
11. proposed action and target;
12. affected paths;
13. complete diff.

OpenClaw must clearly distinguish:

```text
Content Review
  Is the knowledge correct and sufficiently evidenced?

Publication Review
  Is this the correct action, target page, affected file set, and diff?
```

The user may confirm both in one message, but OpenClaw stores two review records.

Content choices:

```text
accept
edit_accept
needs_evidence
keep_existing
reject
snooze
```

Publication choices:

```text
approve
revise
defer
reject
```

Publication actions:

```text
create
update
merge
supersede
none
```

Rules:

- `needs_evidence`, `keep_existing`, `reject`, or `snooze` cannot approve a
  publication action.
- A conflict can only be deferred, rejected, kept, or revised into a new
  proposal.
- User edits create a new content hash and proposal revision before approval.
- OpenClaw must never treat a vague “looks good” from another context as approval
  for a different candidate revision.
- Review records include reviewer identity, channel, message ID, timestamp, and
  the hashes displayed to the user.

## 14. Review Command Contract

FastAPI polls:

```http
GET /v1/apps/mmd/project-knowledge/runs/{run_id}/commands?cursor=...
Authorization: Bearer <service-token>
```

Response:

```json
{
  "commands": [
    {
      "id": "openclaw_knowledge_cmd_01...",
      "run_id": "project-knowledge:mmd-companion:incremental:2026-07-14",
      "type": "project_knowledge_review_decision",
      "candidate_id": "dkc_01...",
      "candidate_revision": 1,
      "input_payload_sha256": "sha256:...",
      "content_review": {
        "decision": "edit_accept",
        "approved_knowledge": {},
        "approved_knowledge_sha256": "sha256:...",
        "missing_evidence_requests": [],
        "notes": null
      },
      "publication_review": {
        "decision": "approve",
        "proposal_id": "dkp_01...",
        "proposal_revision": 2,
        "action": "update",
        "target_path": "projects/mmd-companion/domains/motion-generation/motion-acceptance-gate.md",
        "base_content_sha256": "sha256:...",
        "base_git_revision": "<vault-commit>",
        "approved_document_sha256": "sha256:...",
        "approved_diff_sha256": "sha256:..."
      },
      "reviewer": {
        "user_id": "admin-1",
        "channel": "openclaw",
        "message_id": "msg-...",
        "confirmed_at": "2026-07-14T12:10:00+08:00"
      },
      "supersedes_command_id": null,
      "idempotency_key": "knowledge-review:sha256:..."
    }
  ],
  "cursor": "openclaw-knowledge-command:..."
}
```

Command rules:

- Commands are append-only and globally unique.
- Replaying the same command ID returns the first application result.
- One active executable command is allowed per candidate revision.
- A revised decision creates a new command and references
  `supersedes_command_id`.
- `needs_evidence`, `keep_existing`, `reject`, and `snooze` omit executable
  publication approval.
- A stale candidate or proposal remains in the command log but is not returned
  as executable after it becomes stale.

## 15. FastAPI Command Result

FastAPI posts:

```http
POST /v1/apps/mmd/project-knowledge/commands/{command_id}/result
Authorization: Bearer <service-token>
Content-Type: application/json
```

Success:

```json
{
  "run_id": "project-knowledge:mmd-companion:incremental:2026-07-14",
  "command_id": "openclaw_knowledge_cmd_01...",
  "status": "succeeded",
  "result": {
    "application_status": "applied",
    "candidate_status": "approved",
    "accepted_version_id": "dkv_01...",
    "change_set_id": "dkcs_01...",
    "publish_ticket_id": "dkpt_01...",
    "topic_id": "dkt_01...",
    "expected_action": "update",
    "expected_target_path": "projects/mmd-companion/domains/motion-generation/motion-acceptance-gate.md",
    "expected_document_sha256": "sha256:...",
    "expected_diff_sha256": "sha256:..."
  },
  "error": null,
  "completed_at": "2026-07-14T12:11:00+08:00"
}
```

Allowed `application_status` values:

```text
applied
duplicate
stale
rejected
```

On `applied`, OpenClaw moves the run/candidate to
`awaiting_publish_payloads`. On `stale`, it discards the executable proposal,
refreshes the candidate/Vault snapshot, and asks the user to review a new diff.

Failure results retain the command and error code. OpenClaw must not fabricate a
change-set or continue to publication.

## 16. Publish Payload Contract

Endpoint:

```http
POST /v1/apps/mmd/project-knowledge/runs/{run_id}/publish-payloads
Authorization: Bearer <service-token>
Content-Type: application/json
```

Request:

```json
{
  "kind": "project_domain_knowledge_wiki_payload_batch",
  "schema_version": 1,
  "run_id": "project-knowledge:mmd-companion:incremental:2026-07-14",
  "payloads": [
    {
      "publish_ticket_id": "dkpt_01...",
      "change_set_id": "dkcs_01...",
      "decision_command_id": "openclaw_knowledge_cmd_01...",
      "candidate_id": "dkc_01...",
      "candidate_revision": 1,
      "accepted_version_id": "dkv_01...",
      "topic_id": "dkt_01...",
      "authorization": {
        "action": "update",
        "target_path": "projects/mmd-companion/domains/motion-generation/motion-acceptance-gate.md",
        "base_content_sha256": "sha256:...",
        "base_git_revision": "<vault-commit>",
        "approved_knowledge_sha256": "sha256:...",
        "approved_document_sha256": "sha256:...",
        "approved_diff_sha256": "sha256:...",
        "approved_by": "admin-1",
        "approved_at": "2026-07-14T12:10:00+08:00"
      },
      "knowledge": {},
      "wiki": {
        "files": [
          {
            "role": "canonical_target",
            "path": "projects/mmd-companion/domains/motion-generation/motion-acceptance-gate.md",
            "operation": "modify",
            "base_content_sha256": "sha256:...",
            "result_content_sha256": "sha256:...",
            "markdown": "---\n..."
          }
        ],
        "approved_diff": {
          "format": "unified",
          "files": [],
          "sha256": "sha256:..."
        }
      },
      "evidence_index": [],
      "provenance": {
        "repository_commit": "<repository-commit>",
        "codex_session_ids": ["019f..."],
        "concept_delta_ids": ["concept_delta_01..."],
        "baseline_scan_ids": []
      },
      "idempotency_key": "knowledge-publish:dkpt_01..."
    }
  ]
}
```

Response is per item:

```json
{
  "status": "publish_payloads_received",
  "items": [
    {
      "publish_ticket_id": "dkpt_01...",
      "status": "accepted",
      "error": null
    }
  ]
}
```

Allowed item statuses:

```text
accepted
duplicate
rejected
```

Validation rules:

- Match the publish ticket, change set, decision command, candidate revision,
  action, target, all hashes, and reviewer against the locally reviewed
  proposal and command result.
- FastAPI must not change the accepted action, target, Markdown, affected files,
  or hashes after review.
- A mismatch returns `authorization_mismatch` and causes zero Vault writes.
- Same ticket and same payload returns the existing job.
- Same ticket or idempotency key with a different payload hard-fails.

## 17. Publish Transaction

OpenClaw must execute each change set as one recoverable transaction.

### 17.1 Preflight

1. Acquire a workspace/Vault publication lock.
2. Load the reviewed proposal, command result, and publish payload.
3. Verify all IDs, revisions, and hashes again.
4. Fetch/update Vault Git remote metadata without modifying files.
5. Ensure the publishing branch is not behind or diverged from its configured
   upstream.
6. Run `git status --porcelain`.
7. Stop if unrelated dirty files exist.
8. Read every target file and verify the approved base content hash.
9. Verify create targets do not exist.
10. Verify all affected paths are inside the configured project-knowledge root.

Any failure before apply produces zero file writes.

### 17.2 Apply

1. Apply the exact approved Markdown for every allowlisted file.
2. Do not regenerate content from the knowledge object.
3. Recompute every result content hash.
4. Require equality with the approved result hash.
5. Compute the actual unified diff.
6. Require equality with the approved diff hash.
7. If any mismatch occurs, restore only the files changed by this transaction
   from the captured preflight snapshots and mark the job failed. Do not touch
   unrelated files.

### 17.3 Lint and compile

Run memory-wiki validation equivalent to:

```text
wiki_lint
wiki_compile / autoCompile
```

Lint must validate the complete affected set, including MOCs and relation
updates.

### 17.4 Stage, commit, and push

1. Stage only the reviewed allowlisted paths.
2. Compare the staged diff hash with the approved diff hash.
3. Create one commit for the change set or a configured atomic batch.
4. Include recovery trailers:

```text
Project-Knowledge-Publish-Ticket: dkpt_01...
Project-Knowledge-Change-Set: dkcs_01...
Project-Knowledge-Decision: openclaw_knowledge_cmd_01...
```

5. Push to the configured upstream.
6. Mark `published` only after push succeeds.

OpenClaw must never automatically run:

```text
git merge
git rebase
git reset
git stash
automatic conflict resolution
```

## 18. Wiki Lint Gates

Publication is blocked when any of the following is true:

- Content Review is missing or not accepted.
- Publication Review is missing or not approved.
- Candidate, proposal, or accepted version is stale.
- The proposal is a conflict or `publishable=false`.
- Required evidence is missing.
- `topic_id` is duplicated among current canonical Notes.
- The action conflicts with target existence or status.
- Target base hash or Vault revision changed after review.
- A code/Contract/test reference is not in the FastAPI evidence index.
- An implementation ref lacks repository revision, path, and snippet/blob hash.
- The technical solution lacks implementation or Contract evidence.
- The technical solution lacks test or validation evidence.
- A formal Contract topic lacks Contract evidence.
- The diff includes an unreviewed path.
- A page would be physically deleted.
- A human block would be changed without explicit reviewed user input.
- Generated/human markers are invalid.
- Absolute local paths, secrets, or full transcript content appear.
- Frontmatter, relation targets, MOC links, or Obsidian Markdown are invalid.
- Resulting file hashes or diff hash differ from the approved values.

Lint warnings may be published only when the configured policy explicitly marks
them non-blocking and the receipt reports them.

## 19. Publish Status Contract

FastAPI polls:

```http
GET /v1/apps/mmd/project-knowledge/runs/{run_id}/publish-status?cursor=...
Authorization: Bearer <service-token>
```

Response:

```json
{
  "run_id": "project-knowledge:mmd-companion:incremental:2026-07-14",
  "cursor": "openclaw-knowledge-publish:...",
  "items": [
    {
      "publish_ticket_id": "dkpt_01...",
      "change_set_id": "dkcs_01...",
      "candidate_id": "dkc_01...",
      "candidate_revision": 1,
      "status": "published",
      "action": "update",
      "topic_id": "dkt_01...",
      "target_path": "projects/mmd-companion/domains/motion-generation/motion-acceptance-gate.md",
      "approved_document_sha256": "sha256:...",
      "published_document_sha256": "sha256:...",
      "lint": {
        "status": "passed",
        "errors": [],
        "warnings": []
      },
      "git": {
        "commit_sha": "<vault-commit>",
        "remote": "origin",
        "branch": "main",
        "pushed": true
      },
      "error": null,
      "updated_at": "2026-07-14T12:15:00+08:00"
    }
  ]
}
```

Allowed publish job statuses:

```text
received
preflight
blocked
applying
linting
committed
pushing
published
failed
conflict
```

`blocked` and `conflict` include a reason code and whether user action is
required:

```json
{
  "reason_code": "stale_target_revision",
  "requires_user": true,
  "retryable": false
}
```

Recommended reason codes:

```text
dirty_vault
upstream_behind
upstream_diverged
stale_target_revision
target_exists
target_missing
authorization_mismatch
approved_diff_mismatch
lint_failed
push_failed
invalid_markers
unresolved_conflict
evidence_invalid
secret_detected
```

## 20. Idempotency And Crash Recovery

Hard invariants:

1. Replaying a candidate revision does not overwrite user edits or create a new
   proposal unless the Vault snapshot changed.
2. Replaying a command ID returns its original result.
3. Replaying the same publish ticket and payload returns the existing job and
   receipt.
4. Reusing an idempotency key with different content hard-fails.
5. A new candidate revision makes old review approval stale.
6. A changed target hash makes the proposal stale.
7. `published` means lint, commit, and push all succeeded.
8. Conflict, needs-evidence, keep-existing, reject, and snooze decisions never
   create a publish ticket.
9. If apply occurred but lint failed, restore only transaction-owned files and
   do not commit.
10. If commit succeeded but push failed, retry push from the same commit; do not
    reapply or create a second commit.
11. If push succeeded but the acknowledgement was lost, recover by Git commit
    trailer and produce the original receipt.
12. A process restart resumes from durable job events and never from inferred
    in-memory state.

## 21. Failure Handling

| Failure | Required OpenClaw behavior |
| --- | --- |
| Candidate schema invalid | Reject item, retain audit payload, return per-item error. |
| Evidence missing | Show `needs_evidence`; create no publishable proposal. |
| Multiple Wiki matches | Show candidates; require user selection or topic split. |
| Definition/invariant conflict | Create non-publishable Conflict Proposal. |
| User rejects or keeps existing | Queue decision; perform zero Vault writes. |
| FastAPI rejects stale command | Refresh candidate/Vault and require a new review. |
| Publish payload differs from approval | Reject with `authorization_mismatch`. |
| Target hash changed | Mark `conflict`; require a new proposal and review. |
| Unrelated dirty Vault files | Mark `blocked`; do not stash or modify them. |
| Vault branch behind/diverged | Mark `blocked`; require external/user resolution. |
| Lint fails | Restore transaction files; do not commit or push. |
| Commit fails | Keep audit state, restore transaction files when safe, report failure. |
| Push fails | Retain commit and retry push explicitly without a new commit. |
| Receipt delivery fails | Preserve receipt for cursor-based retry. |

## 22. Security And Privacy

- Authenticate every Control Plane route with a scoped service token.
- Authorize run/workspace ownership on every request.
- Enforce maximum candidates, evidence refs, snippet bytes, Markdown bytes,
  affected files, and diff bytes.
- Reject paths outside the configured Vault project-knowledge root.
- Reject `..`, absolute paths, symlink escapes, and unexpected file extensions.
- Redact secret-like values before conversation rendering and persistence.
- Never expose full bounded payloads in user-facing conversation by default.
- Commands, code, and snippets are inert display data.
- Store reviewer identity and message provenance.
- Audit every candidate receipt, proposal revision, review, command, apply step,
  lint result, Git result, and receipt delivery.

## 23. Observability

OpenClaw must expose or record:

- review run status and age;
- candidate ingestion counts by result;
- Vault resolution latency and match state;
- proposal action and revision;
- content/publication review result;
- command queue cursor, status, and age;
- accepted change-set wait time;
- publish job phase and retry count;
- base-hash conflicts;
- lint failures by reason;
- Git blocked/failed state;
- commit and push success;
- publication receipt cursor and delivery status;
- idempotency conflicts and stale approvals.

Operational dashboards should separate:

```text
awaiting user review
awaiting FastAPI command result
awaiting publish payload
blocked by Vault state
failed and retryable
failed and requires user action
published
```

## 24. Required Acceptance Scenarios

OpenClaw v2 is not complete until automated tests cover:

1. Receive and idempotently persist a new candidate batch.
2. Reject the same idempotency key with a different payload.
3. Resolve no-match and propose `create`.
4. Resolve one canonical match and propose `update`.
5. Preserve a human block during update.
6. Propose `merge` and retain source pages with bidirectional relations.
7. Propose `supersede` and retain the old page with bidirectional relations.
8. Detect conflicting definition/invariant and produce zero affected files.
9. Handle missing evidence with zero Vault writes.
10. Handle user keep/reject/snooze with zero Vault writes.
11. Store Content Review and Publication Review separately.
12. Reject a stale candidate revision.
13. Reject a stale proposal revision.
14. Reject a changed target base hash after review.
15. Reject a publish payload that differs from the reviewed proposal.
16. Apply only allowlisted paths.
17. Compare actual and approved file/diff hashes.
18. Block invalid frontmatter, links, evidence, or markers.
19. Block unrelated dirty Vault files.
20. Block behind/diverged upstream state.
21. Ensure lint failure does not commit or push.
22. Ensure push retry does not create a second commit.
23. Recover a lost acknowledgement from Git trailers.
24. Replay candidates, commands, and publish payloads without duplicates.
25. Return a receipt whose published hash equals the approved hash.
26. Open the resulting MOC and canonical Note successfully in Obsidian.
27. Resolve every displayed code reference back to the fixed repository
    revision/path/blob/snippet.

## 25. Rollout

### Stage 0: Contract fixtures

- implement JSON schema fixtures for candidate, proposal, command, command
  result, publish payload, and receipt;
- agree canonical JSON and hash fixtures with FastAPI;
- implement durable stores and idempotency tests.

### Stage 1: Review-only shadow mode

- receive candidates;
- resolve Vault;
- generate and display proposals;
- allow user review;
- queue commands to a test FastAPI adapter;
- prohibit real Vault writes.

### Stage 2: Local disposable Vault

- apply exact accepted change sets to a disposable Git-backed Vault;
- exercise lint, commit, push, and recovery scenarios;
- validate Obsidian rendering.

### Stage 3: Production Vault with manual enablement

- enable one workspace and one reviewer;
- require explicit per-proposal approval;
- retain v1 Review Memory flow separately;
- monitor stale, blocked, lint, and push failures.

### Stage 4: Baseline scan batches

- accept baseline candidates from FastAPI;
- keep the same review and publish state machines;
- limit batch size and never bulk-accept conflicts.

## 26. Legacy Compatibility

The existing OpenClaw Codex Review Memory flow remains supported for current
v1 endpoints and pages:

```text
/v1/apps/mmd/codex-review/...
sources/codex-review/...
accept | edit_accept | ignore | snooze
```

Domain Knowledge v2 uses a separate namespace and semantics:

```text
/v1/apps/mmd/project-knowledge/...
projects/{workspace_id}/domains/...
Content Review + Publication Review
create | update | merge | supersede
```

OpenClaw must not translate v1 accepted memories directly into v2 canonical
Notes. A selected legacy item must return through FastAPI as a
`source_kind=legacy_import` candidate and receive normal v2 evidence and review.

## 27. Definition Of Done

The OpenClaw implementation is done when:

- this single file is sufficient to implement the OpenClaw side;
- candidate ingestion is durable, bounded, authenticated, and idempotent;
- Vault resolution creates deterministic proposals;
- the user reviews content and publication separately in OpenClaw;
- conflicts and missing evidence produce zero writes;
- accepted commands round-trip through FastAPI;
- OpenClaw receives and validates the exact accepted change set;
- the exact reviewed files are applied with optimistic concurrency;
- lint, commit, push, and crash recovery are implemented;
- publication receipts bind the final hash and commit to the approved change
  set;
- Obsidian exposes canonical Notes, MOCs, aliases, relations, and history;
- v1 Review Memory remains isolated and functional.
