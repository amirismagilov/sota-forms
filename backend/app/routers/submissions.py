from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_account
from ..db import get_db
from ..models import Submission, WebhookDelivery

router = APIRouter(prefix="/api/submissions", tags=["submissions"])


@router.get("")
async def list_submissions(form_id: str | None = None, db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)):
    q = select(Submission).where(Submission.account_id == aid).order_by(Submission.created_at.desc())
    if form_id:
        q = q.where(Submission.form_id == form_id)
    rows = (await db.execute(q.limit(500))).scalars().all()
    return [
        {
            "id": s.id,
            "form_id": s.form_id,
            "data": s.data,
            "webhook_status": s.webhook_status,
            "created_at": s.created_at.isoformat(),
        }
        for s in rows
    ]


@router.get("/deliveries/board")
async def deliveries_board(db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)):
    """The execute-worker board: webhook delivery outbox with live status."""
    rows = (
        await db.execute(
            select(WebhookDelivery)
            .join(Submission, Submission.id == WebhookDelivery.submission_id)
            .where(Submission.account_id == aid)
            .order_by(WebhookDelivery.created_at.desc())
            .limit(500)
        )
    ).scalars().all()
    return [
        {
            "id": d.id,
            "submission_id": d.submission_id,
            "form_id": d.form_id,
            "url": d.url,
            "status": d.status,
            "attempts": d.attempts,
            "max_attempts": d.max_attempts,
            "last_status_code": d.last_status_code,
            "last_error": d.last_error,
            "next_attempt_at": d.next_attempt_at.isoformat() if d.next_attempt_at else None,
            "created_at": d.created_at.isoformat(),
            "updated_at": d.updated_at.isoformat() if d.updated_at else None,
        }
        for d in rows
    ]


@router.post("/deliveries/{delivery_id}/retry")
async def retry_delivery(delivery_id: str, db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)):
    d = await db.get(WebhookDelivery, delivery_id)
    if d:
        sub = await db.get(Submission, d.submission_id)
        if not sub or sub.account_id != aid:
            raise HTTPException(404, "delivery not found")
    if not d:
        raise HTTPException(404, "delivery not found")
    d.status = "pending"
    d.next_attempt_at = datetime.now(UTC)
    if d.attempts >= d.max_attempts:
        d.max_attempts = d.attempts + 3
    await db.commit()
    return {"ok": True}


@router.get("/{sub_id}")
async def get_submission(sub_id: str, db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)):
    """Return a single submission as JSON by its ID (account-scoped)."""
    s = await db.get(Submission, sub_id)
    if not s or s.account_id != aid:
        raise HTTPException(404, "submission not found")
    return {
        "id": s.id,
        "form_id": s.form_id,
        "data": s.data,
        "webhook_status": s.webhook_status,
        "created_at": s.created_at.isoformat(),
    }
