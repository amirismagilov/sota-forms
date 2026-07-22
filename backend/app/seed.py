"""Seed a rich demo account so the running stack shows a real form immediately."""

from __future__ import annotations

from sqlalchemy import select

from .config import get_settings
from .db import SessionLocal
from .deps import DEMO_TOKENS
from .models import Account, Dictionary, Form

DEMO_ACCOUNT_ID = "acc_demo"
MOCK_WEBHOOK = get_settings().mock_webhook_url


async def seed_if_empty() -> None:
    async with SessionLocal() as db:
        acc = await db.get(Account, DEMO_ACCOUNT_ID)
        if acc is None:
            acc = Account(
                id=DEMO_ACCOUNT_ID,
                name="Demo Account",
                design_tokens=DEMO_TOKENS,
                webhook_default=MOCK_WEBHOOK,
            )
            db.add(acc)
            await db.flush()

        existing_forms = (
            await db.execute(select(Form).where(Form.account_id == DEMO_ACCOUNT_ID))
        ).scalars().first()
        if existing_forms:
            return  # already seeded

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
        db.add_all([regions, delivery, tariffs])

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

        form = Form(
            id="form_demo",
            account_id=DEMO_ACCOUNT_ID,
            form_id="order_form",
            title="Оформление заказа",
            grid_columns=2,
            fields=fields,
            submit={
                "webhookUrl": MOCK_WEBHOOK,
                "successMessage": "Спасибо! Заказ принят.",
                "redirectUrl": None,
            },
        )
        db.add(form)
        await db.commit()
        print("[seed] demo account, dictionaries and order_form created", flush=True)
