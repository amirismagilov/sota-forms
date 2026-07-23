"""Resolve API-dictionary options on the backend (ФР-32..42).

Substitutes {{field}} placeholders from current form values, calls the external
API through the stored connection (secrets stay server-side), applies the JSON
mapping, and caches the result in Redis per (dict, params).
"""

from __future__ import annotations

import json
import re

from sqlalchemy.ext.asyncio import AsyncSession

from .models import Dictionary
from .proxy_client import run_proxy_request

try:
    import redis.asyncio as aioredis
except Exception:  # pragma: no cover
    aioredis = None

from .config import get_settings

_PLACEHOLDER = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")
_redis = None


def _get_redis():
    global _redis
    if _redis is None and aioredis is not None:
        try:
            _redis = aioredis.from_url(get_settings().redis_url, decode_responses=True)
        except Exception:
            _redis = None
    return _redis


def _substitute(template: str, values: dict) -> str:
    return _PLACEHOLDER.sub(lambda m: str(values.get(m.group(1), "")), template or "")


def _dig(node: object, path: str) -> object:
    for part in [p for p in (path or "").split(".") if p]:
        if isinstance(node, dict):
            node = node.get(part)
        else:
            return None
    return node


def apply_mapping(raw: object, mapping: dict) -> list[dict]:
    node = _dig(raw, mapping.get("path", ""))
    if not isinstance(node, list):
        return []
    code_f = mapping.get("codeField", "code")
    val_f = mapping.get("valueField", "value")
    attr_map = mapping.get("attrs", {})  # {attrName: jsonField}
    out = []
    for it in node:
        if not isinstance(it, dict):
            continue
        attrs = {name: it.get(src) for name, src in attr_map.items()} if attr_map else it
        out.append({"code": str(it.get(code_f, "")), "label": str(it.get(val_f, "")), "attrs": attrs})
    return out


def _cache_ttl(refresh: str | None) -> int:
    return {"hourly": 3600, "daily": 86400, "manual": 0, "onDemand": 0}.get(refresh or "", 300)


async def resolve_api_dictionary(db: AsyncSession, dictionary: Dictionary, values: dict) -> list[dict]:
    cfg = dictionary.api_config or {}
    if not cfg:
        return []

    # Determine endpoint + params (single vs smart URL modes).
    method = cfg.get("method", "GET")
    endpoint = cfg.get("endpoint", "")
    if cfg.get("urlMode") == "smart":
        dep = (dictionary.dependencies or [{}])[0]
        parent_val = str(values.get(dep.get("fieldId", ""), ""))
        for rule in cfg.get("urlMap", []):
            if str(rule.get("parentValue", "")) == parent_val:
                endpoint = rule.get("endpoint", endpoint)
                method = rule.get("method", method)
                break
    endpoint = _substitute(endpoint, values)

    params_tpl = cfg.get("params", "")
    if isinstance(params_tpl, str) and params_tpl.strip():
        try:
            params = json.loads(_substitute(params_tpl, values))
        except json.JSONDecodeError:
            params = {}
    elif isinstance(params_tpl, dict):
        params = json.loads(_substitute(json.dumps(params_tpl), values))
    else:
        params = {}

    cache_key = f"dictopt:{dictionary.id}:{endpoint}:{json.dumps(params, sort_keys=True)}"
    ttl = _cache_ttl(cfg.get("refresh"))
    r = _get_redis()
    if ttl and r is not None:
        try:
            cached = await r.get(cache_key)
            if cached:
                return json.loads(cached)
        except Exception:
            pass

    raw = await run_proxy_request(
        db, connection_id=cfg.get("connectionId"), endpoint=endpoint, method=method, params=params
    )
    items = apply_mapping(raw, cfg.get("mapping", {}))

    if ttl and r is not None:
        try:
            await r.set(cache_key, json.dumps(items), ex=ttl)
        except Exception:
            pass
    return items
