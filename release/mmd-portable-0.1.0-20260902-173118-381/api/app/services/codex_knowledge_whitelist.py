from __future__ import annotations

import ipaddress
import json
import os
import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import HTTPException


@dataclass(slots=True)
class WhitelistEntry:
    cidr: str
    label: str
    created_at: str

    def to_dict(self) -> dict[str, str]:
        return {
            "cidr": self.cidr,
            "label": self.label,
            "created_at": self.created_at,
        }


class CodexKnowledgeWhitelistStore:
    """来源白名单存储：OpenClaw 访问 FastAPI 审核接口的来源 IP/CIDR。

    白名单持久化到独立 JSON 文件，避免修改 .env 后必须重启服务。
    读取时自动规范化 CIDR；写入时使用临时文件 + 原子替换。
    """

    def __init__(self, path: Path) -> None:
        self.path = Path(path)

    def close(self) -> None:
        """JSON 存储无连接资源；保留统一关闭接口，供应用生命周期调用。"""
        return None

    def _ensure_file(self) -> None:
        if self.path.exists():
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._atomic_write({"version": 1, "entries": []})

    def _atomic_write(self, data: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(
            prefix=f".{self.path.name}.",
            suffix=".tmp",
            dir=str(self.path.parent),
            text=True,
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(data, handle, ensure_ascii=False, indent=2)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp_name, self.path)
        finally:
            if os.path.exists(tmp_name):
                os.unlink(tmp_name)

    def _read(self) -> dict[str, Any]:
        self._ensure_file()
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {"version": 1, "entries": []}
        if not isinstance(raw, dict):
            return {"version": 1, "entries": []}
        return raw

    def _save(self, data: dict[str, Any]) -> None:
        self._atomic_write(data)

    @staticmethod
    def _normalize_cidr(value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("CIDR is empty.")
        if "/" not in text:
            text = f"{text}/32" if ":" not in text else f"{text}/128"
        try:
            network = ipaddress.ip_network(text, strict=False)
        except ValueError as error:
            raise ValueError(f"Invalid CIDR: {text}") from error
        return str(network)

    def list_entries(self) -> list[dict[str, str]]:
        raw = self._read()
        entries = raw.get("entries", [])
        if not isinstance(entries, list):
            return []
        result: list[dict[str, str]] = []
        for item in entries:
            if not isinstance(item, dict):
                continue
            cidr = str(item.get("cidr") or "").strip()
            if not cidr:
                continue
            try:
                result.append(
                    {
                        "cidr": self._normalize_cidr(cidr),
                        "label": str(item.get("label") or ""),
                        "created_at": str(item.get("created_at") or ""),
                    }
                )
            except ValueError:
                continue
        return result

    def add_entry(self, cidr: str, label: str = "") -> dict[str, str]:
        normalized = self._normalize_cidr(cidr)
        raw = self._read()
        entries = raw.get("entries", [])
        if not isinstance(entries, list):
            entries = []
        for item in entries:
            if isinstance(item, dict) and str(item.get("cidr") or "").strip() == normalized:
                raise ValueError(f"CIDR already exists: {normalized}")
        now = datetime.now(UTC).isoformat()
        entries.append({"cidr": normalized, "label": label.strip(), "created_at": now})
        raw["entries"] = entries
        self._save(raw)
        return {"cidr": normalized, "label": label.strip(), "created_at": now}

    def remove_entry(self, cidr: str) -> bool:
        normalized = self._normalize_cidr(cidr)
        raw = self._read()
        entries = raw.get("entries", [])
        if not isinstance(entries, list):
            return False
        remaining = [
            item
            for item in entries
            if not (
                isinstance(item, dict)
                and str(item.get("cidr") or "").strip() == normalized
            )
        ]
        removed = len(remaining) != len(entries)
        if removed:
            raw["entries"] = remaining
            self._save(raw)
        return removed

    def allows(self, client_ip: str) -> bool:
        """判断来源 IP 是否命中白名单。白名单为空时默认放行（兼容现有测试与本地链路）。"""
        entries = self.list_entries()
        if not entries:
            return True
        try:
            address = ipaddress.ip_address(str(client_ip or "").strip())
        except ValueError:
            return False
        for item in entries:
            try:
                if address in ipaddress.ip_network(item["cidr"], strict=False):
                    return True
            except ValueError:
                continue
        return False


def require_whitelisted_ip(store: CodexKnowledgeWhitelistStore | None, client_ip: str) -> None:
    """白名单未启用（store 为空）时放行；启用后未命中来源 IP 直接拒绝。"""
    if store is None:
        return
    if not store.allows(client_ip):
        raise HTTPException(status_code=403, detail="Client IP is not in the knowledge review whitelist.")
