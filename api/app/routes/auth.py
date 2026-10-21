from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.security import create_token, hash_password, verify_password


router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=256)


class RegisterRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=6, max_length=256)
    display_name: str = Field(default="", max_length=128)


class TokenResponse(BaseModel):
    token: str
    user_id: str
    expires_in_hours: int


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, request: Request) -> TokenResponse:
    settings = request.app.state.settings
    if not settings.jwt_secret:
        raise HTTPException(status_code=503, detail="Authentication not configured.")

    store = request.app.state.trace_store
    account = store.resolve_account(payload.user_id)
    password_hash = account.get("password_hash") or ""
    if not password_hash or not verify_password(payload.password, password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    token = create_token(
        user_id=payload.user_id,
        secret=settings.jwt_secret,
        expiry_hours=settings.jwt_expiry_hours,
    )
    return TokenResponse(
        token=token,
        user_id=payload.user_id,
        expires_in_hours=settings.jwt_expiry_hours,
    )


@router.post("/register", response_model=TokenResponse)
async def register(payload: RegisterRequest, request: Request) -> TokenResponse:
    settings = request.app.state.settings
    if not settings.jwt_secret:
        raise HTTPException(status_code=503, detail="Authentication not configured.")

    store = request.app.state.trace_store
    existing = store._conn.execute(
        "SELECT id FROM accounts WHERE external_user_id = ?",
        (payload.user_id,),
    ).fetchone()
    if existing:
        row = store._conn.execute(
            "SELECT password_hash FROM accounts WHERE external_user_id = ?",
            (payload.user_id,),
        ).fetchone()
        if row and row[0]:
            raise HTTPException(status_code=409, detail="Account already has a password.")
        store._conn.execute(
            "UPDATE accounts SET password_hash = ?, updated_at = datetime('now') WHERE external_user_id = ?",
            (hash_password(payload.password), payload.user_id),
        )
        store._conn.commit()
    else:
        account = store.resolve_account(payload.user_id)
        store._conn.execute(
            "UPDATE accounts SET password_hash = ?, display_name = ?, updated_at = datetime('now') WHERE external_user_id = ?",
            (hash_password(payload.password), payload.display_name or payload.user_id, payload.user_id),
        )
        store._conn.commit()

    token = create_token(
        user_id=payload.user_id,
        secret=settings.jwt_secret,
        expiry_hours=settings.jwt_expiry_hours,
    )
    return TokenResponse(
        token=token,
        user_id=payload.user_id,
        expires_in_hours=settings.jwt_expiry_hours,
    )
