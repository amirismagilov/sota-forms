from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..bpmn_client import auth_headers
from ..config import get_settings
from ..crypto import sign_payload
from ..db import get_db
from ..deps import get_account_by_id
from ..dict_resolver import resolve_api_dictionary
from ..models import Dictionary, Form, FormVersion, Submission, WebhookDelivery
from ..operaton import resolve_placeholders
from ..suggest import resolve_suggest
from ..ratelimit import check_rate_limit
from ..schemas import PublicFormOut, SubmitIn

router = APIRouter(prefix="/api/public", tags=["public"])


def _referenced_dict_ids(fields: list[dict]) -> set[str]:
    ids = set()
    for f in fields:
        if f.get("dictionaryId"):
            ids.add(f["dictionaryId"])
    return ids


@router.get("/forms/{form_id}", response_model=PublicFormOut)
async def public_form(form_id: str, db: AsyncSession = Depends(get_db)):
    """Schema + design tokens + referenced dictionaries for the widget (ВТ-3).

    The form_id is a global embed key, so it resolves the owning account —
    no auth needed for public rendering.
    """
    f = (
        await db.execute(select(Form).where(Form.form_id == form_id))
    ).scalar_one_or_none()
    if not f:
        raise HTTPException(404, "form not found")
    # The widget serves the PUBLISHED snapshot, never the live draft, and only
    # while the form is published (archived/unpublished forms are hidden).
    if f.status == "archived":
        raise HTTPException(404, "form not available")
    if not f.published_version:
        raise HTTPException(404, "form not published")
    snap = (
        await db.execute(
            select(FormVersion).where(FormVersion.form_pk == f.id, FormVersion.version == f.published_version)
        )
    ).scalar_one_or_none()
    if not snap:
        raise HTTPException(404, "published version missing")

    acc = await get_account_by_id(db, f.account_id)

    dict_ids = _referenced_dict_ids(snap.fields)
    dicts = []
    if dict_ids:
        rows = (
            await db.execute(select(Dictionary).where(Dictionary.id.in_(dict_ids)))
        ).scalars().all()
        for d in rows:
            dicts.append(
                {
                    "id": d.id,
                    "code": d.code,
                    "name": d.name,
                    "type": d.type,
                    "dependencies": d.dependencies,
                    "attrs": d.attrs,
                    "items": d.items,
                    "api_config": d.api_config,
                }
            )

    return PublicFormOut(
        form_id=f.form_id,
        title=snap.title,
        grid_columns=snap.grid_columns,
        fields=snap.fields,
        submit=snap.submit,
        design_tokens=acc.design_tokens,
        dictionaries=dicts,
    )


@router.post("/forms/{form_id}/suggest")
async def form_suggest(form_id: str, body: dict | None = None, db: AsyncSession = Depends(get_db)):
    """Typeahead for a suggest field (called per keystroke by the widget).

    The field's connection/endpoint/mapping live in the published form snapshot —
    the widget only sends the typed query and current values, so secrets and the
    connection never leave the backend.
    """
    body = body or {}
    field_id = body.get("fieldId")
    query = (body.get("query") or "").strip()
    values = body.get("values", {})

    f = (await db.execute(select(Form).where(Form.form_id == form_id))).scalar_one_or_none()
    if not f or f.status == "archived" or not f.published_version:
        raise HTTPException(404, "form not available")
    snap = (
        await db.execute(
            select(FormVersion).where(FormVersion.form_pk == f.id, FormVersion.version == f.published_version)
        )
    ).scalar_one_or_none()
    if not snap:
        raise HTTPException(404, "published version missing")

    field = next(
        (x for x in (snap.fields or []) if x.get("id") == field_id and x.get("type") == "suggest"),
        None,
    )
    cfg = (field or {}).get("suggest") or {}
    if not field or not cfg.get("connectionId"):
        raise HTTPException(404, "suggest field not configured")
    if len(query) < int(cfg.get("minChars") or 1):
        return {"items": []}
    try:
        _, items = await resolve_suggest(db, cfg, query, values)
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f"suggest source error: {exc}") from exc


@router.get("/forms/by-operaton/{operaton_form_id}")
async def form_by_operaton_id(operaton_form_id: str, db: AsyncSession = Depends(get_db)):
    """Which of our forms replaces this Operaton form? Used by the sota-bpmn host.

    Only PUBLISHED forms resolve — a draft must never take over a live task.
    Keeping the lookup here means the id-sanitisation rules live in exactly one
    place instead of being reimplemented on the sota-bpmn side.
    """
    f = (
        await db.execute(
            select(Form).where(
                Form.source == "operaton",
                Form.source_meta["operaton_form_id"].astext == operaton_form_id,
            )
        )
    ).scalars().first()
    if not f or f.status == "archived" or not f.published_version:
        raise HTTPException(404, "no published form for this Operaton form id")
    return {
        "form_id": f.form_id,
        "title": f.title,
        "published_version": f.published_version,
        "process_key": (f.source_meta or {}).get("process_key"),
    }


@router.post("/dictionaries/{dict_id}/options")
async def dictionary_options(dict_id: str, body: dict | None = None, db: AsyncSession = Depends(get_db)):
    """Resolve options for an API dictionary given current form values (ФР-39..42).

    Secrets and mapping stay on the backend; the widget only sends field values.
    """
    d = await db.get(Dictionary, dict_id)
    if not d:
        raise HTTPException(404, "dictionary not found")
    if d.type != "api":
        return {"items": d.items}
    values = (body or {}).get("values", {})
    try:
        items = await resolve_api_dictionary(db, d, values)
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f"dictionary source error: {exc}") from exc


@router.post("/forms/{form_id}/submit")
async def submit_form(form_id: str, body: SubmitIn, db: AsyncSession = Depends(get_db)):
    if not await check_rate_limit(f"submit:{form_id}", limit=120):
        raise HTTPException(429, "rate limit exceeded")

    f = (
        await db.execute(select(Form).where(Form.form_id == form_id))
    ).scalar_one_or_none()
    if not f:
        raise HTTPException(404, "form not found")
    if not f.published_version or f.status == "archived":
        raise HTTPException(404, "form not available")
    acc = await get_account_by_id(db, f.account_id)

    sub = Submission(account_id=acc.id, form_id=form_id, data=body.data, webhook_status="pending")
    db.add(sub)
    await db.flush()

    cfg = f.submit or {}
    template = cfg.get("webhookUrl") or acc.webhook_default
    settings = get_settings()

    webhook_url = None
    if template:
        webhook_url, missing = resolve_placeholders(
            template,
            {
                **(body.context or {}),
                "bpmnBase": (settings.sota_bpmn_base or "").rstrip("/"),
                "formId": form_id,
                "submissionId": sub.id,
            },
        )
        if missing:
            # An Operaton form without a taskId cannot complete anything — that is
            # a wiring bug in the host page, so fail loudly instead of dropping
            # the submission into a webhook that can never be built.
            sub.webhook_status = "no_context"
            await db.commit()
            raise HTTPException(
                400,
                "Форма ожидает контекст выполнения, но он не передан: "
                + ", ".join(missing)
                + ". Для задач Оператона встраивайте виджет с атрибутом task-id.",
            )

    if not webhook_url:
        sub.webhook_status = "no_webhook"
        await db.commit()
        await db.refresh(sub)
        return _submit_response(sub, cfg)

    # `data` = the bare shape sota-bpmn's CompleteTaskRequest expects;
    # `envelope` = our usual signed payload with submission metadata.
    if cfg.get("payload") == "data":
        payload = {"data": body.data}
    else:
        payload = {
            "formId": form_id,
            "submissionId": sub.id,
            "data": body.data,
            "submittedAt": sub.created_at.isoformat(),
        }
    headers = {"X-Signature": sign_payload(payload), "Content-Type": "application/json"}
    if cfg.get("operatonComplete"):
        headers.update(auth_headers())

    delivery = WebhookDelivery(
        submission_id=sub.id,
        form_id=form_id,
        url=webhook_url,
        payload={"body": payload, "signature": headers["X-Signature"]},
    )
    db.add(delivery)

    if cfg.get("delivery") != "sync":
        await db.commit()
        await db.refresh(sub)
        return _submit_response(sub, cfg)

    # Synchronous mode (Operaton task completion): the person pressing «Отправить»
    # must learn right away that the task was already completed by someone else,
    # instead of being told «Спасибо» while the delivery quietly retries.
    delivery.attempts = 1
    try:
        async with httpx.AsyncClient(timeout=(settings.sota_bpmn_timeout or 10000) / 1000) as client:
            resp = await client.post(webhook_url, json=payload, headers=headers)
        delivery.last_status_code = resp.status_code
        ok = 200 <= resp.status_code < 300
        delivery.status = "delivered" if ok else "dead"
        sub.webhook_status = "delivered" if ok else "failed"
        if not ok:
            delivery.last_error = f"HTTP {resp.status_code}: {resp.text[:300]}"
    except Exception as exc:
        delivery.status = "dead"
        delivery.last_error = str(exc)[:300]
        sub.webhook_status = "failed"
        await db.commit()
        raise HTTPException(502, f"Не удалось передать данные в процесс: {exc}") from exc

    await db.commit()
    await db.refresh(sub)
    if delivery.status != "delivered":
        raise HTTPException(status_code=502, detail=_engine_error(delivery.last_status_code, delivery.last_error))
    return _submit_response(sub, cfg)


def _submit_response(sub: Submission, cfg: dict) -> dict:
    return {
        "ok": True,
        "submissionId": sub.id,
        "successMessage": cfg.get("successMessage", "Спасибо!"),
        "redirectUrl": cfg.get("redirectUrl"),
    }


def _engine_error(status_code: int | None, raw: str | None) -> str:
    """Turn sota-bpmn's status codes into something a form filler understands."""
    if status_code == 404:
        return "Задача не найдена в процессе — возможно, она уже закрыта"
    if status_code == 409:
        return "Задача уже завершена другим пользователем"
    if status_code in (401, 403):
        return "Нет доступа к процессу: проверьте общий секрет интеграции"
    return f"Процесс отклонил данные: {raw or status_code}"
