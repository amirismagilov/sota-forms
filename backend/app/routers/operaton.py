"""Import Operaton forms — from the sota-bpmn catalogue or from an uploaded file.

Conversion always runs BEFORE anything is written, and the write happens in a
single transaction: a half-imported form never exists.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from .. import bpmn_client
from ..auth import current_claims, require_account
from ..db import get_db
from ..operaton import ConversionResult, OperatonSchemaError, convert_operaton_form, operaton_submit_config
from ..operaton_sync import build_form, sync_account
from ..schemas import FormOut, OperatonImportIn, OperatonSyncIn
from .forms import _out, _slug_taken

router = APIRouter(prefix="/api/operaton", tags=["operaton"])


@router.get("/status")
async def status(_: str = Depends(require_account)):
    """Is the sota-bpmn integration configured and reachable?"""
    return await bpmn_client.ping()


@router.get("/processes")
async def processes(_: str = Depends(require_account)):
    return {"items": await bpmn_client.list_processes()}


@router.get("/forms")
async def forms(process: str | None = None, _: str = Depends(require_account)):
    return {"items": await bpmn_client.list_forms(process)}


async def _load_schema(body: OperatonImportIn) -> tuple[dict, str | None]:
    """Resolve the source schema: uploaded JSON or pulled from sota-bpmn."""
    if body.schema_ is not None:
        return body.schema_, body.process_key
    if not body.operaton_form_id:
        raise HTTPException(400, "Укажите schema или operaton_form_id")
    dto = await bpmn_client.get_form(body.operaton_form_id)
    return dto["schema"], dto.get("processKey") or body.process_key


async def _unique_slug(db: AsyncSession, preferred: str) -> str:
    slug = preferred
    n = 1
    while await _slug_taken(db, slug):
        n += 1
        slug = f"{preferred}_{n}"
    return slug


def _convert(schema: dict) -> ConversionResult:
    try:
        return convert_operaton_form(schema)
    except OperatonSchemaError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/preview")
async def preview(
    body: OperatonImportIn,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(require_account),
):
    """Dry-run: convert and report, persist nothing."""
    schema, process_key = await _load_schema(body)
    res = _convert(schema)
    return {
        "form_id": await _unique_slug(db, body.form_id or res.form_id),
        "title": body.title or res.title,
        "grid_columns": res.grid_columns,
        "fields": res.fields,
        "submit": operaton_submit_config(process_key),
        "operaton_form_id": res.operaton_form_id,
        "process_key": process_key,
        "key_map": res.key_map,
        "report": res.report(),
    }


@router.post("/import", response_model=FormOut)
async def import_operaton_form(
    body: OperatonImportIn,
    db: AsyncSession = Depends(get_db),
    aid: str = Depends(require_account),
    claims: dict = Depends(current_claims),
):
    schema, process_key = await _load_schema(body)
    res = _convert(schema)

    requested = body.form_id or res.form_id
    if body.form_id and await _slug_taken(db, body.form_id):
        raise HTTPException(409, f"form_id '{body.form_id}' already exists")
    slug = await _unique_slug(db, requested)

    f = build_form(aid, slug, body.title or res.title, res, schema, process_key, claims.get("sub"))
    db.add(f)
    await db.commit()
    await db.refresh(f)
    return _out(f)


@router.post("/sync")
async def sync_forms(
    body: OperatonSyncIn,
    db: AsyncSession = Depends(get_db),
    aid: str = Depends(require_account),
    claims: dict = Depends(current_claims),
):
    """Pull every form of a process (or of all processes) in one go.

    Same code path as the background auto-sync, so a form imported by hand and one
    imported automatically are identical.
    """
    return await sync_account(
        db, aid, process_key=body.process_key, publish=body.publish, user_id=claims.get("sub")
    )
