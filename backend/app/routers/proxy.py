from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..dict_resolver import _get_redis  # reuse the shared Redis handle
from ..models import Connection
from ..proxy_client import run_proxy_request
from ..ratelimit import check_rate_limit

router = APIRouter(prefix="/api/proxy", tags=["proxy"])

_CACHE_TTL = {"session": 600, "hourly": 3600, "daily": 86400}


@router.post("/{connection_id}")
async def proxy(connection_id: str, body: dict, db: AsyncSession = Depends(get_db)):
    endpoint = body.get("endpoint", "")
    method = (body.get("method") or "GET").upper()
    params = body.get("params") or {}

    if not await check_rate_limit(f"proxy:{connection_id}"):
        raise HTTPException(429, "rate limit exceeded")

    conn = await db.get(Connection, connection_id)
    ttl = _CACHE_TTL.get(conn.cache) if conn else None
    cache_key = None
    r = _get_redis()
    # Only GETs are cached (БК-5), and only when the connection opts in.
    if ttl and method == "GET" and r is not None:
        cache_key = f"proxy:{connection_id}:{endpoint}:{json.dumps(params, sort_keys=True)}"
        try:
            cached = await r.get(cache_key)
            if cached:
                return json.loads(cached)
        except Exception:
            pass

    try:
        result = await run_proxy_request(
            db, connection_id=connection_id, endpoint=endpoint, method=method, params=params
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f"upstream error: {exc}") from exc

    if cache_key and r is not None:
        try:
            await r.set(cache_key, json.dumps(result), ex=ttl)
        except Exception:
            pass
    return result
