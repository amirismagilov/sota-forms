"""Execute-worker (воркер для экзекьют).

Polls the WebhookDelivery outbox and delivers submissions to client webhooks
with HMAC signature, retry, and exponential backoff (ВХ-1..4). Runs as its own
process; the submissions/delivery board reads the same table for live status.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select

from ..db import SessionLocal, init_db
from ..models import Submission, WebhookDelivery

POLL_INTERVAL = 2.0
BATCH = 20
BACKOFF_BASE = 5  # seconds: 5, 10, 20, 40, ...


def _now() -> datetime:
    return datetime.now(UTC)


async def _deliver_one(client: httpx.AsyncClient, d: WebhookDelivery, session) -> None:
    d.attempts += 1
    body = (d.payload or {}).get("body", d.payload)
    signature = (d.payload or {}).get("signature", "")
    try:
        resp = await client.post(
            d.url,
            json=body,
            headers={"X-Signature": signature, "Content-Type": "application/json"},
            timeout=10.0,
        )
        d.last_status_code = resp.status_code
        if 200 <= resp.status_code < 300:
            d.status = "delivered"
            d.last_error = None
            await _mark_submission(session, d.submission_id, "delivered")
            return
        d.last_error = f"HTTP {resp.status_code}: {resp.text[:300]}"
    except Exception as exc:  # network/timeout
        d.last_status_code = None
        d.last_error = str(exc)[:300]

    # Failure path: schedule retry or give up.
    if d.attempts >= d.max_attempts:
        d.status = "dead"
        await _mark_submission(session, d.submission_id, "failed")
    else:
        d.status = "pending"
        delay = BACKOFF_BASE * (2 ** (d.attempts - 1))
        d.next_attempt_at = _now() + timedelta(seconds=delay)
        await _mark_submission(session, d.submission_id, "retrying")


async def _mark_submission(session, submission_id: str, status: str) -> None:
    sub = await session.get(Submission, submission_id)
    if sub:
        sub.webhook_status = status


async def process_batch() -> int:
    async with SessionLocal() as session:
        rows = (
            await session.execute(
                select(WebhookDelivery)
                .where(WebhookDelivery.status == "pending", WebhookDelivery.next_attempt_at <= _now())
                .order_by(WebhookDelivery.next_attempt_at)
                .limit(BATCH)
                .with_for_update(skip_locked=True)
            )
        ).scalars().all()
        if not rows:
            return 0
        async with httpx.AsyncClient() as client:
            for d in rows:
                await _deliver_one(client, d, session)
        await session.commit()
        return len(rows)


async def run() -> None:
    for attempt in range(30):
        try:
            await init_db()
            break
        except Exception:
            if attempt == 29:
                raise
            await asyncio.sleep(1)
    print("[worker] execute-worker started, polling webhook outbox", flush=True)
    # The Operaton catalogue poller shares this process: it is a second timer, not
    # a second service, so nothing has to be added to docker-compose. It returns
    # immediately when auto-sync is off.
    from .operaton_poller import run as run_operaton_sync

    await asyncio.gather(_deliver_loop(), run_operaton_sync())


async def _deliver_loop() -> None:
    while True:
        try:
            n = await process_batch()
            if n:
                print(f"[worker] processed {n} deliveries", flush=True)
        except Exception as exc:  # never die silently
            print(f"[worker] error: {exc}", flush=True)
        await asyncio.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    asyncio.run(run())
