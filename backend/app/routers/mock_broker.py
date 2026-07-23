"""Mock of the leasing-broker partner API (broker_api_v3).

Stands in for the real лизинговый брокер integration so the app can call these
methods without credentials. Responses mirror the OpenAPI examples and share one
coherent dataset (same UUIDs), so ids returned by one method resolve in another.

Auth is intentionally NOT enforced (unlike the real Bearer-token API) — this is a
local mock. Mounted under /api/mock/broker, keeping the original sub-paths, e.g.:
  GET  /api/mock/broker/api/v1/requests
  POST /api/mock/broker/api/v1/requests/from-lessor
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/mock/broker", tags=["mock-broker"])

# --- Coherent dataset (UUIDs from the spec examples) -------------------------
REQ_ID = "550e8400-e29b-41d4-a716-446655440001"
LO_ID = "660e8400-e29b-41d4-a716-446655440002"
OFR_ID = "770e8400-e29b-41d4-a716-446655440030"
RC_ID = "cc0e8400-e29b-41d4-a716-446655440040"
OFFER_ID = "990e8400-e29b-41d4-a716-446655440060"
NOW = "2026-04-20T10:00:00.000Z"

_DEALER = {"id": "aa0e8400-e29b-41d4-a716-446655440010", "name_short": "ООО «Дилер»"}
_DEALERSHIP = {
    "id": "dd0e8400-e29b-41d4-a716-446655440050",
    "name_short": "Салон Центральный", "city": "Москва", "region": "Москва",
}
_LO_TYPE = {"id": "bb0e8400-e29b-41d4-a716-446655440020", "name": "Легковой автомобиль"}
_LEASEHOLDER = {
    "name_short": "ООО «Клиент»", "name_full": "ООО «Клиент»",
    "inn": "7701234567", "ogrn": "1027700123456",
}


def _leasing_object(lo_id: str = LO_ID) -> dict:
    return {
        "id": lo_id, "status": "working", "leasing_object_type": _LO_TYPE,
        "brand": "Toyota", "model": "Camry", "trim_level": "Elegance", "used": False,
        "created_at": NOW, "updated_at": NOW,
    }


def _requested_condition(rc_id: str = RC_ID, status: str = "sent") -> dict:
    return {
        "id": rc_id, "name": "Базовый вариант дилера", "status": status,
        "total_cost": "3500000.00", "advance": "700000.00", "lease_term": 60,
        "dealer": _DEALER, "created_at": NOW, "updated_at": NOW,
    }


def _offer_request(ofr_id: str = OFR_ID, status: str = "sent") -> dict:
    return {
        "id": ofr_id, "status": status,
        "requested_condition": _requested_condition(),
        "created_at": NOW, "updated_at": NOW,
    }


def _offer(offer_id: str = OFFER_ID) -> dict:
    return {
        "id": offer_id, "status": "sent", "name": "КП основной (ответ ЛК)",
        "object_cost": "3500000.00", "total_cost": "3550000.00", "advance": "700000.00",
        "lease_term": 60, "manager_reward": "2.50", "payment_graph_type": "annuity",
        "files": [], "created_at": NOW, "updated_at": NOW,
    }


def _request_card(req_id: str = REQ_ID, direction: str = "outbound", seq: int = 1042,
                  leaseholder: dict | None = None) -> dict:
    return {
        "id": req_id, "status": "working", "lessor_seq_number": seq,
        "total_cost": "3500000.00", "direction": direction,
        "automatic_decision_status": "not_started", "leaseholder": leaseholder or _LEASEHOLDER,
        "dealer": _DEALER, "created_at": NOW, "updated_at": NOW,
        "leasing_objects": [], "contacts": [],
    }


# --- Stateful store: created requests persist and show up in list/get --------
# Seeded with an outbound demo (dealer-initiated) and an inbound demo (LK-initiated).
_INBOUND_ID = "551e8400-e29b-41d4-a716-44665544aa01"
_requests: dict[str, dict] = {
    REQ_ID: _request_card(REQ_ID, "outbound", 1042),
    _INBOUND_ID: _request_card(
        _INBOUND_ID, "inbound", 2077,
        {"name_short": "ООО «Ромашка»", "name_full": "ООО «Ромашка»",
         "inn": "7701234567", "ogrn": "1027700123456"},
    ),
}


# --- Discovery ---------------------------------------------------------------
@router.get("")
async def index():
    """List of mocked broker methods (for discovery)."""
    return {
        "service": "leasing-broker partner API (mock)",
        "base_path": "/api/mock/broker",
        "methods": [
            "POST /api/v1/requests/from-lessor",
            "POST /api/storage/uploads",
            "GET  /api/v1/leasing_objects/registry",
            "GET  /api/v1/requests",
            "GET  /api/v1/requests/{request_id}",
            "GET  /api/v1/requests/{request_id}/lessor_review",
            "GET  /api/v1/requests/{request_id}/leasing_objects",
            "GET  /api/v1/requests/{request_id}/leasing_objects/{leasing_object_id}",
            "GET  .../requested_conditions",
            "GET  .../requested_conditions/{id}",
            "PATCH .../requested_conditions/{id}/select",
            "GET  .../offer_requests",
            "GET  .../offer_requests/{offer_request_id}",
            "PATCH .../offer_requests/{offer_request_id}/decline",
            "POST .../offer_requests/{offer_request_id}/offers",
            "GET  .../offers/{offer_id}",
        ],
    }


# --- Requests ----------------------------------------------------------------
@router.post("/api/v1/requests/from-lessor")
async def create_request_from_lessor(request: Request):
    """Create an inbound request (LK-initiated) and persist it in the store."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    new_id = str(uuid.uuid4())
    lh = body.get("leaseholder") or _LEASEHOLDER
    card = _request_card(new_id, "inbound", 2000 + len(_requests), {
        "name_short": lh.get("name_short", "ООО «Клиент»"),
        "name_full": lh.get("name_full", lh.get("name_short", "ООО «Клиент»")),
        "inn": lh.get("inn", "7701234567"), "ogrn": lh.get("ogrn", "1027700123456"),
    })
    _requests[new_id] = card
    return JSONResponse(status_code=201, content={"data": {
        "request_id": new_id, "offer_request_id": OFR_ID, "leasing_object_ids": [LO_ID],
    }})


@router.get("/api/v1/requests")
async def list_requests(page: int = 1, limit: int = 50, direction: str = ""):
    rows = [r for r in _requests.values() if not direction or r["direction"] == direction]
    start = (page - 1) * limit
    return {"data": rows[start:start + limit], "meta": {"page": page, "limit": limit, "total": len(rows)}}


@router.get("/api/v1/requests/{request_id}")
async def get_request(request_id: str):
    return {"data": _requests.get(request_id) or _request_card(request_id)}


@router.get("/api/v1/requests/{request_id}/lessor_review")
async def lessor_review(request_id: str):
    card = _requests.get(request_id) or _request_card(request_id)
    return {"data": {
        "request": card,
        "leasing_objects": [{
            "leasing_object": _leasing_object(),
            "offer_request": _offer_request(),
            "requested_conditions": [],
        }],
    }}


# --- Leasing objects ---------------------------------------------------------
@router.get("/api/v1/leasing_objects/registry")
async def registry(page: int = 1, limit: int = 50):
    return {"data": [{
        "id": LO_ID, "dealer": _DEALER, "dealership": _DEALERSHIP,
        "leasing_object_type": _LO_TYPE, "status": "new",
        "brand": "Toyota", "model": "Camry", "trim_level": "Elegance", "used": False,
        "created_at": NOW, "updated_at": NOW,
    }], "meta": {"page": page, "limit": limit, "total": 128}}


@router.get("/api/v1/requests/{request_id}/leasing_objects")
async def list_leasing_objects(request_id: str):
    return {"data": [_leasing_object()]}


@router.get("/api/v1/requests/{request_id}/leasing_objects/{leasing_object_id}")
async def get_leasing_object(request_id: str, leasing_object_id: str):
    return {"data": _leasing_object(leasing_object_id)}


# --- Requested conditions (ответы дилеров) -----------------------------------
@router.get("/api/v1/requests/{request_id}/leasing_objects/{leasing_object_id}/requested_conditions")
async def list_requested_conditions(request_id: str, leasing_object_id: str):
    return {"data": [
        {**_requested_condition("cc0e8400-e29b-41d4-a716-446655440041", "received"),
         "name": "Вариант от дилера A", "total_cost": "3480000.00", "advance": "696000.00", "lease_term": 48},
        {**_requested_condition("cc0e8400-e29b-41d4-a716-446655440042", "received"),
         "name": "Вариант от дилера B", "total_cost": "3450000.00", "advance": "690000.00", "lease_term": 60,
         "dealer": {"id": "aa0e8400-e29b-41d4-a716-446655440011", "name_short": "ООО «Дилер Б»"}},
    ]}


@router.get("/api/v1/requests/{request_id}/leasing_objects/{leasing_object_id}/requested_conditions/{requested_condition_id}")
async def get_requested_condition(request_id: str, leasing_object_id: str, requested_condition_id: str):
    return {"data": _requested_condition(requested_condition_id, "received")}


@router.patch("/api/v1/requests/{request_id}/leasing_objects/{leasing_object_id}/requested_conditions/{requested_condition_id}/select")
async def select_requested_condition(request_id: str, leasing_object_id: str, requested_condition_id: str):
    rc = _requested_condition(requested_condition_id, "selected")
    return {"data": rc}


# --- Offer requests / offers -------------------------------------------------
@router.get("/api/v1/requests/{request_id}/leasing_objects/{leasing_object_id}/offer_requests")
async def list_offer_requests(request_id: str, leasing_object_id: str):
    return {"data": [_offer_request()]}


@router.get("/api/v1/requests/{request_id}/leasing_objects/{leasing_object_id}/offer_requests/{offer_request_id}")
async def get_offer_request(request_id: str, leasing_object_id: str, offer_request_id: str):
    return {"data": _offer_request(offer_request_id)}


@router.patch("/api/v1/requests/{request_id}/leasing_objects/{leasing_object_id}/offer_requests/{offer_request_id}/decline")
async def decline_offer_request(request_id: str, leasing_object_id: str, offer_request_id: str, request: Request):
    _ = await request.body()
    return {"data": {**_offer_request(offer_request_id, "declined")}}


@router.post("/api/v1/requests/{request_id}/leasing_objects/{leasing_object_id}/offer_requests/{offer_request_id}/offers")
async def create_offer(request_id: str, leasing_object_id: str, offer_request_id: str, request: Request):
    _ = await request.body()
    return JSONResponse(status_code=201, content={"data": _offer()})


@router.get("/api/v1/requests/{request_id}/leasing_objects/{leasing_object_id}/offer_requests/{offer_request_id}/offers/{offer_id}")
async def get_offer(request_id: str, leasing_object_id: str, offer_request_id: str, offer_id: str):
    return {"data": _offer(offer_id)}


# --- Storage -----------------------------------------------------------------
@router.post("/api/storage/uploads")
async def upload_blob(request: Request):
    _ = await request.body()
    return {"data": {
        "id": "880e8400-e29b-41d4-a716-446655440099",
        "signed_id": "eyJfcmFpbHMiOnsibWVzc2FnZSI6IkJBaHBB",
        "filename": "specification.pdf", "content_type": "application/pdf",
        "url": "https://storage.example.com/blobs/mock", "size": 245760,
        "created_at": "2026-04-20T12:00:00.000Z",
    }}
