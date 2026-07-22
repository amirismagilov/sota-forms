from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import account_id
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


@router.get("", response_model=list[FormOut])
async def list_forms(db: AsyncSession = Depends(get_db)):
    aid = await account_id(db)
    rows = (await db.execute(select(Form).where(Form.account_id == aid))).scalars().all()
    return [_out(f) for f in rows]


@router.get("/{form_pk}", response_model=FormOut)
async def get_form(form_pk: str, db: AsyncSession = Depends(get_db)):
    f = await db.get(Form, form_pk)
    if not f:
        raise HTTPException(404, "form not found")
    return _out(f)


@router.post("", response_model=FormOut)
async def create_form(body: FormIn, db: AsyncSession = Depends(get_db)):
    aid = await account_id(db)
    exists = (
        await db.execute(
            select(Form).where(Form.account_id == aid, Form.form_id == body.form_id)
        )
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(409, f"form_id '{body.form_id}' already exists")
    f = Form(account_id=aid, **body.model_dump())
    db.add(f)
    await db.commit()
    await db.refresh(f)
    return _out(f)


@router.put("/{form_pk}", response_model=FormOut)
async def update_form(form_pk: str, body: FormIn, db: AsyncSession = Depends(get_db)):
    f = await db.get(Form, form_pk)
    if not f:
        raise HTTPException(404, "form not found")
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
async def delete_form(form_pk: str, db: AsyncSession = Depends(get_db)):
    f = await db.get(Form, form_pk)
    if f:
        await db.delete(f)
        await db.commit()
    return {"ok": True}


@router.get("/{form_pk}/export")
async def export_form(form_pk: str, db: AsyncSession = Depends(get_db)):
    f = await db.get(Form, form_pk)
    if not f:
        raise HTTPException(404, "form not found")
    return {
        "form_id": f.form_id,
        "title": f.title,
        "grid_columns": f.grid_columns,
        "fields": f.fields,
        "submit": f.submit,
    }
