from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_account
from ..schemas import ThemeIn

router = APIRouter(prefix="/api/account", tags=["account"])


@router.get("/theme")
async def get_theme(db: AsyncSession = Depends(get_db)):
    acc = await get_account(db)
    return {"design_tokens": acc.design_tokens, "webhook_default": acc.webhook_default}


@router.put("/theme")
async def update_theme(body: ThemeIn, db: AsyncSession = Depends(get_db)):
    acc = await get_account(db)
    acc.design_tokens = body.design_tokens
    if body.webhook_default is not None:
        acc.webhook_default = body.webhook_default
    await db.commit()
    await db.refresh(acc)
    return {"design_tokens": acc.design_tokens, "webhook_default": acc.webhook_default}
