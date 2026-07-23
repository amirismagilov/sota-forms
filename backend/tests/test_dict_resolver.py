"""Unit tests for the API-dictionary resolver (mapping, substitution, smart URL).

No network: the outbound call is monkeypatched so we test our own logic — path
digging, {{field}} substitution, and smart-URL selection — deterministically.
"""

from __future__ import annotations

import pytest

from app import dict_resolver
from app.dict_resolver import _substitute, apply_mapping
from app.models import Dictionary


def test_apply_mapping_basic():
    raw = {"data": [{"id": "a", "name": "Alpha", "price": 10}, {"id": "b", "name": "Beta", "price": 20}]}
    mapping = {"path": "data", "codeField": "id", "valueField": "name", "attrs": {"price": "price"}}
    items = apply_mapping(raw, mapping)
    assert items == [
        {"code": "a", "label": "Alpha", "attrs": {"price": 10}},
        {"code": "b", "label": "Beta", "attrs": {"price": 20}},
    ]


def test_apply_mapping_nested_path_and_missing():
    raw = {"result": {"list": [{"code": "x", "title": "X"}]}}
    mapping = {"path": "result.list", "codeField": "code", "valueField": "title"}
    items = apply_mapping(raw, mapping)
    assert items[0]["code"] == "x" and items[0]["label"] == "X"
    # A path that doesn't resolve to a list yields no items (not an error).
    assert apply_mapping(raw, {"path": "nope", "codeField": "c", "valueField": "t"}) == []


def test_substitute_placeholders():
    assert _substitute("/branches/{{f_region}}", {"f_region": "msk"}) == "/branches/msk"
    assert _substitute('{"region": "{{f_region}}"}', {"f_region": "spb"}) == '{"region": "spb"}'
    assert _substitute("/x", {}) == "/x"


@pytest.mark.asyncio
async def test_resolve_single_url_substitutes_params(monkeypatch):
    captured = {}

    async def fake_proxy(db, connection_id, endpoint, method="GET", params=None):
        captured.update(endpoint=endpoint, method=method, params=params)
        return {"data": [{"id": "1", "name": "One"}]}

    monkeypatch.setattr(dict_resolver, "run_proxy_request", fake_proxy)
    d = Dictionary(
        id="d1", account_id="acc", code="c", name="n", type="api",
        dependencies=[{"fieldId": "f_region", "paramName": "region"}],
        api_config={
            "connectionId": "conn", "urlMode": "single", "method": "GET", "endpoint": "/cities",
            "params": '{"region": "{{f_region}}"}',
            "mapping": {"path": "data", "codeField": "id", "valueField": "name"},
            "refresh": "manual",
        },
    )
    items = await dict_resolver.resolve_api_dictionary(None, d, {"f_region": "msk"})
    assert captured["params"] == {"region": "msk"}
    assert items == [{"code": "1", "label": "One", "attrs": {"id": "1", "name": "One"}}]


@pytest.mark.asyncio
async def test_resolve_smart_url_picks_endpoint_by_parent(monkeypatch):
    captured = {}

    async def fake_proxy(db, connection_id, endpoint, method="GET", params=None):
        captured.update(endpoint=endpoint)
        return {"items": [{"code": "b1", "name": "Branch"}]}

    monkeypatch.setattr(dict_resolver, "run_proxy_request", fake_proxy)
    d = Dictionary(
        id="d2", account_id="acc", code="c", name="n", type="api",
        dependencies=[{"fieldId": "f_region", "paramName": "region"}],
        api_config={
            "connectionId": "conn", "urlMode": "smart",
            "urlMap": [
                {"parentValue": "msk", "method": "GET", "endpoint": "/branches/msk"},
                {"parentValue": "spb", "method": "GET", "endpoint": "/branches/spb"},
            ],
            "mapping": {"path": "items", "codeField": "code", "valueField": "name"},
            "refresh": "manual",
        },
    )
    await dict_resolver.resolve_api_dictionary(None, d, {"f_region": "spb"})
    assert captured["endpoint"] == "/branches/spb"
