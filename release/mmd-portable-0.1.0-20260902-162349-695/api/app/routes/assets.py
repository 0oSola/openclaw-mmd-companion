from __future__ import annotations

import logging
import shutil
import re
import struct
import time
from pathlib import Path
from threading import RLock
from urllib.parse import quote
from uuid import uuid4

from fastapi import APIRouter, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.security import resolve_requester


router = APIRouter(prefix="/assets", tags=["assets"])
logger = logging.getLogger(__name__)
_USAGE_VMD_SYNC_LOCK = RLock()

_MMD_SCAN_CACHE: dict[str, tuple[float, list[Path]]] = {}
_MMD_SCAN_CACHE_TTL_SECONDS = 15.0


def _cached_scan(cache_key: str, scan_fn) -> list[Path]:
    now = time.monotonic()
    hit = _MMD_SCAN_CACHE.get(cache_key)
    if hit and (now - hit[0]) < _MMD_SCAN_CACHE_TTL_SECONDS:
        return hit[1]
    result = scan_fn()
    _MMD_SCAN_CACHE[cache_key] = (now, result)
    return result

ALLOWED_SLOTS = {"neutral", "happy", "sad", "thinking", "excited", "caring"}
MMD_MODEL_EXTENSIONS = {".pmx", ".pmd"}
MMD_MOTION_EXTENSIONS = {".vmd"}
UNIVERSAL_FAVORITE_DIRECTORY_NAME = "优菈_by_原神_339146e6e418d79e85a515b26414c0b0[动作]"
UNIVERSAL_BUILTIN_RELATIVE_DIRECTORY = Path("usage") / "vmd" / "_builtin"
VMD_HEADER_SIZE = 50
VMD_BONE_FRAME_SIZE = 111
VMD_LOWER_BODY_MOTION_THRESHOLD = 0.35
VMD_LOWER_BODY_BONE_NAMES = {
    "center",
    "lower body",
    "left leg",
    "right leg",
    "left knee",
    "right knee",
    "left ankle",
    "right ankle",
    "left toe",
    "right toe",
    "left foot ik",
    "right foot ik",
    "left toe ik",
    "right toe ik",
    "センター",
    "下半身",
    "左足",
    "右足",
    "左ひざ",
    "右ひざ",
    "左足首",
    "右足首",
    "左つま先",
    "右つま先",
    "左足ＩＫ",
    "右足ＩＫ",
    "左つま先ＩＫ",
    "右つま先ＩＫ",
}


def _decode_vmd_name(raw_name: bytes) -> str:
    return raw_name.split(b"\x00", 1)[0].decode("cp932", errors="replace").strip()


def _normalize_motion_bone_name(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").replace("_", " ").strip().lower())


def _analyze_vmd_motion_profile(path: Path) -> dict:
    profile = {
        "lower_body_motion_score": 0.0,
        "lower_body_track_count": 0,
        "companion_safe": True,
    }
    try:
        data = path.read_bytes()
    except OSError:
        return profile
    if len(data) < VMD_HEADER_SIZE + 4 or not data.startswith(b"Vocaloid Motion Data"):
        return profile

    try:
        bone_frame_count = struct.unpack_from("<I", data, VMD_HEADER_SIZE)[0]
    except struct.error:
        return profile

    offset = VMD_HEADER_SIZE + 4
    score = 0.0
    track_names: set[str] = set()
    for _ in range(bone_frame_count):
        if offset + VMD_BONE_FRAME_SIZE > len(data):
            break
        name = _decode_vmd_name(data[offset : offset + 15])
        normalized_name = _normalize_motion_bone_name(name)
        if name in VMD_LOWER_BODY_BONE_NAMES or normalized_name in VMD_LOWER_BODY_BONE_NAMES:
            track_names.add(name or normalized_name)
            try:
                pos_x, pos_y, pos_z = struct.unpack_from("<3f", data, offset + 19)
                rot_x, rot_y, rot_z, _rot_w = struct.unpack_from("<4f", data, offset + 31)
            except struct.error:
                break
            score = max(
                score,
                abs(pos_x),
                abs(pos_y),
                abs(pos_z),
                abs(rot_x),
                abs(rot_y),
                abs(rot_z),
            )
        offset += VMD_BONE_FRAME_SIZE

    profile["lower_body_motion_score"] = round(score, 3)
    profile["lower_body_track_count"] = len(track_names)
    profile["companion_safe"] = score <= VMD_LOWER_BODY_MOTION_THRESHOLD
    return profile


def _asset_motion_profile(settings, item: dict) -> dict:
    try:
        path = _resolve_vmd_asset_file_path(settings, item)
    except Exception:
        return {
            "lower_body_motion_score": 0.0,
            "lower_body_track_count": 0,
            "companion_safe": True,
        }
    return _analyze_vmd_motion_profile(path)


def _asset_public(settings, item: dict) -> dict:
    return {
        "asset_id": item["asset_id"],
        "user_id": item["user_id"],
        "slot": item["slot"],
        "filename": item["filename"],
        "display_name": item.get("display_name") or item["filename"],
        "source_relative_path": item.get("source_relative_path"),
        "is_favorite": bool(item.get("is_favorite")),
        "favorite_relative_path": item.get("favorite_relative_path"),
        "favorite_model_relative_path": item.get("favorite_model_relative_path"),
        "size_bytes": item["size_bytes"],
        "created_at": item["created_at"],
        "motion_profile": _asset_motion_profile(settings, item),
        "url": f"/assets/vmd/file/{item['asset_id']}",
    }


def _resolve_mmd_request_path(root: Path, file_path: str) -> Path:
    requested = (root / file_path).resolve()
    if root not in requested.parents and requested != root:
        raise HTTPException(status_code=400, detail="Invalid path.")
    return requested


def _scan_mmd_models(root: Path) -> list[Path]:
    if not root.exists() or not root.is_dir():
        return []
    models = [
        item
        for item in root.rglob("*")
        if item.is_file() and item.suffix.lower() in MMD_MODEL_EXTENSIONS
    ]
    return sorted(models, key=lambda item: item.relative_to(root).as_posix().lower())


def _iter_mmd_models(root: Path) -> list[Path]:
    return _cached_scan(f"models:{root}", lambda: _scan_mmd_models(root))


def _scan_mmd_vmds(root: Path) -> list[Path]:
    motions: list[Path] = []
    for motion_root in (root / "vmd", root / "usage" / "vmd"):
        if not motion_root.exists() or not motion_root.is_dir():
            continue
        motions.extend(
            item
            for item in motion_root.rglob("*")
            if item.is_file() and item.suffix.lower() in MMD_MOTION_EXTENSIONS
        )
    return sorted(motions, key=lambda item: item.relative_to(root).as_posix().lower())


def _iter_mmd_vmds(root: Path) -> list[Path]:
    return _cached_scan(f"vmds:{root}", lambda: _scan_mmd_vmds(root))


def _iter_usage_vmds(root: Path) -> list[Path]:
    motion_root = root / "usage" / "vmd"
    if not motion_root.exists() or not motion_root.is_dir():
        return []
    motions = [
        item
        for item in motion_root.rglob("*")
        if item.is_file() and item.suffix.lower() in MMD_MOTION_EXTENSIONS
    ]
    return sorted(motions, key=lambda item: item.relative_to(root).as_posix().lower())


def _encode_url_path(relative_path: str) -> str:
    return "/".join(quote(part) for part in relative_path.split("/"))


def _mmd_model_label(path: Path, root: Path) -> str:
    relative_parent = path.relative_to(root).parent
    if str(relative_parent) in {".", ""}:
        return path.stem or path.name
    return path.parent.name or path.stem or path.name


def _humanize_motion_label(name: str) -> str:
    label = re.sub(r"[_-]+", " ", name).strip()
    return re.sub(r"\s+", " ", label)


def _sanitize_usage_segment(name: str) -> str:
    clean = re.sub(r'[<>:"/\\\\|?*]+', " ", name).strip()
    clean = re.sub(r"\s+", " ", clean)
    return clean or "Unknown"


def _usage_vmd_folder_name_for_model(model_path: Path, root: Path) -> str:
    relative_parent = model_path.relative_to(root).parent
    parent_name = model_path.stem if str(relative_parent) in {".", ""} else model_path.parent.name
    return f"{_sanitize_usage_segment(parent_name)}[动作]"


def _normalize_vmd_filename(name: str) -> str:
    base = Path((name or "").strip()).name
    stem = Path(base).stem.strip() if base else ""
    suffix = Path(base).suffix.lower() if base else ""
    stem = re.sub(r'[<>:"/\\\\|?*]+', " ", stem)
    stem = re.sub(r"\s+", " ", stem).strip()
    if not stem:
        stem = "motion"
    if suffix != ".vmd":
        suffix = ".vmd"
    return f"{stem}{suffix}"


def _ensure_unique_path(directory: Path, filename: str) -> Path:
    candidate = directory / filename
    if not candidate.exists():
        return candidate
    stem = Path(filename).stem
    suffix = Path(filename).suffix or ".vmd"
    index = 2
    while True:
        next_candidate = directory / f"{stem} ({index}){suffix}"
        if not next_candidate.exists():
            return next_candidate
        index += 1


def _universal_favorite_directory(root: Path) -> Path:
    return root / "usage" / "vmd" / UNIVERSAL_FAVORITE_DIRECTORY_NAME


def _universal_builtin_directory(root: Path) -> Path:
    return root / UNIVERSAL_BUILTIN_RELATIVE_DIRECTORY


def _relative_path_starts_with(relative_path: str | None, directory: Path) -> bool:
    if not relative_path:
        return False
    normalized = Path(relative_path.replace("\\", "/"))
    try:
        normalized.relative_to(directory)
    except ValueError:
        return False
    return True


def _is_universal_favorite_relative_path(relative_path: str | None) -> bool:
    return _relative_path_starts_with(
        relative_path,
        Path("usage") / "vmd" / UNIVERSAL_FAVORITE_DIRECTORY_NAME,
    )


def _infer_model_relative_path_from_favorite_path(root: Path, favorite_relative_path: str | None) -> str | None:
    if not favorite_relative_path:
        return None
    favorite_path = Path(favorite_relative_path)
    if len(favorite_path.parts) < 4:
        return None
    favorite_folder = favorite_path.parts[2]
    matches: list[str] = []
    for model_path in _iter_mmd_models(root):
        folder_name = _usage_vmd_folder_name_for_model(model_path, root)
        if folder_name == favorite_folder:
            matches.append(model_path.relative_to(root).as_posix())
    if len(matches) == 1:
        return matches[0]
    return None


def _remove_favorite_copy(settings, item: dict) -> None:
    favorite_relative_path = item.get("favorite_relative_path")
    if not favorite_relative_path:
        return
    favorite_path = settings.mmd_root_dir / favorite_relative_path
    if favorite_path.exists():
        favorite_path.unlink()


def _sync_favorite_copy(settings, item: dict, display_name: str, model_relative_path: str) -> str:
    source_path = settings.data_dir / item["relative_path"]
    if not source_path.exists():
        raise HTTPException(status_code=404, detail="Asset file missing.")
    favorite_dir = _universal_favorite_directory(settings.mmd_root_dir.resolve())
    favorite_dir.mkdir(parents=True, exist_ok=True)
    target_path = favorite_dir / display_name
    previous_relative_path = item.get("favorite_relative_path")
    previous_path = settings.mmd_root_dir / previous_relative_path if previous_relative_path else None
    if previous_path and previous_path != target_path and previous_path.exists():
        previous_path.unlink()
    if target_path.exists() and (not previous_path or target_path != previous_path):
        target_path = _ensure_unique_path(favorite_dir, display_name)
    shutil.copyfile(source_path, target_path)
    return target_path.relative_to(settings.mmd_root_dir).as_posix()


def _sync_usage_vmd_assets_to_db(settings, store, user_id: str) -> None:
    with _USAGE_VMD_SYNC_LOCK:
        root = settings.mmd_root_dir.resolve()
        favorite_dir = _universal_favorite_directory(root)
        builtin_dir = _universal_builtin_directory(root)
        all_items = store.list_assets(requester_user_id=user_id, is_admin=False, user_id_filter=user_id)
        canonical_favorite_paths: set[str] = set()
        for item in all_items:
            favorite_relative_path = item.get("favorite_relative_path")
            favorite_path = root / favorite_relative_path if favorite_relative_path else None
            invalid_or_duplicate_favorite = (
                not _is_universal_favorite_relative_path(favorite_relative_path)
                or favorite_path is None
                or not favorite_path.is_file()
                or favorite_relative_path in canonical_favorite_paths
            )
            if item.get("is_favorite") and invalid_or_duplicate_favorite:
                store.update_asset(
                    item["asset_id"],
                    display_name=item.get("display_name"),
                    is_favorite=False,
                    favorite_relative_path=None,
                    favorite_model_relative_path=None,
                )
            elif item.get("is_favorite"):
                canonical_favorite_paths.add(favorite_relative_path)

        if favorite_dir.exists():
            for motion_path in favorite_dir.rglob("*"):
                if not motion_path.is_file() or motion_path.suffix.lower() not in MMD_MOTION_EXTENSIONS:
                    continue
                builtin_path = builtin_dir / motion_path.relative_to(favorite_dir)
                builtin_path.parent.mkdir(parents=True, exist_ok=True)
                if not builtin_path.exists() or builtin_path.stat().st_size != motion_path.stat().st_size:
                    shutil.copy2(motion_path, builtin_path)

        canonical_model_paths = [
            model_path.relative_to(root).as_posix()
            for model_path in _iter_mmd_models(root)
            if _usage_vmd_folder_name_for_model(model_path, root) == UNIVERSAL_FAVORITE_DIRECTORY_NAME
        ]
        canonical_model_path = canonical_model_paths[0] if len(canonical_model_paths) == 1 else None
        motion_paths = [
            item
            for directory in (favorite_dir, builtin_dir)
            if directory.exists()
            for item in directory.rglob("*")
            if item.is_file() and item.suffix.lower() in MMD_MOTION_EXTENSIONS
        ]
        for motion_path in motion_paths:
            favorite_relative_path = motion_path.relative_to(root).as_posix()
            is_universal_favorite = _is_universal_favorite_relative_path(favorite_relative_path)
            existing = next(
                (
                    item
                    for item in all_items
                    if item.get("relative_path") == favorite_relative_path
                    or item.get("favorite_relative_path") == favorite_relative_path
                ),
                None,
            )
            display_name = _normalize_vmd_filename(motion_path.name)
            if existing:
                if is_universal_favorite and (
                    not existing.get("is_favorite")
                    or existing.get("favorite_model_relative_path") != canonical_model_path
                    or not existing.get("display_name")
                ):
                    store.update_asset(
                        existing["asset_id"],
                        display_name=existing.get("display_name") or display_name,
                        is_favorite=True,
                        favorite_relative_path=favorite_relative_path,
                        favorite_model_relative_path=canonical_model_path,
                    )
                continue

            created = store.add_asset(
                user_id=user_id,
                slot="neutral",
                filename=motion_path.name,
                source_relative_path=favorite_relative_path,
                relative_path=favorite_relative_path,
                size_bytes=motion_path.stat().st_size,
            )
            if is_universal_favorite:
                store.update_asset(
                    created["asset_id"],
                    display_name=display_name,
                    is_favorite=True,
                    favorite_relative_path=favorite_relative_path,
                    favorite_model_relative_path=canonical_model_path,
                )


def _resolve_vmd_asset_file_path(settings, item: dict) -> Path:
    data_path = settings.data_dir / item["relative_path"]
    if data_path.exists():
        return data_path

    root = settings.mmd_root_dir.resolve()
    for relative_path in (item.get("relative_path"), item.get("favorite_relative_path")):
        if not relative_path:
            continue
        try:
            mmd_path = _resolve_mmd_request_path(root, relative_path)
        except HTTPException:
            continue
        if mmd_path.exists() and mmd_path.is_file():
            return mmd_path
    return data_path


class VmdAssetUpdatePayload(BaseModel):
    display_name: str | None = None
    favorite: bool | None = None
    model_relative_path: str | None = None


def _mmd_model_public(path: Path, root: Path) -> dict:
    relative_path = path.relative_to(root).as_posix()
    return {
        "name": path.name,
        "label": _mmd_model_label(path, root),
        "relative_path": relative_path,
        "size_bytes": path.stat().st_size,
        "url": f"/assets/mmd/{_encode_url_path(relative_path)}",
    }


def _mmd_motion_public(path: Path, root: Path) -> dict:
    relative_path = path.relative_to(root).as_posix()
    return {
        "name": path.name,
        "label": _humanize_motion_label(path.stem or path.name),
        "relative_path": relative_path,
        "size_bytes": path.stat().st_size,
        "url": f"/assets/mmd/{_encode_url_path(relative_path)}",
    }


@router.post("/vmd")
async def upload_vmd(
    request: Request,
    user_id: str = Form(...),
    slot: str = Form(...),
    source_relative_path: str | None = Form(default=None),
    file: UploadFile = File(...),
    x_user_id: str | None = Header(default=None),
):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    if not requester.is_admin and requester.user_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot upload for another user.")
    if slot not in ALLOWED_SLOTS:
        raise HTTPException(status_code=400, detail="Invalid slot.")
    if not file.filename.lower().endswith(".vmd"):
        raise HTTPException(status_code=400, detail="Only .vmd files are allowed.")

    logger.info(
        "vmd upload request user=%s slot=%s filename=%s source_relative_path=%s",
        user_id,
        slot,
        file.filename,
        source_relative_path or "",
    )

    data = await file.read()
    if len(data) > 30 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (30MB max).")

    asset_root = settings.data_dir / "storage" / "vmd" / user_id / slot
    asset_root.mkdir(parents=True, exist_ok=True)
    local_name = f"{uuid4()}.vmd"
    full_path = asset_root / local_name
    full_path.write_bytes(data)
    relative_path = str(full_path.relative_to(settings.data_dir))
    store = request.app.state.trace_store
    item = store.add_asset(
        user_id=user_id,
        slot=slot,
        filename=file.filename,
        source_relative_path=source_relative_path,
        relative_path=relative_path,
        size_bytes=len(data),
    )
    logger.info(
        "vmd upload stored asset_id=%s filename=%s source_relative_path=%s",
        item["asset_id"],
        item["filename"],
        item.get("source_relative_path") or "",
    )
    return _asset_public(settings, item)


@router.get("/vmd")
def list_vmd_assets(
    request: Request,
    user_id: str | None = Query(default=None),
    x_user_id: str | None = Header(default=None),
):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    store = request.app.state.trace_store
    sync_user_id = user_id if requester.is_admin and user_id else requester.user_id
    _sync_usage_vmd_assets_to_db(settings, store, sync_user_id)
    items = store.list_assets(
        requester_user_id=requester.user_id,
        is_admin=requester.is_admin,
        user_id_filter=user_id,
    )
    root = settings.mmd_root_dir.resolve()
    normalized_items: list[dict] = []
    for item in items:
        if item.get("is_favorite") and not item.get("favorite_model_relative_path"):
            inferred_model_relative_path = _infer_model_relative_path_from_favorite_path(
                root, item.get("favorite_relative_path")
            )
            if inferred_model_relative_path:
                updated = store.update_asset(
                    item["asset_id"],
                    display_name=item.get("display_name"),
                    is_favorite=bool(item.get("is_favorite")),
                    favorite_relative_path=item.get("favorite_relative_path"),
                    favorite_model_relative_path=inferred_model_relative_path,
                )
                if updated:
                    item = updated
        normalized_items.append(item)
    return {"items": [_asset_public(settings, item) for item in normalized_items]}


@router.patch("/vmd/{asset_id}")
def update_vmd_asset(
    asset_id: str,
    payload: VmdAssetUpdatePayload,
    request: Request,
    x_user_id: str | None = Header(default=None),
):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    store = request.app.state.trace_store
    item = store.get_asset(asset_id)
    if not item:
        raise HTTPException(status_code=404, detail="Asset not found.")
    if not requester.is_admin and requester.user_id != item["user_id"]:
        raise HTTPException(status_code=403, detail="Cannot update another user's asset.")

    display_name = _normalize_vmd_filename(payload.display_name or item.get("display_name") or item["filename"])
    is_favorite = bool(item.get("is_favorite"))
    favorite_relative_path = item.get("favorite_relative_path")
    favorite_model_relative_path = item.get("favorite_model_relative_path")

    if payload.favorite is not None:
        is_favorite = payload.favorite
    if is_favorite:
        model_relative_path = (
            payload.model_relative_path
            or favorite_model_relative_path
            or _infer_model_relative_path_from_favorite_path(
                settings.mmd_root_dir.resolve(), favorite_relative_path
            )
        )
        if not model_relative_path:
            raise HTTPException(status_code=400, detail="model_relative_path is required when favoriting an asset.")
        favorite_relative_path = _sync_favorite_copy(settings, item, display_name, model_relative_path)
        favorite_model_relative_path = (
            _infer_model_relative_path_from_favorite_path(settings.mmd_root_dir.resolve(), favorite_relative_path)
            or model_relative_path
        )
    else:
        _remove_favorite_copy(settings, item)
        favorite_relative_path = None
        favorite_model_relative_path = None

    updated = store.update_asset(
        asset_id,
        display_name=display_name,
        is_favorite=is_favorite,
        favorite_relative_path=favorite_relative_path,
        favorite_model_relative_path=favorite_model_relative_path,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Asset not found.")
    return _asset_public(settings, updated)


@router.delete("/vmd/{asset_id}")
def delete_vmd_asset(asset_id: str, request: Request, x_user_id: str | None = Header(default=None)):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    store = request.app.state.trace_store
    item = store.get_asset(asset_id)
    if not item:
        raise HTTPException(status_code=404, detail="Asset not found.")
    if not requester.is_admin and requester.user_id != item["user_id"]:
        raise HTTPException(status_code=403, detail="Cannot delete another user's asset.")

    full_path = settings.data_dir / item["relative_path"]
    if full_path.exists():
        full_path.unlink()
    _remove_favorite_copy(settings, item)
    store.delete_asset(asset_id)
    return {"deleted": True, "asset_id": asset_id}


@router.get("/vmd/file/{asset_id}")
def get_vmd_asset_file(asset_id: str, request: Request):
    settings = request.app.state.settings
    store = request.app.state.trace_store
    item = store.get_asset(asset_id)
    if not item:
        raise HTTPException(status_code=404, detail="Asset not found.")
    full_path = _resolve_vmd_asset_file_path(settings, item)
    if not full_path.exists():
        raise HTTPException(status_code=404, detail="Asset file missing.")
    return FileResponse(full_path, media_type="application/octet-stream", filename=item["filename"])


@router.get("/mmd/models")
def list_mmd_models(request: Request):
    settings = request.app.state.settings
    root = settings.mmd_root_dir.resolve()
    models = _iter_mmd_models(root)
    return {
        "root_dir": str(root),
        "root_exists": root.exists() and root.is_dir(),
        "count": len(models),
        "items": [_mmd_model_public(model, root) for model in models],
    }


@router.get("/mmd/vmds")
def list_mmd_vmds(request: Request):
    settings = request.app.state.settings
    root = settings.mmd_root_dir.resolve()
    motions = _iter_mmd_vmds(root)
    motion_root = root / "vmd"
    return {
        "root_dir": str(motion_root),
        "root_exists": motion_root.exists() and motion_root.is_dir(),
        "count": len(motions),
        "items": [_mmd_motion_public(motion, root) for motion in motions],
    }


@router.get("/mmd/validate")
def validate_mmd_models(request: Request, model_path: str | None = Query(default=None)):
    settings = request.app.state.settings
    root = settings.mmd_root_dir.resolve()
    root_exists = root.exists() and root.is_dir()
    if not root_exists:
        return {
            "root_dir": str(root),
            "root_exists": False,
            "count": 0,
            "all_ok": False,
            "items": [],
            "message": "MMD root directory does not exist.",
        }

    if model_path:
        requested = _resolve_mmd_request_path(root, model_path)
        if requested.suffix.lower() not in MMD_MODEL_EXTENSIONS:
            raise HTTPException(status_code=400, detail="Only .pmx/.pmd model files are supported.")
        if not requested.exists() or not requested.is_file():
            raise HTTPException(status_code=404, detail="MMD model not found.")
        targets = [requested]
    else:
        targets = _iter_mmd_models(root)

    items = []
    for target in targets:
        payload = _mmd_model_public(target, root)
        payload["valid"] = target.exists() and target.is_file()
        items.append(payload)

    return {
        "root_dir": str(root),
        "root_exists": True,
        "count": len(items),
        "all_ok": len(items) > 0 and all(item["valid"] for item in items),
        "items": items,
    }


@router.get("/mmd/{file_path:path}")
def serve_mmd_file(file_path: str, request: Request):
    settings = request.app.state.settings
    root = settings.mmd_root_dir.resolve()
    requested = _resolve_mmd_request_path(root, file_path)
    if not requested.exists() or not requested.is_file():
        raise HTTPException(status_code=404, detail="MMD asset not found.")
    return FileResponse(requested)
