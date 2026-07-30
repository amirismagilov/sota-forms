"""Operaton (Camunda 7) form-js schema → our FormSchema.

Pure conversion: no database, no FastAPI, no network. Everything here is
deterministic and unit-testable, which is why the import endpoints stay thin.

Two rules drive the design:

1. **Never lose a field silently.** Anything that cannot be represented is
   reported in `unsupported`/`warnings` with its Operaton key, so a human can
   see exactly what needs finishing by hand.
2. **Never guess semantics.** FEEL expressions are matched against a small
   whitelist of shapes and dropped otherwise. A visibility rule translated
   "almost right" is worse than an absent one.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

# form-js lays components out on a 16-column grid.
FORM_JS_GRID = 16
# Our grid when the source schema carries no layout at all.
DEFAULT_GRID_COLUMNS = 2

# Types that always occupy a full row in our layout editor.
_FULL_WIDTH_TYPES = {"section_header", "divider", "info_text", "calculated"}
# Types the layout editor renders two rows tall (mirrors LAYOUT_TYPES/TALL).
_TALL_TYPES = {"textarea", "signature", "file", "image"}

# Components carrying no user input — dropped without a warning.
_IGNORED_TYPES = {"spacer", "button"}
# Components we cannot represent at all.
_UNSUPPORTED_TYPES = {
    "image", "table", "iframe", "documentPreview", "dynamiclist", "filepicker-document",
}


@dataclass
class ConversionResult:
    form_id: str
    title: str
    grid_columns: int
    fields: list[dict[str, Any]]
    submit: dict[str, Any]
    key_map: dict[str, str]
    warnings: list[dict[str, str]] = field(default_factory=list)
    unsupported: list[dict[str, str]] = field(default_factory=list)
    operaton_form_id: str = ""
    schema_version: int | None = None
    execution_platform: str | None = None
    components_total: int = 0

    def report(self) -> dict[str, Any]:
        return {
            "components_total": self.components_total,
            "mapped": len([f for f in self.fields if f.get("type") not in _FULL_WIDTH_TYPES]),
            "fields_total": len(self.fields),
            "warnings": self.warnings,
            "unsupported": self.unsupported,
        }


class OperatonSchemaError(ValueError):
    """The payload is not an Operaton form schema we can work with."""


# ---------------------------------------------------------------- identifiers

_CAMEL_BOUNDARY = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")


def _camel_to_snake(raw: str) -> str:
    return _CAMEL_BOUNDARY.sub("_", raw)


def slugify_form_id(raw: str) -> str:
    """Operaton form id → our globally-unique embed slug (`^[a-z0-9_]+$`).

    Operaton ids are routinely camelCase (`form_obrashchenieKlienta_klassifikaciya`).
    A bare `.lower()` would yield the unreadable `form_obrashchenieklienta_...`,
    so camelCase boundaries become underscores first.
    """
    slug = re.sub(r"[^a-z0-9_]+", "_", _camel_to_snake(raw or "").lower()).strip("_")
    slug = re.sub(r"_{2,}", "_", slug)
    return slug or "operaton_form"


def humanize_title(raw: str) -> str:
    """Derive a readable title from an Operaton form id.

    The schema has no human name (schemaVersion 16 has no such field), so this
    is only a starting point — the import UI requires the user to confirm it.
    """
    words = _camel_to_snake(re.sub(r"^form[_-]", "", raw or "")).replace("_", " ").split()
    return " ".join(w[:1].upper() + w[1:] for w in words) or "Форма Оператона"


def sanitize_key(key: str, taken: set[str]) -> str:
    """Operaton component key → our `field.id`.

    Our formula/condition engine only understands `[a-zA-Z0-9_]` (see
    `frontend/src/renderer/engine.ts`), while form-js allows nested paths such
    as `applicant.firstName`. Case is preserved — only the separators change.
    """
    base = re.sub(r"[^a-zA-Z0-9_]+", "_", key or "").strip("_")
    if not base or base[0].isdigit():
        base = f"field_{base}" if base else "field"
    candidate = base
    n = 1
    while candidate in taken:
        n += 1
        candidate = f"{base}_{n}"
    taken.add(candidate)
    return candidate


# -------------------------------------------------------------------- FEEL

# Only a single `<key> <op> <literal>` predicate is understood. Anything with
# and/or/functions/context access is dropped with a warning.
_SIMPLE_PREDICATE = re.compile(
    r"""^=?\s*(?P<key>[A-Za-z_][A-Za-z0-9_.]*)\s*
        (?P<op>!=|>=|<=|=|>|<)\s*
        (?P<value>"[^"]*"|'[^']*'|-?\d+(?:\.\d+)?|true|false)\s*$""",
    re.VERBOSE,
)

# `hide` is the inverse of our `visibleIf`, so every operator flips.
_INVERTED_OPS = {"=": "neq", "!=": "eq", ">": "lt", "<": "gt"}


def parse_hide_condition(expr: str, key_map: dict[str, str]) -> dict[str, Any] | None:
    """`conditional.hide` FEEL → our `visibleIf`, or None when not representable."""
    m = _SIMPLE_PREDICATE.match((expr or "").strip())
    if not m:
        return None
    op = _INVERTED_OPS.get(m.group("op"))
    if not op:  # >= / <= have no inverse in our operator set
        return None
    raw_key = m.group("key")
    target = key_map.get(raw_key)
    if not target:
        return None  # references a field we did not import
    raw_value = m.group("value")
    if raw_value in ("true", "false"):
        value: Any = raw_value == "true"
    elif raw_value[0] in "\"'":
        value = raw_value[1:-1]
    else:
        value = float(raw_value) if "." in raw_value else int(raw_value)
    return {"fieldId": target, "operator": op, "value": value}


_TAG_RE = re.compile(r"<[^>]+>")


def _strip_html(raw: str) -> str:
    """HTML components become plain text — never markup carried into our form."""
    return re.sub(r"\s{2,}", " ", _TAG_RE.sub(" ", raw or "")).strip()


# --------------------------------------------------------------- components


def _options_from(component: dict[str, Any]) -> list[dict[str, str]]:
    out = []
    for v in component.get("values") or []:
        if isinstance(v, dict):
            out.append({"label": str(v.get("label", v.get("value", ""))), "value": str(v.get("value", ""))})
    return out


def _apply_validation(component: dict[str, Any], target: dict[str, Any]) -> None:
    v = component.get("validate") or {}
    if v.get("required"):
        target["required"] = True
    validation: dict[str, Any] = {}
    for src, dst in (
        ("minLength", "minLength"), ("maxLength", "maxLength"),
        ("min", "min"), ("max", "max"),
    ):
        if v.get(src) is not None:
            validation[dst] = v[src]
    if v.get("validationType") == "custom" and v.get("pattern"):
        validation["regex"] = v["pattern"]
    step = component.get("increment")
    if step is not None:
        validation["step"] = step
    elif component.get("decimalDigits") is not None:
        try:
            validation["step"] = 10 ** -int(component["decimalDigits"])
        except (TypeError, ValueError):
            pass
    if validation:
        target["validation"] = validation


def _datetime_type(component: dict[str, Any]) -> str:
    subtype = (component.get("subtype") or "date").lower()
    if subtype == "time":
        return "time"
    if subtype in ("datetime", "date-time"):
        return "datetime"
    return "date"


def _text_field_type(component: dict[str, Any]) -> str:
    vt = ((component.get("validate") or {}).get("validationType") or "").lower()
    if vt == "email":
        return "email"
    if vt == "phone":
        return "phone"
    return "text"


def _select_type(component: dict[str, Any]) -> str:
    return "checkbox_group" if component.get("multiple") else "select_static"


_STATIC_TYPES = {
    "textarea": "textarea",
    "number": "number",
    "checkbox": "checkbox",
    "radio": "radio_group",
    "checklist": "checkbox_group",
    "taglist": "checkbox_group",
    "filepicker": "file",
    "separator": "divider",
    "text": "info_text",
}


def _map_type(component: dict[str, Any]) -> str | None:
    t = component.get("type")
    if t == "textfield":
        return _text_field_type(component)
    if t == "select":
        return _select_type(component)
    if t == "datetime":
        return _datetime_type(component)
    if t == "html":
        return "info_text"
    return _STATIC_TYPES.get(t or "")


# ------------------------------------------------------------------ convert


def _flatten(components: list[dict[str, Any]], out: list[dict[str, Any]]) -> None:
    """Groups are unrolled into a section header plus their children."""
    for c in components or []:
        if not isinstance(c, dict):
            continue
        if c.get("type") in ("group", "dynamiclist") and isinstance(c.get("components"), list):
            if c.get("type") == "dynamiclist":
                out.append({"__unsupported__": c})
                continue
            out.append({"type": "__group_header__", "label": c.get("label") or "", "key": c.get("id") or ""})
            _flatten(c["components"], out)
            continue
        out.append(c)


def convert_operaton_form(schema: dict[str, Any]) -> ConversionResult:
    """Convert an Operaton `.form` (form-js) schema into our form definition."""
    if not isinstance(schema, dict):
        raise OperatonSchemaError("Файл не похож на форму Оператона: ожидался JSON-объект")
    components = schema.get("components")
    if not isinstance(components, list):
        raise OperatonSchemaError("Файл не похож на форму Оператона: не найден массив components")
    if not components:
        raise OperatonSchemaError("В форме нет ни одного поля")
    if len(components) > 500:
        raise OperatonSchemaError("Слишком много компонентов (максимум 500)")

    operaton_form_id = str(schema.get("id") or "operaton_form")
    flat: list[dict[str, Any]] = []
    _flatten(components, flat)

    warnings: list[dict[str, str]] = []
    unsupported: list[dict[str, str]] = []
    key_map: dict[str, str] = {}
    taken: set[str] = set()
    fields: list[dict[str, Any]] = []
    # (index in `fields`, raw hide expression) — resolved after key_map is complete.
    pending_conditions: list[tuple[int, str]] = []
    has_layout = False

    for c in flat:
        if "__unsupported__" in c:
            src = c["__unsupported__"]
            unsupported.append({"key": str(src.get("key") or src.get("id") or ""), "type": str(src.get("type"))})
            continue

        ctype = c.get("type")

        if ctype == "__group_header__":
            fields.append({
                "id": sanitize_key(f"section_{c.get('key') or len(fields)}", taken),
                "type": "section_header",
                "label": c.get("label") or "Раздел",
                "headingLevel": 2,
            })
            continue

        if ctype in _IGNORED_TYPES:
            continue

        if ctype in _UNSUPPORTED_TYPES:
            unsupported.append({"key": str(c.get("key") or c.get("id") or ""), "type": str(ctype)})
            continue

        if ctype == "expression":
            unsupported.append({"key": str(c.get("key") or c.get("id") or ""), "type": "expression"})
            warnings.append({
                "key": str(c.get("key") or c.get("id") or ""),
                "code": "feel_expression_dropped",
                "message": "FEEL-выражение не переносится — задайте вычисляемое поле вручную",
            })
            continue

        our_type = _map_type(c)
        if our_type is None:
            unsupported.append({"key": str(c.get("key") or c.get("id") or ""), "type": str(ctype)})
            continue

        raw_key = str(c.get("key") or c.get("id") or "")
        # Static presentation components carry no key and no process variable.
        is_static = our_type in ("info_text", "divider")
        field_id = sanitize_key(raw_key or f"{our_type}_{len(fields)}", taken)
        if raw_key and not is_static:
            key_map[raw_key] = field_id

        label = c.get("label") or ("" if is_static else raw_key)
        if ctype == "html":
            label = _strip_html(c.get("content") or c.get("text") or label)
            warnings.append({"key": raw_key, "code": "html_flattened", "message": "HTML-компонент перенесён как текст"})
        elif ctype == "text":
            label = c.get("text") or label

        f: dict[str, Any] = {"id": field_id, "type": our_type, "label": str(label)}

        if c.get("description"):
            f["hint"] = str(c["description"])
        if c.get("readonly") or c.get("disabled"):
            f["readOnly"] = True

        default = c.get("defaultValue")
        if isinstance(default, str) and default.startswith("="):
            warnings.append({
                "key": raw_key, "code": "feel_default_dropped",
                "message": f"Значение по умолчанию — FEEL-выражение ({default[:60]}), не перенесено",
            })
        elif default is not None:
            f["defaultValue"] = default

        _apply_validation(c, f)

        if our_type in ("select_static", "radio_group", "checkbox_group"):
            options = _options_from(c)
            if options:
                f["options"] = options
            if c.get("valuesKey") or c.get("valuesExpression"):
                f["options"] = options or []
                warnings.append({
                    "key": raw_key, "code": "dynamic_values_unsupported",
                    "message": "Опции приходят из переменной процесса — привяжите справочник вручную",
                })
            elif not options:
                warnings.append({
                    "key": raw_key, "code": "no_options",
                    "message": "У поля выбора нет значений",
                })
        if ctype in ("checklist", "taglist"):
            warnings.append({
                "key": raw_key, "code": "rendered_as_checkbox_group",
                "message": f"{ctype} отображается группой чекбоксов",
            })

        if our_type == "file":
            fv: dict[str, Any] = {}
            if c.get("accept"):
                fv["extensions"] = str(c["accept"])
            if c.get("multiple"):
                fv["maxCount"] = 10
            if fv:
                f["fileValidation"] = fv

        if our_type == "textarea" and c.get("rows"):
            f["rows"] = c["rows"]

        layout = c.get("layout") or {}
        if layout.get("columns") or layout.get("row"):
            has_layout = True
            f["__layout__"] = {"row": layout.get("row"), "columns": layout.get("columns")}

        hide = (c.get("conditional") or {}).get("hide")
        if hide:
            pending_conditions.append((len(fields), str(hide)))

        fields.append(f)

    if not fields:
        raise OperatonSchemaError("Ни один компонент формы не удалось перенести")

    # Conditions resolve only once every key is known (a field may reference one
    # declared after it).
    for idx, expr in pending_conditions:
        cond = parse_hide_condition(expr, key_map)
        if cond:
            fields[idx]["visibleIf"] = cond
        else:
            warnings.append({
                "key": fields[idx]["id"], "code": "feel_condition_dropped",
                "message": f"Условие видимости не перенесено: {expr[:80]}",
            })

    grid_columns = DEFAULT_GRID_COLUMNS if has_layout else 1
    _assign_layout(fields, grid_columns, has_layout)

    return ConversionResult(
        form_id=slugify_form_id(operaton_form_id),
        title=humanize_title(operaton_form_id),
        grid_columns=grid_columns,
        fields=fields,
        submit={},
        key_map=key_map,
        warnings=warnings,
        unsupported=unsupported,
        operaton_form_id=operaton_form_id,
        schema_version=schema.get("schemaVersion"),
        execution_platform=schema.get("executionPlatform"),
        components_total=len(flat),
    )


def _assign_layout(fields: list[dict[str, Any]], grid_columns: int, has_layout: bool) -> None:
    """Translate form-js rows/columns into our {x, y, w, h} grid."""
    x = 0
    y = 0
    current_row: str | None = None
    for f in fields:
        meta = f.pop("__layout__", None)
        full = f["type"] in _FULL_WIDTH_TYPES
        if not has_layout:
            w = grid_columns
        elif full:
            w = grid_columns
        else:
            cols = (meta or {}).get("columns")
            w = grid_columns if not cols else max(1, round(int(cols) / FORM_JS_GRID * grid_columns))
            w = min(w, grid_columns)
        row_id = (meta or {}).get("row")
        if has_layout and row_id and row_id != current_row:
            if current_row is not None:
                x = 0
                y += 1
            current_row = row_id
        if x + w > grid_columns:
            x = 0
            y += 1
        f["layout"] = {"x": x, "y": y, "w": w, "h": 2 if f["type"] in _TALL_TYPES else 1}
        x += w
        if x >= grid_columns:
            x = 0
            y += 1


# ------------------------------------------------------- webhook / delivery

# Placeholders resolved server-side when a submission is delivered. `bpmnBase`
# comes from settings (so moving environments does not rewrite stored forms),
# `taskId` from the runtime context the widget passes in.
_PLACEHOLDER_RE = re.compile(r"\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}")

TASK_COMPLETE_URL = "{{bpmnBase}}/api/tasks/{{taskId}}/complete"


def operaton_submit_config(process_key: str | None = None) -> dict[str, Any]:
    """The `submit` block every imported Operaton form gets.

    The URL is a template on purpose: `taskId` is a RUNTIME id of a task
    instance and simply does not exist at import time.
    """
    cfg: dict[str, Any] = {
        "webhookUrl": TASK_COMPLETE_URL,
        "delivery": "sync",       # the user must see 409/404 from the engine
        "payload": "data",        # bare {"data": {...}} — CompleteTaskRequest
        "operatonComplete": True,  # inject the shared secret server-side
        "successMessage": "Задача отправлена в процесс",
    }
    if process_key:
        cfg["operatonProcessKey"] = process_key
    return cfg


def resolve_placeholders(template: str, values: dict[str, Any]) -> tuple[str, list[str]]:
    """Substitute `{{name}}` in a webhook URL. Returns (url, missing_names)."""
    missing: list[str] = []

    def _sub(m: re.Match[str]) -> str:
        name = m.group(1)
        val = values.get(name)
        if val in (None, ""):
            missing.append(name)
            return m.group(0)
        return str(val)

    return _PLACEHOLDER_RE.sub(_sub, template or ""), missing
