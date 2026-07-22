from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import account_id
from ..models import Dictionary
from ..proxy_client import run_proxy_request
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
async def test_dictionary(dict_id: str, params: dict | None = None, db: AsyncSession = Depends(get_db)):
    """Test-run an API dictionary's request in the constructor (ФР-37)."""
    d = await db.get(Dictionary, dict_id)
    if not d or d.type != "api" or not d.api_config:
        raise HTTPException(400, "not an API dictionary")
    cfg = d.api_config
    try:
        raw = await run_proxy_request(
            db,
            connection_id=cfg.get("connectionId"),
            endpoint=cfg.get("endpoint", ""),
            method=cfg.get("method", "GET"),
            params=params or {},
        )
    except Exception as exc:  # honest failure surfacing
        return {"ok": False, "error": str(exc)}
    mapping = cfg.get("mapping", {})
    items = _apply_mapping(raw, mapping)
    return {"ok": True, "raw": raw, "items": items[:50]}


def _apply_mapping(raw: object, mapping: dict) -> list[dict]:
    path = mapping.get("path", "")
    node = raw
    for part in [p for p in path.split(".") if p]:
        if isinstance(node, dict):
            node = node.get(part)
    if not isinstance(node, list):
        return []
    code_f = mapping.get("codeField", "code")
    val_f = mapping.get("valueField", "value")
    out = []
    for it in node:
        if isinstance(it, dict):
            out.append({"code": str(it.get(code_f, "")), "label": str(it.get(val_f, "")), "attrs": it})
    return out
