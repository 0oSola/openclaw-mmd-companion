#!/usr/bin/env python3
"""Rebuild a SQLite database from a possibly-corrupt copy, table by table.

Usage:
  python scripts/sqlite_recovery.py \
    --source <corrupt.db> \
    --target <recovered.db> \
    --skip-tables codex_knowledge_extraction_outbox

The source copy must include its -wal and -shm siblings when present.
Corrupt tables are skipped and reported; every readable table is copied with
its DDL, then integrity_check is run on the recovered database.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any


def _table_names(con: sqlite3.Connection) -> list[str]:
    rows = con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    return [str(row[0]) for row in rows]


def _object_ddl(con: sqlite3.Connection, obj_type: str, table_names: set[str]) -> list[str]:
    statements: list[str] = []
    rows = con.execute(
        "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = ? AND sql IS NOT NULL ORDER BY name",
        (obj_type,),
    ).fetchall()
    for name, tbl_name, sql in rows:
        if str(tbl_name) in table_names or str(name).startswith("sqlite_"):
            continue
        statements.append(str(sql))
    return statements


def recover(
    *,
    source: Path,
    target: Path,
    skip_tables: set[str],
) -> dict[str, Any]:
    source = Path(source)
    target = Path(target)
    if not source.exists():
        raise FileNotFoundError(source)
    if target.exists():
        target.unlink()
    target.parent.mkdir(parents=True, exist_ok=True)

    src = sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True, timeout=30)
    dst = sqlite3.connect(target, timeout=30, uri=True)
    dst.execute("PRAGMA foreign_keys=OFF")
    dst.execute("PRAGMA journal_mode=OFF")
    dst.execute(
        "ATTACH DATABASE ? AS src",
        (f"file:{source.as_posix()}?mode=ro",),
    )
    table_names = _table_names(src)
    skipped = sorted(skip_tables & set(table_names))
    copied = sorted(set(table_names) - skip_tables)

    for table in copied:
        row = src.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name = ?",
            (table,),
        ).fetchone()
        if row is None or not row[0]:
            continue
        dst.execute(str(row[0]))
    for obj_type in ("index", "view", "trigger"):
        for statement in _object_ddl(src, obj_type, skip_tables):
            try:
                dst.execute(statement)
            except sqlite3.DatabaseError:
                pass

    table_counts: dict[str, int] = {}
    failed_tables: list[dict[str, Any]] = []
    for table in copied:
        try:
            src_count = int(src.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])
            dst.execute(f'INSERT INTO "{table}" SELECT * FROM src."{table}"')
            dst_count = int(dst.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])
            table_counts[table] = dst_count
            if src_count != dst_count:
                failed_tables.append(
                    {"table": table, "error": f"row count mismatch source={src_count} target={dst_count}"}
                )
        except Exception as error:
            failed_tables.append({"table": table, "error": f"{type(error).__name__}: {error}"})
    dst.commit()

    dst.execute("DETACH DATABASE src")
    quick_check = [str(row[0]) for row in dst.execute("PRAGMA quick_check")]
    integrity_check = [str(row[0]) for row in dst.execute("PRAGMA integrity_check")]
    foreign_key_check_count = len(dst.execute("PRAGMA foreign_key_check").fetchall())
    src.close()
    dst.close()

    return {
        "source": str(source),
        "recovered": str(target),
        "tables_total": len(table_names),
        "tables_copied": len(copied),
        "tables_skipped": skipped,
        "table_counts": table_counts,
        "failed_tables": failed_tables,
        "quick_check": quick_check,
        "integrity_check": integrity_check,
        "foreign_key_check_count": foreign_key_check_count,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--skip-tables", default="", help="comma-separated table names to drop")
    args = parser.parse_args()
    skip_tables = {name.strip() for name in args.skip_tables.split(",") if name.strip()}
    try:
        report = recover(source=Path(args.source), target=Path(args.target), skip_tables=skip_tables)
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        return 2
    print(json.dumps(report, ensure_ascii=False, indent=2))
    ok = report["integrity_check"] == ["ok"] and not report["failed_tables"]
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
