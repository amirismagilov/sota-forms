from __future__ import annotations

from fastapi import APIRouter, Request

router = APIRouter(prefix="/api/mock", tags=["mock"])

_received: list[dict] = []


@router.post("/webhook")
async def mock_webhook(request: Request):
    """A stand-in client webhook so the demo shows end-to-end delivery."""
    body = await request.json()
    signature = request.headers.get("X-Signature", "")
    _received.append({"signature": signature, "body": body})
    if len(_received) > 200:
        del _received[: len(_received) - 200]
    return {"received": True}


@router.get("/webhook/received")
async def received():
    return list(reversed(_received))


# --- Mock external API (stands in for a real 3rd-party service) --------------
# Lets the demo exercise API dictionaries (single + smart URL, mapping, attrs,
# cascades) end-to-end without external credentials.

_PRODUCTS = [
    {"sku": "SKU-100", "title": "Ноутбук Pro 14", "price": 129990, "stock": 12},
    {"sku": "SKU-200", "title": "Смартфон X", "price": 74990, "stock": 40},
    {"sku": "SKU-300", "title": "Наушники Air", "price": 15990, "stock": 130},
]
_BRANCHES = {
    "msk": [{"id": "b1", "name": "Москва, Тверская 1"}, {"id": "b2", "name": "Москва, Арбат 10"}],
    "spb": [{"id": "b3", "name": "СПб, Невский 20"}],
    "nsk": [{"id": "b4", "name": "Новосибирск, Ленина 5"}],
}


# Stand-in "users directory": фильтрация по роли и другим параметрам.
_USERS = [
    {"id": "u1", "name": "Иванов Иван", "email": "ivanov@company.ru", "role": "manager", "department": "Продажи", "active": True},
    {"id": "u2", "name": "Петрова Мария", "email": "petrova@company.ru", "role": "manager", "department": "Продажи", "active": True},
    {"id": "u3", "name": "Сидоров Пётр", "email": "sidorov@company.ru", "role": "senior_manager", "department": "Продажи", "active": True},
    {"id": "u4", "name": "Кузнецова Анна", "email": "kuznecova@company.ru", "role": "manager", "department": "Лизинг", "active": True},
    {"id": "u5", "name": "Смирнов Алексей", "email": "smirnov@company.ru", "role": "admin", "department": "Администрация", "active": True},
    {"id": "u6", "name": "Волкова Ольга", "email": "volkova@company.ru", "role": "manager", "department": "Лизинг", "active": False},
    {"id": "u7", "name": "Козлов Дмитрий", "email": "kozlov@company.ru", "role": "manager", "department": "Продажи", "active": True},
    {"id": "u8", "name": "Новикова Елена", "email": "novikova@company.ru", "role": "manager", "department": "Лизинг", "active": True},
    {"id": "u9", "name": "Морозов Артём", "email": "morozov@company.ru", "role": "manager", "department": "Продажи", "active": True},
    {"id": "u10", "name": "Лебедева Светлана", "email": "lebedeva@company.ru", "role": "manager", "department": "Лизинг", "active": True},
]


@router.get("/ext/users")
async def ext_users(role: str = "", department: str = "", q: str = "", active: bool | None = None):
    """Users directory with filters: ?role=manager&department=Продажи&q=ив&active=true."""
    rows = _USERS
    if role:
        rows = [u for u in rows if u["role"] == role]
    if department:
        rows = [u for u in rows if u["department"] == department]
    if active is not None:
        rows = [u for u in rows if u["active"] is active]
    if q:
        rows = [u for u in rows if q.lower() in u["name"].lower()]
    return {"data": rows}


@router.get("/ext/products")
async def ext_products():
    """Single-URL source with attributes (price/stock) for mapping."""
    return {"data": _PRODUCTS}


@router.get("/ext/branches")
async def ext_branches(region: str = ""):
    """Cascade source: filtered by {{f_region}} passed as a query param."""
    return {"items": _BRANCHES.get(region, [])}


@router.get("/ext/branches/{region}")
async def ext_branches_smart(region: str):
    """Smart-URL source: region encoded in the path instead of a param."""
    return {"items": _BRANCHES.get(region, [])}


# --- Mock decision engine ----------------------------------------------------
# Стенд для флоу «заявка → система принятия решения → добор полей / отказ».
# Решение детерминировано (зависит только от суммы и дохода), поэтому демо и
# тесты воспроизводимы, а не «как повезёт».


@router.post("/ext/decision")
async def ext_decision(body: dict):
    """Скоринг заявки: approved / manual / declined.

    - доход не указан или сумма больше 12 доходов → declined;
    - сумма больше 500 000 → manual (нужны доп. документы);
    - иначе approved с лимитом, кратным 10 000.
    """
    data = (body or {}).get("data") or body or {}

    def _num(key: str) -> float:
        try:
            return float(str(data.get(key, "") or 0).replace(" ", "").replace(",", "."))
        except (TypeError, ValueError):
            return 0.0

    amount = _num("amount") or _num("f_amount")
    income = _num("income") or _num("f_income")
    request_id = "REQ-" + str(abs(hash((amount, income))) % 900000 + 100000)

    if income <= 0 or amount > income * 12:
        return {
            "requestId": request_id,
            "decision": "declined",
            "reason": "Запрошенная сумма несопоставима с подтверждённым доходом",
        }
    if amount > 500000:
        return {
            "requestId": request_id,
            "decision": "manual",
            "approvedLimit": 500000,
            "reason": "Нужны дополнительные документы",
            "requiredDocs": ["Справка о доходах", "Копия трудовой книжки"],
        }
    limit = min(amount, round(income * 10 / 10000) * 10000)
    return {
        "requestId": request_id,
        "decision": "approved",
        "approvedLimit": limit,
        "rate": 17.9,
        "offerValidDays": 5,
    }
