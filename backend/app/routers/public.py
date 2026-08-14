from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..bpmn_client import auth_headers
from ..config import get_settings
from ..crypto import sign_flow_token, sign_payload, verify_flow_token
from ..db import get_db
from ..deps import get_account_by_id
from ..dict_resolver import resolve_api_dictionary
from ..flow import (
    MAIN_STEP,
    build_context,
    build_request_body,
    get_step,
    normalize_flow,
    render_headers,
    render_template,
    run_rules,
    step_field_ids,
)
from ..models import Dictionary, Form, FormVersion, Submission, WebhookDelivery
from ..operaton import resolve_placeholders
from ..proxy_client import run_connection_request
from ..ratelimit import check_rate_limit
from ..schemas import PublicFormOut, SubmitIn
from ..suggest import resolve_suggest

router = APIRouter(prefix="/api/public", tags=["public"])


def _referenced_dict_ids(fields: list[dict]) -> set[str]:
    ids = set()
    for f in fields:
        if f.get("dictionaryId"):
            ids.add(f["dictionaryId"])
    return ids


@router.get("/forms/{form_id}", response_model=PublicFormOut)
async def public_form(form_id: str, db: AsyncSession = Depends(get_db)):
    """Schema + design tokens + referenced dictionaries for the widget (ВТ-3).

    The form_id is a global embed key, so it resolves the owning account —
    no auth needed for public rendering.
    """
    f = (
        await db.execute(select(Form).where(Form.form_id == form_id))
    ).scalar_one_or_none()
    if not f:
        raise HTTPException(404, "form not found")
    # The widget serves the PUBLISHED snapshot, never the live draft, and only
    # while the form is published (archived/unpublished forms are hidden).
    if f.status == "archived":
        raise HTTPException(404, "form not available")
    if not f.published_version:
        raise HTTPException(404, "form not published")
    snap = (
        await db.execute(
            select(FormVersion).where(FormVersion.form_pk == f.id, FormVersion.version == f.published_version)
        )
    ).scalar_one_or_none()
    if not snap:
        raise HTTPException(404, "published version missing")

    acc = await get_account_by_id(db, f.account_id)

    dict_ids = _referenced_dict_ids(snap.fields)
    dicts = []
    if dict_ids:
        rows = (
            await db.execute(select(Dictionary).where(Dictionary.id.in_(dict_ids)))
        ).scalars().all()
        for d in rows:
            dicts.append(
                {
                    "id": d.id,
                    "code": d.code,
                    "name": d.name,
                    "type": d.type,
                    "dependencies": d.dependencies,
                    "attrs": d.attrs,
                    "items": d.items,
                    "api_config": d.api_config,
                }
            )

    return PublicFormOut(
        form_id=f.form_id,
        title=snap.title,
        grid_columns=snap.grid_columns,
        fields=snap.fields,
        submit=snap.submit,
        design_tokens=acc.design_tokens,
        dictionaries=dicts,
        source=f.source or "local",
        # Process variable → our field id. The host page prefills using the names
        # the ENGINE knows, so the widget needs this to translate them. Field
        # names only — nothing sensitive.
        key_map=(f.source_meta or {}).get("key_map", {}) if f.source == "operaton" else {},
    )


@router.post("/forms/{form_id}/suggest")
async def form_suggest(form_id: str, body: dict | None = None, db: AsyncSession = Depends(get_db)):
    """Typeahead for a suggest field (called per keystroke by the widget).

    The field's connection/endpoint/mapping live in the published form snapshot —
    the widget only sends the typed query and current values, so secrets and the
    connection never leave the backend.
    """
    body = body or {}
    field_id = body.get("fieldId")
    query = (body.get("query") or "").strip()
    values = body.get("values", {})

    f = (await db.execute(select(Form).where(Form.form_id == form_id))).scalar_one_or_none()
    if not f or f.status == "archived" or not f.published_version:
        raise HTTPException(404, "form not available")
    snap = (
        await db.execute(
            select(FormVersion).where(FormVersion.form_pk == f.id, FormVersion.version == f.published_version)
        )
    ).scalar_one_or_none()
    if not snap:
        raise HTTPException(404, "published version missing")

    field = next(
        (x for x in (snap.fields or []) if x.get("id") == field_id and x.get("type") == "suggest"),
        None,
    )
    cfg = (field or {}).get("suggest") or {}
    if not field or not cfg.get("connectionId"):
        raise HTTPException(404, "suggest field not configured")
    if len(query) < int(cfg.get("minChars") or 1):
        return {"items": []}
    try:
        _, items = await resolve_suggest(db, cfg, query, values)
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f"suggest source error: {exc}") from exc


@router.get("/forms/by-operaton/{operaton_form_id}")
async def form_by_operaton_id(operaton_form_id: str, db: AsyncSession = Depends(get_db)):
    """Which of our forms replaces this Operaton form? Used by the sota-bpmn host.

    Only PUBLISHED forms resolve — a draft must never take over a live task.
    Keeping the lookup here means the id-sanitisation rules live in exactly one
    place instead of being reimplemented on the sota-bpmn side.
    """
    f = (
        await db.execute(
            select(Form).where(
                Form.source == "operaton",
                Form.source_meta["operaton_form_id"].astext == operaton_form_id,
            )
        )
    ).scalars().first()
    if not f or f.status == "archived" or not f.published_version:
        raise HTTPException(404, "no published form for this Operaton form id")
    return {
        "form_id": f.form_id,
        "title": f.title,
        "published_version": f.published_version,
        "process_key": (f.source_meta or {}).get("process_key"),
    }


@router.post("/dictionaries/{dict_id}/options")
async def dictionary_options(dict_id: str, body: dict | None = None, db: AsyncSession = Depends(get_db)):
    """Resolve options for an API dictionary given current form values (ФР-39..42).

    Secrets and mapping stay on the backend; the widget only sends field values.
    """
    d = await db.get(Dictionary, dict_id)
    if not d:
        raise HTTPException(404, "dictionary not found")
    if d.type != "api":
        return {"items": d.items}
    values = (body or {}).get("values", {})
    try:
        items = await resolve_api_dictionary(db, d, values)
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f"dictionary source error: {exc}") from exc


def _handles_failures(step: dict) -> bool:
    """Автор сам разбирает неуспех? (есть правило по HTTP-статусу или ошибке)

    Пока такого правила нет, ошибка внешней системы обязана всплыть как 502.
    Показать «Спасибо!» на 500 от системы принятия решения — худшее, что может
    сделать форма: пользователь уходит уверенный, что заявка подана.
    """
    for rule in step.get("rules") or []:
        for cond in rule.get("when") or []:
            if cond.get("source") in ("status", "error"):
                return True
    return False


async def _load_published(db: AsyncSession, form_id: str) -> tuple[Form, FormVersion]:
    f = (await db.execute(select(Form).where(Form.form_id == form_id))).scalar_one_or_none()
    if not f:
        raise HTTPException(404, "form not found")
    if not f.published_version or f.status == "archived":
        raise HTTPException(404, "form not available")
    snap = (
        await db.execute(
            select(FormVersion).where(FormVersion.form_pk == f.id, FormVersion.version == f.published_version)
        )
    ).scalar_one_or_none()
    if not snap:
        raise HTTPException(404, "published version missing")
    return f, snap


@router.post("/forms/{form_id}/submit")
async def submit_form(form_id: str, body: SubmitIn, db: AsyncSession = Depends(get_db)):
    """Один шаг флоу: сохранить данные → отправить JSON → разобрать ответ → вернуть исход.

    Многошаговая форма (заявка → скоринг → добор полей) вызывает этот эндпоинт
    несколько раз, передавая `submissionId` + `flowToken` из предыдущего ответа:
    данные всех шагов накапливаются в ОДНОМ заполнении, а не рассыпаются на
    несвязанные записи.
    """
    if not await check_rate_limit(f"submit:{form_id}", limit=120):
        raise HTTPException(429, "rate limit exceeded")

    f, snap = await _load_published(db, form_id)
    acc = await get_account_by_id(db, f.account_id)

    flow = normalize_flow(snap.submit)
    step_id = body.step or MAIN_STEP
    step = get_step(flow, step_id)
    if step is None:
        raise HTTPException(404, f"шаг '{step_id}' не найден в опубликованной версии формы")

    # Продолжение флоу дописывает данные в существующее заполнение — но только
    # предъявив подписанный на предыдущем шаге токен.
    sub: Submission | None = None
    if body.submissionId:
        if not verify_flow_token(body.flowToken, body.submissionId, form_id):
            raise HTTPException(403, "недействительный токен продолжения формы")
        sub = await db.get(Submission, body.submissionId)
        if sub is None or sub.form_id != form_id:
            raise HTTPException(404, "заполнение не найдено")
        sub.data = {**(sub.data or {}), **(body.data or {})}
    if sub is None:
        sub = Submission(account_id=acc.id, form_id=form_id, data=body.data, webhook_status="pending")
        db.add(sub)
    await db.flush()

    settings = get_settings()
    request = step["request"]
    transport = request.get("transport")
    ctx_base = {
        "formId": form_id,
        "step": step["id"],
        "submittedAt": sub.created_at.isoformat() if sub.created_at else "",
        **(body.context or {}),
    }
    ctx = build_context(data=sub.data or {}, submission_id=sub.id, extra=ctx_base)

    status: int | None = None
    resp_body: object = None
    error: str | None = None

    if transport == "rest":
        status, resp_body, error = await _run_rest_step(db, request, ctx)
    elif transport == "webhook":
        status, resp_body, error = await _run_webhook_step(
            db, f, acc, sub, step, request, ctx, body, settings, form_id
        )
    else:
        sub.webhook_status = "no_webhook"

    # Ответ известен — пересобираем контекст и прогоняем правила.
    ctx = build_context(
        data=sub.data or {},
        status=status,
        response=resp_body,
        error=error,
        submission_id=sub.id,
        extra=ctx_base,
    )
    failed = bool(error) or (status is not None and not (200 <= status < 300))
    if failed and not _handles_failures(step):
        await db.commit()
        raise HTTPException(502, _external_error(status, error, resp_body))

    outcome, rule = run_rules(step, ctx)
    outcome = _finalize_outcome(outcome, flow, snap, step)
    # Факт обмена возвращаем всегда: каким транспортом ушло, с каким HTTP-статусом
    # (или почему ответа не было). Это не секрет — секрет в теле ответа, и оно
    # по-прежнему уезжает в браузер только по явной галочке автора. Пока статус
    # прятался вместе с телом, успешный REST-вызов выглядел так, будто его не было.
    outcome["transport"] = transport or "none"
    expose_body = bool(request.get("exposeResponse"))
    if status is not None or error or expose_body:
        outcome["response"] = {"status": status}
        if error:
            outcome["response"]["error"] = error
        if expose_body:
            outcome["response"]["body"] = resp_body

    await db.commit()
    await db.refresh(sub)
    return {
        "ok": True,
        "submissionId": sub.id,
        "flowToken": sign_flow_token(sub.id, form_id),
        "step": step["id"],
        "outcome": outcome,
        "matchedRule": (rule or {}).get("id"),
        # Старые сборки виджета читают эти два поля — оставляем их согласованными
        # с исходом, чтобы уже встроенные формы не сломались после обновления.
        "successMessage": outcome.get("text") if outcome.get("kind") == "message" else None,
        "redirectUrl": outcome.get("url") if outcome.get("kind") == "redirect" else None,
    }


def _finalize_outcome(outcome: dict, flow: dict, snap: FormVersion, step: dict) -> dict:
    """Досбор исхода: проверка ссылки на шаг, заголовок и список полей шага."""
    if outcome.get("kind") != "fields":
        return outcome
    target = get_step(flow, outcome.get("stepId"))
    if target is None or target["id"] == step["id"]:
        # Правило ссылается на удалённый (или на себя же) шаг — зациклить форму
        # нельзя, поэтому честно говорим, что настройка сломана.
        return {
            "kind": "message",
            "messageType": "warning",
            "title": "",
            "text": "Форма настроена с ошибкой: следующий шаг не найден. Сообщите администратору.",
        }
    outcome["stepTitle"] = target.get("title") or ""
    outcome["stepDescription"] = target.get("description") or ""
    outcome["fieldIds"] = step_field_ids(snap.fields or [], target["id"])
    outcome["button"] = target.get("button")
    return outcome


async def _run_rest_step(db: AsyncSession, request: dict, ctx: dict) -> tuple[int | None, object, str | None]:
    """REST через «Подключение»: секреты и whitelist остаются на бэкенде."""
    endpoint = render_template(request.get("endpoint") or "", ctx)
    payload = build_request_body(request, ctx)
    headers = render_headers(request, ctx)
    result = await run_connection_request(
        db,
        request.get("connectionId"),
        endpoint,
        method=request.get("method") or "POST",
        body=payload,
        headers=headers,
    )
    return result["status"], result["body"], result["error"]


async def _run_webhook_step(
    db: AsyncSession,
    f: Form,
    acc,
    sub: Submission,
    step: dict,
    request: dict,
    ctx: dict,
    body: SubmitIn,
    settings,
    form_id: str,
) -> tuple[int | None, object, str | None]:
    """Вебхук: очередь доставки с ретраями (async) или ожидание ответа (sync)."""
    template = request.get("webhookUrl") or acc.webhook_default
    if not template:
        sub.webhook_status = "no_webhook"
        return None, None, None

    webhook_url, missing = resolve_placeholders(
        template,
        {
            **(body.context or {}),
            "bpmnBase": (settings.sota_bpmn_base or "").rstrip("/"),
            "formId": form_id,
            "submissionId": sub.id,
        },
    )
    if missing:
        # An Operaton form without a taskId cannot complete anything — that is
        # a wiring bug in the host page, so fail loudly instead of dropping
        # the submission into a webhook that can never be built.
        sub.webhook_status = "no_context"
        await db.commit()
        raise HTTPException(
            400,
            "Форма ожидает контекст выполнения, но он не передан: "
            + ", ".join(missing)
            + ". Для задач Оператона встраивайте виджет с атрибутом task-id.",
        )

    payload = build_request_body(request, ctx)
    headers = {"X-Signature": sign_payload(payload), "Content-Type": "application/json"}
    if request.get("operatonComplete"):
        headers.update(auth_headers())
    headers.update(render_headers(request, ctx))

    delivery = WebhookDelivery(
        submission_id=sub.id,
        form_id=form_id,
        url=webhook_url,
        payload={"body": payload, "signature": headers["X-Signature"]},
    )
    db.add(delivery)

    if request.get("delivery") != "sync":
        # Fire-and-forget: воркер доставит с ретраями, правилам разбирать нечего.
        return None, None, None

    # Synchronous mode (Operaton task completion): the person pressing «Отправить»
    # must learn right away that the task was already completed by someone else,
    # instead of being told «Спасибо» while the delivery quietly retries.
    delivery.attempts = 1
    try:
        async with httpx.AsyncClient(timeout=(settings.sota_bpmn_timeout or 10000) / 1000) as client:
            resp = await client.post(webhook_url, json=payload, headers=headers)
    except Exception as exc:  # noqa: BLE001 — сетевую ошибку отдаём правилам
        delivery.status = "dead"
        delivery.last_error = str(exc)[:300]
        sub.webhook_status = "failed"
        return 0, None, str(exc)[:300]

    delivery.last_status_code = resp.status_code
    ok = 200 <= resp.status_code < 300
    delivery.status = "delivered" if ok else "dead"
    sub.webhook_status = "delivered" if ok else "failed"
    if not ok:
        delivery.last_error = f"HTTP {resp.status_code}: {resp.text[:300]}"
    try:
        parsed = resp.json()
    except ValueError:
        parsed = {"text": resp.text[:2000]}
    return resp.status_code, parsed, None


def _external_error(status_code: int | None, error: str | None, raw: object) -> str:
    """Код внешней системы → фраза, понятная тому, кто заполняет форму."""
    if error:
        return f"Не удалось передать данные: {error}"
    if status_code == 404:
        return "Задача не найдена в процессе — возможно, она уже закрыта"
    if status_code == 409:
        return "Задача уже завершена другим пользователем"
    if status_code in (401, 403):
        return "Нет доступа к внешней системе: проверьте настройки подключения"
    detail = ""
    if isinstance(raw, dict):
        detail = str(raw.get("detail") or raw.get("message") or "")[:200]
    return f"Внешняя система отклонила данные (HTTP {status_code}){': ' + detail if detail else ''}"
