from __future__ import annotations

import time

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_account
from ..crypto import encrypt_auth_config, redact_auth_config
from ..db import get_db
from ..models import Connection
from ..proxy_client import _apply_auth
from ..schemas import ConnectionIn, ConnectionOut, ConnectionTestIn, ConnectionTestResult

router = APIRouter(prefix="/api/connections", tags=["connections"])


def _out(c: Connection) -> ConnectionOut:
    return ConnectionOut(
        id=c.id,
        name=c.name,
        base_url=c.base_url,
        auth_type=c.auth_type,
        auth_config=redact_auth_config(c.auth_config),
        whitelist=c.whitelist,
        timeout=c.timeout,
        rate_limit=c.rate_limit,
        cache=c.cache,
        env=c.env,
    )


@router.get("", response_model=list[ConnectionOut])
async def list_connections(db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)):
    rows = (await db.execute(select(Connection).where(Connection.account_id == aid))).scalars().all()
    return [_out(c) for c in rows]


@router.post("", response_model=ConnectionOut)
async def create_connection(body: ConnectionIn, db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)):
    c = Connection(
        account_id=aid,
        name=body.name,
        base_url=body.base_url,
        auth_type=body.auth_type,
        auth_config=encrypt_auth_config(body.auth_config),
        whitelist=body.whitelist,
        timeout=body.timeout,
        rate_limit=body.rate_limit,
        cache=body.cache,
        env=body.env,
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return _out(c)


@router.put("/{conn_id}", response_model=ConnectionOut)
async def update_connection(conn_id: str, body: ConnectionIn, db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)):
    c = await db.get(Connection, conn_id)
    if not c or c.account_id != aid:
        raise HTTPException(404, "connection not found")
    c.name = body.name
    c.base_url = body.base_url
    c.auth_type = body.auth_type
    # Preserve existing secrets when the client sends the redaction marker.
    merged = dict(c.auth_config or {})
    for k, v in body.auth_config.items():
        if v == "__set__":
            continue
        merged[k] = v
    c.auth_config = encrypt_auth_config(merged)
    c.whitelist = body.whitelist
    c.timeout = body.timeout
    c.rate_limit = body.rate_limit
    c.cache = body.cache
    c.env = body.env
    await db.commit()
    await db.refresh(c)
    return _out(c)


@router.post("/{conn_id}/test", response_model=ConnectionTestResult)
async def test_connection(
    conn_id: str,
    body: ConnectionTestIn | None = None,
    db: AsyncSession = Depends(get_db),
    aid: str = Depends(require_account),
):
    """Probe a stored connection so the admin can see if it works.

    Secrets are injected server-side (never returned). This is an
    admin-initiated reachability check, so the path whitelist is not applied —
    an empty endpoint simply probes the configured base URL. Connection-level
    failures (DNS/TLS/timeout) are reported as a result, not raised.
    """
    body = body or ConnectionTestIn()
    c = await db.get(Connection, conn_id)
    if not c or c.account_id != aid:
        raise HTTPException(404, "connection not found")

    endpoint = (body.endpoint or "").strip()
    url = c.base_url.rstrip("/")
    if endpoint:
        url = url + "/" + endpoint.lstrip("/")

    headers: dict[str, str] = {}
    query: dict[str, str] = {}
    _apply_auth(c, headers, query)

    timeout = (c.timeout or 5000) / 1000
    start = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            resp = await client.request(
                (body.method or "GET").upper(), url, headers=headers, params=query,
                json=body.body,
            )
        latency = int((time.monotonic() - start) * 1000)
        reason = resp.reason_phrase or ""
        return ConnectionTestResult(
            ok=resp.status_code < 400,
            reachable=True,
            status=resp.status_code,
            latency_ms=latency,
            url=url,
            message=f"HTTP {resp.status_code} {reason}".strip(),
        )
    except httpx.TimeoutException:
        latency = int((time.monotonic() - start) * 1000)
        return ConnectionTestResult(
            ok=False, reachable=False, latency_ms=latency, url=url,
            message=f"Таймаут ({c.timeout or 5000} мс)",
        )
    except Exception as exc:
        latency = int((time.monotonic() - start) * 1000)
        return ConnectionTestResult(
            ok=False, reachable=False, latency_ms=latency, url=url,
            message=f"Не удалось подключиться: {exc}",
        )


@router.delete("/{conn_id}")
async def delete_connection(conn_id: str, db: AsyncSession = Depends(get_db), aid: str = Depends(require_account)):
    c = await db.get(Connection, conn_id)
    if c and c.account_id == aid:
        await db.delete(c)
        await db.commit()
    return {"ok": True}
