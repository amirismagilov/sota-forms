"""End-to-end API tests against a real database (GRACE: infra tier).

These exercise the actual FastAPI app + Postgres — no mocked DB layer.
Skipped honestly when no database is reachable.
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio


async def test_health(client):
    r = await client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


async def test_seeded_public_form_has_schema_and_tokens(client):
    r = await client.get("/api/public/forms/order_form")
    assert r.status_code == 200
    body = r.json()
    assert body["title"] == "Оформление заказа"
    assert body["design_tokens"]["token"]["colorPrimary"]  # tokens delivered
    field_ids = {f["id"] for f in body["fields"]}
    assert {"f_total", "f_region", "f_delivery"} <= field_ids
    # Referenced dictionaries are bundled for the widget.
    dict_ids = {d["id"] for d in body["dictionaries"]}
    assert {"dict_regions", "dict_delivery"} <= dict_ids


async def test_submit_creates_retrievable_submission(client):
    payload = {"data": {"f_name": "Иванов", "f_total": 2500, "f_agree": True}}
    r = await client.post("/api/public/forms/order_form/submit", json=payload)
    assert r.status_code == 200
    sub_id = r.json()["submissionId"]

    got = await client.get(f"/api/submissions/{sub_id}")
    assert got.status_code == 200
    body = got.json()
    assert body["data"]["f_name"] == "Иванов"
    assert body["form_id"] == "order_form"


async def test_submit_enqueues_webhook_delivery(client):
    r = await client.post("/api/public/forms/order_form/submit", json={"data": {"x": 1}})
    sub_id = r.json()["submissionId"]
    board = await client.get("/api/submissions/deliveries/board")
    assert board.status_code == 200
    deliveries = board.json()
    assert any(d["submission_id"] == sub_id for d in deliveries)


async def test_connection_secret_never_returned_in_cleartext(client):
    r = await client.post(
        "/api/connections",
        json={
            "name": "DaData",
            "base_url": "https://suggestions.dadata.ru",
            "auth_type": "apikey_header",
            "auth_config": {"headerName": "Authorization", "token": "SUPER_SECRET_TOKEN"},
            "whitelist": ["^/suggest/.*$"],
        },
    )
    assert r.status_code == 200
    assert r.json()["auth_config"]["token"] == "__set__"

    listing = await client.get("/api/connections")
    assert "SUPER_SECRET_TOKEN" not in listing.text


async def test_file_upload_and_retrieve(client):
    files = {"file": ("hello.txt", b"hello world", "text/plain")}
    up = await client.post("/api/public/files", files=files)
    assert up.status_code == 200
    body = up.json()
    assert body["size"] == 11 and body["filename"] == "hello.txt"
    got = await client.get(body["url"])
    assert got.status_code == 200
    assert got.content == b"hello world"


async def test_export_import_roundtrip(client):
    export = await client.get("/api/forms/form_demo/export")
    schema = export.json()
    imported = await client.post("/api/forms/import", json=schema)
    assert imported.status_code == 200
    body = imported.json()
    # Slug collides with the original, so it is suffixed, not overwritten.
    assert body["form_id"] != schema["form_id"]
    assert len(body["fields"]) == len(schema["fields"])


async def test_manual_dictionary_options_endpoint(client):
    # order_form references dict_regions (manual) — options come straight back.
    r = await client.post("/api/public/dictionaries/dict_regions/options", json={"values": {}})
    assert r.status_code == 200
    codes = {i["code"] for i in r.json()["items"]}
    assert {"msk", "spb", "nsk"} <= codes


async def test_form_crud_roundtrip(client):
    created = await client.post(
        "/api/forms",
        json={"form_id": "contact", "title": "Contact", "fields": [{"id": "f1", "type": "text", "label": "Name"}]},
    )
    assert created.status_code == 200
    pk = created.json()["id"]

    updated = await client.put(
        f"/api/forms/{pk}",
        json={"form_id": "contact", "title": "Contact v2", "fields": []},
    )
    assert updated.json()["version"] == 2

    export = await client.get(f"/api/forms/{pk}/export")
    assert export.json()["title"] == "Contact v2"

    await client.delete(f"/api/forms/{pk}")
    gone = await client.get(f"/api/forms/{pk}")
    assert gone.status_code == 404
