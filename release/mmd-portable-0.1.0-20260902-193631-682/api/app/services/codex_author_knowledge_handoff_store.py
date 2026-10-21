from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import RLock
from typing import Any
from uuid import uuid4


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _hash(value: Any) -> str:
    return f"sha256:{hashlib.sha256(_canonical_json(value).encode('utf-8')).hexdigest()}"


class CodexAuthorKnowledgeHandoffStore:
    """独立于旧 trace.db 的作者知识交接账本。"""

    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
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

                CREATE TABLE IF NOT EXISTS knowledge_handoff_package (
                    package_id TEXT PRIMARY KEY,
                    package_key TEXT NOT NULL UNIQUE,
                    handoff_id TEXT NOT NULL,
                    workspace_key TEXT NOT NULL,
                    package_sha256 TEXT NOT NULL,
                    package_content_sha256 TEXT NOT NULL,
                    ack_id TEXT NOT NULL UNIQUE,
                    status TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    metadata_json TEXT NOT NULL,
                    candidate_count INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS knowledge_candidate_revision (
                    candidate_id TEXT NOT NULL,
                    candidate_revision INTEGER NOT NULL,
                    workspace_key TEXT NOT NULL,
                    local_id TEXT NOT NULL,
                    package_id TEXT NOT NULL,
                    content_sha256 TEXT NOT NULL,
                    claim_sha256 TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (candidate_id, candidate_revision),
                    UNIQUE (package_id, local_id)
                );

                CREATE INDEX IF NOT EXISTS idx_knowledge_candidate_revision_identity
                ON knowledge_candidate_revision(workspace_key, local_id, candidate_revision);

                CREATE TABLE IF NOT EXISTS knowledge_handoff_candidate (
                    package_id TEXT NOT NULL,
                    local_id TEXT NOT NULL,
                    candidate_id TEXT NOT NULL,
                    candidate_revision INTEGER NOT NULL,
                    PRIMARY KEY (package_id, local_id)
                );

                CREATE TABLE IF NOT EXISTS knowledge_evidence_revision (
                    evidence_revision_id TEXT PRIMARY KEY,
                    candidate_id TEXT NOT NULL,
                    candidate_revision INTEGER NOT NULL,
                    evidence_revision INTEGER NOT NULL,
                    workspace_key TEXT NOT NULL,
                    repository_id TEXT NOT NULL,
                    revision TEXT,
                    status TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(candidate_id, candidate_revision, evidence_revision)
                );

                CREATE TABLE IF NOT EXISTS knowledge_gate_result (
                    gate_id TEXT PRIMARY KEY,
                    candidate_id TEXT NOT NULL,
                    candidate_revision INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    reason_codes_json TEXT NOT NULL,
                    blocking_object_json TEXT NOT NULL,
                    current_revision TEXT,
                    next_action TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(candidate_id, candidate_revision)
                );

                CREATE TABLE IF NOT EXISTS knowledge_openclaw_delivery (
                    delivery_id TEXT PRIMARY KEY,
                    run_id TEXT,
                    candidate_id TEXT NOT NULL,
                    candidate_revision INTEGER NOT NULL,
                    evidence_revision INTEGER NOT NULL,
                    payload_hash TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    status TEXT NOT NULL,
                    ack_id TEXT,
                    delivered_at TEXT,
                    attempt_count INTEGER NOT NULL DEFAULT 0,
                    last_error TEXT,
                    lease_expires_at TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(candidate_id, candidate_revision, evidence_revision)
                );

                CREATE TABLE IF NOT EXISTS knowledge_publication_receipt_mirror (
                    change_set_id TEXT PRIMARY KEY,
                    receipt_hash TEXT NOT NULL,
                    receipt_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS knowledge_author_openclaw_cursor (
                    run_id TEXT PRIMARY KEY,
                    publish_cursor TEXT,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS knowledge_review_claim (
                    claim_id TEXT PRIMARY KEY,
                    candidate_id TEXT NOT NULL,
                    candidate_revision INTEGER NOT NULL,
                    workspace_key TEXT NOT NULL,
                    status TEXT NOT NULL,
                    claimed_by TEXT NOT NULL,
                    lease_expires_at TEXT,
                    last_heartbeat_at TEXT,
                    content_decision_json TEXT,
                    publication_decision_json TEXT,
                    receipt_json TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_knowledge_review_claim_active
                ON knowledge_review_claim(status, created_at);

                """
            )
            self._ensure_column("knowledge_openclaw_delivery", "attempt_count", "INTEGER NOT NULL DEFAULT 0")
            self._ensure_column("knowledge_openclaw_delivery", "last_error", "TEXT")
            self._ensure_column("knowledge_openclaw_delivery", "lease_expires_at", "TEXT")
            self._ensure_column("knowledge_openclaw_delivery", "run_id", "TEXT")
            self._conn.commit()

    def _ensure_column(self, table: str, column: str, definition: str) -> None:
        columns = {
            str(row["name"])
            for row in self._conn.execute(f"PRAGMA table_info({table})").fetchall()
        }
        if column not in columns:
            self._conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    @staticmethod
    def _row(row: sqlite3.Row | None) -> dict[str, Any] | None:
        return dict(row) if row is not None else None

    def find_package(self, package_key: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM knowledge_handoff_package WHERE package_key = ?",
                (package_key,),
            ).fetchone()
            return self._row(row)

    def create_package(
        self,
        *,
        package_id: str,
        package_key: str,
        handoff_id: str,
        workspace_key: str,
        package_sha256: str,
        package_content_sha256: str,
        ack_id: str,
        payload: dict[str, Any],
        metadata: dict[str, Any],
        candidates: list[dict[str, Any]],
    ) -> dict[str, Any]:
        now = _now_iso()
        with self._lock:
            existing = self.find_package(package_key)
            if existing is not None:
                return {**existing, "outcome": "duplicate"}
            try:
                self._conn.execute(
                    """
                    INSERT INTO knowledge_handoff_package (
                        package_id, package_key, handoff_id, workspace_key,
                        package_sha256, package_content_sha256, ack_id, status,
                        payload_json, metadata_json, candidate_count, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        package_id,
                        package_key,
                        handoff_id,
                        workspace_key,
                        package_sha256,
                        package_content_sha256,
                        ack_id,
                        "received",
                        json.dumps(payload, ensure_ascii=False),
                        json.dumps(metadata, ensure_ascii=False),
                        len(candidates),
                        now,
                        now,
                    ),
                )
                for candidate in candidates:
                    local_id = str(candidate["local_id"])
                    candidate_id = self._candidate_id(workspace_key, local_id)
                    latest = self._conn.execute(
                        """
                        SELECT candidate_revision, claim_sha256
                        FROM knowledge_candidate_revision
                        WHERE candidate_id = ?
                        ORDER BY candidate_revision DESC
                        LIMIT 1
                        """,
                        (candidate_id,),
                    ).fetchone()
                    if latest is not None and latest["claim_sha256"] == str(candidate["claim_sha256"]):
                        revision = int(latest["candidate_revision"])
                    else:
                        revision = int(latest["candidate_revision"] if latest is not None else 0) + 1
                        self._conn.execute(
                            """
                            INSERT INTO knowledge_candidate_revision (
                                candidate_id, candidate_revision, workspace_key, local_id,
                                package_id, content_sha256, claim_sha256, payload_json,
                                status, created_at, updated_at
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                candidate_id,
                                revision,
                                workspace_key,
                                local_id,
                                package_id,
                                str(candidate["content_sha256"]),
                                str(candidate["claim_sha256"]),
                                json.dumps(
                                    {
                                        **candidate,
                                        "candidate_id": candidate_id,
                                        "candidate_revision": revision,
                                    },
                                    ensure_ascii=False,
                                ),
                                "received",
                                now,
                                now,
                            ),
                        )
                    self._conn.execute(
                        """
                        INSERT INTO knowledge_handoff_candidate (
                            package_id, local_id, candidate_id, candidate_revision
                        ) VALUES (?, ?, ?, ?)
                        """,
                        (package_id, local_id, candidate_id, revision),
                    )
                self._conn.commit()
            except Exception:
                self._conn.rollback()
                existing = self.find_package(package_key)
                if existing is not None:
                    return {**existing, "outcome": "duplicate"}
                raise
            return {
                "package_id": package_id,
                "package_key": package_key,
                "handoff_id": handoff_id,
                "workspace_key": workspace_key,
                "package_sha256": package_sha256,
                "package_content_sha256": package_content_sha256,
                "ack_id": ack_id,
                "candidate_count": len(candidates),
                "outcome": "accepted",
            }

    def list_package_candidates(self, package_id: str) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT c.*
                FROM knowledge_handoff_candidate link
                JOIN knowledge_candidate_revision c
                  ON c.candidate_id = link.candidate_id
                 AND c.candidate_revision = link.candidate_revision
                WHERE link.package_id = ?
                ORDER BY link.local_id
                """,
                (package_id,),
            ).fetchall()
            result: list[dict[str, Any]] = []
            for row in rows:
                item = self._row(row) or {}
                item["payload"] = json.loads(item.pop("payload_json"))
                result.append(item)
            return result

    @staticmethod
    def _candidate_id(workspace_key: str, local_id: str) -> str:
        digest = hashlib.sha256(f"{workspace_key}:{local_id}".encode("utf-8")).hexdigest()[:24]
        return f"candidate_{digest}"

    def list_handoffs(self, *, limit: int = 100) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM knowledge_handoff_package ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
            return [self._row(row) or {} for row in rows]

    def get_package(self, package_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM knowledge_handoff_package WHERE package_id = ?",
                (package_id,),
            ).fetchone()
            if row is None:
                return None
            result = self._row(row) or {}
            result["payload"] = json.loads(result.pop("payload_json"))
            result["metadata"] = json.loads(result.pop("metadata_json"))
            return result

    def list_candidate_revisions(
        self,
        *,
        workspace_key: str | None = None,
        status: str | None = None,
        limit: int | None = 100,
    ) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if workspace_key:
            clauses.append("workspace_key = ?")
            params.append(workspace_key)
        if status:
            clauses.append("status = ?")
            params.append(status)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        limit_sql = ""
        if limit is not None:
            limit_sql = "LIMIT ?"
            params.append(limit)
        with self._lock:
            rows = self._conn.execute(
                f"""
                SELECT * FROM knowledge_candidate_revision
                {where}
                ORDER BY created_at ASC
                {limit_sql}
                """,
                params,
            ).fetchall()
            result: list[dict[str, Any]] = []
            for row in rows:
                item = self._row(row) or {}
                item["payload"] = json.loads(item.pop("payload_json"))
                result.append(item)
            return result

    def save_evidence_revision(
        self,
        *,
        candidate_id: str,
        candidate_revision: int,
        workspace_key: str,
        repository_id: str,
        revision: str | None,
        status: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                latest = self._conn.execute(
                    """
                    SELECT * FROM knowledge_evidence_revision
                    WHERE candidate_id = ? AND candidate_revision = ?
                    ORDER BY evidence_revision DESC
                    LIMIT 1
                    """,
                    (candidate_id, candidate_revision),
                ).fetchone()
                if latest is not None:
                    latest_payload = json.loads(latest["payload_json"])
                    if _hash(latest_payload) == _hash(payload) and latest["status"] == status:
                        self._conn.commit()
                        result = self._row(latest) or {}
                        result["payload"] = latest_payload
                        result.pop("payload_json", None)
                        return result
                previous = self._conn.execute(
                    """
                    SELECT MAX(evidence_revision) AS revision
                    FROM knowledge_evidence_revision
                    WHERE candidate_id = ? AND candidate_revision = ?
                    """,
                    (candidate_id, candidate_revision),
                ).fetchone()
                evidence_revision = int(previous["revision"] or 0) + 1
                evidence_revision_id = "evidence_" + hashlib.sha256(
                    f"{candidate_id}:{candidate_revision}:{evidence_revision}:{repository_id}:{revision}:{_hash(payload)}".encode("utf-8")
                ).hexdigest()[:24]
                self._conn.execute(
                    """
                    INSERT INTO knowledge_evidence_revision (
                        evidence_revision_id, candidate_id, candidate_revision, evidence_revision,
                        workspace_key, repository_id, revision, status, payload_json, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        evidence_revision_id,
                        candidate_id,
                        candidate_revision,
                        evidence_revision,
                        workspace_key,
                        repository_id,
                        revision,
                        status,
                        json.dumps(payload, ensure_ascii=False),
                        _now_iso(),
                    ),
                )
                self._conn.commit()
                row = self._conn.execute(
                    """
                    SELECT * FROM knowledge_evidence_revision
                    WHERE evidence_revision_id = ?
                    """,
                    (evidence_revision_id,),
                ).fetchone()
                result = self._row(row) or {}
                result["payload"] = json.loads(result.pop("payload_json"))
                return result
            except Exception:
                self._conn.rollback()
                raise

    def save_gate_result(
        self,
        *,
        candidate_id: str,
        candidate_revision: int,
        status: str,
        reason_codes: list[str],
        blocking_object: dict[str, Any],
        current_revision: str | None,
        next_action: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        gate_id = "gate_" + hashlib.sha256(
            f"{candidate_id}:{candidate_revision}:{_hash(payload)}".encode("utf-8")
        ).hexdigest()[:24]
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO knowledge_gate_result (
                    gate_id, candidate_id, candidate_revision, status,
                    reason_codes_json, blocking_object_json, current_revision,
                    next_action, payload_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(candidate_id, candidate_revision) DO UPDATE SET
                    gate_id = excluded.gate_id,
                    status = excluded.status,
                    reason_codes_json = excluded.reason_codes_json,
                    blocking_object_json = excluded.blocking_object_json,
                    current_revision = excluded.current_revision,
                    next_action = excluded.next_action,
                    payload_json = excluded.payload_json,
                    created_at = excluded.created_at
                """,
                (
                    gate_id,
                    candidate_id,
                    candidate_revision,
                    status,
                    json.dumps(reason_codes, ensure_ascii=False),
                    json.dumps(blocking_object, ensure_ascii=False),
                    current_revision,
                    next_action,
                    json.dumps(payload, ensure_ascii=False),
                    _now_iso(),
                ),
            )
            self._conn.execute(
                """
                UPDATE knowledge_candidate_revision
                SET status = ?, updated_at = ?
                WHERE candidate_id = ? AND candidate_revision = ?
                """,
                (status, _now_iso(), candidate_id, candidate_revision),
            )
            self._conn.commit()
            row = self._conn.execute(
                """
                SELECT * FROM knowledge_gate_result
                WHERE candidate_id = ? AND candidate_revision = ?
                """,
                (candidate_id, candidate_revision),
            ).fetchone()
            result = self._row(row) or {}
            result["reason_codes"] = json.loads(result.pop("reason_codes_json"))
            result["blocking_object"] = json.loads(result.pop("blocking_object_json"))
            result["payload"] = json.loads(result.pop("payload_json"))
            return result

    def create_delivery(
        self,
        *,
        run_id: str,
        candidate_id: str,
        candidate_revision: int,
        evidence_revision: int,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        payload_hash = _hash(payload)
        delivery_id = "delivery_" + hashlib.sha256(
            f"{candidate_id}:{candidate_revision}:{evidence_revision}:{payload_hash}".encode("utf-8")
        ).hexdigest()[:24]
        with self._lock:
            self._conn.execute(
                """
                INSERT OR IGNORE INTO knowledge_openclaw_delivery (
                    delivery_id, run_id, candidate_id, candidate_revision, evidence_revision, payload_hash,
                    payload_json, status, ack_id, delivered_at, attempt_count,
                    last_error, lease_expires_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    delivery_id,
                    run_id,
                    candidate_id,
                    candidate_revision,
                    evidence_revision,
                    payload_hash,
                    json.dumps(payload, ensure_ascii=False),
                    "pending",
                    None,
                    None,
                    0,
                    None,
                    None,
                    _now_iso(),
                    _now_iso(),
                ),
            )
            self._conn.commit()
            row = self._conn.execute(
                """
                SELECT * FROM knowledge_openclaw_delivery
                WHERE candidate_id = ? AND candidate_revision = ? AND evidence_revision = ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (candidate_id, candidate_revision, evidence_revision),
            ).fetchone()
            result = self._row(row) or {}
            result["payload"] = json.loads(result.pop("payload_json"))
            return result

    def claim_next_delivery(self, *, now: datetime | None = None, lease_seconds: int = 300) -> dict[str, Any] | None:
        current_time = now or datetime.now(UTC)
        now_iso = current_time.isoformat()
        lease_expires_at = (current_time + timedelta(seconds=max(1, lease_seconds))).isoformat()
        with self._lock:
            row = self._conn.execute(
                """
                SELECT * FROM knowledge_openclaw_delivery
                WHERE status = 'pending'
                   OR (status = 'sending' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?)
                ORDER BY created_at ASC, delivery_id ASC
                LIMIT 1
                """,
                (now_iso,),
            ).fetchone()
            if row is None:
                return None
            self._conn.execute(
                """
                UPDATE knowledge_openclaw_delivery
                SET status = 'sending', attempt_count = attempt_count + 1,
                    lease_expires_at = ?, updated_at = ?, last_error = NULL
                WHERE delivery_id = ?
                """,
                (lease_expires_at, now_iso, row["delivery_id"]),
            )
            self._conn.commit()
            result = self._row(
                self._conn.execute(
                    "SELECT * FROM knowledge_openclaw_delivery WHERE delivery_id = ?",
                    (row["delivery_id"],),
                ).fetchone()
            ) or {}
            result["payload"] = json.loads(result.pop("payload_json"))
            return result

    def release_delivery(self, *, delivery_id: str, error: str) -> dict[str, Any] | None:
        now = _now_iso()
        with self._lock:
            self._conn.execute(
                """
                UPDATE knowledge_openclaw_delivery
                SET status = 'pending', last_error = ?, lease_expires_at = NULL, updated_at = ?
                WHERE delivery_id = ? AND status = 'sending'
                """,
                (str(error)[:2000], now, delivery_id),
            )
            self._conn.commit()
            row = self._conn.execute(
                "SELECT * FROM knowledge_openclaw_delivery WHERE delivery_id = ?",
                (delivery_id,),
            ).fetchone()
            if row is None:
                return None
            result = self._row(row) or {}
            result["payload"] = json.loads(result.pop("payload_json"))
            return result

    def acknowledge_delivery(
        self,
        *,
        delivery_id: str,
        outcome: str,
        ack_id: str | None,
    ) -> dict[str, Any]:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM knowledge_openclaw_delivery WHERE delivery_id = ?",
                (delivery_id,),
            ).fetchone()
            if row is None:
                raise ValueError("OpenClaw delivery not found")
            existing = self._row(row) or {}
            if existing["status"] == "delivered":
                existing["outcome"] = "duplicate"
                return existing
            newer = self._conn.execute(
                """
                SELECT delivery_id FROM knowledge_openclaw_delivery
                WHERE candidate_id = ? AND candidate_revision = ?
                  AND evidence_revision > ? AND status = 'pending'
                LIMIT 1
                """,
                (existing["candidate_id"], existing["candidate_revision"], existing["evidence_revision"]),
            ).fetchone()
            if newer is not None:
                raise ValueError("OpenClaw delivery is stale; acknowledge the newest evidence revision")
            if outcome not in {"accepted", "duplicate"}:
                raise ValueError("OpenClaw delivery outcome must be accepted or duplicate")
            delivered_at = _now_iso()
            self._conn.execute(
                """
                UPDATE knowledge_openclaw_delivery
                SET status = 'delivered', ack_id = ?, delivered_at = ?,
                    lease_expires_at = NULL, last_error = NULL, updated_at = ?
                WHERE delivery_id = ?
                """,
                (ack_id, delivered_at, delivered_at, delivery_id),
            )
            self._conn.execute(
                """
                UPDATE knowledge_gate_result
                SET status = 'delivered_to_openclaw', next_action = 'await_openclaw_review',
                    created_at = ?
                WHERE candidate_id = ? AND candidate_revision = ?
                """,
                (delivered_at, existing["candidate_id"], existing["candidate_revision"]),
            )
            self._conn.execute(
                """
                UPDATE knowledge_candidate_revision
                SET status = 'delivered_to_openclaw', updated_at = ?
                WHERE candidate_id = ? AND candidate_revision = ?
                """,
                (delivered_at, existing["candidate_id"], existing["candidate_revision"]),
            )
            self._conn.commit()
            result = dict(existing)
            result.update({"status": "delivered", "ack_id": ack_id, "delivered_at": delivered_at, "outcome": outcome})
            return result

    def list_deliveries(self, *, limit: int = 100) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM knowledge_openclaw_delivery ORDER BY created_at ASC LIMIT ?",
                (limit,),
            ).fetchall()
            result: list[dict[str, Any]] = []
            for row in rows:
                item = self._row(row) or {}
                item["payload"] = json.loads(item.pop("payload_json"))
                result.append(item)
            return result

    def list_delivery_run_ids(self, *, limit: int = 50) -> list[str]:
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT DISTINCT run_id FROM knowledge_openclaw_delivery
                WHERE run_id IS NOT NULL AND run_id != ''
                ORDER BY run_id
                LIMIT ?
                """,
                (max(1, min(int(limit), 200)),),
            ).fetchall()
            return [str(row["run_id"]) for row in rows]

    def get_author_openclaw_cursor(self, run_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM knowledge_author_openclaw_cursor WHERE run_id = ?",
                (run_id,),
            ).fetchone()
            return self._row(row)

    def update_author_openclaw_cursor(self, *, run_id: str, publish_cursor: str | None) -> dict[str, Any]:
        now = _now_iso()
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO knowledge_author_openclaw_cursor (run_id, publish_cursor, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(run_id) DO UPDATE SET
                    publish_cursor = excluded.publish_cursor,
                    updated_at = excluded.updated_at
                """,
                (run_id, publish_cursor, now),
            )
            self._conn.commit()
            row = self._conn.execute(
                "SELECT * FROM knowledge_author_openclaw_cursor WHERE run_id = ?",
                (run_id,),
            ).fetchone()
            return self._row(row) or {}

    @staticmethod
    def _decode_claim(row: sqlite3.Row | None) -> dict[str, Any] | None:
        item = dict(row) if row is not None else None
        if item is None:
            return None
        for field in ("content_decision", "publication_decision", "receipt"):
            item[field] = json.loads(item.pop(f"{field}_json", None) or "null")
        return item

    def get_review_claim(self, claim_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM knowledge_review_claim WHERE claim_id = ?",
                (claim_id,),
            ).fetchone()
            return self._decode_claim(row)

    def _candidate_payload(self, candidate_id: str, candidate_revision: int) -> dict[str, Any] | None:
        row = self._conn.execute(
            """
            SELECT payload_json FROM knowledge_candidate_revision
            WHERE candidate_id = ? AND candidate_revision = ?
            """,
            (candidate_id, candidate_revision),
        ).fetchone()
        if row is None or not row["payload_json"]:
            return None
        return json.loads(row["payload_json"])

    def claim_next_review(
        self,
        *,
        workspace_key: str,
        claimed_by: str,
        lease_seconds: int = 3600,
    ) -> dict[str, Any] | None:
        current_time = datetime.now(UTC)
        now_iso = current_time.isoformat()
        lease_expires_at = (current_time + timedelta(seconds=max(60, lease_seconds))).isoformat()
        claim_id = "claim_" + uuid4().hex[:24]
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                row = self._conn.execute(
                    """
                    SELECT cr.candidate_id, cr.candidate_revision, cr.workspace_key
                    FROM knowledge_candidate_revision cr
                    LEFT JOIN knowledge_review_claim rc
                      ON rc.candidate_id = cr.candidate_id
                     AND rc.candidate_revision = cr.candidate_revision
                     AND rc.status NOT IN ('claim_expired', 'rejected', 'deferred')
                    WHERE cr.status = 'ready_for_review'
                      AND cr.workspace_key = ?
                      AND rc.claim_id IS NULL
                    ORDER BY cr.created_at ASC
                    LIMIT 1
                    """,
                    (workspace_key,),
                ).fetchone()
                if row is None:
                    self._conn.commit()
                    return None
                candidate_id = str(row["candidate_id"])
                candidate_revision = int(row["candidate_revision"])
                self._conn.execute(
                    """
                    UPDATE knowledge_candidate_revision
                    SET status = 'claimed', updated_at = ?
                    WHERE candidate_id = ? AND candidate_revision = ?
                    """,
                    (now_iso, candidate_id, candidate_revision),
                )
                self._conn.execute(
                    """
                    INSERT INTO knowledge_review_claim (
                        claim_id, candidate_id, candidate_revision, workspace_key,
                        status, claimed_by, lease_expires_at, last_heartbeat_at,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, 'claimed', ?, ?, ?, ?, ?)
                    """,
                    (
                        claim_id,
                        candidate_id,
                        candidate_revision,
                        workspace_key,
                        claimed_by,
                        lease_expires_at,
                        now_iso,
                        now_iso,
                        now_iso,
                    ),
                )
                self._conn.commit()
            except Exception:
                self._conn.rollback()
                raise
        claim = self.get_review_claim(claim_id) or {}
        claim["candidate_payload"] = self._candidate_payload(candidate_id, candidate_revision)
        return claim

    def expire_stale_review_claims(self, *, now: datetime | None = None) -> int:
        current_time = now or datetime.now(UTC)
        now_iso = current_time.isoformat()
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT claim_id, candidate_id, candidate_revision
                FROM knowledge_review_claim
                WHERE status IN ('claimed', 'awaiting_content_confirmation')
                  AND lease_expires_at IS NOT NULL
                  AND lease_expires_at <= ?
                """,
                (now_iso,),
            ).fetchall()
            for row in rows:
                self._conn.execute(
                    """
                    UPDATE knowledge_review_claim
                    SET status = 'claim_expired', updated_at = ?
                    WHERE claim_id = ?
                    """,
                    (now_iso, row["claim_id"]),
                )
                self._conn.execute(
                    """
                    UPDATE knowledge_candidate_revision
                    SET status = 'ready_for_review', updated_at = ?
                    WHERE candidate_id = ? AND candidate_revision = ?
                    """,
                    (now_iso, row["candidate_id"], row["candidate_revision"]),
                )
            self._conn.commit()
            return len(rows)

    def heartbeat_review_claim(self, *, claim_id: str, claimed_by: str, lease_seconds: int = 3600) -> dict[str, Any]:
        current_time = datetime.now(UTC)
        now_iso = current_time.isoformat()
        lease_expires_at = (current_time + timedelta(seconds=max(60, lease_seconds))).isoformat()
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM knowledge_review_claim WHERE claim_id = ?",
                (claim_id,),
            ).fetchone()
            if row is None:
                raise ValueError("review claim not found")
            existing = dict(row)
            if existing["claimed_by"] != claimed_by:
                raise ValueError("review claim is owned by another reviewer")
            if existing["status"] not in {"claimed", "awaiting_content_confirmation"}:
                raise ValueError("review claim is not active")
            self._conn.execute(
                """
                UPDATE knowledge_review_claim
                SET lease_expires_at = ?, last_heartbeat_at = ?, updated_at = ?
                WHERE claim_id = ?
                """,
                (lease_expires_at, now_iso, now_iso, claim_id),
            )
            self._conn.commit()
            return self.get_review_claim(claim_id) or {}

    def defer_review_claim(self, *, claim_id: str, claimed_by: str) -> dict[str, Any]:
        now_iso = _now_iso()
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM knowledge_review_claim WHERE claim_id = ?",
                (claim_id,),
            ).fetchone()
            if row is None:
                raise ValueError("review claim not found")
            existing = dict(row)
            if existing["claimed_by"] != claimed_by:
                raise ValueError("review claim is owned by another reviewer")
            if existing["status"] not in {"claimed", "awaiting_content_confirmation"}:
                raise ValueError("review claim is not deferrable")
            self._conn.execute(
                """
                UPDATE knowledge_review_claim
                SET status = 'deferred', updated_at = ?
                WHERE claim_id = ?
                """,
                (now_iso, claim_id),
            )
            self._conn.execute(
                """
                UPDATE knowledge_candidate_revision
                SET status = 'ready_for_review', updated_at = ?
                WHERE candidate_id = ? AND candidate_revision = ?
                """,
                (now_iso, existing["candidate_id"], existing["candidate_revision"]),
            )
            self._conn.commit()
            return self.get_review_claim(claim_id) or {}

    def record_content_decision(
        self,
        *,
        claim_id: str,
        decision: str,
        approved_knowledge: dict[str, Any] | None,
        notes: str | None,
    ) -> dict[str, Any]:
        now_iso = _now_iso()
        if decision not in {"accept", "edit_accept", "reject", "needs_evidence"}:
            raise ValueError("invalid content decision")
        if decision in {"accept", "edit_accept"} and not isinstance(approved_knowledge, dict):
            raise ValueError("accepted content decision requires approved knowledge")
        payload = {
            "decision": decision,
            "approved_knowledge": approved_knowledge,
            "approved_knowledge_sha256": _hash(approved_knowledge) if approved_knowledge else None,
            "notes": notes,
        }
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM knowledge_review_claim WHERE claim_id = ?",
                (claim_id,),
            ).fetchone()
            if row is None:
                raise ValueError("review claim not found")
            existing = dict(row)
            if existing["status"] not in {"claimed", "awaiting_content_confirmation"}:
                raise ValueError("content decision is not pending")
            next_status = (
                "content_approved"
                if decision in {"accept", "edit_accept"}
                else ("rejected" if decision == "reject" else "needs_evidence")
            )
            self._conn.execute(
                """
                UPDATE knowledge_review_claim
                SET status = ?, content_decision_json = ?, updated_at = ?
                WHERE claim_id = ?
                """,
                (next_status, json.dumps(payload, ensure_ascii=False), now_iso, claim_id),
            )
            self._conn.execute(
                """
                UPDATE knowledge_candidate_revision
                SET status = ?, updated_at = ?
                WHERE candidate_id = ? AND candidate_revision = ?
                """,
                (next_status, now_iso, existing["candidate_id"], existing["candidate_revision"]),
            )
            self._conn.commit()
            return self.get_review_claim(claim_id) or {}

    def record_publication_decision(
        self,
        *,
        claim_id: str,
        proposal: dict[str, Any],
    ) -> dict[str, Any]:
        now_iso = _now_iso()
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM knowledge_review_claim WHERE claim_id = ?",
                (claim_id,),
            ).fetchone()
            if row is None:
                raise ValueError("review claim not found")
            existing = dict(row)
            if existing["status"] != "content_approved":
                raise ValueError("content decision must be approved before publication decision")
            self._conn.execute(
                """
                UPDATE knowledge_review_claim
                SET status = 'publication_approved',
                    publication_decision_json = ?, updated_at = ?
                WHERE claim_id = ?
                """,
                (json.dumps(proposal, ensure_ascii=False), now_iso, claim_id),
            )
            self._conn.execute(
                """
                UPDATE knowledge_candidate_revision
                SET status = 'publication_approved', updated_at = ?
                WHERE candidate_id = ? AND candidate_revision = ?
                """,
                (now_iso, existing["candidate_id"], existing["candidate_revision"]),
            )
            self._conn.commit()
            return self.get_review_claim(claim_id) or {}

    def record_publication_receipt(
        self,
        *,
        claim_id: str,
        receipt: dict[str, Any],
    ) -> dict[str, Any]:
        now_iso = _now_iso()
        status = str(receipt.get("status") or "")
        if status not in {"published", "failed", "conflict"}:
            raise ValueError("publication receipt status must be published, failed, or conflict")
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM knowledge_review_claim WHERE claim_id = ?",
                (claim_id,),
            ).fetchone()
            if row is None:
                raise ValueError("review claim not found")
            existing = dict(row)
            if existing.get("receipt_json"):
                existing["outcome"] = "duplicate"
                return existing
            if existing["status"] not in {"publication_approved", "publishing", "published", "failed", "conflict"}:
                raise ValueError("publication receipt is not pending")
            self._conn.execute(
                """
                UPDATE knowledge_review_claim
                SET status = ?, receipt_json = ?, updated_at = ?
                WHERE claim_id = ?
                """,
                (status, json.dumps(receipt, ensure_ascii=False), now_iso, claim_id),
            )
            self._conn.execute(
                """
                UPDATE knowledge_candidate_revision
                SET status = ?, updated_at = ?
                WHERE candidate_id = ? AND candidate_revision = ?
                """,
                (status, now_iso, existing["candidate_id"], existing["candidate_revision"]),
            )
            self._conn.commit()
            result = self.get_review_claim(claim_id) or {}
            result["outcome"] = "recorded"
            return result

    def mirror_publication_receipt(self, *, receipt: dict[str, Any]) -> dict[str, Any]:
        change_set_id = str(receipt.get("change_set_id") or "").strip()
        if not change_set_id:
            raise ValueError("publication receipt change_set_id is required")
        receipt_hash = _hash(receipt)
        now = _now_iso()
        with self._lock:
            existing = self._conn.execute(
                """
                SELECT * FROM knowledge_publication_receipt_mirror
                WHERE change_set_id = ?
                """,
                (change_set_id,),
            ).fetchone()
            if existing is not None:
                if existing["receipt_hash"] != receipt_hash:
                    raise ValueError("publication receipt is immutable")
                return {
                    "outcome": "duplicate",
                    "change_set_id": change_set_id,
                    "receipt_hash": existing["receipt_hash"],
                    "receipt": json.loads(existing["receipt_json"]),
                }
            self._conn.execute(
                """
                INSERT INTO knowledge_publication_receipt_mirror (
                    change_set_id, receipt_hash, receipt_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (change_set_id, receipt_hash, json.dumps(receipt, ensure_ascii=False), now, now),
            )
            self._conn.commit()
            return {
                "outcome": "mirrored",
                "change_set_id": change_set_id,
                "receipt_hash": receipt_hash,
                "receipt": receipt,
            }
