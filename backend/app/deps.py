from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .models import Account

DEMO_TOKENS = {
    "token": {
        "colorPrimary": "#1677ff",
        "colorSuccess": "#52c41a",
        "colorWarning": "#faad14",
        "colorError": "#ff4d4f",
        "colorBorder": "#d9d9d9",
        "colorBgContainer": "#ffffff",
        "fontSize": 14,
        "borderRadius": 6,
        "controlHeight": 36,
    }
}


async def get_account(db: AsyncSession) -> Account:
    """Single-tenant demo: ensure and return the default account."""
    settings = get_settings()
    acc = await db.get(Account, settings.default_account_id)
    if acc is None:
        acc = Account(
            id=settings.default_account_id,
            name="Demo Account",
            design_tokens=DEMO_TOKENS,
            webhook_default=None,
        )
        db.add(acc)
        await db.commit()
        await db.refresh(acc)
    return acc


async def account_id(db: AsyncSession) -> str:
    return (await get_account(db)).id


async def get_account_by_id(db: AsyncSession, acc_id: str) -> Account:
    acc = await db.get(Account, acc_id)
    if acc is None:
        from fastapi import HTTPException

        raise HTTPException(404, "account not found")
    return acc
