from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..proxy_client import run_proxy_request
from ..ratelimit import check_rate_limit
from ..schemas import ProxyIn

router = APIRouter(prefix="/api/proxy", tags=["proxy"])


@router.post("/{connection_id}")
async def proxy(connection_id: str, body: ProxyIn, db: AsyncSession = Depends(get_db)):
    allowed = await check_rate_limit(f"proxy:{connection_id}")
    if not allowed:
        raise HTTPException(429, "rate limit exceeded")
    try:
        return await run_proxy_request(
            db,
            connection_id=connection_id,
            endpoint=body.endpoint,
            method=body.method,
            params=body.params,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f"upstream error: {exc}") from exc
