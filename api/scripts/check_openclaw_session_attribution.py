"""核对 OpenClaw 侧运行记录的会话键能否归属到本地会话。

网关审计里出现的会话键如果不属于任何本地会话行，说明有调用方用一个本地不知道的
会话标识驱动了角色：这类运行无法追溯来源，属于可观测性缺口。本脚本把窗口内的运行
会话键与本地 sessions 表比对，按已知的内部命名空间过滤后，报告无法归属的键。

用法示例（本机部署，OpenClaw 运行在 macCodex）：

    python api/scripts/check_openclaw_session_attribution.py \
      --local-db api/data/sqlite/trace.db \
      --audit-command "ssh macCodex sqlite3 -json ~/.openclaw/state/openclaw.sqlite \"select session_key, action, occurred_at from audit_events where occurred_at > {since_ms}\"" \
      --since-minutes 60 --fail-on-unmatched

判定口径是启发式的：只区分「能归属到本地会话」「已知内部命名空间」「无法归属」三类，
不判断运行本身是否应该发生。
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

DEFAULT_KNOWN_INTERNAL_PATTERNS = (
    "agent:*:cron:*",
    "agent:*:subagent:*",
    "agent:*:openresponses:*",
    "agent:*:openresponses-user:*",
    "agent:*:legacy:*",
    "agent:*:main",
)


def pattern_to_regex(pattern: str) -> re.Pattern[str]:
    """把 agent:*:cron:* 这类通配写法转成整串匹配的正则。"""
    escaped = re.escape(pattern).replace(r"\*", ".*")
    return re.compile("^" + escaped + "$")


def load_local_session_keys(local_db: str | Path) -> set[str]:
    """读取本地 sessions 表中登记过的 OpenClaw 会话键。"""
    path = Path(local_db)
    if not path.exists():
        raise FileNotFoundError(f"local db not found: {path}")
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        rows = con.execute("select openclaw_session_key from sessions").fetchall()
    finally:
        con.close()
    return {str(row[0]).strip() for row in rows if row and row[0]}


def load_audit_rows(audit_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """规整审计行：只保留有会话键的记录。"""
    normalized = []
    for row in audit_rows:
        if not isinstance(row, dict):
            continue
        key = str(row.get("session_key") or "").strip()
        if not key:
            continue
        normalized.append({
            "session_key": key,
            "action": str(row.get("action") or ""),
            "occurred_at": row.get("occurred_at"),
        })
    return normalized


def classify_audit_rows(
    audit_rows: list[dict[str, Any]],
    local_keys: set[str],
    *,
    since_ms: int | None = None,
    known_internal_patterns: tuple[str, ...] = DEFAULT_KNOWN_INTERNAL_PATTERNS,
) -> dict[str, Any]:
    """把审计行分成已归属、已知内部、无法归属三类。"""
    regexes = [(pattern, pattern_to_regex(pattern)) for pattern in known_internal_patterns]
    matched: dict[str, int] = {}
    ignored: dict[str, int] = {}
    unmatched: dict[str, int] = {}
    skipped_out_of_window = 0

    for row in load_audit_rows(audit_rows):
        occurred_at = row.get("occurred_at")
        if since_ms is not None and isinstance(occurred_at, (int, float)):
            if int(occurred_at) < since_ms:
                skipped_out_of_window += 1
                continue
        key = row["session_key"]
        if key in local_keys:
            matched[key] = matched.get(key, 0) + 1
            continue
        if any(regex.match(key) for _, regex in regexes):
            ignored[key] = ignored.get(key, 0) + 1
            continue
        unmatched[key] = unmatched.get(key, 0) + 1

    return {
        "matched": matched,
        "ignored": ignored,
        "unmatched": unmatched,
        "skipped_out_of_window": skipped_out_of_window,
    }


def resolve_audit_rows(args: argparse.Namespace, since_ms: int) -> list[dict[str, Any]]:
    """按参数从文件、标准输入或外部命令取得审计行。"""
    if args.audit_command:
        command = args.audit_command.replace("{since_ms}", str(since_ms))
        completed = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if completed.returncode != 0:
            raise RuntimeError(
                "audit command failed with code "
                + str(completed.returncode)
                + ": "
                + (completed.stderr or "").strip()[:400],
            )
        raw = completed.stdout or ""
    elif args.audit_json == "-":
        raw = sys.stdin.read()
    elif args.audit_json:
        raw = Path(args.audit_json).read_text(encoding="utf-8")
    else:
        raise ValueError("either --audit-json or --audit-command is required")

    raw = raw.strip()
    if not raw:
        return []
    payload = json.loads(raw)
    if isinstance(payload, dict):
        payload = payload.get("rows") or payload.get("items") or []
    if not isinstance(payload, list):
        raise ValueError("audit payload must be a list of rows or an object with rows")
    return payload


def render_report(result: dict[str, Any], *, since_minutes: int) -> str:
    lines = [
        "OpenClaw 会话归属巡检（窗口 " + str(since_minutes) + " 分钟）",
        "  已归属本地会话的键：" + str(len(result["matched"])),
        "  已知内部命名空间：" + str(len(result["ignored"])),
        "  无法归属：" + str(len(result["unmatched"])),
        "  窗口外跳过：" + str(result["skipped_out_of_window"]),
    ]
    if result["unmatched"]:
        lines.append("")
        lines.append("无法归属的会话键：")
        for key, count in sorted(result["unmatched"].items()):
            lines.append("  - " + key + " （运行 " + str(count) + " 次）")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    # 定时运行时输出会被重定向到日志：固定 UTF-8，避免跟随控制台代码页变成乱码。
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="核对 OpenClaw 运行记录的会话键归属")
    parser.add_argument("--local-db", default="api/data/sqlite/trace.db")
    parser.add_argument("--audit-json", default=None, help="审计行 JSON 文件，或 - 表示标准输入")
    parser.add_argument("--audit-command", default=None, help="取得审计行的命令，支持 {since_ms} 占位符")
    parser.add_argument("--since-minutes", type=int, default=60)
    parser.add_argument("--known-internal-pattern", action="append", dest="known_internal", default=None)
    parser.add_argument("--report", default=None, help="可选的 JSON 报告输出路径")
    parser.add_argument("--fail-on-unmatched", action="store_true")
    args = parser.parse_args(argv)

    since_ms = int(time.time() * 1000) - max(0, args.since_minutes) * 60_000
    known_internal = (
        tuple(args.known_internal)
        if args.known_internal
        else DEFAULT_KNOWN_INTERNAL_PATTERNS
    )

    try:
        local_keys = load_local_session_keys(args.local_db)
        audit_rows = resolve_audit_rows(args, since_ms)
    except Exception as error:  # noqa: BLE001 - 巡检脚本需要把失败原因原样报出
        print("巡检失败：" + type(error).__name__ + ": " + str(error))
        return 1

    result = classify_audit_rows(
        audit_rows,
        local_keys,
        since_ms=since_ms,
        known_internal_patterns=known_internal,
    )
    result["local_session_keys"] = len(local_keys)
    result["since_ms"] = since_ms
    result["since_minutes"] = args.since_minutes
    print(render_report(result, since_minutes=args.since_minutes))

    if args.report:
        Path(args.report).write_text(
            json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )

    if result["unmatched"] and args.fail_on_unmatched:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
