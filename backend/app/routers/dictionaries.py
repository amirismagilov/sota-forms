from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import account_id
from ..dict_resolver import resolve_api_dictionary
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
async def list_dictionaries(db: AsyncSession = Depends(get_db)):
    aid = await account_id(db)
    rows = (await db.execute(select(Dictionary).where(Dictionary.account_id == aid))).scalars().all()
    return [_out(d) for d in rows]


@router.post("", response_model=DictionaryOut)
async def create_dictionary(body: DictionaryIn, db: AsyncSession = Depends(get_db)):
    aid = await account_id(db)
    d = Dictionary(account_id=aid, **body.model_dump())
    db.add(d)
    await db.commit()
    await db.refresh(d)
    return _out(d)


@router.put("/{dict_id}", response_model=DictionaryOut)
async def update_dictionary(dict_id: str, body: DictionaryIn, db: AsyncSession = Depends(get_db)):
    d = await db.get(Dictionary, dict_id)
    if not d:
        raise HTTPException(404, "dictionary not found")
    for k, v in body.model_dump().items():
        setattr(d, k, v)
    await db.commit()
    await db.refresh(d)
    return _out(d)


@router.delete("/{dict_id}")
async def delete_dictionary(dict_id: str, db: AsyncSession = Depends(get_db)):
    d = await db.get(Dictionary, dict_id)
    if d:
        await db.delete(d)
        await db.commit()
    return {"ok": True}


@router.post("/{dict_id}/test")
async def test_dictionary(dict_id: str, body: dict | None = None, db: AsyncSession = Depends(get_db)):
    """Test-run an API dictionary's request in the constructor (ФР-37)."""
    d = await db.get(Dictionary, dict_id)
    if not d or d.type != "api" or not d.api_config:
        raise HTTPException(400, "not an API dictionary")
    values = (body or {}).get("values", {})
    try:
        items = await resolve_api_dictionary(db, d, values)
    except Exception as exc:  # honest failure surfacing
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "items": items[:50]}
