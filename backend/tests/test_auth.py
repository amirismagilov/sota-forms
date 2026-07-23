"""Auth + multi-tenancy isolation (GRACE: security tier)."""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio


async def _register(client, email, password="secret123"):
    r = await client.post("/api/auth/register", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["token"]


async def test_register_login_me(client):
    token = await _register(client, "alice@example.com")
    me = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["email"] == "alice@example.com"
    assert me.json()["role"] == "owner"


async def test_login_wrong_password_rejected(client):
    await _register(client, "bob@example.com", "rightpass")
    bad = await client.post("/api/auth/login", json={"email": "bob@example.com", "password": "wrong"})
    assert bad.status_code == 401


async def test_admin_requires_auth(client):
    # Strip the demo token the fixture set.
    r = await client.get("/api/forms", headers={"Authorization": ""})
    assert r.status_code == 401


async def test_duplicate_email_rejected(client):
    await _register(client, "carol@example.com")
    dup = await client.post("/api/auth/register", json={"email": "carol@example.com", "password": "another1"})
    assert dup.status_code == 409


async def test_accounts_are_isolated(client):
    ta = await _register(client, "tenant-a@example.com")
    tb = await _register(client, "tenant-b@example.com")
    ha = {"Authorization": f"Bearer {ta}"}
    hb = {"Authorization": f"Bearer {tb}"}

    created = await client.post(
        "/api/forms",
        headers=ha,
        json={"form_id": "a_only_form", "title": "A", "fields": []},
    )
    assert created.status_code == 200
    pk = created.json()["id"]

    # B cannot see A's form in its list…
    b_list = await client.get("/api/forms", headers=hb)
    assert all(f["id"] != pk for f in b_list.json()["items"])
    # …nor read, update, or delete it.
    assert (await client.get(f"/api/forms/{pk}", headers=hb)).status_code == 404
    assert (await client.put(f"/api/forms/{pk}", headers=hb, json={"form_id": "x", "title": "x", "fields": []})).status_code == 404

    # A still sees it.
    a_list = await client.get("/api/forms", headers=ha)
    assert any(f["id"] == pk for f in a_list.json()["items"])


async def test_public_form_needs_no_auth(client):
    # The seeded public form renders without a token (widget path).
    r = await client.get("/api/public/forms/order_form", headers={"Authorization": ""})
    assert r.status_code == 200
    assert r.json()["title"]
