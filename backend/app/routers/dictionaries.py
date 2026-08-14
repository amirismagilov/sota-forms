from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_account
from ..db import get_db
from ..dict_resolver import probe_api_dictionary
from ..models import Dictionary
from ..schemas import DictionaryIn, DictionaryOut

router = APIRouter(prefix="/api/dictionaries", tags=["dictionaries"])


def _out(d: Dictionary) -> DictionaryOut:
    return DictionaryOut(
        id=d.id,
        code=d.code,
        name=d.name,
        type=d.type,
        dependencies=d.dependencies,
        attrs=d.attrs,
        items=d.items,
        api_config=d.api_config,
    )


@router.get("", response_model=list[DictionaryOut])
async def list_dictionaries(db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)):
    rows = (await db.execute(select(Dictionary).where(Dictionary.account_id == aid))).scalars().all()
    return [_out(d) for d in rows]


@router.post("", response_model=DictionaryOut)
async def create_dictionary(body: DictionaryIn, db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)):
    d = Dictionary(account_id=aid, **body.model_dump())
    db.add(d)
    await db.commit()
    await db.refresh(d)
    return _out(d)


@router.put("/{dict_id}", response_model=DictionaryOut)
async def update_dictionary(dict_id: str, body: DictionaryIn, db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)):
    d = await db.get(Dictionary, dict_id)
    if not d or d.account_id != aid:
        raise HTTPException(404, "dictionary not found")
    for k, v in body.model_dump().items():
        setattr(d, k, v)
    await db.commit()
    await db.refresh(d)
    return _out(d)


@router.delete("/{dict_id}")
async def delete_dictionary(dict_id: str, db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)):
    d = await db.get(Dictionary, dict_id)
    if d and d.account_id == aid:
        await db.delete(d)
        await db.commit()
    return {"ok": True}


@router.post("/{dict_id}/test")
async def test_dictionary(dict_id: str, body: dict | None = None, db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)):
    """Test-run an API dictionary's request in the constructor (ФР-37)."""
    d = await db.get(Dictionary, dict_id)
    if not d or d.account_id != aid:
        raise HTTPException(404, "dictionary not found")
    if d.type != "api" or not d.api_config:
        raise HTTPException(400, "not an API dictionary")
    values = (body or {}).get("values", {})
    try:
        raw, items = await probe_api_dictionary(db, d, values)
    except Exception as exc:  # honest failure surfacing
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "items": items[:50], "raw": _trim_raw(raw)}


@router.post("/probe")
async def probe_dictionary(body: dict | None = None, db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)):
    """Test-run an API config that isn't saved yet, so the constructor can show
    the response structure before the user commits the dictionary.

    Builds a throwaway (unpersisted) Dictionary from the posted config and runs
    the same probe as the saved-dictionary test.
    """
    body = body or {}
    cfg = body.get("api_config") or {}
    if not cfg.get("connectionId"):
        return {"ok": False, "error": "Выберите подключение"}
    transient = Dictionary(
        account_id=aid, code="__probe__", name="probe", type="api",
        api_config=cfg, dependencies=body.get("dependencies") or [], attrs=[], items=[],
    )
    try:
        raw, items = await probe_api_dictionary(db, transient, body.get("values", {}))
    except Exception as exc:  # honest failure surfacing
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "items": items[:50], "raw": _trim_raw(raw)}


def _trim_raw(raw: object, max_items: int = 5) -> object:
    """Shrink the raw response for the UI preview: keep structure, cap list sizes."""
    if isinstance(raw, list):
        return [_trim_raw(x, max_items) for x in raw[:max_items]]
    if isinstance(raw, dict):
        return {k: _trim_raw(v, max_items) for k, v in raw.items()}
    return raw
