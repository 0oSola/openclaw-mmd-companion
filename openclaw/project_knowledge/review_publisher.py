from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import UTC, datetime
from pathlib import PurePosixPath, PureWindowsPath
from threading import RLock
from typing import Any, Callable, Protocol


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def canonical_sha256(value: Any) -> str:
    if isinstance(value, str):
        encoded = value.encode("utf-8")
    else:
        encoded = _canonical_json(value).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _load_json(value: str | None, default: Any) -> Any:
    if not value:
        return default
    return json.loads(value)


def _safe_vault_path(value: str) -> bool:
    normalized = str(value or "").replace("\\", "/").strip()
    if (
        not normalized
        or normalized.startswith(("/", "~"))
        or PureWindowsPath(normalized).is_absolute()
        or ".." in PurePosixPath(normalized).parts
    ):
        return False
    return True


def _safe_knowledge_path(value: str, *, roots: tuple[str, ...] = ("projects",)) -> bool:
    normalized = str(value or "").replace("\\", "/").strip().rstrip("/")
    if not _safe_vault_path(normalized):
        return False
    return any(normalized == root or normalized.startswith(root + "/") for root in roots)


class MemoryWikiOperations(Protocol):
    def status(self) -> dict[str, Any]: ...

    def search(self, query: str) -> list[dict[str, Any]]: ...

    def get(self, path: str) -> dict[str, Any] | None: ...

    def apply_exact(self, *, files: list[dict[str, Any]], expected_vault_revision: str) -> dict[str, Any]: ...

    def restore_exact(self, *, snapshots: list[dict[str, Any]], expected_vault_revision: str) -> dict[str, Any]: ...

    def lint(self, *, paths: list[str]) -> dict[str, Any]: ...

    def compile(self) -> dict[str, Any]: ...

    def commit_push(
        self,
        *,
        paths: list[str],
        message: str,
        trailers: dict[str, str],
    ) -> dict[str, Any]: ...


class OpenClawKnowledgeStore:
    """OpenClaw-owned durable review, proposal, change-set and receipt ledger."""

    def __init__(self, db_path):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA busy_timeout=5000")
        self._init_db()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def _init_db(self) -> None:
        with self._lock:
            self._conn.executescript(
                """
                PRAGMA journal_mode=WAL;

                CREATE TABLE IF NOT EXISTS project_knowledge_review_task (
                    review_task_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    delivery_id TEXT NOT NULL UNIQUE,
                    workspace_key TEXT NOT NULL,
                    candidate_id TEXT NOT NULL,
                    candidate_revision INTEGER NOT NULL,
                    evidence_revision INTEGER NOT NULL,
                    payload_hash TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    status TEXT NOT NULL,
                    content_review_json TEXT,
                    topic_resolution_json TEXT,
                    proposal_json TEXT,
                    publication_review_json TEXT,
                    change_set_json TEXT,
                    receipt_json TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS project_knowledge_review_run (
                    run_id TEXT PRIMARY KEY,
                    workspace_key TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS project_knowledge_review_event (
                    event_id TEXT PRIMARY KEY,
                    review_task_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    payload_hash TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS project_knowledge_receipt_mirror (
                    change_set_id TEXT PRIMARY KEY,
                    receipt_hash TEXT NOT NULL,
                    receipt_json TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_project_knowledge_review_task_status
                ON project_knowledge_review_task(status, updated_at);
                """
            )
            self._conn.commit()

    @staticmethod
    def _row(row: sqlite3.Row | None) -> dict[str, Any] | None:
        return dict(row) if row is not None else None

    def get_by_delivery(self, delivery_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM project_knowledge_review_task WHERE delivery_id = ?",
                (delivery_id,),
            ).fetchone()
            return self._decode_task(row)

    def get(self, review_task_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM project_knowledge_review_task WHERE review_task_id = ?",
                (review_task_id,),
            ).fetchone()
            return self._decode_task(row)

    def list_tasks(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM project_knowledge_review_task ORDER BY created_at, review_task_id"
            ).fetchall()
            return [self._decode_task(row) for row in rows if row is not None]

    def save_task(self, task: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            self._conn.execute(
                """
                UPDATE project_knowledge_review_task
                SET status = ?, content_review_json = ?, topic_resolution_json = ?,
                    proposal_json = ?, publication_review_json = ?, change_set_json = ?,
                    receipt_json = ?, updated_at = ?
                WHERE review_task_id = ?
                """,
                (
                    task["status"],
                    _json(task.get("content_review")) if task.get("content_review") is not None else None,
                    _json(task.get("topic_resolution")) if task.get("topic_resolution") is not None else None,
                    _json(task.get("proposal")) if task.get("proposal") is not None else None,
                    _json(task.get("publication_review"))
                    if task.get("publication_review") is not None
                    else None,
                    _json(task.get("change_set")) if task.get("change_set") is not None else None,
                    _json(task.get("receipt")) if task.get("receipt") is not None else None,
                    _now_iso(),
                    task["review_task_id"],
                ),
            )
            self._conn.execute(
                """
                UPDATE project_knowledge_review_run
                SET status = ?, updated_at = ?
                WHERE run_id = ?
                """,
                (_run_status(task["status"]), _now_iso(), task["run_id"]),
            )
            self._conn.commit()
            return self.get(task["review_task_id"]) or task

    def claim_publish(self, review_task_id: str) -> dict[str, Any]:
        now = _now_iso()
        with self._lock:
            cursor = self._conn.execute(
                """
                UPDATE project_knowledge_review_task
                SET status = 'publishing', updated_at = ?
                WHERE review_task_id = ? AND status = 'accepted_change_set_pending'
                """,
                (now, review_task_id),
            )
            if cursor.rowcount == 1:
                self._conn.execute(
                    """
                    UPDATE project_knowledge_review_run
                    SET status = 'publishing', updated_at = ?
                    WHERE run_id = (
                        SELECT run_id FROM project_knowledge_review_task
                        WHERE review_task_id = ?
                    )
                    """,
                    (now, review_task_id),
                )
            self._conn.commit()
            row = self._conn.execute(
                "SELECT * FROM project_knowledge_review_task WHERE review_task_id = ?",
                (review_task_id,),
            ).fetchone()
            task = self._decode_task(row)
            if task is None:
                raise ValueError("review task not found")
            task["_publish_claimed"] = cursor.rowcount == 1
            return task

    def create_task(
        self,
        *,
        review_task_id: str,
        run_id: str,
        delivery_id: str,
        workspace_key: str,
        candidate_id: str,
        candidate_revision: int,
        evidence_revision: int,
        payload_hash: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        now = _now_iso()
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO project_knowledge_review_task (
                    review_task_id, run_id, delivery_id, workspace_key, candidate_id,
                    candidate_revision, evidence_revision, payload_hash, payload_json,
                    status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    review_task_id,
                    run_id,
                    delivery_id,
                    workspace_key,
                    candidate_id,
                    candidate_revision,
                    evidence_revision,
                    payload_hash,
                    _json(payload),
                    "content_review_pending",
                    now,
                    now,
                ),
            )
            self._conn.execute(
                """
                INSERT INTO project_knowledge_review_run (
                    run_id, workspace_key, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(run_id) DO UPDATE SET
                    status = excluded.status,
                    updated_at = excluded.updated_at
                """,
                (run_id, workspace_key, "needs_user_review", now, now),
            )
            self._conn.commit()
            self._append_event_locked(
                review_task_id=review_task_id,
                event_type="delivery_received",
                payload=payload,
            )
            return self.get(review_task_id) or {}

    def append_event(self, *, review_task_id: str, event_type: str, payload: dict[str, Any]) -> None:
        with self._lock:
            self._append_event_locked(review_task_id=review_task_id, event_type=event_type, payload=payload)
            self._conn.commit()

    def queue_receipt_mirror(self, receipt: dict[str, Any]) -> dict[str, Any]:
        change_set_id = str(receipt.get("change_set_id") or "").strip()
        if not change_set_id:
            raise ValueError("receipt change_set_id is required")
        receipt_hash = canonical_sha256(receipt)
        now = _now_iso()
        with self._lock:
            existing = self._conn.execute(
                "SELECT * FROM project_knowledge_receipt_mirror WHERE change_set_id = ?",
                (change_set_id,),
            ).fetchone()
            if existing is not None:
                if existing["receipt_hash"] != receipt_hash:
                    raise ValueError("publication receipt is immutable")
                return {
                    "change_set_id": change_set_id,
                    "status": existing["status"],
                    "receipt": _load_json(existing["receipt_json"], {}),
                }
            self._conn.execute(
                """
                INSERT INTO project_knowledge_receipt_mirror (
                    change_set_id, receipt_hash, receipt_json, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (change_set_id, receipt_hash, _json(receipt), "pending", now, now),
            )
            self._conn.commit()
            return {"change_set_id": change_set_id, "status": "pending", "receipt": receipt}

    def list_pending_receipt_mirrors(self, *, limit: int = 20) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT * FROM project_knowledge_receipt_mirror
                WHERE status = 'pending'
                ORDER BY created_at, change_set_id
                LIMIT ?
                """,
                (max(1, min(int(limit), 100)),),
            ).fetchall()
            return [
                {
                    **(self._row(row) or {}),
                    "receipt": _load_json(row["receipt_json"], {}),
                }
                for row in rows
            ]

    def mark_receipt_mirrored(self, change_set_id: str) -> dict[str, Any] | None:
        now = _now_iso()
        with self._lock:
            self._conn.execute(
                """
                UPDATE project_knowledge_receipt_mirror
                SET status = 'mirrored', updated_at = ?
                WHERE change_set_id = ?
                """,
                (now, change_set_id),
            )
            self._conn.commit()
            row = self._conn.execute(
                "SELECT * FROM project_knowledge_receipt_mirror WHERE change_set_id = ?",
                (change_set_id,),
            ).fetchone()
            if row is None:
                return None
            result = self._row(row) or {}
            result["receipt"] = _load_json(row["receipt_json"], {})
            return result

    def list_events(self, review_task_id: str) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT event_id, review_task_id, event_type, payload_hash, payload_json, created_at
                FROM project_knowledge_review_event
                WHERE review_task_id = ?
                ORDER BY created_at, event_id
                """,
                (review_task_id,),
            ).fetchall()
            return [
                {
                    **(self._row(row) or {}),
                    "payload": _load_json(row["payload_json"], {}),
                }
                for row in rows
            ]

    def _append_event_locked(self, *, review_task_id: str, event_type: str, payload: dict[str, Any]) -> None:
        event_id = "event_" + hashlib.sha256(
            f"{review_task_id}:{event_type}:{canonical_sha256(payload)}".encode("utf-8")
        ).hexdigest()[:24]
        self._conn.execute(
            """
            INSERT OR IGNORE INTO project_knowledge_review_event (
                event_id, review_task_id, event_type, payload_hash, payload_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (event_id, review_task_id, event_type, canonical_sha256(payload), _json(payload), _now_iso()),
        )

    def _decode_task(self, row: sqlite3.Row | None) -> dict[str, Any] | None:
        item = self._row(row)
        if item is None:
            return None
        for field in (
            "payload",
            "content_review",
            "topic_resolution",
            "proposal",
            "publication_review",
            "change_set",
            "receipt",
        ):
            item[field] = _load_json(item.pop(f"{field}_json", None), None)
        item["candidate_payload"] = item["payload"]
        change_set = item.get("change_set") or {}
        if change_set:
            item["change_set_id"] = change_set.get("change_set_id")
        return item


class TopicResolver:
    def __init__(self, wiki: MemoryWikiOperations):
        self.wiki = wiki

    def resolve(
        self,
        candidate_payload: dict[str, Any],
        *,
        approved_knowledge: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        candidate = candidate_payload.get("candidate") or {}
        approved = approved_knowledge or {}
        queries = [
            str(approved.get("title") or candidate.get("title") or "").strip(),
            str(approved.get("topic_identity_key") or "").strip(),
            *[
                str(item).strip()
                for item in (
                    approved.get("aliases")
                    or candidate.get("related_topic_hints")
                    or []
                )
                if str(item).strip()
            ],
        ]
        matches: dict[str, dict[str, Any]] = {}
        for query in queries:
            if not query:
                continue
            for page in self.wiki.search(query):
                path = str(page.get("path") or "")
                if path:
                    matches[path] = page
        pages: list[dict[str, Any]] = []
        stale_page = False
        for path, search_page in matches.items():
            snapshot = self.wiki.get(path)
            if snapshot is None:
                stale_page = True
                pages.append({**search_page, "path": path, "snapshot_missing": True})
            else:
                pages.append({**search_page, **snapshot, "path": path})
        if stale_page:
            state = "stale_or_invalid_page"
        elif not pages:
            state = "no_match"
        elif len(pages) == 1:
            state = "single_match"
        else:
            state = "multiple_matches"
        return {
            "match_state": state,
            "possible_topic_ids": [
                str(page.get("topic_id"))
                for page in pages
                if page.get("topic_id")
            ],
            "pages": pages,
            "vault_revision": str((self.wiki.status() or {}).get("vault_revision") or ""),
        }


def _run_status(task_status: str) -> str:
    return {
        "content_review_pending": "needs_user_review",
        "publication_review_pending": "needs_user_review",
        "accepted_change_set_pending": "awaiting_publish",
        "publishing": "publishing",
        "published": "published",
        "blocked": "blocked",
        "rejected": "no_publishable_candidates",
        "conflict": "blocked",
        "failed": "failed",
    }.get(task_status, "needs_user_review")


class OpenClawKnowledgeReviewPublisher:
    """Durable OpenClaw review state machine plus exact memory-wiki publisher."""

    def __init__(
        self,
        *,
        store: OpenClawKnowledgeStore,
        wiki: MemoryWikiOperations,
        receipt_mirror: Callable[[dict[str, Any]], Any] | None = None,
        knowledge_roots: tuple[str, ...] = ("projects",),
    ):
        self.store = store
        self.wiki = wiki
        self.receipt_mirror = receipt_mirror
        self.knowledge_roots = knowledge_roots
        self._publish_lock = RLock()

    def close(self) -> None:
        self.store.close()

    def ingest_delivery(self, envelope: dict[str, Any]) -> dict[str, Any]:
        self._validate_delivery(envelope)
        delivery_id = str(envelope["delivery_id"])
        payload = envelope["candidate_payload"]
        payload_hash = canonical_sha256(payload)
        existing = self.store.get_by_delivery(delivery_id)
        if existing is not None:
            if existing["payload_hash"] != payload_hash:
                raise ValueError("idempotency_conflict")
            return {"status": "duplicate", "review_task_id": existing["review_task_id"]}
        candidate = payload["candidate"]
        candidate_id = str(payload["candidate_id"])
        candidate_revision = int(payload["candidate_revision"])
        evidence_revision = int(payload["evidence_revision"])
        review_task_id = "review_" + hashlib.sha256(
            f"{delivery_id}:{payload_hash}".encode("utf-8")
        ).hexdigest()[:24]
        run_id = (
            f"project-knowledge:{envelope['workspace_key']}:candidate:"
            f"{candidate_id}:{candidate_revision}"
        )
        task = self.store.create_task(
            review_task_id=review_task_id,
            run_id=run_id,
            delivery_id=delivery_id,
            workspace_key=str(envelope["workspace_key"]),
            candidate_id=candidate_id,
            candidate_revision=candidate_revision,
            evidence_revision=evidence_revision,
            payload_hash=payload_hash,
            payload=payload,
        )
        return {
            "status": task["status"],
            "review_task_id": review_task_id,
            "candidate_id": candidate_id,
            "candidate_revision": candidate_revision,
            "title": candidate.get("title"),
            "candidate_payload": payload,
        }

    def ingest_delivery_batch(self, batch: dict[str, Any]) -> dict[str, Any]:
        if (
            batch.get("kind") != "codex_author_knowledge_delivery_batch"
            or batch.get("schema_version") != 1
        ):
            raise ValueError("invalid delivery batch kind or schema")
        items = batch.get("items")
        if not isinstance(items, list) or not items or len(items) > 50:
            raise ValueError("delivery batch must contain 1 to 50 items")
        workspace_key = str(batch.get("workspace_key") or "").strip()
        results: list[dict[str, Any]] = []
        for item in items:
            if not isinstance(item, dict):
                results.append({"delivery_id": None, "status": "rejected", "error": "delivery item must be an object"})
                continue
            if workspace_key and item.get("workspace_key") != workspace_key:
                results.append(
                    {
                        "delivery_id": item.get("delivery_id"),
                        "status": "rejected",
                        "error": "workspace mismatch",
                    }
                )
                continue
            try:
                result = self.ingest_delivery(item)
                results.append(
                    {
                        "delivery_id": item["delivery_id"],
                        "review_task_id": result["review_task_id"],
                        "status": "duplicate" if result["status"] == "duplicate" else "accepted",
                        "error": None,
                    }
                )
            except ValueError as error:
                results.append(
                    {
                        "delivery_id": item.get("delivery_id"),
                        "status": "rejected",
                        "error": str(error),
                    }
                )
        return {
            "status": "delivery_batch_received",
            "workspace_key": workspace_key,
            "items": results,
        }

    def get_review_task(self, review_task_id: str) -> dict[str, Any]:
        task = self.store.get(review_task_id)
        if task is None:
            raise ValueError("review task not found")
        return task

    def record_content_review(self, review_task_id: str, review: dict[str, Any]) -> dict[str, Any]:
        task = self.get_review_task(review_task_id)
        decision = str(review.get("decision") or "")
        if decision not in {"accept", "edit_accept", "needs_evidence", "reject", "snooze"}:
            raise ValueError("invalid content review decision")
        if task["status"] not in {"content_review_pending", "publication_review_pending"}:
            raise ValueError("content review is not pending")
        if decision in {"accept", "edit_accept"}:
            approved = review.get("approved_knowledge")
            if not isinstance(approved, dict):
                raise ValueError("accepted content review requires approved knowledge")
            approved_hash = str(review.get("approved_knowledge_sha256") or canonical_sha256(approved))
            if approved_hash != canonical_sha256(approved):
                raise ValueError("approved knowledge hash mismatch")
            if task["status"] == "publication_review_pending":
                task["topic_resolution"] = None
                task["proposal"] = None
                task["publication_review"] = None
                task["change_set"] = None
                task["receipt"] = None
        else:
            approved = None
            approved_hash = None
        task["content_review"] = {
            "decision": decision,
            "approved_knowledge": approved,
            "approved_knowledge_sha256": approved_hash,
            "missing_evidence_requests": review.get("missing_evidence_requests") or [],
            "notes": review.get("notes"),
            "reviewer": review.get("reviewer") or {},
        }
        task["status"] = "publication_review_pending" if decision in {"accept", "edit_accept"} else (
            "blocked" if decision in {"needs_evidence", "snooze"} else "rejected"
        )
        self.store.save_task(task)
        self.store.append_event(review_task_id=review_task_id, event_type="content_reviewed", payload=task["content_review"])
        return {
            "status": task["status"],
            "review_task_id": review_task_id,
            "content_review": task["content_review"],
        }

    def resolve_topic(self, review_task_id: str) -> dict[str, Any]:
        task = self.get_review_task(review_task_id)
        if task["status"] != "publication_review_pending":
            raise ValueError("content review must be accepted before topic resolution")
        approved = (task.get("content_review") or {}).get("approved_knowledge")
        if not isinstance(approved, dict):
            raise ValueError("approved knowledge is required before topic resolution")
        resolution = TopicResolver(self.wiki).resolve(
            task["payload"],
            approved_knowledge=approved,
        )
        task["topic_resolution"] = resolution
        self.store.save_task(task)
        self.store.append_event(review_task_id=review_task_id, event_type="topic_resolved", payload=resolution)
        return resolution

    def record_publication_review(self, review_task_id: str, review: dict[str, Any]) -> dict[str, Any]:
        task = self.get_review_task(review_task_id)
        if task["status"] != "publication_review_pending":
            raise ValueError("content review must be accepted before publication review")
        decision = str(review.get("decision") or "")
        proposal = review.get("proposal")
        if decision != "approve":
            task["publication_review"] = {
                "decision": decision,
                "reviewer": review.get("reviewer") or {},
                "notes": review.get("notes"),
            }
            task["status"] = "blocked" if decision in {"revise", "defer"} else "rejected"
            self.store.save_task(task)
            return {"status": task["status"], "review_task_id": review_task_id}
        if not isinstance(proposal, dict):
            raise ValueError("publication approval requires a proposal")
        self._validate_proposal(task, proposal)
        task["proposal"] = proposal
        task["publication_review"] = {
            "decision": decision,
            "reviewer": review.get("reviewer") or {},
        }
        task["change_set"] = self._freeze_change_set(task, proposal)
        task["status"] = "accepted_change_set_pending"
        self.store.save_task(task)
        self.store.append_event(
            review_task_id=review_task_id,
            event_type="publication_reviewed",
            payload={"publication_review": task["publication_review"], "change_set": task["change_set"]},
        )
        return {
            "status": task["status"],
            "review_task_id": review_task_id,
            "change_set_id": task["change_set"]["change_set_id"],
            "change_set": task["change_set"],
        }

    def publish(self, change_set_id: str) -> dict[str, Any]:
        with self._publish_lock:
            return self._publish_impl(change_set_id)

    def _publish_impl(self, change_set_id: str) -> dict[str, Any]:
        task = self._task_by_change_set(change_set_id)
        change_set = task["change_set"]
        if task["status"] == "published":
            return task["receipt"]
        if task["status"] != "accepted_change_set_pending":
            if task["status"] == "publishing":
                raise ValueError("change set is already publishing")
            raise ValueError("change set is not publishable")
        task = self.store.claim_publish(task["review_task_id"])
        if not task.pop("_publish_claimed", False):
            raise ValueError("change set is already publishing")
        change_set = task["change_set"]
        authorization = change_set["authorization"]
        current_status = self.wiki.status() or {}
        if str(current_status.get("vault_revision") or "") != authorization["base_git_revision"]:
            return self._failed_receipt(task, "stale_vault_revision")
        dirty_paths = current_status.get("dirty_paths") or []
        if dirty_paths:
            return self._failed_receipt(task, "vault_has_unrelated_dirty_paths")
        files = change_set["files"]
        snapshots: list[dict[str, Any]] = []
        for file in files:
            if not _safe_vault_path(file["path"]):
                return self._failed_receipt(task, "unsafe_vault_path")
            if not _safe_knowledge_path(file["path"], roots=self.knowledge_roots):
                return self._failed_receipt(task, "outside_knowledge_root")
            if canonical_sha256(file["markdown"]) != file["result_content_sha256"]:
                return self._failed_receipt(task, "approved_file_hash_mismatch")
            if change_set["publication_action"] != "create":
                current = self.wiki.get(file["path"])
                if current is None or current.get("content_sha256") != file.get("base_content_sha256"):
                    return self._failed_receipt(task, "stale_target_content")
                snapshots.append({"path": file["path"], "exists": True, "page": current})
            elif self.wiki.get(file["path"]) is not None:
                return self._failed_receipt(task, "create_target_exists")
            else:
                snapshots.append({"path": file["path"], "exists": False, "page": None})
        applied = False
        commit_created = False
        try:
            apply_result = self.wiki.apply_exact(
                files=files,
                expected_vault_revision=authorization["base_git_revision"],
            )
            applied = True
            actual_diff_sha256 = str(apply_result.get("diff_sha256") or "")
            if actual_diff_sha256 != change_set["approved_diff_sha256"]:
                raise ValueError("applied diff hash mismatch")
            lint = self.wiki.lint(paths=[file["path"] for file in files])
            if str(lint.get("status")) != "passed":
                raise ValueError("wiki_lint_failed")
            compiled = self.wiki.compile()
            if str(compiled.get("status")) != "passed":
                raise ValueError("wiki_compile_failed")
            allowed_paths = sorted(file["path"] for file in files)
            dirty_paths = sorted(str(path) for path in (self.wiki.status() or {}).get("dirty_paths") or [])
            if dirty_paths != allowed_paths:
                raise ValueError("vault_dirty_paths_do_not_match_change_set")
            git_result = self.wiki.commit_push(
                paths=allowed_paths,
                message=f"project knowledge publish: {change_set['publish_ticket_id']}",
                trailers={
                    "Project-Knowledge-Publish-Ticket": change_set["publish_ticket_id"],
                    "Project-Knowledge-Change-Set": change_set["change_set_id"],
                    "Project-Knowledge-Decision": change_set["decision_command_id"],
                },
            )
            commit_created = bool(git_result.get("commit_sha"))
            if not git_result.get("pushed"):
                if commit_created:
                    return self._failed_receipt(
                        task,
                        "vault_git_push_failed_after_commit",
                        git=git_result,
                    )
                raise ValueError("vault_git_push_failed")
        except Exception as error:
            if applied and not commit_created:
                try:
                    self.wiki.restore_exact(
                        snapshots=snapshots,
                        expected_vault_revision=authorization["base_git_revision"],
                    )
                except Exception as rollback_error:
                    return self._failed_receipt(
                        task,
                        f"{error}; rollback_failed:{rollback_error}",
                    )
            return self._failed_receipt(task, str(error))
        receipt = {
            "kind": "project_domain_knowledge_publication_receipt",
            "schema_version": 1,
            "change_set_id": change_set["change_set_id"],
            "status": "published",
            "publication_action": change_set["publication_action"],
            "wiki_topic_id": change_set["authorization"]["topic_id"],
            "wiki_path": change_set["authorization"]["target_path"],
            "published_content_sha256": change_set["authorization"]["approved_document_sha256"],
            "lint": lint,
            "git": git_result,
            "published_at": _now_iso(),
            "error": None,
        }
        return self._save_receipt(task, receipt, event_type="published", status="published")

    def _task_by_change_set(self, change_set_id: str) -> dict[str, Any]:
        for task in self.store.list_tasks():
            if (task.get("change_set") or {}).get("change_set_id") == change_set_id:
                return task
        raise ValueError("change set not found")

    def _failed_receipt(self, task: dict[str, Any], error: str, **details: Any) -> dict[str, Any]:
        change_set = task["change_set"]
        receipt = {
            "kind": "project_domain_knowledge_publication_receipt",
            "schema_version": 1,
            "change_set_id": change_set["change_set_id"],
            "status": "conflict" if error.startswith("stale_") or error.endswith("_exists") else "failed",
            "publication_action": change_set["publication_action"],
            "wiki_topic_id": change_set["authorization"]["topic_id"],
            "wiki_path": change_set["authorization"]["target_path"],
            "published_content_sha256": None,
            "lint": details.get("lint")
            or {"status": "failed", "errors": [error], "warnings": []},
            "git": details.get("git")
            or {"commit_sha": None, "branch": None, "pushed": False},
            "error": error,
            "published_at": None,
        }
        return self._save_receipt(task, receipt, event_type="publish_failed", status=receipt["status"])

    def _save_receipt(
        self,
        task: dict[str, Any],
        receipt: dict[str, Any],
        *,
        event_type: str,
        status: str,
    ) -> dict[str, Any]:
        mirror_status = "pending"
        self.store.queue_receipt_mirror(receipt)
        if self.receipt_mirror is not None:
            try:
                result = self.receipt_mirror(dict(receipt))
                if result is not False:
                    self.store.mark_receipt_mirrored(receipt["change_set_id"])
                    mirror_status = "mirrored"
            except Exception as error:
                receipt["mirror_error"] = str(error)
        receipt["mirror_status"] = mirror_status
        task["receipt"] = receipt
        task["status"] = status
        self.store.save_task(task)
        self.store.append_event(review_task_id=task["review_task_id"], event_type=event_type, payload=receipt)
        return receipt

    @staticmethod
    def _validate_delivery(envelope: dict[str, Any]) -> None:
        if envelope.get("kind") != "codex_author_knowledge_delivery" or envelope.get("schema_version") != 1:
            raise ValueError("invalid delivery kind or schema")
        if not str(envelope.get("delivery_id") or "").strip():
            raise ValueError("delivery_id is required")
        payload = envelope.get("candidate_payload")
        if not isinstance(payload, dict) or payload.get("kind") != "codex_knowledge_candidate_review":
            raise ValueError("candidate payload is required")
        workspace_key = str(envelope.get("workspace_key") or "").strip()
        if not workspace_key or workspace_key != str(payload.get("workspace_key") or "").strip():
            raise ValueError("delivery workspace mismatch")
        if str(envelope.get("payload_sha256") or "") != canonical_sha256(payload):
            raise ValueError("delivery payload hash mismatch")
        expected_idempotency_key = f"codex-author-knowledge:{envelope['delivery_id']}"
        if envelope.get("idempotency_key") != expected_idempotency_key:
            raise ValueError("delivery idempotency key mismatch")
        if int(payload.get("candidate_revision") or 0) < 1 or int(payload.get("evidence_revision") or 0) < 1:
            raise ValueError("candidate and evidence revisions are required")
        if not isinstance(payload.get("candidate"), dict) or not isinstance(payload["candidate"].get("content"), str):
            raise ValueError("bounded candidate content is required")
        if payload.get("ownership", {}).get("content_review") != "openclaw":
            raise ValueError("content review ownership must be OpenClaw")

    def _validate_proposal(self, task: dict[str, Any], proposal: dict[str, Any]) -> None:
        if proposal.get("candidate_id") != task["candidate_id"]:
            raise ValueError("proposal candidate mismatch")
        if int(proposal.get("candidate_revision") or 0) != int(task["candidate_revision"]):
            raise ValueError("proposal candidate revision mismatch")
        if not proposal.get("publishable") or proposal.get("publication_action") not in {
            "create",
            "update",
            "merge",
            "supersede",
        }:
            raise ValueError("proposal is not publishable")
        target = proposal.get("target") or {}
        if not _safe_knowledge_path(str(target.get("path") or ""), roots=self.knowledge_roots):
            raise ValueError("proposal target path is unsafe")
        if not str(target.get("topic_id") or "").strip():
            raise ValueError("proposal target topic id is required")
        if not target.get("base_content_sha256") or not target.get("base_git_revision"):
            raise ValueError("proposal requires base revision and content hash")
        if proposal["publication_action"] in {"update", "merge", "supersede"} and (
            not target.get("base_content_sha256") or not target.get("base_git_revision")
        ):
            raise ValueError("existing-page proposal requires base revision and content hash")
        document = proposal.get("document") or {}
        markdown = document.get("markdown")
        if not isinstance(markdown, str) or canonical_sha256(markdown) != document.get("sha256"):
            raise ValueError("proposal document hash mismatch")
        diff = proposal.get("diff") or {}
        diff_body = {"format": diff.get("format"), "files": diff.get("files") or []}
        if canonical_sha256(diff_body) != diff.get("sha256"):
            raise ValueError("proposal diff hash mismatch")
        if not isinstance(proposal.get("affected_files"), list) or not proposal["affected_files"]:
            raise ValueError("proposal affected files are required")
        affected_paths: set[str] = set()
        for file in proposal["affected_files"]:
            if not isinstance(file, dict) or not _safe_knowledge_path(
                str(file.get("path") or ""),
                roots=self.knowledge_roots,
            ):
                raise ValueError("proposal affected path is unsafe")
            if file["path"] in affected_paths:
                raise ValueError("proposal affected paths must be unique")
            affected_paths.add(file["path"])
            markdown_value = file.get("markdown")
            if not isinstance(markdown_value, str):
                raise ValueError("proposal affected file Markdown is required")
            if file.get("result_content_sha256") != canonical_sha256(markdown_value):
                raise ValueError("proposal affected file hash mismatch")
        target_file = next(
            (file for file in proposal["affected_files"] if file.get("path") == target.get("path")),
            None,
        )
        if target_file is None or target_file.get("markdown") != markdown:
            raise ValueError("proposal target file does not match document")
        if target_file.get("result_content_sha256") != document.get("sha256"):
            raise ValueError("proposal target file hash mismatch")
        diff_paths = {
            str(file.get("path") or "")
            for file in diff.get("files") or []
            if isinstance(file, dict)
        }
        if diff_paths != affected_paths:
            raise ValueError("proposal diff paths do not match affected files")
        if proposal.get("match_state") in {"multiple_matches", "conflict", "stale_or_invalid_page"}:
            raise ValueError("proposal match state is not publishable")
        resolution = task.get("topic_resolution")
        if not isinstance(resolution, dict):
            raise ValueError("publication proposal requires Vault topic resolution")
        resolution_state = resolution.get("match_state")
        expected_state = "new_topic" if resolution_state == "no_match" else resolution_state
        if proposal.get("match_state") != expected_state:
            raise ValueError("proposal match state does not match Vault topic resolution")
        if str(proposal.get("vault_revision") or "") != str(resolution.get("vault_revision") or ""):
            raise ValueError("proposal Vault revision does not match topic resolution")

    @staticmethod
    def _freeze_change_set(task: dict[str, Any], proposal: dict[str, Any]) -> dict[str, Any]:
        target = proposal["target"]
        document = proposal["document"]
        reviewer = (task.get("content_review") or {}).get("reviewer") or {}
        publication_reviewer = (task.get("publication_review") or {}).get("reviewer") or {}
        decision_id = "openclaw-review-" + task["review_task_id"]
        change_set_id = "change_set_" + hashlib.sha256(
            f"{task['review_task_id']}:{proposal['proposal_id']}:{proposal['proposal_revision']}".encode("utf-8")
        ).hexdigest()[:24]
        publish_ticket_id = "publish_ticket_" + hashlib.sha256(change_set_id.encode("utf-8")).hexdigest()[:24]
        return {
            "kind": "project_domain_knowledge_accepted_change_set",
            "schema_version": 1,
            "change_set_id": change_set_id,
            "publish_ticket_id": publish_ticket_id,
            "candidate_id": task["candidate_id"],
            "candidate_revision": task["candidate_revision"],
            "decision_command_id": decision_id,
            "publication_action": proposal["publication_action"],
            "authorization": {
                "topic_id": target.get("topic_id"),
                "target_path": target["path"],
                "base_content_sha256": target.get("base_content_sha256"),
                "base_git_revision": target.get("base_git_revision"),
                "approved_knowledge_sha256": (task["content_review"] or {}).get("approved_knowledge_sha256"),
                "approved_document_sha256": document["sha256"],
                "approved_diff_sha256": proposal["diff"]["sha256"],
                "approved_by": publication_reviewer.get("user_id") or reviewer.get("user_id"),
                "approved_at": _now_iso(),
            },
            "approved_knowledge_sha256": (task["content_review"] or {}).get("approved_knowledge_sha256"),
            "approved_document_sha256": document["sha256"],
            "approved_diff_sha256": proposal["diff"]["sha256"],
            "knowledge": (task["content_review"] or {}).get("approved_knowledge"),
            "files": proposal["affected_files"],
            "approved_diff": proposal["diff"],
            "status": "pending",
        }
