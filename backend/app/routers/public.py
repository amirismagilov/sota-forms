from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..crypto import sign_payload
from ..db import get_db
from ..deps import get_account_by_id
from ..dict_resolver import resolve_api_dictionary
from ..models import Dictionary, Form, Submission, WebhookDelivery
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
    acc = await get_account_by_id(db, f.account_id)

    dict_ids = _referenced_dict_ids(f.fields)
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
        title=f.title,
        grid_columns=f.grid_columns,
        fields=f.fields,
        submit=f.submit,
        design_tokens=acc.design_tokens,
        dictionaries=dicts,
    )


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
    acc = await get_account_by_id(db, f.account_id)

    sub = Submission(account_id=acc.id, form_id=form_id, data=body.data, webhook_status="pending")
    db.add(sub)
    await db.flush()

    webhook_url = (f.submit or {}).get("webhookUrl") or acc.webhook_default
    if webhook_url:
        payload = {
            "formId": form_id,
            "submissionId": sub.id,
            "data": body.data,
            "submittedAt": sub.created_at.isoformat(),
        }
        db.add(
            WebhookDelivery(
                submission_id=sub.id,
                form_id=form_id,
                url=webhook_url,
                payload={"body": payload, "signature": sign_payload(payload)},
            )
        )
    else:
        sub.webhook_status = "no_webhook"

    await db.commit()
    await db.refresh(sub)
    return {
        "ok": True,
        "submissionId": sub.id,
        "successMessage": (f.submit or {}).get("successMessage", "Спасибо!"),
        "redirectUrl": (f.submit or {}).get("redirectUrl"),
    }
