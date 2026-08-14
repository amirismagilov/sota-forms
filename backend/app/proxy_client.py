from __future__ import annotations

import re

import httpx
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from .crypto import decrypt_auth_config
from .models import Connection


def _check_whitelist(endpoint: str, whitelist: list[str]) -> None:
    if not whitelist:
        return  # empty whitelist = allow all (demo default)
    for pattern in whitelist:
        try:
            if re.search(pattern, endpoint):
                return
        except re.error:
            continue
    raise HTTPException(403, f"endpoint '{endpoint}' not allowed by whitelist")


def _apply_auth(conn: Connection, headers: dict, params: dict) -> None:
    auth = decrypt_auth_config(conn.auth_config)
    t = conn.auth_type
    if t == "bearer":
        headers["Authorization"] = f"Bearer {auth.get('token', '')}"
    elif t == "basic":
        import base64

        raw = f"{auth.get('login', '')}:{auth.get('password', '')}".encode()
        headers["Authorization"] = "Basic " + base64.b64encode(raw).decode()
    elif t == "apikey_header":
        headers[auth.get("headerName", "Authorization")] = auth.get("token", "")
    elif t == "apikey_query":
        params[auth.get("paramName", "api_key")] = auth.get("token", "")


async def run_proxy_request(
    db: AsyncSession,
    connection_id: str | None,
    endpoint: str,
    method: str = "GET",
    params: dict | None = None,
) -> object:
    """Execute an outbound request through a stored connection.

    Secrets are injected here on the backend and never returned to the caller
    (Б-1, Б-2, Б-3). Whitelist is enforced (БК-2).
    """
    params = params or {}
    if not connection_id:
        raise HTTPException(400, "connectionId required")
    conn = await db.get(Connection, connection_id)
    if not conn:
        raise HTTPException(404, "connection not found")

    _check_whitelist(endpoint, conn.whitelist)

    url = conn.base_url.rstrip("/") + "/" + endpoint.lstrip("/")
    headers: dict[str, str] = {}
    query: dict[str, str] = {}
    body = None
    method = method.upper()
    if method == "GET":
        query.update(params)
    else:
        body = params
    _apply_auth(conn, headers, query)

    timeout = (conn.timeout or 5000) / 1000
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.request(method, url, headers=headers, params=query, json=body)
    resp.raise_for_status()
    ctype = resp.headers.get("content-type", "")
    return resp.json() if "json" in ctype else {"text": resp.text}


async def run_connection_request(
    db: AsyncSession,
    connection_id: str | None,
    endpoint: str,
    method: str = "POST",
    body: object | None = None,
    headers: dict[str, str] | None = None,
    params: dict[str, str] | None = None,
) -> dict:
    """Запрос через «Подключение», возвращающий СЫРОЙ результат.

    В отличие от `run_proxy_request` не бросает исключение на 4xx/5xx: весь
    смысл правил разбора ответа — ветвиться по коду («409 — заявка уже подана»),
    а проглоченный статус сделал бы такое правило невыразимым.

    Возвращает `{"status", "body", "error", "url"}`; `error` заполнен только
    когда ответа не было вовсе (таймаут, DNS, обрыв).
    """
    if not connection_id:
        raise HTTPException(400, "выберите подключение для REST-отправки")
    conn = await db.get(Connection, connection_id)
    if not conn:
        raise HTTPException(404, "connection not found")

    _check_whitelist(endpoint, conn.whitelist)

    url = conn.base_url.rstrip("/") + "/" + (endpoint or "").lstrip("/")
    out_headers: dict[str, str] = dict(headers or {})
    query: dict[str, str] = dict(params or {})
    # Аутентификация подключения ставится ПОСЛЕ пользовательских заголовков:
    # заголовок из настроек шага не должен подменить секрет подключения.
    _apply_auth(conn, out_headers, query)

    method = (method or "POST").upper()
    timeout = (conn.timeout or 5000) / 1000
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.request(
                method,
                url,
                headers=out_headers,
                params=query,
                json=None if method == "GET" else body,
            )
    except Exception as exc:  # noqa: BLE001 — сеть отдаём правилам как error
        return {"status": 0, "body": None, "error": str(exc)[:300], "url": url}

    ctype = resp.headers.get("content-type", "")
    if "json" in ctype:
        try:
            parsed = resp.json()
        except ValueError:
            parsed = {"text": resp.text[:2000]}
    else:
        parsed = {"text": resp.text[:2000]}
    return {"status": resp.status_code, "body": parsed, "error": None, "url": url}
