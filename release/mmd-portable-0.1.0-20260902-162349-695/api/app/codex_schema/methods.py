from __future__ import annotations

from enum import StrEnum
from pathlib import Path


SCHEMA_ROOT = Path(__file__).resolve().parent
GENERATED_SCHEMA_ROOT = SCHEMA_ROOT / "generated"
PINNED_PROTOCOL_SCHEMA = GENERATED_SCHEMA_ROOT / "codex_app_server_protocol.schemas.json"
PINNED_PROTOCOL_V2_SCHEMA = GENERATED_SCHEMA_ROOT / "codex_app_server_protocol.v2.schemas.json"


class CLIENT_REQUEST_METHODS(StrEnum):
    INITIALIZE = "initialize"
    THREAD_START = "thread/start"
    TURN_START = "turn/start"
    TURN_INTERRUPT = "turn/interrupt"


class CLIENT_NOTIFICATION_METHODS(StrEnum):
    INITIALIZED = "initialized"


class SERVER_NOTIFICATION_METHODS(StrEnum):
    ERROR = "error"
    THREAD_CLOSED = "thread/closed"
    TURN_STARTED = "turn/started"
    TURN_COMPLETED = "turn/completed"
    PLAN_DELTA = "item/plan/delta"
    TURN_PLAN_UPDATED = "turn/plan/updated"
    ITEM_STARTED = "item/started"
    AGENT_MESSAGE_DELTA = "item/agentMessage/delta"
    COMMAND_OUTPUT_DELTA = "item/commandExecution/outputDelta"
    FILE_CHANGE_PATCH_UPDATED = "item/fileChange/patchUpdated"
    PROCESS_EXITED = "process/exited"


class SERVER_REQUEST_METHODS(StrEnum):
    COMMAND_APPROVAL = "item/commandExecution/requestApproval"
    FILE_CHANGE_APPROVAL = "item/fileChange/requestApproval"
    LEGACY_EXEC_COMMAND_APPROVAL = "execCommandApproval"
    LEGACY_APPLY_PATCH_APPROVAL = "applyPatchApproval"


NEW_APPROVAL_REQUEST_METHODS = {
    SERVER_REQUEST_METHODS.COMMAND_APPROVAL,
    SERVER_REQUEST_METHODS.FILE_CHANGE_APPROVAL,
}

COMMAND_APPROVAL_REQUEST_METHODS = {
    SERVER_REQUEST_METHODS.COMMAND_APPROVAL,
    SERVER_REQUEST_METHODS.LEGACY_EXEC_COMMAND_APPROVAL,
}

FILE_CHANGE_APPROVAL_REQUEST_METHODS = {
    SERVER_REQUEST_METHODS.FILE_CHANGE_APPROVAL,
    SERVER_REQUEST_METHODS.LEGACY_APPLY_PATCH_APPROVAL,
}
