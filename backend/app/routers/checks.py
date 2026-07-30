from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_account
from ..checks import run_check
from ..db import get_db

router = APIRouter(prefix="/api/checks", tags=["checks"])


@router.post("/probe")
async def probe_check(
    body: dict | None = None, db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)
):
    """Run a check against an inline config (unsaved field).

    Powers the «Тест» button in the field editor, so the request body, endpoint
    and response path can be tried before the form is ever published — otherwise
    a wrong path is only discovered by a live user pressing «Проверить».
    """
    body = body or {}
    cfg = body.get("check") or {}
    if not cfg.get("connectionId"):
        return {"ok": False, "error": "Выберите подключение"}
    try:
        res = await run_check(db, cfg, body.get("values", {}))
    except Exception as exc:  # honest failure surfacing, same as suggest probe
        return {"ok": False, "error": getattr(exc, "detail", None) or str(exc)}
    return res
