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
