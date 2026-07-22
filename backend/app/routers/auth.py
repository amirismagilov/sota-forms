from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import create_token, current_claims, hash_password, verify_password
from ..db import get_db
from ..deps import DEMO_TOKENS
from ..models import Account, User

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterIn(BaseModel):
    email: str
    password: str
    account_name: str | None = None


class LoginIn(BaseModel):
    email: str
    password: str


def _token_response(user: User) -> dict:
    return {
        "token": create_token(user_id=user.id, account_id=user.account_id, role=user.role),
        "user": {"id": user.id, "email": user.email, "role": user.role, "account_id": user.account_id},
    }


@router.post("/register")
async def register(body: RegisterIn, db: AsyncSession = Depends(get_db)):
    if len(body.password) < 6:
        raise HTTPException(400, "password must be at least 6 characters")
    existing = (await db.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "email already registered")
    account = Account(name=body.account_name or body.email.split("@")[0], design_tokens=DEMO_TOKENS)
    db.add(account)
    await db.flush()
    user = User(email=body.email, password_hash=hash_password(body.password), account_id=account.id, role="owner")
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return _token_response(user)


@router.post("/login")
async def login(body: LoginIn, db: AsyncSession = Depends(get_db)):
    user = (await db.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "invalid credentials")
    return _token_response(user)


@router.get("/me")
async def me(claims: dict = Depends(current_claims), db: AsyncSession = Depends(get_db)):
    user = await db.get(User, claims["sub"])
    if not user:
        raise HTTPException(404, "user not found")
    return {"id": user.id, "email": user.email, "role": user.role, "account_id": user.account_id}
