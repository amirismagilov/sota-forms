"""Unit tests for the `api_check` resolver (GRACE: pragmatic core tier).

No database and no network: `run_proxy_request` is stubbed, so these exercise the
templating and response-narrowing rules that decide what a condition can read.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app import checks


@pytest.fixture
def captured(monkeypatch):
    """Capture the outgoing call instead of performing it."""
    calls: list[dict] = []
    response: dict = {"box": {"decision": "need_docs", "limit": 500000}}

    async def _fake(db, connection_id, endpoint, method="GET", params=None):
        calls.append({"connection_id": connection_id, "endpoint": endpoint, "method": method, "params": params})
        return response

    monkeypatch.setattr(checks, "run_proxy_request", _fake)
    return {"calls": calls, "set": lambda r: response.update(r) or response}


CFG = {"connectionId": "conn_1", "method": "POST", "endpoint": "/decision"}


@pytest.mark.asyncio
async def test_field_values_are_substituted_into_the_request(captured):
    cfg = {**CFG, "body": '{"inn": "{{f_inn}}", "amount": {{f_amount}}}'}

    await checks.run_check(None, cfg, {"f_inn": "7707083893", "f_amount": 250000})

    sent = captured["calls"][0]
    assert sent["connection_id"] == "conn_1"
    assert sent["endpoint"] == "/decision"
    assert sent["method"] == "POST"
    assert sent["params"] == {"inn": "7707083893", "amount": 250000}


@pytest.mark.asyncio
async def test_path_narrows_the_answer_so_conditions_stay_short(captured):
    res = await checks.run_check(None, {**CFG, "body": "{}", "path": "box"}, {})
    # Условие пишется как check.decision, а не check.box.decision.
    assert res == {"ok": True, "data": {"decision": "need_docs", "limit": 500000}}


@pytest.mark.asyncio
async def test_without_path_the_whole_response_is_available(captured):
    res = await checks.run_check(None, {**CFG, "body": "{}"}, {})
    assert res["data"]["box"]["decision"] == "need_docs"


@pytest.mark.asyncio
async def test_scalar_answer_is_still_addressable(captured, monkeypatch):
    async def _scalar(db, connection_id, endpoint, method="GET", params=None):
        return {"verdict": "ok"}

    monkeypatch.setattr(checks, "run_proxy_request", _scalar)
    res = await checks.run_check(None, {**CFG, "body": "{}", "path": "verdict"}, {})
    # A bare string would be unreachable by a dot-path condition, so it is wrapped.
    assert res["data"] == {"value": "ok"}


@pytest.mark.asyncio
async def test_missing_path_yields_an_empty_object_not_a_crash(captured):
    res = await checks.run_check(None, {**CFG, "body": "{}", "path": "nope.deeper"}, {})
    assert res["data"] == {}


@pytest.mark.asyncio
async def test_a_connection_is_required(captured):
    with pytest.raises(HTTPException) as exc:
        await checks.run_check(None, {"endpoint": "/x"}, {})
    assert exc.value.status_code == 400
    assert "подключение" in exc.value.detail


@pytest.mark.asyncio
async def test_broken_template_is_reported_as_a_config_error(captured):
    # An unquoted substitution producing invalid JSON is the author's mistake,
    # so it must read as 400 with the reason, not blow up as a 500.
    cfg = {**CFG, "body": '{"inn": {{f_inn}}}'}
    with pytest.raises(HTTPException) as exc:
        await checks.run_check(None, cfg, {"f_inn": "abc"})
    assert exc.value.status_code == 400
    assert "JSON" in exc.value.detail


@pytest.mark.asyncio
async def test_empty_field_substitutes_to_empty_string(captured):
    cfg = {**CFG, "body": '{"inn": "{{f_inn}}"}'}
    await checks.run_check(None, cfg, {})
    assert captured["calls"][0]["params"] == {"inn": ""}


@pytest.mark.asyncio
async def test_get_uses_params_template_as_query(captured):
    cfg = {"connectionId": "conn_1", "method": "GET", "endpoint": "/limit", "params": '{"inn": "{{f_inn}}"}'}
    await checks.run_check(None, cfg, {"f_inn": "123"})
    sent = captured["calls"][0]
    assert sent["method"] == "GET"
    assert sent["params"] == {"inn": "123"}
