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
