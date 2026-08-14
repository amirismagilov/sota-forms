"""Seed a rich demo account so the running stack shows a real form immediately."""

from __future__ import annotations

from sqlalchemy import select

from .auth import hash_password
from .config import get_settings
from .db import SessionLocal
from .deps import DEMO_TOKENS
from .models import Account, Connection, Dictionary, Form, FormVersion, User

DEMO_ACCOUNT_ID = "acc_demo"
DEMO_EMAIL = "demo@sota.forms"
DEMO_PASSWORD = "demo12345"
MOCK_WEBHOOK = get_settings().mock_webhook_url
MOCK_EXT_BASE = get_settings().mock_ext_base


async def seed_if_empty() -> None:
    async with SessionLocal() as db:
        acc = await db.get(Account, DEMO_ACCOUNT_ID)
        # Content is seeded EXACTLY ONCE — on first ever run (when the demo account
        # is created). After that we never re-seed, so deleting the demo form/dicts
        # (or editing connections) STICKS and is never silently recreated on restart.
        first_run = acc is None
        if first_run:
            acc = Account(
                id=DEMO_ACCOUNT_ID,
                name="Demo Account",
                design_tokens=DEMO_TOKENS,
                webhook_default=MOCK_WEBHOOK,
            )
            db.add(acc)
            await db.flush()

        # Demo login owning the demo account (ensured even on later runs).
        demo_user = (await db.execute(select(User).where(User.email == DEMO_EMAIL))).scalar_one_or_none()
        if demo_user is None:
            db.add(User(
                email=DEMO_EMAIL,
                password_hash=hash_password(DEMO_PASSWORD),
                account_id=DEMO_ACCOUNT_ID,
                role="owner",
            ))
            await db.commit()

        if not first_run:
            return  # already seeded once — respect the user's data, never recreate

        # --- Dictionaries -------------------------------------------------
        regions = Dictionary(
            id="dict_regions",
            account_id=DEMO_ACCOUNT_ID,
            code="regions",
            name="Регионы",
            type="manual",
            attrs=[],
            items=[
                {"code": "msk", "label": "Москва", "parentValue": "", "attrs": {}},
                {"code": "spb", "label": "Санкт-Петербург", "parentValue": "", "attrs": {}},
                {"code": "nsk", "label": "Новосибирск", "parentValue": "", "attrs": {}},
            ],
        )
        delivery = Dictionary(
            id="dict_delivery",
            account_id=DEMO_ACCOUNT_ID,
            code="delivery_types",
            name="Способ доставки",
            type="manual",
            dependencies=[{"fieldId": "f_region", "paramName": "region"}],
            attrs=[
                {"name": "cost", "label": "Стоимость", "type": "number"},
                {"name": "days", "label": "Срок (дней)", "type": "number"},
            ],
            items=[
                {"code": "courier_msk", "label": "Курьер по Москве", "parentValue": "msk", "attrs": {"cost": 500, "days": 1}},
                {"code": "pickup_msk", "label": "Самовывоз (Москва)", "parentValue": "msk", "attrs": {"cost": 0, "days": 1}},
                {"code": "courier_spb", "label": "Курьер по СПб", "parentValue": "spb", "attrs": {"cost": 450, "days": 2}},
                {"code": "post_spb", "label": "Почта России (СПб)", "parentValue": "spb", "attrs": {"cost": 300, "days": 5}},
                {"code": "post_nsk", "label": "Почта России (Новосибирск)", "parentValue": "nsk", "attrs": {"cost": 700, "days": 7}},
            ],
        )
        tariffs = Dictionary(
            id="dict_tariffs",
            account_id=DEMO_ACCOUNT_ID,
            code="tariffs",
            name="Тариф",
            type="manual",
            attrs=[{"name": "discount", "label": "Скидка %", "type": "number"}],
            items=[
                {"code": "standard", "label": "Стандарт", "parentValue": "", "attrs": {"discount": 0}},
                {"code": "silver", "label": "Серебряный (−5%)", "parentValue": "", "attrs": {"discount": 5}},
                {"code": "gold", "label": "Золотой (−10%)", "parentValue": "", "attrs": {"discount": 10}},
            ],
        )
        # API dictionary via the built-in mock external catalog API.
        catalog_conn = Connection(
            id="conn_catalog",
            account_id=DEMO_ACCOUNT_ID,
            name="Каталог (mock API)",
            base_url=MOCK_EXT_BASE,
            auth_type="none",
            auth_config={},
            whitelist=[],
        )
        # DaData suggestions — connection shell WITHOUT the secret. Structure is
        # restored on any reset; the user pastes their API key once.
        dadata_conn = Connection(
            id="conn_dadata",
            account_id=DEMO_ACCOUNT_ID,
            name="DaData Suggestions",
            base_url="https://suggestions.dadata.ru/suggestions/api/4_1/rs",
            auth_type="apikey_header",
            auth_config={"headerName": "Authorization"},
            whitelist=["^/suggest/.*"],
        )
        # Leasing-broker partner API (local mock).
        broker_conn = Connection(
            id="conn_broker",
            account_id=DEMO_ACCOUNT_ID,
            name="Брокер лизинга (mock)",
            base_url=MOCK_EXT_BASE.rsplit("/", 1)[0] + "/broker",
            auth_type="none",
            auth_config={},
            whitelist=["^/api/.*"],
        )
        products = Dictionary(
            id="dict_products",
            account_id=DEMO_ACCOUNT_ID,
            code="products",
            name="Товары (API)",
            type="api",
            attrs=[
                {"name": "price", "label": "Цена", "type": "number"},
                {"name": "stock", "label": "Остаток", "type": "number"},
            ],
            api_config={
                "connectionId": "conn_catalog",
                "urlMode": "single",
                "method": "GET",
                "endpoint": "/products",
                "params": "",
                "mapping": {
                    "path": "data",
                    "codeField": "sku",
                    "valueField": "title",
                    "attrs": {"price": "price", "stock": "stock"},
                },
                "refresh": "hourly",
            },
        )
        db.add_all([regions, delivery, tariffs, catalog_conn, dadata_conn, broker_conn, products])

        # --- Demo form ----------------------------------------------------
        fields = [
            {"id": "h_client", "type": "section_header", "label": "Клиент"},
            {"id": "f_name", "type": "text", "label": "ФИО / Название", "gridSpan": 2, "required": True,
             "placeholder": "Иванов Иван Иванович", "requiredMessage": "Укажите имя"},
            {"id": "f_phone", "type": "phone", "label": "Телефон", "gridSpan": 1, "required": True,
             "mask": {"preset": "phone", "regex": r"^\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}$"},
             "placeholder": "+7 (___) ___-__-__"},
            {"id": "f_email", "type": "email", "label": "Email", "gridSpan": 1,
             "tooltip": "На этот адрес придёт подтверждение"},
            {"id": "f_client_type", "type": "radio_group", "label": "Тип клиента", "gridSpan": 2,
             "options": [{"label": "Физлицо", "value": "person"}, {"label": "Компания", "value": "company"}],
             "required": True},
            {"id": "f_inn", "type": "inn", "label": "ИНН", "gridSpan": 1,
             "hint": "10 цифр для юрлица", "mask": {"preset": "inn", "regex": r"^\d{10}$"},
             "visibleIf": {"fieldId": "f_client_type", "operator": "eq", "value": "company"},
             "requiredIf": {"fieldId": "f_client_type", "operator": "eq", "value": "company"}},

            {"id": "h_order", "type": "section_header", "label": "Заказ"},
            {"id": "f_product", "type": "dict_select", "label": "Товар (из API-каталога)", "gridSpan": 2,
             "dictionaryId": "dict_products", "dictDisplay": "select", "showExtra": True,
             "hint": "Загружается с внешнего API через backend-proxy"},
            {"id": "f_region", "type": "dict_select", "label": "Регион", "gridSpan": 1, "required": True,
             "dictionaryId": "dict_regions", "dictDisplay": "select"},
            {"id": "f_delivery", "type": "dict_select", "label": "Доставка", "gridSpan": 1, "required": True,
             "dictionaryId": "dict_delivery", "dictDisplay": "select", "showExtra": True,
             "hint": "Список зависит от выбранного региона"},
            {"id": "f_tariff", "type": "dict_select", "label": "Тариф", "gridSpan": 2,
             "dictionaryId": "dict_tariffs", "dictDisplay": "radio", "showExtra": True},
            {"id": "f_price", "type": "number", "label": "Цена за единицу, ₽", "gridSpan": 1, "required": True,
             "validation": {"min": 0}},
            {"id": "f_qty", "type": "number", "label": "Количество", "gridSpan": 1, "required": True,
             "validation": {"min": 1}},
            {"id": "f_total", "type": "calculated", "label": "ИТОГО", "gridSpan": 2,
             "formula": "{{f_price}} * {{f_qty}} * (1 - {{f_tariff.discount}} / 100) + {{f_delivery.cost}}",
             "calcSuffix": " ₽", "calcDecimals": 2},

            {"id": "h_extra", "type": "section_header", "label": "Дополнительно"},
            {"id": "f_comment", "type": "textarea", "label": "Комментарий", "gridSpan": 2,
             "placeholder": "Пожелания к заказу"},
            {"id": "f_rating", "type": "rating", "label": "Оцените наш сервис", "gridSpan": 1},
            {"id": "f_agree", "type": "checkbox", "label": "Согласен с условиями обработки данных",
             "gridSpan": 2, "required": True, "requiredMessage": "Необходимо согласие"},
            {"id": "i_note", "type": "info_text", "label": "После отправки данные уходят на webhook клиента."},
        ]

        submit_cfg = {
            "webhookUrl": MOCK_WEBHOOK,
            "successMessage": "Спасибо! Заказ принят.",
            "redirectUrl": None,
        }
        form = Form(
            id="form_demo",
            account_id=DEMO_ACCOUNT_ID,
            form_id="order_form",
            title="Оформление заказа",
            grid_columns=2,
            fields=fields,
            submit=submit_cfg,
            status="published",
            version=1,
            published_version=1,
            has_draft_changes=False,
        )
        db.add(form)
        # Publish version 1 so the widget can render it immediately.
        db.add(FormVersion(
            form_pk="form_demo", version=1, title="Оформление заказа",
            grid_columns=2, fields=fields, submit=submit_cfg, note="Первая публикация",
        ))

        _seed_credit_flow(db)
        await db.commit()
        print("[seed] demo account, dictionaries, order_form and credit_application created", flush=True)


def _seed_credit_flow(db) -> None:
    """Форма-эталон многошагового флоу: заявка → решение → добор полей / отказ.

    Работает из коробки против встроенного мока системы принятия решения, так
    что «как это настраивается» можно не читать, а открыть и посмотреть.
    """
    decision_conn = Connection(
        id="conn_decision",
        account_id=DEMO_ACCOUNT_ID,
        name="Система принятия решения (mock)",
        base_url=MOCK_EXT_BASE,
        auth_type="none",
        auth_config={},
        # Префикс, а не точный путь: сюда попадают и `/decision`, и
        # `/decision-random`, и любой из них со строкой запроса
        # (`/decision-random?limit=100`) — иначе whitelist резал бы 403 ровно там,
        # где автор настраивает параметры ручки.
        whitelist=["^/decision"],
    )

    fields = [
        # --- Шаг 1: заявка -------------------------------------------------
        {"id": "h_app", "type": "section_header", "label": "Заявка на кредит", "step": "main"},
        {"id": "fio", "type": "text", "label": "ФИО", "gridSpan": 2, "required": True, "step": "main"},
        {"id": "phone", "type": "phone", "label": "Телефон", "gridSpan": 1, "required": True, "step": "main",
         "mask": {"preset": "phone", "regex": r"^\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}$"}},
        {"id": "birth_date", "type": "date", "label": "Дата рождения", "gridSpan": 1, "required": True, "step": "main"},
        {"id": "amount", "type": "amount", "label": "Запрашиваемая сумма, ₽", "gridSpan": 1, "required": True,
         "step": "main", "validation": {"min": 10000, "max": 5000000}},
        {"id": "income", "type": "amount", "label": "Ежемесячный доход, ₽", "gridSpan": 1, "required": True,
         "step": "main", "validation": {"min": 0}},

        # --- Шаг 2: добор данных после одобрения ---------------------------
        {"id": "h_approved", "type": "section_header", "label": "Осталось немного", "step": "approved"},
        {"id": "approved_limit", "type": "amount", "label": "Одобренная сумма, ₽", "gridSpan": 2,
         "step": "approved", "readOnly": True,
         "hint": "Подставлено из ответа системы принятия решения"},
        {"id": "passport", "type": "passport", "label": "Паспорт (серия и номер)", "gridSpan": 1,
         "required": True, "step": "approved"},
        {"id": "employer", "type": "text", "label": "Место работы", "gridSpan": 1, "required": True, "step": "approved"},
        {"id": "card_number", "type": "card", "label": "Карта для зачисления", "gridSpan": 2,
         "required": True, "step": "approved"},
    ]

    submit_cfg = {
        "steps": [
            {
                "id": "main",
                "title": "Заявка",
                "button": {"text": "Узнать решение", "size": "large", "block": True},
                "request": {
                    "transport": "rest",
                    "connectionId": "conn_decision",
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
                        "then": {
                            "kind": "message",
                            "messageType": "error",
                            "title": "К сожалению, отказ",
                            "text": "{{resp.reason}}. Заявка №{{resp.requestId}}.",
                        },
                    },
                    {
                        "id": "manual",
                        "name": "Ручная проверка",
                        "when": [{"source": "body", "path": "decision", "operator": "eq", "value": "manual"}],
                        "then": {
                            "kind": "message",
                            "messageType": "warning",
                            "title": "Заявка ушла на проверку",
                            "text": "Нужны документы: {{resp.requiredDocs}}. Мы позвоним по номеру {{phone}}.",
                        },
                    },
                    {
                        "id": "approved",
                        "name": "Одобрено → добрать данные",
                        "when": [{"source": "body", "path": "decision", "operator": "eq", "value": "approved"}],
                        "then": {
                            "kind": "fields",
                            "stepId": "approved",
                            "fill": [{"fieldId": "approved_limit", "from": "resp.approvedLimit"}],
                        },
                    },
                    {
                        "id": "unavailable",
                        "name": "Скоринг недоступен",
                        "when": [{"source": "error", "operator": "not_empty"}],
                        "then": {
                            "kind": "message",
                            "messageType": "warning",
                            "title": "Решение пока недоступно",
                            "text": "Мы приняли заявку и вернёмся с решением позже.",
                        },
                    },
                ],
            },
            {
                "id": "approved",
                "title": "Оформление",
                "description": "Кредит одобрен — заполните данные для зачисления.",
                "button": {"text": "Оформить кредит", "size": "large", "block": True},
                "request": {"transport": "webhook", "webhookUrl": MOCK_WEBHOOK, "delivery": "async"},
                "rules": [
                    {
                        "id": "done",
                        "name": "Готово",
                        "when": [],
                        "then": {
                            "kind": "message",
                            "messageType": "success",
                            "title": "Кредит оформлен",
                            "text": "Деньги поступят на карту в течение дня.",
                        },
                    },
                ],
            },
        ],
    }

    credit = Form(
        id="form_credit",
        account_id=DEMO_ACCOUNT_ID,
        form_id="credit_application",
        title="Заявка на кредит",
        grid_columns=2,
        fields=fields,
        submit=submit_cfg,
        status="published",
        version=1,
        published_version=1,
        has_draft_changes=False,
    )
    db.add_all([
        decision_conn,
        credit,
        FormVersion(
            form_pk="form_credit", version=1, title="Заявка на кредит",
            grid_columns=2, fields=fields, submit=submit_cfg, note="Первая публикация",
        ),
    ])
