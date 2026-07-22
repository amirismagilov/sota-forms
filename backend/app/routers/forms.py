from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_account
from ..db import get_db
from ..models import Form
from ..schemas import FormIn, FormOut

router = APIRouter(prefix="/api/forms", tags=["forms"])


def _out(f: Form) -> FormOut:
    return FormOut(
        id=f.id,
        form_id=f.form_id,
        title=f.title,
        version=f.version,
        grid_columns=f.grid_columns,
        fields=f.fields,
        submit=f.submit,
    )


async def _owned(db: AsyncSession, form_pk: str, aid: str) -> Form:
    f = await db.get(Form, form_pk)
    if not f or f.account_id != aid:
        raise HTTPException(404, "form not found")
    return f


async def _slug_taken(db: AsyncSession, form_id: str) -> bool:
    # form_id is a global embed key, so uniqueness is checked globally.
    return (
        await db.execute(select(Form).where(Form.form_id == form_id))
    ).scalar_one_or_none() is not None


@router.get("", response_model=list[FormOut])
async def list_forms(db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)):
    rows = (await db.execute(select(Form).where(Form.account_id == aid))).scalars().all()
    return [_out(f) for f in rows]


@router.get("/{form_pk}", response_model=FormOut)
async def get_form(form_pk: str, db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)):
    return _out(await _owned(db, form_pk, aid))


@router.post("", response_model=FormOut)
async def create_form(body: FormIn, db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)):
    if await _slug_taken(db, body.form_id):
        raise HTTPException(409, f"form_id '{body.form_id}' already exists")
    f = Form(account_id=aid, **body.model_dump())
    db.add(f)
    await db.commit()
    await db.refresh(f)
    return _out(f)


@router.put("/{form_pk}", response_model=FormOut)
async def update_form(form_pk: str, body: FormIn, db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)):
    f = await _owned(db, form_pk, aid)
    if body.form_id != f.form_id and await _slug_taken(db, body.form_id):
        raise HTTPException(409, f"form_id '{body.form_id}' already exists")
    f.form_id = body.form_id
    f.title = body.title
    f.grid_columns = body.grid_columns
    f.fields = body.fields
    f.submit = body.submit
    f.version += 1
    await db.commit()
    await db.refresh(f)
    return _out(f)


@router.delete("/{form_pk}")
async def delete_form(form_pk: str, db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)):
    f = await db.get(Form, form_pk)
    if f and f.account_id == aid:
        await db.delete(f)
        await db.commit()
    return {"ok": True}


@router.post("/import", response_model=FormOut)
async def import_form(body: dict, db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)):
    """Create a form from an exported JSON schema (ФР Этап 4)."""
    base = body.get("form_id") or "imported_form"
    form_id = base
    n = 1
    while await _slug_taken(db, form_id):
        n += 1
        form_id = f"{base}_{n}"
    f = Form(
        account_id=aid,
        form_id=form_id,
        title=body.get("title") or "Импортированная форма",
        grid_columns=int(body.get("grid_columns") or 2),
        fields=body.get("fields") or [],
        submit=body.get("submit") or {},
    )
    db.add(f)
    await db.commit()
    await db.refresh(f)
    return _out(f)


@router.get("/{form_pk}/export")
async def export_form(form_pk: str, db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)):
    f = await _owned(db, form_pk, aid)
    return {
        "form_id": f.form_id,
        "title": f.title,
        "grid_columns": f.grid_columns,
        "fields": f.fields,
        "submit": f.submit,
    }
