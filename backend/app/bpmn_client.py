"""HTTP client for the sota-bpmn BFF (process/form catalogue + task completion).

sota-bpmn already exposes everything we need, so this module deliberately stays
a thin typed wrapper rather than talking to Operaton's engine-rest directly:

    GET  /api/processes                 → deployed processes
    GET  /api/forms?process=KEY         → form summaries of a process
    GET  /api/forms/{formId}            → {id, processKey, schema}
    POST /api/tasks/{taskId}/complete   → {"data": {...}} → 204

The shared secret is injected here and never reaches the browser.
"""

from __future__ import annotations

from typing import Any

import httpx
from fastapi import HTTPException

from .config import get_settings


class BpmnUnavailable(HTTPException):
    def __init__(self, detail: str):
        super().__init__(502, detail)


def _base() -> str:
    base = (get_settings().sota_bpmn_base or "").rstrip("/")
    if not base:
        raise HTTPException(400, "Интеграция с Оператоном не настроена (SOTA_BPMN_BASE)")
    return base


def auth_headers() -> dict[str, str]:
    token = get_settings().sota_bpmn_token
    return {"X-Forms-Token": token} if token else {}


async def _get_json(path: str, params: dict[str, Any] | None = None) -> Any:
    url = _base() + path
    timeout = (get_settings().sota_bpmn_timeout or 10000) / 1000
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(url, params=params, headers=auth_headers())
    except httpx.TimeoutException as exc:
        raise BpmnUnavailable(f"sota-bpmn не ответил за {timeout:.0f} с") from exc
    except Exception as exc:
        raise BpmnUnavailable(f"sota-bpmn недоступен: {exc}") from exc
    if resp.status_code == 404:
        raise HTTPException(404, "Объект не найден в sota-bpmn")
    if resp.status_code >= 400:
        raise BpmnUnavailable(f"sota-bpmn ответил HTTP {resp.status_code}")
    return resp.json()


async def list_processes() -> list[dict[str, Any]]:
    rows = await _get_json("/api/processes")
    return [
        {
            "process_id": r.get("process_id"),
            "name": r.get("name"),
            "version": r.get("version"),
            "status": r.get("status"),
        }
        for r in (rows or [])
    ]


async def list_forms(process_key: str | None = None) -> list[dict[str, Any]]:
    data = await _get_json("/api/forms", {"process": process_key} if process_key else None)
    return list((data or {}).get("forms") or [])


async def get_form(form_id: str) -> dict[str, Any]:
    """Returns the raw PreviewFormDTO: {id, processKey, schema}."""
    data = await _get_json(f"/api/forms/{form_id}")
    if not isinstance(data, dict) or not isinstance(data.get("schema"), dict):
        raise BpmnUnavailable(f"sota-bpmn вернул форму '{form_id}' без схемы")
    return data


async def ping() -> dict[str, Any]:
    """Reachability probe for the admin UI — never raises, always reports."""
    base = (get_settings().sota_bpmn_base or "").rstrip("/")
    if not base:
        return {"ok": False, "configured": False, "message": "SOTA_BPMN_BASE не задан"}
    timeout = (get_settings().sota_bpmn_timeout or 10000) / 1000
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(base + "/api/processes", headers=auth_headers())
        return {
            "ok": resp.status_code < 400,
            "configured": True,
            "base_url": base,
            "status": resp.status_code,
            "message": f"HTTP {resp.status_code}",
        }
    except Exception as exc:
        return {"ok": False, "configured": True, "base_url": base, "message": f"Недоступен: {exc}"}
