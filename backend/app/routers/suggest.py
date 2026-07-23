from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_account
from ..db import get_db
from ..suggest import resolve_suggest

router = APIRouter(prefix="/api/suggest", tags=["suggest"])


@router.post("/probe")
async def probe_suggest(
    body: dict | None = None, db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)
):
    """Run a suggest query against an inline config (unsaved field).

    Powers the constructor's live preview and the field editor's «Тест» button,
    so a suggest field can be tried before the form is saved/published.
    """
    body = body or {}
    cfg = body.get("suggest") or {}
    query = (body.get("query") or "").strip()
    if not cfg.get("connectionId"):
        return {"ok": False, "error": "Выберите подключение"}
    if not query:
        return {"ok": True, "items": []}
    try:
        raw, items = await resolve_suggest(db, cfg, query, body.get("values", {}))
    except Exception as exc:  # honest failure surfacing
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "items": items[:20], "raw": _trim(raw)}


def _trim(raw: object, cap: int = 5) -> object:
    if isinstance(raw, list):
        return [_trim(x, cap) for x in raw[:cap]]
    if isinstance(raw, dict):
        return {k: _trim(v, cap) for k, v in raw.items()}
    return raw
