from __future__ import annotations

from dataclasses import dataclass

from fastapi import Header, HTTPException


@dataclass(slots=True)
class Requester:
    user_id: str
    is_admin: bool


def resolve_requester(x_user_id: str | None, admin_user_ids: list[str]) -> Requester:
    user_id = (x_user_id or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing x-user-id header.")
    return Requester(user_id=user_id, is_admin=user_id in set(admin_user_ids))

