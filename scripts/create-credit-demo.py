#!/usr/bin/env python3
"""Завести демо-форму «Заявка на кредит» на УЖЕ РАБОТАЮЩЕМ стенде.

Сид (`app/seed.py`) наполняет базу ровно один раз — при создании аккаунта, —
поэтому на стенде, поднятом раньше, демо-формы флоу нет и не появится. Это
правильно: повторный сид затирал бы то, что вы успели настроить. Но посмотреть
готовый многошаговый пример хочется и там, и для этого есть этот скрипт.

Он делает то же, что сид, но через публичный API и поверх существующих данных:

    подключение к моку скоринга → форма с двумя шагами → публикация

Ничего не удаляет и не перезаписывает: если форма с таким form_id уже есть,
скрипт возьмёт следующий свободный (credit_demo_2 и т.д.).

    python3 scripts/create-credit-demo.py \
        --base http://localhost:8000 --email demo@sota.forms --password demo12345
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request

CONN_NAME = "Система принятия решения (mock)"

FIELDS = [
    # --- Шаг 1: заявка -----------------------------------------------------
    {"id": "h_app", "type": "section_header", "label": "Заявка на кредит", "step": "main"},
    {"id": "fio", "type": "text", "label": "ФИО", "gridSpan": 2, "required": True, "step": "main"},
    {"id": "phone", "type": "phone", "label": "Телефон", "gridSpan": 1, "required": True, "step": "main",
     "mask": {"preset": "phone", "regex": r"^\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}$"}},
    {"id": "birth_date", "type": "date", "label": "Дата рождения", "gridSpan": 1, "required": True, "step": "main"},
    {"id": "amount", "type": "amount", "label": "Запрашиваемая сумма, ₽", "gridSpan": 1, "required": True,
     "step": "main", "validation": {"min": 10000, "max": 5000000}},
    {"id": "income", "type": "amount", "label": "Ежемесячный доход, ₽", "gridSpan": 1, "required": True,
     "step": "main", "validation": {"min": 0}},

    # --- Шаг 2: добор данных после одобрения -------------------------------
    {"id": "h_approved", "type": "section_header", "label": "Осталось немного", "step": "approved"},
    {"id": "approved_limit", "type": "amount", "label": "Одобренная сумма, ₽", "gridSpan": 2,
     "step": "approved", "readOnly": True, "hint": "Подставлено из ответа системы принятия решения"},
    {"id": "passport", "type": "passport", "label": "Паспорт (серия и номер)", "gridSpan": 1,
     "required": True, "step": "approved"},
    {"id": "employer", "type": "text", "label": "Место работы", "gridSpan": 1, "required": True, "step": "approved"},
    {"id": "card_number", "type": "card", "label": "Карта для зачисления", "gridSpan": 2,
     "required": True, "step": "approved"},
]


def build_submit(connection_id: str, webhook_url: str) -> dict:
    return {
        "steps": [
            {
                "id": "main",
                "title": "Заявка",
                "button": {"text": "Узнать решение", "size": "large", "block": True},
                "request": {
                    "transport": "rest",
                    "connectionId": connection_id,
                    "endpoint": "/decision",
                    "method": "POST",
                    "payload": "data",
                    "exposeResponse": False,
                },
                "rules": [
                    {
                        "id": "declined",
                        "name": "Отказ",
                        "when": [{"source": "body", "path": "decision", "operator": "eq", "value": "declined"}],
                        "then": {"kind": "message", "messageType": "error", "title": "К сожалению, отказ",
                                 "text": "{{resp.reason}}. Заявка №{{resp.requestId}}."},
                    },
                    {
                        "id": "manual",
                        "name": "Ручная проверка",
                        "when": [{"source": "body", "path": "decision", "operator": "eq", "value": "manual"}],
                        "then": {"kind": "message", "messageType": "warning", "title": "Заявка ушла на проверку",
                                 "text": "Нужны документы: {{resp.requiredDocs}}. Мы позвоним по номеру {{phone}}."},
                    },
                    {
                        "id": "approved",
                        "name": "Одобрено → добрать данные",
                        "when": [{"source": "body", "path": "decision", "operator": "eq", "value": "approved"}],
                        "then": {"kind": "fields", "stepId": "approved",
                                 "fill": [{"fieldId": "approved_limit", "from": "resp.approvedLimit"}]},
                    },
                    {
                        "id": "unavailable",
                        "name": "Скоринг недоступен",
                        "when": [{"source": "error", "operator": "not_empty"}],
                        "then": {"kind": "message", "messageType": "warning", "title": "Решение пока недоступно",
                                 "text": "Мы приняли заявку и вернёмся с решением позже."},
                    },
                ],
            },
            {
                "id": "approved",
                "title": "Оформление",
                "description": "Кредит одобрен — заполните данные для зачисления.",
                "button": {"text": "Оформить кредит", "size": "large", "block": True},
                "request": {"transport": "webhook", "webhookUrl": webhook_url, "delivery": "async"},
                "rules": [
                    {"id": "done", "name": "Готово", "when": [],
                     "then": {"kind": "message", "messageType": "success", "title": "Кредит оформлен",
                              "text": "Деньги поступят на карту в течение дня."}},
                ],
            },
        ]
    }


class Api:
    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self.token: str | None = None

    def call(self, method: str, path: str, body: dict | None = None) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(f"{self.base}{path}", data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if self.token:
            req.add_header("Authorization", f"Bearer {self.token}")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read() or "{}")
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:400]
            raise SystemExit(f"!! {method} {path} → HTTP {e.code}: {detail}") from e
        except urllib.error.URLError as e:
            raise SystemExit(f"!! не достучаться до {self.base}: {e.reason}") from e


def main() -> None:
    p = argparse.ArgumentParser(description="Создать демо-форму «Заявка на кредит» на работающем стенде")
    p.add_argument("--base", default="http://localhost:8000", help="адрес backend (по умолчанию http://localhost:8000)")
    p.add_argument("--email", default="demo@sota.forms")
    p.add_argument("--password", default="demo12345")
    p.add_argument("--form-id", default="credit_demo", help="публичный ключ встраивания")
    p.add_argument("--mock-base", default="", help="база мока скоринга; пусто = <base>/api/mock/ext")
    args = p.parse_args()

    api = Api(args.base)
    mock_base = args.mock_base or f"{api.base}/api/mock/ext"
    webhook = f"{api.base}/api/mock/webhook"

    print(f"==> вход как {args.email}")
    api.token = api.call("POST", "/api/auth/login", {"email": args.email, "password": args.password})["token"]

    print("==> подключение к системе принятия решения")
    conns = api.call("GET", "/api/connections")
    # Ищем по ИМЕНИ, а не по base_url: у встроенного мока каталога товаров тот же
    # базовый адрес, и поиск по адресу молча угонял бы чужое подключение вместе
    # с его whitelist и авторизацией.
    conn = next((c for c in conns if c["name"] == CONN_NAME), None)
    if conn:
        print(f"    уже есть: {conn['id']} ({conn['base_url']})")
    else:
        conn = api.call("POST", "/api/connections", {
            "name": CONN_NAME,
            "base_url": mock_base,
            "auth_type": "none",
            "auth_config": {},
            # Префикс, а не точный путь: пускает и /decision, и /decision-random,
            # и любой из них со строкой запроса (?limit=100).
            "whitelist": ["^/decision"],
        })
        print(f"    создано: {conn['id']} ({conn['base_url']})")

    # Занятый form_id — не повод падать и не повод затирать чужую форму.
    existing = {f["form_id"] for f in api.call("GET", "/api/forms").get("items", [])}
    form_id, n = args.form_id, 1
    while form_id in existing:
        n += 1
        form_id = f"{args.form_id}_{n}"
    if form_id != args.form_id:
        print(f"    '{args.form_id}' занят, беру '{form_id}'")

    print(f"==> форма {form_id}")
    form = api.call("POST", "/api/forms", {
        "form_id": form_id,
        "title": "Заявка на кредит",
        "grid_columns": 2,
        "fields": FIELDS,
        "submit": build_submit(conn["id"], webhook),
    })

    print("==> публикация")
    published = api.call("POST", f"/api/forms/{form['id']}/publish", {"note": "create-credit-demo.py"})

    print()
    print(f"Готово. Форма опубликована, версия v{published['version']}.")
    print(f"  конструктор: /forms/{form['id']}")
    print(f"  form-id для встраивания: {form_id}")
    print(f'  <no-code-form form-id="{form_id}"></no-code-form>')


if __name__ == "__main__":
    sys.exit(main())
