"""Флоу отправки формы: кнопка → запрос → разбор ответа → действие.

Автор настраивает форму до конца без кода:

    1. поля            — fields[] (конструктор)
    2. кнопка           — step.button   (текст, размер, ширина)
    3. куда слать JSON  — step.request  (webhook | rest через «Подключение»)
    4. как разобрать    — step.rules[].when  (условия по HTTP-статусу и телу)
    5. что показать     — step.rules[].then  (сообщение | новые поля | переход)

Канонический кейс — заявка на кредит: 5 полей → система принятия решения →
«одобрено» открывает шаг с ещё 3 полями, «отказ» показывает сообщение.

Правила считаются НА БЭКЕНДЕ, в браузер уходит уже готовый исход. Ответ
скоринга (лимит, причина отказа, персональные данные) не попадает на страницу,
пока автор явно не включит «отдавать сырой ответ» — это осознанное решение,
а не побочный эффект настройки.

Модуль намеренно без зависимостей от БД и FastAPI: его можно (и нужно)
тестировать как чистую функцию, а исполнение транспорта живёт в routers/public.
"""

from __future__ import annotations

import json
import re
from typing import Any

MAIN_STEP = "main"
MAX_STEPS = 20
MAX_RULES = 40

# Действия, которые умеет исполнить виджет.
OUTCOME_KINDS = ("message", "fields", "redirect", "none")
TRANSPORTS = ("none", "webhook", "rest")

_PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z0-9_.\[\]]+)\s*\}\}")
_QUOTED_PLACEHOLDER = re.compile(r'"\{\{\s*([A-Za-z0-9_.\[\]]+)\s*\}\}"')


# --------------------------------------------------------------------------
# Пути и шаблоны
# --------------------------------------------------------------------------
def dig(obj: Any, path: str | None) -> Any:
    """Значение по точечному пути: `result.decision`, `offers.0.limit`.

    Возвращает None для любого несуществующего пути — правило «поля нет»
    выражается оператором `empty`/`exists`, а не исключением.
    """
    cur = obj
    for part in str(path or "").replace("[", ".").replace("]", "").split("."):
        if part == "":
            continue
        if isinstance(cur, list):
            try:
                cur = cur[int(part)]
            except (ValueError, IndexError):
                return None
        elif isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
        if cur is None:
            return None
    return cur


def build_context(
    *,
    data: dict[str, Any] | None = None,
    status: int | None = None,
    response: Any = None,
    error: str | None = None,
    submission_id: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Контекст, в котором живут условия и шаблоны.

    `resp`/`response` — тело ответа, `data` — то, что отправил пользователь,
    `status` — HTTP-код, `error` — текст сетевой ошибки (пусто, если запрос дошёл).
    """
    ctx = {
        "data": data or {},
        "resp": response if response is not None else {},
        "response": response if response is not None else {},
        "status": status if status is not None else 0,
        "error": error or "",
        "submissionId": submission_id or "",
    }
    if extra:
        ctx.update(extra)
    return ctx


def ctx_value(ctx: dict[str, Any], path: str | None) -> Any:
    """Путь из шаблона. Голое имя без префикса — это поле формы.

    `{{status}}` → код, `{{resp.limit}}` → тело ответа, `{{f_amount}}` → поле
    формы. Последнее — самый частый случай в шаблонах сообщений, поэтому оно
    работает без обязательного префикса `data.`.
    """
    p = str(path or "")
    head = p.split(".")[0]
    if head in ("data", "resp", "response", "status", "error", "submissionId"):
        return dig(ctx, p)
    return dig(ctx.get("data"), p)


def render_template(tpl: str | None, ctx: dict[str, Any]) -> str:
    """`{{путь}}` → значение. Отсутствующее значение становится пустой строкой."""
    if not tpl:
        return ""

    def _sub(m: re.Match[str]) -> str:
        v = ctx_value(ctx, m.group(1))
        if v is None:
            return ""
        if isinstance(v, (dict, list)):
            return json.dumps(v, ensure_ascii=False)
        if isinstance(v, bool):
            return "да" if v else "нет"
        return str(v)

    return _PLACEHOLDER.sub(_sub, tpl)


def render_json_template(tpl: str, ctx: dict[str, Any]) -> Any:
    """JSON-шаблон тела запроса с подстановкой значений.

    `"{{f_amount}}"` целиком в кавычках подставляется ТИПИЗИРОВАННО (число
    останется числом, массив — массивом); `{{...}}` внутри строки — как текст
    с экранированием. Иначе сумма 100000 уехала бы во внешнюю систему строкой
    и упала бы там на валидации типов.
    """

    def _typed(m: re.Match[str]) -> str:
        return json.dumps(ctx_value(ctx, m.group(1)), ensure_ascii=False)

    def _inline(m: re.Match[str]) -> str:
        v = ctx_value(ctx, m.group(1))
        text = "" if v is None else (v if isinstance(v, str) else json.dumps(v, ensure_ascii=False))
        return json.dumps(text, ensure_ascii=False)[1:-1]

    rendered = _QUOTED_PLACEHOLDER.sub(_typed, tpl)
    rendered = _PLACEHOLDER.sub(_inline, rendered)
    return json.loads(rendered)


# --------------------------------------------------------------------------
# Нормализация конфигурации
# --------------------------------------------------------------------------
def _button(cfg: dict | None) -> dict:
    cfg = dict(cfg or {})
    return {
        "text": cfg.get("text") or "Отправить",
        "loadingText": cfg.get("loadingText") or "",
        "size": cfg.get("size") if cfg.get("size") in ("small", "middle", "large") else "large",
        "block": True if cfg.get("block") is None else bool(cfg.get("block")),
        "align": cfg.get("align") if cfg.get("align") in ("left", "center", "right") else "center",
    }


def _request(cfg: dict | None, legacy: dict | None) -> dict:
    """Конфиг запроса шага. `legacy` — старый submit с одиночным webhook."""
    out = dict(cfg or {})
    if legacy is not None:
        # Формы, настроенные до появления флоу, держат вебхук в submit.webhookUrl.
        # Не переносить его молча — значит после апгрейда форма перестанет
        # доставлять данные, а автор об этом узнает от клиента.
        for key in ("webhookUrl", "delivery", "payload"):
            if out.get(key) in (None, ""):
                out[key] = legacy.get(key)
        if legacy.get("operatonComplete") and out.get("operatonComplete") is None:
            out["operatonComplete"] = True

    transport = out.get("transport")
    if transport not in TRANSPORTS:
        transport = "webhook" if out.get("webhookUrl") else ("rest" if out.get("connectionId") else "none")
    out["transport"] = transport
    out["method"] = str(out.get("method") or "POST").upper()
    out["payload"] = out.get("payload") or "envelope"
    # REST-шаг всегда синхронный: без ответа нечего разбирать правилами.
    out["delivery"] = "sync" if transport == "rest" else (out.get("delivery") or "async")
    out["exposeResponse"] = bool(out.get("exposeResponse"))
    out["headers"] = [h for h in (out.get("headers") or []) if isinstance(h, dict) and h.get("name")]
    return out


def _condition(raw: dict) -> dict:
    src = raw.get("source")
    if src not in ("status", "body", "field", "error"):
        src = "body"
    op = raw.get("operator") or "eq"
    # `exists` и `not_empty` — один и тот же оператор. Сводим к одному имени,
    # иначе в конструкторе пришлось бы держать два одинаковых пункта списка.
    if op == "exists":
        op = "not_empty"
    return {
        "source": src,
        "path": raw.get("path") or "",
        "operator": op,
        "value": raw.get("value"),
    }


def _action(raw: dict | None) -> dict:
    raw = dict(raw or {})
    kind = raw.get("kind")
    if kind not in OUTCOME_KINDS:
        kind = "message"
    out: dict[str, Any] = {"kind": kind}
    if kind == "message":
        mt = raw.get("messageType")
        out["messageType"] = mt if mt in ("success", "info", "warning", "error") else "success"
        out["title"] = raw.get("title") or ""
        out["text"] = raw.get("text") or ""
    elif kind == "fields":
        out["stepId"] = raw.get("stepId") or ""
        out["fill"] = [f for f in (raw.get("fill") or []) if isinstance(f, dict) and f.get("fieldId")]
    elif kind == "redirect":
        out["url"] = raw.get("url") or ""
        out["newTab"] = bool(raw.get("newTab"))
        out["delayMs"] = int(raw.get("delayMs") or 0)
    return out


def _rule(raw: dict, index: int) -> dict:
    return {
        "id": raw.get("id") or f"rule{index + 1}",
        "name": raw.get("name") or "",
        "match": "any" if raw.get("match") == "any" else "all",
        "when": [_condition(c) for c in (raw.get("when") or []) if isinstance(c, dict)],
        "then": _action(raw.get("then")),
    }


def _legacy_rules(submit: dict) -> list[dict]:
    """Старый submit = одно безусловное правило «показать сообщение/перейти»."""
    if submit.get("redirectUrl"):
        action = {"kind": "redirect", "url": submit["redirectUrl"]}
    else:
        action = {
            "kind": "message",
            "messageType": "success",
            "text": submit.get("successMessage") or "Спасибо!",
        }
    return [_rule({"id": "default", "name": "По умолчанию", "when": [], "then": action}, 0)]


def normalize_flow(submit: dict | None) -> dict:
    """`form.submit` → `{"steps": [...]}` в каноническом виде.

    Единственная точка, где старая (одиночный webhook) и новая (шаги) схемы
    сводятся вместе, — поэтому и рантайм, и конструктор, и тест флоу видят
    ровно одну и ту же конфигурацию.
    """
    submit = submit or {}
    raw_steps = [s for s in (submit.get("steps") or []) if isinstance(s, dict)][:MAX_STEPS]

    steps: list[dict] = []
    seen: set[str] = set()
    for i, s in enumerate(raw_steps):
        sid = str(s.get("id") or "").strip() or (MAIN_STEP if i == 0 else f"step{i + 1}")
        if sid in seen:
            continue
        seen.add(sid)
        steps.append(
            {
                "id": sid,
                "title": s.get("title") or "",
                "description": s.get("description") or "",
                "button": _button(s.get("button")),
                "request": _request(s.get("request"), submit if i == 0 else None),
                "rules": [_rule(r, j) for j, r in enumerate(s.get("rules") or []) if isinstance(r, dict)][:MAX_RULES],
            }
        )

    if not steps:
        steps = [
            {
                "id": MAIN_STEP,
                "title": "",
                "description": "",
                "button": _button(submit.get("button")),
                "request": _request(None, submit),
                "rules": [],
            }
        ]
    # Первый шаг — всегда «main»: на него ссылается виджет при первом рендере.
    steps[0]["id"] = MAIN_STEP
    if not steps[0]["rules"]:
        steps[0]["rules"] = _legacy_rules(submit)
    return {"steps": steps}


def get_step(flow: dict, step_id: str | None) -> dict | None:
    wanted = step_id or MAIN_STEP
    for s in flow.get("steps", []):
        if s["id"] == wanted:
            return s
    return None


# --------------------------------------------------------------------------
# Условия и выбор правила
# --------------------------------------------------------------------------
def _as_number(v: Any) -> float | None:
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(" ", "").replace(",", "."))
    except (TypeError, ValueError):
        return None


def _is_empty(v: Any) -> bool:
    return v is None or v == "" or v == [] or v == {}


def condition_operand(cond: dict, ctx: dict[str, Any]) -> Any:
    src = cond.get("source")
    if src == "status":
        return ctx.get("status")
    if src == "error":
        return ctx.get("error")
    if src == "field":
        return dig(ctx.get("data"), cond.get("path"))
    return dig(ctx.get("resp"), cond.get("path"))


def eval_condition(cond: dict, ctx: dict[str, Any]) -> bool:
    left = condition_operand(cond, ctx)
    right = cond.get("value")
    op = cond.get("operator") or "eq"

    if op == "exists":
        return not _is_empty(left)
    if op == "empty":
        return _is_empty(left)
    if op == "not_empty":
        return not _is_empty(left)
    if op == "contains":
        if isinstance(left, list):
            return any(str(x) == str(right) for x in left)
        return str(right or "") in str(left or "")
    if op == "in":
        # «одно из»: список через запятую — «approved, manual».
        allowed = right if isinstance(right, list) else [x.strip() for x in str(right or "").split(",")]
        return any(str(left) == str(x) for x in allowed if str(x) != "")
    if op == "regex":
        try:
            return re.search(str(right or ""), str(left or "")) is not None
        except re.error:
            return False
    if op in ("gt", "lt", "gte", "lte"):
        ln, rn = _as_number(left), _as_number(right)
        if ln is None or rn is None:
            return False
        return {"gt": ln > rn, "lt": ln < rn, "gte": ln >= rn, "lte": ln <= rn}[op]
    if op == "neq":
        return str(left if left is not None else "") != str(right if right is not None else "")
    # eq по умолчанию — сравнение как строк, чтобы 200 и "200" не расходились.
    return str(left if left is not None else "") == str(right if right is not None else "")


def rule_matches(rule: dict, ctx: dict[str, Any]) -> bool:
    conds = rule.get("when") or []
    if not conds:
        return True  # правило без условий — «иначе», ставится последним
    results = (eval_condition(c, ctx) for c in conds)
    return any(results) if rule.get("match") == "any" else all(results)


def pick_rule(rules: list[dict], ctx: dict[str, Any]) -> dict | None:
    """Первое сработавшее правило. Порядок в списке = приоритет."""
    for r in rules or []:
        if rule_matches(r, ctx):
            return r
    return None


# --------------------------------------------------------------------------
# Исход
# --------------------------------------------------------------------------
def resolve_outcome(action: dict, ctx: dict[str, Any]) -> dict:
    """Действие правила → готовый к исполнению исход (шаблоны уже подставлены)."""
    kind = action.get("kind")
    if kind == "redirect":
        return {
            "kind": "redirect",
            "url": render_template(action.get("url"), ctx),
            "newTab": bool(action.get("newTab")),
            "delayMs": int(action.get("delayMs") or 0),
        }
    if kind == "fields":
        values: dict[str, Any] = {}
        for fill in action.get("fill") or []:
            frm = fill.get("from") or ""
            # Шаблон со скобками собирает строку из кусков, голый путь отдаёт
            # значение как есть (число останется числом).
            values[fill["fieldId"]] = render_template(frm, ctx) if "{{" in frm else ctx_value(ctx, frm)
        return {"kind": "fields", "stepId": action.get("stepId") or "", "values": values}
    if kind == "none":
        return {"kind": "none"}
    return {
        "kind": "message",
        "messageType": action.get("messageType") or "success",
        "title": render_template(action.get("title"), ctx),
        "text": render_template(action.get("text"), ctx),
    }


def run_rules(step: dict, ctx: dict[str, Any]) -> tuple[dict, dict | None]:
    """(исход, сработавшее правило). Ни одно не сработало — нейтральное «Спасибо!»."""
    rule = pick_rule(step.get("rules") or [], ctx)
    if rule is None:
        return {"kind": "message", "messageType": "success", "title": "", "text": "Спасибо!"}, None
    return resolve_outcome(rule.get("then") or {}, ctx), rule


def build_request_body(request: dict, ctx: dict[str, Any]) -> Any:
    """Тело исходящего запроса по режиму `payload`.

    envelope — наш конверт с метаданными заполнения (по умолчанию);
    data     — голое `{"data": {...}}` (его ждёт sota-bpmn при завершении задачи);
    custom   — JSON-шаблон автора: полный контроль над формой пакета.
    """
    mode = request.get("payload") or "envelope"
    if mode == "custom":
        tpl = request.get("bodyTemplate") or ""
        if not tpl.strip():
            return {"data": ctx.get("data") or {}}
        return render_json_template(tpl, ctx)
    if mode == "data":
        return {"data": ctx.get("data") or {}}
    return {
        "formId": ctx.get("formId") or "",
        "submissionId": ctx.get("submissionId") or "",
        "step": ctx.get("step") or MAIN_STEP,
        "data": ctx.get("data") or {},
        "submittedAt": ctx.get("submittedAt") or "",
    }


def render_headers(request: dict, ctx: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for h in request.get("headers") or []:
        name = str(h.get("name") or "").strip()
        if name:
            out[name] = render_template(str(h.get("value") or ""), ctx)
    return out


def step_field_ids(fields: list[dict], step_id: str) -> list[str]:
    """ID полей шага. Поле без явного шага принадлежит первому."""
    return [f.get("id") for f in fields or [] if (f.get("step") or MAIN_STEP) == step_id and f.get("id")]
