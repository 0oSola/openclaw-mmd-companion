from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt
from fastapi import Depends, Header, HTTPException, Request


@dataclass(slots=True)
class Requester:
    user_id: str
    is_admin: bool


try:
    from nacl.pwhash import argon2id
    _HAS_ARGON2 = True
except ImportError:
    _HAS_ARGON2 = False


def hash_password(password: str) -> str:
    if _HAS_ARGON2:
        return argon2id.str(password.encode("utf-8")).decode("utf-8")
    salt = secrets.token_hex(32)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt.encode(), n=16384, r=8, p=1)
    return "scrypt$" + salt + "$" + digest.hex()


def verify_password(password: str, password_hash: str) -> bool:
    if isinstance(password_hash, bytes):
        password_hash = password_hash.decode("utf-8")
    if password_hash.startswith("scrypt$"):
        _, salt, expected_hex = password_hash.split("$", 2)
        digest = hashlib.scrypt(password.encode("utf-8"), salt=salt.encode(), n=16384, r=8, p=1)
        return hmac.compare_digest(digest.hex(), expected_hex)
    if _HAS_ARGON2:
        try:
            return argon2id.verify(password_hash.encode("utf-8"), password.encode("utf-8"))
        except Exception:
            return False
    return False


_ALGORITHM = "HS256"


def create_token(user_id: str, secret: str, expiry_hours: int = 72) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": user_id,
        "iat": now,
        "exp": now + timedelta(hours=expiry_hours),
    }
    return jwt.encode(payload, secret, algorithm=_ALGORITHM)


def decode_token(token: str, secret: str) -> str:
    try:
        payload = jwt.decode(token, secret, algorithms=[_ALGORITHM])
        return payload["sub"]
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token.")


def resolve_requester(
    x_user_id: str | None = None,
    admin_user_ids: list[str] | None = None,
    *,
    authorization: str | None = None,
    jwt_secret: str = "",
) -> Requester:
    user_id = ""
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
        if jwt_secret:
            user_id = decode_token(token, jwt_secret)
    if not user_id and x_user_id:
        user_id = x_user_id.strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")
    admins = set(admin_user_ids or [])
    return Requester(user_id=user_id, is_admin=user_id in admins)


def require_auth(request: Request) -> Requester:
    """解析当前请求的调用者身份。

    身份来源优先级：中间件已经校验过的 token（写入 request.state）→
    Authorization 头里的 Bearer token → x-user-id 头。

    路由层应当使用本函数而不是直接调用 resolve_requester，否则会被
    "只认 x-user-id" 的旧约定挡住：中间件放行了 Bearer token，路由层却
    再次判定未登录。
    """
    settings = request.app.state.settings
    authorization = request.headers.get("authorization", "")
    x_user_id = request.headers.get("x-user-id", "")
    authenticated_user_id = getattr(request.state, "authenticated_user_id", "")
    return resolve_requester(
        x_user_id=x_user_id or authenticated_user_id or None,
        admin_user_ids=settings.admin_user_ids,
        authorization=authorization or None,
        jwt_secret=settings.jwt_secret,
    )
