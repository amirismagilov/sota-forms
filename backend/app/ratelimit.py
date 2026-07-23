from __future__ import annotations

import time

from .config import get_settings

try:
    import redis.asyncio as aioredis
except Exception:  # pragma: no cover
    aioredis = None

_redis = None
_memory: dict[str, list[float]] = {}


def _get_redis():
    global _redis
    if _redis is None and aioredis is not None:
        try:
            _redis = aioredis.from_url(get_settings().redis_url, decode_responses=True)
        except Exception:
            _redis = None
    return _redis


async def check_rate_limit(key: str, limit: int = 60, window: int = 60) -> bool:
    """Sliding-window rate limit. Falls back to in-memory if Redis is down
    (honest degradation — never silently disables the limit)."""
    now = time.time()
    r = _get_redis()
    if r is not None:
        try:
            bucket = f"rl:{key}:{int(now // window)}"
            count = await r.incr(bucket)
            if count == 1:
                await r.expire(bucket, window)
            return count <= limit
        except Exception:
            pass
    # In-memory fallback
    hits = [t for t in _memory.get(key, []) if now - t < window]
    hits.append(now)
    _memory[key] = hits
    return len(hits) <= limit
