"""End-to-end tests for the Operaton import + task-completion wiring.

Real database (GRACE: infra tier) — skipped honestly when none is reachable.
The sota-bpmn side is never contacted: every test either uploads a schema or
asserts on how an unreachable engine is reported.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

pytestmark = pytest.mark.asyncio

FIXTURES = Path(__file__).parent / "fixtures" / "operaton"


def _schema(name: str = "form_obrashchenieKlienta_klassifikaciya") -> dict:
    return json.loads((FIXTURES / f"{name}.form").read_text(encoding="utf-8"))


async def _import(client, name: str = "form_obrashchenieKlienta_klassifikaciya", **extra):
    r = await client.post("/api/operaton/import", json={"schema": _schema(name), **extra})
    assert r.status_code == 200, r.text
    return r.json()


# ------------------------------------------------------------------ preview


async def test_preview_reports_without_persisting(client):
    before = (await client.get("/api/forms", params={"source": "operaton"})).json()["total"]

    r = await client.post("/api/operaton/preview", json={"schema": _schema()})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["form_id"] == "form_obrashchenie_klienta_klassifikaciya"
    assert len(body["fields"]) == 2
    assert body["report"]["warnings"] == []
    assert body["submit"]["webhookUrl"] == "{{bpmnBase}}/api/tasks/{{taskId}}/complete"

    after = (await client.get("/api/forms", params={"source": "operaton"})).json()["total"]
    assert after == before, "preview must not create anything"


async def test_malformed_schema_is_rejected_and_creates_nothing(client):
    before = (await client.get("/api/forms")).json()["total"]

    r = await client.post("/api/operaton/import", json={"schema": {"nope": 1}})
    assert r.status_code == 400
    assert "Оператона" in r.json()["detail"]

    after = (await client.get("/api/forms")).json()["total"]
    assert after == before


# ------------------------------------------------------------------- import


async def test_import_lands_in_the_operaton_section(client):
    created = await _import(client)
    assert created["source"] == "operaton"
    assert created["status"] == "draft"
    assert created["published_version"] is None
    meta = created["source_meta"]
    assert meta["operaton_form_id"] == "form_obrashchenieKlienta_klassifikaciya"
    assert meta["key_map"]["klassifikaciya_result"] == "klassifikaciya_result"

    from_operaton = (await client.get("/api/forms", params={"source": "operaton"})).json()
    assert created["id"] in {i["id"] for i in from_operaton["items"]}

    local = (await client.get("/api/forms", params={"source": "local"})).json()
    assert created["id"] not in {i["id"] for i in local["items"]}
    # The seeded demo form is local and must be untouched by the migration.
    assert any(i["form_id"] == "order_form" for i in local["items"])


async def test_source_filter_rejects_unknown_values(client):
    r = await client.get("/api/forms", params={"source": "whatever"})
    assert r.status_code == 400


async def test_list_trims_the_passport_but_keeps_the_key_facts(client):
    await _import(client)
    row = next(
        i for i in (await client.get("/api/forms", params={"source": "operaton"})).json()["items"]
        if i["source"] == "operaton"
    )
    assert row["source_meta"]["operaton_form_id"]
    assert "key_map" not in row["source_meta"], "the list must not carry the whole key map"


async def test_repeated_import_does_not_collide_on_the_slug(client):
    first = await _import(client)
    second = await _import(client)
    assert first["form_id"] != second["form_id"]
    assert second["form_id"].startswith(first["form_id"])


async def test_all_five_process_forms_import_cleanly(client):
    for path in sorted(FIXTURES.glob("*.form")):
        created = await _import(client, path.stem)
        assert created["source_meta"]["report"]["warnings"] == []
        assert created["source_meta"]["report"]["unsupported"] == []


# ----------------------------------------------------------------- editing


async def test_imported_form_is_editable_and_publishable(client):
    created = await _import(client)
    fields = created["fields"]
    fields[0]["label"] = "Решение по обращению"

    r = await client.put(
        f"/api/forms/{created['id']}",
        json={
            "form_id": created["form_id"], "title": "Классификация",
            "grid_columns": created["grid_columns"], "fields": fields, "submit": created["submit"],
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["source"] == "operaton", "editing must not turn the form local"
    assert r.json()["fields"][0]["label"] == "Решение по обращению"

    pub = await client.post(f"/api/forms/{created['id']}/publish", json={})
    assert pub.status_code == 200
    assert pub.json()["published_version"] == 1


async def test_dropping_a_process_variable_is_refused(client):
    created = await _import(client)
    body = {
        "form_id": created["form_id"], "title": created["title"],
        "grid_columns": created["grid_columns"], "submit": created["submit"],
        "fields": [f for f in created["fields"] if f["id"] != "klassifikaciya_result"],
    }
    r = await client.put(f"/api/forms/{created['id']}", json=body)
    assert r.status_code == 409
    assert "klassifikaciya_result" in r.json()["detail"]

    # ...and the escape hatch works when the change is deliberate.
    ok = await client.put(f"/api/forms/{created['id']}", json=body, params={"allow_key_changes": "true"})
    assert ok.status_code == 200


async def test_renaming_a_process_variable_is_refused(client):
    created = await _import(client)
    fields = created["fields"]
    fields[0]["id"] = "renamed_result"
    r = await client.put(
        f"/api/forms/{created['id']}",
        json={
            "form_id": created["form_id"], "title": created["title"],
            "grid_columns": created["grid_columns"], "fields": fields, "submit": created["submit"],
        },
    )
    assert r.status_code == 409


async def test_local_forms_are_not_subject_to_the_key_guard(client):
    created = (await client.post("/api/forms", json={
        "form_id": "plain_form", "title": "Обычная", "grid_columns": 2,
        "fields": [{"id": "a", "type": "text", "label": "A"}], "submit": {},
    })).json()
    r = await client.put(f"/api/forms/{created['id']}", json={
        "form_id": "plain_form", "title": "Обычная", "grid_columns": 2, "fields": [], "submit": {},
    })
    assert r.status_code == 200


# ------------------------------------------------------- resolver for the host


async def test_resolver_ignores_drafts_and_finds_published_forms(client):
    created = await _import(client)
    op_id = created["source_meta"]["operaton_form_id"]

    draft = await client.get(f"/api/public/forms/by-operaton/{op_id}")
    assert draft.status_code == 404, "a draft must never take over a live task"

    await client.post(f"/api/forms/{created['id']}/publish", json={})
    found = await client.get(f"/api/public/forms/by-operaton/{op_id}")
    assert found.status_code == 200
    assert found.json()["form_id"] == created["form_id"]
    assert found.json()["published_version"] == 1


async def test_resolver_404_for_unknown_operaton_id(client):
    r = await client.get("/api/public/forms/by-operaton/form_does_not_exist")
    assert r.status_code == 404


# -------------------------------------------------------------- submission


async def _published(client):
    created = await _import(client)
    await client.post(f"/api/forms/{created['id']}/publish", json={})
    return created


async def test_submit_without_task_id_is_refused_loudly(client):
    created = await _published(client)
    r = await client.post(
        f"/api/public/forms/{created['form_id']}/submit",
        json={"data": {"klassifikaciya_result": "back_office_required"}},
    )
    assert r.status_code == 400
    detail = r.json()["detail"]
    assert "taskId" in detail and "task-id" in detail


async def test_submit_with_task_id_reports_an_unreachable_engine(client):
    """The URL is built from the runtime context, and a dead engine surfaces as 502."""
    created = await _published(client)
    r = await client.post(
        f"/api/public/forms/{created['form_id']}/submit",
        json={
            "data": {"klassifikaciya_result": "back_office_required"},
            "context": {"taskId": "task-abc"},
        },
    )
    # Delivery is synchronous, so the caller learns immediately instead of being
    # told «Спасибо» while a retry loop fails in the background.
    assert r.status_code == 502, r.text

    board = (await client.get("/api/submissions/deliveries/board")).json()
    mine = [d for d in board if d["form_id"] == created["form_id"]]
    assert mine, "the attempt must still be visible on the deliveries board"
    assert "task-abc" in mine[0]["url"], "the runtime taskId must be substituted into the URL"


async def test_local_form_submission_is_unaffected(client):
    r = await client.post("/api/public/forms/order_form/submit", json={"data": {"f_name": "Иванов"}})
    assert r.status_code == 200
    assert r.json()["ok"] is True


# ----------------------------------------------------- integration status


async def test_status_reports_unreachable_instead_of_raising(client):
    r = await client.get("/api/operaton/status")
    assert r.status_code == 200
    assert r.json()["ok"] is False  # nothing is listening in the test env
