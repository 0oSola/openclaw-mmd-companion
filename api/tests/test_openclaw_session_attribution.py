import importlib.util
import json
import sqlite3
from pathlib import Path
from uuid import uuid4

TOOL_PATH = Path(__file__).resolve().parents[1] / "scripts" / "check_openclaw_session_attribution.py"


def _load_tool():
    spec = importlib.util.spec_from_file_location("check_openclaw_session_attribution", TOOL_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _case_dir() -> Path:
    path = Path(__file__).resolve().parent / "tests_runtime" / ("attribution-" + uuid4().hex)
    path.mkdir(parents=True, exist_ok=True)
    return path


def test_classify_matches_local_keys_and_filters_internal_namespaces():
    tool = _load_tool()

    result = tool.classify_audit_rows(
        [
            {"session_key": "agent:main:feishu:direct:ou_x", "action": "agent.run.started", "occurred_at": 2000},
            {"session_key": "agent:main:cron:job", "action": "agent.run.started", "occurred_at": 2000},
            {"session_key": "agent:main:legacy:abc", "action": "agent.run.started", "occurred_at": 2000},
            {"session_key": "agent:main:subagent:s1", "action": "agent.run.started", "occurred_at": 2000},
            {"session_key": "agent:main:main", "action": "agent.run.started", "occurred_at": 2000},
            {"session_key": "agent:main:person:ghost", "action": "agent.run.started", "occurred_at": 2000},
            {"session_key": "", "action": "agent.run.started", "occurred_at": 2000},
        ],
        {"agent:main:feishu:direct:ou_x"},
        since_ms=1000,
    )

    assert result["matched"] == {"agent:main:feishu:direct:ou_x": 1}
    assert sorted(result["ignored"]) == [
        "agent:main:cron:job",
        "agent:main:legacy:abc",
        "agent:main:main",
        "agent:main:subagent:s1",
    ]
    assert result["unmatched"] == {"agent:main:person:ghost": 1}
    assert result["skipped_out_of_window"] == 0


def test_classify_skips_rows_outside_the_window():
    tool = _load_tool()

    result = tool.classify_audit_rows(
        [
            {"session_key": "agent:main:person:old", "action": "agent.run.started", "occurred_at": 500},
            {"session_key": "agent:main:person:recent", "action": "agent.run.started", "occurred_at": 1500},
        ],
        set(),
        since_ms=1000,
    )

    assert result["skipped_out_of_window"] == 1
    assert result["unmatched"] == {"agent:main:person:recent": 1}


def test_pattern_matching_is_anchored():
    tool = _load_tool()

    assert tool.pattern_to_regex("agent:*:cron:*").match("agent:main:cron:1")
    assert not tool.pattern_to_regex("agent:*:cron:*").match("agent:main:cron")
    assert tool.pattern_to_regex("agent:*:main").match("agent:main:main")
    assert not tool.pattern_to_regex("agent:*:main").match("agent:main:main:x")


def test_cli_reports_unattributable_sessions_and_sets_exit_code():
    tool = _load_tool()
    case = _case_dir()
    db = case / "trace.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE sessions (id TEXT PRIMARY KEY, openclaw_session_key TEXT NOT NULL)")
    con.execute("INSERT INTO sessions VALUES (?, ?)", ("s1", "agent:main:feishu:direct:ou_x"))
    con.commit()
    con.close()

    audit = case / "audit.json"
    audit.write_text(
        json.dumps([{"session_key": "agent:main:feishu:direct:ou_x", "action": "agent.run.started"}]),
        encoding="utf-8",
    )
    report = case / "report.json"

    assert tool.main(["--local-db", str(db), "--audit-json", str(audit), "--report", str(report)]) == 0
    assert json.loads(report.read_text(encoding="utf-8"))["unmatched"] == {}

    audit.write_text(
        json.dumps([{"session_key": "agent:main:person:ghost", "action": "agent.run.started"}]),
        encoding="utf-8",
    )

    assert tool.main(["--local-db", str(db), "--audit-json", str(audit)]) == 0
    assert (
        tool.main(
            [
                "--local-db",
                str(db),
                "--audit-json",
                str(audit),
                "--report",
                str(report),
                "--fail-on-unmatched",
            ]
        )
        == 2
    )
    assert json.loads(report.read_text(encoding="utf-8"))["unmatched"] == {"agent:main:person:ghost": 1}


def test_cli_fails_clearly_when_local_db_is_missing():
    tool = _load_tool()
    case = _case_dir()
    audit = case / "audit.json"
    audit.write_text("[]", encoding="utf-8")

    code = tool.main(
        ["--local-db", str(case / "missing.db"), "--audit-json", str(audit)]
    )

    assert code == 1
