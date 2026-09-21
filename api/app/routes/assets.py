from __future__ import annotations

import logging
import copy
from collections import OrderedDict
import hashlib
import json
import mimetypes
import os
import shutil
import re
import struct
import time
from pathlib import Path
from threading import RLock
from urllib.parse import quote
from uuid import uuid4

from fastapi import APIRouter, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from app.security import require_auth


router = APIRouter(prefix="/assets", tags=["assets"])
logger = logging.getLogger(__name__)
_USAGE_VMD_SYNC_LOCK = RLock()

_MMD_SCAN_CACHE: dict[str, tuple[float, list[Path]]] = {}
_MMD_SCAN_CACHE_TTL_SECONDS = 15.0

V14D_GAME_TEXTURES = (
    ("body-normal", "normalmap/body_n.png", ("body", "skin", "face"), "normal"),
    ("body-rmo", "normalmap/body_rmo.png", ("body", "skin", "face"), "rmo"),
    ("cloth1-normal", "normalmap/c_KoledaSSR01_slg_cloth1_n.png", ("cth1",), "normal"),
    ("cloth1-rmo", "normalmap/c_koledassr01_slg_cloth1_rmo_06_11_2026.png", ("cth1",), "rmo"),
    ("cloth2-normal", "normalmap/c_KoledaSSR01_slg_cloth2_n.png", ("cth2",), "normal"),
    ("cloth2-rmo", "normalmap/c_koledassr01_slg_cloth2_rmo_06_11_2026.png", ("cth2",), "rmo"),
    ("cloth4-normal", "normalmap/c_KoledaSSR01_slg_cloth4_n.png", ("cth4",), "normal"),
    ("cloth4-rmo", "normalmap/c_koledassr01_slg_cloth4_rmo_06_11_2026.png", ("cth4",), "rmo"),
    ("cloth5-normal", "normalmap/c_KoledaSSR01_slg_cloth5_n.png", ("cth5",), "normal"),
    ("cloth5-rmo", "normalmap/c_koledassr01_slg_cloth5_rmo_06_11_2026.png", ("cth5",), "rmo"),
    ("glock-normal", "normalmap/c_KoledaSSR01_slg_glock_n.png", ("glock",), "normal"),
    ("glock-rmo", "normalmap/c_KoledaSSR01_slg_glock_rmo.png", ("glock",), "rmo"),
    ("hair-specular", "normalmap/c_KoledaSSR01_slg_hair_spc.png", ("hair",), "specular"),
)

V14D_GAME_OCIO = (
    ("processor", "ocio/processor.json"),
    ("shader", "ocio/processor.glsl"),
    ("lut0", "ocio/lut-0.rgba32f"),
    ("lut1", "ocio/lut-1.rgba32f"),
)

V14D_GAME_MODEL_DEPENDENCY_DIRS = frozenset({"Textures", "spa", "normalmap"})


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


def _asset_public(
    settings,
    item: dict,
    *,
    favorite_model_paths: list[str] | None = None,
    display_name_override: str | None = None,
) -> dict:
    """对外资产视图。

    `favorite_model_paths` 列出收藏了该 asset 的模型；同一个动作文件可以被多个模型
    各自收藏，因此这里是列表而不是单值。`is_favorite` 保留为「至少被一个模型收藏」，
    仅用于兼容旧调用方；按模型判断请使用 `favorite_model_paths`。
    """
    models = sorted({path for path in (favorite_model_paths or []) if path})
    return {
        "asset_id": item["asset_id"],
        "user_id": item["user_id"],
        "slot": item["slot"],
        "filename": item["filename"],
        "display_name": display_name_override or item.get("display_name") or item["filename"],
        "source_relative_path": item.get("source_relative_path"),
        "is_favorite": bool(models) or bool(item.get("is_favorite")),
        "favorite_model_paths": models,
        "favorite_relative_path": item.get("favorite_relative_path"),
        "favorite_model_relative_path": models[0] if len(models) == 1 else item.get("favorite_model_relative_path"),
        "size_bytes": item["size_bytes"],
        "created_at": item["created_at"],
        "motion_profile": _asset_motion_profile(settings, item),
        "url": f"/assets/vmd/file/{item['asset_id']}",
    }


def _resolve_mmd_request_path(root: Path, file_path: str) -> Path:
    """把 MMD 根目录下的相对路径解析成真实文件路径。

    越界判定必须在解析符号链接之前完成：MMD_ROOT_DIR 里可以合法存在
    junction / symlink（例如 `克莱妲原皮 -> D:/mmd/克莱妲原皮`），resolve() 之后
    路径会落到根目录之外，但它在根目录里就是一个正常条目，不该被判成非法。
    因此这里先对未解析的拼接路径做 `..` 越界检查，通过后再 resolve，
    把符号链接交给文件系统处理。
    """
    normalized_path = str(file_path or "").replace("\\", "/")
    if normalized_path.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid path.")
    if len(normalized_path) >= 2 and normalized_path[1] == ":":
        # Windows 绝对路径 / 盘符路径
        raise HTTPException(status_code=400, detail="Invalid path.")

    root_abs = Path(root).absolute()
    lexical = Path(os.path.normpath(str(root_abs / normalized_path)))
    if lexical != root_abs and root_abs not in lexical.parents:
        raise HTTPException(status_code=400, detail="Invalid path.")
    return lexical.resolve()


def _mmd_lexical_relative_path(path: Path, root: Path) -> Path | None:
    """不解析符号链接地求 path 相对 root 的路径。

    junction / symlink 条目在 resolve() 之后会落到 root 之外，
    对这类路径调用 relative_to(root) 会抛 ValueError。这里只做词法比较。
    """
    root_abs = Path(root).absolute()
    candidate = Path(path).absolute()
    for base, target in ((candidate, root_abs),):
        if target == base:
            return Path(".")
        if target in base.parents:
            return base.relative_to(target)
    # 路径已被解析过：尝试从 root 的子项里按名字找回词法路径
    try:
        rel = Path(path).relative_to(root)
        return rel
    except ValueError:
        return None


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
    # 路径可能来自 junction / symlink，其解析后位置不在 root 之下，
    # 因此不能对已解析路径调用 relative_to(root)。这里用词法相对路径。
    lexical = _mmd_lexical_relative_path(path, root)
    if lexical is None:
        return path.parent.name or path.stem or path.name
    relative_parent = lexical.parent
    if str(relative_parent) in {".", ""}:
        return lexical.stem or lexical.name
    return lexical.parent.name or lexical.stem or lexical.name


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


def _is_builtin_relative_path(relative_path: str | None) -> bool:
    """`usage/vmd/_builtin/` 下的动作是无归属的共享素材，不是任何模型的收藏。"""
    if not relative_path:
        return False
    normalized = Path(str(relative_path).replace("\\", "/"))
    return normalized.parts[:3] == ("usage", "vmd", "_builtin")


def _normalize_model_relative_path(model_relative_path: str | None) -> str:
    return str(model_relative_path or "").replace("\\", "/").strip("/")


def _model_relative_path_exists(root: Path, model_relative_path: str) -> bool:
    """确认归属模型确实存在于 MMD 根目录下，避免写入任意字符串。"""
    if not model_relative_path:
        return False
    try:
        candidate = _resolve_mmd_request_path(root, model_relative_path)
    except HTTPException:
        return False
    return candidate.is_file() and candidate.suffix.lower() in MMD_MODEL_EXTENSIONS


def _favorite_rows_for_model(store, user_id: str, model_relative_path: str) -> list[dict]:
    """该用户在指定模型下的收藏记录（含 display_name 覆盖）。"""
    normalized = _normalize_model_relative_path(model_relative_path)
    if not normalized:
        return []
    return store.list_model_favorite_rows(user_id, normalized)


def _sync_usage_vmd_assets_to_db(settings, store, user_id: str) -> None:
    """登记 `MMD/` 下可被引用的动作素材，并清理失效的收藏引用。

    收藏关系保存在 `asset_model_favorites` 表里，不再靠扫描各模型 `[动作]` 目录
    反推归属，也不再把文件复制到模型目录。这里只负责两件事：
    1. 把 `vmd/` 与 `usage/vmd/` 下的动作文件登记成 asset（文件仍只存一份）；
    2. 清掉指向已不存在 asset 或已不存在模型的收藏行。
    """
    with _USAGE_VMD_SYNC_LOCK:
        root = settings.mmd_root_dir.resolve()
        all_items = store.list_assets(requester_user_id=user_id, is_admin=False, user_id_filter=user_id)
        known_paths = {item.get("relative_path") for item in all_items}

        # `MMD/vmd/` 与 `MMD/usage/vmd/` 下的动作都可被收藏引用，各登记一次。
        for motion_path in _iter_mmd_vmds(root):
            relative_path = motion_path.relative_to(root).as_posix()
            if relative_path in known_paths:
                continue
            created = store.add_asset(
                user_id=user_id,
                slot="neutral",
                filename=motion_path.name,
                source_relative_path=relative_path,
                relative_path=relative_path,
                size_bytes=motion_path.stat().st_size,
            )
            known_paths.add(relative_path)
            all_items.append(created)

        # 失效引用清理：asset 被删除，或归属模型已从 MMD 目录移除。
        live_asset_ids = {item["asset_id"] for item in all_items}
        live_model_cache: dict[str, bool] = {}
        for row in store.list_all_model_favorite_rows(user_id):
            if row["asset_id"] not in live_asset_ids:
                store.remove_model_favorite(user_id, row["model_relative_path"], row["asset_id"])
                continue
            model_path = row["model_relative_path"]
            if model_path not in live_model_cache:
                live_model_cache[model_path] = _model_relative_path_exists(root, model_path)
            if not live_model_cache[model_path]:
                store.remove_model_favorite(user_id, model_path, row["asset_id"])

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
    # 不能对可能已被解析过的路径调用 relative_to(root)：junction 会抛 ValueError。
    lexical = _mmd_lexical_relative_path(path, root)
    relative_path = (lexical if lexical is not None else Path(path.name)).as_posix()
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
    requester = require_auth(request)
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
    model_relative_path: str | None = Query(default=None),
    x_user_id: str | None = Header(default=None),
):
    settings = request.app.state.settings
    requester = require_auth(request)
    store = request.app.state.trace_store
    sync_user_id = user_id if requester.is_admin and user_id else requester.user_id
    _sync_usage_vmd_assets_to_db(settings, store, sync_user_id)
    items = store.list_assets(
        requester_user_id=requester.user_id,
        is_admin=requester.is_admin,
        user_id_filter=user_id,
    )
    # 收藏关系来自 `asset_model_favorites`：同一 asset 可被多个模型各自收藏。
    # 每个 asset 在响应里附带它被哪些模型收藏（favorite_model_paths）。
    favorite_rows = store.list_all_model_favorite_rows(sync_user_id)
    models_by_asset: dict[str, list[str]] = {}
    display_override: dict[tuple[str, str], str] = {}
    for row in favorite_rows:
        models_by_asset.setdefault(row["asset_id"], []).append(row["model_relative_path"])
        if row.get("display_name"):
            display_override[(row["asset_id"], row["model_relative_path"])] = row["display_name"]
    for models in models_by_asset.values():
        models.sort()

    # 调用方指定当前模型时，返回该模型自己看到的名称；否则回退 asset 的全局名称。
    scoped_model = _normalize_model_relative_path(model_relative_path)
    return {
        "items": [
            _asset_public(
                settings,
                item,
                favorite_model_paths=models_by_asset.get(item["asset_id"], []),
                display_name_override=display_override.get((item["asset_id"], scoped_model)),
            )
            for item in items
        ]
    }


@router.patch("/vmd/{asset_id}")
def update_vmd_asset(
    asset_id: str,
    payload: VmdAssetUpdatePayload,
    request: Request,
    x_user_id: str | None = Header(default=None),
):
    settings = request.app.state.settings
    requester = require_auth(request)
    store = request.app.state.trace_store
    item = store.get_asset(asset_id)
    if not item:
        raise HTTPException(status_code=404, detail="Asset not found.")
    if not requester.is_admin and requester.user_id != item["user_id"]:
        raise HTTPException(status_code=403, detail="Cannot update another user's asset.")

    model_relative_path = _normalize_model_relative_path(
        payload.model_relative_path or item.get("favorite_model_relative_path")
    )

    # 收藏/取消收藏必须指定归属模型：一个 asset 可以被多个模型各自收藏。
    if payload.favorite is True or (payload.favorite is None and payload.display_name is not None and not model_relative_path):
        if not model_relative_path:
            raise HTTPException(
                status_code=400,
                detail="model_relative_path is required when favoriting an asset.",
            )
        if not _model_relative_path_exists(settings.mmd_root_dir.resolve(), model_relative_path):
            raise HTTPException(
                status_code=400,
                detail=f"Model not found under MMD root: {model_relative_path}",
            )

    display_name = item.get("display_name") or item["filename"]
    if payload.display_name is not None and model_relative_path:
        # 重命名按模型隔离：只改该模型自己看到的名称。
        display_name = _normalize_vmd_filename(payload.display_name)
        store.add_model_favorite(
            item["user_id"],
            model_relative_path,
            asset_id,
            display_name=display_name,
        )
    elif payload.display_name is not None and not model_relative_path:
        store.update_asset(
            asset_id,
            display_name=_normalize_vmd_filename(payload.display_name),
            is_favorite=bool(item.get("is_favorite")),
            favorite_relative_path=item.get("favorite_relative_path"),
            favorite_model_relative_path=item.get("favorite_model_relative_path"),
        )

    if payload.favorite is True:
        store.add_model_favorite(
            item["user_id"],
            model_relative_path,
            asset_id,
            display_name=display_name,
        )
    elif payload.favorite is False:
        if not model_relative_path:
            raise HTTPException(
                status_code=400,
                detail="model_relative_path is required when unfavoriting an asset.",
            )
        store.remove_model_favorite(item["user_id"], model_relative_path, asset_id)

    favorite_rows = store.list_model_favorite_rows(item["user_id"], model_relative_path) if model_relative_path else []
    favorite_model_paths = [row["model_relative_path"] for row in favorite_rows if row["asset_id"] == asset_id]
    if not favorite_model_paths and model_relative_path:
        favorite_model_paths = []
    scoped_display_name = next(
        (row.get("display_name") for row in favorite_rows if row["asset_id"] == asset_id and row.get("display_name")),
        None,
    )
    updated = store.get_asset(asset_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Asset not found.")
    return _asset_public(
        settings,
        updated,
        favorite_model_paths=favorite_model_paths,
        display_name_override=scoped_display_name,
    )


@router.delete("/vmd/{asset_id}")
def delete_vmd_asset(asset_id: str, request: Request, x_user_id: str | None = Header(default=None)):
    settings = request.app.state.settings
    requester = require_auth(request)
    store = request.app.state.trace_store
    item = store.get_asset(asset_id)
    if not item:
        raise HTTPException(status_code=404, detail="Asset not found.")
    if not requester.is_admin and requester.user_id != item["user_id"]:
        raise HTTPException(status_code=403, detail="Cannot delete another user's asset.")

    # 文件可能只存在于 API 存储，也可能只存在于 `MMD_ROOT_DIR`（共享素材）。
    # 两处都按解析结果清理，避免留下会被重新扫描回来的孤儿文件。
    removed: set[str] = set()
    for relative_path in (item.get("relative_path"), item.get("source_relative_path")):
        if not relative_path or relative_path in removed:
            continue
        removed.add(relative_path)
        data_path = settings.data_dir / relative_path
        if data_path.exists() and data_path.is_file():
            data_path.unlink()
            continue
        try:
            mmd_path = _resolve_mmd_request_path(settings.mmd_root_dir.resolve(), relative_path)
        except HTTPException:
            continue
        if mmd_path.exists() and mmd_path.is_file():
            mmd_path.unlink()
    # 所有模型的收藏引用一起清掉，避免留下悬空行。
    store.remove_all_model_favorites_for_asset(asset_id)
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


_V14D_CACHE_LOCK = RLock()
_V14D_HASH_CACHE: OrderedDict = OrderedDict()
_V14D_CATALOG_CACHE: OrderedDict = OrderedDict()


def _v14d_file_signature(path: Path):
    try:
        stat = path.stat()
        return (stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
    except OSError:
        return None


def _v14d_game_sha256(path: Path) -> str:
    signature = _v14d_file_signature(path)
    key = str(path)
    with _V14D_CACHE_LOCK:
        cached = _V14D_HASH_CACHE.get(key)
        if cached and cached[0] == signature:
            _V14D_HASH_CACHE.move_to_end(key)
            return cached[1]
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        result = digest.hexdigest()
        if _v14d_file_signature(path) != signature:
            raise HTTPException(status_code=409, detail="资源正在修改，请稍后重试。")
        _V14D_HASH_CACHE[key] = (signature, result)
        _V14D_HASH_CACHE.move_to_end(key)
        while len(_V14D_HASH_CACHE) > 2048:
            _V14D_HASH_CACHE.popitem(last=False)
        return result


def _v14d_game_safe_path(root: Path, relative_path: str) -> Path:
    relative = str(relative_path or "").replace("\\", "/")
    candidate = Path(relative)
    if not relative or candidate.is_absolute() or ".." in candidate.parts:
        raise HTTPException(status_code=400, detail="Invalid V14D game asset path.")
    resolved_root = root.resolve()
    resolved = (resolved_root / candidate).resolve()
    if resolved != resolved_root and resolved_root not in resolved.parents:
        raise HTTPException(status_code=400, detail="Invalid V14D game asset path.")
    return resolved


def _v14d_game_case_insensitive_path(root: Path, relative_path: str) -> Path:
    """解析模型依赖文件路径；Linux 下对大小写不匹配做逐级回退（PMX 常引用小写 textures/ 目录）。"""
    resolved = _v14d_game_safe_path(root, relative_path)
    if resolved.is_file():
        return resolved
    current = root.resolve()
    for part in Path(str(relative_path).replace("\\", "/")).parts:
        if not current.is_dir():
            return resolved
        exact = current / part
        if exact.exists():
            current = exact
            continue
        lowered = part.casefold()
        match = next((child for child in current.iterdir() if child.name.casefold() == lowered), None)
        if match is None:
            return resolved
        current = match
    fallback = _v14d_game_safe_path(root, str(current.relative_to(root.resolve())).replace("\\", "/"))
    return fallback if fallback.is_file() else resolved


def _v14d_game_source_lights(source_manifest: dict) -> tuple[list[dict], list[str]]:
    raw_lights = source_manifest.get("lights")
    if not isinstance(raw_lights, list) or len(raw_lights) != 6:
        return [], ["source manifest 的六灯数量不是 6"]

    lights: list[dict] = []
    errors: list[str] = []
    for index, source in enumerate(raw_lights):
        matrix = source.get("matrix") if isinstance(source, dict) else None
        color = source.get("color") if isinstance(source, dict) else None
        shape = source.get("shape") if isinstance(source, dict) else None
        light_type = source.get("type") if isinstance(source, dict) else None
        size = source.get("size") if isinstance(source, dict) else None
        power = source.get("power") if isinstance(source, dict) else None
        if (
            not isinstance(matrix, list)
            or len(matrix) != 4
            or any(not isinstance(row, list) or len(row) != 4 for row in matrix)
            or not isinstance(color, list)
            or len(color) != 3
            or light_type != "AREA"
            or shape not in {"DISK", "RECTANGLE"}
            or not isinstance(size, (int, float))
            or not isinstance(power, (int, float))
        ):
            errors.append(f"source manifest 灯光 {index} 字段不完整")
            continue
        try:
            matrix_numbers = [[float(value) for value in row] for row in matrix]
            color_numbers = [float(value) for value in color]
            if any(not isinstance(value, (int, float)) for row in matrix_numbers for value in row):
                raise ValueError("matrix")
            if any(not isinstance(value, (int, float)) for value in color_numbers):
                raise ValueError("color")
            if not all(float(value) == float(value) for row in matrix_numbers for value in row):
                raise ValueError("matrix")
        except (TypeError, ValueError):
            errors.append(f"source manifest 灯光 {index} 数值非法")
            continue
        position = [matrix_numbers[0][3], matrix_numbers[2][3], -matrix_numbers[1][3]]
        lights.append(
            {
                "name": str(source.get("name") or f"source-light-{index}"),
                "type": light_type,
                "shape": shape,
                "power": float(power),
                "color": color_numbers,
                "size": float(size),
                "sizeY": float(source.get("sizeY") or size),
                "matrix": matrix_numbers,
                "position": position,
                "useShadow": bool(source.get("useShadow", False)),
                "backgroundOnly": str(source.get("name") or "").startswith("PROTO_BG_"),
            }
        )
    return lights, errors


def _build_v14d_game_catalog(settings) -> tuple[dict, dict[str, Path]]:
    preview_root = settings.v14d_game_assets_root.resolve()
    mmd_root = getattr(settings, "v14d_game_model_root", settings.mmd_root_dir).resolve()
    model_relative = str(settings.v14d_game_model_relative_path).replace("\\", "/").strip("/")
    model_path = _v14d_game_safe_path(mmd_root, model_relative)
    manifest_path = _v14d_game_safe_path(preview_root / "assets", "manifest.json")
    model_key = f"model/{model_path.name}"
    asset_paths: dict[str, Path] = {model_key: model_path}

    textures = []
    for key, relative_path, material_hints, kind in V14D_GAME_TEXTURES:
        path = _v14d_game_safe_path(model_path.parent, relative_path)
        asset_paths[key] = path
        textures.append(
            {
                "key": key,
                "url": f"/assets/v14d-game/{key}",
                "relativePath": relative_path,
                "materialHints": list(material_hints),
                "kind": kind,
                "sha256": _v14d_game_sha256(path) if path.is_file() else None,
            }
        )

    ocio = {}
    missing = []
    ocio_identity = {}
    for key, relative_path in V14D_GAME_OCIO:
        path = _v14d_game_safe_path(preview_root, relative_path)
        asset_paths[key] = path
        ocio[key] = {
            "url": f"/assets/v14d-game/{key}",
            "relativePath": relative_path,
            "sha256": _v14d_game_sha256(path) if path.is_file() else None,
        }
    processor_path = asset_paths.get("processor")
    if processor_path and processor_path.is_file():
        try:
            ocio_identity = json.loads(processor_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, ValueError) as error:
            missing.append(f"OCIO processor identity unreadable: {error}")

    for key, path in asset_paths.items():
        if not path.is_file():
            missing.append(f"{key}: {path}")
    if not manifest_path.is_file():
        missing.append(f"analysis manifest: {manifest_path}")

    source_manifest = {}
    source_manifest_sha256 = None
    if manifest_path.is_file():
        try:
            source_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            source_manifest_sha256 = _v14d_game_sha256(manifest_path)
        except (OSError, ValueError) as error:
            missing.append(f"analysis manifest unreadable: {error}")

    lights, light_errors = _v14d_game_source_lights(source_manifest)
    missing.extend(light_errors)
    asset_paths["material-source"] = manifest_path
    masks = []
    for index, mask in enumerate(source_manifest.get("masks", [])):
        filename = str(mask.get("file", ""))
        mask_path = _v14d_game_safe_path(preview_root / "assets", filename)
        key = f"face-mask-{index}"
        asset_paths[key] = mask_path
        if not mask_path.is_file():
            missing.append(f"脸部遮罩缺失: {key}")
        masks.append({"url": f"/assets/v14d-game/{key}", "sha256": _v14d_game_sha256(mask_path) if mask_path.is_file() else None})
    if len(masks) != 5:
        missing.append("脸部遮罩数量不是5")

    payload = {
        "id": "v14d-koleda-game-reference-local",
        "available": not missing,
        "reason": "" if not missing else "V14D 本机游戏外观资源不可用：" + "; ".join(missing),
        "scope": "仅本机隔离预览；OCIO 许可未确认，不得发布或打包。",
        "model": {
            "url": f"/assets/v14d-game/{model_key}",
            "relativePath": model_relative,
            "sha256": _v14d_game_sha256(model_path) if model_path.is_file() else None,
        },
        "textures": textures,
        "ocio": ocio,
        "ocioIdentity": ocio_identity,
        "lights": lights,
        "settings": {
            "display": "game/ocio",
            "exposure": -0.40,
            "fabricDetail": 2,
            "legStructure": 1,
            "closedEye": "reference",
            "smile": 0.55,
            "iris": 2,
            "autoFace": True,
            "manualMask": 2,
            "lightingEnabled": True,
            "hairMaskStrength": 1,
            "hairMaskView": False,
            "hairDiskCandidate": False,
            "rotation": 0,
        },
        "sourceSha256": source_manifest.get("sourceSha256"),
        "sourceManifestSha256": source_manifest_sha256,
        "materialSource": {"url": "/assets/v14d-game/material-source", "sha256": source_manifest_sha256},
        "masks": masks,
    }
    for entry in [payload["model"], payload["materialSource"], *textures, *ocio.values(), *masks]:
        if entry.get("sha256"):
            entry["url"] += "?v=" + entry["sha256"]
    return payload, asset_paths


def _v14d_game_catalog(settings) -> tuple[dict, dict[str, Path]]:
    key = (str(settings.v14d_game_assets_root.resolve()), str(getattr(settings, "v14d_game_model_root", settings.mmd_root_dir).resolve()), str(settings.v14d_game_model_relative_path))
    with _V14D_CACHE_LOCK:
        cached = _V14D_CATALOG_CACHE.get(key)
        if cached:
            payload, paths, signatures = cached
            if all(_v14d_file_signature(path) == signature for path, signature in signatures):
                _V14D_CATALOG_CACHE.move_to_end(key)
                return copy.deepcopy(payload), paths.copy()
        payload, paths = _build_v14d_game_catalog(settings)
        signatures = [(path, _v14d_file_signature(path)) for path in set(paths.values())]
        _V14D_CATALOG_CACHE[key] = (payload, paths, signatures)
        _V14D_CATALOG_CACHE.move_to_end(key)
        while len(_V14D_CATALOG_CACHE) > 16:
            _V14D_CATALOG_CACHE.popitem(last=False)
        return copy.deepcopy(payload), paths.copy()


@router.get("/v14d-game/manifest")
def get_v14d_game_manifest(request: Request, response: Response):
    settings = request.app.state.settings
    payload, _asset_paths = _v14d_game_catalog(settings)
    response.headers["Cache-Control"] = "no-cache"
    return payload


@router.get("/v14d-game/{asset_key:path}")
def get_v14d_game_asset(asset_key: str, request: Request):
    settings = request.app.state.settings
    payload, asset_paths = _v14d_game_catalog(settings)
    requested_key = str(asset_key or "").replace("\\", "/").strip("/")
    path = asset_paths.get(requested_key)
    if path is None and requested_key.startswith("model/"):
        dependency_relative = requested_key[len("model/") :]
        dependency_parts = Path(dependency_relative.replace("\\", "/")).parts
        if dependency_parts and dependency_parts[0].casefold() in {name.casefold() for name in V14D_GAME_MODEL_DEPENDENCY_DIRS}:
            dependency_root = Path(getattr(settings, "v14d_game_model_root", settings.mmd_root_dir)).resolve() / Path(
                settings.v14d_game_model_relative_path
            ).parent
            path = _v14d_game_case_insensitive_path(dependency_root, dependency_relative)
    if path is None:
        raise HTTPException(status_code=404, detail="V14D 游戏外观资源未登记。")
    if not path.is_file() or payload["available"] is False:
        raise HTTPException(status_code=404, detail=payload["reason"] or "V14D game asset is unavailable.")
    digest = _v14d_game_sha256(path)
    version = request.query_params.get("v")
    if version and version.lower() != digest:
        raise HTTPException(status_code=409, detail="资源版本已变化，请刷新清单。", headers={"Cache-Control": "no-store"})
    etag = '"' + digest + '"'
    headers = {"ETag": etag, "Cache-Control": "private, max-age=31536000, immutable" if version else "private, no-cache"}
    matches = [value.strip() for value in request.headers.get("if-none-match", "").split(",")]
    if etag in matches or ("W/" + etag) in matches or "*" in matches:
        return Response(status_code=304, headers=headers)
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return FileResponse(path, media_type=media_type, filename=path.name, headers=headers)


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
