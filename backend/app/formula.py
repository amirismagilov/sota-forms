"""Safe formula evaluation for `calculated` fields (ФР-22..29, Б-7).

Supports reference syntax:
    {{field_id}}        -> value of another field
    {{field_id.attr}}   -> attribute of the selected dictionary value

Only a whitelisted arithmetic/boolean AST is evaluated — never arbitrary code.
This module is shared by the backend and mirrored by the widget; it is the
primary property-based-tested unit in the GRACE tier.
"""

from __future__ import annotations

import ast
import operator
import re
from typing import Any

_REF_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)(?:\.([a-zA-Z0-9_]+))?\s*\}\}")

_BIN_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_UNARY_OPS = {ast.UAdd: operator.pos, ast.USub: operator.neg, ast.Not: operator.not_}
_CMP_OPS = {
    ast.Eq: operator.eq,
    ast.NotEq: operator.ne,
    ast.Gt: operator.gt,
    ast.Lt: operator.lt,
    ast.GtE: operator.ge,
    ast.LtE: operator.le,
}


class FormulaError(ValueError):
    pass


def extract_refs(formula: str) -> list[tuple[str, str | None]]:
    """Return (field_id, attr|None) referenced by the formula."""
    return [(m.group(1), m.group(2)) for m in _REF_RE.finditer(formula or "")]


def _to_number(value: Any) -> float:
    if value is None or value == "":
        return 0.0
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, int | float):
        return float(value)
    if isinstance(value, str):
        cleaned = value.replace(" ", "").replace(",", ".")
        try:
            return float(cleaned)
        except ValueError:
            return 0.0
    return 0.0


def _resolve(field_id: str, attr: str | None, values: dict, attrs: dict) -> Any:
    if attr:
        # Attribute of the selected dictionary value for that field.
        return (attrs.get(field_id) or {}).get(attr, 0)
    return values.get(field_id, 0)


def _eval_node(node: ast.AST, env: dict[str, Any]) -> Any:
    if isinstance(node, ast.Expression):
        return _eval_node(node.body, env)
    if isinstance(node, ast.Constant):
        if isinstance(node.value, int | float | bool):
            return node.value
        raise FormulaError("only numeric/boolean literals allowed")
    if isinstance(node, ast.Name):
        if node.id not in env:
            raise FormulaError(f"unknown reference: {node.id}")
        return env[node.id]
    if isinstance(node, ast.BinOp) and type(node.op) in _BIN_OPS:
        left = _to_number(_eval_node(node.left, env))
        right = _to_number(_eval_node(node.right, env))
        if isinstance(node.op, ast.Div | ast.Mod) and right == 0:
            return 0.0
        return _BIN_OPS[type(node.op)](left, right)
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY_OPS:
        return _UNARY_OPS[type(node.op)](_to_number(_eval_node(node.operand, env)))
    if isinstance(node, ast.BoolOp):
        vals = [_eval_node(v, env) for v in node.values]
        if isinstance(node.op, ast.And):
            return all(vals)
        return any(vals)
    if isinstance(node, ast.Compare) and len(node.ops) == 1:
        left = _to_number(_eval_node(node.left, env))
        right = _to_number(_eval_node(node.comparators[0], env))
        return _CMP_OPS[type(node.ops[0])](left, right)
    if isinstance(node, ast.IfExp):
        return _eval_node(node.body, env) if _eval_node(node.test, env) else _eval_node(node.orelse, env)
    raise FormulaError(f"unsupported expression element: {type(node).__name__}")


def evaluate(formula: str, values: dict | None = None, attrs: dict | None = None) -> float:
    """Evaluate a formula against field values and selected-value attributes.

    Returns 0.0 for an empty formula. Division by zero yields 0.0 rather than
    raising, so calculated fields degrade gracefully while the user types.
    """
    values = values or {}
    attrs = attrs or {}
    if not formula or not formula.strip():
        return 0.0

    env: dict[str, Any] = {}
    counter = 0

    def _replace(match: re.Match) -> str:
        nonlocal counter
        var = f"_ref_{counter}"
        counter += 1
        env[var] = _to_number(_resolve(match.group(1), match.group(2), values, attrs))
        return var

    expr = _REF_RE.sub(_replace, formula)
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as exc:
        raise FormulaError(f"invalid formula syntax: {exc}") from exc

    result = _eval_node(tree, env)
    return float(_to_number(result))
