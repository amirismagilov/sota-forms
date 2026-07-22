"""Secret-handling invariants (GRACE: property + security tier)."""

from __future__ import annotations

from hypothesis import given
from hypothesis import strategies as st

from app.crypto import (
    decrypt,
    decrypt_auth_config,
    encrypt,
    encrypt_auth_config,
    is_encrypted,
    redact_auth_config,
    sign_payload,
)

secrets = st.text(min_size=1, max_size=200)


@given(secret=secrets)
def test_encrypt_decrypt_roundtrip(secret):
    enc = encrypt(secret)
    assert is_encrypted(enc)
    assert enc != secret  # never stored in cleartext
    assert decrypt(enc) == secret


@given(token=secrets)
def test_redaction_never_leaks_secret(token):
    cfg = encrypt_auth_config({"token": token, "headerName": "Authorization"})
    redacted = redact_auth_config(cfg)
    # The redacted view sent to the frontend must not expose the secret value.
    assert redacted["token"] == "__set__"
    assert token not in redacted.values()
    assert cfg["token"] not in redacted.values()  # nor its ciphertext
    # Non-secret fields survive.
    assert redacted["headerName"] == "Authorization"


@given(token=secrets)
def test_auth_config_roundtrip(token):
    cfg = encrypt_auth_config({"token": token})
    assert is_encrypted(cfg["token"])
    assert decrypt_auth_config(cfg)["token"] == token


def test_encrypt_is_idempotent_on_encrypted():
    once = encrypt_auth_config({"token": "abc"})
    twice = encrypt_auth_config(once)
    assert decrypt_auth_config(twice)["token"] == "abc"


def test_signature_is_deterministic_and_order_independent():
    a = sign_payload({"a": 1, "b": 2})
    b = sign_payload({"b": 2, "a": 1})
    assert a == b
    assert a.startswith("sha256=")
