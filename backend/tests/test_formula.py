"""Property-based invariants for the formula engine (GRACE: property tier).

We assert mathematical invariants that MUST hold for any input, not a handful
of hand-picked examples. Hypothesis generates thousands of cases and shrinks
any failure to a minimal reproducer.
"""

from __future__ import annotations

import math

import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.formula import FormulaError, evaluate, extract_refs

finite = st.floats(min_value=-1e6, max_value=1e6, allow_nan=False, allow_infinity=False)


def test_empty_formula_is_zero():
    assert evaluate("") == 0.0
    assert evaluate("   ") == 0.0
    assert evaluate(None) == 0.0  # type: ignore[arg-type]


@given(a=finite, b=finite)
def test_addition_matches_arithmetic(a, b):
    result = evaluate("{{x}} + {{y}}", {"x": a, "y": b})
    assert math.isclose(result, a + b, rel_tol=1e-9, abs_tol=1e-6)


@given(a=finite, b=finite)
def test_addition_is_commutative(a, b):
    assert math.isclose(
        evaluate("{{x}} + {{y}}", {"x": a, "y": b}),
        evaluate("{{y}} + {{x}}", {"x": a, "y": b}),
        rel_tol=1e-9,
        abs_tol=1e-6,
    )


@given(a=finite)
def test_multiply_by_zero(a):
    assert evaluate("{{x}} * 0", {"x": a}) == 0.0


@given(a=finite)
def test_division_by_zero_never_raises(a):
    # Calculated fields must degrade gracefully, not explode, while typing.
    assert evaluate("{{x}} / {{z}}", {"x": a, "z": 0}) == 0.0


@given(price=finite, qty=finite, discount=st.floats(min_value=0, max_value=100, allow_nan=False))
def test_order_total_formula(price, qty, discount):
    formula = "{{f_price}} * {{f_qty}} * (1 - {{f_tariff.discount}} / 100) + {{f_delivery.cost}}"
    result = evaluate(
        formula,
        values={"f_price": price, "f_qty": qty},
        attrs={"f_tariff": {"discount": discount}, "f_delivery": {"cost": 100}},
    )
    expected = price * qty * (1 - discount / 100) + 100
    assert math.isclose(result, expected, rel_tol=1e-9, abs_tol=1e-3)


def test_missing_reference_defaults_to_zero_number():
    # Unresolved field refs are treated as 0 (widget behaviour while incomplete).
    assert evaluate("{{unknown}} + 5", {}) == 5.0


def test_string_numbers_are_coerced():
    assert evaluate("{{a}} + {{b}}", {"a": "1 000,50", "b": "0,5"}) == 1001.0


@pytest.mark.parametrize(
    "malicious",
    [
        "__import__('os').system('echo hi')",
        "open('/etc/passwd')",
        "(lambda: 1)()",
        "[].__class__",
        "{{x}}.__class__",
    ],
)
def test_no_arbitrary_code_execution(malicious):
    # Security invariant (Б-7): nothing outside whitelisted arithmetic runs.
    with pytest.raises(FormulaError):
        evaluate(malicious, {"x": 1})


def test_extract_refs():
    refs = extract_refs("{{f_price}} * {{f_qty}} + {{f_delivery.cost}}")
    assert refs == [("f_price", None), ("f_qty", None), ("f_delivery", "cost")]
