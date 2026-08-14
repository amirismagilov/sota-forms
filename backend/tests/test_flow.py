"""Флоу отправки: нормализация, правила, исходы + сквозной прогон через API.

Разбор ответа — единственное место, где форма принимает РЕШЕНИЕ за пользователя
(«одобрено — иди дальше», «отказ — вот сообщение»). Поэтому проверяется не
только счастливый путь, но и то, что ошибка внешней системы НЕ превращается
в «Спасибо!»: тихий успех на 500 — это ложь, а не деградация.
"""

from __future__ import annotations

import asyncio

import pytest
import pytest_asyncio

from app.flow import (
    build_context,
    build_request_body,
    dig,
    eval_condition,
    get_step,
    normalize_flow,
    render_json_template,
    render_template,
    run_rules,
    step_field_ids,
)

# asyncio_mode=auto (pytest.ini) подхватывает async-тесты сам — модульного
# pytestmark тут нет намеренно: половина тестов синхронная (чистый движок).


# ---------------------------------------------------------------------------
# Чистые функции движка (БД не нужна)
# ---------------------------------------------------------------------------
def test_dig_walks_dicts_and_lists():
    obj = {"result": {"offers": [{"limit": 100}, {"limit": 200}]}}
    assert dig(obj, "result.offers.1.limit") == 200
    assert dig(obj, "result.offers[0].limit") == 100
    assert dig(obj, "result.missing.deep") is None
    assert dig(None, "a.b") is None


def test_legacy_submit_becomes_a_single_main_step():
    flow = normalize_flow({"webhookUrl": "http://x/hook", "successMessage": "Готово"})
    assert [s["id"] for s in flow["steps"]] == ["main"]
    step = flow["steps"][0]
    assert step["request"]["transport"] == "webhook"
    assert step["request"]["webhookUrl"] == "http://x/hook"
    # Сообщение старой формы не должно потеряться при апгрейде.
    assert step["rules"][0]["then"]["text"] == "Готово"


def test_legacy_redirect_becomes_a_redirect_rule():
    flow = normalize_flow({"webhookUrl": "http://x/hook", "redirectUrl": "https://ok.example"})
    action = flow["steps"][0]["rules"][0]["then"]
    assert action["kind"] == "redirect"
    assert action["url"] == "https://ok.example"


def test_first_step_is_always_main_and_ids_are_unique():
    flow = normalize_flow({"steps": [{"id": "первый"}, {"id": "approved"}, {"id": "approved"}]})
    assert [s["id"] for s in flow["steps"]] == ["main", "approved"]


def test_rest_step_is_forced_synchronous():
    # Асинхронный REST нечего разбирать правилами — ответа просто не будет.
    flow = normalize_flow({"steps": [{"id": "main", "request": {"transport": "rest", "delivery": "async"}}]})
    assert flow["steps"][0]["request"]["delivery"] == "sync"


def test_button_defaults_and_overrides():
    flow = normalize_flow({"steps": [{"id": "main", "button": {"text": "Узнать решение", "size": "small"}}]})
    btn = flow["steps"][0]["button"]
    assert (btn["text"], btn["size"], btn["block"]) == ("Узнать решение", "small", True)
    assert normalize_flow({})["steps"][0]["button"]["text"] == "Отправить"


@pytest.mark.parametrize(
    ("operator", "value", "left", "expected"),
    [
        ("eq", "approved", "approved", True),
        ("eq", 200, 200, True),
        ("neq", "approved", "declined", True),
        ("gt", 100, 150, True),
        ("gt", 100, 50, False),
        ("gte", 100, 100, True),
        ("lte", 100, 100, True),
        ("in", "approved, manual", "manual", True),
        ("in", "approved, manual", "declined", False),
        ("contains", "отказ", "полный отказ", True),
        ("regex", r"^REQ-\d+$", "REQ-123456", True),
        ("empty", None, "", True),
        ("not_empty", None, "x", True),
        ("exists", None, 0, True),   # алиас not_empty, нормализуется в _condition
    ],
)
def test_operators(operator, value, left, expected):
    ctx = build_context(response={"x": left})
    assert eval_condition({"source": "body", "path": "x", "operator": operator, "value": value}, ctx) is expected


def test_number_comparison_ignores_formatting():
    ctx = build_context(response={"limit": "1 200,50"})
    assert eval_condition({"source": "body", "path": "limit", "operator": "gt", "value": 1000}, ctx) is True


def test_non_numeric_comparison_is_false_not_crash():
    ctx = build_context(response={"limit": "много"})
    assert eval_condition({"source": "body", "path": "limit", "operator": "gt", "value": 10}, ctx) is False


def test_first_matching_rule_wins():
    step = normalize_flow(
        {
            "steps": [
                {
                    "id": "main",
                    "rules": [
                        {
                            "id": "big",
                            "when": [{"source": "body", "path": "limit", "operator": "gte", "value": 100000}],
                            "then": {"kind": "message", "text": "крупный"},
                        },
                        {
                            "id": "any",
                            "when": [],
                            "then": {"kind": "message", "text": "обычный"},
                        },
                    ],
                }
            ]
        }
    )["steps"][0]
    outcome, rule = run_rules(step, build_context(response={"limit": 500000}))
    assert (rule["id"], outcome["text"]) == ("big", "крупный")
    outcome, rule = run_rules(step, build_context(response={"limit": 1000}))
    assert (rule["id"], outcome["text"]) == ("any", "обычный")


def test_match_any_vs_all():
    ctx = build_context(status=200, response={"decision": "declined"})
    both = {
        "match": "all",
        "when": [
            {"source": "status", "operator": "eq", "value": 200},
            {"source": "body", "path": "decision", "operator": "eq", "value": "approved"},
        ],
        "then": {"kind": "message", "text": "x"},
    }
    step_all = normalize_flow({"steps": [{"id": "main", "rules": [both]}]})["steps"][0]
    assert run_rules(step_all, ctx)[1] is None

    step_any = normalize_flow({"steps": [{"id": "main", "rules": [{**both, "match": "any"}]}]})["steps"][0]
    assert run_rules(step_any, ctx)[1] is not None


def test_message_template_pulls_from_response_and_fields():
    ctx = build_context(data={"phone": "+7 999"}, response={"reason": "мало дохода", "requestId": "REQ-1"})
    text = render_template("{{resp.reason}}, заявка {{resp.requestId}}, тел. {{phone}}", ctx)
    assert text == "мало дохода, заявка REQ-1, тел. +7 999"


def test_missing_placeholder_renders_empty_not_literal():
    ctx = build_context(response={})
    assert render_template("лимит: {{resp.limit}}", ctx) == "лимит: "


def test_fields_outcome_fills_values_from_response():
    step = normalize_flow(
        {
            "steps": [
                {
                    "id": "main",
                    "rules": [
                        {
                            "id": "ok",
                            "when": [{"source": "body", "path": "decision", "operator": "eq", "value": "approved"}],
                            "then": {
                                "kind": "fields",
                                "stepId": "approved",
                                "fill": [{"fieldId": "approved_limit", "from": "resp.approvedLimit"}],
                            },
                        }
                    ],
                },
                {"id": "approved"},
            ]
        }
    )["steps"][0]
    outcome, _ = run_rules(step, build_context(response={"decision": "approved", "approvedLimit": 300000}))
    assert outcome["kind"] == "fields"
    assert outcome["stepId"] == "approved"
    # Число обязано остаться числом: поле «сумма» иначе покажет строку.
    assert outcome["values"]["approved_limit"] == 300000


def test_no_rule_matched_falls_back_to_neutral_message():
    step = normalize_flow(
        {"steps": [{"id": "main", "rules": [
            {"id": "only", "when": [{"source": "body", "path": "decision", "operator": "eq", "value": "approved"}],
             "then": {"kind": "message", "text": "ура"}},
        ]}]}
    )["steps"][0]
    outcome, rule = run_rules(step, build_context(response={"decision": "declined"}))
    assert rule is None and outcome["kind"] == "message"


def test_json_body_template_keeps_types():
    ctx = build_context(data={"amount": 250000, "fio": 'Иванов "Иван"', "docs": ["паспорт"]})
    body = render_json_template(
        '{"sum": "{{amount}}", "client": "ФИО: {{fio}}", "docs": "{{docs}}"}',
        ctx,
    )
    assert body["sum"] == 250000  # не "250000"
    assert body["client"] == 'ФИО: Иванов "Иван"'  # кавычки экранированы, JSON цел
    assert body["docs"] == ["паспорт"]


def test_payload_modes():
    ctx = build_context(data={"a": 1}, submission_id="sub_1", extra={"formId": "f", "step": "main"})
    assert build_request_body({"payload": "data"}, ctx) == {"data": {"a": 1}}
    envelope = build_request_body({"payload": "envelope"}, ctx)
    assert envelope["formId"] == "f" and envelope["submissionId"] == "sub_1" and envelope["data"] == {"a": 1}


def test_step_field_ids_defaults_to_main():
    fields = [{"id": "a"}, {"id": "b", "step": "approved"}, {"id": "c", "step": "main"}]
    assert step_field_ids(fields, "main") == ["a", "c"]
    assert step_field_ids(fields, "approved") == ["b"]


def test_get_step_unknown_returns_none():
    flow = normalize_flow({"steps": [{"id": "main"}]})
    assert get_step(flow, "nope") is None


# ---------------------------------------------------------------------------
# Сквозной прогон через API (нужен реальный Postgres — иначе honest-NA SKIP)
# ---------------------------------------------------------------------------
@pytest_asyncio.fixture
async def decision_api(client):
    """Поднимает приложение НА РЕАЛЬНОМ ПОРТУ и наводит на него подключение.

    REST-шаг ходит наружу через httpx — если подсунуть ему ASGI-транспорт из
    фикстуры `client`, проверенным окажется обход настоящего сетевого пути,
    а именно там живут таймауты, статусы и whitelist.
    """
    import uvicorn

    from app.main import app

    # lifespan=off: схему и демо-данные уже создала фикстура `client`.
    config = uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning", lifespan="off")
    server = uvicorn.Server(config)
    task = asyncio.create_task(server.serve())
    for _ in range(200):
        if server.started:
            break
        await asyncio.sleep(0.05)
    assert server.started, "не удалось поднять тестовый HTTP-сервер"
    port = server.servers[0].sockets[0].getsockname()[1]
    base = f"http://127.0.0.1:{port}"

    # Меняем ТОЛЬКО адрес: whitelist остаётся посеянный. Стереть его здесь
    # значило бы проверять путь, которого в проде нет, — и не заметить, что
    # правило whitelist режет `/decision-random?limit=100` на 403.
    seeded = (await client.get("/api/connections")).json()
    conn = next(c for c in seeded if c["id"] == "conn_decision")
    resp = await client.put(
        "/api/connections/conn_decision",
        json={**conn, "base_url": f"{base}/api/mock/ext"},
    )
    assert resp.status_code == 200, resp.text
    assert conn["whitelist"], "подключение должно приходить с whitelist из seed"
    try:
        yield base
    finally:
        # Дожидаемся РЕАЛЬНОЙ остановки: брошенный сервер продолжает держать
        # сессии к БД, а следующий тест сразу делает drop_all — гонка даёт
        # полупосеянные строки и «мигающие» падения на ровном месте.
        server.should_exit = True
        try:
            await asyncio.wait_for(task, timeout=10)
        except TimeoutError:
            task.cancel()


CREDIT_FIELDS = [
    {"id": "amount", "type": "amount", "label": "Сумма", "required": True},
    {"id": "income", "type": "amount", "label": "Доход", "required": True},
    {"id": "passport", "type": "text", "label": "Паспорт", "step": "approved"},
    {"id": "approved_limit", "type": "amount", "label": "Одобрено", "step": "approved"},
]

CREDIT_SUBMIT = {
    "steps": [
        {
            "id": "main",
            "button": {"text": "Узнать решение"},
            "request": {
                "transport": "rest",
                "connectionId": "conn_decision",
                "endpoint": "/decision",
                "method": "POST",
                "payload": "data",
            },
            "rules": [
                {
                    "id": "declined",
                    "when": [{"source": "body", "path": "decision", "operator": "eq", "value": "declined"}],
                    "then": {"kind": "message", "messageType": "error", "title": "Отказ", "text": "{{resp.reason}}"},
                },
                {
                    "id": "approved",
                    "when": [{"source": "body", "path": "decision", "operator": "eq", "value": "approved"}],
                    "then": {
                        "kind": "fields",
                        "stepId": "approved",
                        "fill": [{"fieldId": "approved_limit", "from": "resp.approvedLimit"}],
                    },
                },
            ],
        },
        {
            "id": "approved",
            "button": {"text": "Оформить"},
            "request": {"transport": "none"},
            "rules": [{"id": "done", "when": [], "then": {"kind": "message", "text": "Оформлено"}}],
        },
    ]
}


async def _publish_credit_form(client, form_id="flow_credit", submit=None, fields=None):
    created = await client.post(
        "/api/forms",
        json={
            "form_id": form_id,
            "title": "Кредит",
            "grid_columns": 2,
            "fields": fields if fields is not None else CREDIT_FIELDS,
            "submit": submit if submit is not None else CREDIT_SUBMIT,
        },
    )
    assert created.status_code == 200, created.text
    pk = created.json()["id"]
    published = await client.post(f"/api/forms/{pk}/publish")
    assert published.status_code == 200, published.text
    return pk


async def test_declined_shows_message_and_no_second_step(client, decision_api):
    await _publish_credit_form(client, "flow_credit_declined")
    # Доход не покрывает сумму → мок скоринга отвечает declined.
    r = await client.post(
        "/api/public/forms/flow_credit_declined/submit",
        json={"data": {"amount": 5000000, "income": 30000}},
    )
    assert r.status_code == 200, r.text
    out = r.json()["outcome"]
    assert out["kind"] == "message"
    assert out["messageType"] == "error"
    assert "доход" in out["text"].lower()
    assert r.json()["matchedRule"] == "declined"


async def test_approved_opens_next_step_prefilled(client, decision_api):
    await _publish_credit_form(client, "flow_credit_ok")
    r = await client.post(
        "/api/public/forms/flow_credit_ok/submit",
        json={"data": {"amount": 200000, "income": 100000}},
    )
    assert r.status_code == 200, r.text
    payload = r.json()
    out = payload["outcome"]
    assert out["kind"] == "fields"
    assert out["stepId"] == "approved"
    assert sorted(out["fieldIds"]) == ["approved_limit", "passport"]
    assert out["values"]["approved_limit"] > 0
    assert out["button"]["text"] == "Оформить"

    # Второй шаг дописывает данные в ТО ЖЕ заполнение.
    second = await client.post(
        "/api/public/forms/flow_credit_ok/submit",
        json={
            "data": {"passport": "4509 123456"},
            "step": "approved",
            "submissionId": payload["submissionId"],
            "flowToken": payload["flowToken"],
        },
    )
    assert second.status_code == 200, second.text
    assert second.json()["submissionId"] == payload["submissionId"]
    assert second.json()["outcome"]["text"] == "Оформлено"

    stored = await client.get(f"/api/submissions/{payload['submissionId']}")
    data = stored.json()["data"]
    assert data["amount"] == 200000 and data["passport"] == "4509 123456"


async def test_continuation_requires_a_valid_token(client, decision_api):
    await _publish_credit_form(client, "flow_credit_token")
    first = await client.post(
        "/api/public/forms/flow_credit_token/submit",
        json={"data": {"amount": 200000, "income": 100000}},
    )
    sid = first.json()["submissionId"]
    # submit — публичный эндпоинт: без подписи чужое заполнение дописывать нельзя.
    forged = await client.post(
        "/api/public/forms/flow_credit_token/submit",
        json={"data": {"passport": "чужой"}, "step": "approved", "submissionId": sid, "flowToken": "deadbeef"},
    )
    assert forged.status_code == 403


async def test_unknown_step_is_rejected(client):
    await _publish_credit_form(client, "flow_credit_unknown")
    r = await client.post(
        "/api/public/forms/flow_credit_unknown/submit",
        json={"data": {}, "step": "nope"},
    )
    assert r.status_code == 404


def _broken_submit(rules):
    return {
        "steps": [
            {
                "id": "main",
                "request": {
                    "transport": "rest",
                    "connectionId": "conn_decision",
                    "endpoint": "/decision-missing",  # реальный 404 от того же сервера
                    "method": "POST",
                    "payload": "data",
                },
                "rules": rules,
            }
        ]
    }


async def test_external_failure_is_not_reported_as_success(client, decision_api):
    """Внешняя система ответила 404, правил по статусу нет → 502, а не «Спасибо!»."""
    submit = _broken_submit([{"id": "ok", "when": [], "then": {"kind": "message", "text": "Спасибо!"}}])
    await _publish_credit_form(client, "flow_credit_broken", submit=submit)
    r = await client.post("/api/public/forms/flow_credit_broken/submit", json={"data": {"amount": 1}})
    assert r.status_code == 502
    assert "Спасибо" not in r.text


async def test_author_can_take_over_failure_handling(client, decision_api):
    """Есть правило по статусу — решает автор, и молчаливого успеха всё равно нет."""
    submit = _broken_submit(
        [
            {
                "id": "notfound",
                "when": [{"source": "status", "operator": "eq", "value": 404}],
                "then": {"kind": "message", "messageType": "warning", "text": "Сервис недоступен, мы перезвоним"},
            }
        ]
    )
    await _publish_credit_form(client, "flow_credit_handled", submit=submit)
    r = await client.post("/api/public/forms/flow_credit_handled/submit", json={"data": {"amount": 1}})
    assert r.status_code == 200, r.text
    assert r.json()["outcome"]["text"] == "Сервис недоступен, мы перезвоним"
    assert r.json()["outcome"]["messageType"] == "warning"
    # Автор скрыл провал за мягким текстом — но факт обмена виден: HTTP 404.
    assert r.json()["outcome"]["response"]["status"] == 404
    assert "body" not in r.json()["outcome"]["response"]


async def test_async_webhook_step_reports_no_response_at_all(client, decision_api):
    """У шага с очередью доставки ответа нет — и мы не притворяемся, что он был.

    Транспорт при этом назван честно: «ответа нет, потому что вебхук асинхронный»
    и «ответа нет, потому что отправка не настроена» — разные вещи.
    """
    queued = dict(CREDIT_SUBMIT)
    queued["steps"] = [
        CREDIT_SUBMIT["steps"][0],
        {
            **CREDIT_SUBMIT["steps"][1],
            "request": {
                "transport": "webhook",
                "webhookUrl": "http://backend:8000/api/mock/webhook",
                "delivery": "async",
            },
        },
    ]
    await _publish_credit_form(client, "flow_credit_async", submit=queued)
    first = await client.post(
        "/api/public/forms/flow_credit_async/submit",
        json={"data": {"amount": 200000, "income": 100000}},
    )
    assert first.json()["outcome"]["response"] == {"status": 200}
    second = await client.post(
        "/api/public/forms/flow_credit_async/submit",
        json={
            "data": {"passport": "4509 123456"},
            "step": "approved",
            "submissionId": first.json()["submissionId"],
            "flowToken": first.json()["flowToken"],
        },
    )
    assert second.status_code == 200, second.text
    outcome = second.json()["outcome"]
    assert outcome["transport"] == "webhook"
    assert "response" not in outcome


async def test_raw_response_is_hidden_unless_author_opts_in(client, decision_api):
    """Тело ответа скоринга не утекает в браузер по умолчанию — но статус уходит.

    Скрывать вместе с телом ещё и HTTP-статус нельзя: тогда успешный вызов
    внешней системы неотличим от «никуда не ходили», и встраивание выглядит
    сломанным ровно там, где всё сработало.
    """
    await _publish_credit_form(client, "flow_credit_private")
    r = await client.post(
        "/api/public/forms/flow_credit_private/submit",
        json={"data": {"amount": 200000, "income": 100000}},
    )
    outcome = r.json()["outcome"]
    assert outcome["transport"] == "rest"
    assert outcome["response"] == {"status": 200}
    assert "requestId" not in r.text

    opened = dict(CREDIT_SUBMIT)
    opened["steps"] = [
        {**CREDIT_SUBMIT["steps"][0], "request": {**CREDIT_SUBMIT["steps"][0]["request"], "exposeResponse": True}},
        CREDIT_SUBMIT["steps"][1],
    ]
    await _publish_credit_form(client, "flow_credit_open", submit=opened)
    r2 = await client.post(
        "/api/public/forms/flow_credit_open/submit",
        json={"data": {"amount": 200000, "income": 100000}},
    )
    assert r2.json()["outcome"]["response"]["body"]["decision"] == "approved"


async def test_flow_test_endpoint_traces_rules(client):
    pk = await _publish_credit_form(client, "flow_credit_test")
    r = await client.post(
        f"/api/forms/{pk}/flow/test",
        json={"status": 200, "response": {"decision": "approved", "approvedLimit": 300000}},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["matchedRuleId"] == "approved"
    assert body["outcome"]["kind"] == "fields"
    assert body["outcome"]["stepExists"] is True
    trace = {t["id"]: t["matched"] for t in body["trace"]}
    assert trace == {"declined": False, "approved": True}


async def test_flow_endpoint_normalizes_legacy_form(client):
    pk = await _publish_credit_form(
        client,
        "flow_legacy",
        submit={"webhookUrl": "http://backend:8000/api/mock/webhook", "successMessage": "Принято"},
        fields=[{"id": "a", "type": "text", "label": "A"}],
    )
    flow = (await client.get(f"/api/forms/{pk}/flow")).json()
    assert flow["steps"][0]["request"]["transport"] == "webhook"
    assert flow["steps"][0]["rules"][0]["then"]["text"] == "Принято"
    assert flow["steps"][0]["fieldIds"] == ["a"]


async def test_random_decision_mock_covers_all_three_branches(client):
    """Случайная ручка обязана уметь выдать каждый из трёх вердиктов.

    Проверяется и принудительный режим (иначе конкретную ветку не отладить),
    и то, что за разумное число бросков выпадают все три, — «случайная» ручка,
    застрявшая на одном ответе, бесполезнее детерминированной.
    """
    for verdict in ("approved", "declined", "manual"):
        r = await client.post(f"/api/mock/ext/decision-random?decision={verdict}", json={"data": {}})
        assert r.status_code == 200, r.text
        assert r.json()["decision"] == verdict

    seen = set()
    for _ in range(60):
        r = await client.post("/api/mock/ext/decision-random", json={"data": {}})
        seen.add(r.json()["decision"])
    assert seen == {"approved", "declined", "manual"}


async def test_random_decision_mock_limit_defaults_to_100(client):
    approved = await client.post("/api/mock/ext/decision-random?decision=approved", json={"data": {}})
    assert approved.json()["approvedLimit"] == 100
    custom = await client.post("/api/mock/ext/decision-random?decision=approved&limit=250000", json={"data": {}})
    assert custom.json()["approvedLimit"] == 250000
    # Ручная проверка тоже несёт сумму — правило может ветвиться и по ней.
    manual = await client.post("/api/mock/ext/decision-random?decision=manual&limit=500", json={"data": {}})
    assert manual.json()["approvedLimit"] == 500


async def test_random_decision_mock_matches_the_same_rules(client, decision_api):
    """Ответ совместим с правилами демо-формы: путь `decision`, сумма в `approvedLimit`."""
    submit = {
        "steps": [
            {
                "id": "main",
                "request": {
                    "transport": "rest",
                    "connectionId": "conn_decision",
                    "endpoint": "/decision-random?decision=approved&limit=100",
                    "method": "POST",
                    "payload": "data",
                },
                "rules": CREDIT_SUBMIT["steps"][0]["rules"],
            },
            CREDIT_SUBMIT["steps"][1],
        ]
    }
    await _publish_credit_form(client, "flow_credit_random", submit=submit)
    r = await client.post("/api/public/forms/flow_credit_random/submit", json={"data": {"amount": 1000}})
    assert r.status_code == 200, r.text
    outcome = r.json()["outcome"]
    assert outcome["kind"] == "fields"
    assert outcome["values"]["approved_limit"] == 100


async def test_endpoint_query_string_survives_the_request(client, decision_api):
    """Параметры из адреса шага доезжают до внешней системы.

    Регресс: httpx с аргументом `params=` затирает query из URL целиком, поэтому
    `/decision-random?limit=777` уходил без limit — молча, с виду успешно, и
    ловилось это только «мигающими» тестами.
    """
    submit = {
        "steps": [
            {
                "id": "main",
                "request": {
                    "transport": "rest",
                    "connectionId": "conn_decision",
                    "endpoint": "/decision-random?decision=manual&limit=777",
                    "method": "POST",
                    "payload": "data",
                    "exposeResponse": True,
                },
                "rules": [{"id": "any", "when": [], "then": {"kind": "message", "text": "ок"}}],
            }
        ]
    }
    await _publish_credit_form(client, "flow_credit_query", submit=submit)
    r = await client.post("/api/public/forms/flow_credit_query/submit", json={"data": {}})
    assert r.status_code == 200, r.text
    body = r.json()["outcome"]["response"]["body"]
    assert body["decision"] == "manual"      # ?decision= доехал
    assert body["approvedLimit"] == 777      # ?limit= доехал


async def test_seeded_credit_form_runs_end_to_end(client, decision_api):
    """Демо-форма из seed работает без единой правки — иначе это не демо."""
    r = await client.post(
        "/api/public/forms/credit_application/submit",
        json={"data": {"fio": "Иванов", "amount": 300000, "income": 90000}},
    )
    assert r.status_code == 200, r.text
    assert r.json()["outcome"]["kind"] == "fields"
