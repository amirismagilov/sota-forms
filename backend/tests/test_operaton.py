"""Unit tests for the Operaton form-js converter (GRACE: pragmatic core tier).

No database, no network — `convert_operaton_form` is pure, so these run everywhere.
The five `.form` files under `fixtures/operaton/` are the real forms of the
«Обращение клиента» process and act as the acceptance set.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.operaton import (
    OperatonSchemaError,
    convert_operaton_form,
    humanize_title,
    operaton_submit_config,
    parse_hide_condition,
    resolve_placeholders,
    sanitize_key,
    slugify_form_id,
)

FIXTURES = Path(__file__).parent / "fixtures" / "operaton"


def _schema(**components) -> dict:
    return {"type": "default", "id": "form_test", "schemaVersion": 16, "components": list(components["items"])}


# ---------------------------------------------------------------- real forms


@pytest.mark.parametrize("path", sorted(FIXTURES.glob("*.form")), ids=lambda p: p.stem)
def test_real_process_forms_convert_without_loss(path: Path):
    """Every form of «Обращение клиента» converts with no warnings and nothing dropped."""
    res = convert_operaton_form(json.loads(path.read_text(encoding="utf-8")))

    assert res.warnings == [], f"unexpected warnings: {res.warnings}"
    assert res.unsupported == [], f"unexpected unsupported: {res.unsupported}"
    assert len(res.fields) == res.components_total == 2

    select_field, comment_field = res.fields
    assert select_field["type"] == "select_static"
    assert select_field["required"] is True
    assert len(select_field["options"]) >= 1
    assert comment_field["type"] == "textarea"
    assert "required" not in comment_field

    # Keys are already clean, so the map is the identity — the process variables
    # keep their names and the gateways downstream still find them.
    assert res.key_map == {f["id"]: f["id"] for f in res.fields}


def test_real_form_layout_is_a_single_column_stack():
    """These schemas carry no layout, so fields must stack full-width, as in Operaton."""
    res = convert_operaton_form(
        json.loads((FIXTURES / "form_obrashchenieKlienta_klassifikaciya.form").read_text(encoding="utf-8"))
    )
    assert res.grid_columns == 1
    assert [f["layout"]["w"] for f in res.fields] == [1, 1]
    assert [f["layout"]["y"] for f in res.fields] == [0, 1]
    # textarea is rendered two rows tall
    assert res.fields[1]["layout"]["h"] == 2


def test_real_form_slug_and_title_are_readable():
    res = convert_operaton_form(
        json.loads((FIXTURES / "form_obrashchenieKlienta_pervayaLiniya.form").read_text(encoding="utf-8"))
    )
    assert res.form_id == "form_obrashchenie_klienta_pervaya_liniya"
    assert res.operaton_form_id == "form_obrashchenieKlienta_pervayaLiniya"
    assert res.schema_version == 16


# ------------------------------------------------------------------ mapping


@pytest.mark.parametrize(
    "component,expected",
    [
        ({"type": "textfield", "key": "a"}, "text"),
        ({"type": "textfield", "key": "a", "validate": {"validationType": "email"}}, "email"),
        ({"type": "textfield", "key": "a", "validate": {"validationType": "phone"}}, "phone"),
        ({"type": "textarea", "key": "a"}, "textarea"),
        ({"type": "number", "key": "a"}, "number"),
        ({"type": "checkbox", "key": "a"}, "checkbox"),
        ({"type": "radio", "key": "a", "values": [{"label": "L", "value": "v"}]}, "radio_group"),
        ({"type": "select", "key": "a", "values": [{"label": "L", "value": "v"}]}, "select_static"),
        ({"type": "select", "key": "a", "multiple": True, "values": [{"label": "L", "value": "v"}]}, "checkbox_group"),
        ({"type": "checklist", "key": "a", "values": [{"label": "L", "value": "v"}]}, "checkbox_group"),
        ({"type": "taglist", "key": "a", "values": [{"label": "L", "value": "v"}]}, "checkbox_group"),
        ({"type": "datetime", "key": "a", "subtype": "date"}, "date"),
        ({"type": "datetime", "key": "a", "subtype": "time"}, "time"),
        ({"type": "datetime", "key": "a", "subtype": "datetime"}, "datetime"),
        ({"type": "filepicker", "key": "a"}, "file"),
        ({"type": "separator"}, "divider"),
        ({"type": "text", "text": "hi"}, "info_text"),
    ],
)
def test_component_type_mapping(component, expected):
    res = convert_operaton_form(_schema(items=[component]))
    assert res.fields[0]["type"] == expected


@pytest.mark.parametrize("ctype", ["image", "table", "iframe", "documentPreview"])
def test_unsupported_components_are_reported_not_dropped_silently(ctype):
    res = convert_operaton_form(_schema(items=[{"type": "textfield", "key": "keep"}, {"type": ctype, "key": "gone"}]))
    assert [f["id"] for f in res.fields] == ["keep"]
    assert res.unsupported == [{"key": "gone", "type": ctype}]


def test_button_and_spacer_are_dropped_without_noise():
    res = convert_operaton_form(_schema(items=[{"type": "textfield", "key": "a"}, {"type": "button"}, {"type": "spacer"}]))
    assert [f["id"] for f in res.fields] == ["a"]
    assert res.unsupported == [] and res.warnings == []


def test_validation_is_carried_over():
    res = convert_operaton_form(_schema(items=[{
        "type": "textfield", "key": "inn", "label": "ИНН",
        "description": "10 цифр",
        "validate": {"required": True, "minLength": 10, "maxLength": 12,
                     "validationType": "custom", "pattern": "^\\d+$"},
    }]))
    f = res.fields[0]
    assert f["required"] is True
    assert f["hint"] == "10 цифр"
    assert f["validation"] == {"minLength": 10, "maxLength": 12, "regex": "^\\d+$"}


def test_dynamic_option_source_warns_instead_of_inventing_options():
    res = convert_operaton_form(_schema(items=[{"type": "select", "key": "city", "valuesKey": "cities"}]))
    assert res.fields[0]["options"] == []
    assert any(w["code"] == "dynamic_values_unsupported" for w in res.warnings)


def test_group_becomes_section_header_plus_flat_children():
    res = convert_operaton_form(_schema(items=[{
        "type": "group", "id": "grp", "label": "Реквизиты",
        "components": [{"type": "textfield", "key": "inn"}, {"type": "textfield", "key": "kpp"}],
    }]))
    assert [f["type"] for f in res.fields] == ["section_header", "text", "text"]
    assert res.fields[0]["label"] == "Реквизиты"
    assert set(res.key_map) == {"inn", "kpp"}


def test_html_component_is_flattened_to_text():
    res = convert_operaton_form(_schema(items=[{"type": "html", "content": "<b>Внимание</b> <i>важно</i>"}]))
    assert res.fields[0]["type"] == "info_text"
    assert "<" not in res.fields[0]["label"]
    assert any(w["code"] == "html_flattened" for w in res.warnings)


# ---------------------------------------------------------------- conditions


@pytest.mark.parametrize(
    "hide,operator,value",
    [
        ('=age = "x"', "neq", "x"),
        ('=age != "x"', "eq", "x"),
        ("=age > 10", "lt", 10),
        ("=age < 10", "gt", 10),
    ],
)
def test_hide_condition_is_inverted_into_visible_if(hide, operator, value):
    """`conditional.hide` is the inverse of our visibleIf, so the operator must flip."""
    res = convert_operaton_form(_schema(items=[
        {"type": "number", "key": "age"},
        {"type": "textfield", "key": "reason", "conditional": {"hide": hide}},
    ]))
    assert res.fields[1]["visibleIf"] == {"fieldId": "age", "operator": operator, "value": value}
    assert res.warnings == []


def test_complex_feel_condition_is_dropped_with_a_warning():
    res = convert_operaton_form(_schema(items=[
        {"type": "number", "key": "age"},
        {"type": "textfield", "key": "reason", "conditional": {"hide": '=age > 10 and name = "x"'}},
    ]))
    assert "visibleIf" not in res.fields[1]
    assert any(w["code"] == "feel_condition_dropped" for w in res.warnings)


def test_condition_may_reference_a_field_declared_later():
    res = convert_operaton_form(_schema(items=[
        {"type": "textfield", "key": "reason", "conditional": {"hide": '=decision = "no"'}},
        {"type": "select", "key": "decision", "values": [{"label": "no", "value": "no"}]},
    ]))
    assert res.fields[0]["visibleIf"]["fieldId"] == "decision"


def test_feel_default_value_is_not_taken_literally():
    res = convert_operaton_form(_schema(items=[{"type": "textfield", "key": "a", "defaultValue": "=now()"}]))
    assert "defaultValue" not in res.fields[0]
    assert any(w["code"] == "feel_default_dropped" for w in res.warnings)


def test_parse_hide_condition_ignores_unknown_field():
    assert parse_hide_condition('=ghost = "x"', {"real": "real"}) is None


# ------------------------------------------------------------------- keys


def test_nested_keys_are_sanitised_and_recorded():
    res = convert_operaton_form(_schema(items=[
        {"type": "textfield", "key": "applicant.firstName"},
        {"type": "textfield", "key": "applicant.lastName"},
    ]))
    assert [f["id"] for f in res.fields] == ["applicant_firstName", "applicant_lastName"]
    assert res.key_map == {
        "applicant.firstName": "applicant_firstName",
        "applicant.lastName": "applicant_lastName",
    }


def test_colliding_keys_get_distinct_ids():
    res = convert_operaton_form(_schema(items=[
        {"type": "textfield", "key": "a.b"},
        {"type": "textfield", "key": "a_b"},
    ]))
    ids = [f["id"] for f in res.fields]
    assert len(set(ids)) == 2


def test_sanitize_key_handles_leading_digit_and_empties():
    taken: set[str] = set()
    assert sanitize_key("1st", taken).startswith("field")
    assert sanitize_key("", taken).startswith("field")


@pytest.mark.parametrize(
    "raw,slug",
    [
        ("form_obrashchenieKlienta_klassifikaciya", "form_obrashchenie_klienta_klassifikaciya"),
        ("MyForm", "my_form"),
        ("weird--id!!", "weird_id"),
        ("", "operaton_form"),
    ],
)
def test_slugify_form_id(raw, slug):
    assert slugify_form_id(raw) == slug


def test_humanize_title_strips_the_form_prefix():
    assert humanize_title("form_orderApproval") == "Order Approval"


# ------------------------------------------------------------------ layout


def test_form_js_16_column_layout_maps_onto_our_grid():
    res = convert_operaton_form(_schema(items=[
        {"type": "textfield", "key": "a", "layout": {"row": "r1", "columns": 8}},
        {"type": "textfield", "key": "b", "layout": {"row": "r1", "columns": 8}},
        {"type": "textfield", "key": "c", "layout": {"row": "r2", "columns": 16}},
    ]))
    assert res.grid_columns == 2
    assert [f["layout"]["w"] for f in res.fields] == [1, 1, 2]
    assert res.fields[0]["layout"]["y"] == res.fields[1]["layout"]["y"]
    assert res.fields[2]["layout"]["y"] > res.fields[0]["layout"]["y"]


# ------------------------------------------------------------------ errors


@pytest.mark.parametrize("payload", [{}, {"components": "nope"}, {"components": []}, []])
def test_malformed_payloads_are_rejected(payload):
    with pytest.raises(OperatonSchemaError):
        convert_operaton_form(payload)


def test_form_of_only_unsupported_components_is_rejected():
    with pytest.raises(OperatonSchemaError):
        convert_operaton_form(_schema(items=[{"type": "table", "key": "t"}]))


def test_component_limit_is_enforced():
    with pytest.raises(OperatonSchemaError):
        convert_operaton_form(_schema(items=[{"type": "textfield", "key": f"f{i}"} for i in range(501)]))


# ------------------------------------------------------- webhook templating


def test_submit_config_is_a_template_because_task_id_is_runtime():
    cfg = operaton_submit_config("obrashchenieKlienta")
    assert cfg["webhookUrl"] == "{{bpmnBase}}/api/tasks/{{taskId}}/complete"
    assert cfg["delivery"] == "sync"       # engine errors must reach the user
    assert cfg["payload"] == "data"        # CompleteTaskRequest shape
    assert cfg["operatonComplete"] is True  # inject the shared secret server-side
    assert cfg["operatonProcessKey"] == "obrashchenieKlienta"


def test_placeholders_resolve_from_runtime_context():
    url, missing = resolve_placeholders(
        "{{bpmnBase}}/api/tasks/{{taskId}}/complete",
        {"bpmnBase": "http://bpmn:8001", "taskId": "t-1"},
    )
    assert url == "http://bpmn:8001/api/tasks/t-1/complete"
    assert missing == []


def test_missing_task_id_is_reported_not_silently_blanked():
    url, missing = resolve_placeholders(
        "{{bpmnBase}}/api/tasks/{{taskId}}/complete",
        {"bpmnBase": "http://bpmn:8001"},
    )
    assert missing == ["taskId"]
    assert "{{taskId}}" in url
