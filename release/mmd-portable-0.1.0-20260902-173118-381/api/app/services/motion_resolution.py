from __future__ import annotations

from pathlib import Path
from typing import Any


THINKING_MOTION_TOKENS = {"think", "thinking", "thinking_tilt"}
THINKING_VMD_CATEGORY = "03_thinking_waiting"
AKIMBO_MOTION_TOKENS = {"akimbo", "hands_on_hips", "hands-on-hips", "arms_akimbo", "arms-akimbo", "叉腰"}
AKIMBO_VMD_CATEGORY = "06_strong_personality"
UNIVERSAL_FAVORITE_PREFIX = "usage/vmd/优菈_by_原神_339146e6e418d79e85a515b26414c0b0[动作]/"
UNIVERSAL_BUILTIN_PREFIX = "usage/vmd/_builtin/"


def motion_plan_templates(motion_plan: dict | None) -> list[str]:
    if not isinstance(motion_plan, dict):
        return []
    sequence = motion_plan.get("sequence") or []
    templates: list[str] = []
    for item in sequence:
        if not isinstance(item, dict):
            continue
        template = str(item.get("template") or "").strip()
        if template:
            templates.append(template)
    return templates


def _dedupe_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for value in values:
        text = value.strip()
        if not text or text in seen:
            continue
        seen.add(text)
        output.append(text)
    return output


def _match_tokens(asset: dict) -> list[str]:
    display_name = str(asset.get("display_name") or asset.get("filename") or "").strip()
    filename = str(asset.get("filename") or "").strip()
    return _dedupe_strings(
        [
            str(asset.get("asset_id") or ""),
            Path(display_name).stem,
            display_name,
            filename,
        ]
    )


def _asset_search_text(asset: dict) -> str:
    return " ".join(
        str(asset.get(key) or "")
        for key in (
            "display_name",
            "filename",
            "source_relative_path",
            "favorite_relative_path",
            "relative_path",
        )
    ).lower()


def _asset_path_text(asset: dict) -> str:
    return (
        "/".join(
            str(asset.get(key) or "")
            for key in ("favorite_relative_path", "source_relative_path", "relative_path")
        )
        .replace("\\", "/")
        .lower()
    )


def _is_universal_favorite_asset(asset: dict) -> bool:
    if not asset.get("is_favorite"):
        return False
    path = _asset_path_text(asset).strip("/")
    return path.startswith(UNIVERSAL_FAVORITE_PREFIX.rstrip("/").lower())


def _is_universal_builtin_asset(asset: dict) -> bool:
    path = _asset_path_text(asset).strip("/")
    return path.startswith(UNIVERSAL_BUILTIN_PREFIX.rstrip("/").lower())


def list_available_favorite_motion_assets(store: Any, user_id: str, selected_model_path: str) -> list[dict]:
    """返回规范收藏动作与所有 PMX 可读的通用内置动作。"""
    all_user_assets = store.list_assets(requester_user_id=user_id, is_admin=False, user_id_filter=user_id)
    universal_favorites = [asset for asset in all_user_assets if _is_universal_favorite_asset(asset)]
    builtins = [asset for asset in all_user_assets if _is_universal_builtin_asset(asset)]

    merged: list[dict] = []
    seen_asset_ids: set[str] = set()
    for asset in [*universal_favorites, *builtins]:
        asset_id = str(asset.get("asset_id") or "")
        if not asset_id or asset_id in seen_asset_ids:
            continue
        seen_asset_ids.add(asset_id)
        merged.append(asset)
    return merged


def _asset_in_vmd_category(asset: dict, category: str) -> bool:
    path_text = _asset_path_text(asset)
    if not path_text:
        return False
    normalized = f"/{path_text.strip('/')}/"
    category_token = f"/{category.lower().strip('/')}/"
    return category_token in normalized


def _is_thinking_motion_request(candidates: list[str]) -> bool:
    normalized = {candidate.strip().lower() for candidate in candidates if candidate.strip()}
    return bool(normalized & THINKING_MOTION_TOKENS)


def _thinking_asset_rank(asset: dict) -> int:
    text = _asset_search_text(asset)
    score = 0
    if "100pct" in text or "100%" in text:
        score += 100
    if "reference" in text:
        score += 50
    if "思考" in text or "thinking" in text or "think" in text:
        score += 30
    if "看时间" in text or "time" in text:
        score -= 40
    return score


def _is_akimbo_motion_request(candidates: list[str]) -> bool:
    normalized = {candidate.strip().lower() for candidate in candidates if candidate.strip()}
    return bool(normalized & AKIMBO_MOTION_TOKENS)


def _akimbo_asset_rank(asset: dict) -> int:
    text = _asset_search_text(asset)
    score = 0
    if "100pct" in text or "100%" in text:
        score += 100
    if "reference" in text:
        score += 50
    if "叉腰" in text or "akimbo" in text or "hands_on_hips" in text or "hands-on-hips" in text:
        score += 30
    if "扭头" in text:
        score += 5
    return score


def _resolve_semantic_motion_asset(assets: list[dict], candidates: list[str]) -> dict | None:
    if not _is_thinking_motion_request(candidates):
        if not _is_akimbo_motion_request(candidates):
            return None

        akimbo_assets = [
            asset
            for asset in assets
            if _asset_in_vmd_category(asset, AKIMBO_VMD_CATEGORY) and _akimbo_asset_rank(asset) > 0
        ]
        if not akimbo_assets:
            return None
        return max(akimbo_assets, key=_akimbo_asset_rank)

    thinking_assets = [
        asset
        for asset in assets
        if _asset_in_vmd_category(asset, THINKING_VMD_CATEGORY) and _thinking_asset_rank(asset) > 0
    ]
    if not thinking_assets:
        return None
    return max(thinking_assets, key=_thinking_asset_rank)


def resolve_motion_resolution(
    *,
    user_id: str,
    selected_model_path: str | None,
    source_action: str | None,
    motion_plan: dict | None,
    store: Any,
) -> dict:
    templates = motion_plan_templates(motion_plan)
    first_template = templates[0] if templates else None

    if not selected_model_path:
        return {
            "selected_model_path": None,
            "source_action": source_action,
            "source_template": first_template,
            "resolved_asset_id": None,
            "resolved_asset_url": None,
            "resolved_display_name": None,
            "status": "fallback_idle",
            "fallback_reason": "missing_selected_model_path",
        }

    assets = list_available_favorite_motion_assets(store, user_id, selected_model_path)
    token_index: dict[str, dict] = {}
    for asset in assets:
        for token in _match_tokens(asset):
            token_index[token.lower()] = asset

    candidates = [
        str(source_action or "").strip(),
        str(first_template or "").strip(),
        *[template.strip() for template in templates[1:]],
    ]
    for candidate in candidates:
        if not candidate:
            continue
        asset = token_index.get(candidate.lower())
        if asset:
            return {
                "selected_model_path": selected_model_path,
                "source_action": source_action,
                "source_template": first_template,
                "resolved_asset_id": asset["asset_id"],
                "resolved_asset_url": f"/assets/vmd/file/{asset['asset_id']}",
                "resolved_display_name": asset.get("display_name") or asset.get("filename"),
                "status": "matched",
                "fallback_reason": None,
            }

    semantic_asset = _resolve_semantic_motion_asset(assets, candidates)
    if semantic_asset:
        return {
            "selected_model_path": selected_model_path,
            "source_action": source_action,
            "source_template": first_template,
            "resolved_asset_id": semantic_asset["asset_id"],
            "resolved_asset_url": f"/assets/vmd/file/{semantic_asset['asset_id']}",
            "resolved_display_name": semantic_asset.get("display_name") or semantic_asset.get("filename"),
            "status": "matched",
            "fallback_reason": None,
        }

    return {
        "selected_model_path": selected_model_path,
        "source_action": source_action,
        "source_template": first_template,
        "resolved_asset_id": None,
        "resolved_asset_url": None,
        "resolved_display_name": None,
        "status": "fallback_idle",
        "fallback_reason": "no_candidate_matched",
    }
