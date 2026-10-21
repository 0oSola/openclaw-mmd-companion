from __future__ import annotations

from typing import Any

from app.codex_schema.methods import SERVER_NOTIFICATION_METHODS


def normalize_codex_server_event(event: dict[str, Any]) -> dict[str, Any]:
    if "method" in event:
        method = str(event.get("method") or "")
        params = event.get("params") if isinstance(event.get("params"), dict) else {}
        if method == SERVER_NOTIFICATION_METHODS.TURN_STARTED:
            turn = params.get("turn") if isinstance(params.get("turn"), dict) else {}
            return {
                "type": "turn_started",
                "turn_id": str(turn.get("id") or ""),
                "raw_method": method,
            }
        if method == SERVER_NOTIFICATION_METHODS.AGENT_MESSAGE_DELTA:
            return {
                "type": "text_delta",
                "turn_id": str(params.get("turnId") or ""),
                "text": str(params.get("delta") or ""),
                "raw_method": method,
            }
        if method in {SERVER_NOTIFICATION_METHODS.PLAN_DELTA, SERVER_NOTIFICATION_METHODS.TURN_PLAN_UPDATED}:
            if method == SERVER_NOTIFICATION_METHODS.TURN_PLAN_UPDATED:
                parts: list[str] = []
                explanation = params.get("explanation")
                if explanation:
                    parts.append(str(explanation))
                plan = params.get("plan") if isinstance(params.get("plan"), list) else []
                for item in plan:
                    if isinstance(item, dict):
                        parts.append(f"- [{item.get('status') or 'pending'}] {item.get('step') or ''}".rstrip())
                text = "\n".join(parts)
            else:
                text = str(params.get("delta") or "")
            return {
                "type": "plan_delta",
                "turn_id": str(params.get("turnId") or ""),
                "text": text,
                "raw_method": method,
            }
        if method == SERVER_NOTIFICATION_METHODS.ITEM_STARTED:
            item = params.get("item") if isinstance(params.get("item"), dict) else {}
            if item.get("type") == "commandExecution":
                return {
                    "type": "command_started",
                    "turn_id": str(params.get("turnId") or ""),
                    "command": str(item.get("command") or ""),
                    "cwd": str(item.get("cwd") or ""),
                    "raw_method": method,
                }
            return {"type": "raw_codex_event", "raw_method": method, "payload": params}
        if method == SERVER_NOTIFICATION_METHODS.COMMAND_OUTPUT_DELTA:
            return {
                "type": "command_output",
                "turn_id": str(params.get("turnId") or ""),
                "stream": "stdout",
                "text": str(params.get("delta") or ""),
                "raw_method": method,
            }
        if method == SERVER_NOTIFICATION_METHODS.FILE_CHANGE_PATCH_UPDATED:
            changes = params.get("changes") if isinstance(params.get("changes"), list) else []
            changed_files = [
                str(item.get("path"))
                for item in changes
                if isinstance(item, dict) and item.get("path")
            ]
            return {
                "type": "file_changed",
                "turn_id": str(params.get("turnId") or ""),
                "path": changed_files[0] if changed_files else "",
                "change_type": "modified",
                "changed_files": changed_files,
                "raw_method": method,
            }
        if method == SERVER_NOTIFICATION_METHODS.TURN_COMPLETED:
            turn = params.get("turn") if isinstance(params.get("turn"), dict) else {}
            return {
                "type": "turn_completed",
                "turn_id": str(turn.get("id") or ""),
                "final_text": _final_text_from_turn(turn),
                "raw_method": method,
            }
        if method == SERVER_NOTIFICATION_METHODS.ERROR:
            error = params.get("error") if isinstance(params.get("error"), dict) else {}
            message = str(error.get("message") or "Codex turn failed.")
            if bool(params.get("willRetry")):
                return {
                    "type": "turn_retrying",
                    "turn_id": str(params.get("turnId") or ""),
                    "message": message,
                    "will_retry": True,
                    "raw_method": method,
                }
            return {
                "type": "turn_failed",
                "turn_id": str(params.get("turnId") or ""),
                "error": message,
                "will_retry": bool(params.get("willRetry")),
                "raw_method": method,
            }
        if method == SERVER_NOTIFICATION_METHODS.THREAD_CLOSED:
            return {
                "type": "session_closed",
                "thread_id": str(params.get("threadId") or ""),
                "reason": "thread_closed",
                "raw_method": method,
            }
        if method == SERVER_NOTIFICATION_METHODS.PROCESS_EXITED:
            return {
                "type": "process_exit",
                "process_handle": str(params.get("processHandle") or ""),
                "exit_code": params.get("exitCode"),
                "signal": params.get("signal"),
                "raw_method": method,
            }
        return {"type": "raw_codex_event", "raw_method": method, "payload": params}

    event_type = str(event.get("type") or "").strip()
    if not event_type:
        return {"type": "turn_failed", "error": "Codex event missing type."}
    return {"type": event_type, **{key: value for key, value in event.items() if key != "type"}}


def _final_text_from_turn(turn: dict[str, Any]) -> str:
    items = turn.get("items") if isinstance(turn.get("items"), list) else []
    messages = [
        str(item.get("text") or "")
        for item in items
        if isinstance(item, dict) and item.get("type") == "agentMessage" and item.get("text")
    ]
    return "\n".join(messages)
