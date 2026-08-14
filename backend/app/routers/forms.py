from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import current_claims, require_account
from ..db import get_db
from ..flow import MAIN_STEP, build_context, get_step, normalize_flow, rule_matches, run_rules, step_field_ids
from ..models import Form, FormVersion, Submission
from ..schemas import FlowTestIn, FormIn, FormOut

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
        status=f.status,
        published_version=f.published_version,
        has_draft_changes=f.has_draft_changes,
        source=f.source or "local",
        source_meta=f.source_meta or {},
    )


async def _owned(db: AsyncSession, form_pk: str, aid: str) -> Form:
    f = await db.get(Form, form_pk)
    if not f or f.account_id != aid:
        raise HTTPException(404, "form not found")
    return f


async def _slug_taken(db: AsyncSession, form_id: str) -> bool:
    return (await db.execute(select(Form).where(Form.form_id == form_id))).scalar_one_or_none() is not None


@router.get("")
async def list_forms(
    db: AsyncSession = Depends(get_db),
    aid: str = Depends(require_account),
    q: str | None = None,
    status: str | None = None,
    source: str | None = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    sort: str = "updated_at",
):
    """Form registry: search, status/source filters, pagination, submission counts."""
    base = select(Form).where(Form.account_id == aid)
    if q:
        like = f"%{q.lower()}%"
        base = base.where(or_(func.lower(Form.title).like(like), func.lower(Form.form_id).like(like)))
    if status:
        base = base.where(Form.status == status)
    if source:
        if source not in ("local", "operaton"):
            raise HTTPException(400, "source must be 'local' or 'operaton'")
        base = base.where(Form.source == source)

    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()

    order = Form.title.asc() if sort == "title" else Form.updated_at.desc()
    rows = (await db.execute(base.order_by(order).limit(limit).offset(offset))).scalars().all()

    # Submission counts per slug for this account.
    counts = dict(
        (
            await db.execute(
                select(Submission.form_id, func.count())
                .where(Submission.account_id == aid)
                .group_by(Submission.form_id)
            )
        ).all()
    )
    items = []
    for f in rows:
        d = _out(f).model_dump()
        d["submission_count"] = counts.get(f.form_id, 0)
        d["updated_at"] = f.updated_at.isoformat() if f.updated_at else None
        # The list only needs the passport, not the full key_map/report.
        meta = f.source_meta or {}
        d["source_meta"] = {
            k: meta.get(k) for k in ("operaton_form_id", "process_key", "imported_at") if meta.get(k)
        }
        if (meta.get("report") or {}).get("warnings"):
            d["source_meta"]["warning_count"] = len(meta["report"]["warnings"])
        items.append(d)
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/{form_pk}", response_model=FormOut)
async def get_form(form_pk: str, db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)):
    return _out(await _owned(db, form_pk, aid))


@router.post("", response_model=FormOut)
async def create_form(body: FormIn, db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)):
    if await _slug_taken(db, body.form_id):
        raise HTTPException(409, f"form_id '{body.form_id}' already exists")
    f = Form(account_id=aid, status="draft", version=0, has_draft_changes=True, **body.model_dump())
    db.add(f)
    await db.commit()
    await db.refresh(f)
    return _out(f)


@router.put("/{form_pk}", response_model=FormOut)
async def update_form(
    form_pk: str,
    body: FormIn,
    db: AsyncSession = Depends(get_db),
    aid: str = Depends(require_account),
    allow_key_changes: bool = False,
):
    """Save the working DRAFT. Does not publish — the live widget is untouched."""
    f = await _owned(db, form_pk, aid)
    if body.form_id != f.form_id and await _slug_taken(db, body.form_id):
        raise HTTPException(409, f"form_id '{body.form_id}' already exists")

    # Fields imported from Operaton ARE process variables: their ids feed the
    # gateways downstream. Dropping or renaming one makes the engine fail at
    # runtime with PropertyNotFound, long after the edit — so refuse loudly here.
    if (f.source or "local") == "operaton" and not allow_key_changes:
        bound = set((f.source_meta or {}).get("key_map", {}).values())
        present = {x.get("id") for x in (body.fields or [])}
        missing = sorted(bound - present)
        if missing:
            raise HTTPException(
                409,
                "Эти поля связаны с переменными процесса Оператона и не могут быть "
                f"переименованы или удалены: {', '.join(missing)}",
            )
    f.form_id = body.form_id
    f.title = body.title
    f.grid_columns = body.grid_columns
    f.fields = body.fields
    f.submit = body.submit
    f.has_draft_changes = True
    await db.commit()
    await db.refresh(f)
    return _out(f)


@router.post("/{form_pk}/publish", response_model=FormOut)
async def publish_form(
    form_pk: str,
    body: dict | None = None,
    db: AsyncSession = Depends(get_db),
    aid: str = Depends(require_account),
    claims: dict = Depends(current_claims),
):
    """Snapshot the current draft as a new immutable version and make it live."""
    f = await _owned(db, form_pk, aid)
    new_version = (f.version or 0) + 1
    db.add(
        FormVersion(
            form_pk=f.id,
            version=new_version,
            title=f.title,
            grid_columns=f.grid_columns,
            fields=f.fields,
            submit=f.submit,
            note=(body or {}).get("note"),
            created_by=claims.get("sub"),
        )
    )
    f.version = new_version
    f.published_version = new_version
    f.status = "published"
    f.has_draft_changes = False
    await db.commit()
    await db.refresh(f)
    return _out(f)


@router.get("/{form_pk}/versions")
async def list_versions(form_pk: str, db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)):
    f = await _owned(db, form_pk, aid)
    rows = (
        await db.execute(
            select(FormVersion).where(FormVersion.form_pk == f.id).order_by(FormVersion.version.desc())
        )
    ).scalars().all()
    return [
        {
            "version": v.version,
            "title": v.title,
            "note": v.note,
            "field_count": len(v.fields or []),
            "is_published": v.version == f.published_version,
            "created_at": v.created_at.isoformat(),
        }
        for v in rows
    ]


@router.get("/{form_pk}/versions/{version}")
async def get_version(form_pk: str, version: int, db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)):
    f = await _owned(db, form_pk, aid)
    v = (
        await db.execute(
            select(FormVersion).where(FormVersion.form_pk == f.id, FormVersion.version == version)
        )
    ).scalar_one_or_none()
    if not v:
        raise HTTPException(404, "version not found")
    return {"version": v.version, "title": v.title, "grid_columns": v.grid_columns, "fields": v.fields, "submit": v.submit}


@router.post("/{form_pk}/rollback/{version}", response_model=FormOut)
async def rollback_form(form_pk: str, version: int, db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)):
    """Restore a previous version into the draft (append-only history)."""
    f = await _owned(db, form_pk, aid)
    v = (
        await db.execute(
            select(FormVersion).where(FormVersion.form_pk == f.id, FormVersion.version == version)
        )
    ).scalar_one_or_none()
    if not v:
        raise HTTPException(404, "version not found")
    f.title = v.title
    f.grid_columns = v.grid_columns
    f.fields = v.fields
    f.submit = v.submit
    f.has_draft_changes = True  # user reviews, then re-publishes
    await db.commit()
    await db.refresh(f)
    return _out(f)


@router.post("/{form_pk}/status", response_model=FormOut)
async def set_status(form_pk: str, body: dict, db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)):
    f = await _owned(db, form_pk, aid)
    new = body.get("status")
    if new not in ("draft", "published", "archived"):
        raise HTTPException(400, "invalid status")
    if new == "published" and not f.published_version:
        raise HTTPException(400, "publish the form before setting it live")
    f.status = new
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
        status="draft",
        version=0,
        has_draft_changes=True,
    )
    db.add(f)
    await db.commit()
    await db.refresh(f)
    return _out(f)


@router.get("/{form_pk}/flow")
async def get_flow(form_pk: str, db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)):
    """Нормализованный флоу черновика: то, что реально исполнится на submit.

    Конструктор показывает именно его, а не сырой `submit` — иначе автор старой
    формы видел бы пустые настройки там, где на деле работает legacy-вебхук.
    """
    f = await _owned(db, form_pk, aid)
    flow = normalize_flow(f.submit or {})
    for s in flow["steps"]:
        s["fieldIds"] = step_field_ids(f.fields or [], s["id"])
    return flow


@router.post("/{form_pk}/flow/test")
async def test_flow(
    form_pk: str,
    body: FlowTestIn,
    db: AsyncSession = Depends(get_db),
    aid: str = Depends(require_account),
):
    """Прогнать правила шага по образцу ответа: какое сработает и что покажется.

    Тот же движок, что и в рантайме (`flow.run_rules`), — «зелёный» тест здесь
    означает то же поведение на бою, а не поведение отдельной тестовой копии.
    """
    f = await _owned(db, form_pk, aid)
    flow = normalize_flow(f.submit or {})
    step = get_step(flow, body.step or MAIN_STEP)
    if step is None:
        raise HTTPException(404, f"шаг '{body.step}' не найден")

    ctx = build_context(
        data=body.data,
        status=body.status,
        response=body.response if body.response is not None else {},
        error=body.error,
        submission_id="sub_test",
        extra={"formId": f.form_id, "step": step["id"]},
    )
    outcome, matched = run_rules(step, ctx)
    if outcome.get("kind") == "fields":
        target = get_step(flow, outcome.get("stepId"))
        outcome["stepTitle"] = (target or {}).get("title") or ""
        outcome["fieldIds"] = step_field_ids(f.fields or [], outcome.get("stepId") or "")
        outcome["stepExists"] = target is not None
    return {
        "matchedRuleId": (matched or {}).get("id"),
        "matchedRuleName": (matched or {}).get("name"),
        # Видно не только победителя, но и почему проиграли остальные, — без
        # этого отладка правила превращается в гадание.
        "trace": [
            {"id": r["id"], "name": r.get("name") or "", "matched": rule_matches(r, ctx)}
            for r in step.get("rules") or []
        ],
        "outcome": outcome,
    }


@router.get("/{form_pk}/export")
async def export_form(form_pk: str, db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)):
    f = await _owned(db, form_pk, aid)
    return {"form_id": f.form_id, "title": f.title, "grid_columns": f.grid_columns, "fields": f.fields, "submit": f.submit}
