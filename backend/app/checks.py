"""Resolve an `api_check` field — ask an external system what to do next.

The user fills part of the form, presses «Проверить», and the answer decides
which further fields appear. The call goes out through a stored Connection, so
credentials stay on the backend and the path whitelist applies, exactly like
API dictionaries and suggest fields.

What comes back is DATA, not a schema: the form decides what to show from it via
its own conditions. That keeps the form previewable and debuggable in the editor
instead of turning it into a renderer for whatever a remote service emits.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from .dict_resolver import _substitute
from .proxy_client import run_proxy_request
from .suggest import dig


def _render_json_template(template: Any, values: dict) -> dict:
    """`{{field}}` inside a JSON template, tolerant of the field being empty."""
    if not template:
        return {}
    raw = template if isinstance(template, str) else json.dumps(template, ensure_ascii=False)
    rendered = _substitute(raw, values)
    try:
        parsed = json.loads(rendered)
    except json.JSONDecodeError as exc:
        raise HTTPException(400, f"Тело запроса проверки — некорректный JSON после подстановки: {exc}") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(400, "Тело запроса проверки должно быть JSON-объектом")
    return parsed


async def run_check(db: AsyncSession, cfg: dict, values: dict) -> dict[str, Any]:
    """Execute one check. Returns {ok, data, raw} — never leaks the connection."""
    if not cfg.get("connectionId"):
        raise HTTPException(400, "У проверки не выбрано подключение")

    method = (cfg.get("method") or "POST").upper()
    template = cfg.get("body") if method != "GET" else cfg.get("params")
    payload = _render_json_template(template, values)

    raw = await run_proxy_request(
        db,
        connection_id=cfg["connectionId"],
        endpoint=cfg.get("endpoint") or "",
        method=method,
        params=payload,
    )

    # `path` narrows the response to the useful part, so conditions read
    # `check.decision` rather than `check.data.result.decision`.
    data = dig(raw, cfg["path"]) if cfg.get("path") else raw
    if data is None:
        data = {}
    if not isinstance(data, dict | list):
        # A bare scalar still has to be addressable by a condition.
        data = {"value": data}
    return {"ok": True, "data": data}
