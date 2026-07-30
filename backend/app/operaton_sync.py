"""Pull Operaton forms from the sota-bpmn catalogue into the registry.

Shared by the admin endpoint (`POST /api/operaton/sync`) and the background
auto-sync loop, so a form imported by hand and one imported automatically are
byte-for-byte the same thing.

Two rules make repeated runs safe, which is what lets this be automated at all:

1. A form already imported is **skipped**, never overwritten — a re-import would
   discard the edits made after the first one.
2. Each form is committed on its own, so one broken schema cannot undo the forms
   already imported in the same run.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import bpmn_client
from .models import Form, FormVersion
from .operaton import (
    ConversionResult,
    OperatonSchemaError,
    convert_operaton_form,
    operaton_submit_config,
)


async def imported_operaton_ids(db: AsyncSession, account_id: str) -> dict[str, Form]:
    """Operaton forms this account already holds, keyed by their Operaton id."""
    rows = (
        await db.execute(select(Form).where(Form.account_id == account_id, Form.source == "operaton"))
    ).scalars().all()
    return {
        (f.source_meta or {}).get("operaton_form_id"): f
        for f in rows
        if (f.source_meta or {}).get("operaton_form_id")
    }


async def unique_slug(db: AsyncSession, preferred: str) -> str:
    slug = preferred
    n = 1
    while (await db.execute(select(Form).where(Form.form_id == slug))).scalar_one_or_none():
        n += 1
        slug = f"{preferred}_{n}"
    return slug


def build_form(
    account_id: str,
    slug: str,
    title: str,
    res: ConversionResult,
    schema: dict,
    process_key: str | None,
    user_id: str | None,
) -> Form:
    return Form(
        account_id=account_id,
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


async def _publish(db: AsyncSession, f: Form, note: str, user_id: str | None) -> None:
    db.add(FormVersion(
        form_pk=f.id, version=1, title=f.title, grid_columns=f.grid_columns,
        fields=f.fields, submit=f.submit, note=note, created_by=user_id,
    ))
    f.version = 1
    f.published_version = 1
    f.status = "published"
    f.has_draft_changes = False
    await db.commit()
    await db.refresh(f)


async def sync_account(
    db: AsyncSession,
    account_id: str,
    *,
    process_key: str | None = None,
    publish: bool = False,
    user_id: str | None = None,
    note: str = "Массовый импорт из Оператона",
) -> dict[str, Any]:
    """Import every catalogue form this account does not have yet."""
    summaries = await bpmn_client.list_forms(process_key)
    if not summaries:
        return {
            "items": [], "imported": 0, "skipped": 0, "failed": 0,
            "message": "В каталоге sota-bpmn нет форм для этого процесса",
        }

    existing = await imported_operaton_ids(db, account_id)
    items: list[dict[str, Any]] = []

    for s in summaries:
        operaton_id = s.get("id")
        if not operaton_id:
            continue

        already = existing.get(operaton_id)
        if already:
            items.append({
                "operaton_form_id": operaton_id, "status": "skipped",
                "form_id": already.form_id, "id": already.id, "detail": "уже импортирована",
            })
            continue

        try:
            dto = await bpmn_client.get_form(operaton_id)
            res = convert_operaton_form(dto["schema"])
        except OperatonSchemaError as exc:
            items.append({"operaton_form_id": operaton_id, "status": "failed", "detail": str(exc)})
            continue
        except HTTPException as exc:
            items.append({"operaton_form_id": operaton_id, "status": "failed", "detail": str(exc.detail)})
            continue
        except Exception as exc:  # a dead catalogue must not abort the whole run
            items.append({"operaton_form_id": operaton_id, "status": "failed", "detail": str(exc)[:200]})
            continue

        # The catalogue enriches names from the BPMN userTask labels — a far better
        # title than anything derivable from the technical form id.
        title = s.get("name") or res.title
        proc = dto.get("processKey") or s.get("processKey") or process_key
        slug = await unique_slug(db, res.form_id)

        f = build_form(account_id, slug, title, res, dto["schema"], proc, user_id)
        db.add(f)
        await db.commit()
        await db.refresh(f)

        if publish:
            await _publish(db, f, note, user_id)

        existing[operaton_id] = f
        items.append({
            "operaton_form_id": operaton_id, "status": "imported",
            "id": f.id, "form_id": f.form_id, "title": f.title,
            "published": bool(f.published_version),
            "warnings": len(res.warnings), "unsupported": len(res.unsupported),
        })

    counts = {k: sum(1 for i in items if i["status"] == k) for k in ("imported", "skipped", "failed")}
    return {"items": items, **counts}
