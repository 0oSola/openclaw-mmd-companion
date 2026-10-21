from __future__ import annotations

import json
import re
from typing import Any

ALLOWED_EMOTIONS = {"neutral", "happy", "sad", "thinking", "excited", "caring"}
ALLOWED_ACTIONS = {"idle", "nod", "wave", "think", "cheer", "comfort"}
ALLOWED_MOTION_TEMPLATES = {
    "agree_nod",
    "celebrate_big",
    "comfort_lean",
    "disagree_headshake",
    "greet_wave",
    "listen_lean",
    "shy_look_away",
    "thinking_tilt",
}

FALLBACK_TEXT = "I am here. Let's keep going."
FENCED_JSON_RE = re.compile(r"```json\s*(\{.*?\})\s*```", re.IGNORECASE | re.DOTALL)
QUESTION_RE = re.compile(r"[?？]")
KEYWORD_TEMPLATE_HINTS = (
    (re.compile(r"\b(hello|hi|hey|welcome)\b", re.IGNORECASE), "greet_wave"),
    (re.compile(r"\b(no|not really|don't|cannot)\b", re.IGNORECASE), "disagree_headshake"),
    (re.compile(r"\b(sorry|take your time|i am here|i'm here|it is okay)\b", re.IGNORECASE), "comfort_lean"),
)
ACTION_TEMPLATE_MAP = {
    "wave": "greet_wave",
    "think": "thinking_tilt",
    "cheer": "celebrate_big",
    "comfort": "comfort_lean",
    "nod": "agree_nod",
}
MOTION_TEMPLATE_DEFAULTS = {
    "agree_nod": {"duration_ms": 1000, "intensity": 0.6},
    "celebrate_big": {"duration_ms": 1800, "intensity": 0.9},
    "comfort_lean": {"duration_ms": 1600, "intensity": 0.65},
    "disagree_headshake": {"duration_ms": 1300, "intensity": 0.7},
    "greet_wave": {"duration_ms": 1600, "intensity": 0.7},
    "listen_lean": {"duration_ms": 1800, "intensity": 0.45},
    "shy_look_away": {"duration_ms": 1500, "intensity": 0.55},
    "thinking_tilt": {"duration_ms": 1700, "intensity": 0.6},
}


def _safe_list(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    output: list[dict[str, Any]] = []
    for item in value:
        if isinstance(item, dict):
            output.append(item)
    return output


def _clamp_int(value: Any, *, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, parsed))


def _clamp_float(value: Any, *, default: float, minimum: float, maximum: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, parsed))


def _motion_step(template: str, *, duration_ms: int | None = None, intensity: float | None = None) -> dict[str, Any]:
    defaults = MOTION_TEMPLATE_DEFAULTS[template]
    return {
        "template": template,
        "duration_ms": _clamp_int(
            duration_ms,
            default=defaults["duration_ms"],
            minimum=300,
            maximum=6000,
        ),
        "intensity": _clamp_float(
            intensity,
            default=defaults["intensity"],
            minimum=0.1,
            maximum=1.0,
        ),
    }


def _infer_emotion_action(text: str) -> tuple[str, str]:
    if QUESTION_RE.search(text):
        return "thinking", "think"
    if re.search(r"\b(thanks|great|awesome|nice)\b", text, re.IGNORECASE):
        return "happy", "wave"
    if re.search(r"\b(sad|sorry|worry|concern)\b", text, re.IGNORECASE):
        return "caring", "comfort"
    if re.search(r"\b(now|right away|wow|amazing)\b", text, re.IGNORECASE):
        return "excited", "cheer"
    return "neutral", "idle"


def _extract_inline_json(raw: str) -> tuple[dict[str, Any] | None, str]:
    decoder = json.JSONDecoder()
    for idx, char in enumerate(raw):
        if char != "{":
            continue
        try:
            obj, end = decoder.raw_decode(raw[idx:])
        except json.JSONDecodeError:
            continue
        text = f"{raw[:idx]} {raw[idx + end:]}".strip()
        if isinstance(obj, dict):
            return obj, text
    return None, raw.strip()


def _normalize_motion_sequence(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    steps: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        template = str(item.get("template") or "").strip().lower()
        if template not in ALLOWED_MOTION_TEMPLATES:
            continue
        steps.append(
            _motion_step(
                template,
                duration_ms=item.get("duration_ms"),
                intensity=item.get("intensity"),
            )
        )
    return steps


def _synthesize_motion_plan(text: str, emotion: str, action: str) -> dict[str, Any] | None:
    templates: list[str] = []
    lowered_text = text.strip()

    for pattern, template in KEYWORD_TEMPLATE_HINTS:
        if pattern.search(lowered_text):
            templates.append(template)
            break

    default_template = ACTION_TEMPLATE_MAP.get(action)
    if default_template and default_template not in templates:
        templates.append(default_template)

    if emotion == "thinking" and "thinking_tilt" not in templates:
        templates.append("thinking_tilt")
    elif emotion == "caring" and "comfort_lean" not in templates:
        templates.append("comfort_lean")
    elif emotion == "excited" and "celebrate_big" not in templates:
        templates.append("celebrate_big")
    elif emotion == "happy" and "greet_wave" not in templates:
        templates.append("greet_wave")

    if "greet_wave" in templates and "listen_lean" not in templates:
        templates.append("listen_lean")

    if QUESTION_RE.search(lowered_text) and "listen_lean" not in templates:
        templates.append("listen_lean")

    steps = [_motion_step(template) for template in templates[:2] if template in ALLOWED_MOTION_TEMPLATES]
    if not steps:
        return None
    return {"sequence": steps}


def _normalize_motion_plan(payload: dict[str, Any], text: str, emotion: str, action: str) -> dict[str, Any] | None:
    raw_plan = payload.get("motion_plan")
    if isinstance(raw_plan, dict):
        steps = _normalize_motion_sequence(raw_plan.get("sequence"))
        if steps:
            return {"sequence": steps}
    return _synthesize_motion_plan(text, emotion, action)


def _normalize_from_object(payload: dict[str, Any], fallback_text: str, mode: str) -> dict[str, Any]:
    emotion = str(payload.get("emotion") or "neutral").lower()
    raw_action = str(payload.get("action") or "idle").strip()
    action = raw_action.lower()
    text = str(payload.get("text") or fallback_text or "").strip()
    if not text:
        text = FALLBACK_TEXT
    if emotion not in ALLOWED_EMOTIONS:
        emotion = "neutral"
    if action not in ALLOWED_ACTIONS:
        action = raw_action[:120] if raw_action else "idle"
    return {
        "text": text,
        "emotion": emotion,
        "action": action,
        "motion_plan": _normalize_motion_plan(payload, text, emotion, action),
        "memory_ops": _safe_list(payload.get("memory_ops")),
        "tts_emotion_label": payload.get("tts_emotion_label") if isinstance(payload.get("tts_emotion_label"), str) else None,
        "tts_pause_profile": payload.get("tts_pause_profile") if payload.get("tts_pause_profile") in {"podcast", "none"} else "podcast",
        "parse_mode": mode,
    }


def normalize_assistant_reply(raw_text: str) -> dict[str, Any]:
    raw = (raw_text or "").strip()
    if not raw:
        return {
            "text": FALLBACK_TEXT,
            "emotion": "neutral",
            "action": "idle",
            "motion_plan": None,
            "memory_ops": [],
            "tts_emotion_label": None,
            "tts_pause_profile": "podcast",
            "parse_mode": "empty",
        }

    try:
        as_json = json.loads(raw)
        if isinstance(as_json, dict):
            return _normalize_from_object(as_json, fallback_text="", mode="json_raw")
    except json.JSONDecodeError:
        pass

    match = FENCED_JSON_RE.search(raw)
    if match:
        try:
            payload = json.loads(match.group(1))
            clean_text = FENCED_JSON_RE.sub("", raw).strip()
            return _normalize_from_object(payload, fallback_text=clean_text, mode="json_fenced")
        except json.JSONDecodeError:
            pass

    inline_payload, clean_text = _extract_inline_json(raw)
    if inline_payload is not None:
        return _normalize_from_object(inline_payload, fallback_text=clean_text, mode="json_inline")

    emotion, action = _infer_emotion_action(raw)
    return {
        "text": raw,
        "emotion": emotion,
        "action": action,
        "motion_plan": _synthesize_motion_plan(raw, emotion, action),
        "memory_ops": [],
        "tts_emotion_label": None,
        "tts_pause_profile": "podcast",
        "parse_mode": "heuristic",
    }
