"""Server-side typeahead ("suggest") resolution.

A *suggest* field sends the text the user is typing to an external API through a
stored connection (secrets stay server-side, whitelist enforced) and returns
matched options plus the full data object, so the form can auto-fill related
fields when one is picked (e.g. DaData INN → name/address/KPP).

Provider-agnostic: any REST/suggest API works — you configure the endpoint, the
param that carries the query, where the array lives, and which fields to show
and store.
"""

from __future__ import annotations

import json

from sqlalchemy.ext.asyncio import AsyncSession

from .dict_resolver import _substitute  # reuse {{field}} substitution
from .proxy_client import run_proxy_request


def dig(node: object, path: str) -> object:
    """Follow a dot-path into nested dicts/lists (e.g. "data.inn", "0.value")."""
    for part in [p for p in (path or "").split(".") if p]:
        if isinstance(node, dict):
            node = node.get(part)
        elif isinstance(node, list):
            try:
                node = node[int(part)]
            except (ValueError, IndexError):
                return None
        else:
            return None
    return node


def _build_params(cfg: dict, query: str, values: dict) -> dict:
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
    params[cfg.get("queryParam") or "query"] = query
    return params


async def resolve_suggest(
    db: AsyncSession, cfg: dict, query: str, values: dict
) -> tuple[object, list[dict]]:
    """Run one suggest query. Returns (raw_response, items[{value,label,data}])."""
    method = (cfg.get("method") or "POST").upper()
    endpoint = _substitute(cfg.get("endpoint", ""), values)
    params = _build_params(cfg, query, values)

    raw = await run_proxy_request(
        db, connection_id=cfg.get("connectionId"), endpoint=endpoint, method=method, params=params
    )

    node = dig(raw, cfg.get("path", ""))
    if not isinstance(node, list):
        node = raw if isinstance(raw, list) else []

    label_f = cfg.get("labelField") or "value"
    value_f = cfg.get("valueField") or label_f
    items: list[dict] = []
    for it in node:
        if not isinstance(it, dict):  # primitive list, e.g. ["a","b"]
            items.append({"value": str(it), "label": str(it), "data": it})
            continue
        items.append({
            "value": str(dig(it, value_f) if value_f else it.get("value", "")),
            "label": str(dig(it, label_f) if label_f else it.get("value", "")),
            "data": it,  # full object so the form can auto-fill related fields
        })
    return raw, items
