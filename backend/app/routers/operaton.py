"""Import Operaton forms — from the sota-bpmn catalogue or from an uploaded file.

Conversion always runs BEFORE anything is written, and the write happens in a
single transaction: a half-imported form never exists.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import bpmn_client
from ..auth import current_claims, require_account
from ..db import get_db
from ..models import Form, FormVersion
from ..operaton import ConversionResult, OperatonSchemaError, convert_operaton_form, operaton_submit_config
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

    f = _build_form(aid, slug, body.title or res.title, res, schema, process_key, claims.get("sub"))
    db.add(f)
    await db.commit()
    await db.refresh(f)
    return _out(f)


async def _imported_operaton_ids(db: AsyncSession, aid: str) -> dict[str, Form]:
    """Which Operaton forms this account already holds, keyed by their Operaton id."""
    rows = (
        await db.execute(select(Form).where(Form.account_id == aid, Form.source == "operaton"))
    ).scalars().all()
    return {(f.source_meta or {}).get("operaton_form_id"): f for f in rows if (f.source_meta or {}).get("operaton_form_id")}


def _build_form(
    aid: str,
    slug: str,
    title: str,
    res: ConversionResult,
    schema: dict,
    process_key: str | None,
    user_id: str | None,
) -> Form:
    return Form(
        account_id=aid,
        form_id=slug,
        title=title,
        grid_columns=res.grid_columns,
        fields=res.fields,
        submit=operaton_submit_config(process_key),
        status="draft",
        version=0,
        has_draft_changes=True,
        source="operaton",
        source_meta={
            "format": "operaton_form_json",
            "operaton_form_id": res.operaton_form_id,
            "process_key": process_key,
            "schema_version": res.schema_version,
            "execution_platform": res.execution_platform,
            "imported_at": datetime.now(UTC).isoformat(),
            "imported_by": user_id,
            "key_map": res.key_map,
            "report": res.report(),
        },
        source_schema=schema,
    )


@router.post("/sync")
async def sync_forms(
    body: OperatonSyncIn,
    db: AsyncSession = Depends(get_db),
    aid: str = Depends(require_account),
    claims: dict = Depends(current_claims),
):
    """Pull every form of a process (or of all processes) in one go.

    Each form is committed on its own, so one broken schema in the middle cannot
    undo the forms already imported — the caller gets a per-form verdict instead
    of an all-or-nothing failure.

    Forms already imported are SKIPPED, never overwritten: a re-import would throw
    away the edits made after the first import. Refreshing an existing form is a
    separate, deliberate action.
    """
    summaries = await bpmn_client.list_forms(body.process_key)
    if not summaries:
        return {"items": [], "imported": 0, "skipped": 0, "failed": 0,
                "message": "В каталоге sota-bpmn нет форм для этого процесса"}

    existing = await _imported_operaton_ids(db, aid)
    items: list[dict] = []

    for s in summaries:
        operaton_id = s.get("id")
        if not operaton_id:
            continue
        already = existing.get(operaton_id)
        if already:
            items.append({
                "operaton_form_id": operaton_id,
                "status": "skipped",
                "form_id": already.form_id,
                "id": already.id,
                "detail": "уже импортирована",
            })
            continue

        try:
            dto = await bpmn_client.get_form(operaton_id)
            res = convert_operaton_form(dto["schema"])
        except OperatonSchemaError as exc:
            items.append({"operaton_form_id": operaton_id, "status": "failed", "detail": str(exc)})
            continue
        except HTTPException as exc:
            items.append({"operaton_form_id": operaton_id, "status": "failed", "detail": exc.detail})
            continue

        # The catalogue enriches names from the BPMN userTask labels, which is a far
        # better title than anything derivable from the technical form id.
        title = s.get("name") or res.title
        process_key = dto.get("processKey") or s.get("processKey") or body.process_key
        slug = await _unique_slug(db, res.form_id)

        f = _build_form(aid, slug, title, res, dto["schema"], process_key, claims.get("sub"))
        db.add(f)
        await db.commit()
        await db.refresh(f)

        if body.publish:
            db.add(FormVersion(
                form_pk=f.id, version=1, title=f.title, grid_columns=f.grid_columns,
                fields=f.fields, submit=f.submit, note="Массовый импорт из Оператона",
                created_by=claims.get("sub"),
            ))
            f.version = 1
            f.published_version = 1
            f.status = "published"
            f.has_draft_changes = False
            await db.commit()
            await db.refresh(f)

        existing[operaton_id] = f
        items.append({
            "operaton_form_id": operaton_id,
            "status": "imported",
            "id": f.id,
            "form_id": f.form_id,
            "title": f.title,
            "published": bool(f.published_version),
            "warnings": len(res.warnings),
            "unsupported": len(res.unsupported),
        })

    counts = {k: sum(1 for i in items if i["status"] == k) for k in ("imported", "skipped", "failed")}
    return {"items": items, **counts}
