---
name: codex-session-knowledge-extraction
description: Use when OpenClaw receives a bounded Codex session evidence pack, explicit Concept Deltas, and fixed-revision repository evidence and must propose zero to three project Domain Knowledge v2 drafts for deterministic FastAPI validation.
---

# Codex Session Domain Knowledge Synthesis

## Core Contract

Use only the supplied evidence pack. Do not read local files, fetch URLs, resume Codex, execute commands, approve actions, or infer facts from an unavailable transcript.

Return exactly one JSON object and no Markdown outside JSON. Keep JSON keys, enum values, IDs, paths, commands, symbols, hashes, and quoted errors unchanged. Write user-facing prose in Simplified Chinese.

The default result is `no_wiki`. A session summary, changed-file list, code inventory, or work log is not Domain Knowledge.

This Skill synthesizes an untrusted draft. FastAPI's Deterministic Gate validates schema, reconciles evidence, assigns readiness, and resolves topic identity. Do not claim that a candidate is verified, accepted, publishable, or ready for Obsidian.

## Required Knowledge Shape

Create a candidate only when one topic can answer all of these:

1. What project-specific concept, entity, relationship, rule, workflow, contract, gate, policy, decision, or failure classification exists?
2. What problem caused it to be introduced?
3. What does it mean, including relationships, boundaries, non-examples, confused concepts, and invariants?
4. What technical solution realizes it?
5. Which existing Evidence Reference IDs support the Contract, implementation, test, validation, Git fact, or session provenance?

One candidate serves one primary retrieval intent. Prefer one complete candidate over several weak candidates.

## Authority Rules

- Repository evidence at a fixed revision is authoritative for Contract, code, tests, validation artifacts, and Git facts.
- A Concept Delta is the author's intended meaning. It is a claim pending repository reconciliation and human review.
- Session prose provides provenance and reasoning, not authoritative code locators.
- Obsidian is not written by this Skill.
- OpenClaw must not create or mutate Evidence Reference locator fields.

Evidence discipline:

- Cite only `ref_id` values already present in `repository_evidence.evidence_refs` or the supplied canonical `evidence_index`.
- Never invent or repair repository IDs, revisions, blob hashes, paths, symbols, line numbers, snippets, snippet hashes, commands, outcomes, or exit codes.
- Do not copy locator objects into the response. Return reference IDs only; FastAPI performs reconciliation.
- Treat legacy `code_index` entries as session hints unless the pack explicitly identifies them as canonical Repository Resolver output.
- If required evidence is absent, keep the gap in `open_questions` and reject the topic with `reason_code=needs_evidence`; do not fabricate a completed candidate.

## Concept Delta Rules

For `contract`, `workflow`, `rule`, `gate`, or `policy` topics, require an explicit Concept Delta ID from the input.

- Do not author a missing Concept Delta for Codex.
- Do not turn inferred terminology into a confirmed definition.
- When a term change is reported without a Concept Delta, reject it with `reason_code=needs_author_explanation`.
- Preserve the intended definition while clearly separating it from verified repository facts.

## Synthesis Workflow

1. Identify explicit Concept Deltas and the problem each term was introduced to solve.
2. Reconstruct only the durable topic supported by session evidence.
3. Link the topic to canonical repository evidence IDs.
4. Write the meaning explicitly: definition, entities, relationships, boundaries, non-examples, confused concepts, and invariants.
5. Explain the technical solution and divide evidence into Contract, implementation, test, and validation refs.
6. Put procedural details in `operational_appendix` only when useful; do not force every concept into Runbook steps.
7. Reject progress narration, temporary maintenance, unresolved guesses, and duplicates of authoritative documentation that add no explanatory value.
8. Return at most three candidates.

## Output Schema

Use disposition value `"no_wiki"` or `"domain_knowledge_candidates"`.

Return:

```json
{
  "schema_version": 2,
  "disposition": "no_wiki | domain_knowledge_candidates",
  "assessment": {
    "summary": "string",
    "candidate_count": 0,
    "needs_human_review": true,
    "evidence_refs": ["existing-ref-id"]
  },
  "candidates": [
    {
      "candidate_id": "stable-kebab-case-proposal-id",
      "source_kind": "session_incremental",
      "draft": {
        "schema_version": 2,
        "topic_id": null,
        "topic_identity_key": "workspace/domain/stable-topic-key",
        "topic_kind": "concept | entity | relationship | rule | workflow | contract | gate | policy | decision | failure_classification",
        "domain": "string",
        "title": "string",
        "aliases": ["string"],
        "introduced_for": {
          "problem": "string",
          "context": "string",
          "failure_before_introduction": "string"
        },
        "meaning": {
          "definition": "string",
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
          "summary": "string",
          "architecture_flow": [],
          "contract_refs": ["existing-ref-id"],
          "implementation_refs": ["existing-ref-id"],
          "test_refs": ["existing-ref-id"],
          "validation_refs": ["existing-ref-id"]
        },
        "failure_signals": ["string"],
        "operational_appendix": {
          "steps": [],
          "cautions": []
        },
        "source": {
          "concept_delta_ids": ["existing-concept-delta-id"],
          "codex_session_ids": ["existing-session-id"],
          "baseline_scan_ids": []
        },
        "evidence_refs": ["existing-ref-id"],
        "open_questions": ["string"]
      },
      "evidence_refs": ["existing-ref-id"],
      "confidence": 0.0
    }
  ],
  "rejected_items": [
    {
      "title": "string",
      "reason_code": "status_only | temporary_noise | unresolved | not_reusable | duplicate_authoritative_doc | needs_evidence | needs_author_explanation | low_value",
      "reason": "string",
      "evidence_refs": ["existing-ref-id"]
    }
  ]
}
```

## Candidate Rules

- `topic_identity_key` is a stable proposal key, never a session ID, date, title hash, or file path.
- `topic_id` stays null unless the input provides an existing canonical topic ID.
- `introduced_for` explains the concrete problem, context, and prior failure mode.
- `meaning.relationships`, all four boundary lists, and `meaning.invariants` must be present even when explicitly empty.
- A formal `contract` topic cites at least one Contract ref.
- A candidate cites at least one Contract or implementation ref and at least one test or validation ref. Otherwise reject it as `needs_evidence`.
- `technical_solution` explains how the evidence works together; it is not a changed-file list.
- `evidence_refs` is the union of refs used by the draft. Every nested ref must also appear there.
- `confidence` expresses synthesis confidence only. It is not verification status.
- Do not emit `quality_gate`, `publish_status`, `publication_action`, target path, Wiki diff, or accepted hashes. Later deterministic and human-review stages own them.

## Rejection Rules

Reject:

- task progress, completion reports, timestamps, session IDs as topics, or file inventories;
- one-off cleanup and test-maintenance noise;
- unresolved hypotheses stated as facts;
- a Codex-created Contract, Workflow, Rule, Gate, or Policy without a Concept Delta;
- topics without canonical implementation/Contract and test/validation evidence;
- duplicates of an authoritative Skill/spec that add no domain explanation;
- broad pages combining multiple retrieval intents.

It is correct to return zero candidates.

## Final Checks

Before returning:

- `assessment.candidate_count` equals `len(candidates)`;
- `no_wiki` has an empty `candidates` list;
- `domain_knowledge_candidates` has one to three candidates;
- all required Domain Knowledge v2 sections are explicit;
- every cited ID exists in the input;
- exact locator facts were neither copied with mutations nor invented;
- missing author explanation or evidence is rejected explicitly rather than silently completed.
